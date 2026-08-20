import { describe, it, expect } from 'vitest';
import { sanitizeForJsonb } from '../sanitizeJsonb';

const NULL_BYTE = String.fromCharCode(0);

describe('sanitizeForJsonb', () => {
  it('strips literal null bytes from strings', () => {
    const input = `abc${NULL_BYTE}def`;
    expect(sanitizeForJsonb(input)).toBe('abcdef');
  });

  it('replaces a lone high surrogate with the replacement character', () => {
    const input = 'before\uD800after';
    const result = sanitizeForJsonb(input) as string;
    expect(result).toBe('before�after');
  });

  it('replaces a lone low surrogate with the replacement character', () => {
    const input = 'before\uDC00after';
    const result = sanitizeForJsonb(input) as string;
    expect(result).toBe('before�after');
  });

  it('preserves a valid surrogate pair (real emoji/astral character)', () => {
    const emoji = '👍'; // U+1F44D, a valid high+low surrogate pair
    expect(sanitizeForJsonb(emoji)).toBe(emoji);
  });

  it('leaves clean strings untouched', () => {
    const clean = 'https://example.com/g/collect?tid=G-ABC123';
    expect(sanitizeForJsonb(clean)).toBe(clean);
  });

  it('recurses through nested objects and arrays', () => {
    const input = {
      url: `https://example.com/collect${NULL_BYTE}`,
      nested: { body: 'payload\uD800' },
      list: ['ok', `bad${NULL_BYTE}value`],
    };
    expect(sanitizeForJsonb(input)).toEqual({
      url: 'https://example.com/collect',
      nested: { body: 'payload�' },
      list: ['ok', 'badvalue'],
    });
  });

  it('passes through non-string primitives unchanged', () => {
    const input = { count: 3, active: true, missing: null, tags: [1, 2, 3] };
    expect(sanitizeForJsonb(input)).toEqual(input);
  });
});
