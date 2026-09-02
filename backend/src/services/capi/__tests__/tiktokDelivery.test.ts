/**
 * TikTok Events API delivery — unit tests
 *
 * Verifies: payload formatting, dedup-status reporting, delivery success/failure
 * handling (request-level TikTok errors fail every event in the batch), test-event
 * routing, and credential validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dedupStore', () => ({
  getTikTokDedupEntry: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getTikTokDedupEntry } from '../dedupStore';
import {
  formatTikTokEvent,
  sendTikTokEvents,
  sendTikTokTestEvent,
  validateTikTokCredentials,
} from '../tiktokDelivery';
import type { AtlasEvent, EventMapping, HashedIdentifier, TikTokCredentials } from '@/types/capi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    event_id: 'evt-001',
    event_name: 'Purchase',
    event_time: 1700000000,
    consent_state: { marketing: 'granted', analytics: 'granted' },
    user_data: {
      client_ip_address: '1.2.3.4',
      client_user_agent: 'Mozilla/5.0',
    },
    custom_data: { value: 99.99, currency: 'gbp', order_id: 'ord-1' },
    event_source_url: 'https://example.com/checkout',
    ...overrides,
  } as AtlasEvent;
}

const IDENTIFIERS: HashedIdentifier[] = [
  { type: 'email', value: 'hashed-email', is_hashed: true },
  { type: 'phone', value: 'hashed-phone', is_hashed: true },
  { type: 'external_id', value: 'hashed-ext', is_hashed: true },
  { type: 'ttclid', value: 'ttclid-raw-value', is_hashed: false },
];

const MAPPING: EventMapping = { atlas_event: 'Purchase', provider_event: 'Purchase' };

const CREDS: TikTokCredentials = {
  pixel_id: 'pixel-123',
  access_token: 'token-abc',
} as TikTokCredentials;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── formatTikTokEvent ─────────────────────────────────────────────────────────

describe('formatTikTokEvent', () => {
  it('maps hashed identifiers into single-element arrays keyed by type', () => {
    const result = formatTikTokEvent(makeEvent(), MAPPING, IDENTIFIERS);

    expect(result.user.email).toEqual(['hashed-email']);
    expect(result.user.phone).toEqual(['hashed-phone']);
    expect(result.user.external_id).toEqual(['hashed-ext']);
  });

  it('carries ttclid onto user unhashed (not wrapped in an array)', () => {
    const result = formatTikTokEvent(makeEvent(), MAPPING, IDENTIFIERS);

    expect(result.user.ttclid).toBe('ttclid-raw-value');
  });

  it('omits ttclid when no ttclid identifier is present', () => {
    const result = formatTikTokEvent(makeEvent(), MAPPING, []);

    expect(result.user.ttclid).toBeUndefined();
  });

  it('carries client_ip_address and client_user_agent onto user', () => {
    const result = formatTikTokEvent(makeEvent(), MAPPING, []);

    expect(result.user.ip).toBe('1.2.3.4');
    expect(result.user.user_agent).toBe('Mozilla/5.0');
  });

  it('uses mapping.provider_event over event_name when present', () => {
    const result = formatTikTokEvent(
      makeEvent(),
      { atlas_event: 'Purchase', provider_event: 'CompletePayment' },
      [],
    );

    expect(result.event).toBe('CompletePayment');
  });

  it('falls back to event_name when provider_event is not set', () => {
    const result = formatTikTokEvent(makeEvent(), { atlas_event: 'Purchase' } as EventMapping, []);

    expect(result.event).toBe('Purchase');
  });

  it('uppercases currency and stringifies value in properties', () => {
    const result = formatTikTokEvent(makeEvent(), MAPPING, []);

    expect(result.properties?.currency).toBe('GBP');
    expect(result.properties?.value).toBe('99.99');
    expect(result.properties?.order_id).toBe('ord-1');
  });

  it('omits properties entirely when custom_data is absent', () => {
    const result = formatTikTokEvent(makeEvent({ custom_data: undefined }), MAPPING, []);

    expect(result.properties).toBeUndefined();
  });

  it('carries event_source_url onto page.url', () => {
    const result = formatTikTokEvent(makeEvent(), MAPPING, []);

    expect(result.page).toEqual({ url: 'https://example.com/checkout' });
  });

  it('omits page when event_source_url is absent', () => {
    const result = formatTikTokEvent(makeEvent({ event_source_url: undefined }), MAPPING, []);

    expect(result.page).toBeUndefined();
  });
});

// ── sendTikTokEvents ──────────────────────────────────────────────────────────

describe('sendTikTokEvents', () => {
  it('returns an empty array for an empty batch without calling fetch', async () => {
    global.fetch = vi.fn() as any;

    const result = await sendTikTokEvents([], [], [], CREDS);

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts to the event/track endpoint with pixel_id as event_source_id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;
    vi.mocked(getTikTokDedupEntry).mockResolvedValue(null);

    await sendTikTokEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Access-Token': 'token-abc' }),
      }),
    );
    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(body.event_source_id).toBe('pixel-123');
    expect(body.event_source).toBe('web');
    expect(body.data).toHaveLength(1);
  });

  it('marks events delivered and reports dedup_status=miss when no prior entry exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;
    vi.mocked(getTikTokDedupEntry).mockResolvedValue(null);

    const [result] = await sendTikTokEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(result.status).toBe('delivered');
    expect(result.dedup_status).toBe('miss');
  });

  it('reports dedup_status=hit when a prior dedup entry exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;
    vi.mocked(getTikTokDedupEntry).mockResolvedValue({ event_id: 'evt-001', timestamp: 1700000000 });

    const [result] = await sendTikTokEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(result.dedup_status).toBe('hit');
  });

  it('omits dedup_status when no providerId is passed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;

    const [result] = await sendTikTokEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS);

    expect(result.dedup_status).toBeUndefined();
    expect(getTikTokDedupEntry).not.toHaveBeenCalled();
  });

  it('fails every event in the batch when TikTok returns a non-zero code', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 40001, message: 'Invalid access token' }),
    }) as any;
    vi.mocked(getTikTokDedupEntry).mockResolvedValue(null);

    const events = [makeEvent({ event_id: 'evt-a' }), makeEvent({ event_id: 'evt-b' })];
    const results = await sendTikTokEvents(
      events,
      [IDENTIFIERS, IDENTIFIERS],
      [MAPPING],
      CREDS,
      'prov-1',
    );

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('failed');
      expect(r.error_code).toBe('TIKTOK_40001');
      expect(r.error_message).toBe('Invalid access token');
    }
  });

  it('fails every event when the HTTP response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: 500, message: 'Internal error' }),
    }) as any;
    vi.mocked(getTikTokDedupEntry).mockResolvedValue(null);

    const [result] = await sendTikTokEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(result.status).toBe('failed');
    expect(result.error_code).toBe('TIKTOK_500');
  });

  it('returns NETWORK_ERROR failures for every event when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
    vi.mocked(getTikTokDedupEntry).mockResolvedValue(null);

    const events = [makeEvent({ event_id: 'evt-a' }), makeEvent({ event_id: 'evt-b' })];
    const results = await sendTikTokEvents(events, [IDENTIFIERS, IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('failed');
      expect(r.error_code).toBe('NETWORK_ERROR');
      expect(r.error_message).toBe('ECONNRESET');
    }
  });

  it('falls back to a generated event_id when the event has none', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as any;

    const [result] = await sendTikTokEvents(
      [makeEvent({ event_id: '' })],
      [IDENTIFIERS],
      [MAPPING],
      CREDS,
    );

    expect(result.event_id).toBeTruthy();
    expect(result.event_id).not.toBe('');
  });
});

// ── sendTikTokTestEvent ───────────────────────────────────────────────────────

describe('sendTikTokTestEvent', () => {
  it('includes test_event_code in the request body when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;

    await sendTikTokTestEvent(makeEvent(), IDENTIFIERS, MAPPING, CREDS, 'TEST12345');

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(body.test_event_code).toBe('TEST12345');
  });

  it('omits test_event_code when not provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;

    await sendTikTokTestEvent(makeEvent(), IDENTIFIERS, MAPPING, CREDS);

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(body.test_event_code).toBeUndefined();
  });

  it('returns status=success on a 0-code response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;

    const result = await sendTikTokTestEvent(makeEvent(), IDENTIFIERS, MAPPING, CREDS);

    expect(result.status).toBe('success');
  });

  it('returns status=failed with the TikTok message on a non-zero code', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 40105, message: 'Pixel not found' }),
    }) as any;

    const result = await sendTikTokTestEvent(makeEvent(), IDENTIFIERS, MAPPING, CREDS);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Pixel not found');
  });

  it('returns status=failed on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as any;

    const result = await sendTikTokTestEvent(makeEvent(), IDENTIFIERS, MAPPING, CREDS);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('timeout');
  });
});

// ── validateTikTokCredentials ─────────────────────────────────────────────────

describe('validateTikTokCredentials', () => {
  it('fails fast when pixel_id or access_token is missing, without calling fetch', async () => {
    global.fetch = vi.fn() as any;

    const result = await validateTikTokCredentials({ pixel_id: '', access_token: '' } as TikTokCredentials);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('pixel_id');
    expect(result.error).toContain('access_token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns valid=true when TikTok accepts the test event', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    }) as any;

    const result = await validateTikTokCredentials(CREDS);

    expect(result.valid).toBe(true);
  });

  it('returns valid=false with the TikTok error message on an invalid token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 40001, message: 'Access token invalid' }),
    }) as any;

    const result = await validateTikTokCredentials(CREDS);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Access token invalid');
  });

  it('returns valid=false on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('DNS failure')) as any;

    const result = await validateTikTokCredentials(CREDS);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('DNS failure');
  });
});
