/**
 * Meta Dataset Quality API polling — live, post-delivery Event Match Quality
 * (EMQ) feedback, fetched per connected Meta CAPI provider.
 *
 * Correction to both the external audit's guess (/{dataset_id}/event_stats)
 * and metaDelivery.ts's own prior code comment (/diagnostics): the real
 * endpoint is the Dataset Quality API —
 *   GET /v{version}/dataset_quality?dataset_id=<id>&fields=web{event_match_quality{diagnostics},event_name}
 * Verified via secondary sources — developers.facebook.com is network-blocked
 * in this sandbox, matching the DMA/refund-CSV precedent elsewhere in this
 * codebase. The precise event_match_quality response shape (a bare number vs.
 * a nested object, and its sub-field names) could not be confirmed from here,
 * so extractEmqScore()/extractDiagnostics() below parse defensively across a
 * few plausible shapes rather than assuming one. Re-verify against Meta's
 * primary docs before relying on this for a client-facing SLA.
 *
 * Kept deliberately separate from Atlas's own pre-flight Signal Enrichment
 * Score (enrichmentConfigService.ts) — one measures configuration
 * completeness before delivery, this measures Meta's own assessment of
 * actually-delivered traffic. Neither overwrites the other.
 */

import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from '@/services/capi/credentials';
import type { MetaCredentials } from '@/types/capi';
import logger from '@/utils/logger';

const META_API_VERSION = 'v19.0'; // matches the version pinned in metaDelivery.ts
const META_API_BASE = 'https://graph.facebook.com';

// Dataset Quality reflects a rolling aggregate over recent traffic — polling
// more often than DMA's own ~hourly cadence would add cost for no new signal.
const POLL_MIN_INTERVAL_MS = 55 * 60 * 1000;

export interface MetaEmqEventResult {
  event_name: string | null;
  emq_score: number | null;
  diagnostics: unknown;
}

export interface MetaEmqCheckOutcome {
  providerId: string;
  orgId: string;
  datasetId: string;
  results: MetaEmqEventResult[];
  status: 'ok' | 'error';
  errorMessage: string | null;
}

function extractEmqScore(eventMatchQuality: unknown): number | null {
  if (typeof eventMatchQuality === 'number') return eventMatchQuality;
  if (eventMatchQuality && typeof eventMatchQuality === 'object') {
    const obj = eventMatchQuality as Record<string, unknown>;
    for (const key of ['score', 'overall_score', 'value', 'rating']) {
      const v = obj[key];
      if (typeof v === 'number') return v;
    }
  }
  return null;
}

function extractDiagnostics(eventMatchQuality: unknown): unknown {
  if (eventMatchQuality && typeof eventMatchQuality === 'object') {
    return (eventMatchQuality as Record<string, unknown>)['diagnostics'] ?? null;
  }
  return null;
}

async function fetchDatasetQuality(datasetId: string, accessToken: string): Promise<MetaEmqEventResult[]> {
  const fields = 'web{event_match_quality{diagnostics},event_name}';
  const url = `${META_API_BASE}/${META_API_VERSION}/dataset_quality?dataset_id=${encodeURIComponent(datasetId)}&fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta Dataset Quality API request failed (${res.status}): ${body}`);
  }

  const body = await res.json() as Record<string, unknown>;

  // Secondary-source examples show 'web' as a Graph API connection shape
  // ({ data: [...] }) — fall back to treating it as a bare array in case
  // that assumption doesn't hold for every API version.
  const web = body['web'];
  const entries: unknown[] = Array.isArray(web)
    ? web
    : Array.isArray((web as Record<string, unknown> | undefined)?.['data'])
      ? (web as { data: unknown[] }).data
      : [];

  return entries.map((entry) => {
    const e = entry as Record<string, unknown>;
    return {
      event_name: typeof e['event_name'] === 'string' ? (e['event_name'] as string) : null,
      emq_score: extractEmqScore(e['event_match_quality']),
      diagnostics: extractDiagnostics(e['event_match_quality']),
    };
  });
}

async function getConnectedMetaProviders(orgId: string): Promise<Array<{ id: string; credentials: unknown }>> {
  const { data, error } = await supabaseAdmin
    .from('capi_providers')
    .select('id, credentials')
    .eq('organization_id', orgId)
    .eq('provider', 'meta')
    .eq('status', 'active');

  if (error) {
    logger.error({ err: error.message, orgId }, '[metaEmqPolling] Failed to load Meta providers');
    return [];
  }
  return (data ?? []) as Array<{ id: string; credentials: unknown }>;
}

async function getLastCheckedAt(providerId: string): Promise<Date | null> {
  const { data } = await supabaseAdmin
    .from('dqm_meta_emq_checks')
    .select('checked_at')
    .eq('capi_provider_id', providerId)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { checked_at: string } | null;
  return row ? new Date(row.checked_at) : null;
}

/** Polls the Dataset Quality API for every connected Meta provider in the org, cadence-gated per provider. */
export async function pollMetaEmqForOrg(orgId: string): Promise<MetaEmqCheckOutcome[]> {
  const providers = await getConnectedMetaProviders(orgId);
  const outcomes: MetaEmqCheckOutcome[] = [];

  for (const provider of providers) {
    const lastCheckedAt = await getLastCheckedAt(provider.id);
    if (lastCheckedAt && Date.now() - lastCheckedAt.getTime() < POLL_MIN_INTERVAL_MS) {
      continue;
    }

    let creds: MetaCredentials;
    try {
      creds = safeDecryptCredentials(provider.credentials) as MetaCredentials;
    } catch (err) {
      logger.error({ err, orgId, providerId: provider.id }, '[metaEmqPolling] Failed to decrypt Meta credentials');
      continue;
    }

    if (!creds.dataset_id) continue;

    try {
      const results = await fetchDatasetQuality(creds.dataset_id, creds.access_token);
      outcomes.push({ providerId: provider.id, orgId, datasetId: creds.dataset_id, results, status: 'ok', errorMessage: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, orgId, providerId: provider.id }, '[metaEmqPolling] Dataset Quality poll failed');
      outcomes.push({ providerId: provider.id, orgId, datasetId: creds.dataset_id, results: [], status: 'error', errorMessage: message });
    }
  }

  return outcomes;
}

/** Persists one poll outcome — always writes at least one row so the poll itself is visible for cadence gating and the run log. */
export async function saveMetaEmqOutcome(outcome: MetaEmqCheckOutcome): Promise<void> {
  const baseRow = {
    org_id: outcome.orgId,
    capi_provider_id: outcome.providerId,
    dataset_id: outcome.datasetId,
  };

  if (outcome.status === 'error') {
    const { error } = await supabaseAdmin.from('dqm_meta_emq_checks').insert({
      ...baseRow,
      event_name: null,
      emq_score: null,
      diagnostics: null,
      check_status: 'error',
      error_message: outcome.errorMessage,
    });
    if (error) logger.error({ err: error.message, outcome }, '[metaEmqPolling] Failed to save error check');
    return;
  }

  const rows = outcome.results.length > 0
    ? outcome.results.map((r) => ({
        ...baseRow,
        event_name: r.event_name,
        emq_score: r.emq_score,
        diagnostics: r.diagnostics,
        check_status: 'ok' as const,
        error_message: null,
      }))
    : [{ ...baseRow, event_name: null, emq_score: null, diagnostics: null, check_status: 'ok' as const, error_message: null }];

  const { error } = await supabaseAdmin.from('dqm_meta_emq_checks').insert(rows);
  if (error) logger.error({ err: error.message, outcome }, '[metaEmqPolling] Failed to save EMQ checks');
}

export interface LatestMetaEmqRow {
  capi_provider_id: string;
  dataset_id: string;
  event_name: string | null;
  emq_score: number | null;
  checked_at: string;
}

/** Latest score per (provider, event_name) for the org — small result set, so a client-side reduce is fine rather than a DISTINCT ON query. */
export async function getLatestMetaEmqScores(orgId: string): Promise<LatestMetaEmqRow[]> {
  const { data, error } = await supabaseAdmin
    .from('dqm_meta_emq_checks')
    .select('capi_provider_id, dataset_id, event_name, emq_score, checked_at')
    .eq('org_id', orgId)
    .eq('check_status', 'ok')
    .order('checked_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error.message, orgId }, '[metaEmqPolling] Failed to load latest EMQ scores');
    return [];
  }

  const seen = new Set<string>();
  const latest: LatestMetaEmqRow[] = [];
  for (const row of (data ?? []) as LatestMetaEmqRow[]) {
    const key = `${row.capi_provider_id}::${row.event_name ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row);
  }
  return latest;
}
