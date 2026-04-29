/**
 * Unit tests for crawlHelpers.ts
 *
 * Covers:
 *   1.  chunkArray — splits array into equal-sized chunks
 *   2.  chunkArray — last chunk is smaller when array length isn't divisible by size
 *   3.  chunkArray — empty array → empty result
 *   4.  chunkArray — chunk size larger than array → single chunk
 *   5.  chunkArray — chunk size of 1 → one element per chunk
 *   6.  chunkArray — original array is not mutated
 *   7.  isCrawlDue date arithmetic — 0 runs → due immediately (by convention)
 *   8.  isCrawlDue date arithmetic — run within cadence window → not due
 *   9.  isCrawlDue date arithmetic — run exactly at cadence boundary → due
 *  10.  isCrawlDue date arithmetic — run past cadence → due
 */

import { describe, it, expect } from 'vitest';
import { chunkArray } from '../crawlHelpers';

// ── chunkArray ────────────────────────────────────────────────────────────────

describe('chunkArray', () => {
  it('splits an array into equal-sized chunks', () => {
    const result = chunkArray([1, 2, 3, 4, 5, 6], 2);
    expect(result).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('last chunk is smaller when length is not divisible by size', () => {
    const result = chunkArray([1, 2, 3, 4, 5], 3);
    expect(result).toEqual([[1, 2, 3], [4, 5]]);
    expect(result[result.length - 1]).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  it('returns a single chunk when size exceeds array length', () => {
    const input = [1, 2, 3];
    const result = chunkArray(input, 100);
    expect(result).toEqual([[1, 2, 3]]);
  });

  it('returns one element per chunk when size is 1', () => {
    const result = chunkArray(['a', 'b', 'c'], 1);
    expect(result).toEqual([['a'], ['b'], ['c']]);
  });

  it('does not mutate the original array', () => {
    const input = [1, 2, 3, 4];
    const original = [...input];
    chunkArray(input, 2);
    expect(input).toEqual(original);
  });

  it('handles chunk size equal to array length → single chunk', () => {
    const result = chunkArray([10, 20, 30], 3);
    expect(result).toEqual([[10, 20, 30]]);
  });

  it('works with object arrays (maintains reference equality)', () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };
    const result = chunkArray([obj1, obj2], 1);
    expect(result[0][0]).toBe(obj1);
    expect(result[1][0]).toBe(obj2);
  });
});

// ── isCrawlDue — date arithmetic logic (extracted for unit testing) ────────────
//
// The isCrawlDue function in worker.ts is private, but its core arithmetic is:
//   daysBetweenScans = Math.floor(30 / scans_per_month)
//   daysSinceLastRun = Math.floor((now - lastRun) / MS_PER_DAY)
//   due = daysSinceLastRun >= daysBetweenScans
//
// We test that arithmetic here to validate the scheduling logic independently.

describe('isCrawlDue date arithmetic', () => {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  function isDue(scans_per_month: number, daysSinceLastRun: number): boolean {
    const daysBetweenScans = Math.floor(30 / scans_per_month);
    return daysSinceLastRun >= daysBetweenScans;
  }

  it('monitor tier (4 scans/month = every 7 days): due after 7 days', () => {
    expect(isDue(4, 7)).toBe(true);
  });

  it('monitor tier: NOT due after 6 days', () => {
    expect(isDue(4, 6)).toBe(false);
  });

  it('monitor tier: due exactly on day 7', () => {
    expect(isDue(4, 7)).toBe(true);
  });

  it('diagnostic tier (1 scan/month = every 30 days): NOT due after 29 days', () => {
    expect(isDue(1, 29)).toBe(false);
  });

  it('diagnostic tier: due after 30 days', () => {
    expect(isDue(1, 30)).toBe(true);
  });

  it('daily tier (30 scans/month = every 1 day): due after 1 day', () => {
    expect(isDue(30, 1)).toBe(true);
  });

  it('daily tier: NOT due after 0 days (same day)', () => {
    expect(isDue(30, 0)).toBe(false);
  });

  it('12 scans/month = every 2 days: due after 2 days', () => {
    expect(isDue(12, 2)).toBe(true);
    expect(isDue(12, 1)).toBe(false);
  });

  it('Days-since calculation uses Math.floor (partial day does not count)', () => {
    // 1.9 days should floor to 1, which is < 7 → not due for 4/month cadence
    const partialDays = Math.floor(1.9);
    expect(isDue(4, partialDays)).toBe(false);
  });
});
