import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/air/ingestion/ingestionOrchestrator', () => ({
  getAirEligibleOrgIds: vi.fn(),
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { getAirEligibleOrgIds } from '@/services/air/ingestion/ingestionOrchestrator';
import {
  addDays,
  buildWindowDates,
  computeProximityDays,
  computeConfidence,
  fetchCorrelationFactors,
  runCorrelationForOrg,
  runCorrelationForAllActiveOrgs,
} from '../correlationEngine';

// ── chain builder ──────────────────────────────────────────────────────────────

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'lt', 'delete', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

// ── addDays ───────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-07-10', 3)).toBe('2026-07-13');
  });

  it('handles month boundary', () => {
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('adding zero returns same date', () => {
    expect(addDays('2026-07-10', 0)).toBe('2026-07-10');
  });
});

// ── buildWindowDates ──────────────────────────────────────────────────────────

describe('buildWindowDates', () => {
  it('returns ±3-day window around the detected date', () => {
    const { windowStart, windowEnd } = buildWindowDates('2026-07-10');
    expect(windowStart).toBe('2026-07-07');
    expect(windowEnd).toBe('2026-07-13');
  });
});

// ── computeProximityDays ──────────────────────────────────────────────────────

describe('computeProximityDays', () => {
  it('returns 0 when dates are identical', () => {
    expect(computeProximityDays('2026-07-10', '2026-07-10')).toBe(0);
  });

  it('returns absolute distance (factor before detected)', () => {
    expect(computeProximityDays('2026-07-10', '2026-07-08')).toBe(2);
  });

  it('returns absolute distance (factor after detected)', () => {
    expect(computeProximityDays('2026-07-10', '2026-07-12')).toBe(2);
  });
});

// ── computeConfidence ─────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  it('returns 1.0 at day 0', () => expect(computeConfidence(0)).toBe(1.0));
  it('returns 0.75 at day 1', () => expect(computeConfidence(1)).toBe(0.75));
  it('returns 0.50 at day 2', () => expect(computeConfidence(2)).toBe(0.5));
  it('returns 0.25 at day 3', () => expect(computeConfidence(3)).toBe(0.25));
  it('clamps to 0.25 beyond day 3', () => expect(computeConfidence(5)).toBe(0.25));
});

// ── fetchCorrelationFactors ───────────────────────────────────────────────────

describe('fetchCorrelationFactors', () => {
  const orgId = 'org-1';
  const date  = '2026-07-10';

  beforeEach(() => vi.resetAllMocks());

  function setupEmptyFactors() {
    // 5 calls in order: dqm_gtg_checks, crawl_runs, profiles, health_snapshots, enricher_runs
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null))   // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))   // crawl_runs
      .mockReturnValueOnce(makeChain([], null))   // profiles
      .mockReturnValueOnce(makeChain([], null))   // enricher_runs
      ;
  }

  it('returns empty array when no factors found', async () => {
    setupEmptyFactors();
    const factors = await fetchCorrelationFactors(orgId, date);
    expect(factors).toHaveLength(0);
  });

  it('queries the correct ±3-day window for dqm_gtg_checks', async () => {
    setupEmptyFactors();
    await fetchCorrelationFactors(orgId, date);
    const chain = vi.mocked(supabaseAdmin.from).mock.results[0].value;
    expect(chain.gte).toHaveBeenCalledWith('checked_at', '2026-07-07');
    expect(chain.lte).toHaveBeenCalledWith('checked_at', '2026-07-13T23:59:59Z');
  });

  it('returns a dqm_alert factor with correct proximity and confidence', async () => {
    const dqmData = [{ id: 'dqm-1', checked_at: '2026-07-08T10:00:00Z' }]; // 2 days before
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(dqmData, null)) // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))      // crawl_runs
      .mockReturnValueOnce(makeChain([], null))      // profiles
      .mockReturnValueOnce(makeChain([], null));     // enricher_runs

    const factors = await fetchCorrelationFactors(orgId, date);
    expect(factors).toHaveLength(1);
    expect(factors[0]).toMatchObject({
      factor_type: 'dqm_alert',
      factor_ref_id: 'dqm-1',
      factor_date: '2026-07-08',
      proximity_days: 2,
      confidence_score: 0.5,
    });
  });

  it('returns a cse_signal_change factor from a completed crawl run', async () => {
    const crawlData = [{ id: 'crawl-1', created_at: '2026-07-10T06:00:00Z' }]; // same day
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null))        // dqm_gtg_checks
      .mockReturnValueOnce(makeChain(crawlData, null)) // crawl_runs
      .mockReturnValueOnce(makeChain([], null))        // profiles
      .mockReturnValueOnce(makeChain([], null));       // enricher_runs

    const factors = await fetchCorrelationFactors(orgId, date);
    expect(factors).toHaveLength(1);
    expect(factors[0]).toMatchObject({
      factor_type: 'cse_signal_change',
      factor_ref_id: 'crawl-1',
      factor_date: '2026-07-10',
      proximity_days: 0,
      confidence_score: 1.0,
    });
  });

  it('returns an andromeda_score_drop factor when health snapshot below threshold', async () => {
    const profileData = [{ id: 'user-1' }];
    const snapData    = [{ id: 'snap-1', snapshot_at: '2026-07-11T00:00:00Z' }]; // 1 day after
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null))          // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))          // crawl_runs
      .mockReturnValueOnce(makeChain(profileData, null)) // profiles
      .mockReturnValueOnce(makeChain(snapData, null))    // health_snapshots
      .mockReturnValueOnce(makeChain([], null));         // enricher_runs

    const factors = await fetchCorrelationFactors(orgId, date);
    expect(factors).toHaveLength(1);
    expect(factors[0]).toMatchObject({
      factor_type: 'andromeda_score_drop',
      factor_ref_id: 'snap-1',
      factor_date: '2026-07-11',
      proximity_days: 1,
      confidence_score: 0.75,
    });
  });

  it('skips health_snapshots query when no profiles found for org', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null))  // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))  // crawl_runs
      .mockReturnValueOnce(makeChain([], null))  // profiles (empty)
      .mockReturnValueOnce(makeChain([], null)); // enricher_runs

    await fetchCorrelationFactors(orgId, date);
    // Only 4 calls: profiles resolved to empty so health_snapshots was skipped
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(4);
  });

  it('returns a bse_delivery_failure factor from a failed enricher run', async () => {
    const enricherData = [{ id: 'enr-1', created_at: '2026-07-12T18:00:00Z' }]; // 2 days after
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([], null))           // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))           // crawl_runs
      .mockReturnValueOnce(makeChain([], null))           // profiles
      .mockReturnValueOnce(makeChain(enricherData, null)); // enricher_runs

    const factors = await fetchCorrelationFactors(orgId, date);
    expect(factors).toHaveLength(1);
    expect(factors[0]).toMatchObject({
      factor_type: 'bse_delivery_failure',
      factor_ref_id: 'enr-1',
      factor_date: '2026-07-12',
      proximity_days: 2,
      confidence_score: 0.5,
    });
  });

  it('returns factors from multiple sources in the same call', async () => {
    const profileData  = [{ id: 'user-1' }];
    const dqmData      = [{ id: 'dqm-1', checked_at: '2026-07-10T08:00:00Z' }];
    const enricherData = [{ id: 'enr-1', created_at: '2026-07-09T12:00:00Z' }];
    const snapData     = [{ id: 'snap-1', snapshot_at: '2026-07-10T01:00:00Z' }];

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(dqmData, null))      // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))            // crawl_runs
      .mockReturnValueOnce(makeChain(profileData, null))   // profiles
      .mockReturnValueOnce(makeChain(snapData, null))      // health_snapshots
      .mockReturnValueOnce(makeChain(enricherData, null)); // enricher_runs

    const factors = await fetchCorrelationFactors(orgId, date);
    expect(factors).toHaveLength(3);
    const types = factors.map((f) => f.factor_type).sort();
    expect(types).toEqual(['andromeda_score_drop', 'bse_delivery_failure', 'dqm_alert']);
  });
});

// ── runCorrelationForOrg ──────────────────────────────────────────────────────

describe('runCorrelationForOrg', () => {
  const orgId = 'org-1';
  const date  = '2026-07-10';

  beforeEach(() => vi.resetAllMocks());

  it('skips when no anomalies found for the date', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain([], null));
    await expect(runCorrelationForOrg(orgId, date)).resolves.toBeUndefined();
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(1);
  });

  it('throws when anomaly fetch returns an error', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(null, { message: 'DB down' }));
    await expect(runCorrelationForOrg(orgId, date)).rejects.toThrow('DB down');
  });

  it('deletes stale correlations even when no new factors are found', async () => {
    const anomalies = [{ id: 'anom-1' }];
    const deleteChain = makeChain(null, null);

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null)) // air_anomalies fetch
      .mockReturnValueOnce(makeChain([], null))        // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))        // crawl_runs
      .mockReturnValueOnce(makeChain([], null))        // profiles
      .mockReturnValueOnce(makeChain([], null))        // enricher_runs
      .mockReturnValueOnce(deleteChain);               // air_insight_correlations delete

    await runCorrelationForOrg(orgId, date);
    expect(deleteChain.delete).toHaveBeenCalledOnce();
    expect(deleteChain.in).toHaveBeenCalledWith('anomaly_id', ['anom-1']);
  });

  it('inserts correlation rows when factors are found', async () => {
    const anomalies   = [{ id: 'anom-1' }, { id: 'anom-2' }];
    const dqmData     = [{ id: 'dqm-1', checked_at: '2026-07-10T08:00:00Z' }];
    const deleteChain = makeChain(null, null);
    const insertChain = makeChain(null, null);

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null)) // air_anomalies
      .mockReturnValueOnce(makeChain(dqmData, null))  // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))        // crawl_runs
      .mockReturnValueOnce(makeChain([], null))        // profiles
      .mockReturnValueOnce(makeChain([], null))        // enricher_runs
      .mockReturnValueOnce(deleteChain)                // delete
      .mockReturnValueOnce(insertChain);               // insert

    await runCorrelationForOrg(orgId, date);

    expect(insertChain.insert).toHaveBeenCalledOnce();
    const [rows] = insertChain.insert.mock.calls[0] as [{ anomaly_id: string; factor_type: string }[]];
    // 2 anomalies × 1 factor = 2 rows
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.anomaly_id).sort()).toEqual(['anom-1', 'anom-2']);
    expect(rows.every((r) => r.factor_type === 'dqm_alert')).toBe(true);
  });

  it('throws when insert returns an error', async () => {
    const anomalies = [{ id: 'anom-1' }];
    const dqmData   = [{ id: 'dqm-1', checked_at: '2026-07-10T00:00:00Z' }];

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(anomalies, null))      // air_anomalies
      .mockReturnValueOnce(makeChain(dqmData, null))        // dqm_gtg_checks
      .mockReturnValueOnce(makeChain([], null))             // crawl_runs
      .mockReturnValueOnce(makeChain([], null))             // profiles
      .mockReturnValueOnce(makeChain([], null))             // enricher_runs
      .mockReturnValueOnce(makeChain(null, null))           // delete (ok)
      .mockReturnValueOnce(makeChain(null, { message: 'insert exploded' })); // insert

    await expect(runCorrelationForOrg(orgId, date)).rejects.toThrow('insert exploded');
  });
});

// ── runCorrelationForAllActiveOrgs ────────────────────────────────────────────

describe('runCorrelationForAllActiveOrgs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('runs correlation for each eligible org', async () => {
    vi.mocked(getAirEligibleOrgIds).mockResolvedValue(['org-a', 'org-b']);
    // Each org call: anomalies fetch returns empty → 1 from() call each
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));

    await runCorrelationForAllActiveOrgs('2026-07-10');
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2);
  });

  it('continues to next org when one fails', async () => {
    vi.mocked(getAirEligibleOrgIds).mockResolvedValue(['org-bad', 'org-ok']);
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { message: 'exploded' })) // org-bad anomalies
      .mockReturnValueOnce(makeChain([], null));                      // org-ok anomalies

    await expect(
      runCorrelationForAllActiveOrgs('2026-07-10'),
    ).resolves.toBeUndefined();
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2);
  });
});
