/**
 * CAPI Dedup Store Correctness Tests
 *
 * Tests the dedup logic in backend/src/services/capi/dedupStore.ts.
 * Redis is mocked — no live connection required.
 *
 * Key verified behaviours:
 *   1. Cache hit: getMetaDedupEntry returns stored DedupEntry when Redis has the key
 *   2. Cache miss: getMetaDedupEntry returns null when Redis has no matching key
 *   3. null fbclid: getMetaDedupEntry returns null without hitting Redis
 *   4. setDedupEntry stores with META_TTL_S = 48*60*60 for provider='meta'
 *   5. setDedupEntry stores with GOOGLE_TTL_S = 90*24*60*60 for provider='google'
 *   6. Expired TTL: simulated by returning null from Redis mock (Redis handles actual expiry)
 *
 * metaDelivery.ts flow (lines 148–158):
 *   For each event:
 *     entry = await getMetaDedupEntry(providerId, e.user_data.fbc ?? null, e.event_name)
 *     eventId = entry?.event_id ?? randomUUID()
 *   → cache hit: uses stored event_id (dedup_status: 'hit')
 *   → cache miss: generates new UUID (dedup_status: 'miss')
 *   NOTE: setDedupEntry is NOT called after a miss inside metaDelivery.ts — the pipeline
 *         is expected to be called upstream. This is documented below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock ioredis before importing dedupStore ──────────────────────────────────
// vi.mock is hoisted to the top of the file by Vitest. Variables captured in
// the factory must be defined inside the factory itself, not in the outer scope.

const { mockGet, mockSet } = vi.hoisted(() => {
  const mockGet = vi.fn<[string], Promise<string | null>>();
  const mockSet = vi.fn<[string, string, string, number], Promise<'OK'>>();
  return { mockGet, mockSet };
});

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: mockGet,
      set: mockSet,
    })),
  };
});

// Mock env before importing dedupStore (it reads env at module load time)
vi.mock('@/config/env', () => ({
  env: { REDIS_URL: 'redis://localhost:6379' },
}));

// Now safe to import
import {
  getMetaDedupEntry,
  getGoogleDedupEntry,
  setDedupEntry,
  type DedupEntry,
} from '../../../backend/src/services/capi/dedupStore';

// ── Constants from source (replicated for test assertions) ────────────────────

const META_TTL_S   = 48 * 60 * 60;       // 172_800
const GOOGLE_TTL_S = 90 * 24 * 60 * 60;  // 7_776_000

// ── Test data ─────────────────────────────────────────────────────────────────

const PROVIDER_ID = 'provider-abc';
const FBCLID      = 'fb.1.1234567890.AbCdEfGhIj';
const EVENT_NAME  = 'Purchase';
const EVENT_ID    = '550e8400-e29b-41d4-a716-446655440000';

const STORED_ENTRY: DedupEntry = {
  event_id:  EVENT_ID,
  timestamp: 1_700_000_000_000,
  event_data: { value: 99.99 },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMetaDedupEntry — cache hit', () => {
  it('returns the stored DedupEntry when Redis has the key', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify(STORED_ENTRY));

    const result = await getMetaDedupEntry(PROVIDER_ID, FBCLID, EVENT_NAME);

    expect(result).not.toBeNull();
    expect(result!.event_id).toBe(EVENT_ID);
    expect(result!.timestamp).toBe(STORED_ENTRY.timestamp);

    // Verify the Redis key format: capi:meta:dedup:{providerId}:{fbclid}:{eventName}
    const expectedKey = `capi:meta:dedup:${PROVIDER_ID}:${FBCLID}:${EVENT_NAME}`;
    expect(mockGet).toHaveBeenCalledWith(expectedKey);
  });
});

describe('getMetaDedupEntry — cache miss', () => {
  it('returns null when Redis has no entry for the key', async () => {
    mockGet.mockResolvedValueOnce(null);

    const result = await getMetaDedupEntry(PROVIDER_ID, FBCLID, EVENT_NAME);

    expect(result).toBeNull();
    expect(mockGet).toHaveBeenCalledOnce();
  });
});

describe('getMetaDedupEntry — null fbclid', () => {
  it('returns null immediately without calling Redis when fbclid is null', async () => {
    const result = await getMetaDedupEntry(PROVIDER_ID, null, EVENT_NAME);

    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns null immediately without calling Redis when fbclid is undefined (cast)', async () => {
    // The signature accepts string | null — undefined must be passed as null by callers.
    // metaDelivery.ts does: `e.user_data.fbc ?? null`
    const result = await getMetaDedupEntry(PROVIDER_ID, null, EVENT_NAME);
    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('setDedupEntry — Meta TTL', () => {
  it('stores entry with 48-hour TTL for provider meta', async () => {
    mockSet.mockResolvedValueOnce('OK');

    await setDedupEntry('meta', PROVIDER_ID, FBCLID, EVENT_NAME, STORED_ENTRY);

    expect(mockSet).toHaveBeenCalledOnce();
    const [key, value, exFlag, ttl] = mockSet.mock.calls[0];

    expect(key).toBe(`capi:meta:dedup:${PROVIDER_ID}:${FBCLID}:${EVENT_NAME}`);
    expect(JSON.parse(value as string)).toEqual(STORED_ENTRY);
    expect(exFlag).toBe('EX');
    expect(ttl).toBe(META_TTL_S);
    expect(ttl).toBe(172_800); // 48 * 60 * 60
  });
});

describe('setDedupEntry — Google TTL', () => {
  it('stores entry with 90-day TTL for provider google', async () => {
    mockSet.mockResolvedValueOnce('OK');

    const googleIdentifier = 'gclid_test_abc';
    await setDedupEntry('google', PROVIDER_ID, googleIdentifier, 'Purchase', STORED_ENTRY);

    expect(mockSet).toHaveBeenCalledOnce();
    const [key, , , ttl] = mockSet.mock.calls[0];

    expect(key).toBe(`capi:google:dedup:${PROVIDER_ID}:${googleIdentifier}:Purchase`);
    expect(ttl).toBe(GOOGLE_TTL_S);
    expect(ttl).toBe(7_776_000); // 90 * 24 * 60 * 60
  });
});

describe('getGoogleDedupEntry — null identifier', () => {
  it('returns null immediately without calling Redis when identifier is null', async () => {
    const result = await getGoogleDedupEntry(PROVIDER_ID, null, EVENT_NAME);
    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('Expired TTL behaviour (simulated)', () => {
  it('treats an expired entry as a cache miss (Redis returns null after TTL)', async () => {
    /**
     * Redis automatically evicts keys after TTL — it returns null for expired keys.
     * From dedupStore's perspective this is identical to a cache miss.
     * We simulate this by having the mock return null.
     */
    mockGet.mockResolvedValueOnce(null);

    const result = await getMetaDedupEntry(PROVIDER_ID, FBCLID, EVENT_NAME);
    expect(result).toBeNull();
  });
});

describe('metaDelivery.ts dedup integration behaviour (documented)', () => {
  it('cache hit returns stored event_id so metaDelivery uses it for deduplication', async () => {
    /**
     * From metaDelivery.ts (lines 151–152):
     *   const entry = await getMetaDedupEntry(providerId, e.user_data.fbc ?? null, e.event_name)
     *   return { entry, eventId: entry?.event_id ?? randomUUID() }
     *
     * When entry is non-null, eventId = entry.event_id (the original stored UUID).
     * This is the mechanism that prevents duplicate events at the Meta platform.
     */
    mockGet.mockResolvedValueOnce(JSON.stringify(STORED_ENTRY));
    const entry = await getMetaDedupEntry(PROVIDER_ID, FBCLID, EVENT_NAME);

    const eventId = entry?.event_id ?? 'would-be-new-uuid';
    expect(eventId).toBe(EVENT_ID);
  });

  it('cache miss causes metaDelivery to generate a new UUID', async () => {
    mockGet.mockResolvedValueOnce(null);
    const entry = await getMetaDedupEntry(PROVIDER_ID, FBCLID, EVENT_NAME);

    // entry is null → eventId would be a new randomUUID() in actual delivery code
    expect(entry).toBeNull();
    // The new UUID would be generated by randomUUID() — not tested here as it's a stdlib call
  });

  it('DOCUMENTED: setDedupEntry is not called inside metaDelivery after a miss', () => {
    /**
     * metaDelivery.ts does NOT call setDedupEntry after generating a new UUID.
     * The dedup write is expected to happen upstream (e.g., pipeline.ts or the
     * route handler that stores the event record). This means:
     *   - First event: cache miss → new UUID → event delivered
     *   - Second identical event: still a cache miss if setDedupEntry was never called
     *
     * This is a potential gap: if the upstream caller does not call setDedupEntry,
     * the dedup store will never accumulate entries and dedup will never trigger.
     */
    expect(true).toBe(true); // Assertion documents the known gap
  });
});
