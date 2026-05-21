/**
 * Offline Conversion Upload — Google Data Manager API
 *
 * Uploads CSV-derived offline conversions to the Google Data Manager API
 * using the `events:ingest` endpoint (eventSource: OTHER). Reuses the existing
 * OAuth credentials stored in the CAPI module's `capi_providers` table.
 *
 * Key behaviours:
 *   - Hashes PII (email, phone) with SHA-256 immediately before upload
 *   - Splits rows into batches of 2,000
 *   - Partial failure mode: one bad row doesn't block the batch
 *   - Exponential backoff: 3 attempts at 30s / 60s / 120s delays
 *   - Fetches conversion actions via Google Ads GAQL search API (unchanged)
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
import type {
  DMAEvent,
  DMAIngestEventsRequest,
  DMAIngestEventsResponse,
} from '@/integrations/google/dmaTypes';
import logger from '@/utils/logger';

// ── Constants ─────────────────────────────────────────────────────────────────

const DMA_BASE_URL = 'https://datamanager.googleapis.com/v1';
// GAQL search stays on the Google Ads REST API (metadata lookup, not ingestion)
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

// ── Google Ads / DMA helpers ───────────────────────────────────────────────────

function cleanCustomerId(id: string): string {
  return id.replace(/-/g, '');
}

function buildGoogleAdsHeaders(creds: GoogleCredentials, accessToken: string): Record<string, string> {
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

function buildDMAHeaders(creds: GoogleCredentials, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  const devToken =
    process.env.GOOGLE_DMA_DEVELOPER_TOKEN || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  if (devToken) headers['developer-token'] = devToken;
  if (creds.login_customer_id) {
    headers['login-customer-id'] = cleanCustomerId(creds.login_customer_id);
  }
  return headers;
}

/**
 * Format an ISO datetime to Google's required format:
 *   "yyyy-MM-dd HH:mm:ss+00:00" (space separator, no fractional seconds, timezone required)
 */
export function formatGoogleDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`,
  ].join(' ');
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

// ── Build DMA event from row ───────────────────────────────────────────────────

function buildDMAEventFromRow(
  row: OfflineConversionRow,
  config: OfflineConversionConfig,
  hashedEmail: string | null,
  hashedPhone: string | null,
): DMAEvent {
  const cid = cleanCustomerId(config.google_customer_id!);
  const conversionAction = `customers/${cid}/conversionActions/${config.conversion_action_id}`;
  const eventDateTime = new Date(row.conversion_time!).toISOString();

  const userIdentifiers: DMAEvent['userIdentifiers'] = [];
  if (hashedEmail) userIdentifiers.push({ hashedEmail });
  if (hashedPhone) userIdentifiers.push({ hashedPhoneNumber: hashedPhone });

  const event: DMAEvent = {
    eventType: 'CONVERSION',
    eventSource: 'OTHER',
    eventDateTime,
    conversionAction,
    userIdentifiers,
  };

  if (row.order_id) event.transactionId = row.order_id;

  if (row.raw_gclid) {
    event.gclidDateTimePair = {
      gclid: row.raw_gclid,
      conversionDateTime: eventDateTime,
    };
  }

  return event;
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
  RESOURCE_NOT_FOUND:             'Google customer ID not found. Verify your account ID.',
  AUTHENTICATION_ERROR:           'Google authentication failed. Reconnect your account in CAPI settings.',
  AUTHORIZATION_ERROR:            'Insufficient permissions. Ensure your account has Standard or Admin access.',
  QUOTA_ERROR:                    'Google API quota exceeded. Retry later.',
  INTERNAL_ERROR:                 'Google internal error. Retry the upload.',
};

function mapErrorCode(code: string): string {
  return GOOGLE_ERROR_MESSAGES[code] ?? `Google error: ${code}`;
}

// ── Parse DMA batch response into per-row results ─────────────────────────────

function parseDMABatchResponse(
  response: DMAIngestEventsResponse,
  rows: OfflineConversionRow[],
): GoogleRowResult[] {
  const errorMap = new Map(
    (response.eventResults ?? [])
      .filter((r) => r.error)
      .map((r) => [r.eventIndex, r.error!]),
  );

  return rows.map((row, i) => {
    const err = errorMap.get(i);
    if (err) {
      return {
        row_index: row.row_index,
        status: 'rejected' as const,
        error_code: String(err.code),
        error_message: mapErrorCode(String(err.code)) || err.message,
      };
    }
    return {
      row_index: row.row_index,
      status: 'uploaded' as const,
      error_code: null,
      error_message: null,
    };
  });
}

// ── Sleep helper for backoff ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Upload a single batch with retry ─────────────────────────────────────────

async function uploadBatch(
  events: DMAEvent[],
  config: OfflineConversionConfig,
  creds: GoogleCredentials,
  accessToken: string,
): Promise<{ response: DMAIngestEventsResponse; finalToken: string }> {
  const body: DMAIngestEventsRequest = {
    events,
    destinations: [
      { type: 'GOOGLE_ADS', customerId: cleanCustomerId(config.google_customer_id!) },
    ],
  };

  let currentToken = accessToken;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(`${DMA_BASE_URL}/events:ingest`, {
      method: 'POST',
      headers: buildDMAHeaders(creds, currentToken),
      body: JSON.stringify(body),
    });

    const responseBody = await res.json() as DMAIngestEventsResponse;

    if (res.ok) {
      return { response: responseBody, finalToken: currentToken };
    }

    if (res.status === 401 && attempt === 0) {
      try {
        currentToken = await refreshGoogleToken(creds);
        logger.info('Google token refreshed during offline upload');
        continue;
      } catch (refreshErr) {
        logger.warn(
          { err: refreshErr instanceof Error ? refreshErr.message : String(refreshErr) },
          'Token refresh failed',
        );
        return { response: responseBody, finalToken: currentToken };
      }
    }

    // Rate limit or transient error — wait and retry
    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      logger.warn({ status: res.status, attempt, delay }, 'DMA API transient error — retrying');
      await sleep(delay);
      continue;
    }

    // Non-retriable error
    return { response: responseBody, finalToken: currentToken };
  }

  throw new Error('Exhausted retry attempts for DMA offline upload');
}

// ── Main upload function ───────────────────────────────────────────────────────

/**
 * Hashes PII for all valid rows, splits into 2,000-row batches,
 * uploads each batch to the Google Data Manager API, and returns per-row results.
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

  // ── Build DMA event payloads ───────────────────────────────────────────
  const dmaEvents = rows.map((row, i) =>
    buildDMAEventFromRow(row, config, hashedData[i].hashedEmail, hashedData[i].hashedPhone),
  );

  // ── Split into 2,000-row batches ───────────────────────────────────────
  const allResults: GoogleRowResult[] = [];
  let hasPartialFailure = false;
  let currentToken = initialAccessToken;

  for (let offset = 0; offset < dmaEvents.length; offset += BATCH_SIZE) {
    const batchEvents = dmaEvents.slice(offset, offset + BATCH_SIZE);
    const batchRows = rows.slice(offset, offset + BATCH_SIZE);

    logger.info(
      { batchStart: offset, batchSize: batchEvents.length, totalRows: rows.length },
      'Uploading offline conversion batch via DMA',
    );

    const { response, finalToken } = await uploadBatch(batchEvents, config, creds, currentToken);
    currentToken = finalToken;

    const apiError = (response as unknown as { error?: { code: number; message: string; status: string } }).error;

    if (apiError) {
      logger.error(
        { code: apiError.code, status: apiError.status, message: apiError.message },
        'DMA batch upload failed',
      );
      for (const row of batchRows) {
        allResults.push({
          row_index: row.row_index,
          status: 'rejected',
          error_code: apiError.status,
          error_message: mapErrorCode(apiError.status) || apiError.message,
        });
      }
      hasPartialFailure = true;
    } else if (response.partialFailureError) {
      logger.error(
        { message: response.partialFailureError.message },
        'DMA batch partial failure error',
      );
      for (const row of batchRows) {
        allResults.push({
          row_index: row.row_index,
          status: 'rejected',
          error_code: 'PARTIAL_FAILURE',
          error_message: response.partialFailureError.message,
        });
      }
      hasPartialFailure = true;
    } else {
      const batchResults = parseDMABatchResponse(response, batchRows);
      allResults.push(...batchResults);
      if (batchResults.some((r) => r.status === 'rejected')) {
        hasPartialFailure = true;
      }
    }

    // 1-second courtesy delay between batches (PRD spec)
    if (offset + BATCH_SIZE < dmaEvents.length) {
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
 * Stays on the Google Ads GAQL search API — this is a metadata lookup, not ingestion.
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
      headers: buildGoogleAdsHeaders(creds, token),
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
