/**
 * dedup.test.ts
 *
 * Tests for client-side event deduplication (ClientDedup).
 *
 * The dedup guard prevents the same event_id from being enqueued twice in
 * rapid succession (React StrictMode double-fires, navigation races).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientDedup } from './dedup';

describe('ClientDedup', () => {
  let dedup: ClientDedup;

  beforeEach(() => {
    dedup = new ClientDedup(60); // 60-second window
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── check ───────────────────────────────────────────────────────────────────

  describe('check()', () => {
    it('returns false for a new event_id (not a duplicate)', () => {
      expect(dedup.check('evt_001')).toBe(false);
    });

    it('returns true for the same event_id within the window', () => {
      dedup.check('evt_001'); // first call registers it
      expect(dedup.check('evt_001')).toBe(true);
    });

    it('returns false for a different event_id', () => {
      dedup.check('evt_001');
      expect(dedup.check('evt_002')).toBe(false);
    });

    it('returns false after the TTL has expired', () => {
      dedup.check('evt_001');
      // Advance time beyond the 60-second window
      vi.advanceTimersByTime(61_000);
      expect(dedup.check('evt_001')).toBe(false);
    });

    it('returns true if checked again just before TTL expires', () => {
      dedup.check('evt_001');
      vi.advanceTimersByTime(59_000); // 1 second before expiry
      expect(dedup.check('evt_001')).toBe(true);
    });
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('marks an event_id as seen without returning a value', () => {
      dedup.register('evt_reg_001');
      expect(dedup.check('evt_reg_001')).toBe(true);
    });

    it('does not affect other event IDs', () => {
      dedup.register('evt_reg_001');
      expect(dedup.check('evt_reg_002')).toBe(false);
    });
  });

  // ── clear ───────────────────────────────────────────────────────────────────

  describe('clear()', () => {
    it('removes all entries so previously-seen IDs are treated as new', () => {
      dedup.check('evt_001');
      dedup.check('evt_002');
      dedup.clear();
      expect(dedup.check('evt_001')).toBe(false);
      expect(dedup.check('evt_002')).toBe(false);
    });

    it('resets size to 0', () => {
      dedup.check('evt_001');
      dedup.check('evt_002');
      expect(dedup.size).toBe(2);
      dedup.clear();
      expect(dedup.size).toBe(0);
    });
  });

  // ── size ────────────────────────────────────────────────────────────────────

  describe('size', () => {
    it('starts at 0', () => {
      expect(dedup.size).toBe(0);
    });

    it('increments for each unique event registered', () => {
      dedup.check('evt_001');
      expect(dedup.size).toBe(1);
      dedup.check('evt_002');
      expect(dedup.size).toBe(2);
    });

    it('does not increment for duplicate checks', () => {
      dedup.check('evt_001');
      dedup.check('evt_001'); // duplicate
      expect(dedup.size).toBe(1);
    });
  });

  // ── TTL / window config ─────────────────────────────────────────────────────

  describe('configurable window', () => {
    it('respects a custom short window (1 second)', () => {
      const shortDedup = new ClientDedup(1); // 1-second window
      shortDedup.check('evt_short');
      vi.advanceTimersByTime(1_001);
      expect(shortDedup.check('evt_short')).toBe(false); // expired
    });

    it('respects a custom long window (5 minutes)', () => {
      const longDedup = new ClientDedup(300); // 5-minute window
      longDedup.check('evt_long');
      vi.advanceTimersByTime(299_000); // 1 second before expiry
      expect(longDedup.check('evt_long')).toBe(true); // still active
    });
  });

  // ── purge expired entries ────────────────────────────────────────────────────

  describe('automatic purge of expired entries', () => {
    it('purges expired entries on next check() call', () => {
      dedup.check('evt_purge_001');
      dedup.check('evt_purge_002');
      expect(dedup.size).toBe(2);

      vi.advanceTimersByTime(61_000); // both expired

      // Trigger purge by checking a new event
      dedup.check('evt_new');
      // After purge + new entry, size should be 1
      expect(dedup.size).toBe(1);
    });
  });
});
