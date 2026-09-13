/**
 * Refund/return feedback to platforms.
 *
 * Google Ads' Data Manager API (DMA) has no conversion-adjustment or
 * retraction capability — confirmed against DMA's own Discovery Document
 * (https://datamanager.googleapis.com/$discovery/rest?version=v1): the Event
 * resource used by events.ingest has no adjustment field, and no method in
 * the full API surface (events, audienceMembers, adEvents, userLists,
 * partnerLinks, insights) adjusts a previously-sent conversion — re-verified
 * on a live fetch at revision 20260904, still true. The standard Google Ads
 * API is a different story: its ConversionAdjustmentUploadService
 * (uploadConversionAdjustments) remains generally available and is not
 * swept into either of Google's 2026 migration waves (Customer Match /
 * OfflineUserDataJobService, cut Apr 1; offline-conversion-import /
 * ConversionUploadService.UploadClickConversions, cut Jun 15 — both scoped
 * to those specific services, not to adjustments). So this module ships
 * three things instead of a single "send the refund" call:
 *
 *   1. Google audience removal (real, DMA-native) — removes the refunded
 *      customer from Customer Match/remarketing audiences, so Google stops
 *      optimizing toward them going forward. Reuses ingestCustomerMatchBatch()
 *      from customerMatch.ts directly; this module adds no new DMA client code.
 *   2. An automated Google Ads conversion adjustment (submitGoogleConversion
 *      Adjustment) — RESTATEMENT/RETRACTION via uploadConversionAdjustments,
 *      matched by orderId (original_transaction_id) against the single
 *      conversion_action_id already stored per Google connection (the same
 *      one googleDelivery.ts uses for live delivery).
 *   3. A best-effort Google Ads conversion-adjustment CSV, kept as a
 *      fallback/audit trail regardless of (2)'s outcome — Atlas has no way
 *      to guarantee Google actually applied an accepted adjustment. The exact
 *      column format could not be verified against Google's primary docs
 *      from this environment (support.google.com and developers.google.com
 *      are both network-blocked here); it's built from corroborating
 *      secondary sources and the date-format convention shared with (2)'s
 *      adjustmentDateTime field. Flagged clearly to the user as needing
 *      verification against their own account's downloaded template before
 *      uploading.
 *
 * Meta gets a fourth, independent leg (sendMetaRefundSignal) — NOT a
 * reversal (Meta's Offline Conversions API was fully discontinued May 2025,
 * and the unified Conversions API has no adjustment/retraction verb either)
 * but a new, forward-looking custom event (atlas_refund /
 * atlas_order_cancellation) carrying the refund's own hashed identifiers, so
 * Meta's dataset reflects the cancellation for audience-exclusion purposes
 * even though the original Purchase conversion can't itself be un-counted.
 *
 * GA4 is out of scope — Atlas has no server-side GA4 delivery at all yet
 * (separate open item).
 */

import { createHash, randomUUID } from 'crypto';
import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from './credentials';
import { ingestCustomerMatchBatch } from './customerMatch';
import { refreshGoogleToken } from './googleDelivery';
import { sendMetaEvents } from './metaDelivery';
import {
  GOOGLE_ADS_API_BASE,
  GOOGLE_ADS_API_VERSION,
  buildGoogleAdsHeaders,
  cleanCustomerId,
  formatGoogleDateTime,
} from '@/services/offline-conversions/googleOfflineUpload';
import type { GoogleCredentials, MetaCredentials, AtlasEvent, HashedIdentifier, EventMapping } from '@/types/capi';
import type { RecordRefundInput, RefundEvent, GoogleRemovalStatus, GoogleAdjustmentStatus } from '@/types/refunds';
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

// ── Automated Google Ads conversion adjustment ────────────────────────────────
// Spike outcome (confirmed viable — see the header comment of migration
// 20260915003_google_conversion_adjustment.sql for the full sourcing):
// ConversionAdjustmentUploadService/uploadConversionAdjustments remains
// generally available on the standard Google Ads API and is not swept into
// either of Google's 2026 migration waves (Customer Match /
// OfflineUserDataJobService cut Apr 1; offline-conversion-import /
// ConversionUploadService.UploadClickConversions cut Jun 15 — both scoped
// to those specific services, not to adjustments).
//
// Matches by orderId (original_transaction_id), same as the existing CSV's
// "Order ID" column, using the single conversion_action_id already stored
// per Google connection (creds.conversion_action_id — the same one
// googleDelivery.ts uses for the live pipeline). The CSV stays available
// as a fallback/audit trail regardless of this call's outcome — Atlas has
// no way to guarantee Google actually applied an accepted adjustment, and
// keeping the CSV lets the client verify/re-upload manually if needed.

async function updateGoogleAdjustmentStatus(
  refundId: string,
  status: GoogleAdjustmentStatus,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('refund_events')
    .update({
      google_adjustment_status: status,
      google_adjustment_error: errorMessage,
      ...(status === 'submitted' ? { google_adjustment_submitted_at: new Date().toISOString() } : {}),
    })
    .eq('id', refundId);

  if (error) {
    logger.error({ err: error.message, refundId, status }, '[refundDelivery] Failed to update google_adjustment_status');
  }
}

interface ConversionAdjustmentPayload {
  conversionAction: string;
  orderId: string;
  adjustmentType: 'RESTATEMENT' | 'RETRACTION';
  adjustmentDateTime: string;
  restatementValue?: { adjustedValue: number; currencyCode: string };
}

interface UploadConversionAdjustmentsResponse {
  results?: unknown[];
  partialFailureError?: { code?: number; message?: string };
}

/**
 * Submits a single conversion adjustment (RESTATEMENT for partial refunds,
 * RETRACTION for full) via the standard Google Ads API. Never throws — a
 * delivery failure must not fail the refund-recording request that already
 * succeeded; the CSV fallback remains available either way.
 */
export async function submitGoogleConversionAdjustment(orgId: string, refundId: string, refund: RefundEvent): Promise<void> {
  if (refund.is_partial && refund.new_conversion_value === null) {
    await updateGoogleAdjustmentStatus(refundId, 'skipped', 'Partial refund has no recorded post-refund order total');
    return;
  }

  try {
    const creds = await getActiveGoogleCredentials(orgId);
    if (!creds) {
      await updateGoogleAdjustmentStatus(refundId, 'skipped', 'No active Google connection for this organization');
      return;
    }
    if (!creds.conversion_action_id || !creds.customer_id) {
      await updateGoogleAdjustmentStatus(refundId, 'skipped', 'No conversion_action_id/customer_id configured for this Google connection');
      return;
    }

    const customerId = cleanCustomerId(creds.customer_id);
    const payload: ConversionAdjustmentPayload = {
      conversionAction: `customers/${customerId}/conversionActions/${creds.conversion_action_id}`,
      orderId: refund.original_transaction_id,
      adjustmentType: refund.is_partial ? 'RESTATEMENT' : 'RETRACTION',
      adjustmentDateTime: formatGoogleDateTime(new Date().toISOString()),
      ...(refund.is_partial
        ? { restatementValue: { adjustedValue: refund.new_conversion_value!, currencyCode: refund.currency } }
        : {}),
    };

    const url = `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:uploadConversionAdjustments`;
    const body = JSON.stringify({ conversionAdjustments: [payload], partialFailure: true });

    const makeRequest = async (token: string): Promise<Response> =>
      fetch(url, { method: 'POST', headers: buildGoogleAdsHeaders(creds, token), body });

    let accessToken = creds.oauth_access_token;
    let res = await makeRequest(accessToken);

    if (res.status === 401) {
      accessToken = await refreshGoogleToken(creds);
      res = await makeRequest(accessToken);
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
      await updateGoogleAdjustmentStatus(refundId, 'failed', errBody.error?.message ?? `HTTP ${res.status}`);
      return;
    }

    const responseBody = await res.json() as UploadConversionAdjustmentsResponse;
    if (responseBody.partialFailureError) {
      await updateGoogleAdjustmentStatus(refundId, 'failed', responseBody.partialFailureError.message ?? 'Partial failure');
      return;
    }

    await updateGoogleAdjustmentStatus(refundId, 'submitted', null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, orgId, refundId }, '[refundDelivery] Google conversion adjustment submission failed');
    await updateGoogleAdjustmentStatus(refundId, 'failed', message);
  }
}

// ── Meta refund/cancellation signal ───────────────────────────────────────────
// Not a reversal — Meta's Offline Conversions API was fully discontinued May
// 2025, and the unified Conversions API has no adjustment/retraction verb
// either. This dispatches a NEW, forward-looking custom event
// (atlas_refund/atlas_order_cancellation) carrying the same hashed
// identifiers the refund itself carries, so Meta's dataset reflects the
// cancellation for audience-exclusion purposes — matching the pattern
// third-party CAPI integrations already use for subscription cancellations/
// refunds. Not a standard Meta event type (Meta has no official "Refund"
// standard event in the Conversions API).
//
// Calls sendMetaEvents() directly (not processServerSourcedEvent()) because
// that pipeline entry point hashes RAW PII itself — refund_events only ever
// stores already-hashed email/phone (raw values are deliberately never
// persisted, see the migration's own comment), so there is no raw PII left
// to hash by the time a refund is recorded. consent_state below mirrors
// shopifyOrderMapper.ts's NO_LIVE_CONSENT — there is no live browser
// consent decision behind a refund recorded via the dashboard or a webhook.

async function updateMetaRefundStatus(
  refundId: string,
  status: RefundEvent['meta_status'],
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('refund_events')
    .update({ meta_status: status, meta_status_error: errorMessage })
    .eq('id', refundId);

  if (error) {
    logger.error({ err: error.message, refundId, status }, '[refundDelivery] Failed to update meta_status');
  }
}

async function getActiveMetaCredentials(orgId: string): Promise<MetaCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from('capi_providers')
    .select('credentials')
    .eq('organization_id', orgId)
    .eq('provider', 'meta')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return safeDecryptCredentials((data as { credentials: unknown }).credentials) as MetaCredentials;
}

/**
 * Sends the atlas_refund/atlas_order_cancellation custom event to Meta.
 * Never throws — a delivery failure must not fail the refund-recording
 * request that already succeeded.
 */
export async function sendMetaRefundSignal(orgId: string, refund: RefundEvent): Promise<void> {
  if (!refund.hashed_email && !refund.hashed_phone) {
    await updateMetaRefundStatus(refund.id, 'skipped', 'No customer email or phone provided for this refund');
    return;
  }

  try {
    const creds = await getActiveMetaCredentials(orgId);
    if (!creds) {
      await updateMetaRefundStatus(refund.id, 'skipped', 'No active Meta connection for this organization');
      return;
    }

    const identifiers: HashedIdentifier[] = [];
    if (refund.hashed_email) identifiers.push({ type: 'email', value: refund.hashed_email, is_hashed: true });
    if (refund.hashed_phone) identifiers.push({ type: 'phone', value: refund.hashed_phone, is_hashed: true });

    const eventName = refund.is_partial ? 'atlas_refund' : 'atlas_order_cancellation';
    const event: AtlasEvent = {
      event_id: randomUUID(),
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: '',
      action_source: 'system_generated',
      user_data: {},
      custom_data: {
        value: refund.refund_amount,
        currency: refund.currency,
        order_id: refund.original_transaction_id,
      },
      // No live browser consent decision behind a refund recorded via the
      // dashboard or a webhook — see shopifyOrderMapper.ts's NO_LIVE_CONSENT
      // for the same, deliberate pattern.
      consent_state: {
        analytics: 'not_required',
        marketing: 'not_required',
        personalisation: 'not_required',
        functional: 'not_required',
      },
    };

    const mapping: EventMapping = { atlas_event: eventName, provider_event: eventName };
    const [result] = await sendMetaEvents([event], [identifiers], [mapping], creds);

    if (result?.status === 'delivered') {
      await updateMetaRefundStatus(refund.id, 'signal_sent', null);
    } else {
      await updateMetaRefundStatus(refund.id, 'failed', result?.error_message ?? 'Unknown delivery failure');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, orgId, refundId: refund.id }, '[refundDelivery] Meta refund signal failed');
    await updateMetaRefundStatus(refund.id, 'failed', message);
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
