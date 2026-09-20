/**
 * webhookIngest.ts unit tests — docs/prd/universal-outcome-ingestion.md §6.
 *
 * contract.ts / objectMapper.ts / valueLadder.ts / deliveryGate.ts /
 * eventId.ts are all pure and exercised for real (each already has its own
 * dedicated test file); only the DB layer and outcomeDelivery.ts are
 * mocked, mirroring syncOrchestrator.test.ts's convention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/outcomeQueries', () => ({
  listOutcomeStageMappings: vi.fn(),
  findExistingOutcomeKeys: vi.fn(),
  upsertOutcomeEvents: vi.fn(),
  getRecentIdentityMethodsForConfig: vi.fn(),
  updateOutcomeSourceConfig: vi.fn(),
  getLatestDerivedValueSnapshots: vi.fn(),
}));

vi.mock('@/services/outcomes/outcomeDelivery', () => ({
  deliverOutcome: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  listOutcomeStageMappings,
  findExistingOutcomeKeys,
  upsertOutcomeEvents,
  getRecentIdentityMethodsForConfig,
  updateOutcomeSourceConfig,
  getLatestDerivedValueSnapshots,
} from '@/services/database/outcomeQueries';
import { deliverOutcome } from '@/services/outcomes/outcomeDelivery';
import { runWebhookIngest } from '../webhookIngest';
import { computeEventId } from '../eventId';
import type { OutcomeSourceConfig, OutcomeStageMapping } from '@/types/outcomes';

function makeConfig(overrides: Partial<OutcomeSourceConfig> = {}): OutcomeSourceConfig {
  return {
    id: 'config-1',
    organization_id: 'org-1',
    client_id: 'client-1',
    connection_id: null,
    source_type: 'webhook',
    pipeline_id: null,
    tracked_object: 'deal',
    identity_property_map: {},
    value_mode: 'DECLARED',
    default_currency: 'USD',
    backfill_days: 30,
    sync_enabled: false,
    sync_interval_minutes: 360,
    write_back_enabled: false,
    last_synced_at: null,
    last_sync_status: null,
    last_sync_error: null,
    consecutive_failures: 0,
    webhook_secret_encrypted: 'encrypted-secret',
    delivery_enabled: true,
    delivery_disabled_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMapping(overrides: Partial<OutcomeStageMapping> = {}): OutcomeStageMapping {
  return {
    id: 'mapping-1',
    organization_id: 'org-1',
    config_id: 'config-1',
    crm_stage_id: 'closedwon',
    crm_stage_label: 'Closed Won',
    stage_order: 5,
    atlas_event_name: 'crm_closed_won',
    is_terminal_won: true,
    is_terminal_lost: false,
    declared_value: 500,
    currency: 'USD',
    google_conversion_action_id: 'gcid-1',
    meta_event_name: null,
    linkedin_conversion_id: null,
    enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    source_record_id: 'deal-123',
    source_stage_id: 'closedwon',
    stage_changed_at: '2026-09-20T12:00:00Z',
    identity: { gclid: 'test_gclid_123' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
  vi.mocked(findExistingOutcomeKeys).mockResolvedValue(new Set());
  vi.mocked(upsertOutcomeEvents).mockResolvedValue(1);
  vi.mocked(getRecentIdentityMethodsForConfig).mockResolvedValue([]);
  vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([]);
  vi.mocked(deliverOutcome).mockResolvedValue({
    status: 'delivered',
    detail: { google: { status: 'delivered' } },
    delivered_at: '2026-09-20T12:00:01Z',
  });
});

describe('runWebhookIngest — rejected', () => {
  it('rejects an invalid contract payload with field-level errors, touching no DB/delivery', async () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).source_record_id;

    const result = await runWebhookIngest(makeConfig(), payload, { dryRun: false });

    expect(result.status).toBe('rejected');
    expect(result.errors?.some((e) => e.field === 'source_record_id')).toBe(true);
    expect(listOutcomeStageMappings).not.toHaveBeenCalled();
    expect(deliverOutcome).not.toHaveBeenCalled();
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });
});

describe('runWebhookIngest — skipped_unmapped', () => {
  it('skips a valid payload whose stage has no enabled mapping', async () => {
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping({ crm_stage_id: 'some-other-stage' })]);

    const result = await runWebhookIngest(makeConfig(), validPayload(), { dryRun: false });

    expect(result.status).toBe('skipped_unmapped');
    expect(deliverOutcome).not.toHaveBeenCalled();
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });
});

describe('runWebhookIngest — skipped_duplicate (idempotency)', () => {
  it('skips delivery and persistence when the (record, stage) key already exists', async () => {
    vi.mocked(findExistingOutcomeKeys).mockResolvedValue(new Set(['deal-123::closedwon']));

    const result = await runWebhookIngest(makeConfig(), validPayload(), { dryRun: false });

    expect(result.status).toBe('skipped_duplicate');
    expect(result.event_id).toBe(computeEventId('config-1', 'deal-123', 'closedwon'));
    expect(deliverOutcome).not.toHaveBeenCalled();
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });
});

describe('runWebhookIngest — accepted + delivered', () => {
  it('resolves identity/value, delivers, and persists the real post-delivery status', async () => {
    const result = await runWebhookIngest(makeConfig(), validPayload({ value: 500, currency: 'USD' }), { dryRun: false });

    expect(result.status).toBe('accepted');
    expect(result.identity_method).toBe('click_id');
    expect(result.tier).toBe(1);
    expect(result.delivery_status).toBe('delivered');
    expect(deliverOutcome).toHaveBeenCalledTimes(1);
    expect(upsertOutcomeEvents).toHaveBeenCalledTimes(1);

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0].delivery_status).toBe('delivered');
    expect(rows[0].event_id).toBe(computeEventId('config-1', 'deal-123', 'closedwon'));
  });

  it('passes the deterministic event_id and resolved identity through to deliverOutcome', async () => {
    await runWebhookIngest(makeConfig(), validPayload(), { dryRun: false });

    const [, input] = vi.mocked(deliverOutcome).mock.calls[0];
    expect(input.event_id).toBe(computeEventId('config-1', 'deal-123', 'closedwon'));
    expect(input.identity.method).toBe('click_id');
    expect(input.identity.values.gclid).toBe('test_gclid_123');
  });
});

describe('runWebhookIngest — skipped_delivery_disabled', () => {
  it('resolves identity but never calls deliverOutcome when delivery_enabled is false', async () => {
    const result = await runWebhookIngest(makeConfig({ delivery_enabled: false }), validPayload(), { dryRun: false });

    expect(result.status).toBe('accepted');
    expect(result.delivery_status).toBe('skipped_delivery_disabled');
    expect(deliverOutcome).not.toHaveBeenCalled();

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0].delivery_status).toBe('skipped_delivery_disabled');
  });

  it('never checks or fires the delivery gate when delivery is already disabled', async () => {
    await runWebhookIngest(makeConfig({ delivery_enabled: false }), validPayload(), { dryRun: false });

    expect(getRecentIdentityMethodsForConfig).not.toHaveBeenCalled();
    expect(updateOutcomeSourceConfig).not.toHaveBeenCalled();
  });
});

describe('runWebhookIngest — unresolved identity', () => {
  it('an empty identity object fails contract validation before ever reaching identity resolution', async () => {
    const result = await runWebhookIngest(makeConfig(), validPayload({ identity: {} }), { dryRun: false });
    expect(result.status).toBe('rejected');
    expect(result.errors?.some((e) => e.field === 'identity')).toBe(true);
  });

  it('a bare atlas_event_id (a real but unresolvable identity shape — see contract.ts\'s own documented decision) resolves to unresolved and is recorded skipped_unresolved, never delivered', async () => {
    const result = await runWebhookIngest(
      makeConfig(),
      validPayload({ identity: { atlas_event_id: 'evt-1' } }),
      { dryRun: false },
    );

    expect(result.status).toBe('accepted');
    expect(result.identity_method).toBe('unresolved');
    expect(result.delivery_status).toBe('skipped_unresolved');
    expect(deliverOutcome).not.toHaveBeenCalled();
  });
});

describe('runWebhookIngest — dry run', () => {
  it('never persists or delivers, but reports would_deliver and the resolved value', async () => {
    const result = await runWebhookIngest(makeConfig(), validPayload({ value: 500, currency: 'USD' }), { dryRun: true });

    expect(result.status).toBe('accepted');
    expect(result.would_deliver).toBe(true);
    expect(result.delivery_status).toBeUndefined();
    expect(deliverOutcome).not.toHaveBeenCalled();
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
    expect(findExistingOutcomeKeys).not.toHaveBeenCalled();
  });

  it('reports would_deliver: false when delivery is disabled', async () => {
    const result = await runWebhookIngest(makeConfig({ delivery_enabled: false }), validPayload(), { dryRun: true });

    expect(result.would_deliver).toBe(false);
    expect(deliverOutcome).not.toHaveBeenCalled();
  });

  it('never checks the duplicate key or the delivery gate in dry-run mode', async () => {
    await runWebhookIngest(makeConfig(), validPayload(), { dryRun: true });

    expect(findExistingOutcomeKeys).not.toHaveBeenCalled();
    expect(getRecentIdentityMethodsForConfig).not.toHaveBeenCalled();
    expect(updateOutcomeSourceConfig).not.toHaveBeenCalled();
  });
});

describe('runWebhookIngest — source_object is never taken from the contract record', () => {
  it("always persists the config's own tracked_object, even when the sender declares a different source_object", async () => {
    await runWebhookIngest(
      makeConfig({ tracked_object: 'deal' }),
      validPayload({ source_object: 'spreadsheet_row' }),
      { dryRun: false },
    );

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0].source_object).toBe('deal');
    expect(rows[0].source_object).not.toBe('spreadsheet_row');
  });
});

describe('runWebhookIngest — auto-disable delivery gate', () => {
  it('disables delivery inline after ingest once the recomputed tier-3 rate crosses threshold', async () => {
    // 10 recent records, all unresolved -> 100% tier-3, well past the
    // MIN_SAMPLE_FOR_GATE/threshold combination.
    vi.mocked(getRecentIdentityMethodsForConfig).mockResolvedValue(Array(10).fill('unresolved'));

    await runWebhookIngest(makeConfig(), validPayload(), { dryRun: false });

    expect(updateOutcomeSourceConfig).toHaveBeenCalledTimes(1);
    const [configId, orgId, patch] = vi.mocked(updateOutcomeSourceConfig).mock.calls[0];
    expect(configId).toBe('config-1');
    expect(orgId).toBe('org-1');
    expect(patch.delivery_enabled).toBe(false);
    expect(patch.delivery_disabled_reason).toMatch(/could not be matched to an identity/);
  });

  it('never disables delivery when the recomputed tier-3 rate stays healthy', async () => {
    vi.mocked(getRecentIdentityMethodsForConfig).mockResolvedValue(Array(10).fill('click_id'));

    await runWebhookIngest(makeConfig(), validPayload(), { dryRun: false });

    expect(updateOutcomeSourceConfig).not.toHaveBeenCalled();
  });

  it('checks the gate using the recomputed stats fetched after this ingest, not before', async () => {
    await runWebhookIngest(makeConfig(), validPayload(), { dryRun: false });

    expect(getRecentIdentityMethodsForConfig).toHaveBeenCalledWith('config-1');
    expect(getRecentIdentityMethodsForConfig).toHaveBeenCalledTimes(1);
  });
});
