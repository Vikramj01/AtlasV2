// sGTM (server-side GTM) Health Probe — HEAD-checks each client's verified
// server-container endpoint.
//
// Unlike probeGTGPath (org-level only, and — per its own comment — checks a
// Google-hosted proxy URL rather than the org's real domain), sGTM endpoints
// are inherently per-client: each client runs its own server container. So
// this probes once per client with a verified endpoint, not once per org.

import { supabaseAdmin } from '@/services/database/supabase';
import { probeUrl } from './httpProbe';
import type { HttpProbeResult } from './httpProbe';
import logger from '@/utils/logger';

export interface SgtmClientCheck extends HttpProbeResult {
  clientId: string;
  transportUrl: string;
}

/**
 * Probes the verified sGTM endpoint for every client in the org that has
 * one (client_platforms.platform = 'sgtm', is_verified = true). Returns one
 * result per client — an org with no verified clients returns an empty array,
 * which the caller should treat as "not applicable", not a failure.
 */
export async function probeSgtmHealth(orgId: string, degradedThresholdMs = 2000): Promise<SgtmClientCheck[]> {
  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organisation_id', orgId);

  if (clientsError) {
    logger.error({ err: clientsError.message, orgId }, '[sgtmProbe] Failed to load clients for org');
    return [];
  }

  const clientIds = (clients ?? []).map((c: { id: string }) => c.id);
  if (clientIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('client_platforms')
    .select('client_id, measurement_id')
    .eq('platform', 'sgtm')
    .eq('is_verified', true)
    .in('client_id', clientIds);

  if (error) {
    logger.error({ err: error.message, orgId }, '[sgtmProbe] Failed to load verified sGTM endpoints');
    return [];
  }

  const rows = (data ?? []) as Array<{ client_id: string; measurement_id: string | null }>;
  const results: SgtmClientCheck[] = [];

  for (const row of rows) {
    if (!row.measurement_id) continue;
    const result = await probeUrl(row.measurement_id, degradedThresholdMs);
    results.push({ ...result, clientId: row.client_id, transportUrl: row.measurement_id });
  }

  return results;
}

export async function saveSgtmCheck(orgId: string, check: SgtmClientCheck): Promise<void> {
  const { error } = await supabaseAdmin.from('dqm_sgtm_checks').insert({
    org_id: orgId,
    client_id: check.clientId,
    transport_url: check.transportUrl,
    http_status: check.httpStatus,
    response_ms: check.responseMs,
    check_status: check.checkStatus,
    error_message: check.errorMessage,
  });

  if (error) logger.error({ err: error.message, orgId, clientId: check.clientId }, '[sgtmProbe] Failed to save sGTM check');
}
