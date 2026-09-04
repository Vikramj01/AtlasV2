/**
 * Layer L10 — Deduplication rule tests.
 *
 * Both rules check event_id propagation across channels a single crawl can
 * actually observe — not whether the live production dedup store
 * (services/capi/dedupStore.ts) is currently deduplicating, which needs
 * provider credentials and Redis and isn't crawl-time data.
 */
import { describe, it, expect } from 'vitest';
import { EVENT_ID_CONSISTENT_CLIENT_TO_SERVER, EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS, L10_RULES } from '../L10';
import type { AuditData, DataLayerEvent, NetworkRequest } from '@/types/audit';

function makeEvent(overrides: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { event: 'purchase', timestamp: Date.now(), step: 'confirmation', ...overrides };
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://example.com/whatever',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    step: 'confirmation',
    ...overrides,
  };
}

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://shop.example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'ecommerce',
    declared_platforms: ['google_ads'],
    declared_conversions: [{ name: 'purchase', kind: 'primary' }],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L10.1 — event_id consistent from client to server-side delivery ─────────

describe('EVENT_ID_CONSISTENT_CLIENT_TO_SERVER (L10.1)', () => {
  it('is skipped when no client-side event_id was observed', () => {
    expect(EVENT_ID_CONSISTENT_CLIENT_TO_SERVER.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when no server-side delivery channel was detected', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event_id: 'evt-123' })] });
    expect(EVENT_ID_CONSISTENT_CLIENT_TO_SERVER.test(auditData).status).toBe('skipped');
  });

  it('passes for a deduplicated pair — the same event_id appears in the client dataLayer AND the sGTM-shaped server request', () => {
    const auditData = makeAuditData({
      dataLayer: [makeEvent({ event_id: 'evt-abc-123' })],
      networkRequests: [
        makeRequest({ url: 'https://shop.example.com/g/collect', body: 'en=purchase&event_id=evt-abc-123' }),
      ],
    });
    expect(EVENT_ID_CONSISTENT_CLIENT_TO_SERVER.test(auditData).status).toBe('pass');
  });

  it('fails for a non-deduplicated pair — a server-side channel exists but never carries the client event_id', () => {
    const auditData = makeAuditData({
      dataLayer: [makeEvent({ event_id: 'evt-abc-123' })],
      networkRequests: [
        makeRequest({ url: 'https://shop.example.com/g/collect', body: 'en=purchase&event_id=some-other-id' }),
      ],
    });
    const result = EVENT_ID_CONSISTENT_CLIENT_TO_SERVER.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.found).toContain('evt-abc-123');
  });
});

// ── L10.2 — event_id forwarded to declared platform requests ────────────────

describe('EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS (L10.2)', () => {
  it('is skipped when no client-side event_id was observed', () => {
    expect(EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when no declared platform has any request at all', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event_id: 'evt-123' })] });
    expect(EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS.test(auditData).status).toBe('skipped');
  });

  it('passes for a deduplicated pair — the event_id reaches the declared platform\'s own request', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      dataLayer: [makeEvent({ event_id: 'evt-abc-123' })],
      networkRequests: [
        makeRequest({ url: 'https://googleadservices.com/pagead/conversion/123?event_id=evt-abc-123' }),
      ],
    });
    expect(EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS.test(auditData).status).toBe('pass');
  });

  it('fails for a non-deduplicated pair — the platform request exists but never carries the event_id', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      dataLayer: [makeEvent({ event_id: 'evt-abc-123' })],
      networkRequests: [
        makeRequest({ url: 'https://googleadservices.com/pagead/conversion/123' }),
      ],
    });
    const result = EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS.test(auditData);
    expect(result.status).toBe('fail');
  });

  it('only checks declared platforms — an undeclared platform carrying the event_id does not count', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'], // meta not declared
      dataLayer: [makeEvent({ event_id: 'evt-abc-123' })],
      networkRequests: [
        makeRequest({ url: 'https://googleadservices.com/pagead/conversion/123' }), // no event_id
        makeRequest({ url: 'https://www.facebook.com/tr?id=1&eid=evt-abc-123' }), // has it, but undeclared
      ],
    });
    expect(EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS.test(auditData).status).toBe('fail');
  });
});

describe('L10_RULES', () => {
  it('exports both L10 rules', () => {
    expect(L10_RULES).toHaveLength(2);
    expect(new Set(L10_RULES.map((r) => r.id)).size).toBe(2);
    expect(new Set(L10_RULES.map((r) => r.rule_id)).size).toBe(2);
  });

  it('every rule declares layer "deduplication"', () => {
    expect(L10_RULES.every((r) => r.layer === 'deduplication')).toBe(true);
  });
});
