/**
 * OpenAI (OAIQ) Conversions API delivery — unit tests.
 *
 * ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part A (A-W7). Verifies: the corrected
 * endpoint/auth (A-W1), oppref as a first-class identifier no longer
 * smuggled through external_id (A-W2), event schema shape, dedup-status
 * reporting, batch-failure handling, test-event routing (validate_only),
 * and credential validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dedupStore', () => ({
  getOpenAIDedupEntry: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getOpenAIDedupEntry } from '../dedupStore';
import {
  formatOpenAIEvent,
  sendOpenAIEvents,
  sendOpenAITestEvent,
  validateOpenAICredentials,
} from '../openaiDelivery';
import type { AtlasEvent, EventMapping, HashedIdentifier, OpenAICredentials } from '@/types/capi';

function makeEvent(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    event_id: 'evt-001',
    event_name: 'Purchase',
    event_time: 1700000000,
    consent_state: { marketing: 'granted', analytics: 'granted' },
    user_data: {},
    custom_data: { value: 99.99, currency: 'gbp' },
    event_source_url: 'https://example.com/checkout',
    ...overrides,
  } as AtlasEvent;
}

const IDENTIFIERS: HashedIdentifier[] = [
  { type: 'email', value: 'hashed-email', is_hashed: true },
  { type: 'phone', value: 'hashed-phone', is_hashed: true },
  { type: 'external_id', value: 'hashed-ext', is_hashed: true },
  { type: 'oppref', value: 'gAAAAAb123', is_hashed: false },
];

const MAPPING: EventMapping = { atlas_event: 'Purchase', provider_event: 'order_created' };

const CREDS: OpenAICredentials = {
  publisher_id: 'pixel-123',
  api_key: 'key-abc',
} as OpenAICredentials;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── formatOpenAIEvent ───────────────────────────────────────────────────────

describe('formatOpenAIEvent', () => {
  it('carries oppref as its own first-class field, not inside user.external_id', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, IDENTIFIERS, CREDS);

    expect(result.oppref).toBe('gAAAAAb123');
    expect(result.user?.external_id).toBe('hashed-ext');
  });

  it('omits oppref when no oppref identifier is present', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.oppref).toBeUndefined();
  });

  it('maps hashed identifiers onto the user object', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, IDENTIFIERS, CREDS);

    expect(result.user?.email_address).toBe('hashed-email');
    expect(result.user?.phone_number).toBe('hashed-phone');
  });

  it('omits user entirely when no identifiers are present', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.user).toBeUndefined();
  });

  it('uses mapping.provider_event as the event type', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.type).toBe('order_created');
  });

  it('falls back to event_name when provider_event is not set', () => {
    const result = formatOpenAIEvent(makeEvent(), { atlas_event: 'Purchase' } as EventMapping, [], CREDS);

    expect(result.type).toBe('Purchase');
  });

  it('gives order_created the contents data shape', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.data.type).toBe('contents');
  });

  it('gives lead_created the customer_action data shape', () => {
    const result = formatOpenAIEvent(
      makeEvent(),
      { atlas_event: 'Lead', provider_event: 'lead_created' },
      [],
      CREDS,
    );

    expect(result.data.type).toBe('customer_action');
  });

  it('falls back to the custom data shape for an unrecognised event type', () => {
    const result = formatOpenAIEvent(
      makeEvent(),
      { atlas_event: 'X', provider_event: 'something_bespoke' },
      [],
      CREDS,
    );

    expect(result.data.type).toBe('custom');
  });

  it('uppercases currency and carries value in data', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.data.value).toBe(99.99);
    expect(result.data.currency).toBe('GBP');
  });

  it('converts event_time (unix seconds) to timestamp_ms', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.timestamp_ms).toBe(1700000000 * 1000);
  });

  it('carries event_source_url onto source_url', () => {
    const result = formatOpenAIEvent(makeEvent(), MAPPING, [], CREDS);

    expect(result.source_url).toBe('https://example.com/checkout');
  });
});

// ── sendOpenAIEvents ──────────────────────────────────────────────────────────

describe('sendOpenAIEvents', () => {
  it('returns an empty array for an empty batch without calling fetch', async () => {
    global.fetch = vi.fn() as any;

    const result = await sendOpenAIEvents([], [], [], CREDS);

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts to bzr.openai.com/v1/events with pid as a query param and a Bearer token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }) as any;
    vi.mocked(getOpenAIDedupEntry).mockResolvedValue(null);

    await sendOpenAIEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://bzr.openai.com/v1/events?pid=pixel-123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer key-abc' }),
      }),
    );
    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(body.validate_only).toBe(false);
    expect(body.events).toHaveLength(1);
  });

  it('marks events delivered and reports dedup_status=miss when no prior entry exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    vi.mocked(getOpenAIDedupEntry).mockResolvedValue(null);

    const [result] = await sendOpenAIEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(result.status).toBe('delivered');
    expect(result.dedup_status).toBe('miss');
  });

  it('reports dedup_status=hit when a prior dedup entry exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    vi.mocked(getOpenAIDedupEntry).mockResolvedValue({ event_id: 'evt-001', timestamp: 1700000000 });

    const [result] = await sendOpenAIEvents([makeEvent()], [IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(result.dedup_status).toBe('hit');
  });

  it('fails every event in the batch when the whole batch is rejected', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ errors: [{ code: 'INVALID_EVENT', message: 'bad event' }] }),
    }) as any;
    vi.mocked(getOpenAIDedupEntry).mockResolvedValue(null);

    const events = [makeEvent({ event_id: 'evt-a' }), makeEvent({ event_id: 'evt-b' })];
    const results = await sendOpenAIEvents(events, [IDENTIFIERS, IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('failed');
      expect(r.error_code).toBe('INVALID_EVENT');
      expect(r.error_message).toBe('bad event');
    }
  });

  it('returns NETWORK_ERROR failures for every event when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
    vi.mocked(getOpenAIDedupEntry).mockResolvedValue(null);

    const events = [makeEvent({ event_id: 'evt-a' }), makeEvent({ event_id: 'evt-b' })];
    const results = await sendOpenAIEvents(events, [IDENTIFIERS, IDENTIFIERS], [MAPPING], CREDS, 'prov-1');

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('failed');
      expect(r.error_code).toBe('NETWORK_ERROR');
      expect(r.error_message).toBe('ECONNRESET');
    }
  });
});

// ── sendOpenAITestEvent ───────────────────────────────────────────────────────

describe('sendOpenAITestEvent', () => {
  it('sends validate_only=true', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }) as any;

    await sendOpenAITestEvent(makeEvent(), IDENTIFIERS, MAPPING, CREDS);

    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string);
    expect(body.validate_only).toBe(true);
    expect(body.events).toHaveLength(1);
  });

  it('reports failure with the OAIQ error message on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ errors: [{ code: 'BAD', message: 'nope' }] }),
    }) as any;

    const result = await sendOpenAITestEvent(makeEvent(), [], MAPPING, CREDS);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('nope');
  });
});

// ── validateOpenAICredentials ─────────────────────────────────────────────────

describe('validateOpenAICredentials', () => {
  it('fails fast when required fields are missing', async () => {
    global.fetch = vi.fn() as any;

    const result = await validateOpenAICredentials({ publisher_id: '', api_key: '' } as OpenAICredentials);

    expect(result.valid).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is valid when the live validate_only call succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }) as any;

    const result = await validateOpenAICredentials(CREDS);

    expect(result.valid).toBe(true);
  });

  it('is invalid when the live call fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid API key' }),
    }) as any;

    const result = await validateOpenAICredentials(CREDS);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid API key');
  });
});
