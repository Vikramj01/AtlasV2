/**
 * GTG status persistence (docs/prd/google-tag-gateway.md §5). Capture-derived
 * writes only; probe results (Sprint 3) and operator declarations write
 * through their own paths.
 */
import { supabaseAdmin } from './supabase';
import { classifyGoogleRequests, contextForSite, type GoogleMatchContext } from '@/services/google/googleEndpointMatcher';
import {
  gtgStatusFromCapture,
  mayApplyCaptureStatus,
  normaliseGtgStatus,
  type GtgCaptureEvidence,
  type GtgStatus,
} from '@/services/gtg/gtgStatus';
import type { NetworkRequest } from '@/types/audit';

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

/**
 * Derive a status from a completed audit capture and store it on the client if
 * permitted. Returns the status now stored, or null if nothing changed.
 * Callers must treat this as non-fatal.
 */
export async function applyCaptureGtgStatus(
  clientId: string,
  websiteUrl: string,
  requests: NetworkRequest[],
): Promise<GtgStatus | null> {
  const derived = gtgStatusFromCapture(captureEvidence(requests, contextForSite(websiteUrl)));

  const { data, error } = await supabaseAdmin.from('clients').select('gtg_status').eq('id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  const current = normaliseGtgStatus((data as { gtg_status?: unknown } | null)?.gtg_status);

  if (!mayApplyCaptureStatus(current, derived)) return null;

  const { error: updErr } = await supabaseAdmin
    .from('clients')
    .update({ gtg_status: derived, gtg_status_updated_at: new Date().toISOString() })
    .eq('id', clientId);
  if (updErr) throw new Error(updErr.message);
  return derived;
}
