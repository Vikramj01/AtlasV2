/**
 * derivedValueCalculator.ts unit tests — Sprint 7 exit criterion: "Derived
 * values compute and withhold correctly at each sample threshold."
 *
 * computeStageSnapshots() is pure (no I/O) and is exercised directly for
 * the sample-size gating, currency-exclusion, and cold-start rules;
 * computeDerivedValuesForConfig() is exercised with the DB layer mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/crmQueries', () => ({
  getCrmSyncConfigByIdInternal: vi.fn(),
  listCrmStageMappings: vi.fn(),
  listOutcomeEventsForDerivedCalc: vi.fn(),
  upsertDerivedValueSnapshots: vi.fn(),
}));

import {
  getCrmSyncConfigByIdInternal,
  listCrmStageMappings,
  listOutcomeEventsForDerivedCalc,
  upsertDerivedValueSnapshots,
} from '@/services/database/crmQueries';
import {
  computeStageSnapshots,
  computeDerivedValuesForConfig,
  HIGH_CONFIDENCE_MIN_SAMPLE,
  HIGH_CONFIDENCE_MIN_WON,
  LOW_CONFIDENCE_MIN_SAMPLE,
} from '../derivedValueCalculator';
import type { CrmStageMapping, CrmSyncConfig, OutcomeEventForDerivedCalc } from '@/types/crm';

const WINDOW_START = new Date('2026-03-01T00:00:00Z');
const WINDOW_END = new Date('2026-08-28T00:00:00Z');
const CONFIG_ID = 'config-1';

function makeMapping(overrides: Partial<Pick<CrmStageMapping, 'id' | 'crm_stage_id' | 'is_terminal_won'>> = {}) {
  return { id: 'm-mql', crm_stage_id: 'mql', is_terminal_won: false, ...overrides };
}

function makeWonMapping(overrides: Partial<Pick<CrmStageMapping, 'id' | 'crm_stage_id' | 'is_terminal_won'>> = {}) {
  return { id: 'm-won', crm_stage_id: 'closedwon', is_terminal_won: true, ...overrides };
}

// Builds N distinct records that reached `stage`, of which `wonCount` also
// reached the won mapping with `wonAmount` in `currency`.
function buildEvents(
  stageCrmStageId: string,
  sampleSize: number,
  wonCount: number,
  wonMappingId: string,
  wonAmount = 1000,
  currency = 'USD',
): OutcomeEventForDerivedCalc[] {
  const events: OutcomeEventForDerivedCalc[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const recordId = `rec-${i}`;
    events.push({
      crm_record_id: recordId,
      crm_stage_id: stageCrmStageId,
      mapping_id: 'm-mql',
      conversion_value: null,
      currency: null,
      stage_changed_at: '2026-06-01T00:00:00Z',
    });
    if (i < wonCount) {
      events.push({
        crm_record_id: recordId,
        crm_stage_id: 'closedwon',
        mapping_id: wonMappingId,
        conversion_value: wonAmount,
        currency,
        stage_changed_at: '2026-06-15T00:00:00Z',
      });
    }
  }
  return events;
}

describe('computeStageSnapshots — sample-size gating (§7.3)', () => {
  it(`marks high confidence at exactly the floor (sample=${HIGH_CONFIDENCE_MIN_SAMPLE}, won=${HIGH_CONFIDENCE_MIN_WON})`, () => {
    const events = buildEvents('mql', HIGH_CONFIDENCE_MIN_SAMPLE, HIGH_CONFIDENCE_MIN_WON, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.confidence).toBe('high');
  });

  it('drops to low confidence one below the high-confidence sample floor', () => {
    const events = buildEvents('mql', HIGH_CONFIDENCE_MIN_SAMPLE - 1, HIGH_CONFIDENCE_MIN_WON, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.confidence).toBe('low');
  });

  it('drops to low confidence one below the high-confidence won-count floor, even with a large sample', () => {
    const events = buildEvents('mql', HIGH_CONFIDENCE_MIN_SAMPLE + 10, HIGH_CONFIDENCE_MIN_WON - 1, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.confidence).toBe('low');
  });

  it(`marks low confidence at exactly the floor (sample=${LOW_CONFIDENCE_MIN_SAMPLE})`, () => {
    const events = buildEvents('mql', LOW_CONFIDENCE_MIN_SAMPLE, 2, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.confidence).toBe('low');
  });

  it('withholds one below the low-confidence sample floor', () => {
    const events = buildEvents('mql', LOW_CONFIDENCE_MIN_SAMPLE - 1, 2, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.confidence).toBe('withheld');
  });

  it('computes stage_to_won_rate and avg_won_amount correctly at the high-confidence floor', () => {
    const events = buildEvents('mql', 100, 25, 'm-won', 2000);
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.sample_size).toBe(100);
    expect(snapshot.reached_won_count).toBe(25);
    expect(snapshot.stage_to_won_rate).toBeCloseTo(0.25, 5);
    expect(snapshot.avg_won_amount).toBeCloseTo(2000, 2);
    expect(snapshot.derived_value).toBeCloseTo(500, 2);
    expect(snapshot.confidence).toBe('high');
  });
});

describe('computeStageSnapshots — cold start & currency exclusion', () => {
  it('withholds every stage when there is no won amount to average, even with a huge sample', () => {
    // 200 records reached the stage, none has ever won.
    const events = buildEvents('mql', 200, 0, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.sample_size).toBe(200);
    expect(snapshot.confidence).toBe('withheld');
    expect(snapshot.derived_value).toBe(0);
  });

  it('excludes a won amount recorded in a different currency from the average, never converting it', () => {
    // 60 records reach the stage; 15 "win" but their amount is in GBP, not
    // the config's USD default — §7.2 forbids conversion, so these are
    // excluded from avg_won_amount, and since that leaves zero USD-matched
    // won amounts, every stage withholds (cold-start rule).
    const events = buildEvents('mql', 60, 15, 'm-won', 500, 'GBP');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.avg_won_amount).toBe(0);
    expect(snapshot.confidence).toBe('withheld');
    // reached_won_count still counts the record as having won — currency
    // only gates the AMOUNT average, not whether the record counts as won.
    expect(snapshot.reached_won_count).toBe(15);
  });

  it('mixes matched and mismatched currency won amounts, averaging only the matched ones', () => {
    const usdEvents = buildEvents('mql', 60, 40, 'm-won', 1000, 'USD');
    const gbpEvents = buildEvents('mql', 0, 20, 'm-won', 500, 'GBP').map((e, i) => ({
      ...e,
      crm_record_id: `gbp-rec-${i}`,
    }));
    const [snapshot] = computeStageSnapshots(
      CONFIG_ID,
      [...usdEvents, ...gbpEvents],
      [makeMapping(), makeWonMapping()],
      'USD',
      WINDOW_START,
      WINDOW_END,
    );
    expect(snapshot.avg_won_amount).toBeCloseTo(1000, 2); // only the USD ones
  });
});

describe('computeStageSnapshots — structural correctness', () => {
  it('never emits a snapshot for a terminal-won stage — CRM_AMOUNT already wins there', () => {
    const events = buildEvents('mql', 100, 30, 'm-won');
    const snapshots = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshots.map((s) => s.crm_stage_id)).toEqual(['mql']);
  });

  it('counts a record once per stage even if multiple events reference the same (record, stage) pair', () => {
    const events: OutcomeEventForDerivedCalc[] = [
      { crm_record_id: 'rec-1', crm_stage_id: 'mql', mapping_id: 'm-mql', conversion_value: null, currency: null, stage_changed_at: '2026-06-01T00:00:00Z' },
      { crm_record_id: 'rec-1', crm_stage_id: 'mql', mapping_id: 'm-mql', conversion_value: null, currency: null, stage_changed_at: '2026-06-01T00:00:01Z' },
    ];
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.sample_size).toBe(1);
  });

  it('stamps the snapshot with the given config_id and window bounds as plain dates', () => {
    const events = buildEvents('mql', 60, 15, 'm-won');
    const [snapshot] = computeStageSnapshots(CONFIG_ID, events, [makeMapping(), makeWonMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.config_id).toBe(CONFIG_ID);
    expect(snapshot.window_start).toBe('2026-03-01');
    expect(snapshot.window_end).toBe('2026-08-28');
    expect(snapshot.currency).toBe('USD');
  });

  it('returns rate 0 (not NaN) for a stage with zero sample_size', () => {
    const [snapshot] = computeStageSnapshots(CONFIG_ID, [], [makeMapping()], 'USD', WINDOW_START, WINDOW_END);
    expect(snapshot.sample_size).toBe(0);
    expect(snapshot.stage_to_won_rate).toBe(0);
    expect(snapshot.confidence).toBe('withheld');
  });
});

describe('computeDerivedValuesForConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function makeConfig(overrides: Partial<CrmSyncConfig> = {}): CrmSyncConfig {
    return {
      id: CONFIG_ID,
      organization_id: 'org-1',
      client_id: 'client-1',
      connection_id: 'conn-1',
      provider: 'hubspot',
      pipeline_id: 'default',
      tracked_object: 'deal',
      identity_property_map: {},
      value_mode: 'DERIVED',
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

  it('returns [] and writes nothing when the config does not exist', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(null);
    const result = await computeDerivedValuesForConfig('missing');
    expect(result).toEqual([]);
    expect(upsertDerivedValueSnapshots).not.toHaveBeenCalled();
  });

  it('returns [] and writes nothing when the ladder has no stage mappings', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([]);
    const result = await computeDerivedValuesForConfig(CONFIG_ID);
    expect(result).toEqual([]);
    expect(listOutcomeEventsForDerivedCalc).not.toHaveBeenCalled();
  });

  it('computes and persists a snapshot per non-terminal-won stage', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping() as CrmStageMapping, makeWonMapping() as CrmStageMapping]);
    vi.mocked(listOutcomeEventsForDerivedCalc).mockResolvedValue(buildEvents('mql', 60, 20, 'm-won'));

    const result = await computeDerivedValuesForConfig(CONFIG_ID);

    expect(result).toHaveLength(1);
    expect(result[0].crm_stage_id).toBe('mql');
    expect(upsertDerivedValueSnapshots).toHaveBeenCalledWith('org-1', result);
  });

  it('passes the default 180-day window to the events query when no override is given', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping() as CrmStageMapping]);
    vi.mocked(listOutcomeEventsForDerivedCalc).mockResolvedValue([]);

    const before = Date.now();
    await computeDerivedValuesForConfig(CONFIG_ID);
    const after = Date.now();

    const [, sinceISO] = vi.mocked(listOutcomeEventsForDerivedCalc).mock.calls[0];
    const sinceMs = new Date(sinceISO).getTime();
    const expectedMs = before - 180 * 24 * 60 * 60 * 1000;
    expect(sinceMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(sinceMs).toBeLessThanOrEqual(after - 180 * 24 * 60 * 60 * 1000 + 1000);
  });

  it('honors a custom windowDays override', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping() as CrmStageMapping]);
    vi.mocked(listOutcomeEventsForDerivedCalc).mockResolvedValue([]);

    await computeDerivedValuesForConfig(CONFIG_ID, { windowDays: 30 });

    const [, sinceISO] = vi.mocked(listOutcomeEventsForDerivedCalc).mock.calls[0];
    const ageDays = (Date.now() - new Date(sinceISO).getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeCloseTo(30, 0);
  });

  it('does not call upsert when there is nothing to compute (empty event set still produces withheld rows to persist)', async () => {
    vi.mocked(getCrmSyncConfigByIdInternal).mockResolvedValue(makeConfig());
    vi.mocked(listCrmStageMappings).mockResolvedValue([makeMapping() as CrmStageMapping]);
    vi.mocked(listOutcomeEventsForDerivedCalc).mockResolvedValue([]);

    const result = await computeDerivedValuesForConfig(CONFIG_ID);

    // A stage still produces a (withheld, zero-sample) row — this is real
    // disclosure data ("nothing has reached this stage yet"), not nothing.
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe('withheld');
    expect(upsertDerivedValueSnapshots).toHaveBeenCalledTimes(1);
  });
});
