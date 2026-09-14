/**
 * Bid Signal Enricher — Database CRUD layer (delivery confirmation only).
 *
 * enricherService.ts writes enricher_runs directly via supabaseAdmin for its
 * main run lifecycle (insert/update on create/complete/fail) — this module
 * covers only the confirmation-poll read/update pair, mirroring
 * offlineConversionQueries.ts's getUploadForConfirmation/
 * updateUploadDeliveryConfirmation so the googleDeliveryConfirmationQueue
 * worker processor can treat capi_event_id/upload_id/enricher_run_id
 * uniformly.
 */

import { supabaseAdmin as supabase } from './supabase';

export interface EnricherRunForConfirmation {
  id: string;
  org_id: string;
  status: string;
  provider_request_id: string | null;
  delivery_poll_attempts: number;
}

/** No org filter — called from the confirmation poll worker (service role), not a user-facing route. */
export async function getEnricherRunForConfirmation(runId: string): Promise<EnricherRunForConfirmation | null> {
  const { data, error } = await supabase
    .from('enricher_runs')
    .select('id, org_id, status, provider_request_id, delivery_poll_attempts')
    .eq('id', runId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load enricher run for confirmation: ${error.message}`);
  return data as EnricherRunForConfirmation | null;
}

/**
 * Escalate-only, same convention as offlineConversionQueries.ts's
 * updateUploadDeliveryConfirmation: only ever downgrades 'completed' to
 * 'partial' when a bounded confirmation poll reveals a real failure the
 * synchronous ingest response didn't catch (audienceMembers:ingest/:remove
 * return only { requestId } — no per-member result). Never upgrades an
 * already-'partial'/'failed' run back toward 'completed'. matched_count/
 * failed_count are deliberately left as-is — the live API's
 * requestStatus:retrieve response has no per-member breakdown to recompute
 * them from (aggregated by error reason across the whole destination, per
 * dmaTypes.ts's DMARequestStatusPerDestination comment) — downgrading
 * `status` is what keeps dqm_dma_poll_state.upload_success_rate
 * (dmaPolling.ts, filtered on status === 'completed') honest.
 */
export async function updateEnricherRunDeliveryConfirmation(
  runId: string,
  update: {
    downgradeToPartial: boolean;
    delivery_confirmed_status?: 'confirmed_success' | 'confirmed_partial' | 'confirmed_failed' | 'poll_exhausted';
    delivery_confirmation: unknown;
    delivery_poll_attempts: number;
    confirmed: boolean; // true on a terminal outcome — stamps delivery_confirmed_at
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    delivery_confirmed_status: update.delivery_confirmed_status ?? null,
    delivery_confirmation: update.delivery_confirmation ?? null,
    delivery_poll_attempts: update.delivery_poll_attempts,
    delivery_confirmed_at: update.confirmed ? new Date().toISOString() : undefined,
  };
  if (update.downgradeToPartial) patch.status = 'partial';

  const { error } = await supabase.from('enricher_runs').update(patch).eq('id', runId);
  if (error) throw new Error(`Failed to update enricher run delivery confirmation: ${error.message}`);
}
