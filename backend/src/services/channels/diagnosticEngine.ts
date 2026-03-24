/**
 * Channel Signal Behaviour — Diagnostic Engine (Phase 3)
 *
 * Correlates drop-off points with signal health gaps to produce
 * actionable diagnostics stored in channel_diagnostics.
 *
 * Phase 1 ships a stub. Full implementation in Phase 3.
 */

import {
  getChannelOverviews,
  getDistinctChannelSites,
  insertDiagnostic,
} from '@/services/database/channelQueries';
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

  for (const overview of overviews) {
    // Phase 3 stub: emit a signal_gap diagnostic for any channel with a
    // critical health status so the diagnostics tab shows real data once ingestion starts.
    if (overview.health_status === 'critical') {
      const diagnostic = {
        channel: overview.channel as ChannelType,
        diagnostic_type: 'signal_gap' as DiagnosticType,
        severity: 'critical' as Severity,
        title: `Signal gaps detected on ${formatChannelLabel(overview.channel)}`,
        description:
          `${formatChannelLabel(overview.channel)} sessions have a low average signal completion score ` +
          `(${(overview.signal_completion_score * 100).toFixed(0)}%). ` +
          `Missing signals reduce conversion attribution accuracy.`,
        affected_pages: [],
        estimated_impact: `${overview.total_sessions} sessions affected`,
        recommended_action:
          'Review WalkerOS event firing on pages where this channel lands. ' +
          'Ensure all required events are present and parameters are complete.',
        is_resolved: false,
      };

      await insertDiagnostic(userId, websiteUrl, diagnostic);

      logger.info(
        { userId, websiteUrl, channel: overview.channel },
        'Channel diagnostic created (Phase 1 stub)',
      );
    }
  }
}

function formatChannelLabel(channel: string): string {
  return channel
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
