/**
 * Channel Signal Behaviour — Diagnostic Engine (Phase 3)
 *
 * Correlates channel-level metrics to produce four classes of actionable
 * diagnostics stored in channel_diagnostics:
 *
 *   1. signal_gap          — channel SCS is critically low (< 50%)
 *   2. journey_divergence  — channel conversion rate is < 40% of the best
 *                            performing channel (minimum 10-session threshold)
 *   3. engagement_anomaly  — channel avg_events_per_session is more than
 *                            2× below the cross-channel mean
 *   4. consent_impact      — SCS is low but conversion rate is normal,
 *                            suggesting consent blocks signal rather than traffic
 *
 * Deduplication: diagnostics of the same type + channel are not re-inserted
 * if an unresolved one already exists within the last 7 days.
 */

import {
  getChannelOverviews,
  getDistinctChannelSites,
  getRecentDiagnosticCount,
  insertDiagnostic,
} from '@/services/database/channelQueries';
import type { ChannelOverview } from '@/types/channel';
import type { ChannelType, DiagnosticType, Severity } from '@/types/channel';
import logger from '@/utils/logger';

export async function runDiagnosticsForUser(
  userId: string,
  websiteUrl?: string,
): Promise<void> {
  const sites = websiteUrl ? [websiteUrl] : await getDistinctChannelSites(userId);

  for (const site of sites) {
    await runDiagnosticsForSite(userId, site);
  }
}

async function runDiagnosticsForSite(userId: string, websiteUrl: string): Promise<void> {
  const overviews = await getChannelOverviews(userId, websiteUrl, 30);

  if (overviews.length === 0) return;

  await Promise.all([
    checkSignalGaps(userId, websiteUrl, overviews),
    checkJourneyDivergence(userId, websiteUrl, overviews),
    checkEngagementAnomalies(userId, websiteUrl, overviews),
    checkConsentImpact(userId, websiteUrl, overviews),
  ]);
}

// ── Rule 1: Signal Gap ────────────────────────────────────────────────────────

async function checkSignalGaps(
  userId: string,
  websiteUrl: string,
  overviews: ChannelOverview[],
): Promise<void> {
  for (const ov of overviews) {
    if (ov.signal_completion_score >= 0.5) continue;

    const alreadyExists = await isDuplicate(userId, websiteUrl, ov.channel, 'signal_gap');
    if (alreadyExists) continue;

    const severity: Severity = ov.signal_completion_score < 0.3 ? 'critical' : 'warning';

    await insertDiagnostic(userId, websiteUrl, {
      channel: ov.channel,
      diagnostic_type: 'signal_gap',
      severity,
      title: `Signal gaps detected on ${label(ov.channel)}`,
      description:
        `${label(ov.channel)} sessions have a low average signal completion score ` +
        `(${pct(ov.signal_completion_score)}%). Missing signals reduce conversion ` +
        `attribution accuracy and may under-report conversions to ad platforms.`,
      affected_pages: [],
      estimated_impact: `${ov.total_sessions.toLocaleString()} sessions affected`,
      recommended_action:
        'Review WalkerOS event firing on landing pages for this channel. ' +
        'Ensure all required events are present and parameters are complete.',
      is_resolved: false,
    });

    log(userId, websiteUrl, ov.channel, 'signal_gap');
  }
}

// ── Rule 2: Journey Divergence ────────────────────────────────────────────────

async function checkJourneyDivergence(
  userId: string,
  websiteUrl: string,
  overviews: ChannelOverview[],
): Promise<void> {
  // Need at least 2 channels with enough data to compare
  const eligible = overviews.filter((ov) => ov.total_sessions >= 10);
  if (eligible.length < 2) return;

  const bestRate = Math.max(...eligible.map((ov) => ov.conversion_rate));
  if (bestRate === 0) return;

  for (const ov of eligible) {
    // Flag if this channel's conversion rate is less than 40% of the best
    if (ov.conversion_rate / bestRate >= 0.4) continue;

    const alreadyExists = await isDuplicate(
      userId,
      websiteUrl,
      ov.channel,
      'journey_divergence',
    );
    if (alreadyExists) continue;

    const severity: Severity = ov.conversion_rate / bestRate < 0.2 ? 'critical' : 'warning';
    const bestChannel = eligible.find((o) => o.conversion_rate === bestRate);

    await insertDiagnostic(userId, websiteUrl, {
      channel: ov.channel,
      diagnostic_type: 'journey_divergence',
      severity,
      title: `Journey divergence on ${label(ov.channel)}`,
      description:
        `${label(ov.channel)} converts at ${pct(ov.conversion_rate)}%, which is ` +
        `${Math.round((1 - ov.conversion_rate / bestRate) * 100)}% lower than ` +
        `${bestChannel ? label(bestChannel.channel) : 'the best-performing channel'} ` +
        `(${pct(bestRate)}%). Users from this channel are dropping off earlier ` +
        `in the journey than other acquisition sources.`,
      affected_pages: [],
      estimated_impact: `${ov.total_sessions.toLocaleString()} sessions; ` +
        `${Math.round((bestRate - ov.conversion_rate) * ov.total_sessions)} ` +
        `additional conversions possible at parity`,
      recommended_action:
        'Compare landing page content and load time for this channel vs top-performing ' +
        'channels. Check if the audience intent matches the page experience. ' +
        'Review the journey map for the exact step where drop-off occurs.',
      is_resolved: false,
    });

    log(userId, websiteUrl, ov.channel, 'journey_divergence');
  }
}

// ── Rule 3: Engagement Anomaly ────────────────────────────────────────────────

async function checkEngagementAnomalies(
  userId: string,
  websiteUrl: string,
  overviews: ChannelOverview[],
): Promise<void> {
  const eligible = overviews.filter((ov) => ov.total_sessions >= 10);
  if (eligible.length < 2) return;

  const mean =
    eligible.reduce((sum, ov) => sum + ov.avg_events_per_session, 0) / eligible.length;

  if (mean === 0) return;

  // Variance for standard deviation
  const variance =
    eligible.reduce((sum, ov) => sum + Math.pow(ov.avg_events_per_session - mean, 2), 0) /
    eligible.length;
  const stdDev = Math.sqrt(variance);

  for (const ov of eligible) {
    // Flag if more than 2 standard deviations below mean (and at least 30% below)
    const zScore = stdDev > 0 ? (mean - ov.avg_events_per_session) / stdDev : 0;
    if (zScore < 2 || ov.avg_events_per_session >= mean * 0.7) continue;

    const alreadyExists = await isDuplicate(
      userId,
      websiteUrl,
      ov.channel,
      'engagement_anomaly',
    );
    if (alreadyExists) continue;

    const severity: Severity = zScore >= 3 ? 'critical' : 'warning';

    await insertDiagnostic(userId, websiteUrl, {
      channel: ov.channel,
      diagnostic_type: 'engagement_anomaly',
      severity,
      title: `Low engagement depth on ${label(ov.channel)}`,
      description:
        `${label(ov.channel)} sessions average ${ov.avg_events_per_session.toFixed(1)} ` +
        `events, compared to a cross-channel mean of ${mean.toFixed(1)} ` +
        `(z-score: ${zScore.toFixed(1)}). Users from this channel engage ` +
        `significantly less deeply with tracked interactions.`,
      affected_pages: [],
      estimated_impact: `${ov.total_sessions.toLocaleString()} sessions show reduced engagement`,
      recommended_action:
        'Verify that WalkerOS events are firing correctly for sessions arriving via ' +
        `${label(ov.channel)}. Check for consent-related event suppression or ` +
        'ad-blocker interference affecting this traffic source. ' +
        'Review if the landing experience is aligned with the channel audience.',
      is_resolved: false,
    });

    log(userId, websiteUrl, ov.channel, 'engagement_anomaly');
  }
}

// ── Rule 4: Consent Impact ────────────────────────────────────────────────────

/**
 * Identifies channels where signal completion score is low but conversion rate
 * is close to the cross-channel mean — a pattern suggesting consent is blocking
 * signal collection without blocking actual purchases/leads.
 */
async function checkConsentImpact(
  userId: string,
  websiteUrl: string,
  overviews: ChannelOverview[],
): Promise<void> {
  const eligible = overviews.filter((ov) => ov.total_sessions >= 10);
  if (eligible.length < 2) return;

  const meanConvRate =
    eligible.reduce((sum, ov) => sum + ov.conversion_rate, 0) / eligible.length;

  for (const ov of eligible) {
    // Low SCS (<50%) but conversion rate is ≥80% of the mean → consent impact pattern
    if (ov.signal_completion_score >= 0.5) continue;
    if (meanConvRate === 0 || ov.conversion_rate < meanConvRate * 0.8) continue;

    const alreadyExists = await isDuplicate(
      userId,
      websiteUrl,
      ov.channel,
      'consent_impact',
    );
    if (alreadyExists) continue;

    await insertDiagnostic(userId, websiteUrl, {
      channel: ov.channel,
      diagnostic_type: 'consent_impact',
      severity: 'warning',
      title: `Consent may be suppressing signals on ${label(ov.channel)}`,
      description:
        `${label(ov.channel)} has a low signal completion score ` +
        `(${pct(ov.signal_completion_score)}%) but a normal conversion rate ` +
        `(${pct(ov.conversion_rate)}%). This pattern suggests users are converting ` +
        `but consent settings are blocking some tracking events — leading to ` +
        `under-reported attribution for this channel.`,
      affected_pages: [],
      estimated_impact:
        `Up to ${pct(1 - ov.signal_completion_score)}% of signals may be missing ` +
        `across ${ov.total_sessions.toLocaleString()} sessions`,
      recommended_action:
        'Check consent category configuration in Atlas Consent Hub. Ensure analytics ' +
        'and marketing consent categories are correctly mapped to WalkerOS events. ' +
        'Review Google Consent Mode v2 signal output for this traffic source.',
      is_resolved: false,
    });

    log(userId, websiteUrl, ov.channel, 'consent_impact');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isDuplicate(
  userId: string,
  websiteUrl: string,
  channel: ChannelType,
  type: DiagnosticType,
): Promise<boolean> {
  const count = await getRecentDiagnosticCount(userId, websiteUrl, channel, type, 7);
  return count > 0;
}

function label(channel: string): string {
  return channel
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pct(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

function log(
  userId: string,
  websiteUrl: string,
  channel: string,
  type: DiagnosticType,
): void {
  logger.info({ userId, websiteUrl, channel, type }, 'Channel diagnostic created');
}
