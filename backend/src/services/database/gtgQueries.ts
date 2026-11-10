/**
 * GTG persistence (docs/prd/google-tag-gateway.md §5, §6).
 *
 * A client's `gtg_status` is never written directly from one evidence stream.
 * Two inputs are stored — what the PAGE loads (`gtg_capture_status`, from audit
 * captures) and whether the registered PATH works (`gtg_probe_status`, from the
 * probe) — and `combineGtgStatus()` decides the status from both. Every writer
 * goes through `recomputeClientGtgStatus()` so the order evidence arrives in
 * never changes the answer.
 */
import { supabaseAdmin } from './supabase';
import {
  classifyGoogleRequests,
  contextForSite,
  type GoogleMatchContext,
} from '@/services/google/googleEndpointMatcher';
import {
  combineGtgStatus,
  effectiveProbeSummary,
  gtgStatusFromCapture,
  normaliseGtgStatus,
  normaliseProbeSummary,
  type GtgCaptureEvidence,
  type GtgStatus,
  type ProbeSummary,
} from '@/services/gtg/gtgStatus';
import { MAX_ENDPOINTS_PER_CLIENT, normaliseReservedPath, type GtgEndpointInput } from '@/services/gtg/gtgEndpoints';
import type { GtgEndpointRow, GtgProbeResult } from '@/services/dqm/gtgProbe';
import type { NetworkRequest } from '@/types/audit';

export interface StoredGtgEndpoint extends GtgEndpointRow {
  source: 'detected' | 'operator_declared' | 'atlas_generated';
  is_verified: boolean;
  geo_verified: boolean;
  verified_at: string | null;
  created_at: string;
}

const ENDPOINT_COLUMNS = 'id, org_id, client_id, hostname, reserved_path, tag_or_container, source, is_verified, geo_verified, verified_at, created_at';

// ── Capture evidence ─────────────────────────────────────────────────────────

/** Evidence from a capture's classified loader requests. Hits alone are not loads and do not count. */
export function captureEvidence(requests: NetworkRequest[], ctx: GoogleMatchContext): GtgCaptureEvidence {
  const loads = classifyGoogleRequests(requests, ctx).filter(
    (c) => c.kind === 'gtm_container_load' || c.kind === 'google_tag_load',
  );
  const firstParty = loads.filter((c) => c.transport === 'gtg' || c.transport === 'unknown_first_party');
  return {
    hasFirstPartyLoad: firstParty.length > 0,
    hasGoogleDirectLoad: loads.some((c) => c.transport === 'google_direct'),
    firstPartyIsGateway: firstParty.some((c) => c.transport === 'gtg'),
  };
}

/** Gateway endpoints a capture reveals: a loader under a reserved path, with the host it came from. */
export function endpointsFromCapture(requests: NetworkRequest[], ctx: GoogleMatchContext): GtgEndpointInput[] {
  const found = new Map<string, GtgEndpointInput>();
  for (const c of classifyGoogleRequests(requests, ctx)) {
    if (c.transport !== 'gtg' || !c.reservedPath || !c.tagId) continue;
    if (c.kind !== 'gtm_container_load' && c.kind !== 'google_tag_load') continue;
    let hostname: string;
    try {
      hostname = new URL(c.request.url, `https://${ctx.siteHostname ?? 'invalid.invalid'}`).hostname.toLowerCase();
    } catch {
      continue;
    }
    const path = normaliseReservedPath(c.reservedPath);
    if (!path) continue;
    const key = `${hostname}${path}`;
    if (!found.has(key)) found.set(key, { hostname, reserved_path: path, tag_or_container: c.tagId });
  }
  return [...found.values()];
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listEndpointsForClient(clientId: string): Promise<StoredGtgEndpoint[]> {
  const { data, error } = await supabaseAdmin
    .from('client_gtg_endpoints')
    .select(ENDPOINT_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredGtgEndpoint[];
}

export async function listEndpointsForOrg(orgId: string): Promise<GtgEndpointRow[]> {
  const { data: clients, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organisation_id', orgId)
    .neq('status', 'archived');
  if (cErr) throw new Error(cErr.message);
  const ids = (clients ?? []).map((c) => (c as { id: string }).id);
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('client_gtg_endpoints')
    .select('id, org_id, client_id, hostname, reserved_path, tag_or_container')
    .in('client_id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as GtgEndpointRow[];
}

export async function listRecentGtgChecks(clientId: string, limit = 10): Promise<Array<{
  endpoint_id: string | null; check_status: string; geo_status: string | null; http_status: number | null;
  response_ms: number | null; error_message: string | null; checked_at: string;
}>> {
  const { data, error } = await supabaseAdmin
    .from('dqm_gtg_checks')
    .select('endpoint_id, check_status, geo_status, http_status, response_ms, error_message, checked_at')
    .eq('client_id', clientId)
    .order('checked_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as never;
}

// ── Writes: endpoint registry ────────────────────────────────────────────────

/** Operator add/correct. Existing (client, host, path) is updated and becomes operator_declared. */
export async function upsertOperatorEndpoint(orgId: string, clientId: string, input: GtgEndpointInput): Promise<StoredGtgEndpoint> {
  const existing = await listEndpointsForClient(clientId);
  const same = existing.find((e) => e.hostname === input.hostname && e.reserved_path === input.reserved_path);
  if (!same && existing.length >= MAX_ENDPOINTS_PER_CLIENT) {
    throw new Error(`A client can register at most ${MAX_ENDPOINTS_PER_CLIENT} gateway paths`);
  }

  const { data, error } = await supabaseAdmin
    .from('client_gtg_endpoints')
    .upsert(
      {
        org_id: orgId,
        client_id: clientId,
        hostname: input.hostname,
        reserved_path: input.reserved_path,
        tag_or_container: input.tag_or_container,
        source: 'operator_declared',
        // A corrected tag or an edited row must be re-verified, never inherit a stale pass.
        ...(same && same.tag_or_container !== input.tag_or_container ? { is_verified: false, geo_verified: false, verified_at: null } : {}),
      },
      { onConflict: 'client_id,hostname,reserved_path' },
    )
    .select(ENDPOINT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as StoredGtgEndpoint;
}

export async function deleteEndpoint(clientId: string, endpointId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('client_gtg_endpoints')
    .delete()
    .eq('id', endpointId)
    .eq('client_id', clientId)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Records endpoints a capture revealed. Never overwrites an existing row (an operator's entry wins). */
export async function recordDetectedEndpoints(orgId: string, clientId: string, found: GtgEndpointInput[]): Promise<number> {
  if (found.length === 0) return 0;
  const existing = await listEndpointsForClient(clientId);
  const room = Math.max(0, MAX_ENDPOINTS_PER_CLIENT - existing.length);
  const fresh = found
    .filter((f) => !existing.some((e) => e.hostname === f.hostname && e.reserved_path === f.reserved_path))
    .slice(0, room);
  if (fresh.length === 0) return 0;

  const { error } = await supabaseAdmin.from('client_gtg_endpoints').upsert(
    fresh.map((f) => ({ org_id: orgId, client_id: clientId, ...f, source: 'detected' as const })),
    { onConflict: 'client_id,hostname,reserved_path', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return fresh.length;
}

/** Stores each endpoint's verification flags from a probe run. An inconclusive probe changes nothing. */
export async function recordEndpointVerification(results: GtgProbeResult[], now: Date = new Date()): Promise<void> {
  for (const r of results) {
    if (r.verdict === 'inconclusive') continue;
    const patch =
      r.verdict === 'broken'
        ? { is_verified: false, geo_verified: false }
        : { is_verified: true, geo_verified: r.verdict === 'ok', verified_at: now.toISOString() };
    const { error } = await supabaseAdmin.from('client_gtg_endpoints').update(patch).eq('id', r.endpointId);
    if (error) throw new Error(error.message);
  }
}

// ── Writes: status ───────────────────────────────────────────────────────────

interface ClientGtgRow {
  gtg_status: unknown;
  gtg_capture_status: unknown;
  gtg_probe_status: unknown;
  gtg_probe_checked_at: string | null;
  gtg_went_live_at: string | null;
}

const STATUS_COLUMNS = 'gtg_status, gtg_capture_status, gtg_probe_status, gtg_probe_checked_at, gtg_went_live_at';

/**
 * Reads a client's stored evidence, applies any new evidence, recomputes the
 * combined status, and writes only if something changed. Returns the stored
 * status, or null when nothing changed.
 */
async function recomputeClientGtgStatus(
  clientId: string,
  update: { capture?: GtgStatus; probe?: { summary: ProbeSummary; checkedAt: string } },
  now: Date = new Date(),
): Promise<GtgStatus | null> {
  const { data, error } = await supabaseAdmin.from('clients').select(STATUS_COLUMNS).eq('id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Partial<ClientGtgRow>;

  const current = normaliseGtgStatus(row.gtg_status);
  const storedCapture = normaliseGtgStatus(row.gtg_capture_status);
  // A capture that saw no loader says nothing about the page: it never erases an earlier observation.
  const capture = update.capture && update.capture !== 'unknown' ? update.capture : storedCapture;

  const probeSummary = update.probe ? update.probe.summary : normaliseProbeSummary(row.gtg_probe_status);
  const probeCheckedAt = update.probe ? update.probe.checkedAt : row.gtg_probe_checked_at ?? null;
  const probe = effectiveProbeSummary(probeSummary, probeCheckedAt, now);

  const combined = combineGtgStatus({ current, capture, probe });

  const patch: Record<string, unknown> = {};
  if (capture !== storedCapture) patch['gtg_capture_status'] = capture;
  if (update.probe) {
    patch['gtg_probe_status'] = update.probe.summary;
    patch['gtg_probe_checked_at'] = update.probe.checkedAt;
  }
  if (combined !== current) {
    patch['gtg_status'] = combined;
    patch['gtg_status_updated_at'] = now.toISOString();
    if (combined === 'verified' && !row.gtg_went_live_at) patch['gtg_went_live_at'] = now.toISOString();
  }
  if (Object.keys(patch).length === 0) return null;

  const { error: updErr } = await supabaseAdmin.from('clients').update(patch).eq('id', clientId);
  if (updErr) throw new Error(updErr.message);
  return combined !== current ? combined : null;
}

/** Applies a probe run's per-client summary to the client's status. */
export function applyProbeStatus(clientId: string, summary: ProbeSummary, now: Date = new Date()): Promise<GtgStatus | null> {
  return recomputeClientGtgStatus(clientId, { probe: { summary, checkedAt: now.toISOString() } }, now);
}

/**
 * Derive a capture status from a completed audit, store it, and recompute.
 * Callers must treat this as non-fatal.
 */
export async function applyCaptureGtgStatus(
  clientId: string,
  websiteUrl: string,
  requests: NetworkRequest[],
): Promise<GtgStatus | null> {
  const derived = gtgStatusFromCapture(captureEvidence(requests, contextForSite(websiteUrl)));
  return recomputeClientGtgStatus(clientId, { capture: derived });
}

/** Registers gateway paths a capture revealed (source 'detected') for the client it is linked to. Non-fatal for callers. */
export async function discoverGtgEndpointsFromCapture(
  orgId: string,
  clientId: string,
  websiteUrl: string,
  requests: NetworkRequest[],
): Promise<number> {
  return recordDetectedEndpoints(orgId, clientId, endpointsFromCapture(requests, contextForSite(websiteUrl)));
}

// ── Org roll-up for the alert ────────────────────────────────────────────────

export interface OrgGtgStatusCounts {
  broken: number;
  noGeo: number;
  partial: number;
  /** Clients with any gateway-relevant status (everything except unknown / not_applicable / not_detected). */
  monitored: number;
}

export async function getOrgGtgStatusCounts(orgId: string): Promise<OrgGtgStatusCounts> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('gtg_status')
    .eq('organisation_id', orgId)
    .neq('status', 'archived');
  if (error) throw new Error(error.message);

  const counts: OrgGtgStatusCounts = { broken: 0, noGeo: 0, partial: 0, monitored: 0 };
  for (const r of (data ?? []) as Array<{ gtg_status: unknown }>) {
    const s = normaliseGtgStatus(r.gtg_status);
    if (s === 'unknown' || s === 'not_applicable' || s === 'not_detected') continue;
    counts.monitored += 1;
    if (s === 'broken') counts.broken += 1;
    else if (s === 'verified_no_geo') counts.noGeo += 1;
    else if (s === 'partial') counts.partial += 1;
  }
  return counts;
}
