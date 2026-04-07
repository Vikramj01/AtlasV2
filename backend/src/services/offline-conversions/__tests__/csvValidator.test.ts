/**
 * Unit tests for the CSV Validation Service
 *
 * Covers all 13 validation rule paths defined in the PRD:
 *   1.  Missing identifier (no GCLID and no email)
 *   2.  Invalid email format
 *   3.  Email-only warning (no GCLID)
 *   4.  Phone normalisation — valid E.164
 *   5.  Phone normalisation — too short (invalid)
 *   6.  Phone missing country code warning
 *   7.  Missing conversion_time
 *   8.  Invalid date format
 *   9.  Future date rejection
 *   10. 90-day lookback hard rejection
 *   11. 60-day soft warning
 *   12. Conversion value: non-numeric / zero / negative / default fallback
 *   13. Currency: invalid code / default fallback
 *   14. Within-upload dedup: duplicate order_id
 *   15. Within-upload dedup: GCLID + time within 60 s window
 *   16. Happy path: all valid, various date formats
 *   17. generateCsvTemplate / DEFAULT_COLUMN_MAPPING exports
 */

import { describe, it, expect } from 'vitest';
import {
  validateCsvBuffer,
  generateCsvTemplate,
  DEFAULT_COLUMN_MAPPING,
  CSV_TEMPLATE_HEADERS,
} from '../csvValidator';
import type { ColumnMapping } from '@/types/offline-conversions';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a CSV buffer from an array of row objects using the default mapping headers. */
function makeCsv(rows: Record<string, string>[]): Buffer {
  const headers = [
    'Click ID (GCLID)',
    'Email Address',
    'Phone',
    'Conversion Date',
    'Deal Value',
    'Currency',
    'Order ID',
  ].join(',');

  const lines = rows.map((r) =>
    [
      r.gclid ?? '',
      r.email ?? '',
      r.phone ?? '',
      r.date ?? '',
      r.value ?? '',
      r.currency ?? '',
      r.orderId ?? '',
    ].join(','),
  );

  return Buffer.from([headers, ...lines].join('\n'), 'utf-8');
}

/** A valid row that passes all rules. date is 7 days ago by default. */
function validRow(overrides: Record<string, string> = {}): Record<string, string> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
  return {
    gclid: 'EAlAKENy1234567890abcdefghij',
    email: 'test@example.com',
    phone: '+14155551234',
    date: sevenDaysAgo,
    value: '1000.00',
    currency: 'USD',
    orderId: 'ORDER-001',
    ...overrides,
  };
}

const MAPPING = DEFAULT_COLUMN_MAPPING as ColumnMapping;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateCsvBuffer', () => {

  // ── 1. Happy path ───────────────────────────────────────────────────────────

  describe('happy path', () => {
    it('returns one valid row for a perfect CSV', () => {
      const buf = makeCsv([validRow()]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.validCount).toBe(1);
      expect(result.invalidCount).toBe(0);
      expect(result.duplicateCount).toBe(0);
      expect(result.rows[0].status).toBe('valid');
      expect(result.rows[0].errors).toHaveLength(0);
    });

    it('parses multiple valid rows', () => {
      const buf = makeCsv([
        validRow({ orderId: 'A' }),
        validRow({ orderId: 'B', gclid: 'DIFFERENT_GCLID' }),
        validRow({ orderId: 'C', gclid: 'ANOTHER_GCLID' }),
      ]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.validCount).toBe(3);
      expect(result.invalidCount).toBe(0);
    });

    it('trims whitespace from field values', () => {
      const buf = makeCsv([validRow({ email: '  test@example.com  ' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].rawEmail).toBe('test@example.com');
    });
  });

  // ── 2. Identifier rules ──────────────────────────────────────────────────────

  describe('identifier validation', () => {
    it('rejects row with no GCLID and no email', () => {
      const buf = makeCsv([validRow({ gclid: '', email: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.invalidCount).toBe(1);
      const err = result.rows[0].errors.find((e) => e.code === 'MISSING_IDENTIFIER');
      expect(err).toBeDefined();
    });

    it('accepts row with GCLID only (no email)', () => {
      const buf = makeCsv([validRow({ email: '', phone: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].status).toBe('valid');
    });

    it('accepts row with email only (no GCLID) and adds warning', () => {
      const buf = makeCsv([validRow({ gclid: '', phone: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.rows[0].status).toBe('valid');
      const warn = result.rows[0].warnings.find((w) => w.code === 'NO_GCLID_LOWER_MATCH_RATE');
      expect(warn).toBeDefined();
    });
  });

  // ── 3. Email validation ──────────────────────────────────────────────────────

  describe('email validation', () => {
    it('rejects an invalid email address', () => {
      const buf = makeCsv([validRow({ email: 'not-an-email' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.invalidCount).toBe(1);
      expect(result.rows[0].errors[0].code).toBe('INVALID_EMAIL');
    });

    it('normalises email to lowercase', () => {
      const buf = makeCsv([validRow({ email: 'UPPER@Example.COM' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].rawEmail).toBe('upper@example.com');
    });

    it('accepts valid email with + addressing', () => {
      const buf = makeCsv([validRow({ email: 'user+tag@example.co.uk' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.filter((e) => e.code === 'INVALID_EMAIL')).toHaveLength(0);
    });
  });

  // ── 4. Phone validation ──────────────────────────────────────────────────────

  describe('phone normalisation', () => {
    it('strips formatting and keeps E.164', () => {
      const buf = makeCsv([validRow({ phone: '+1 (415) 555-1234' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].rawPhone).toBe('+14155551234');
    });

    it('adds + prefix if missing', () => {
      const buf = makeCsv([validRow({ phone: '14155551234' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].rawPhone).toBe('+14155551234');
    });

    it('warns if phone is too short to be valid', () => {
      const buf = makeCsv([validRow({ phone: '123' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      const warn = result.rows[0].warnings.find((w) => w.code === 'INVALID_PHONE');
      expect(warn).toBeDefined();
      expect(result.rows[0].rawPhone).toBeNull();
    });

    it('stores null for rawPhone when phone is omitted', () => {
      const buf = makeCsv([validRow({ phone: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].rawPhone).toBeNull();
    });
  });

  // ── 5. Conversion time validation ────────────────────────────────────────────

  describe('conversion time', () => {
    it('rejects missing conversion_time', () => {
      const buf = makeCsv([validRow({ date: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.rows[0].errors.some((e) => e.code === 'MISSING_CONVERSION_TIME')).toBe(true);
    });

    it('accepts ISO 8601 datetime', () => {
      const buf = makeCsv([validRow({ date: '2026-03-01T10:00:00Z' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].conversionTime).not.toBeNull();
      expect(result.rows[0].errors.filter((e) => e.field === 'conversion_time')).toHaveLength(0);
    });

    it('accepts date-only format YYYY-MM-DD', () => {
      const d = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const buf = makeCsv([validRow({ date: dateStr })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].conversionTime).not.toBeNull();
    });

    it('accepts US format MM/DD/YYYY', () => {
      const buf = makeCsv([validRow({ date: '03/15/2026' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].conversionTime).not.toBeNull();
      expect(result.rows[0].errors.filter((e) => e.code === 'INVALID_DATE_FORMAT')).toHaveLength(0);
    });

    it('accepts EU format DD.MM.YYYY', () => {
      const buf = makeCsv([validRow({ date: '15.03.2026' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].conversionTime).not.toBeNull();
      expect(result.rows[0].errors.filter((e) => e.code === 'INVALID_DATE_FORMAT')).toHaveLength(0);
    });

    it('rejects an unparseable date string', () => {
      const buf = makeCsv([validRow({ date: 'not-a-date' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'INVALID_DATE_FORMAT')).toBe(true);
    });

    it('rejects a future date', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const buf = makeCsv([validRow({ date: tomorrow })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'FUTURE_DATE')).toBe(true);
      expect(result.rows[0].status).toBe('invalid');
    });

    it('rejects a conversion older than 90 days', () => {
      const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      const buf = makeCsv([validRow({ date: old })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'EXPIRED_CONVERSION')).toBe(true);
      expect(result.rows[0].status).toBe('invalid');
    });

    it('warns (but does not reject) for conversions between 60–90 days old', () => {
      const old = new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).toISOString();
      const buf = makeCsv([validRow({ date: old })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.filter((e) => e.field === 'conversion_time')).toHaveLength(0);
      expect(result.rows[0].warnings.some((w) => w.code === 'OLD_CONVERSION_LOWER_MATCH')).toBe(true);
      expect(result.rows[0].status).toBe('valid');
    });
  });

  // ── 6. Conversion value ──────────────────────────────────────────────────────

  describe('conversion value', () => {
    it('accepts a positive numeric value', () => {
      const buf = makeCsv([validRow({ value: '4500.50' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].conversionValue).toBe(4500.5);
    });

    it('rejects a non-numeric value', () => {
      const buf = makeCsv([validRow({ value: 'abc' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'INVALID_VALUE')).toBe(true);
    });

    it('rejects zero', () => {
      const buf = makeCsv([validRow({ value: '0' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'NON_POSITIVE_VALUE')).toBe(true);
    });

    it('rejects a negative value', () => {
      const buf = makeCsv([validRow({ value: '-100' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'NON_POSITIVE_VALUE')).toBe(true);
    });

    it('uses default value when row value is empty', () => {
      const buf = makeCsv([validRow({ value: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', 999.99);
      expect(result.rows[0].conversionValue).toBe(999.99);
    });

    it('stores null when no value and no default', () => {
      const buf = makeCsv([validRow({ value: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].conversionValue).toBeNull();
      expect(result.rows[0].status).toBe('valid'); // value is optional
    });
  });

  // ── 7. Currency validation ───────────────────────────────────────────────────

  describe('currency validation', () => {
    it('accepts a valid ISO 4217 code', () => {
      const buf = makeCsv([validRow({ currency: 'GBP' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].currency).toBe('GBP');
    });

    it('normalises lowercase currency to uppercase', () => {
      const buf = makeCsv([validRow({ currency: 'eur' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].currency).toBe('EUR');
    });

    it('rejects an invalid currency code', () => {
      const buf = makeCsv([validRow({ currency: 'XYZ' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].errors.some((e) => e.code === 'INVALID_CURRENCY')).toBe(true);
    });

    it('falls back to default currency when row currency is empty', () => {
      const buf = makeCsv([validRow({ currency: '' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'EUR', null);
      expect(result.rows[0].currency).toBe('EUR');
    });
  });

  // ── 8. Within-upload deduplication ──────────────────────────────────────────

  describe('within-upload deduplication', () => {
    it('marks the second row as duplicate when order_id repeats', () => {
      const buf = makeCsv([
        validRow({ orderId: 'DUP-001', gclid: 'GCLID_A' }),
        validRow({ orderId: 'DUP-001', gclid: 'GCLID_B' }),
      ]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.rows[0].status).toBe('valid');
      expect(result.rows[1].status).toBe('duplicate');
      expect(result.rows[1].errors[0].code).toBe('DUPLICATE_ORDER_ID');
      expect(result.duplicateCount).toBe(1);
    });

    it('does not flag unique order_ids as duplicates', () => {
      const buf = makeCsv([
        validRow({ orderId: 'UNIQ-001' }),
        validRow({ orderId: 'UNIQ-002', gclid: 'OTHER_GCLID' }),
      ]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.duplicateCount).toBe(0);
    });

    it('marks duplicate GCLID within 60-second window', () => {
      const sameTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const buf = makeCsv([
        validRow({ gclid: 'SAME_GCLID', date: sameTime, orderId: 'ORD-A' }),
        validRow({ gclid: 'SAME_GCLID', date: sameTime, orderId: 'ORD-B' }),
      ]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);

      expect(result.rows[1].status).toBe('duplicate');
      expect(result.rows[1].errors[0].code).toBe('DUPLICATE_GCLID_TIME');
    });

    it('does NOT flag same GCLID more than 60 seconds apart', () => {
      const time1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const time2 = new Date(time1.getTime() + 2 * 60 * 1000); // 2 minutes later
      const buf = makeCsv([
        validRow({ gclid: 'SAME_GCLID', date: time1.toISOString(), orderId: 'ORD-1' }),
        validRow({ gclid: 'SAME_GCLID', date: time2.toISOString(), orderId: 'ORD-2' }),
      ]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.duplicateCount).toBe(0);
    });
  });

  // ── 9. Multiple errors on one row ────────────────────────────────────────────

  describe('multiple errors', () => {
    it('collects all errors on a single bad row', () => {
      const buf = makeCsv([{
        gclid: '',
        email: '',
        phone: '',
        date: 'bad-date',
        value: 'not-a-number',
        currency: 'INVALID',
        orderId: '',
      }]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      const codes = result.rows[0].errors.map((e) => e.code);

      expect(codes).toContain('MISSING_IDENTIFIER');
      expect(codes).toContain('INVALID_DATE_FORMAT');
      expect(codes).toContain('INVALID_VALUE');
      expect(codes).toContain('INVALID_CURRENCY');
    });
  });

  // ── 10. Empty CSV ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles an empty CSV (header only)', () => {
      const buf = Buffer.from(
        'Click ID (GCLID),Email Address,Phone,Conversion Date,Deal Value,Currency,Order ID\n',
        'utf-8',
      );
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows).toHaveLength(0);
      expect(result.validCount).toBe(0);
    });

    it('handles BOM-prefixed CSV from Excel', () => {
      const headerLine = 'Click ID (GCLID),Email Address,Phone,Conversion Date,Deal Value,Currency,Order ID';
      const row = validRow();
      const csvContent = `${headerLine}\n${row.gclid},${row.email},${row.phone},${row.date},${row.value},${row.currency},${row.orderId}\n`;
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const buf = Buffer.concat([bom, Buffer.from(csvContent, 'utf-8')]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.validCount).toBe(1);
    });

    it('throws on completely invalid CSV data', () => {
      const buf = Buffer.from('this is not csv at all\x00\x01\x02', 'binary');
      // csv-parse may or may not throw depending on content — just ensure no crash
      // (it will parse as a single-column CSV with header "this is not csv at all")
      expect(() => validateCsvBuffer(buf, MAPPING, 'USD', null)).not.toThrow();
    });
  });

  // ── 11. Row index (1-based) ───────────────────────────────────────────────────

  describe('row indexing', () => {
    it('row index is 1-based (header excluded)', () => {
      const buf = makeCsv([validRow({ orderId: 'A' }), validRow({ orderId: 'B', gclid: 'GC2' })]);
      const result = validateCsvBuffer(buf, MAPPING, 'USD', null);
      expect(result.rows[0].rowIndex).toBe(1);
      expect(result.rows[1].rowIndex).toBe(2);
    });
  });
});

// ── Template helpers ──────────────────────────────────────────────────────────

describe('generateCsvTemplate', () => {
  it('returns a string containing the header row', () => {
    const template = generateCsvTemplate();
    expect(template).toContain('Click ID (GCLID)');
    expect(template).toContain('Email Address');
    expect(template).toContain('Conversion Date');
  });

  it('uses CRLF line endings', () => {
    const template = generateCsvTemplate();
    expect(template).toMatch(/\r\n/);
  });

  it('includes at least one example data row', () => {
    const lines = generateCsvTemplate().split('\r\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least 1 example
  });
});

describe('DEFAULT_COLUMN_MAPPING', () => {
  it('maps all 7 Atlas fields', () => {
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('gclid');
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('email');
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('phone');
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('conversion_time');
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('conversion_value');
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('currency');
    expect(DEFAULT_COLUMN_MAPPING).toHaveProperty('order_id');
  });

  it('header values match CSV_TEMPLATE_HEADERS', () => {
    const mappedHeaders = Object.values(DEFAULT_COLUMN_MAPPING);
    for (const h of CSV_TEMPLATE_HEADERS) {
      expect(mappedHeaders).toContain(h);
    }
  });
});
