/**
 * crypto.test.ts
 *
 * Tests for SHA-256 hashing utility.
 *
 * Known vectors from NIST / RFC 4634:
 *   sha256("abc")  = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
 *   sha256("")     = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
 *   sha256("test") = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
 */

import { describe, it, expect } from 'vitest';
import { sha256, sha256OrNull } from './crypto';

describe('sha256', () => {
  it('produces the correct NIST vector for "abc"', async () => {
    const result = await sha256('abc');
    expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces the correct hash for empty string', async () => {
    const result = await sha256('');
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces the correct hash for "test"', async () => {
    const result = await sha256('test');
    expect(result).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('returns a 64-character lowercase hex string', async () => {
    const result = await sha256('any input');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input always gives same output', async () => {
    const a = await sha256('hello world');
    const b = await sha256('hello world');
    expect(a).toBe(b);
  });

  it('is sensitive to input — different inputs give different hashes', async () => {
    const a = await sha256('hello');
    const b = await sha256('Hello');
    expect(a).not.toBe(b);
  });
});

describe('sha256OrNull', () => {
  it('hashes a non-empty string', async () => {
    const result = await sha256OrNull('abc');
    expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('returns null for empty string', async () => {
    expect(await sha256OrNull('')).toBeNull();
  });

  it('returns null for null', async () => {
    expect(await sha256OrNull(null)).toBeNull();
  });

  it('returns null for undefined', async () => {
    expect(await sha256OrNull(undefined)).toBeNull();
  });

  it('returns null for whitespace-only string', async () => {
    expect(await sha256OrNull('   ')).toBeNull();
  });

  it('trims whitespace before hashing', async () => {
    const trimmed = await sha256OrNull('abc');
    const padded  = await sha256OrNull('  abc  ');
    expect(trimmed).toBe(padded);
  });
});
