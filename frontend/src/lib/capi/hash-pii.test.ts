/**
 * hash-pii.test.ts
 *
 * Critical path: verifies that PII is correctly normalised AND hashed before
 * leaving the client. Any regression here could leak unhashed user data to
 * ad platforms, violating privacy requirements.
 *
 * Test strategy:
 *  1. Normalisation functions — pure, synchronous, no hashing involved
 *  2. hashUserData — end-to-end: raw input → HashedIdentifier[]
 *     - Verifies hashed values match expected SHA-256 of normalised input
 *     - Verifies click IDs (fbc, fbp, gclid) are NEVER hashed
 *     - Verifies disabled identifiers are omitted
 *     - Verifies empty/undefined fields are omitted
 */

import { describe, it, expect } from 'vitest';
import { sha256 } from '@/lib/shared/crypto';
import {
  normaliseEmail,
  normalisePhone,
  normaliseName,
  normaliseCity,
  normaliseState,
  normaliseZip,
  normaliseCountry,
  hashUserData,
} from './hash-pii';
import type { IdentifierType } from '@/types/capi';

// ── Normalisation ─────────────────────────────────────────────────────────────

describe('normaliseEmail', () => {
  it('lowercases', () => expect(normaliseEmail('User@Example.COM')).toBe('user@example.com'));
  it('trims whitespace', () => expect(normaliseEmail('  user@example.com  ')).toBe('user@example.com'));
  it('handles already-normalised input', () => expect(normaliseEmail('user@example.com')).toBe('user@example.com'));
});

describe('normalisePhone', () => {
  it('strips spaces, dashes, and parentheses', () =>
    expect(normalisePhone('+1 (555) 123-4567')).toBe('+15551234567'));
  it('preserves leading +', () =>
    expect(normalisePhone('+44 7911 123456')).toBe('+447911123456'));
  it('strips dots', () =>
    expect(normalisePhone('555.123.4567')).toBe('5551234567'));
  it('handles plain digits', () =>
    expect(normalisePhone('5551234567')).toBe('5551234567'));
  it('strips non-digit chars except leading +', () =>
    expect(normalisePhone('(800)FLOWERS')).toBe('800'));
});

describe('normaliseName', () => {
  it('lowercases', () => expect(normaliseName('JOHN')).toBe('john'));
  it('trims whitespace', () => expect(normaliseName('  Jane  ')).toBe('jane'));
  it('preserves accented characters', () => expect(normaliseName('José')).toBe('josé'));
  it('preserves hyphens', () => expect(normaliseName('Mary-Jane')).toBe('mary-jane'));
  it('strips punctuation', () => expect(normaliseName("O'Brien")).toBe('obrien'));
  it('collapses internal spaces', () => expect(normaliseName('Jean  Claude')).toBe('jean claude'));
});

describe('normaliseCity', () => {
  it('lowercases and removes spaces', () =>
    expect(normaliseCity('New York')).toBe('newyork'));
  it('trims', () =>
    expect(normaliseCity('  London  ')).toBe('london'));
});

describe('normaliseState', () => {
  it('lowercases and trims', () =>
    expect(normaliseState('  CA  ')).toBe('ca'));
  it('handles full state name', () =>
    expect(normaliseState('California')).toBe('california'));
});

describe('normaliseZip', () => {
  it('lowercases and trims', () =>
    expect(normaliseZip('  90210  ')).toBe('90210'));
  it('handles UK postcode', () =>
    expect(normaliseZip('SW1A 1AA')).toBe('sw1a 1aa'));
});

describe('normaliseCountry', () => {
  it('lowercases to 2 chars', () =>
    expect(normaliseCountry('US')).toBe('us'));
  it('truncates to 2 chars', () =>
    expect(normaliseCountry('USA')).toBe('us'));
  it('trims whitespace', () =>
    expect(normaliseCountry(' GB ')).toBe('gb'));
});

// ── hashUserData — end-to-end ─────────────────────────────────────────────────

const ALL_IDENTIFIERS: IdentifierType[] = [
  'email', 'phone', 'fn', 'ln', 'ct', 'st', 'zp', 'country',
  'external_id', 'fbc', 'fbp', 'gclid', 'wbraid', 'gbraid',
];

describe('hashUserData', () => {
  it('hashes email with correct normalisation', async () => {
    const results = await hashUserData(
      { email: '  User@Example.COM  ' },
      ['email'],
    );
    const emailEntry = results.find(r => r.type === 'email');
    expect(emailEntry).toBeDefined();
    expect(emailEntry!.is_hashed).toBe(true);
    // Must match sha256 of normalised value
    const expected = await sha256('user@example.com');
    expect(emailEntry!.value).toBe(expected);
  });

  it('hashes phone after stripping formatting', async () => {
    const results = await hashUserData(
      { phone: '+1 (555) 123-4567' },
      ['phone'],
    );
    const phoneEntry = results.find(r => r.type === 'phone');
    expect(phoneEntry).toBeDefined();
    expect(phoneEntry!.is_hashed).toBe(true);
    const expected = await sha256('+15551234567');
    expect(phoneEntry!.value).toBe(expected);
  });

  it('never returns raw PII — all PII fields have is_hashed: true', async () => {
    const results = await hashUserData(
      {
        email: 'user@example.com',
        phone: '+15551234567',
        first_name: 'John',
        last_name: 'Doe',
        city: 'New York',
        state: 'NY',
        zip: '10001',
        country: 'US',
        external_id: 'user-123',
      },
      ALL_IDENTIFIERS,
    );
    const piiTypes: IdentifierType[] = ['email', 'phone', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id'];
    for (const type of piiTypes) {
      const entry = results.find(r => r.type === type);
      if (entry) {
        expect(entry.is_hashed, `${type} must be hashed`).toBe(true);
      }
    }
  });

  it('sends click IDs raw (is_hashed: false)', async () => {
    const fbc  = 'fb.1.1234567890.AbCdEfGhIjKlMnOp';
    const fbp  = 'fb.1.1234567890.1234567890';
    const gclid = 'TeSter1234';
    const results = await hashUserData(
      { fbc, fbp, gclid },
      ALL_IDENTIFIERS,
    );

    const fbcEntry   = results.find(r => r.type === 'fbc');
    const fbpEntry   = results.find(r => r.type === 'fbp');
    const gclidEntry = results.find(r => r.type === 'gclid');

    expect(fbcEntry!.value).toBe(fbc);
    expect(fbcEntry!.is_hashed).toBe(false);
    expect(fbpEntry!.value).toBe(fbp);
    expect(fbpEntry!.is_hashed).toBe(false);
    expect(gclidEntry!.value).toBe(gclid);
    expect(gclidEntry!.is_hashed).toBe(false);
  });

  it('omits identifiers not in the enabled list', async () => {
    const results = await hashUserData(
      { email: 'user@example.com', phone: '+15551234567' },
      ['email'], // phone NOT enabled
    );
    expect(results.find(r => r.type === 'phone')).toBeUndefined();
    expect(results.find(r => r.type === 'email')).toBeDefined();
  });

  it('omits empty / undefined fields', async () => {
    const results = await hashUserData(
      { email: 'user@example.com', phone: '' },
      ALL_IDENTIFIERS,
    );
    expect(results.find(r => r.type === 'phone')).toBeUndefined();
  });

  it('omits whitespace-only fields', async () => {
    const results = await hashUserData(
      { email: '   ' },
      ALL_IDENTIFIERS,
    );
    expect(results.find(r => r.type === 'email')).toBeUndefined();
  });

  it('returns empty array when no user_data provided', async () => {
    const results = await hashUserData({}, ALL_IDENTIFIERS);
    expect(results).toHaveLength(0);
  });

  it('hashed value is never equal to the raw input', async () => {
    const rawEmail = 'user@example.com';
    const results = await hashUserData({ email: rawEmail }, ['email']);
    const emailEntry = results.find(r => r.type === 'email');
    expect(emailEntry!.value).not.toBe(rawEmail);
  });
});
