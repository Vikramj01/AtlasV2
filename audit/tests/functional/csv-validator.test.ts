/**
 * Functional tests — Offline Conversion CSV Validator
 *
 * All scenarios test validateCsvBuffer directly — no HTTP, no DB, no queue.
 * We use DEFAULT_COLUMN_MAPPING with Atlas template column names.
 */

import { describe, it, expect } from 'vitest';
import { validateCsvBuffer, DEFAULT_COLUMN_MAPPING } from '../../../backend/src/services/offline-conversions/csvValidator';
import type { ColumnMapping } from '../../../backend/src/types/offline-conversions';

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAPPING = DEFAULT_COLUMN_MAPPING as unknown as ColumnMapping;
const DEFAULT_CURRENCY = 'GBP';
const DEFAULT_VALUE = null;

/** Build a CSV buffer from an array of row objects using the template headers. */
function makeCsv(rows: Array<Record<string, string>>): Buffer {
  const headers = [
    'Click ID (GCLID)',
    'Email Address',
    'Phone',
    'Conversion Date',
    'Deal Value',
    'Currency',
    'Order ID',
  ];
  const lines = [
    headers.join(','),
    ...rows.map(row => [
      row.gclid ?? '',
      row.email ?? '',
      row.phone ?? '',
      row.conversion_time ?? '',
      row.value ?? '',
      row.currency ?? '',
      row.order_id ?? '',
    ].join(',')),
  ];
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf-8');
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}

// ── Scenario 1: Valid row normalisation ────────────────────────────────────────

describe('Scenario 1 — Valid row passes and normalises fields', () => {
  it('accepts a well-formed row and lowercases email', () => {
    const csv = makeCsv([{
      gclid: 'abc123',
      email: 'USER@Example.COM',
      phone: '+447700900123',
      conversion_time: '2026-05-01T12:00:00Z',
      value: '99.99',
      currency: 'GBP',
      order_id: 'ORD-001',
    }]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(0);
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.status).toBe('valid');
    expect(row.rawEmail).toBe('user@example.com');          // lowercased
    expect(row.rawPhone).toBe('+447700900123');             // E.164 preserved
    expect(row.rawGclid).toBe('abc123');
    expect(row.conversionValue).toBe(99.99);
    expect(row.currency).toBe('GBP');
    expect(row.orderId).toBe('ORD-001');
    expect(row.errors).toHaveLength(0);
  });
});

// ── Scenario 2: Invalid email ──────────────────────────────────────────────────

describe('Scenario 2 — Invalid email produces INVALID_EMAIL error', () => {
  it('rejects email without @', () => {
    const csv = makeCsv([{
      gclid: 'abc123',
      email: 'notanemail',
      conversion_time: daysAgo(5),
      value: '10',
      currency: 'GBP',
    }]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.invalidCount).toBe(1);
    const emailErrors = result.allErrors.filter(e => e.code === 'INVALID_EMAIL');
    expect(emailErrors.length).toBeGreaterThan(0);
    expect(emailErrors[0].field).toBe('email');
  });
});

// ── Scenario 3: Conversion time > 90 days ago ─────────────────────────────────

describe('Scenario 3 — Conversion time > 90 days ago produces EXPIRED_CONVERSION error', () => {
  it('rejects a conversion time 95 days in the past', () => {
    const csv = makeCsv([{
      gclid: 'abc123',
      conversion_time: daysAgo(95),
      value: '50',
      currency: 'GBP',
    }]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.invalidCount).toBe(1);
    const expiredErrors = result.allErrors.filter(e => e.code === 'EXPIRED_CONVERSION');
    expect(expiredErrors.length).toBeGreaterThan(0);
    expect(expiredErrors[0].field).toBe('conversion_time');
  });
});

// ── Scenario 4: Future conversion time ────────────────────────────────────────

describe('Scenario 4 — Future conversion time produces FUTURE_DATE error', () => {
  it('rejects a conversion time 3 days from now', () => {
    const csv = makeCsv([{
      gclid: 'abc123',
      conversion_time: daysFromNow(3),
      value: '50',
      currency: 'GBP',
    }]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.invalidCount).toBe(1);
    const futureErrors = result.allErrors.filter(e => e.code === 'FUTURE_DATE');
    expect(futureErrors.length).toBeGreaterThan(0);
    expect(futureErrors[0].field).toBe('conversion_time');
  });
});

// ── Scenario 5: Formula injection ─────────────────────────────────────────────

describe("Scenario 5 — Formula injection in email field '=cmd|'", () => {
  it('either rejects or sanitises formula-injection attempt in email', () => {
    const csv = makeCsv([{
      gclid: 'abc123',
      email: "'=cmd|' /C calc'!A0",
      conversion_time: daysAgo(5),
      value: '10',
      currency: 'GBP',
    }]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    // The validator does not execute or sanitise the formula — the string will fail
    // the isValidEmail() regex because "'=cmd|' /C calc'!A0" has no proper domain.
    // Either: row is invalid (INVALID_EMAIL), OR rawEmail is stored as-is.
    // We verify at least ONE of these outcomes:
    const row = result.rows[0];
    const hasEmailError = row.errors.some(e => e.code === 'INVALID_EMAIL');
    const rawEmailStored = row.rawEmail;

    // Acceptable outcomes: the invalid email is rejected (row.rawEmail is null)
    //   OR it is rejected via INVALID_EMAIL error code.
    // We do NOT accept a row.status='valid' where rawEmail contains the injection payload.
    if (row.status === 'valid') {
      // If somehow marked valid, rawEmail must not contain the formula prefix
      expect(rawEmailStored).not.toMatch(/^'?=/);
    } else {
      // Should be flagged as invalid
      expect(hasEmailError).toBe(true);
    }

    // Report actual behaviour clearly
    console.info(
      `[Formula injection] row.status=${row.status} rawEmail=${rawEmailStored} errors=${JSON.stringify(row.errors.map(e => e.code))}`
    );
  });
});

// ── Scenario 6: Empty file ────────────────────────────────────────────────────

describe('Scenario 6 — Empty CSV produces no valid rows', () => {
  it('returns zero valid rows for a CSV with only a header', () => {
    // headers-only: no data rows
    const csv = Buffer.from(
      'Click ID (GCLID),Email Address,Phone,Conversion Date,Deal Value,Currency,Order ID\r\n',
      'utf-8',
    );

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.validCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('returns zero rows for a completely empty buffer (no header, no data)', () => {
    // csv-parse with columns:true on an empty buffer returns [] rather than throwing.
    // validateCsvBuffer therefore returns validCount=0 with an empty rows array.
    const empty = Buffer.from('', 'utf-8');
    const result = validateCsvBuffer(empty, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);
    expect(result.validCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});

// ── Scenario 7: Duplicate GCLID+time within upload ────────────────────────────

describe('Scenario 7 — Duplicate GCLID+time within same upload', () => {
  it('flags the second row as DUPLICATE_GCLID_TIME', () => {
    const sameTime = daysAgo(2);
    const csv = makeCsv([
      {
        gclid: 'dup-gclid-001',
        email: 'a@example.com',
        conversion_time: sameTime,
        value: '100',
        currency: 'GBP',
        order_id: 'ORD-A',
      },
      {
        gclid: 'dup-gclid-001',
        email: 'b@example.com',
        conversion_time: sameTime,   // same GCLID + within-60s window
        value: '100',
        currency: 'GBP',
        order_id: 'ORD-B',           // different order_id, so order dedup doesn't fire first
      },
    ]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.duplicateCount).toBe(1);
    const dupErrors = result.allErrors.filter(e => e.code === 'DUPLICATE_GCLID_TIME');
    expect(dupErrors.length).toBeGreaterThan(0);
    expect(dupErrors[0].field).toBe('gclid');
  });

  it('flags the second row as DUPLICATE_ORDER_ID when order_id repeats', () => {
    const csv = makeCsv([
      {
        gclid: 'gclid-x1',
        conversion_time: daysAgo(2),
        value: '100',
        currency: 'GBP',
        order_id: 'ORD-SAME',
      },
      {
        gclid: 'gclid-x2',
        conversion_time: daysAgo(3),
        value: '200',
        currency: 'GBP',
        order_id: 'ORD-SAME',   // same order_id
      },
    ]);

    const result = validateCsvBuffer(csv, MAPPING, DEFAULT_CURRENCY, DEFAULT_VALUE);

    expect(result.duplicateCount).toBe(1);
    const dupErrors = result.allErrors.filter(e => e.code === 'DUPLICATE_ORDER_ID');
    expect(dupErrors.length).toBeGreaterThan(0);
  });
});
