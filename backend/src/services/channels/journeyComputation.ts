/**
 * Channel Signal Behaviour — Journey Computation (Phase 2)
 *
 * Aggregates channel_sessions + channel_session_events into journey maps
 * stored in channel_journey_maps. Called by the channelQueue worker.
 *
 * Funnel model (4 stages):
 *   1. Landing Page   — all sessions entering the channel
 *   2. Engagement     — sessions that fired ≥1 engagement event
 *   3. Micro-Conv     — sessions that fired ≥1 micro_conversion event
 *   4. Macro-Conv     — sessions that reached a macro_conversion (= conversion_reached)
 *
 * Signal health per step is derived from the signal_health_status field
 * on the underlying events for that category.
 */

import {
  getChannelOverviews,
  getDistinctChannelSites,
  getEventsForSessions,
  getSessionsForChannel,
  upsertJourneyMap,
} from '@/services/database/channelQueries';
import type { ChannelType, JourneyStep } from '@/types/channel';
import logger from '@/utils/logger';

export async function computeJourneysForUser(
  userId: string,
  websiteUrl?: string,
): Promise<void> {
  const sites = websiteUrl ? [websiteUrl] : await getDistinctChannelSites(userId);

  for (const site of sites) {
    await computeJourneysForSite(userId, site);
  }
}

async function computeJourneysForSite(userId: string, websiteUrl: string): Promise<void> {
  const overviews = await getChannelOverviews(userId, websiteUrl, 30);

  const periodEnd = new Date().toISOString().split('T')[0];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const periodStart = since.split('T')[0];

  for (const overview of overviews) {
    const { steps } = await buildJourneySteps(
      userId,
      websiteUrl,
      overview.channel as ChannelType,
      since,
    );

    await upsertJourneyMap(
      userId,
      websiteUrl,
      overview.channel as ChannelType,
      periodStart,
      periodEnd,
      {
        total_sessions: overview.total_sessions,
        conversion_rate: overview.conversion_rate,
        avg_pages_per_session: overview.avg_pages_per_session,
        avg_events_per_session: overview.avg_events_per_session,
        signal_completion_score: overview.signal_completion_score,
        journey_steps: steps,
      },
    );

    logger.info(
      { userId, websiteUrl, channel: overview.channel, steps: steps.length },
      'Journey map computed',
    );
  }
}

// ── Step building ─────────────────────────────────────────────────────────────

async function buildJourneySteps(
  userId: string,
  websiteUrl: string,
  channel: ChannelType,
  since: string,
): Promise<{ steps: JourneyStep[] }> {
  const sessions = await getSessionsForChannel(userId, websiteUrl, channel, since);
  const totalSessions = sessions.length;

  if (totalSessions === 0) {
    return { steps: [] };
  }

  const sessionIds = sessions.map((s) => s.id);
  const conversionSet = new Set(
    sessions.filter((s) => s.conversion_reached).map((s) => s.id),
  );

  const events = await getEventsForSessions(sessionIds);

  // Group events by session
  const eventsBySession = new Map<string, typeof events>();
  for (const ev of events) {
    const list = eventsBySession.get(ev.session_id) ?? [];
    list.push(ev);
    eventsBySession.set(ev.session_id, list);
  }

  // Count sessions reaching each funnel stage
  let engagementSessions = 0;
  let microConvSessions = 0;
  const macroConvSessions = conversionSet.size;

  // Signal health accumulators per stage
  // key: stage name → { healthy, degraded, missing, unknown }
  const healthBuckets: Record<string, Record<string, number>> = {
    landing: { healthy: 0, degraded: 0, missing: 0, unknown: 0 },
    engagement: { healthy: 0, degraded: 0, missing: 0, unknown: 0 },
    micro: { healthy: 0, degraded: 0, missing: 0, unknown: 0 },
    macro: { healthy: 0, degraded: 0, missing: 0, unknown: 0 },
  };

  for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
    let hasEngagement = false;
    let hasMicro = false;

    for (const ev of sessionEvents) {
      const healthKey = (ev.signal_health_status ?? 'unknown') as string;
      const validKey = ['healthy', 'degraded', 'missing'].includes(healthKey)
        ? healthKey
        : 'unknown';

      // Landing page events = page_view category
      if (ev.event_category === 'page_view') {
        healthBuckets.landing[validKey] += 1;
      } else if (ev.event_category === 'engagement') {
        hasEngagement = true;
        healthBuckets.engagement[validKey] += 1;
      } else if (ev.event_category === 'micro_conversion') {
        hasMicro = true;
        healthBuckets.micro[validKey] += 1;
      } else if (ev.event_category === 'macro_conversion') {
        healthBuckets.macro[validKey] += 1;
      }
    }

    if (hasEngagement) engagementSessions++;
    if (hasMicro) microConvSessions++;
  }

  const steps: JourneyStep[] = [];

  // Step 1 — Landing Page
  steps.push({
    step_number: 1,
    type: 'page_view',
    identifier: 'Landing Page',
    session_count: totalSessions,
    percentage: 100,
    drop_off_rate: totalSessions > 0
      ? Math.max(0, (totalSessions - engagementSessions) / totalSessions)
      : 0,
    signal_health: deriveSignalHealth(healthBuckets.landing),
    signal_health_detail: signalHealthDetail(healthBuckets.landing),
  });

  // Step 2 — Engagement (only if any sessions reached it)
  if (engagementSessions > 0) {
    steps.push({
      step_number: 2,
      type: 'event',
      identifier: 'Engagement',
      session_count: engagementSessions,
      percentage: totalSessions > 0 ? engagementSessions / totalSessions : 0,
      drop_off_rate: engagementSessions > 0
        ? Math.max(0, (engagementSessions - microConvSessions) / engagementSessions)
        : 0,
      signal_health: deriveSignalHealth(healthBuckets.engagement),
      signal_health_detail: signalHealthDetail(healthBuckets.engagement),
    });
  }

  // Step 3 — Micro-conversion (only if any sessions reached it)
  if (microConvSessions > 0) {
    steps.push({
      step_number: 3,
      type: 'event',
      identifier: 'Micro-Conversion',
      session_count: microConvSessions,
      percentage: totalSessions > 0 ? microConvSessions / totalSessions : 0,
      drop_off_rate: microConvSessions > 0
        ? Math.max(0, (microConvSessions - macroConvSessions) / microConvSessions)
        : 0,
      signal_health: deriveSignalHealth(healthBuckets.micro),
      signal_health_detail: signalHealthDetail(healthBuckets.micro),
    });
  }

  // Step 4 — Macro-conversion (always include if there are any conversions)
  if (macroConvSessions > 0) {
    steps.push({
      step_number: 4,
      type: 'event',
      identifier: 'Conversion',
      session_count: macroConvSessions,
      percentage: totalSessions > 0 ? macroConvSessions / totalSessions : 0,
      drop_off_rate: 0,
      signal_health: deriveSignalHealth(healthBuckets.macro),
      signal_health_detail: signalHealthDetail(healthBuckets.macro),
    });
  }

  return { steps };
}

// ── Signal health helpers ─────────────────────────────────────────────────────

function deriveSignalHealth(
  bucket: Record<string, number>,
): 'healthy' | 'degraded' | 'missing' | 'mixed' {
  const total = Object.values(bucket).reduce((sum, v) => sum + v, 0);
  if (total === 0) return 'mixed';

  const healthyFrac = (bucket.healthy ?? 0) / total;
  const missingFrac = (bucket.missing ?? 0) / total;

  if (healthyFrac >= 0.8) return 'healthy';
  if (missingFrac >= 0.5) return 'missing';
  if (healthyFrac >= 0.5) return 'degraded';
  return 'mixed';
}

function signalHealthDetail(bucket: Record<string, number>): string {
  const total = Object.values(bucket).reduce((sum, v) => sum + v, 0);
  if (total === 0) return 'No signal data';

  const healthyPct = Math.round(((bucket.healthy ?? 0) / total) * 100);
  const degradedPct = Math.round(((bucket.degraded ?? 0) / total) * 100);
  const missingPct = Math.round(((bucket.missing ?? 0) / total) * 100);

  const parts: string[] = [];
  if (healthyPct > 0) parts.push(`${healthyPct}% healthy`);
  if (degradedPct > 0) parts.push(`${degradedPct}% degraded`);
  if (missingPct > 0) parts.push(`${missingPct}% missing`);

  return parts.join(', ') || 'No signal data';
}
