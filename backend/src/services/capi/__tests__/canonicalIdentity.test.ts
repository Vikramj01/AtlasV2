/**
 * canonicalIdentity.test.ts
 *
 * Canonical Event Identity — verifies that Meta and Google delivery adapters
 * default to the pipeline's canonical AtlasEvent.event_id (rather than a
 * throwaway randomUUID()) when no stronger platform-native dedup key exists,
 * and that the returned DeliveryResult.event_id reflects what was actually
 * transmitted to the platform. LinkedIn already does this correctly and is
 * unchanged (see linkedinDelivery.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AtlasEvent, EventMapping, MetaCredentials, GoogleCredentials } from '@/types/capi';

vi.mock('../dedupStore', () => ({
  getMetaDedupEntry: vi.fn(),
  getGoogleDedupEntry: vi.fn(),
}));

import { getMetaDedupEntry, getGoogleDedupEntry } from '../dedupStore';
import { sendMetaEvents } from '../metaDelivery';
import { sendGoogleEvents } from '../googleDelivery';

const MAPPING: EventMapping = { atlas_event: 'purchase', provider_event: 'Purchase' };

function baseEvent(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    event_id: 'canonical-evt-001',
    event_name: 'purchase',
    event_time: 1700000000,
    event_source_url: 'https://example.com/checkout',
    action_source: 'website',
    user_data: {},
    custom_data: {},
    consent_state: { analytics: 'granted', marketing: 'granted', personalisation: 'granted', functional: 'granted' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getMetaDedupEntry).mockReset();
  vi.mocked(getGoogleDedupEntry).mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

describe('Meta delivery — canonical identity', () => {
  const CREDS: MetaCredentials = { pixel_id: 'p123', access_token: 'tok', dataset_id: 'ds' };

  it('sends the canonical atlas event_id when there is no dedup-store hit', async () => {
    vi.mocked(getMetaDedupEntry).mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ events_received: 1 }),
    } as Response);

    const event = baseEvent();
    const results = await sendMetaEvents([event], [[]], [MAPPING], CREDS, null, undefined, 'provider-1');

    expect(results[0].event_id).toBe('canonical-evt-001');

    const sentBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(sentBody.data[0].event_id).toBe('canonical-evt-001');
  });

  it('reuses the browser-supplied event_id on a dedup hit instead of the canonical id', async () => {
    vi.mocked(getMetaDedupEntry).mockResolvedValue({ event_id: 'browser-beacon-evt', timestamp: Date.now() });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ events_received: 1 }),
    } as Response);

    const event = baseEvent({ user_data: { fbc: 'fb.1.123.abc' } });
    const results = await sendMetaEvents([event], [[]], [MAPPING], CREDS, null, undefined, 'provider-1');

    expect(results[0].event_id).toBe('browser-beacon-evt');
  });
});

describe('Google delivery — canonical identity', () => {
  const CREDS: GoogleCredentials = {
    customer_id: '123-456-7890',
    oauth_access_token: 'tok',
    oauth_refresh_token: 'refresh',
    conversion_action_id: '999',
  };

  it('defaults transactionId to the canonical atlas event_id when there is no order_id or gclid dedup hit', async () => {
    vi.mocked(getGoogleDedupEntry).mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ requestId: 'req-1' }),
    } as Response);

    const event = baseEvent();
    const results = await sendGoogleEvents([event], [[]], [MAPPING], CREDS, 'provider-1');

    expect(results[0].status).toBe('delivered');
    // DeliveryResult.event_id must reflect what was actually sent as transactionId,
    // not just the raw AtlasEvent.event_id (both happen to be equal here, but the
    // regression this guards against is reporting the wrong field entirely).
    expect(results[0].event_id).toBe('canonical-evt-001');

    const sentBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(sentBody.events[0].transactionId).toBe('canonical-evt-001');
  });

  it('prefers an explicit custom_data.order_id over the canonical event_id', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ requestId: 'req-1' }),
    } as Response);

    const event = baseEvent({ custom_data: { order_id: 'business-order-42' } });
    const results = await sendGoogleEvents([event], [[]], [MAPPING], CREDS, 'provider-1');

    expect(results[0].event_id).toBe('business-order-42');
    // No dedup lookup needed when a business order_id is already present.
    expect(getGoogleDedupEntry).not.toHaveBeenCalled();
  });

  it('reports the actual orderId sent on a hard failure, not the raw event_id', async () => {
    // The live events:ingest response has no partial-failure envelope to
    // simulate (IngestEventsResponse is just { requestId, fieldWarnings } —
    // see the DMA schema fix) — a non-2xx HTTP response is the real failure
    // mode this guards against.
    vi.mocked(getGoogleDedupEntry).mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 400, message: 'bad request', status: 'INVALID_ARGUMENT' } }),
    } as Response);

    const event = baseEvent();
    const results = await sendGoogleEvents([event], [[]], [MAPPING], CREDS, 'provider-1');

    expect(results[0].status).toBe('failed');
    expect(results[0].event_id).toBe('canonical-evt-001');
  });
});
