/**
 * crmSyncOrchestrator.ts unit tests — Sprint 4 exit criterion: "A scheduled
 * sync reads changed records and writes crm_outcome_events idempotently."
 *
 * identityResolver.ts / objectMapper.ts / valueLadder.ts are exercised for
 * real (already unit-tested elsewhere) — only the DB layer and the
 * provider are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/crmQueries', () => ({
  getCrmSyncConfigByIdInternal: vi.fn(),
  listCrmStageMappings: vi.fn(),
  upsertCrmOutcomeEvents: vi.fn(),
  updateCrmSyncState: vi.fn(),
}));

vi.mock('@/services/crm/providerRegistry', () => ({
  getProvider: vi.fn(),
}));

vi.mock('@/services/connections/tokenManager', () => ({
  resolveTokens: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getCrmSyncConfigByIdInternal,
  listCrmStageMappings,
  upsertCrmOutcomeEvents,
  updateCrmSyncState,
} from '@/services/database/crmQueries';
import { getProvider } from '@/services/crm/providerRegistry';
import { resolveTokens } from '@/services/connections/tokenManager';
import { runSync } from '../crmSyncOrchestrator';
import type { CrmSyncConfig, CrmStageMapping } from '@/types/crm';
import type { CrmRecord, CrmProvider } from '../providers/types';

function makeConfig(overrides: Partial<CrmSyncConfig> = {}): CrmSyncConfig {
  return {
    id: 'config-1',
    organization_id: 'org-1',
    client_id: 'client-1',
    connection_id: 'conn-1',
    provider: 'hubspot',
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

function makeMapping(overrides: Partial<CrmStageMapping> = {}): CrmStageMapping {
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

function makeProvider(records: CrmRecord[]): CrmProvider {
  return {
    name: 'hubspot',
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
  vi.mocked(upsertCrmOutcomeEvents).mockImplementation(async (_orgId, rows) => rows.length);
});

describe('runSync', () => {
  it('returns not_found when the config does not exist', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(null);
    const result = await runSync('missing');
    expect(result.status).toBe('not_found');
    expect(upsertCrmOutcomeEvents).not.toHaveBeenCalled();
  });

  it('returns disabled and writes nothing when sync_enabled is false', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig({ sync_enabled: false }));
    const result = await runSync('config-1');
    expect(result.status).toBe('disabled');
    expect(upsertCrmOutcomeEvents).not.toHaveBeenCalled();
  });

  it('writes a pending outcome for a mapped stage with a resolvable identity', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

    const result = await runSync('config-1');

    expect(result.status).toBe('ok');
    expect(result.records_processed).toBe(1);
    expect(result.outcomes_written).toBe(1);
    expect(upsertCrmOutcomeEvents).toHaveBeenCalledTimes(1);
    const [, rows] = vi.mocked(upsertCrmOutcomeEvents).mock.calls[0];
    expect(rows[0]).toMatchObject({
      crm_record_id: 'deal-1',
      crm_stage_id: 'appointmentscheduled',
      atlas_event_name: 'crm_mql',
      identity_method: 'hashed_email',
      delivery_status: 'pending',
      value_source: 'DECLARED',
      conversion_value: 50,
    });
  });

  it('skips (and counts) a record whose current stage has no mapping', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'unmapped_stage' })]));

    const result = await runSync('config-1');

    expect(result.outcomes_skipped_unmapped).toBe(1);
    expect(upsertCrmOutcomeEvents).not.toHaveBeenCalled();
  });

  it('marks an unresolvable identity as skipped_unresolved, never fabricating an identifier', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ properties: {} })]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertCrmOutcomeEvents).mock.calls[0];
    expect(rows[0].identity_method).toBe('unresolved');
    expect(rows[0].delivery_status).toBe('skipped_unresolved');
  });

  it('resolves CRM_AMOUNT on a terminal-won stage with a real observed amount, overriding DECLARED', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'closedwon', is_terminal_won: true, declared_value: 100 }),
    ]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([
      makeRecord({ stage_id: 'closedwon', properties: { email: 'lead@example.com', amount: '4200' } }),
    ]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertCrmOutcomeEvents).mock.calls[0];
    expect(rows[0].value_source).toBe('CRM_AMOUNT');
    expect(rows[0].conversion_value).toBe(4200);
  });

  it('produces the same deterministic event_id for the same (config, record, stage) across two runs', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

    await runSync('config-1');
    const firstEventId = vi.mocked(upsertCrmOutcomeEvents).mock.calls[0][1][0].event_id;

    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));
    await runSync('config-1');
    const secondEventId = vi.mocked(upsertCrmOutcomeEvents).mock.calls[1][1][0].event_id;

    expect(firstEventId).toBe(secondEventId);
  });

  it('a record moving backwards to an earlier stage does not re-fire — only its current stage is ever written', async () => {
    // The orchestrator only ever sees a record's CURRENT stage per fetch,
    // so "moving backwards" naturally produces one row for whatever stage
    // it is currently in; the DB's UNIQUE(config_id, crm_record_id,
    // crm_stage_id) constraint (exercised via upsertCrmOutcomeEvents'
    // ignoreDuplicates upsert, mocked here) is what makes re-observing an
    // already-written stage a no-op across separate runs.
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'sql', atlas_event_name: 'crm_sql' }),
      makeMapping({ crm_stage_id: 'mql', atlas_event_name: 'crm_mql' }),
    ]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: 'mql' })]));

    await runSync('config-1');

    const [, rows] = vi.mocked(upsertCrmOutcomeEvents).mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].crm_stage_id).toBe('mql');
  });

  it('stops at the record cap, marks the run partial, and resumes from the last processed record next time', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
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

    const stateUpdate = vi.mocked(updateCrmSyncState).mock.calls.at(-1)![1];
    expect(stateUpdate.last_sync_status).toBe('partial');
    expect(stateUpdate.last_synced_at).toBe('2026-01-02T00:00:00Z'); // the 2nd (last processed) record's timestamp, not "now"
  });

  it('advances last_synced_at to the run boundary (not a record timestamp) when the cap is not hit', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord()]));

    const before = Date.now();
    await runSync('config-1');
    const after = Date.now();

    const stateUpdate = vi.mocked(updateCrmSyncState).mock.calls.at(-1)![1];
    expect(stateUpdate.last_sync_status).toBe('ok');
    const advancedTo = new Date(stateUpdate.last_synced_at!).getTime();
    expect(advancedTo).toBeGreaterThanOrEqual(before);
    expect(advancedTo).toBeLessThanOrEqual(after);
  });

  it('marks the run failed and records the error when token resolution fails, without throwing', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([]));
    vi.mocked(resolveTokens).mockRejectedValue(new Error('connection revoked'));

    const result = await runSync('config-1');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('connection revoked');
    const stateUpdate = vi.mocked(updateCrmSyncState).mock.calls.at(-1)![1];
    expect(stateUpdate.last_sync_status).toBe('failed');
    expect(stateUpdate.last_sync_error).toContain('connection revoked');
  });

  it('marks the run failed when the provider throws mid-fetch, preserving partial progress counts', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
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
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping()]);
    vi.mocked(getProvider).mockReturnValue(makeProvider([makeRecord({ stage_id: null })]));

    const result = await runSync('config-1');

    expect(result.status).toBe('ok');
    expect(result.records_processed).toBe(1);
    expect(upsertCrmOutcomeEvents).not.toHaveBeenCalled();
  });
});
