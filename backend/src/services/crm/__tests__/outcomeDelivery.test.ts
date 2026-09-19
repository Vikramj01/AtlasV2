/**
 * outcomeDelivery.ts unit tests — Sprint 5 exit criterion: "Outcomes deliver
 * to at least Google and Meta with correct dedup."
 *
 * Covers: per-destination routing (only attempts what the stage mapping
 * configures), ingest-window skipping (§9.3), consent inheritance (§8),
 * aggregateStatus's combination logic, and that no raw PII value is ever
 * passed to the logger (acceptance criterion #13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/capiQueries', () => ({
  listProviders: vi.fn(),
  getProvider: vi.fn(),
  getCAPIEventByAtlasEventId: vi.fn(),
}));

vi.mock('@/services/capi/credentials', () => ({
  safeDecryptCredentials: vi.fn((c: unknown) => c),
}));

vi.mock('@/services/capi/pipeline', () => ({
  processServerSourcedEvent: vi.fn(),
  isConsentGranted: vi.fn(),
}));

vi.mock('@/services/offline-conversions/googleOfflineUpload', () => ({
  uploadOfflineConversions: vi.fn(),
}));

function makeSupabaseChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  return chain;
}

const fromMock = vi.fn();
vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  listProviders,
  getProvider as getCapiProviderConfig,
  getCAPIEventByAtlasEventId,
} from '@/services/database/capiQueries';
import { processServerSourcedEvent, isConsentGranted } from '@/services/capi/pipeline';
import { uploadOfflineConversions } from '@/services/offline-conversions/googleOfflineUpload';
import logger from '@/utils/logger';
import { deliverOutcome, type OutcomeDeliveryInput } from '../outcomeDelivery';
import type { CrmStageMapping } from '@/types/crm';
import type { ResolvedIdentity } from '../identityResolver';

const RAW_EMAIL = 'lead-secret@example.com';
const RAW_PHONE = '+15551234567';
const RAW_GCLID = 'CjW-SUPER-SECRET-CLICK-ID';

function makeMapping(overrides: Partial<CrmStageMapping> = {}): CrmStageMapping {
  return {
    id: 'mapping-1',
    organization_id: 'org-1',
    config_id: 'config-1',
    crm_stage_id: 'closedwon',
    crm_stage_label: 'Closed Won',
    stage_order: 3,
    atlas_event_name: 'crm_closed_won',
    is_terminal_won: true,
    is_terminal_lost: false,
    declared_value: 5000,
    currency: 'USD',
    google_conversion_action_id: null,
    meta_event_name: null,
    linkedin_conversion_id: null,
    enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    method: 'hashed_email',
    keys_present: ['email'],
    values: { email: RAW_EMAIL },
    ...overrides,
  };
}

function makeInput(overrides: Partial<OutcomeDeliveryInput> = {}): OutcomeDeliveryInput {
  return {
    organization_id: 'org-1',
    event_id: 'evt-deterministic-1',
    stage_changed_at: new Date().toISOString(),
    conversion_value: 5000,
    currency: 'USD',
    identity: makeIdentity(),
    ...overrides,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCAPIEventByAtlasEventId).mockResolvedValue(null);
  vi.mocked(isConsentGranted).mockReturnValue(true);
  fromMock.mockReturnValue(makeSupabaseChain({ data: { credentials: { customer_id: '123', oauth_access_token: 'tok' } }, error: null }));
});

describe('deliverOutcome — routing', () => {
  it('returns pending and attempts nothing when the stage has no destination configured', async () => {
    const result = await deliverOutcome(makeMapping(), makeInput());

    expect(result.status).toBe('pending');
    expect(result.detail).toEqual({});
    expect(result.delivered_at).toBeNull();
    expect(uploadOfflineConversions).not.toHaveBeenCalled();
    expect(processServerSourcedEvent).not.toHaveBeenCalled();
  });

  it('only attempts the destinations the stage mapping actually configures', async () => {
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const result = await deliverOutcome(mapping, makeInput());

    expect(result.detail.google).toBeUndefined();
    expect(result.detail.linkedin).toBeUndefined();
    expect(result.detail.meta).toEqual({ status: 'delivered' });
    expect(uploadOfflineConversions).not.toHaveBeenCalled();
  });
});

describe('deliverOutcome — Google (googleOfflineUpload path)', () => {
  it('delivers successfully when within window, consent granted, and a row uploads', async () => {
    vi.mocked(uploadOfflineConversions).mockResolvedValue({
      partial_failure: false,
      row_results: [{ status: 'uploaded' }],
      requestIds: ['req-1'],
    } as never);

    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc' });
    const result = await deliverOutcome(mapping, makeInput());

    expect(result.status).toBe('delivered');
    expect(result.detail.google).toEqual({ status: 'delivered' });
    expect(result.delivered_at).not.toBeNull();
  });

  it('skips as skipped_window when a hashed-email-resolved outcome is older than the 63-day Enhanced Conversions for Leads window', async () => {
    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc' });
    const result = await deliverOutcome(mapping, makeInput({ stage_changed_at: daysAgo(64) }));

    expect(result.detail.google).toEqual({ status: 'skipped_window', window_days: 63 });
    expect(uploadOfflineConversions).not.toHaveBeenCalled();
  });

  it('uses the 90-day click_id window (not the 63-day one) when identity resolved via click_id', async () => {
    vi.mocked(uploadOfflineConversions).mockResolvedValue({
      partial_failure: false,
      row_results: [{ status: 'uploaded' }],
      requestIds: [],
    } as never);
    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc' });
    const input = makeInput({
      stage_changed_at: daysAgo(70), // past the 63-day PII window, within the 90-day click_id window
      identity: makeIdentity({ method: 'click_id', keys_present: ['gclid'], values: { gclid: RAW_GCLID } }),
    });

    const result = await deliverOutcome(mapping, input);

    expect(result.detail.google).toEqual({ status: 'delivered' });
  });

  it('reports failed with consent_blocked_at_capture and never calls uploadOfflineConversions when analytics consent is denied', async () => {
    vi.mocked(getCAPIEventByAtlasEventId).mockResolvedValue({ consent_state: { analytics: 'denied' } });
    vi.mocked(isConsentGranted).mockReturnValue(false);

    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc' });
    const result = await deliverOutcome(mapping, makeInput({
      identity: makeIdentity({ values: { email: RAW_EMAIL, event_id: 'original-evt-1' } }),
    }));

    expect(result.detail.google).toEqual({ status: 'failed', reason: 'consent_blocked_at_capture' });
    expect(uploadOfflineConversions).not.toHaveBeenCalled();
  });

  it('reports failed with no_active_google_connection when no active google provider credentials exist', async () => {
    fromMock.mockReturnValue(makeSupabaseChain({ data: null, error: null }));
    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc' });

    const result = await deliverOutcome(mapping, makeInput());

    expect(result.detail.google).toEqual({ status: 'failed', reason: 'no_active_google_connection' });
    expect(uploadOfflineConversions).not.toHaveBeenCalled();
  });

  it('reports failed with the row error_message when the upload rejects the row', async () => {
    vi.mocked(uploadOfflineConversions).mockResolvedValue({
      partial_failure: true,
      row_results: [{ status: 'failed', error_message: 'INVALID_CONVERSION_ACTION' }],
      requestIds: [],
    } as never);
    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc' });

    const result = await deliverOutcome(mapping, makeInput());

    expect(result.detail.google).toEqual({ status: 'failed', reason: 'INVALID_CONVERSION_ACTION' });
  });
});

describe('deliverOutcome — Meta/LinkedIn (processServerSourcedEvent path)', () => {
  it('delivers to Meta using the stage mapping\'s own meta_event_name', async () => {
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    const result = await deliverOutcome(mapping, makeInput());

    expect(result.detail.meta).toEqual({ status: 'delivered' });
    const [eventArg] = vi.mocked(processServerSourcedEvent).mock.calls[0];
    expect(eventArg.event_name).toBe('Purchase');
  });

  it('routes LinkedIn by atlas_event_name, since linkedinDelivery.ts has no per-event conversion_id override', async () => {
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p2', provider: 'linkedin', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p2', provider: 'linkedin' } as never);

    const mapping = makeMapping({ linkedin_conversion_id: 'urn:li:conversion:123', atlas_event_name: 'crm_closed_won' });
    const result = await deliverOutcome(mapping, makeInput());

    expect(result.detail.linkedin).toEqual({ status: 'delivered' });
    const [eventArg] = vi.mocked(processServerSourcedEvent).mock.calls[0];
    expect(eventArg.event_name).toBe('crm_closed_won');
  });

  it('reports dedup_skipped when the pipeline dedups the event', async () => {
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'dedup_skipped' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    const result = await deliverOutcome(mapping, makeInput());

    expect(result.status).toBe('dedup_skipped');
    expect(result.detail.meta).toEqual({ status: 'dedup_skipped' });
  });

  it('reports failed with no_active_meta_connection when no active Meta provider exists', async () => {
    vi.mocked(listProviders).mockResolvedValue([]);
    const mapping = makeMapping({ meta_event_name: 'Purchase' });

    const result = await deliverOutcome(mapping, makeInput());

    expect(result.detail.meta).toEqual({ status: 'failed', reason: 'no_active_meta_connection' });
    expect(processServerSourcedEvent).not.toHaveBeenCalled();
  });

  it('skips as skipped_window past Meta\'s 62-day offline event window', async () => {
    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    const result = await deliverOutcome(mapping, makeInput({ stage_changed_at: daysAgo(63) }));

    expect(result.detail.meta).toEqual({ status: 'skipped_window', window_days: 62 });
    expect(processServerSourcedEvent).not.toHaveBeenCalled();
  });

  it('skips as skipped_window past LinkedIn\'s 90-day conversionHappenedAt window', async () => {
    const mapping = makeMapping({ linkedin_conversion_id: 'urn:li:conversion:123' });
    const result = await deliverOutcome(mapping, makeInput({ stage_changed_at: daysAgo(91) }));

    expect(result.detail.linkedin).toEqual({ status: 'skipped_window', window_days: 90 });
    expect(processServerSourcedEvent).not.toHaveBeenCalled();
  });
});

describe('deliverOutcome — consent inheritance (§8)', () => {
  it('applies no consent gate at all when the record carries no atlas_event_id (genuinely server-sourced)', async () => {
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    await deliverOutcome(mapping, makeInput()); // identity has no event_id key

    expect(getCAPIEventByAtlasEventId).not.toHaveBeenCalled();
    expect(isConsentGranted).not.toHaveBeenCalled();
  });

  it('inherits the original capi_events row\'s consent_state and blocks only the denied destination', async () => {
    vi.mocked(getCAPIEventByAtlasEventId).mockResolvedValue({
      consent_state: { analytics: 'denied', marketing: 'granted' },
    });
    // google reads 'analytics', meta reads 'marketing' — simulate the real per-category split.
    vi.mocked(isConsentGranted).mockImplementation((_event, provider) => provider !== 'google');
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc', meta_event_name: 'Purchase' });
    const input = makeInput({ identity: makeIdentity({ values: { email: RAW_EMAIL, event_id: 'original-evt-1' } }) });

    const result = await deliverOutcome(mapping, input);

    expect(getCAPIEventByAtlasEventId).toHaveBeenCalledWith('org-1', 'original-evt-1');
    expect(result.detail.google).toEqual({ status: 'failed', reason: 'consent_blocked_at_capture' });
    expect(result.detail.meta).toEqual({ status: 'delivered' });
    expect(result.status).toBe('partial');
  });

  it('proceeds as server-sourced (no gate) when the atlas_event_id does not resolve to a real capi_events row', async () => {
    vi.mocked(getCAPIEventByAtlasEventId).mockResolvedValue(null);
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    const input = makeInput({ identity: makeIdentity({ values: { email: RAW_EMAIL, event_id: 'nonexistent-evt' } }) });

    const result = await deliverOutcome(mapping, input);

    expect(result.detail.meta).toEqual({ status: 'delivered' });
    expect(isConsentGranted).not.toHaveBeenCalled();
  });

  it('does not throw and proceeds server-sourced when the original-event lookup itself fails', async () => {
    vi.mocked(getCAPIEventByAtlasEventId).mockRejectedValue(new Error('db timeout'));
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    const input = makeInput({ identity: makeIdentity({ values: { email: RAW_EMAIL, event_id: 'evt-1' } }) });

    const result = await deliverOutcome(mapping, input);

    expect(result.detail.meta).toEqual({ status: 'delivered' });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('deliverOutcome — aggregateStatus combinations', () => {
  it('reports partial when one destination delivers and another fails', async () => {
    vi.mocked(uploadOfflineConversions).mockResolvedValue({
      partial_failure: false,
      row_results: [{ status: 'uploaded' }],
      requestIds: [],
    } as never);
    vi.mocked(listProviders).mockResolvedValue([]); // no active meta provider → failed

    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc', meta_event_name: 'Purchase' });
    const result = await deliverOutcome(mapping, makeInput());

    expect(result.status).toBe('partial');
    expect(result.delivered_at).not.toBeNull();
  });

  it('reports skipped_window (not failed) when every configured destination is past its window', async () => {
    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc', meta_event_name: 'Purchase' });
    const result = await deliverOutcome(mapping, makeInput({ stage_changed_at: daysAgo(100) }));

    expect(result.status).toBe('skipped_window');
    expect(result.delivered_at).toBeNull();
  });

  it('reports failed when every configured destination fails', async () => {
    fromMock.mockReturnValue(makeSupabaseChain({ data: null, error: null }));
    vi.mocked(listProviders).mockResolvedValue([]);

    const mapping = makeMapping({ google_conversion_action_id: 'AW-1/abc', meta_event_name: 'Purchase' });
    const result = await deliverOutcome(mapping, makeInput());

    expect(result.status).toBe('failed');
    expect(result.delivered_at).toBeNull();
  });
});

describe('deliverOutcome — PII handling (acceptance criterion #13)', () => {
  it('never passes the raw email/phone/click-id value to the logger, even on failure paths', async () => {
    vi.mocked(getCAPIEventByAtlasEventId).mockRejectedValue(new Error('db timeout'));
    vi.mocked(processServerSourcedEvent).mockResolvedValue({ event_id: 'x', status: 'delivered' });
    vi.mocked(listProviders).mockResolvedValue([{ id: 'p1', provider: 'meta', status: 'active' } as never]);
    vi.mocked(getCapiProviderConfig).mockResolvedValue({ id: 'p1', provider: 'meta' } as never);

    const mapping = makeMapping({ meta_event_name: 'Purchase' });
    const input = makeInput({
      identity: makeIdentity({
        keys_present: ['email', 'phone', 'gclid', 'event_id'],
        values: { email: RAW_EMAIL, phone: RAW_PHONE, gclid: RAW_GCLID, event_id: 'evt-1' },
      }),
    });

    await deliverOutcome(mapping, input);

    const allLoggedText = JSON.stringify([
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.error).mock.calls,
    ]);
    expect(allLoggedText).not.toContain(RAW_EMAIL);
    expect(allLoggedText).not.toContain(RAW_PHONE);
    expect(allLoggedText).not.toContain(RAW_GCLID);
  });
});
