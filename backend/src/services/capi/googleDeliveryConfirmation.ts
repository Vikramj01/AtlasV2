/**
 * Google Delivery Confirmation — requestStatus:retrieve polling
 *
 * events:ingest's 2xx response confirms submission only (requestId +
 * fieldWarnings — field-level validation caught before processing). This
 * module is the bounded async follow-up that learns what Google actually
 * did with a submitted batch, via:
 *
 *   GET https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=...
 *
 * Verified live against the same Data Manager API Discovery Document
 * (revision 20260904) already verified for dmaTypes.ts — see that file's
 * DMARetrieveRequestStatusResponse comment for the exact schema and its
 * scope limit (aggregated per destination by error/warning reason, no
 * per-event or per-row identifier).
 *
 * Kept separate from googleDelivery.ts: this is a distinct call (GET, no
 * request body, polled later on a delay) against a distinct endpoint, not
 * part of the synchronous events:ingest round-trip.
 */

import type { GoogleCredentials } from '@/types/capi';
import type { DMARetrieveRequestStatusResponse, DMARequestStatusPerDestination } from '@/integrations/google/dmaTypes';
import { refreshGoogleToken } from './googleDelivery';

const DMA_BASE_URL = 'https://datamanager.googleapis.com/v1';

export async function retrieveGoogleRequestStatus(
  requestId: string,
  creds: GoogleCredentials,
): Promise<DMARetrieveRequestStatusResponse> {
  const doFetch = async (accessToken: string) =>
    fetch(`${DMA_BASE_URL}/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(process.env.GOOGLE_DMA_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_DEVELOPER_TOKEN
          ? { 'developer-token': (process.env.GOOGLE_DMA_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_DEVELOPER_TOKEN)! }
          : {}),
      },
    });

  let res = await doFetch(creds.oauth_access_token);

  if (res.status === 401) {
    const refreshedToken = await refreshGoogleToken(creds);
    res = await doFetch(refreshedToken);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`requestStatus:retrieve failed (HTTP ${res.status}): ${body}`);
  }

  return res.json() as Promise<DMARetrieveRequestStatusResponse>;
}

// ── Pure summarization ───────────────────────────────────────────────────────

export type DeliveryConfirmationOutcome =
  | 'confirmed_success'
  | 'confirmed_partial'
  | 'confirmed_failed'
  | 'still_processing';

export interface DeliveryConfirmationSummary {
  outcome: DeliveryConfirmationOutcome;
  reasons: string[]; // distinct error/warning reason strings across all destinations, for alert messages
}

/**
 * Reduces a (possibly multi-destination — Google Ads + GA4) response into a
 * single outcome. Worst status wins: FAILED > PARTIAL_SUCCESS > any errorCounts
 * under an otherwise-SUCCESS destination > PROCESSING/REQUEST_STATUS_UNKNOWN
 * (treated as still processing — never assume failure from ambiguity) > SUCCESS.
 */
export function summarizeDeliveryConfirmation(
  response: DMARetrieveRequestStatusResponse,
): DeliveryConfirmationSummary {
  const destinations = response.requestStatusPerDestination ?? [];
  const reasons = new Set<string>();

  if (destinations.length === 0) {
    return { outcome: 'still_processing', reasons: [] };
  }

  let worst: DeliveryConfirmationOutcome = 'confirmed_success';
  const rank: Record<DeliveryConfirmationOutcome, number> = {
    confirmed_success: 0,
    still_processing: 1,
    confirmed_partial: 2,
    confirmed_failed: 3,
  };

  for (const dest of destinations) {
    const outcome = classifyDestination(dest, reasons);
    if (rank[outcome] > rank[worst]) worst = outcome;
  }

  return { outcome: worst, reasons: Array.from(reasons) };
}

function classifyDestination(
  dest: DMARequestStatusPerDestination,
  reasonsOut: Set<string>,
): DeliveryConfirmationOutcome {
  const errorCounts = dest.errorInfo?.errorCounts ?? [];
  for (const e of errorCounts) reasonsOut.add(e.reason);

  if (dest.requestStatus === 'FAILED') return 'confirmed_failed';
  if (dest.requestStatus === 'PARTIAL_SUCCESS') return 'confirmed_partial';

  if (dest.requestStatus === 'SUCCESS') {
    // A destination can report SUCCESS yet still carry non-zero errorCounts
    // on the live schema (e.g. a record-level rejection that didn't sink
    // the whole request) — treat that as partial, not a clean success.
    const hasErrors = errorCounts.some((e) => Number(e.recordCount ?? '0') > 0);
    return hasErrors ? 'confirmed_partial' : 'confirmed_success';
  }

  // PROCESSING or REQUEST_STATUS_UNKNOWN — never treated as failure from
  // ambiguity alone; the caller's bounded poll count is what eventually
  // stops retrying (see googleDeliveryConfirmationQueue's poll_exhausted path).
  return 'still_processing';
}

/**
 * Reduces multiple requestStatus:retrieve summaries (one per offline upload
 * batch — googleOfflineUpload.ts splits into 2,000-row batches, each with
 * its own requestId) into a single outcome, same worst-wins rule as
 * summarizeDeliveryConfirmation() applies across destinations within one
 * response. The live CAPI path never needs this — one event, one requestId.
 */
export function mergeDeliveryConfirmationSummaries(
  summaries: DeliveryConfirmationSummary[],
): DeliveryConfirmationSummary {
  if (summaries.length === 0) return { outcome: 'still_processing', reasons: [] };

  const rank: Record<DeliveryConfirmationOutcome, number> = {
    confirmed_success: 0,
    still_processing: 1,
    confirmed_partial: 2,
    confirmed_failed: 3,
  };

  let worst: DeliveryConfirmationOutcome = 'confirmed_success';
  const reasons = new Set<string>();
  for (const s of summaries) {
    if (rank[s.outcome] > rank[worst]) worst = s.outcome;
    for (const r of s.reasons) reasons.add(r);
  }

  return { outcome: worst, reasons: Array.from(reasons) };
}
