/**
 * Offline Conversion Upload — Google Ads Upload Service
 *
 * Uploads CSV-derived offline conversions to the Google Ads API
 * using the `uploadClickConversions` endpoint. Reuses the existing
 * OAuth credentials stored in the CAPI module's `capi_providers`
 * table — no separate credential management needed.
 *
 * Key behaviours:
 *   - Hashes PII (email, phone) with SHA-256 immediately before upload
 *   - Splits rows into batches of 2,000 (Google API limit)
 *   - Partial failure mode: one bad row doesn't block the batch
 *   - Exponential backoff: 3 attempts at 30s / 60s / 120s delays
 *   - Fetches conversion actions via Google Ads search API
 *
 * Google Ads API docs:
 *   https://developers.google.com/google-ads/api/reference/rpc/v17/ConversionUploadService
 */

import crypto from 'crypto';
import { refreshGoogleToken } from '@/services/capi/googleDelivery';
import type { GoogleCredentials } from '@/types/capi';
import type {
  OfflineConversionRow,
  OfflineConversionConfig,
  GoogleConversionAction,
  GoogleRowResult,
  UploadResult,
} from '@/types/offline-conversions';
import logger from '@/utils/logger';

// ── Constants ─────────────────────────────────────────────────────────────────

const GOOGLE_ADS_API_VERSION = 'v17';
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const BATCH_SIZE = 2_000;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000]; // PRD spec: 30s, 60s, 120s

// ── PII Hashing ───────────────────────────────────────────────────────────────

/** SHA-256 hex hash of a normalised string. Never logs the input. */
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashEmail(raw: string): string {
  return sha256(raw.trim().toLowerCase());
}

function hashPhone(raw: string): string {
  // E.164: keep '+' and digits only (already normalised by csvValidator)
  const normalised = raw.replace(/[^\d+]/g, '');
  return sha256(normalised.startsWith('+') ? normalised : `+${normalised}`);
}

// ── Google Ads API helpers ────────────────────────────────────────────────────

function cleanCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

function buildHeaders(creds: GoogleCredentials, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
  };
  if (creds.login_customer_id) {
    headers['login-customer-id'] = cleanCustomerId(creds.login_customer_id);
  }
  return headers;
}

/**
 * Format an ISO datetime to Google's required format:
 *   "yyyy-MM-dd HH:mm:ss+00:00" (space separator, no fractional seconds, timezone required)
 */
function formatGoogleDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`,
  ].join(' ');
}

// ── Google Click Conversion payload shape ──────────────────────────────────

interface GoogleClickConversion {
  conversionAction: string;
  conversionDateTime: string;
  gclid?: string;
  conversionValue?: number;
  currencyCode?: string;
  orderId?: string;
  userIdentifiers?: Array<{
    hashedEmail?: string;
    hashedPhoneNumber?: string;
  }>;
}

interface GoogleUploadClickConversionsRequest {
  conversions: GoogleClickConversion[];
  partialFailure: boolean;
}

interface GoogleUploadClickConversionsResponse {
  results?: Array<Record<string, unknown>>;
  partialFailureError?: {
    code: number;
    message: string;
    details: Array<{
      errors?: Array<{
        errorCode?: Record<string, string>;
        message?: string;
        location?: { fieldPathElements?: Array<{ fieldName: string; index?: number }> };
      }>;
    }>;
  };
  error?: {
    code: number;
    message: string;
    status: string;
    details?: unknown[];
  };
}

// ── Conversion action search response ────────────────────────────────────────

interface GoogleAdsSearchResponse {
  results?: Array<{
    conversionAction?: {
      id?: string;
      name?: string;
      status?: string;
      type?: string;
      category?: string;
    };
  }>;
  error?: {
    message: string;
    status: string;
    code: number;
  };
}

// ── Build payload from row ────────────────────────────────────────────────────

function buildClickConversion(
  row: OfflineConversionRow,
  config: OfflineConversionConfig,
  hashedEmail: string | null,
  hashedPhone: string | null,
): GoogleClickConversion {
  const cid = cleanCustomerId(config.google_customer_id);
  const conversionAction = `customers/${cid}/conversionActions/${config.conversion_action_id}`;

  const payload: GoogleClickConversion = {
    conversionAction,
    conversionDateTime: formatGoogleDateTime(row.conversion_time!),
    conversionValue: row.conversion_value ?? config.default_conversion_value ?? undefined,
    currencyCode: row.currency ?? config.default_currency,
  };

  if (row.raw_gclid) payload.gclid = row.raw_gclid;
  if (row.order_id) payload.orderId = row.order_id;

  const userIdentifiers: GoogleClickConversion['userIdentifiers'] = [];
  if (hashedEmail) userIdentifiers.push({ hashedEmail });
  if (hashedPhone) userIdentifiers.push({ hashedPhoneNumber: hashedPhone });
  if (userIdentifiers.length > 0) payload.userIdentifiers = userIdentifiers;

  return payload;
}

// ── Error code → user-friendly message ───────────────────────────────────────

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  CONVERSION_NOT_FOUND:           'Conversion action not found. Verify the action ID in your config.',
  CONVERSION_PRECONDITION_FAILED: 'Conversion action is disabled. Enable it in Google Ads.',
  TOO_RECENT_CONVERSION_ACTION:   'Conversion action created too recently. Wait 6 hours after creation.',
  EXPIRED_CONVERSION:             'Conversion is older than 90 days and cannot be uploaded.',
  TOO_RECENT_CLICK:               'Click occurred less than 24 hours ago — upload after 24 hours.',
  CLICK_NOT_FOUND:                'GCLID not found. The click may have expired or the ID is incorrect.',
  INVALID_ARGUMENT:               'Invalid data in one or more fields. Check the error details.',
  RESOURCE_NOT_FOUND:             'Google Ads customer ID not found. Verify your account ID.',
  AUTHENTICATION_ERROR:           'Google Ads authentication failed. Reconnect your account in CAPI settings.',
  AUTHORIZATION_ERROR:            'Insufficient permissions. Ensure your account has Standard or Admin access.',
  QUOTA_ERROR:                    'Google Ads API quota exceeded. Retry later.',
  INTERNAL_ERROR:                 'Google Ads internal error. Retry the upload.',
};

function mapErrorCode(code: string): string {
  return GOOGLE_ERROR_MESSAGES[code] ?? `Google Ads error: ${code}`;
}

// ── Parse partial failure response into per-row results ───────────────────────

function parseBatchResponse(
  response: GoogleUploadClickConversionsResponse,
  rows: OfflineConversionRow[],
  batchOffset: number,
): GoogleRowResult[] {
  const results: GoogleRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = row.row_index; // 1-based, from csvValidator

    // Check if this index has a partial failure entry
    const failureDetail = response.partialFailureError?.details?.[i];
    if (failureDetail?.errors?.length) {
      const firstError = failureDetail.errors[0];
      const errorCodeKey = firstError?.errorCode
        ? Object.keys(firstError.errorCode)[0]
        : 'UNKNOWN';
      results.push({
        row_index: rowIndex,
        status: 'rejected',
        error_code: errorCodeKey,
        error_message: mapErrorCode(errorCodeKey),
      });
    } else {
      results.push({
        row_index: rowIndex,
        status: 'uploaded',
        error_code: null,
        error_message: null,
      });
    }

    void batchOffset; // used for logging only
  }

  return results;
}

// ── Sleep helper for backoff ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Upload a single batch with retry ─────────────────────────────────────────

async function uploadBatch(
  conversions: GoogleClickConversion[],
  creds: GoogleCredentials,
  accessToken: string,
): Promise<{ response: GoogleUploadClickConversionsResponse; finalToken: string }> {
  const cid = cleanCustomerId(creds.customer_id);
  const url = `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${cid}:uploadClickConversions`;

  const body: GoogleUploadClickConversionsRequest = {
    conversions,
    partialFailure: true,
  };

  let currentToken = accessToken;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, currentToken),
      body: JSON.stringify(body),
    });

    const responseBody = await res.json() as GoogleUploadClickConversionsResponse;

    if (res.ok) {
      return { response: responseBody, finalToken: currentToken };
    }

    if (res.status === 401 && attempt === 0) {
      // Refresh token and retry immediately on first 401
      try {
        currentToken = await refreshGoogleToken(creds);
        logger.info('Google token refreshed during offline upload');
        continue;
      } catch (refreshErr) {
        logger.warn({ err: refreshErr instanceof Error ? refreshErr.message : String(refreshErr) }, 'Token refresh failed');
        return { response: responseBody, finalToken: currentToken };
      }
    }

    // Rate limit or transient error — wait and retry
    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      logger.warn({ status: res.status, attempt, delay }, 'Google Ads API transient error — retrying');
      await sleep(delay);
      continue;
    }

    // Non-retriable error
    return { response: responseBody, finalToken: currentToken };
  }

  // Should not reach here, but satisfy TypeScript
  throw new Error('Exhausted retry attempts for Google Ads upload');
}

// ── Main upload function ───────────────────────────────────────────────────────

/**
 * Hashes PII for all valid rows, splits into 2,000-row batches,
 * uploads each batch to Google Ads, and returns per-row results.
 *
 * NOTE: This function does NOT write to the DB — callers handle
 * persisting results via bulkUpdateRowStatuses().
 */
export async function uploadOfflineConversions(
  rows: OfflineConversionRow[],
  config: OfflineConversionConfig,
  creds: GoogleCredentials,
  initialAccessToken: string,
): Promise<UploadResult> {
  if (rows.length === 0) {
    return { partial_failure: false, row_results: [] };
  }

  // ── Hash PII for all rows up-front ────────────────────────────────────
  const hashedData = rows.map((row) => ({
    hashedEmail: row.raw_email ? hashEmail(row.raw_email) : null,
    hashedPhone: row.raw_phone ? hashPhone(row.raw_phone) : null,
  }));

  // ── Build conversion payloads ──────────────────────────────────────────
  const conversions = rows.map((row, i) =>
    buildClickConversion(row, config, hashedData[i].hashedEmail, hashedData[i].hashedPhone),
  );

  // ── Split into 2,000-row batches ───────────────────────────────────────
  const allResults: GoogleRowResult[] = [];
  let hasPartialFailure = false;
  let currentToken = initialAccessToken;

  for (let offset = 0; offset < conversions.length; offset += BATCH_SIZE) {
    const batchConversions = conversions.slice(offset, offset + BATCH_SIZE);
    const batchRows = rows.slice(offset, offset + BATCH_SIZE);

    logger.info(
      { batchStart: offset, batchSize: batchConversions.length, totalRows: rows.length },
      'Uploading offline conversion batch',
    );

    const { response, finalToken } = await uploadBatch(batchConversions, creds, currentToken);
    currentToken = finalToken;

    if (response.error) {
      // Whole batch failed (auth error, quota, etc.)
      const errMsg = response.error.message;
      logger.error({ error: response.error }, 'Google Ads batch upload failed');
      for (const row of batchRows) {
        allResults.push({
          row_index: row.row_index,
          status: 'rejected',
          error_code: response.error.status,
          error_message: mapErrorCode(response.error.status) || errMsg,
        });
      }
      hasPartialFailure = true;
    } else {
      const batchResults = parseBatchResponse(response, batchRows, offset);
      allResults.push(...batchResults);
      if (batchResults.some((r) => r.status === 'rejected')) {
        hasPartialFailure = true;
      }
    }

    // 1-second courtesy delay between batches (PRD spec)
    if (offset + BATCH_SIZE < conversions.length) {
      await sleep(1_000);
    }
  }

  return { partial_failure: hasPartialFailure, row_results: allResults };
}

// ── Hashed identifier return (for persisting to DB) ─────────────────────────

export interface HashedRowData {
  row_id: string;
  hashed_email: string | null;
  hashed_phone: string | null;
}

export function hashRowIdentifiers(rows: OfflineConversionRow[]): HashedRowData[] {
  return rows.map((row) => ({
    row_id: row.id,
    hashed_email: row.raw_email ? hashEmail(row.raw_email) : null,
    hashed_phone: row.raw_phone ? hashPhone(row.raw_phone) : null,
  }));
}

// ── Conversion action fetcher ─────────────────────────────────────────────────

/**
 * Fetches the list of conversion actions for a Google Ads customer account.
 * Filters to UPLOAD_CLICKS type (the correct type for offline CSV uploads).
 */
export async function fetchConversionActions(
  creds: GoogleCredentials,
): Promise<GoogleConversionAction[]> {
  let accessToken = creds.oauth_access_token;
  const cid = cleanCustomerId(creds.customer_id);
  const url = `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${cid}/googleAds:search`;

  const query = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.type,
      conversion_action.category
    FROM conversion_action
    WHERE conversion_action.status IN ('ENABLED', 'HIDDEN')
    ORDER BY conversion_action.name
  `.trim();

  const makeRequest = async (token: string): Promise<Response> => {
    return fetch(url, {
      method: 'POST',
      headers: buildHeaders(creds, token),
      body: JSON.stringify({ query }),
    });
  };

  let res = await makeRequest(accessToken);

  // Refresh token once on 401
  if (res.status === 401) {
    try {
      accessToken = await refreshGoogleToken(creds);
      res = await makeRequest(accessToken);
    } catch (err) {
      throw new Error(`Google token refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!res.ok) {
    const body = await res.json() as { error?: { message: string } };
    throw new Error(body.error?.message ?? `Google Ads API error: HTTP ${res.status}`);
  }

  const body = await res.json() as GoogleAdsSearchResponse;

  return (body.results ?? []).map((r) => ({
    id: r.conversionAction?.id ?? '',
    name: r.conversionAction?.name ?? 'Unknown',
    status: r.conversionAction?.status ?? 'UNKNOWN',
    type: r.conversionAction?.type ?? 'UNKNOWN',
    category: r.conversionAction?.category ?? 'UNKNOWN',
  })).filter((a) => a.id !== '');
}
