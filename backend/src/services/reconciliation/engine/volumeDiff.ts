import { supabaseAdmin } from '@/services/database/supabase';
import { writeFinding } from './findingWriter';
import { buildNarrative, buildRemediation } from '../codes/findingCodes';
import logger from '@/utils/logger';

interface StatsRow {
  connection_id: string;
  date: string;
  event_name: string;
  platform_count: number;
  atlas_count: number | null;
  delta_pct: number | null;
}

interface ToleranceRow {
  event_name: string | null;
  platform: string | null;
  volume_tolerance_pct: number;
  enabled: boolean;
}

interface Connection {
  id: string;
  platform: string;
}

export async function runVolumeDiff(
  runId: string,
  clientId: string,
  briefId: string | null,
  orgId: string,
): Promise<void> {
  // Load active connections for this client
  const { data: connections } = await supabaseAdmin
    .from('platform_connections')
    .select('id, platform')
    .eq('client_id', clientId)
    .eq('status', 'active') as unknown as { data: Connection[] | null };

  if (!connections?.length) return;

  const connectionIds = connections.map((c) => c.id);
  const connPlatform = new Map(connections.map((c) => [c.id, c.platform]));

  // Load stats rows where atlas_count is populated (CAPI-backed data only)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: statsRows } = await supabaseAdmin
    .from('platform_event_stats_daily')
    .select('connection_id, date, event_name, platform_count, atlas_count, delta_pct')
    .in('connection_id', connectionIds)
    .gte('date', sevenDaysAgo)
    .not('atlas_count', 'is', null) as unknown as { data: StatsRow[] | null };

  if (!statsRows?.length) {
    logger.info({ runId, clientId }, 'No CAPI-backed stats data; skipping volume diff');
    return;
  }

  // Load tolerance configs (most specific match: event+platform > event-only > client-wide)
  const { data: toleranceRows } = await supabaseAdmin
    .from('reconciliation_tolerance_configs')
    .select('event_name, platform, volume_tolerance_pct, enabled')
    .eq('client_id', clientId)
    .eq('enabled', true) as unknown as { data: ToleranceRow[] | null };

  const DEFAULT_TOLERANCE = 20.0;

  function getTolerance(eventName: string, platform: string): number {
    const configs = (toleranceRows ?? []).filter((t) => t.enabled);
    // Most specific: event+platform match
    const exact = configs.find((t) => t.event_name === eventName && t.platform === platform);
    if (exact) return exact.volume_tolerance_pct;
    // Event-only
    const eventOnly = configs.find((t) => t.event_name === eventName && t.platform === null);
    if (eventOnly) return eventOnly.volume_tolerance_pct;
    // Platform-only
    const platformOnly = configs.find((t) => t.event_name === null && t.platform === platform);
    if (platformOnly) return platformOnly.volume_tolerance_pct;
    // Client-wide default
    const clientWide = configs.find((t) => t.event_name === null && t.platform === null);
    return clientWide?.volume_tolerance_pct ?? DEFAULT_TOLERANCE;
  }

  for (const row of statsRows) {
    if (row.delta_pct === null || row.atlas_count === null) continue;

    const platform = connPlatform.get(row.connection_id) ?? 'unknown';
    const absDelta = Math.abs(row.delta_pct);
    const tolerance = getTolerance(row.event_name, platform);

    if (absDelta <= tolerance) continue;

    // Severity: error if delta > 2× tolerance, else warning
    const severity = absDelta > tolerance * 2 ? 'error' : 'warning';

    await writeFinding({
      runId,
      orgId,
      clientId,
      briefId,
      objectiveId: null,
      platform,
      dimension: 'volume',
      severity,
      findingCode: 'VOLUME_DELTA_EXCEEDED',
      expected: { atlas_count: row.atlas_count, tolerance_pct: tolerance },
      observed: { platform_count: row.platform_count, delta_pct: row.delta_pct },
      narrative: buildNarrative('VOLUME_DELTA_EXCEEDED', {
        event_name: row.event_name,
        event_date: row.date,
        observed_count: row.platform_count.toString(),
        expected_count: row.atlas_count.toString(),
        delta_pct: Math.round(row.delta_pct).toString(),
        tolerance_pct: tolerance.toString(),
      }),
      remediationHint: buildRemediation('VOLUME_DELTA_EXCEEDED', {}),
    });
  }
}
