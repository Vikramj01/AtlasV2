/**
 * Google Offline Conversions — Adapter Stub
 *
 * Handles CSV-based offline conversion uploads to Google Ads Enhanced
 * Conversions. Unlike the real-time google.ts adapter (which processes
 * browser events), this adapter:
 *
 *   - Accepts batches of pre-validated OfflineConversionRow records
 *   - Constructs ClickConversion or UserIdentifierConsent payloads
 *   - Delegates authentication to the existing CAPI OAuth credentials
 *     stored in capi_providers (no separate credential management)
 *   - Handles Google's 2,000-row batch limit and partial failure mode
 *
 * This is a stub for Sprint 1. Full implementation ships in Sprint 2
 * as part of googleOfflineUpload.ts (backend service).
 *
 * Frontend role: type contracts + payload preview in the setup wizard.
 */

import type { GoogleCredentials } from '@/types/capi';
import type {
  OfflineConversionRow,
  OfflineConversionConfig,
  GoogleConversionAction,
  GoogleRowResult,
} from '@/types/offline-conversions';

// ── Batch size enforced by Google Ads API ─────────────────────────────────────

export const GOOGLE_OFFLINE_BATCH_SIZE = 2_000;

// ── Google Ads API payload shape for offline uploads ─────────────────────────

/**
 * A single ClickConversion payload sent to Google Ads.
 * Matches the `ClickConversion` resource in the Google Ads API.
 */
export interface GoogleClickConversion {
  /** Google Click ID from the ad click — primary matching signal. */
  gclid?: string;
  /** Google Ads conversion action resource name. */
  conversionAction: string;
  /** RFC 3339 formatted datetime, e.g. "2026-04-01T12:00:00+00:00" */
  conversionDateTime: string;
  conversionValue?: number;
  currencyCode?: string;
  /** Used for Google-side deduplication. */
  orderId?: string;
  /** Hashed user identifiers for email-only or supplemental matching. */
  userIdentifiers?: GoogleUserIdentifier[];
}

export interface GoogleUserIdentifier {
  /** SHA-256 lowercase hex of normalised email. */
  hashedEmail?: string;
  /** SHA-256 lowercase hex of E.164 phone number. */
  hashedPhoneNumber?: string;
  addressInfo?: {
    hashedFirstName?: string;
    hashedLastName?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    countryCode?: string;
  };
}

// ── Batch builder (pure, no API calls) ───────────────────────────────────────

/**
 * Converts a validated OfflineConversionRow into a GoogleClickConversion payload.
 * Used both in the backend upload service and for wizard preview.
 *
 * Rules:
 *  - If raw_gclid is present → include as gclid (GCLID-based matching, ~90% match rate)
 *  - Always include hashed_email / hashed_phone when available as supplemental identifiers
 *  - Conversion value falls back to config default if not set on the row
 *  - Currency falls back to config default
 */
export function buildClickConversionPayload(
  row: OfflineConversionRow,
  config: OfflineConversionConfig,
): GoogleClickConversion {
  const userIdentifiers: GoogleUserIdentifier[] = [];

  if (row.hashed_email) {
    userIdentifiers.push({ hashedEmail: row.hashed_email });
  }
  if (row.hashed_phone) {
    userIdentifiers.push({ hashedPhoneNumber: row.hashed_phone });
  }

  const payload: GoogleClickConversion = {
    conversionAction: config.conversion_action_id ?? '',
    conversionDateTime: formatGoogleDateTime(row.conversion_time ?? new Date().toISOString()),
    conversionValue: row.conversion_value ?? config.default_conversion_value ?? undefined,
    currencyCode: row.currency ?? config.default_currency,
  };

  if (row.raw_gclid) {
    payload.gclid = row.raw_gclid;
  }
  if (row.order_id) {
    payload.orderId = row.order_id;
  }
  if (userIdentifiers.length > 0) {
    payload.userIdentifiers = userIdentifiers;
  }

  return payload;
}

/**
 * Splits rows into batches of GOOGLE_OFFLINE_BATCH_SIZE.
 * Each batch is uploaded in a separate API request.
 */
export function splitIntoBatches<T>(rows: T[], batchSize = GOOGLE_OFFLINE_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }
  return batches;
}

// ── Response parser ───────────────────────────────────────────────────────────

/**
 * Maps Google Ads API error codes to user-friendly messages.
 * Covers the most common upload errors. Unknown codes fall back to the raw message.
 */
export function mapGoogleErrorCode(code: string): string {
  const ERROR_MESSAGES: Record<string, string> = {
    'CONVERSION_NOT_FOUND':             'Conversion action not found. Verify the action ID in your config.',
    'CONVERSION_PRECONDITION_FAILED':   'Conversion action is disabled. Enable it in Google Ads.',
    'TOO_RECENT_CONVERSION_ACTION':     'Conversion action was created too recently. Wait 6 hours after creating a new action.',
    'EXPIRED_CONVERSION':               'Conversion is older than 90 days and cannot be uploaded.',
    'TOO_RECENT_CLICK':                 'Click occurred less than 24 hours ago — upload after 24 hours.',
    'CLICK_NOT_FOUND':                  'GCLID not found. The click may have expired or the ID is incorrect.',
    'INVALID_ARGUMENT':                 'Invalid data in one or more fields. Check the error details.',
    'RESOURCE_NOT_FOUND':               'Google Ads customer ID not found. Verify your account ID.',
    'AUTHENTICATION_ERROR':             'Google Ads authentication failed. Reconnect your account in CAPI settings.',
    'AUTHORIZATION_ERROR':              'Insufficient permissions. Ensure your account has Standard or Admin access.',
    'QUOTA_ERROR':                      'Google Ads API quota exceeded. Wait and retry.',
    'INTERNAL_ERROR':                   'Google Ads internal error. Retry the upload.',
  };
  return ERROR_MESSAGES[code] ?? `Google Ads error: ${code}`;
}

/**
 * Converts a batch of Google API operation results into structured GoogleRowResult records.
 * Handles Google's partial failure mode where some rows succeed and others fail.
 */
export function parseGoogleBatchResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  batchResponse: any,
  batchOffset: number,
): GoogleRowResult[] {
  const results: GoogleRowResult[] = [];

  if (!batchResponse?.results) return results;

  for (let i = 0; i < batchResponse.results.length; i++) {
    const result = batchResponse.results[i];
    const partialFailure = batchResponse.partialFailureError?.details?.[i];

    if (partialFailure) {
      const errorCode = partialFailure.errors?.[0]?.errorCode
        ? Object.keys(partialFailure.errors[0].errorCode)[0]
        : 'UNKNOWN';
      results.push({
        row_index: batchOffset + i,
        status: 'rejected',
        error_code: errorCode,
        error_message: mapGoogleErrorCode(errorCode),
      });
    } else if (result) {
      results.push({
        row_index: batchOffset + i,
        status: 'uploaded',
        error_code: null,
        error_message: null,
      });
    }
  }

  return results;
}

// ── Google Ads conversion action fetcher (frontend stub) ──────────────────────

/**
 * Fetches available conversion actions from the Atlas backend, which
 * in turn queries the Google Ads API using the stored OAuth credentials.
 *
 * Implemented as a thin wrapper around the API route — no direct Google API
 * calls from the browser.
 *
 * Full implementation in Sprint 2 backend route:
 *   GET /api/offline-conversions/conversion-actions?provider_id=<id>
 */
export async function fetchConversionActions(
  _credentials: GoogleCredentials,
): Promise<GoogleConversionAction[]> {
  // Stub: returns empty array until Sprint 2 backend route is implemented.
  // The real implementation routes through the backend to avoid exposing tokens.
  return [];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Formats an ISO 8601 datetime string to Google Ads' required format:
 *   "yyyy-MM-dd HH:mm:sszzz" (with timezone offset, e.g. "+00:00")
 *
 * Google rejects fractional seconds and requires a space separator (not "T").
 */
export function formatGoogleDateTime(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date for Google Ads upload: "${isoString}"`);
  }

  const pad = (n: number, len = 2) => String(n).padStart(len, '0');

  const year    = d.getUTCFullYear();
  const month   = pad(d.getUTCMonth() + 1);
  const day     = pad(d.getUTCDate());
  const hours   = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+00:00`;
}

// ── Re-export types needed by consumers ───────────────────────────────────────

export type { GoogleConversionAction };
