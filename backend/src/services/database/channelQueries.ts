/**
 * Channel Signal Behaviour — Database query layer.
 *
 * Tables: channel_sessions, channel_session_events,
 *         channel_journey_maps, channel_diagnostics
 */

import { supabaseAdmin } from './supabase';
import type {
  ChannelOverview,
  ChannelJourneyMap,
  ChannelDiagnostic,
  ChannelType,
  DiagnosticType,
  JourneyStep,
} from '@/types/channel';

// ── channel_sessions ──────────────────────────────────────────────────────────

export async function upsertChannelSession(
  userId: string,
  data: {
    session_ext_id: string;
    website_url: string;
    channel: ChannelType;
    source?: string;
    medium?: string;
    campaign?: string;
    device_type?: string;
    browser?: string;
    landing_page: string;
    started_at: string;
    event_count: number;
    page_count: number;
    conversion_reached: boolean;
    signal_completion_score?: number;
  },
): Promise<string> {
  const { data: row, error } = await supabaseAdmin
    .from('channel_sessions')
    .upsert(
      {
        user_id: userId,
        ...data,
      },
      { onConflict: 'user_id,website_url,session_ext_id' },
    )
    .select('id')
    .single();

  if (error) throw error;
  return (row as { id: string }).id;
}

export async function insertSessionEvents(
  sessionId: string,
  events: Array<{
    event_name: string;
    event_category: string;
    page_url?: string;
    event_params?: Record<string, unknown>;
    signal_health_status?: string;
    seq: number;
    fired_at: string;
  }>,
): Promise<void> {
  if (events.length === 0) return;

  const rows = events.map((e) => ({ session_id: sessionId, ...e }));
  const { error } = await supabaseAdmin.from('channel_session_events').insert(rows);
  if (error) throw error;
}

// ── channel overview (aggregation) ───────────────────────────────────────────

/**
 * Returns per-channel summary stats for the given user + optional site filter.
 * Aggregates from channel_sessions; no journey maps required.
 */
export async function getChannelOverviews(
  userId: string,
  websiteUrl?: string,
  days = 30,
): Promise<ChannelOverview[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabaseAdmin
    .from('channel_sessions')
    .select('channel, conversion_reached, event_count, page_count, signal_completion_score')
    .eq('user_id', userId)
    .gte('started_at', since);

  if (websiteUrl) {
    query = query.eq('website_url', websiteUrl);
  }

  const { data, error } = await query;
  if (error) throw error;

  type SessionRow = {
    channel: string;
    conversion_reached: boolean;
    event_count: number;
    page_count: number;
    signal_completion_score: number | null;
  };

  const rows = (data ?? []) as SessionRow[];

  // Group and aggregate in application code
  const byChannel = new Map<
    string,
    {
      total: number;
      conversions: number;
      total_events: number;
      total_pages: number;
      total_scs: number;
      scs_count: number;
    }
  >();

  for (const row of rows) {
    const ch = row.channel;
    const existing = byChannel.get(ch) ?? {
      total: 0,
      conversions: 0,
      total_events: 0,
      total_pages: 0,
      total_scs: 0,
      scs_count: 0,
    };
    existing.total += 1;
    if (row.conversion_reached) existing.conversions += 1;
    existing.total_events += row.event_count;
    existing.total_pages += row.page_count;
    if (row.signal_completion_score != null) {
      existing.total_scs += row.signal_completion_score;
      existing.scs_count += 1;
    }
    byChannel.set(ch, existing);
  }

  const result: ChannelOverview[] = [];
  for (const [channel, agg] of byChannel.entries()) {
    const convRate = agg.total > 0 ? agg.conversions / agg.total : 0;
    const avgScs = agg.scs_count > 0 ? agg.total_scs / agg.scs_count : 0;

    let health_status: 'healthy' | 'warning' | 'critical';
    if (avgScs >= 0.8) health_status = 'healthy';
    else if (avgScs >= 0.5) health_status = 'warning';
    else health_status = 'critical';

    result.push({
      channel: channel as ChannelType,
      total_sessions: agg.total,
      conversion_rate: convRate,
      signal_completion_score: avgScs,
      avg_pages_per_session: agg.total > 0 ? agg.total_pages / agg.total : 0,
      avg_events_per_session: agg.total > 0 ? agg.total_events / agg.total : 0,
      health_status,
    });
  }

  // Sort by total sessions desc
  return result.sort((a, b) => b.total_sessions - a.total_sessions);
}

export async function getDistinctChannelSites(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('channel_sessions')
    .select('website_url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return [];

  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<{ website_url: string }>) {
    if (row.website_url) seen.add(row.website_url);
  }
  return Array.from(seen);
}

// ── channel_journey_maps ──────────────────────────────────────────────────────

export async function upsertJourneyMap(
  userId: string,
  websiteUrl: string,
  channel: ChannelType,
  periodStart: string,
  periodEnd: string,
  stats: {
    total_sessions: number;
    conversion_rate: number;
    avg_pages_per_session: number;
    avg_events_per_session: number;
    signal_completion_score: number;
    journey_steps: JourneyStep[];
  },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('channel_journey_maps')
    .upsert(
      {
        user_id: userId,
        website_url: websiteUrl,
        channel,
        period_start: periodStart,
        period_end: periodEnd,
        ...stats,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,website_url,channel,period_start,period_end' },
    );

  if (error) throw error;
}

export async function getJourneyMaps(
  userId: string,
  websiteUrl?: string,
  days = 30,
): Promise<ChannelJourneyMap[]> {
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  let query = supabaseAdmin
    .from('channel_journey_maps')
    .select('*')
    .eq('user_id', userId)
    .gte('period_start', periodStart)
    .order('computed_at', { ascending: false });

  if (websiteUrl) {
    query = query.eq('website_url', websiteUrl);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ChannelJourneyMap[];
}

export async function getJourneyMapByChannel(
  userId: string,
  channel: ChannelType,
  websiteUrl?: string,
): Promise<ChannelJourneyMap | null> {
  let query = supabaseAdmin
    .from('channel_journey_maps')
    .select('*')
    .eq('user_id', userId)
    .eq('channel', channel)
    .order('computed_at', { ascending: false })
    .limit(1);

  if (websiteUrl) {
    query = query.eq('website_url', websiteUrl);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] ? (data[0] as unknown as ChannelJourneyMap) : null;
}

// ── channel_diagnostics ───────────────────────────────────────────────────────

export async function insertDiagnostic(
  userId: string,
  websiteUrl: string,
  diagnostic: Omit<ChannelDiagnostic, 'id' | 'created_at'>,
): Promise<void> {
  const { error } = await supabaseAdmin.from('channel_diagnostics').insert({
    user_id: userId,
    website_url: websiteUrl,
    ...diagnostic,
  });
  if (error) throw error;
}

export async function getActiveDiagnostics(
  userId: string,
  websiteUrl?: string,
): Promise<ChannelDiagnostic[]> {
  let query = supabaseAdmin
    .from('channel_diagnostics')
    .select('*')
    .eq('user_id', userId)
    .eq('is_resolved', false)
    .order('created_at', { ascending: false });

  if (websiteUrl) {
    query = query.eq('website_url', websiteUrl);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ChannelDiagnostic[];
}

export async function resolveDiagnostic(
  diagnosticId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('channel_diagnostics')
    .update({
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', diagnosticId)
    .eq('user_id', userId)
    .eq('is_resolved', false);

  return !error;
}

// ── Phase 2: event-level journey aggregation ──────────────────────────────────

/**
 * Returns session IDs + conversion status for a given channel + period.
 */
export async function getSessionsForChannel(
  userId: string,
  websiteUrl: string,
  channel: ChannelType,
  since: string,
): Promise<Array<{ id: string; conversion_reached: boolean; landing_page: string }>> {
  const { data, error } = await supabaseAdmin
    .from('channel_sessions')
    .select('id, conversion_reached, landing_page')
    .eq('user_id', userId)
    .eq('website_url', websiteUrl)
    .eq('channel', channel)
    .gte('started_at', since);

  if (error) throw error;
  return (data ?? []) as Array<{ id: string; conversion_reached: boolean; landing_page: string }>;
}

/**
 * Returns all events for the given session IDs, ordered by session + seq.
 */
export async function getEventsForSessions(
  sessionIds: string[],
): Promise<
  Array<{
    session_id: string;
    event_name: string;
    event_category: string;
    page_url: string | null;
    signal_health_status: string | null;
    seq: number;
  }>
> {
  if (sessionIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('channel_session_events')
    .select('session_id, event_name, event_category, page_url, signal_health_status, seq')
    .in('session_id', sessionIds)
    .order('seq', { ascending: true });

  if (error) throw error;
  return (data ?? []) as typeof data extends null ? never[] : NonNullable<typeof data>;
}

// ── Phase 3: diagnostic deduplication ────────────────────────────────────────

/**
 * Returns the count of unresolved diagnostics of the given type + channel
 * created in the last `days` days. Used to avoid re-inserting duplicate diagnostics.
 */
export async function getRecentDiagnosticCount(
  userId: string,
  websiteUrl: string,
  channel: ChannelType,
  diagnosticType: DiagnosticType,
  days = 7,
): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabaseAdmin
    .from('channel_diagnostics')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('website_url', websiteUrl)
    .eq('channel', channel)
    .eq('diagnostic_type', diagnosticType)
    .eq('is_resolved', false)
    .gte('created_at', since);

  if (error) return 0;
  return count ?? 0;
}
