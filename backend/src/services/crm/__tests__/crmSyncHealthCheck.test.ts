/**
 * crmSyncHealthCheck.ts unit tests — Sprint 8 exit criterion: "Alerts fire
 * and resolve; CRM health reaches the org Dashboard."
 *
 * Covers computeCrmSyncHealthSignals()'s data-gathering: scoping to
 * sync_enabled configs only, the max-across-configs consecutive-failure
 * signal, token-expiry detection, the 7-day identity/window rate math
 * (including the null-when-no-data cases), and the bidding-primary
 * withheld-stage detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/crmQueries', () => ({
  listCrmSyncConfigsForOrg: vi.fn(),
  listCrmStageMappings: vi.fn(),
  getLatestDerivedValueSnapshots: vi.fn(),
}));

function makeSupabaseChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const fromMock = vi.fn();
vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

import {
  listCrmSyncConfigsForOrg,
  listCrmStageMappings,
  getLatestDerivedValueSnapshots,
} from '@/services/database/crmQueries';
import { computeCrmSyncHealthSignals } from '../crmSyncHealthCheck';
import type { CrmSyncConfig, CrmStageMapping, CrmDerivedValueSnapshot } from '@/types/crm';

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
    last_sync_status: 'ok',
    last_sync_error: null,
    consecutive_failures: 0,
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
    crm_stage_id: 'mql',
    crm_stage_label: 'MQL',
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

function makeSnapshot(overrides: Partial<CrmDerivedValueSnapshot> = {}): CrmDerivedValueSnapshot {
  return {
    id: 's1',
    organization_id: 'org-1',
    config_id: 'config-1',
    crm_stage_id: 'mql',
    sample_size: 10,
    reached_won_count: 1,
    stage_to_won_rate: 0.1,
    avg_won_amount: 100,
    currency: 'USD',
    derived_value: 10,
    confidence: 'withheld',
    window_start: '2026-03-01',
    window_end: '2026-08-28',
    computed_at: '2026-08-28T00:00:00Z',
    ...overrides,
  };
}

// Two-call sequence per run: platform_connections (token check), then
// crm_outcome_events (rate counts). Both go through the same chain mock.
function mockDbCalls(connectionRows: unknown[], eventRows: unknown[]) {
  fromMock
    .mockReturnValueOnce(makeSupabaseChain({ data: connectionRows, error: null }))
    .mockReturnValueOnce(makeSupabaseChain({ data: eventRows, error: null }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCrmStageMappings).mockResolvedValue([]);
  vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([]);
});

describe('computeCrmSyncHealthSignals', () => {
  it('returns null when the org has no enabled CRM sync config', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ sync_enabled: false })]);
    const result = await computeCrmSyncHealthSignals('org-1', false);
    expect(result).toBeNull();
  });

  it('scopes entirely to sync_enabled configs — a disabled config never contributes its failures', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([
      makeConfig({ id: 'c1', sync_enabled: true, consecutive_failures: 0 }),
      makeConfig({ id: 'c2', sync_enabled: false, consecutive_failures: 9 }),
    ]);
    mockDbCalls([], []);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.consecutiveFailures).toBe(0);
  });

  it('reports the MAX consecutive_failures across enabled configs', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([
      makeConfig({ id: 'c1', consecutive_failures: 1 }),
      makeConfig({ id: 'c2', consecutive_failures: 3 }),
    ]);
    mockDbCalls([], []);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.consecutiveFailures).toBe(3);
  });

  it('reports tokenExpired true when the connection status is expired or revoked', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ connection_id: 'conn-1' })]);
    mockDbCalls([{ id: 'conn-1' }], []);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.tokenExpired).toBe(true);
  });

  it('reports tokenExpired false when no connection is expired/revoked', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ connection_id: 'conn-1' })]);
    mockDbCalls([], []);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.tokenExpired).toBe(false);
  });

  it('computes unresolvedIdentityRate7d and skippedWindowRate7d from recent outcome events', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig()]);
    // 10 events: 3 unresolved, 7 attempted (identity resolved); of those 7, 2 skipped_window.
    const events = [
      ...Array(3).fill({ identity_method: 'unresolved', delivery_status: 'skipped_unresolved' }),
      ...Array(2).fill({ identity_method: 'hashed_email', delivery_status: 'skipped_window' }),
      ...Array(5).fill({ identity_method: 'hashed_email', delivery_status: 'delivered' }),
    ];
    mockDbCalls([], events);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.unresolvedIdentityRate7d).toBeCloseTo(30, 5); // 3/10
    expect(result?.skippedWindowRate7d).toBeCloseTo((2 / 7) * 100, 5); // 2 of 7 ATTEMPTED
  });

  it('reports null rates when there are no recent outcome events at all', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig()]);
    mockDbCalls([], []);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.unresolvedIdentityRate7d).toBeNull();
    expect(result?.skippedWindowRate7d).toBeNull();
  });

  it('reports a null skippedWindowRate7d when every record was unresolved (nothing was ever attempted)', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig()]);
    const events = Array(5).fill({ identity_method: 'unresolved', delivery_status: 'skipped_unresolved' });
    mockDbCalls([], events);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.unresolvedIdentityRate7d).toBe(100);
    expect(result?.skippedWindowRate7d).toBeNull();
  });

  it('detects a withheld bidding-primary stage in a DERIVED-mode config', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ value_mode: 'DERIVED' })]);
    mockDbCalls([], []);
    vi.mocked(listCrmStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'mql', google_conversion_action_id: 'AW-1/mql', enabled: true }),
    ]);
    vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([makeSnapshot({ crm_stage_id: 'mql', confidence: 'withheld' })]);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.derivedWithheldForBiddingPrimaryStage).toBe(true);
  });

  it('does not flag a withheld stage with no platform destination configured', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ value_mode: 'DERIVED' })]);
    mockDbCalls([], []);
    vi.mocked(listCrmStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'mql', google_conversion_action_id: null, meta_event_name: null, linkedin_conversion_id: null }),
    ]);
    vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([makeSnapshot({ crm_stage_id: 'mql', confidence: 'withheld' })]);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.derivedWithheldForBiddingPrimaryStage).toBe(false);
  });

  it('does not flag a withheld terminal-won stage — CRM_AMOUNT always wins there regardless', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ value_mode: 'DERIVED' })]);
    mockDbCalls([], []);
    vi.mocked(listCrmStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'closedwon', is_terminal_won: true, google_conversion_action_id: 'AW-1/won' }),
    ]);
    vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([makeSnapshot({ crm_stage_id: 'closedwon', confidence: 'withheld' })]);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.derivedWithheldForBiddingPrimaryStage).toBe(false);
  });

  it('does not flag a bidding-primary stage whose snapshot confidence is not withheld', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ value_mode: 'DERIVED' })]);
    mockDbCalls([], []);
    vi.mocked(listCrmStageMappings).mockResolvedValue([
      makeMapping({ crm_stage_id: 'mql', google_conversion_action_id: 'AW-1/mql' }),
    ]);
    vi.mocked(getLatestDerivedValueSnapshots).mockResolvedValue([makeSnapshot({ crm_stage_id: 'mql', confidence: 'high' })]);

    const result = await computeCrmSyncHealthSignals('org-1', false);

    expect(result?.derivedWithheldForBiddingPrimaryStage).toBe(false);
  });

  it('never checks derived stages at all for a DECLARED-mode config', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig({ value_mode: 'DECLARED' })]);
    mockDbCalls([], []);

    await computeCrmSyncHealthSignals('org-1', false);

    expect(listCrmStageMappings).not.toHaveBeenCalled();
    expect(getLatestDerivedValueSnapshots).not.toHaveBeenCalled();
  });

  it('passes existingAlertActive straight through', async () => {
    vi.mocked(listCrmSyncConfigsForOrg).mockResolvedValue([makeConfig()]);
    mockDbCalls([], []);

    const result = await computeCrmSyncHealthSignals('org-1', true);

    expect(result?.existingAlertActive).toBe(true);
  });
});
