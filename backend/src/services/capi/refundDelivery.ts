/**
 * Refund/return feedback to platforms.
 *
 * Google Ads' Data Manager API (DMA) has no conversion-adjustment or
 * retraction capability — confirmed against DMA's own Discovery Document
 * (https://datamanager.googleapis.com/$discovery/rest?version=v1): the Event
 * resource used by events.ingest has no adjustment field, and no method in
 * the full API surface (events, audienceMembers, adEvents, userLists,
 * partnerLinks, insights) adjusts a previously-sent conversion. So this
 * module ships two things instead of a single "send the refund" call:
 *
 *   1. Google audience removal (real, ships today) — removes the refunded
 *      customer from Customer Match/remarketing audiences via DMA, so Google
 *      stops optimizing toward them going forward. Reuses
 *      ingestCustomerMatchBatch() from customerMatch.ts directly; this module
 *      adds no new DMA client code.
 *   2. A best-effort Google Ads conversion-adjustment CSV (for the client to
 *      upload themselves via Google Ads' own "Uploads -> Conversion
 *      Adjustments" UI) — Atlas has no visibility into whether they actually
 *      upload it. The exact column format could not be verified against
 *      Google's primary docs from this environment (support.google.com and
 *      developers.google.com are both network-blocked here); it's built from
 *      corroborating secondary sources and the date-format convention already
 *      used elsewhere in this codebase for Google adjustments
 *      (GoogleConversionAdjustment.gclidDateTimePair). Flagged clearly to the
 *      user as needing verification against their own account's downloaded
 *      template before uploading.
 *
 * Meta is logged only — no reversal API exists there. GA4 is out of scope —
 * Atlas has no server-side GA4 delivery at all yet (separate open item).
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from './credentials';
import { ingestCustomerMatchBatch } from './customerMatch';
import type { GoogleCredentials } from '@/types/capi';
import type { RecordRefundInput, RefundEvent, GoogleRemovalStatus } from '@/types/refunds';
import logger from '@/utils/logger';

// ── PII hashing (storage only — never persist raw) ────────────────────────────
// Same local-helper pattern as customerMatch.ts / googleOfflineUpload.ts —
// this codebase keeps small hash helpers per module rather than a shared one.

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function hashEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}
function hashPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '').replace(/^\+?/, '+');
  return sha256(digits);
}

// ── Record a refund ─────────────────────────────────────────────────────────

/**
 * Inserts the refund_events row. Raw email/phone (if provided) are hashed
 * for storage and never persisted — the caller is responsible for using the
 * raw values for removeFromGoogleAudience() in the same request before they
 * go out of scope.
 */
export async function recordRefund(
  orgId: string,
  userId: string,
  input: RecordRefundInput,
): Promise<RefundEvent> {
  const { data, error } = await supabaseAdmin
    .from('refund_events')
    .insert({
      organization_id: orgId,
      client_id: input.client_id ?? null,
      original_transaction_id: input.original_transaction_id,
      refund_amount: input.refund_amount,
      currency: input.currency.toUpperCase(),
      is_partial: input.is_partial,
      new_conversion_value: input.new_conversion_value ?? null,
      reason: input.reason ?? null,
      hashed_email: input.email ? hashEmail(input.email) : null,
      hashed_phone: input.phone ? hashPhone(input.phone) : null,
      created_by: userId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to record refund: ${error?.message ?? 'no row returned'}`);
  }

  return data as RefundEvent;
}

export async function listRefunds(orgId: string, limit = 50): Promise<RefundEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('refund_events')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to list refunds: ${error.message}`);
  return (data ?? []) as RefundEvent[];
}

async function updateGoogleRemovalStatus(
  refundId: string,
  status: GoogleRemovalStatus,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('refund_events')
    .update({ google_removal_status: status, google_removal_error: errorMessage })
    .eq('id', refundId);

  if (error) {
    logger.error({ err: error.message, refundId, status }, '[refundDelivery] Failed to update google_removal_status');
  }
}

// ── Google audience removal ───────────────────────────────────────────────────

async function getActiveGoogleCredentials(orgId: string): Promise<GoogleCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from('capi_providers')
    .select('credentials')
    .eq('organization_id', orgId)
    .eq('provider', 'google')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return safeDecryptCredentials((data as { credentials: unknown }).credentials) as GoogleCredentials;
}

/**
 * Removes the refunded customer from Google Ads Customer Match/remarketing
 * audiences via DMA, so Google stops optimizing toward them. Does NOT correct
 * Google Ads' own conversion value/count reporting — see module doc.
 *
 * Takes raw email/phone (from the request, not the DB — refund_events only
 * stores the hash) so it can reuse ingestCustomerMatchBatch()'s own internal
 * hashing unchanged, rather than double-hashing an already-hashed value.
 *
 * Never throws — a delivery failure must not fail the refund-recording
 * request that already succeeded.
 */
export async function removeFromGoogleAudience(
  orgId: string,
  refundId: string,
  email: string | undefined,
  phone: string | undefined,
): Promise<void> {
  if (!email && !phone) {
    await updateGoogleRemovalStatus(refundId, 'skipped', 'No customer email or phone provided for this refund');
    return;
  }

  try {
    const creds = await getActiveGoogleCredentials(orgId);
    if (!creds) {
      await updateGoogleRemovalStatus(refundId, 'skipped', 'No active Google connection for this organization');
      return;
    }

    const result = await ingestCustomerMatchBatch(orgId, creds.customer_id, [{ email, phone }], 'REMOVE');

    if (result.failed_count > 0) {
      const firstError = result.member_errors[0];
      await updateGoogleRemovalStatus(
        refundId,
        'failed',
        firstError ? `${firstError.code}: ${firstError.message}` : 'DMA audience removal failed',
      );
      return;
    }

    await updateGoogleRemovalStatus(refundId, 'removed', null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, orgId, refundId }, '[refundDelivery] Google audience removal failed');
    await updateGoogleRemovalStatus(refundId, 'failed', message);
  }
}

// ── Google adjustment CSV ─────────────────────────────────────────────────────

/**
 * Best-effort Google Ads conversion-adjustment CSV for manual upload via
 * Google Ads' own "Uploads -> Conversion Adjustments" UI. NOT verified
 * against Google's primary docs (network-blocked in this environment) —
 * callers must surface the verification caveat to the user, not just the
 * file. Uses the same date-format convention as
 * GoogleConversionAdjustment.gclidDateTimePair elsewhere in this codebase
 * (yyyy-MM-dd HH:mm:ssXXX).
 */
/**
 * Throws if a partial refund is missing new_conversion_value — callers
 * should surface this to the user rather than generate a file with a blank
 * value silently. Google's upload template rejects extra/non-template
 * columns, so there's no way to embed a "fill this in" note inside the CSV
 * itself (confirmed via Google Ads Help: additional columns fail import).
 */
export function generateAdjustmentCsv(refund: RefundEvent): string {
  if (refund.is_partial && refund.new_conversion_value === null) {
    throw new Error(
      'This partial refund has no recorded post-refund order total — cannot generate a correct adjustment CSV.',
    );
  }

  const header = 'Order ID,Adjustment Type,Adjustment Time,New Conversion Value,New Currency';
  const adjustmentType = refund.is_partial ? 'RESTATEMENT' : 'RETRACTION';
  const adjustmentTime = formatGoogleAdjustmentTime(new Date());

  // RETRACTION zeroes the conversion out — no new value needed. RESTATEMENT
  // needs the corrected order total AFTER the refund, as an absolute value
  // (new_conversion_value, captured at refund-entry time) — Atlas has no way
  // to derive this itself since it doesn't know the original order value.
  const newValue = refund.is_partial ? refund.new_conversion_value!.toFixed(2) : '';
  const newCurrency = refund.is_partial ? refund.currency : '';

  const row = [
    csvEscape(refund.original_transaction_id),
    adjustmentType,
    adjustmentTime,
    newValue,
    newCurrency,
  ].join(',');

  return `${header}\n${row}\n`;
}

function formatGoogleAdjustmentTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offsetH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offsetM = pad(Math.abs(offsetMin) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetH}:${offsetM}`
  );
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function markAdjustmentCsvGenerated(refundId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('refund_events')
    .update({ adjustment_csv_generated_at: new Date().toISOString() })
    .eq('id', refundId);

  if (error) {
    logger.error({ err: error.message, refundId }, '[refundDelivery] Failed to mark adjustment CSV generated');
  }
}
