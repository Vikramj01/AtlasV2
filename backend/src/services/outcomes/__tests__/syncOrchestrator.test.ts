/**
 * crmSyncOrchestrator.ts unit tests — Sprint 4 exit criterion: "A scheduled
 * sync reads changed records and writes crm_outcome_events idempotently."
 *
 * identityResolver.ts / objectMapper.ts / valueLadder.ts are exercised for
 * real (already unit-tested elsewhere) — only the DB layer and the
 * provider are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/outcomeQueries', () => ({
  getOutcomeSourceConfigByIdInternal: vi.fn(),
  listOutcomeStageMappings: vi.fn(),
  upsertOutcomeEvents: vi.fn(),
  updateOutcomeSyncState: vi.fn(),
  findExistingOutcomeKeys: vi.fn(),
  listDeliveredOutcomesForRecord: vi.fn(),
  getLatestDerivedValueSnapshots: vi.fn(),
}));

vi.mock('@/services/outcomes/sourceRegistry', () => ({
  getProvider: vi.fn(),
}));

vi.mock('@/services/connections/tokenManager', () => ({
  resolveTokens: vi.fn(),
}));

// Sprint 5's delivery module is exercised for real in outcomeDelivery.test.ts —
// here it's mocked so the orchestrator's own batching/idempotency/state
// logic can be tested without a live Google/Meta/LinkedIn call chain.
vi.mock('@/services/outcomes/outcomeDelivery', () => ({
  deliverOutcome: vi.fn(),
  handleLostDeal: vi.fn(),
  writeBackAttribution: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getOutcomeSourceConfigByIdInternal,
  listOutcomeStageMappings,
  upsertOutcomeEvents,
  updateOutcomeSyncState,
  findExistingOutcomeKeys,
  listDeliveredOutcomesForRecord,
  getLatestDerivedValueSnapshots,
} from '@/services/database/outcomeQueries';
import { getProvider } from '@/services/outcomes/sourceRegistry';
import { resolveTokens } from '@/services/connections/tokenManager';
import { deliverOutcome, handleLostDeal, writeBackAttribution } from '@/services/outcomes/outcomeDelivery';
import { runSync } from '../syncOrchestrator';
import type { OutcomeSourceConfig, OutcomeStageMapping } from '@/types/outcomes';
import type { CrmRecord, OutcomeSource } from '../sources/types';

function makeConfig(overrides: Partial<OutcomeSourceConfig> = {}): OutcomeSourceConfig {
  return {
    id: 'config-1',
    organization_id: 'org-1',
    client_id: 'client-1',
    connection_id: 'conn-1',
    source_type: 'hubspot',
    pipeline_id: 'default',
    tracked_object: 'deal',
    identity_property_map: {},
    value_mode: 'DECLARED',
    default_currency: 'USD',
    backfill_days: 30,
    sync_enabled: true,
    sync_interval_minutes: 360,
    write_back_enabled: false,
    last_synced_at: null,
    last_sync_status: null,
    last_sync_error: null,
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
    crm_stage_id: 'appointmentscheduled',
    crm_stage_label: 'Appointment Scheduled',
    stage_order: 0,
    atlas_event_name: 'crm_mql',
    is_terminal_won: false,
    is_terminal_lost: false,
    declared_value: 50,
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

function makeRecord(overrides: Partial<CrmRecord> = {}): CrmRecord {
  return {
    id: 'deal-1',
    object: 'deal',
    stage_id: 'appointmentscheduled',
    stage_changed_at: '2026-01-02T00:00:00Z',
    properties: { email: 'lead@example.com' },
    ...overrides,
  };
}

function makeProvider(records: CrmRecord[]): OutcomeSource {
  return {
    name: 'hubspot',
    transport: 'pull',
    testConnection: vi.fn(),
    listPipelines: vi.fn(),
    listProperties: vi.fn(),
    fetchChangedRecords: () => (async function* () {
      for (const r of records) yield r;
    })(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTokens).mockResolvedValue({ access_token: 'tok', expires_at: 0, token_type: 'bearer' });
  vi.mocked(upsertOutcomeEvents).mockImplementation(async (_orgId, rows) => rows.length);
  // Default: no earlier overlapping run has already processed this record —
  // most tests aren't exercising the §9.2 pre-delivery idempotency check.
  vi.mocked(findExistingOutcomeKeys).mockResolvedValue(new Set());
  // Default: nothing configured for the stage (matches makeMapping()'s
  // google/meta/linkedin fields all being null) — mirrors deliverOutcome's
  // own real "nothing to attempt" behavior.
  vi.mocked(deliverOutcome).mockResolvedValue({ status: 'pending', detail: {}, delivered_at: null });
  // Default: no earlier delivered outcomes to retract — most tests aren't
  // exercising a mapping.is_terminal_lost stage at all.
  vi.mocked(listDeliveredOutcomesForRecord).mockResolvedValue([]);
  vi.mocked(handleLostDeal).mockResolvedValue({
    google_retractions: [],
    meta_signal: { status: 'skipped', reason: 'no_active_meta_connection' },
    linkedin_and_others: 'logged_only',
  });
  // Default: no derived-value snapshots — most tests use DECLARED mode
  // (makeConfig()'s default), where this is never even queried.
  vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([]);
  vi.mocked(writeBackAttribution).mockResolvedValue(undefined);
});

describe('runSync', () => {
  it('returns not_found when the config does not exist', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(null);
    const result = await runSync('missing');
    expect(result.status).toBe('not_found');
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });

  it('returns disabled and writes nothing when sync_enabled is false', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ sync_enabled: false }));
    const result = await runSync('config-1');
    expect(result.status).toBe('disabled');
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });

  it('writes a pending outcome for a mapped stage with a resolvable identity', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

    const result = await runSync('config-1');

    expect(result.status).toBe('ok');
    expect(result.records_processed).toBe(1);
    expect(result.outcomes_written).toBe(1);
    expect(upsertOutcomeEvents).toHaveBeenCalledTimes(1);
    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0]).toMatchObject({
      source_record_id: 'deal-1',
      source_stage_id: 'appointmentscheduled',
      atlas_event_name: 'crm_mql',
      identity_method: 'hashed_email',
      delivery_status: 'pending',
      value_source: 'DECLARED',
      conversion_value: 50,
    });
  });

  it('calls deliverOutcome for a resolved identity and persists its real status/detail', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([
      makeMapping({ google_conversion_action_id: 'AW-123/abc' }),
    ]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
    vi.mocked(deliverOutcome).mockResolvedValue({
      status: 'delivered',
      detail: { google: { status: 'delivered' } },
      delivered_at: '2026-01-02T00:00:01Z',
    });

    await runSync('config-1');

    expect(deliverOutcome).toHaveBeenCalledTimes(1);
    const [mappingArg, inputArg] = vi.mocked(deliverOutcome).mock.calls[0];
    expect(mappingArg.google_conversion_action_id).toBe('AW-123/abc');
    expect(inputArg.organization_id).toBe('org-1');
    expect(inputArg.identity.method).toBe('hashed_email');

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0]).toMatchObject({
      delivery_status: 'delivered',
      delivery_detail: { google: { status: 'delivered' } },
      delivered_at: '2026-01-02T00:00:01Z',
    });
  });

  it('skips delivery entirely for a record an earlier overlapping run already processed (§9.2)', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
    vi.mocked(findExistingOutcomeKeys).mockResolvedValue(new Set(['deal-1::appointmentscheduled']));

    const result = await runSync('config-1');

    expect(deliverOutcome).not.toHaveBeenCalled();
    expect(result.outcomes_written).toBe(0);
    // Still counted as processed/seen — only the write+delivery is skipped.
    expect(result.records_processed).toBe(1);
  });

  it('skips (and counts) a record whose current stage has no mapping', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'unmapped_stage' })]));

    const result = await runSync('config-1');

    expect(result.outcomes_skipped_unmapped).toBe(1);
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });

  it('marks an unresolvable identity as skipped_unresolved, never fabricating an identifier', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ properties: {} })]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0].identity_method).toBe('unresolved');
    expect(rows[0].delivery_status).toBe('skipped_unresolved');
  });

  it('resolves CRM_AMOUNT on a terminal-won stage with a real observed amount, overriding DECLARED', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'closedwon', is_terminal_won: true, declared_value: 100 }),
    ]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([
      makeRecord({ stage_id: 'closedwon', properties: { email: 'lead@example.com', amount: '4200' } }),
    ]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0].value_source).toBe('CRM_AMOUNT');
    expect(rows[0].conversion_value).toBe(4200);
  });

  it('reads the PascalCase Amount field for a Salesforce-provider config, not HubSpot\'s lowercase amount (Sprint 10)', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ source_type: 'salesforce' }));
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'closedwon', is_terminal_won: true, declared_value: 100 }),
    ]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([
      // Salesforce's own Email field is PascalCase too — 'email' (lowercase)
      // would resolve nothing under the Salesforce default identity map.
      makeRecord({ stage_id: 'closedwon', properties: { Email: 'lead@example.com', Amount: '4200', amount: '999' } }),
    ]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows[0].value_source).toBe('CRM_AMOUNT');
    expect(rows[0].conversion_value).toBe(4200); // not 999 — the lowercase 'amount' key must be ignored for Salesforce
    expect(rows[0].identity_method).toBe('hashed_email');
  });

  it('produces the same deterministic event_id for the same (config, record, stage) across two runs', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

    await runSync('config-1');
    const firstEventId = vi.mocked(upsertOutcomeEvents).mock.calls[0][1][0].event_id;

    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
    await runSync('config-1');
    const secondEventId = vi.mocked(upsertOutcomeEvents).mock.calls[1][1][0].event_id;

    expect(firstEventId).toBe(secondEventId);
  });

  it('a record moving backwards to an earlier stage does not re-fire — only its current stage is ever written', async () => {
    // The orchestrator only ever sees a record's CURRENT stage per fetch,
    // so "moving backwards" naturally produces one row for whatever stage
    // it is currently in; the DB's UNIQUE(config_id, source_record_id,
    // source_stage_id) constraint (exercised via upsertOutcomeEvents'
    // ignoreDuplicates upsert, mocked here) is what makes re-observing an
    // already-written stage a no-op across separate runs.
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'sql', atlas_event_name: 'crm_sql' }),
      makeMapping({ crm_stage_id: 'mql', atlas_event_name: 'crm_mql' }),
    ]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'mql' })]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].source_stage_id).toBe('mql');
  });

  it('stops at the record cap, marks the run partial, and resumes from the last processed record next time', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    const records = [
      makeRecord({ id: 'deal-1', stage_changed_at: '2026-01-01T00:00:00Z' }),
      makeRecord({ id: 'deal-2', stage_changed_at: '2026-01-02T00:00:00Z' }),
      makeRecord({ id: 'deal-3', stage_changed_at: '2026-01-03T00:00:00Z' }),
    ];
    vi.mocked(getProvider).mockReturnValue(makeProvider(records));

    const result = await runSync('config-1', { recordCap: 2 });

    expect(result.cap_hit).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.records_processed).toBe(2);

    const stateUpdate = vi.mocked(updateOutcomeSyncState).mock.calls.at(-1)![1];
    expect(stateUpdate.last_sync_status).toBe('partial');
    expect(stateUpdate.last_synced_at).toBe('2026-01-02T00:00:00Z'); // the 2nd (last processed) record's timestamp, not "now"
  });

  it('advances last_synced_at to the run boundary (not a record timestamp) when the cap is not hit', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

    const before = Date.now();
    await runSync('config-1');
    const after = Date.now();

    const stateUpdate = vi.mocked(updateOutcomeSyncState).mock.calls.at(-1)![1];
    expect(stateUpdate.last_sync_status).toBe('ok');
    const advancedTo = new Date(stateUpdate.last_synced_at!).getTime();
    expect(advancedTo).toBeGreaterThanOrEqual(before);
    expect(advancedTo).toBeLessThanOrEqual(after);
  });

  it('marks the run failed and records the error when token resolution fails, without throwing', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([]));
    vi.mocked(resolveTokens).mockRejectedValue(new Error('connection revoked'));

    const result = await runSync('config-1');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('connection revoked');
    const stateUpdate = vi.mocked(updateOutcomeSyncState).mock.calls.at(-1)![1];
    expect(stateUpdate.last_sync_status).toBe('failed');
    expect(stateUpdate.last_sync_error).toContain('connection revoked');
  });

  it('marks the run failed when the provider throws mid-fetch, preserving partial progress counts', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    const provider = makeProvider([]);
    provider.fetchChangedRecords = () => (async function* () {
      yield makeRecord();
      throw new Error('HubSpot API 500');
    })();
    vi.mocked(getProvider).mockReturnValue(provider);

    const result = await runSync('config-1');

    expect(result.status).toBe('failed');
    expect(result.records_processed).toBe(1);
    expect(result.error).toContain('HubSpot API 500');
  });

  it('skips a record with no current stage_id without crashing', async () => {
    vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: null })]));

    const result = await runSync('config-1');

    expect(result.status).toBe('ok');
    expect(result.records_processed).toBe(1);
    expect(upsertOutcomeEvents).not.toHaveBeenCalled();
  });

  describe('lost-deal handling (Sprint 6, §7.4)', () => {
    it('calls handleLostDeal with the earlier delivered outcomes and full ladder when the current stage is is_terminal_lost', async () => {
      const lostMapping = makeMapping({ crm_stage_id: 'closedlost', atlas_event_name: 'crm_closed_lost', is_terminal_lost: true });
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([lostMapping]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'closedlost' })]));
      const earlierOutcomes = [{ mapping_id: 'mapping-1', event_id: 'evt-mql', delivery_detail: { google: { status: 'delivered' } } }];
      vi.mocked(listDeliveredOutcomesForRecord).mockResolvedValue(earlierOutcomes);

      await runSync('config-1');

      expect(listDeliveredOutcomesForRecord).toHaveBeenCalledWith('config-1', 'deal-1');
      expect(handleLostDeal).toHaveBeenCalledTimes(1);
      const [input, outcomes, stageMappings] = vi.mocked(handleLostDeal).mock.calls[0];
      expect(input.organization_id).toBe('org-1');
      expect(outcomes).toBe(earlierOutcomes);
      expect(stageMappings).toEqual([lostMapping]);
    });

    it('folds handleLostDeal\'s result into delivery_detail.lost_deal without changing the stage\'s own delivery_status', async () => {
      const lostMapping = makeMapping({ crm_stage_id: 'closedlost', is_terminal_lost: true });
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([lostMapping]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'closedlost' })]));
      vi.mocked(deliverOutcome).mockResolvedValue({ status: 'pending', detail: {}, delivered_at: null });
      vi.mocked(handleLostDeal).mockResolvedValue({
        google_retractions: [{ mapping_id: 'mapping-1', event_id: 'evt-mql', status: 'submitted' }],
        meta_signal: { status: 'delivered' },
        linkedin_and_others: 'logged_only',
      });

      await runSync('config-1');

      const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
      expect(rows[0].delivery_status).toBe('pending');
      expect(rows[0].delivery_detail.lost_deal).toEqual({
        google_retractions: [{ mapping_id: 'mapping-1', event_id: 'evt-mql', status: 'submitted' }],
        meta_signal: { status: 'delivered' },
        linkedin_and_others: 'logged_only',
      });
    });

    it('does not call handleLostDeal or listDeliveredOutcomesForRecord for a non-lost stage', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping({ is_terminal_lost: false })]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

      await runSync('config-1');

      expect(handleLostDeal).not.toHaveBeenCalled();
      expect(listDeliveredOutcomesForRecord).not.toHaveBeenCalled();
    });

    it('still runs lost-deal handling even when the current record\'s own identity is unresolved, since retraction matches by orderId not current identity', async () => {
      const lostMapping = makeMapping({ crm_stage_id: 'closedlost', is_terminal_lost: true });
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig());
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([lostMapping]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'closedlost', properties: {} })]));

      await runSync('config-1');

      expect(deliverOutcome).not.toHaveBeenCalled(); // unresolved identity — §6.3 point 5
      expect(handleLostDeal).toHaveBeenCalledTimes(1);
    });
  });

  describe('DERIVED value mode (Sprint 7, §7.3)', () => {
    it('never queries derived-value snapshots in DECLARED mode', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ value_mode: 'DECLARED' }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

      await runSync('config-1');

      expect(getLatestDerivedValueSnapshots).not.toHaveBeenCalled();
    });

    it('fetches derived-value snapshots once per run (not per record) and resolves DERIVED when confidence is not withheld', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ value_mode: 'DERIVED' }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping({ declared_value: 50 })]);
      vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([{
        id: 's1', organization_id: 'org-1', config_id: 'config-1', crm_stage_id: 'appointmentscheduled',
        sample_size: 100, reached_won_count: 25, stage_to_won_rate: 0.25, avg_won_amount: 2000,
        currency: 'USD', derived_value: 500, confidence: 'high',
        window_start: '2026-03-01', window_end: '2026-08-28', computed_at: '2026-08-28T00:00:00Z',
      }]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord(), makeRecord({ id: 'deal-2' })]));

      await runSync('config-1');

      expect(getLatestDerivedValueSnapshots).toHaveBeenCalledTimes(1);
      const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
      expect(rows[0]).toMatchObject({ value_source: 'DERIVED', derived_confidence: 'high', conversion_value: 500, currency: 'USD' });
      expect(rows[1]).toMatchObject({ value_source: 'DERIVED', conversion_value: 500 });
    });

    it('degrades to DECLARED when the latest snapshot for the stage is withheld', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ value_mode: 'DERIVED' }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping({ declared_value: 75, currency: 'USD' })]);
      vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([{
        id: 's1', organization_id: 'org-1', config_id: 'config-1', crm_stage_id: 'appointmentscheduled',
        sample_size: 5, reached_won_count: 0, stage_to_won_rate: 0, avg_won_amount: 0,
        currency: 'USD', derived_value: 0, confidence: 'withheld',
        window_start: '2026-03-01', window_end: '2026-08-28', computed_at: '2026-08-28T00:00:00Z',
      }]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

      await runSync('config-1');

      const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
      expect(rows[0]).toMatchObject({ value_source: 'DECLARED', conversion_value: 75 });
    });

    it('falls back to DECLARED for a stage with no snapshot at all, without mixing up another stage\'s snapshot', async () => {
      const mqlMapping = makeMapping({ crm_stage_id: 'mql', atlas_event_name: 'crm_mql', declared_value: 10 });
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ value_mode: 'DERIVED' }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([mqlMapping]);
      vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([{
        id: 's1', organization_id: 'org-1', config_id: 'config-1', crm_stage_id: 'sql', // a DIFFERENT stage
        sample_size: 100, reached_won_count: 25, stage_to_won_rate: 0.25, avg_won_amount: 2000,
        currency: 'USD', derived_value: 500, confidence: 'high',
        window_start: '2026-03-01', window_end: '2026-08-28', computed_at: '2026-08-28T00:00:00Z',
      }]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'mql' })]));

      await runSync('config-1');

      const [, rows] = vi.mocked(upsertOutcomeEvents).mock.calls[0];
      expect(rows[0]).toMatchObject({ value_source: 'DECLARED', conversion_value: 10 });
    });
  });

  describe('attribution write-back (Sprint 9, D3, §6.4)', () => {
    it('calls writeBackAttribution when write_back_enabled is true and delivery succeeds', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ write_back_enabled: true }));
      const mapping = makeMapping({ google_conversion_action_id: 'AW-123/abc' });
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([mapping]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
      vi.mocked(deliverOutcome).mockResolvedValue({
        status: 'delivered',
        detail: { google: { status: 'delivered' } },
        delivered_at: '2026-01-02T00:00:00Z',
      });

      await runSync('config-1');

      expect(writeBackAttribution).toHaveBeenCalledTimes(1);
      const [providerArg, tokensArg, input] = vi.mocked(writeBackAttribution).mock.calls[0];
      expect(providerArg).toBeDefined();
      expect(tokensArg).toEqual({ access_token: 'tok', expires_at: 0, token_type: 'bearer' });
      expect(input).toMatchObject({
        config_id: 'config-1',
        source_record_id: 'deal-1',
        tracked_object: 'deal',
        atlas_event_name: mapping.atlas_event_name,
        delivered_at: '2026-01-02T00:00:00Z',
      });
    });

    it('calls writeBackAttribution on a partial delivery too', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ write_back_enabled: true }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
      vi.mocked(deliverOutcome).mockResolvedValue({
        status: 'partial',
        detail: { google: { status: 'delivered' }, meta: { status: 'failed' } },
        delivered_at: '2026-01-02T00:00:00Z',
      });

      await runSync('config-1');

      expect(writeBackAttribution).toHaveBeenCalledTimes(1);
    });

    it('never calls writeBackAttribution when write_back_enabled is false (the default)', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ write_back_enabled: false }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
      vi.mocked(deliverOutcome).mockResolvedValue({
        status: 'delivered',
        detail: { google: { status: 'delivered' } },
        delivered_at: '2026-01-02T00:00:00Z',
      });

      await runSync('config-1');

      expect(writeBackAttribution).not.toHaveBeenCalled();
    });

    it('never calls writeBackAttribution when enabled but the outcome only reached a non-delivered status', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ write_back_enabled: true }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
      vi.mocked(deliverOutcome).mockResolvedValue({ status: 'failed', detail: { google: { status: 'failed' } }, delivered_at: null });

      await runSync('config-1');

      expect(writeBackAttribution).not.toHaveBeenCalled();
    });

    it('never calls writeBackAttribution for an unresolved identity, since deliverOutcome itself is never called', async () => {
      vi.mocked(getOutcomeSourceConfigByIdInternal).mockResolvedValue(makeConfig({ write_back_enabled: true }));
      vi.mocked(listOutcomeStageMappings).mockResolvedValue([makeMapping()]);
      vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ properties: {} })]));

      await runSync('config-1');

      expect(deliverOutcome).not.toHaveBeenCalled();
      expect(writeBackAttribution).not.toHaveBeenCalled();
    });
  });
});
