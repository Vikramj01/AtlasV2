/**
 * Offline Conversion Upload — CSV Validation Service
 *
 * Parses a CSV file buffer and validates each row against all rules
 * defined in the PRD. Does NOT hash PII — raw values are stored
 * separately from hashed values, with raw fields purged after upload.
 *
 * Validation rules:
 *   - At least one identifier (gclid or email)
 *   - Email format: basic regex, then lowercase + trim
 *   - Phone: strip formatting, apply E.164 (requires country code)
 *   - Conversion time: ISO 8601 / common formats, reject future & >90 days
 *   - Conversion value: positive number
 *   - Currency: ISO 4217 (3-letter code)
 *   - Within-upload deduplication (GCLID+time within 60s, or order_id)
 */

import { parse } from 'csv-parse/sync';
import type { ColumnMapping, ValidationIssue, InsertRowInput, OfflineRowStatus } from '@/types/offline-conversions';

// ── ISO 4217 currency codes (common subset) ────────────────────────────────

const VALID_CURRENCIES = new Set([
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
  'BAM','BBD','BDT','BGN','BHD','BMD','BND','BOB','BRL','BSD',
  'BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP',
  'CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN',
  'ETB','EUR','FJD','GBP','GEL','GHS','GIP','GMD','GTQ','GYD',
  'HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR',
  'ISK','JMD','JOD','JPY','KES','KGS','KHR','KRW','KWD','KYD',
  'KZT','LAK','LBP','LKR','LRD','LYD','MAD','MDL','MKD','MMK',
  'MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD',
  'NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP',
  'PKR','PLN','PYG','QAR','RON','RSD','RUB','SAR','SBD','SCR',
  'SDG','SEK','SGD','SLL','SOS','SRD','STN','SVC','SYP','SZL',
  'THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH',
  'UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD',
  'XOF','XPF','YER','ZAR','ZMW','ZWL',
]);

// ── 90-day lookback window ─────────────────────────────────────────────────

const MAX_LOOKBACK_DAYS = 90;
const WARN_LOOKBACK_DAYS = 60;
const DEDUP_WINDOW_MS = 60 * 1000; // 60 seconds

// ── Validated row shape (before DB insert) ────────────────────────────────

export interface ParsedRow {
  rowIndex: number;
  rawEmail: string | null;
  rawPhone: string | null;
  rawGclid: string | null;
  conversionTime: Date | null;
  conversionValue: number | null;
  currency: string | null;
  orderId: string | null;
  status: OfflineRowStatus;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Normalisation helpers ─────────────────────────────────────────────────

function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  // Basic RFC 5322 subset — not exhaustive, by design
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Strips all non-digit characters then prepends '+' if missing.
 * Does NOT add a country code — that's a user responsibility.
 * Returns null if the result is fewer than 7 digits (clearly not a phone number).
 */
function normalisePhone(raw: string): string | null {
  const stripped = raw.replace(/[^\d+]/g, '');
  const digits = stripped.replace(/^\+/, '');
  if (digits.length < 7) return null;
  return stripped.startsWith('+') ? stripped : `+${digits}`;
}

/**
 * Parse a date string flexibly:
 *   - ISO 8601 (2026-04-01T12:00:00Z)
 *   - Date only (2026-04-01) → treated as UTC midnight
 *   - Common US format (04/01/2026)
 *   - Common EU format (01.04.2026)
 *
 * Returns null if parsing fails.
 */
function parseConversionTime(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ISO 8601 with time
  let d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  // Date-only: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    d = new Date(`${trimmed}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(trimmed);
  if (usMatch) {
    d = new Date(`${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  // DD.MM.YYYY
  const euMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(trimmed);
  if (euMatch) {
    d = new Date(`${euMatch[3]}-${euMatch[2].padStart(2, '0')}-${euMatch[1].padStart(2, '0')}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function parseConversionValue(raw: string): number | null {
  // Strip currency symbols and whitespace, then parse
  const cleaned = raw.replace(/[^0-9.,\-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function normaliseCurrency(raw: string): string {
  return raw.trim().toUpperCase();
}

// ── Main validation function ───────────────────────────────────────────────

export interface ValidationResult {
  rows: ParsedRow[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  allErrors: ValidationIssue[];
  allWarnings: ValidationIssue[];
}

export function validateCsvBuffer(
  buffer: Buffer,
  mapping: ColumnMapping,
  defaultCurrency: string,
  defaultValue: number | null,
): ValidationResult {
  const now = new Date();
  const maxAge = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const warnAge = new Date(now.getTime() - WARN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // ── Parse CSV ────────────────────────────────────────────────────────────

  let records: Record<string, string>[];
  try {
    records = parse(buffer, {
      columns: true,        // Use first row as headers
      skip_empty_lines: true,
      trim: true,
      bom: true,            // Handle BOM from Excel exports
    }) as Record<string, string>[];
  } catch (err) {
    throw new Error(`CSV parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Helper: resolve column value via mapping ──────────────────────────

  function col(record: Record<string, string>, field: keyof ColumnMapping): string {
    const header = mapping[field];
    if (!header) return '';
    return record[header]?.trim() ?? '';
  }

  // ── Within-upload dedup tracking ──────────────────────────────────────

  const seenOrderIds = new Set<string>();
  // Map of "gclid:conversionMinute" → row index for GCLID+time dedup
  const seenGclidTimes = new Map<string, number>();

  // ── Validate each row ─────────────────────────────────────────────────

  const parsedRows: ParsedRow[] = [];
  const allErrors: ValidationIssue[] = [];
  const allWarnings: ValidationIssue[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNum = i + 1; // 1-based, header excluded
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // ── Extract raw values ─────────────────────────────────────────────

    const rawGclidRaw = col(record, 'gclid');
    const rawEmailRaw = col(record, 'email');
    const rawPhoneRaw = col(record, 'phone');
    const rawTime = col(record, 'conversion_time');
    const rawValue = col(record, 'conversion_value');
    const rawCurrency = col(record, 'currency');
    const rawOrderId = col(record, 'order_id');

    const rawGclid = rawGclidRaw || null;
    const rawOrderId_ = rawOrderId || null;

    // ── Identifier check ───────────────────────────────────────────────

    if (!rawGclidRaw && !rawEmailRaw) {
      errors.push({
        row: rowNum,
        field: 'identifier',
        code: 'MISSING_IDENTIFIER',
        message: 'Each row must have at least a GCLID or email address.',
      });
    }

    // ── Email validation ───────────────────────────────────────────────

    let rawEmail: string | null = null;
    if (rawEmailRaw) {
      const norm = normaliseEmail(rawEmailRaw);
      if (!isValidEmail(norm)) {
        errors.push({
          row: rowNum,
          field: 'email',
          code: 'INVALID_EMAIL',
          message: `"${rawEmailRaw}" is not a valid email address.`,
        });
      } else {
        rawEmail = norm;
        if (!rawGclidRaw) {
          warnings.push({
            row: rowNum,
            field: 'email',
            code: 'NO_GCLID_LOWER_MATCH_RATE',
            message: 'No GCLID present — email-only matching achieves ~30–50% match rate vs ~90% with GCLID.',
          });
        }
      }
    }

    // ── Phone validation ───────────────────────────────────────────────

    let rawPhone: string | null = null;
    if (rawPhoneRaw) {
      const norm = normalisePhone(rawPhoneRaw);
      if (!norm) {
        warnings.push({
          row: rowNum,
          field: 'phone',
          code: 'INVALID_PHONE',
          message: `"${rawPhoneRaw}" could not be normalised to E.164 format — it will be skipped.`,
        });
      } else {
        rawPhone = norm;
        if (!norm.startsWith('+') || norm.length < 8) {
          warnings.push({
            row: rowNum,
            field: 'phone',
            code: 'MISSING_COUNTRY_CODE',
            message: 'Phone number may be missing a country code, which can reduce match accuracy.',
          });
        }
      }
    }

    // ── Conversion time ────────────────────────────────────────────────

    let conversionTime: Date | null = null;
    if (!rawTime) {
      errors.push({
        row: rowNum,
        field: 'conversion_time',
        code: 'MISSING_CONVERSION_TIME',
        message: 'Conversion time is required.',
      });
    } else {
      conversionTime = parseConversionTime(rawTime);
      if (!conversionTime) {
        errors.push({
          row: rowNum,
          field: 'conversion_time',
          code: 'INVALID_DATE_FORMAT',
          message: `"${rawTime}" could not be parsed as a date. Use ISO 8601 (e.g. 2026-04-01T12:00:00Z) or YYYY-MM-DD.`,
        });
      } else if (conversionTime > now) {
        errors.push({
          row: rowNum,
          field: 'conversion_time',
          code: 'FUTURE_DATE',
          message: `Conversion time "${rawTime}" is in the future.`,
        });
        conversionTime = null;
      } else if (conversionTime < maxAge) {
        errors.push({
          row: rowNum,
          field: 'conversion_time',
          code: 'EXPIRED_CONVERSION',
          message: `Conversion time "${rawTime}" is older than 90 days and will be rejected by Google Ads.`,
        });
        conversionTime = null;
      } else if (conversionTime < warnAge) {
        warnings.push({
          row: rowNum,
          field: 'conversion_time',
          code: 'OLD_CONVERSION_LOWER_MATCH',
          message: `Conversion is older than 60 days — Google may have lower match rates for older conversions.`,
        });
      }
    }

    // ── Conversion value ───────────────────────────────────────────────

    let conversionValue: number | null = null;
    if (rawValue) {
      const parsed = parseConversionValue(rawValue);
      if (parsed === null) {
        errors.push({
          row: rowNum,
          field: 'conversion_value',
          code: 'INVALID_VALUE',
          message: `"${rawValue}" is not a valid number.`,
        });
      } else if (parsed <= 0) {
        errors.push({
          row: rowNum,
          field: 'conversion_value',
          code: 'NON_POSITIVE_VALUE',
          message: 'Conversion value must be greater than zero.',
        });
      } else {
        conversionValue = parsed;
      }
    } else if (defaultValue !== null) {
      conversionValue = defaultValue;
    }

    // ── Currency ───────────────────────────────────────────────────────

    let currency: string | null = null;
    if (rawCurrency) {
      const norm = normaliseCurrency(rawCurrency);
      if (!VALID_CURRENCIES.has(norm)) {
        errors.push({
          row: rowNum,
          field: 'currency',
          code: 'INVALID_CURRENCY',
          message: `"${rawCurrency}" is not a valid ISO 4217 currency code.`,
        });
      } else {
        currency = norm;
      }
    } else {
      currency = defaultCurrency;
    }

    // ── Within-upload deduplication ────────────────────────────────────

    let isDuplicate = false;

    if (rawOrderId_) {
      if (seenOrderIds.has(rawOrderId_)) {
        isDuplicate = true;
        errors.push({
          row: rowNum,
          field: 'order_id',
          code: 'DUPLICATE_ORDER_ID',
          message: `Order ID "${rawOrderId_}" was already seen in this upload.`,
        });
      } else {
        seenOrderIds.add(rawOrderId_);
      }
    }

    if (!isDuplicate && rawGclid && conversionTime) {
      // Bucket by minute (60-second window)
      const timeKey = Math.floor(conversionTime.getTime() / DEDUP_WINDOW_MS);
      const key = `${rawGclid}:${timeKey}`;
      if (seenGclidTimes.has(key)) {
        isDuplicate = true;
        errors.push({
          row: rowNum,
          field: 'gclid',
          code: 'DUPLICATE_GCLID_TIME',
          message: `This GCLID and conversion time combination was already seen in this upload (within 60 seconds of row ${seenGclidTimes.get(key)}).`,
        });
      } else {
        seenGclidTimes.set(key, rowNum);
      }
    }

    // ── Determine row status ───────────────────────────────────────────

    let status: OfflineRowStatus;
    if (isDuplicate) {
      status = 'duplicate';
      duplicateCount++;
    } else if (errors.length > 0) {
      status = 'invalid';
      invalidCount++;
    } else {
      status = 'valid';
      validCount++;
    }

    allErrors.push(...errors);
    allWarnings.push(...warnings);

    parsedRows.push({
      rowIndex: rowNum,
      rawEmail,
      rawPhone,
      rawGclid,
      conversionTime,
      conversionValue,
      currency,
      orderId: rawOrderId_,
      status,
      errors,
      warnings,
    });
  }

  return {
    rows: parsedRows,
    validCount,
    invalidCount,
    duplicateCount,
    allErrors,
    allWarnings,
  };
}

// ── Convert ParsedRow → InsertRowInput ──────────────────────────────────────

export function toInsertInput(
  row: ParsedRow,
  uploadId: string,
  organizationId: string,
): InsertRowInput {
  return {
    upload_id: uploadId,
    organization_id: organizationId,
    row_index: row.rowIndex,
    raw_email: row.rawEmail,
    raw_phone: row.rawPhone,
    raw_gclid: row.rawGclid,
    hashed_email: null,   // hashed at confirm time, not validation
    hashed_phone: null,
    conversion_time: row.conversionTime?.toISOString() ?? null,
    conversion_value: row.conversionValue,
    currency: row.currency,
    order_id: row.orderId,
    status: row.status,
    validation_errors: row.errors.length > 0 ? row.errors : null,
    validation_warnings: row.warnings.length > 0 ? row.warnings : null,
  };
}

// ── CSV Template ──────────────────────────────────────────────────────────────

/**
 * Generates the CSV template header row + example data rows.
 * These are the suggested column names — users can remap them
 * to their CRM's actual export headers in the column mapping step.
 */
export const CSV_TEMPLATE_HEADERS = [
  'Click ID (GCLID)',
  'Email Address',
  'Phone',
  'Conversion Date',
  'Deal Value',
  'Currency',
  'Order ID',
] as const;

export const CSV_TEMPLATE_EXAMPLE_ROWS = [
  ['EAlAKENy...', 'jane.smith@acme.com', '+14155551234', '2026-03-15T14:30:00Z', '4500.00', 'USD', 'DEAL-001'],
  ['', 'john.doe@example.com', '+447911123456', '2026-03-20', '12000', 'GBP', 'DEAL-002'],
];

export function generateCsvTemplate(): string {
  const rows = [
    CSV_TEMPLATE_HEADERS.join(','),
    ...CSV_TEMPLATE_EXAMPLE_ROWS.map((row) => row.join(',')),
  ];
  return rows.join('\r\n') + '\r\n';
}

/**
 * Default column mapping that assumes the user downloaded the Atlas template.
 */
export const DEFAULT_COLUMN_MAPPING: Record<string, string> = {
  gclid: 'Click ID (GCLID)',
  email: 'Email Address',
  phone: 'Phone',
  conversion_time: 'Conversion Date',
  conversion_value: 'Deal Value',
  currency: 'Currency',
  order_id: 'Order ID',
};
