import { supabaseAdmin } from '@/services/database/supabase';
import { writeFinding } from './findingWriter';
import { buildNarrative, buildRemediation } from '../codes/findingCodes';
import logger from '@/utils/logger';

interface Objective {
  id: string;
  name: string;
  platforms: string[];
  recommended_primary_event: string | null;
  current_event: string | null;
}

interface StatsRow {
  connection_id: string;
  event_name: string;
  platform_count: number;
  quality_signals: Record<string, number> | null;
}

interface Connection {
  id: string;
  platform: string;
  client_id: string;
}

export async function runDeliveryDiff(
  runId: string,
  clientId: string,
  briefId: string | null,
  orgId: string,
): Promise<void> {
  if (!briefId) return;

  // Load locked objectives
  const { data: objectives } = await supabaseAdmin
    .from('strategy_objectives')
    .select('id, name, platforms, recommended_primary_event, current_event')
    .eq('brief_id', briefId)
    .eq('locked', true) as unknown as { data: Objective[] | null };

  if (!objectives?.length) return;

  // Load active connections for this client
  const { data: connections } = await supabaseAdmin
    .from('platform_connections')
    .select('id, platform, client_id')
    .eq('client_id', clientId)
    .eq('status', 'active') as unknown as { data: Connection[] | null };

  if (!connections?.length) return;

  const connectionIds = connections.map((c) => c.id);

  // Aggregate last-7-days stats by (platform, event_name)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: statsRows } = await supabaseAdmin
    .from('platform_event_stats_daily')
    .select('connection_id, event_name, platform_count, quality_signals')
    .in('connection_id', connectionIds)
    .gte('date', sevenDaysAgo) as unknown as { data: StatsRow[] | null };

  if (!statsRows?.length) {
    // No stats data yet — skip delivery diff silently (common on first post-lock run)
    logger.info({ runId, clientId }, 'No stats data available yet; skipping delivery diff');
    return;
  }

  // Build lookup: platform → event_name → { total_count, dedup_rates[] }
  const connPlatform = new Map(connections.map((c) => [c.id, c.platform]));
  type EventStats = { count: number; dedupRates: number[]; emqScores: number[] };
  const statsByPlatformEvent = new Map<string, EventStats>();

  for (const row of statsRows) {
    const platform = connPlatform.get(row.connection_id) ?? '';
    const key = `${platform}::${row.event_name}`;
    const existing = statsByPlatformEvent.get(key) ?? { count: 0, dedupRates: [], emqScores: [] };
    existing.count += row.platform_count;
    if (row.quality_signals?.dedup_rate != null) existing.dedupRates.push(row.quality_signals.dedup_rate);
    if (row.quality_signals?.event_match_score != null) existing.emqScores.push(row.quality_signals.event_match_score);
    statsByPlatformEvent.set(key, existing);
  }

  // Load default dedup threshold from tolerance configs (or use default 0.70)
  const { data: toleranceRows } = await supabaseAdmin
    .from('reconciliation_tolerance_configs')
    .select('dedup_warn_threshold, event_name, platform')
    .eq('client_id', clientId)
    .eq('enabled', true) as unknown as { data: { dedup_warn_threshold: number; event_name: string | null; platform: string | null }[] | null };

  function getDedupThreshold(eventName: string, platform: string): number {
    const match = (toleranceRows ?? []).find(
      (t) => (t.event_name === eventName || t.event_name === null) && (t.platform === platform || t.platform === null),
    );
    return match?.dedup_warn_threshold ?? 0.70;
  }

  for (const obj of objectives) {
    const eventName = obj.recommended_primary_event ?? obj.current_event;
    if (!eventName) continue;

    for (const platform of obj.platforms) {
      const key = `${platform}::${eventName}`;
      const stats = statsByPlatformEvent.get(key);

      // EVENT_NOT_RECEIVED: event expected but 0 or no counts in last 7 days
      if (!stats || stats.count === 0) {
        await writeFinding({
          runId,
          organizationId: orgId,
          clientId,
          briefId,
          objectiveId: obj.id,
          platform,
          dimension: 'delivery',
          severity: 'error',
          findingCode: 'EVENT_NOT_RECEIVED',
          expected: { event_name: eventName, min_count: 1 },
          observed: { platform_count: 0, window_days: 7 },
          narrative: buildNarrative('EVENT_NOT_RECEIVED', { event_name: eventName, platform }),
          remediationHint: buildRemediation('EVENT_NOT_RECEIVED', {}),
        });
        continue;
      }

      // CAPI_DEDUP_LOW: Meta only, when dedup_rate data exists
      if (platform === 'meta' && stats.dedupRates.length > 0) {
        const avgDedupRate = stats.dedupRates.reduce((a, b) => a + b, 0) / stats.dedupRates.length;
        const threshold = getDedupThreshold(eventName, platform);
        if (avgDedupRate < threshold) {
          await writeFinding({
            runId,
            organizationId: orgId,
            clientId,
            briefId,
            objectiveId: obj.id,
            platform,
            dimension: 'delivery',
            severity: 'warning',
            findingCode: 'CAPI_DEDUP_LOW',
            expected: { dedup_rate_min: threshold },
            observed: { dedup_rate: Math.round(avgDedupRate * 1000) / 1000 },
            narrative: buildNarrative('CAPI_DEDUP_LOW', {
              event_name: eventName,
              dedup_rate: (Math.round(avgDedupRate * 1000) / 10).toString(),
            }),
            remediationHint: buildRemediation('CAPI_DEDUP_LOW', {}),
          });
        }
      }
    }
  }
}
