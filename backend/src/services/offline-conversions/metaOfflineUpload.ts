/**
 * Offline Conversion Upload — Meta CAPI Service
 *
 * Uploads CSV-derived offline conversions to the Meta Conversions API
 * using the standard `/events` endpoint with `action_source: "offline"`.
 *
 * Key differences from Google's uploadClickConversions:
 *   - Endpoint: POST https://graph.facebook.com/v19.0/{pixel_id}/events
 *   - Batch limit: 1,000 events (vs Google's 2,000)
 *   - Click ID field: `fbclid` (via user_data.fbc) not `gclid`
 *   - Deduplication: event_id = order_id (or row_index fallback)
 *   - Auth: long-lived access_token — no OAuth refresh cycle
 *   - PII fields: user_data.em (email) and user_data.ph (phone), SHA-256
 *
 * Meta Conversions API docs:
 *   https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 */

import crypto from 'crypto';
import type { MetaCredentials } from '@/types/capi';
import type {
  OfflineConversionRow,
  OfflineConversionConfig,
  UploadResult,
  GoogleRowResult,
} from '@/types/offline-conversions';
import logger from '@/utils/logger';

// ── Constants ─────────────────────────────────────────────────────────────────

const META_API_VERSION = 'v19.0';
const META_API_BASE = 'https://graph.facebook.com';
const META_BATCH_SIZE = 1_000;                        // Meta's per-request limit
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];    // Match Google retry schedule

// ── PII Hashing ───────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashEmail(raw: string): string {
  return sha256(raw.trim().toLowerCase());
}

function hashPhone(raw: string): string {
  // E.164: keep '+' and digits only
  const normalised = raw.replace(/[^\d+]/g, '');
  return sha256(normalised.startsWith('+') ? normalised : `+${normalised}`);
}

// ── Meta event payload shapes ─────────────────────────────────────────────────

interface MetaUserData {
  em?: string[];             // SHA-256 hashed email(s)
  ph?: string[];             // SHA-256 hashed phone(s)
  fbc?: string;              // Facebook Click ID (fbclid)
  external_id?: string[];    // hashed order_id for additional matching
}

interface MetaCustomData {
  value?: number;
  currency?: string;
  order_id?: string;
}

interface MetaOfflineEvent {
  event_name: string;         // e.g. 'Purchase', 'Lead'
  event_time: number;         // Unix timestamp
  action_source: 'offline';
  event_id?: string;          // for deduplication — use order_id when available
  user_data: MetaUserData;
  custom_data?: MetaCustomData;
}

interface MetaEventsRequest {
  data: MetaOfflineEvent[];
  access_token: string;
}

interface MetaEventsResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

// ── Build event payload from a single row ─────────────────────────────────────

function buildMetaEvent(
  row: OfflineConversionRow,
  eventName: string,
  hashedEmail: string | null,
  hashedPhone: string | null,
): MetaOfflineEvent {
  const userData: MetaUserData = {};

  if (hashedEmail) userData.em = [hashedEmail];
  if (hashedPhone) userData.ph = [hashedPhone];
  if (row.raw_fbclid) userData.fbc = row.raw_fbclid;

  // Use order_id as an additional match signal (hashed external_id)
  if (row.order_id) {
    userData.external_id = [sha256(row.order_id)];
  }

  const event: MetaOfflineEvent = {
    event_name: eventName,
    event_time: Math.floor(new Date(row.conversion_time!).getTime() / 1000),
    action_source: 'offline',
    user_data: userData,
  };

  // event_id for server-side dedup: prefer order_id, fall back to row index
  event.event_id = row.order_id ?? `row-${row.row_index}`;

  if (row.conversion_value != null || row.currency) {
    event.custom_data = {
      value: row.conversion_value ?? undefined,
      currency: row.currency ?? undefined,
      order_id: row.order_id ?? undefined,
    };
  }

  return event;
}

// ── Error code mapping ────────────────────────────────────────────────────────

const META_ERROR_MESSAGES: Record<number, string> = {
  100:  'Invalid parameter — check your pixel ID and event data.',
  190:  'Invalid or expired access token. Reconnect your Meta account in CAPI settings.',
  200:  'Permissions error. Ensure your token has ads_management permission.',
  368:  'Temporarily blocked due to policy violation.',
  803:  'Pixel not found. Verify your pixel ID.',
  2804: 'Event data does not match the expected format.',
};

function mapMetaError(code: number, message: string): string {
  return META_ERROR_MESSAGES[code] ?? message ?? `Meta CAPI error: ${code}`;
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Upload a single batch with retry ─────────────────────────────────────────

async function uploadBatch(
  events: MetaOfflineEvent[],
  creds: MetaCredentials,
): Promise<MetaEventsResponse> {
  const url = `${META_API_BASE}/${META_API_VERSION}/${creds.pixel_id}/events`;

  const body: MetaEventsRequest = {
    data: events,
    access_token: creds.access_token,
  };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const responseBody = await res.json() as MetaEventsResponse;

    if (res.ok) return responseBody;

    const errorCode = responseBody.error?.code ?? 0;

    // 190 = invalid token — Meta uses long-lived tokens, no refresh possible.
    // Surface the error immediately so the user knows to reconnect.
    if (errorCode === 190) {
      logger.error(
        { code: errorCode, message: responseBody.error?.message },
        'Meta access token invalid — cannot refresh, user must reconnect',
      );
      return responseBody;
    }

    // Rate limit (429) or transient server error (5xx) — retry with backoff
    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      logger.warn({ status: res.status, attempt, delay }, 'Meta CAPI transient error — retrying');
      await sleep(delay);
      continue;
    }

    // Non-retriable error
    return responseBody;
  }

  throw new Error('Exhausted retry attempts for Meta offline upload');
}

// ── Map batch response to per-row results ─────────────────────────────────────

function parseBatchResponse(
  response: MetaEventsResponse,
  rows: OfflineConversionRow[],
): GoogleRowResult[] {
  if (response.error) {
    // Whole batch rejected
    const errorCode = response.error.code;
    const errorMessage = mapMetaError(errorCode, response.error.message);
    return rows.map((row) => ({
      row_index: row.row_index,
      status: 'rejected',
      error_code: String(errorCode),
      error_message: errorMessage,
    }));
  }

  // Meta doesn't return per-event errors on 200 — if the batch succeeded,
  // all events in it are considered uploaded.
  return rows.map((row) => ({
    row_index: row.row_index,
    status: 'uploaded',
    error_code: null,
    error_message: null,
  }));
}

// ── Main upload function ───────────────────────────────────────────────────────

/**
 * Hashes PII for all valid rows, splits into 1,000-row batches,
 * uploads each batch to the Meta Conversions API with action_source=offline,
 * and returns per-row results using the same UploadResult shape as Google.
 *
 * NOTE: Does NOT write to the DB — callers persist results via bulkUpdateRowStatuses().
 */
export async function uploadMetaOfflineConversions(
  rows: OfflineConversionRow[],
  config: OfflineConversionConfig,
  creds: MetaCredentials,
): Promise<UploadResult> {
  if (rows.length === 0) {
    return { partial_failure: false, row_results: [] };
  }

  const eventName = config.meta_event_name ?? 'Purchase';

  // ── Hash PII up-front (never log the input) ───────────────────────────────
  const hashedData = rows.map((row) => ({
    hashedEmail: row.raw_email ? hashEmail(row.raw_email) : null,
    hashedPhone: row.raw_phone ? hashPhone(row.raw_phone) : null,
  }));

  // ── Build event payloads ───────────────────────────────────────────────────
  const events = rows.map((row, i) =>
    buildMetaEvent(row, eventName, hashedData[i].hashedEmail, hashedData[i].hashedPhone),
  );

  // ── Upload in 1,000-row batches ────────────────────────────────────────────
  const allResults: GoogleRowResult[] = [];
  let hasPartialFailure = false;

  for (let offset = 0; offset < events.length; offset += META_BATCH_SIZE) {
    const batchEvents = events.slice(offset, offset + META_BATCH_SIZE);
    const batchRows = rows.slice(offset, offset + META_BATCH_SIZE);

    logger.info(
      { batchStart: offset, batchSize: batchEvents.length, totalRows: rows.length },
      'Uploading Meta offline conversion batch',
    );

    const response = await uploadBatch(batchEvents, creds);
    const batchResults = parseBatchResponse(response, batchRows);

    allResults.push(...batchResults);

    if (batchResults.some((r) => r.status === 'rejected')) {
      hasPartialFailure = true;
    }

    // 1-second courtesy delay between batches
    if (offset + META_BATCH_SIZE < events.length) {
      await sleep(1_000);
    }
  }

  return { partial_failure: hasPartialFailure, row_results: allResults };
}

// ── Hashed identifier output (for persisting to DB) ───────────────────────────

export interface HashedRowData {
  row_id: string;
  hashed_email: string | null;
  hashed_phone: string | null;
}

export function hashMetaRowIdentifiers(rows: OfflineConversionRow[]): HashedRowData[] {
  return rows.map((row) => ({
    row_id: row.id,
    hashed_email: row.raw_email ? hashEmail(row.raw_email) : null,
    hashed_phone: row.raw_phone ? hashPhone(row.raw_phone) : null,
  }));
}
