/**
 * Canonical Event Identity — integrity rules
 *
 * Pure, per-row checks over Atlas's own capi_events data (no platform
 * reporting-API calls) answering: did the native id we sent to a destination
 * actually trace back to the canonical atlas_event_id for that business
 * event, and did retries eventually confirm delivery?
 */

export interface IdentityCheckRow {
  atlas_event_id: string;
  event_id: string | null;
  dedup_status: 'hit' | 'miss' | 'not_applicable' | null;
  status: string;
  retry_count: number;
}

const MAX_RETRIES_BEFORE_DEAD = 3;

export interface RuleResult {
  violated: boolean;
  reason: string;
}

/**
 * A dedup 'hit' legitimately means a browser-supplied id (fbc/gclid-keyed)
 * was reused for platform-side dedup — that's correct behavior, not a
 * violation, even though it doesn't equal atlas_event_id. Only a 'miss' (or
 * no dedup concept) with a native id that diverges from the canonical one is
 * a sign the delivery adapter minted its own replacement id instead of
 * reusing the business event's identity.
 */
export function checkNativeIdDerivesFromCanonical(row: IdentityCheckRow): RuleResult {
  if (row.dedup_status === 'hit') return { violated: false, reason: '' };
  if (!row.event_id) return { violated: false, reason: '' };
  if (row.event_id === row.atlas_event_id) return { violated: false, reason: '' };
  return {
    violated: true,
    reason: `native id "${row.event_id}" does not derive from canonical atlas_event_id "${row.atlas_event_id}"`,
  };
}

/**
 * Retries exhausted with no eventual delivery means this business event's
 * identity was never confirmed to have reached the destination at all.
 */
export function checkRetriesExhaustedUnconfirmed(row: IdentityCheckRow): RuleResult {
  const exhausted = (row.status === 'delivery_failed' || row.status === 'dead_letter')
    && row.retry_count >= MAX_RETRIES_BEFORE_DEAD;
  if (!exhausted) return { violated: false, reason: '' };
  return {
    violated: true,
    reason: `retries exhausted (${row.retry_count}) with status "${row.status}" and no confirmed delivery`,
  };
}

export function checkIdentityIntegrity(row: IdentityCheckRow): RuleResult {
  const nativeIdCheck = checkNativeIdDerivesFromCanonical(row);
  if (nativeIdCheck.violated) return nativeIdCheck;
  return checkRetriesExhaustedUnconfirmed(row);
}
