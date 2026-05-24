/**
 * CAPI Pipeline unit tests
 *
 * Verifies: consent gate, dedup, PII hashing, provider routing, and logging.
 *
 * Key behaviours:
 *   1. Events blocked when consent_state.marketing is 'denied' (Meta/LinkedIn)
 *   2. Events blocked when consent_state.analytics is 'denied' (Google)
 *   3. Duplicate events (same event_id) return status 'dedup_skipped'
 *   4. PII fields SHA-256 hashed before reaching delivery functions
 *   5. Raw PII never surfaces in delivery call arguments
 *   6. Meta delivery called for meta provider; Google for google provider
 *   7. CAPI event log created after successful delivery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/capiQueries', () => ({
  isEventDuplicate: vi.fn(),
  createCAPIEvent: vi.fn(),
  incrementProviderCounters: vi.fn(),
}));

vi.mock('@/services/capi/credentials', () => ({
  safeDecryptCredentials: vi.fn(),
}));

vi.mock('@/services/capi/metaDelivery', () => ({
  sendMetaEvents: vi.fn(),
  checkUserParamCompleteness: vi.fn().mockReturnValue(null),
}));

vi.mock('@/services/capi/googleDelivery', () => ({
  sendGoogleEvents: vi.fn(),
}));

vi.mock('@/services/capi/linkedinDelivery', () => ({
  sendLinkedInEvents: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as capiQueries from '@/services/database/capiQueries';
import * as metaDelivery from '@/services/capi/metaDelivery';
import * as googleDelivery from '@/services/capi/googleDelivery';
import { processEvent } from '../pipeline';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    event_id: 'evt-001',
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    consent_state: {
      marketing: 'granted',
      analytics: 'granted',
    },
    user_data: {
      email: '  User@Example.COM  ',
      phone: '+1 (415) 555-1234',
      first_name: 'John',
      last_name: 'Doe',
      client_user_agent: 'Mozilla/5.0',
      client_ip_address: '1.2.3.4',
    },
    custom_data: { value: 99.99, currency: 'GBP' },
    ...overrides,
  };
}

const META_PROVIDER_CONFIG: any = {
  id: 'prov-meta-001',
  provider: 'meta',
  organization_id: 'org-001',
  status: 'active',
  identifier_config: {
    enabled_identifiers: ['email', 'phone', 'fn', 'ln'],
  },
  dedup_config: {
    enabled: true,
    dedup_window_minutes: 2880,
  },
  event_mapping: [
    { atlas_event: 'Purchase', provider_event: 'Purchase' },
  ],
  credentials: 'encrypted-blob',
};

const GOOGLE_PROVIDER_CONFIG: any = {
  id: 'prov-google-001',
  provider: 'google',
  organization_id: 'org-001',
  status: 'active',
  identifier_config: {
    enabled_identifiers: ['email', 'phone'],
  },
  dedup_config: {
    enabled: false,
    dedup_window_minutes: 0,
  },
  event_mapping: [
    { atlas_event: 'Purchase', provider_event: 'purchase' },
  ],
  credentials: 'encrypted-blob',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CAPI pipeline — consent gate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('blocks Meta event when marketing consent is denied', async () => {
    const event = makeEvent({ consent_state: { marketing: 'denied', analytics: 'granted' } });

    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);

    const result = await processEvent(event as any, META_PROVIDER_CONFIG);

    expect(result.status).toBe('consent_blocked');
    expect(metaDelivery.sendMetaEvents).not.toHaveBeenCalled();
  });

  it('blocks event when consent_state is missing entirely', async () => {
    const event = makeEvent({ consent_state: undefined });

    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);

    const result = await processEvent(event as any, META_PROVIDER_CONFIG);

    expect(result.status).toBe('consent_blocked');
  });

  it('allows Meta event when marketing consent is granted', async () => {
    const event = makeEvent({ consent_state: { marketing: 'granted', analytics: 'granted' } });

    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered', provider_response: { events_received: 1 } },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    const result = await processEvent(event as any, META_PROVIDER_CONFIG);

    expect(result.status).not.toBe('consent_blocked');
    expect(metaDelivery.sendMetaEvents).toHaveBeenCalledOnce();
  });

  it('blocks Google event when analytics consent is denied', async () => {
    const event = makeEvent({ consent_state: { marketing: 'granted', analytics: 'denied' } });

    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);

    const result = await processEvent(event as any, GOOGLE_PROVIDER_CONFIG);

    expect(result.status).toBe('consent_blocked');
    expect(googleDelivery.sendGoogleEvents).not.toHaveBeenCalled();
  });
});

describe('CAPI pipeline — deduplication', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skips duplicate events (same event_id within window)', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(true);

    const result = await processEvent(makeEvent() as any, META_PROVIDER_CONFIG);

    expect(result.status).toBe('dedup_skipped');
    expect(metaDelivery.sendMetaEvents).not.toHaveBeenCalled();
  });

  it('processes non-duplicate events normally', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered', provider_response: {} },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    const result = await processEvent(makeEvent({ event_id: 'evt-unique-999' }) as any, META_PROVIDER_CONFIG);

    expect(result.status).not.toBe('dedup_skipped');
    expect(metaDelivery.sendMetaEvents).toHaveBeenCalledOnce();
  });

  it('skips dedup check when dedup_config.enabled=false', async () => {
    vi.mocked(googleDelivery.sendGoogleEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered', provider_response: {} },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, GOOGLE_PROVIDER_CONFIG);

    expect(capiQueries.isEventDuplicate).not.toHaveBeenCalled();
  });
});

describe('CAPI pipeline — PII hashing', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hashes email with lowercase+trim normalisation', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered' },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, META_PROVIDER_CONFIG);

    const callArgs = vi.mocked(metaDelivery.sendMetaEvents).mock.calls[0];
    const identifiers: any[] = (callArgs[1] as any)[0];

    const emailEntry = identifiers.find((h: any) => h.type === 'email');
    expect(emailEntry).toBeDefined();
    expect(emailEntry.value).toBe(sha256('user@example.com'));
    expect(emailEntry.is_hashed).toBe(true);
  });

  it('hashes phone with digit-only normalisation preserving leading +', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered' },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, META_PROVIDER_CONFIG);

    const callArgs = vi.mocked(metaDelivery.sendMetaEvents).mock.calls[0];
    const identifiers: any[] = (callArgs[1] as any)[0];

    const phoneEntry = identifiers.find((h: any) => h.type === 'phone');
    expect(phoneEntry).toBeDefined();
    expect(phoneEntry.value).toBe(sha256('+14155551234'));
  });

  it('sends only hashed identifiers (not raw PII) in the identifiers argument', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered' },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, META_PROVIDER_CONFIG);

    const callArgs = vi.mocked(metaDelivery.sendMetaEvents).mock.calls[0];
    const identifiers: any[] = (callArgs[1] as any)[0];
    const identifiersStr = JSON.stringify(identifiers);

    expect(identifiersStr).not.toContain('User@Example.COM');
    expect(identifiersStr).not.toContain('4155551234');
    expect(identifiersStr).not.toContain('John');
    expect(identifiersStr).not.toContain('Doe');
    // All identifier values should be hex hashes
    identifiers.filter(i => i.is_hashed).forEach(i => {
      expect(i.value).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

describe('CAPI pipeline — provider routing', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls sendMetaEvents for meta provider', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered' },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, META_PROVIDER_CONFIG);

    expect(metaDelivery.sendMetaEvents).toHaveBeenCalledOnce();
    expect(googleDelivery.sendGoogleEvents).not.toHaveBeenCalled();
  });

  it('calls sendGoogleEvents for google provider', async () => {
    vi.mocked(googleDelivery.sendGoogleEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered' },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, GOOGLE_PROVIDER_CONFIG);

    expect(googleDelivery.sendGoogleEvents).toHaveBeenCalledOnce();
    expect(metaDelivery.sendMetaEvents).not.toHaveBeenCalled();
  });
});

describe('CAPI pipeline — logging', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates CAPI event log record after successful delivery', async () => {
    vi.mocked(capiQueries.isEventDuplicate).mockResolvedValue(false);
    vi.mocked(metaDelivery.sendMetaEvents).mockResolvedValue([
      { event_id: 'evt-001', status: 'delivered', provider_response: {} },
    ] as any);
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);
    vi.mocked(capiQueries.incrementProviderCounters).mockResolvedValue(undefined);

    await processEvent(makeEvent() as any, META_PROVIDER_CONFIG);

    expect(capiQueries.createCAPIEvent).toHaveBeenCalledOnce();
  });

  it('creates CAPI event log even for consent_blocked events', async () => {
    vi.mocked(capiQueries.createCAPIEvent).mockResolvedValue(undefined);

    await processEvent(
      makeEvent({ consent_state: { marketing: 'denied' } }) as any,
      META_PROVIDER_CONFIG,
    );

    expect(capiQueries.createCAPIEvent).toHaveBeenCalledOnce();
    const loggedEvent = vi.mocked(capiQueries.createCAPIEvent).mock.calls[0][0] as any;
    expect(loggedEvent.status).toBe('consent_blocked');
  });
});
