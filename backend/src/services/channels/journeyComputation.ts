/**
 * Channel Signal Behaviour — Journey Computation (Phase 2)
 *
 * Aggregates channel_sessions + channel_session_events into journey maps
 * stored in channel_journey_maps. Called by the channelQueue worker.
 *
 * Phase 1 ships a stub. Full implementation in Phase 2.
 */

import {
  getChannelOverviews,
  getDistinctChannelSites,
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
  const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  for (const overview of overviews) {
    // Phase 1 stub: persist a skeleton journey map with no steps.
    // Phase 2 will query channel_session_events to build real step arrays.
    const steps: JourneyStep[] = buildStubSteps(overview.channel);

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
      { userId, websiteUrl, channel: overview.channel },
      'Journey map computed (Phase 1 stub)',
    );
  }
}

/**
 * Returns placeholder steps so the frontend can render an indicative flow
 * before Phase 2 provides real event-level data.
 */
function buildStubSteps(channel: string): JourneyStep[] {
  return [
    {
      step_number: 1,
      type: 'page_view',
      identifier: 'Landing Page',
      session_count: 0,
      percentage: 100,
      drop_off_rate: 0,
      signal_health: 'mixed',
      signal_health_detail: 'Computed in Phase 2',
    },
  ];
}
