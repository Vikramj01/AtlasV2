import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

// ── Cursor encoding ───────────────────────────────────────────────────────────

interface CursorPayload {
  at: string; // processed_at ISO string
  id: string; // UUID tiebreaker
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id })).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as unknown;
    if (
      raw !== null &&
      typeof raw === 'object' &&
      'at' in raw && typeof (raw as Record<string, unknown>).at === 'string' &&
      'id' in raw && typeof (raw as Record<string, unknown>).id === 'string'
    ) {
      return raw as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignalEventRow {
  id: string;
  event_id: string | null;
  atlas_event_id: string;
  event_name: string;
  destination: string;
  status: string;
  dedup_status: string | null;
  dedup_key: string | null;
  dedup_matched_at: string | null;
  match_quality_score: number | null;
  latency_ms: number | null;
  processed_at: string;
  delivered_at: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_config_id: string;
}

export interface SignalEventDetail extends SignalEventRow {
  payload: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  consent_state: Record<string, unknown>;
  related_signals: SignalEventRow[];
}

export interface ListSignalEventsParams {
  organization_id: string;
  from: string;
  to: string;
  destinations?: string[];
  event_names?: string[];
  statuses?: string[];
  dedup_statuses?: string[];
  cursor?: string;
  limit: number;
}

export interface AggregateCardsResult {
  total_signals: number;
  avg_match_quality: number | null;
  dedup_hit_rate: number | null;
  avg_latency_ms: number | null;
  sparkline: Array<{ day: string; signal_count: number }>;
  prev_avg_match_quality: number | null;
  prev_dedup_hit_rate: number | null;
  prev_avg_latency_ms: number | null;
  p95_latency_ms: number | null;
}

export interface ExportJobFilters {
  from: string;
  to: string;
  destinations?: string[];
  event_names?: string[];
  statuses?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolves provider_config_ids for a given org + destination filter.
// Returns null when destinations is empty/undefined (meaning "all").
// Returns empty array when destinations are specified but none match.
async function resolveProviderIds(
  organization_id: string,
  destinations: string[] | undefined,
): Promise<string[] | null> {
  if (!destinations?.length) return null;

  const { data, error } = await supabaseAdmin
    .from('capi_providers')
    .select('id')
    .eq('organization_id', organization_id)
    .in('provider', destinations);

  if (error) throw new Error(`Failed to resolve provider IDs: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

function mapRow(raw: Record<string, unknown>): SignalEventRow {
  const provider = raw['capi_providers'] as { provider: string } | null;
  return {
    id:                  raw['id'] as string,
    event_id:            raw['event_id'] as string | null,
    atlas_event_id:      raw['atlas_event_id'] as string,
    event_name:          raw['provider_event_name'] as string,
    destination:         provider?.provider ?? 'unknown',
    status:              raw['status'] as string,
    dedup_status:        raw['dedup_status'] as string | null,
    dedup_key:           raw['dedup_key'] as string | null,
    dedup_matched_at:    raw['dedup_matched_at'] as string | null,
    match_quality_score: raw['match_quality_score'] as number | null,
    latency_ms:          raw['latency_ms'] as number | null,
    processed_at:        raw['processed_at'] as string,
    delivered_at:        raw['delivered_at'] as string | null,
    error_code:          raw['error_code'] as string | null,
    error_message:       raw['error_message'] as string | null,
    provider_config_id:  raw['provider_config_id'] as string,
  };
}

// ── listSignalEvents ──────────────────────────────────────────────────────────

export async function listSignalEvents(params: ListSignalEventsParams): Promise<{
  rows: SignalEventRow[];
  next_cursor: string | null;
}> {
  const {
    organization_id, from, to,
    destinations, event_names, statuses, dedup_statuses,
    cursor, limit,
  } = params;

  const providerIds = await resolveProviderIds(organization_id, destinations);
  if (providerIds !== null && providerIds.length === 0) {
    return { rows: [], next_cursor: null };
  }

  let query = supabaseAdmin
    .from('capi_events')
    .select(`
      id,
      event_id,
      atlas_event_id,
      provider_event_name,
      status,
      dedup_status,
      dedup_key,
      dedup_matched_at,
      match_quality_score,
      latency_ms,
      processed_at,
      delivered_at,
      error_code,
      error_message,
      provider_config_id,
      capi_providers!inner(provider)
    `)
    .eq('organization_id', organization_id)
    .gte('processed_at', from)
    .lte('processed_at', to)
    .order('processed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (providerIds !== null) {
    query = query.in('provider_config_id', providerIds);
  }
  if (event_names?.length) {
    query = query.in('provider_event_name', event_names);
  }
  if (statuses?.length) {
    query = query.in('status', statuses);
  }
  if (dedup_statuses?.length) {
    query = query.in('dedup_status', dedup_statuses);
  }

  // Cursor: events strictly before (processed_at, id) in descending order
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      query = query.or(
        `processed_at.lt.${decoded.at},and(processed_at.eq.${decoded.at},id.lt.${decoded.id})`,
      );
    }
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list signal events: ${error.message}`);
  }

  const raw = (data ?? []) as Record<string, unknown>[];
  const hasMore = raw.length > limit;
  const rows = raw.slice(0, limit).map(mapRow);

  const next_cursor = hasMore && rows.length > 0
    ? encodeCursor(rows[rows.length - 1].processed_at, rows[rows.length - 1].id)
    : null;

  return { rows, next_cursor };
}

// ── getSignalEventDetail ──────────────────────────────────────────────────────

export async function getSignalEventDetail(
  organization_id: string,
  event_id: string,
): Promise<SignalEventDetail | null> {
  // Query by atlas_event_id OR the dedup-migration event_id column, scoped to org.
  // Returns null for both missing and wrong-org events to avoid existence leaking.
  const { data: rows, error } = await supabaseAdmin
    .from('capi_events')
    .select(`
      id,
      event_id,
      atlas_event_id,
      provider_event_name,
      status,
      dedup_status,
      dedup_key,
      dedup_matched_at,
      match_quality_score,
      latency_ms,
      processed_at,
      delivered_at,
      error_code,
      error_message,
      provider_config_id,
      payload,
      provider_response,
      consent_state,
      capi_providers!inner(provider)
    `)
    .eq('organization_id', organization_id)
    .or(`atlas_event_id.eq.${event_id},event_id.eq.${event_id}`)
    .limit(1);

  if (error) {
    throw new Error(`Failed to fetch signal event: ${error.message}`);
  }

  if (!rows || rows.length === 0) return null;

  const raw = rows[0] as Record<string, unknown>;
  const base = mapRow(raw);

  // Fetch related signals (same dedup_key, up to 10, excluding this event)
  let related_signals: SignalEventRow[] = [];
  const dedupKey = base.dedup_key;
  if (dedupKey) {
    const { data: relatedRaw, error: relErr } = await supabaseAdmin
      .from('capi_events')
      .select(`
        id, event_id, atlas_event_id, provider_event_name, status,
        dedup_status, dedup_key, dedup_matched_at, match_quality_score,
        latency_ms, processed_at, delivered_at, error_code, error_message,
        provider_config_id, capi_providers!inner(provider)
      `)
      .eq('organization_id', organization_id)
      .eq('dedup_key', dedupKey)
      .neq('id', base.id)
      .order('processed_at', { ascending: false })
      .limit(10);

    if (relErr) {
      logger.warn({ err: relErr.message, dedup_key: dedupKey }, 'Failed to fetch related signals');
    } else {
      related_signals = ((relatedRaw ?? []) as Record<string, unknown>[]).map(mapRow);
    }
  }

  return {
    ...base,
    payload:        (raw['payload'] as Record<string, unknown> | null) ?? null,
    response:       (raw['provider_response'] as Record<string, unknown> | null) ?? null,
    consent_state:  (raw['consent_state'] as Record<string, unknown>) ?? {},
    related_signals,
  };
}

// ── getSignalAggregates ───────────────────────────────────────────────────────

export async function getSignalAggregates(
  organization_id: string,
  from: string,
  to: string,
  destinations?: string[],
): Promise<AggregateCardsResult> {
  // Build date range for the current window and an equal-length previous window
  const fromDate = new Date(from);
  const toDate   = new Date(to);
  const rangeMs  = toDate.getTime() - fromDate.getTime();
  const prevTo   = from;
  const prevFrom = new Date(fromDate.getTime() - rangeMs).toISOString();

  async function fetchAggregates(f: string, t: string) {
    let query = supabaseAdmin
      .from('mv_signal_aggregates_daily')
      .select('signal_count, success_count, failure_count, dedup_hit_count, avg_match_quality, avg_latency_ms, p95_latency_ms, day')
      .eq('organization_id', organization_id)
      .gte('day', f)
      .lte('day', t);

    if (destinations?.length) {
      query = query.in('destination', destinations);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch aggregates: ${error.message}`);
    return (data ?? []) as Array<Record<string, unknown>>;
  }

  const [current, previous] = await Promise.all([
    fetchAggregates(from, to),
    fetchAggregates(prevFrom, prevTo),
  ]);

  function rollup(rows: Array<Record<string, unknown>>) {
    let totalSignals = 0;
    let dedupHits = 0;
    let weightedQuality = 0;
    let weightedLatency = 0;
    let p95 = 0;

    for (const row of rows) {
      const count    = (row['signal_count'] as number) ?? 0;
      const dedupHit = (row['dedup_hit_count'] as number) ?? 0;
      const quality  = (row['avg_match_quality'] as number | null) ?? null;
      const latency  = (row['avg_latency_ms'] as number | null) ?? null;
      const rowP95   = (row['p95_latency_ms'] as number | null) ?? 0;

      totalSignals += count;
      dedupHits    += dedupHit;
      if (quality !== null)  weightedQuality  += quality  * count;
      if (latency !== null)  weightedLatency  += latency  * count;
      if (rowP95 > p95)      p95 = rowP95;
    }

    return {
      total_signals:     totalSignals,
      avg_match_quality: totalSignals > 0 ? weightedQuality / totalSignals : null,
      dedup_hit_rate:    totalSignals > 0 ? (dedupHits / totalSignals) * 100 : null,
      avg_latency_ms:    totalSignals > 0 ? weightedLatency / totalSignals : null,
      p95_latency_ms:    p95 > 0 ? p95 : null,
    };
  }

  const curr = rollup(current);
  const prev = rollup(previous);

  // Sparkline: last 7 days aggregated by day
  const sparkline = current
    .filter((r) => {
      const day = new Date(r['day'] as string);
      const cutoff = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      return day >= cutoff;
    })
    .reduce<Map<string, number>>((acc, r) => {
      const day   = (r['day'] as string).slice(0, 10);
      const count = (r['signal_count'] as number) ?? 0;
      acc.set(day, (acc.get(day) ?? 0) + count);
      return acc;
    }, new Map());

  return {
    total_signals:          curr.total_signals,
    avg_match_quality:      curr.avg_match_quality,
    dedup_hit_rate:         curr.dedup_hit_rate,
    avg_latency_ms:         curr.avg_latency_ms,
    p95_latency_ms:         curr.p95_latency_ms,
    prev_avg_match_quality: prev.avg_match_quality,
    prev_dedup_hit_rate:    prev.dedup_hit_rate,
    prev_avg_latency_ms:    prev.avg_latency_ms,
    sparkline: Array.from(sparkline.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, signal_count]) => ({ day, signal_count })),
  };
}

// ── createExportJob ───────────────────────────────────────────────────────────

export async function createExportJob(
  organization_id: string,
  filters: ExportJobFilters,
  row_estimate: number,
): Promise<{ id: string }> {
  const { data, error } = await supabaseAdmin
    .from('signal_export_jobs')
    .insert({ organization_id, filters, row_estimate, status: 'pending' })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create export job: ${error?.message ?? 'unknown'}`);
  }

  return { id: data.id as string };
}

// ── getExportJob ──────────────────────────────────────────────────────────────

export async function getExportJob(
  organization_id: string,
  job_id: string,
): Promise<{
  id: string;
  status: string;
  download_url: string | null;
  expires_at: string | null;
  error_message: string | null;
  created_at: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('signal_export_jobs')
    .select('id, status, download_url, expires_at, error_message, created_at')
    .eq('id', job_id)
    .eq('organization_id', organization_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch export job: ${error.message}`);
  if (!data) return null;

  return {
    id:            data.id as string,
    status:        data.status as string,
    download_url:  data.download_url as string | null,
    expires_at:    data.expires_at as string | null,
    error_message: data.error_message as string | null,
    created_at:    data.created_at as string,
  };
}

// ── countSignalEvents ─────────────────────────────────────────────────────────
// Pre-flight count used for the 100k row export guard.

export async function countSignalEvents(
  organization_id: string,
  filters: ExportJobFilters,
): Promise<number> {
  const providerIds = await resolveProviderIds(organization_id, filters.destinations);
  if (providerIds !== null && providerIds.length === 0) return 0;

  let query = supabaseAdmin
    .from('capi_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organization_id)
    .gte('processed_at', filters.from)
    .lte('processed_at', filters.to);

  if (providerIds !== null) query = query.in('provider_config_id', providerIds);
  if (filters.event_names?.length) query = query.in('provider_event_name', filters.event_names);
  if (filters.statuses?.length)    query = query.in('status', filters.statuses);

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count signal events: ${error.message}`);
  return count ?? 0;
}
