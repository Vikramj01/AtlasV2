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

const GA4_DIVERGENCE_THRESHOLD = 25; // percent

export async function runVolumeDiff(
  runId: string,
  clientId: string,
  briefId: string | null,
  orgId: string,
): Promise<void> {
  const { data: connections } = await supabaseAdmin
    .from('platform_connections')
    .select('id, platform')
    .eq('client_id', clientId)
    .eq('status', 'active') as unknown as { data: Connection[] | null };

  if (!connections?.length) return;

  const connectionIds = connections.map((c) => c.id);
  const connPlatform = new Map(connections.map((c) => [c.id, c.platform]));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: statsRows } = await supabaseAdmin
    .from('platform_event_stats_daily')
    .select('connection_id, date, event_name, platform_count, atlas_count, delta_pct')
    .in('connection_id', connectionIds)
    .gte('date', sevenDaysAgo) as unknown as { data: StatsRow[] | null };

  if (!statsRows?.length) {
    logger.info({ runId, clientId }, 'No stats data; skipping volume diff');
    return;
  }

  const { data: toleranceRows } = await supabaseAdmin
    .from('reconciliation_tolerance_configs')
    .select('event_name, platform, volume_tolerance_pct, enabled')
    .eq('client_id', clientId)
    .eq('enabled', true) as unknown as { data: ToleranceRow[] | null };

  const DEFAULT_TOLERANCE = 20.0;

  function getTolerance(eventName: string, platform: string): number {
    const configs = (toleranceRows ?? []).filter((t) => t.enabled);
    const exact = configs.find((t) => t.event_name === eventName && t.platform === platform);
    if (exact) return exact.volume_tolerance_pct;
    const eventOnly = configs.find((t) => t.event_name === eventName && t.platform === null);
    if (eventOnly) return eventOnly.volume_tolerance_pct;
    const platformOnly = configs.find((t) => t.event_name === null && t.platform === platform);
    if (platformOnly) return platformOnly.volume_tolerance_pct;
    const clientWide = configs.find((t) => t.event_name === null && t.platform === null);
    return clientWide?.volume_tolerance_pct ?? DEFAULT_TOLERANCE;
  }

  // ── VOLUME_DELTA_EXCEEDED — atlas vs platform divergence ──────────────────
  for (const row of statsRows) {
    if (row.delta_pct === null || row.atlas_count === null) continue;

    const platform = connPlatform.get(row.connection_id) ?? 'unknown';
    if (platform === 'ga4') continue; // GA4 handled separately below

    const absDelta = Math.abs(row.delta_pct);
    const tolerance = getTolerance(row.event_name, platform);
    if (absDelta <= tolerance) continue;

    const severity = absDelta > tolerance * 2 ? 'error' : 'warning';

    await writeFinding({
      runId, orgId, clientId, briefId, objectiveId: null,
      platform, dimension: 'volume', severity,
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

  // ── GA4_VOLUME_DIVERGENCE — GA4 vs primary platform divergence ────────────
  // Group counts by (event_name, date) per platform, then compare GA4 vs others
  type DayKey = string; // `${event_name}::${date}`
  const byKey = new Map<DayKey, { ga4: number | null; primary: number | null; primaryPlatform: string }>();

  for (const row of statsRows) {
    const platform = connPlatform.get(row.connection_id) ?? 'unknown';
    const key: DayKey = `${row.event_name}::${row.date}`;
    const existing = byKey.get(key) ?? { ga4: null, primary: null, primaryPlatform: '' };

    if (platform === 'ga4') {
      existing.ga4 = (existing.ga4 ?? 0) + row.platform_count;
    } else {
      // Use google_ads preferentially over meta as "primary"
      if (existing.primary === null || platform === 'google_ads') {
        existing.primary = row.platform_count;
        existing.primaryPlatform = platform;
      }
    }
    byKey.set(key, existing);
  }

  for (const [key, counts] of byKey) {
    if (counts.ga4 === null || counts.primary === null || counts.primary === 0) continue;

    const [eventName, date] = key.split('::');
    const deltaPct = ((counts.ga4 - counts.primary) / counts.primary) * 100;

    if (Math.abs(deltaPct) <= GA4_DIVERGENCE_THRESHOLD) continue;

    await writeFinding({
      runId, orgId, clientId, briefId, objectiveId: null,
      platform: 'ga4', dimension: 'volume', severity: 'info',
      findingCode: 'GA4_VOLUME_DIVERGENCE',
      expected: { platform_count: counts.primary, platform: counts.primaryPlatform },
      observed: { ga4_count: counts.ga4, delta_pct: Math.round(deltaPct * 100) / 100 },
      narrative: buildNarrative('GA4_VOLUME_DIVERGENCE', {
        event_name: eventName,
        event_date: date,
        ga4_count: counts.ga4.toString(),
        platform_count: counts.primary.toString(),
        platform: counts.primaryPlatform,
        delta_pct: Math.round(deltaPct).toString(),
      }),
      remediationHint: buildRemediation('GA4_VOLUME_DIVERGENCE', {}),
    });
  }
}

