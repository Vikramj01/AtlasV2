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
  classifySeverity,
  subtractDays,
  groupIntoSeries,
  detectAnomalies,
  runAnomalyDetectionForOrg,
  runAnomalyDetectionForAllActiveOrgs,
} from '../anomalyDetector';

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'gte', 'lte', 'upsert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

// Builds a synthetic snapshot set: 14 baseline days + 1 observed day.
function makeSnapshots(
  baselineValue: number,
  observedValue: number,
  opts: { source?: string; metricName?: string; dimension?: string | null; date?: string } = {},
) {
  const date = opts.date ?? '2026-07-10';
  const source = opts.source ?? 'google_ads';
  const metric = opts.metricName ?? 'spend';
  const dim = opts.dimension ?? null;
  const rows = [];

  for (let i = 14; i >= 1; i--) {
    rows.push({ source, metric_name: metric, dimension: dim, value: baselineValue, snapshot_date: subtractDays(date, i) });
  }
  rows.push({ source, metric_name: metric, dimension: dim, value: observedValue, snapshot_date: date });
  return rows;
}

// ── classifySeverity ──────────────────────────────────────────────────────────

describe('classifySeverity', () => {
  it('returns null below 15%', () => expect(classifySeverity(14.9)).toBeNull());
  it('returns low at 15%',     () => expect(classifySeverity(15)).toBe('low'));
  it('returns low at 29%',     () => expect(classifySeverity(29)).toBe('low'));
  it('returns medium at 30%',  () => expect(classifySeverity(30)).toBe('medium'));
  it('returns medium at 49%',  () => expect(classifySeverity(49)).toBe('medium'));
  it('returns high at 50%',    () => expect(classifySeverity(50)).toBe('high'));
  it('returns high above 50%', () => expect(classifySeverity(200)).toBe('high'));
});

// ── subtractDays ─────────────────────────────────────────────────────────────

describe('subtractDays', () => {
  it('subtracts days correctly', () => {
    expect(subtractDays('2026-07-10', 14)).toBe('2026-06-26');
  });

  it('handles month boundaries', () => {
    expect(subtractDays('2026-03-01', 1)).toBe('2026-02-28');
  });
});

// ── groupIntoSeries ───────────────────────────────────────────────────────────

describe('groupIntoSeries', () => {
  const date = '2026-07-10';

  it('splits observed vs baseline rows by date', () => {
    const snapshots = makeSnapshots(100, 160, { date });
    const map = groupIntoSeries(snapshots, date);
    expect(map.size).toBe(1);
    const [bucket] = [...map.values()];
    expect(bucket.observed).toBe(160);
    expect(bucket.baseline).toHaveLength(14);
  });

  it('handles null dimension as a distinct series', () => {
    const nullDim  = makeSnapshots(100, 110, { date, dimension: null });
    const namedDim = makeSnapshots(200, 220, { date, dimension: 'campaign-1' });
    const map = groupIntoSeries([...nullDim, ...namedDim], date);
    expect(map.size).toBe(2);
  });

  it('separates different metric names into distinct series', () => {
    const spendRows = makeSnapshots(100, 110, { date, metricName: 'spend' });
    const ctrRows   = makeSnapshots(0.05, 0.06, { date, metricName: 'ctr' });
    const map = groupIntoSeries([...spendRows, ...ctrRows], date);
    expect(map.size).toBe(2);
  });
});

// ── detectAnomalies ───────────────────────────────────────────────────────────

describe('detectAnomalies', () => {
  const orgId = 'org-1';
  const date  = '2026-07-10';

  it('flags a high-severity anomaly when spend drops 60%', () => {
    const snapshots = makeSnapshots(1000, 400, { date }); // −60%
    const map = groupIntoSeries(snapshots, date);
    const anomalies = detectAnomalies(orgId, map, date);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].severity).toBe('high');
    expect(anomalies[0].deviation_pct).toBeCloseTo(-60, 1);
  });

  it('flags a medium-severity anomaly at 35% increase', () => {
    const snapshots = makeSnapshots(1000, 1350, { date }); // +35%
    const map = groupIntoSeries(snapshots, date);
    const anomalies = detectAnomalies(orgId, map, date);
    expect(anomalies[0].severity).toBe('medium');
  });

  it('flags a low-severity anomaly at 20% increase', () => {
    const snapshots = makeSnapshots(1000, 1200, { date }); // +20%
    const map = groupIntoSeries(snapshots, date);
    const anomalies = detectAnomalies(orgId, map, date);
    expect(anomalies[0].severity).toBe('low');
  });

  it('does not flag deviation below 15%', () => {
    const snapshots = makeSnapshots(1000, 1100, { date }); // +10%
    const map = groupIntoSeries(snapshots, date);
    expect(detectAnomalies(orgId, map, date)).toHaveLength(0);
  });

  it('skips series with fewer than 7 baseline points', () => {
    const snapshots = [
      // only 5 baseline days
      ...Array.from({ length: 5 }, (_, i) => ({
        source: 'google_ads', metric_name: 'spend', dimension: null,
        value: 1000, snapshot_date: subtractDays(date, i + 1),
      })),
      { source: 'google_ads', metric_name: 'spend', dimension: null, value: 100, snapshot_date: date },
    ];
    const map = groupIntoSeries(snapshots, date);
    expect(detectAnomalies(orgId, map, date)).toHaveLength(0);
  });

  it('skips series where baseline mean is zero', () => {
    const snapshots = makeSnapshots(0, 500, { date });
    const map = groupIntoSeries(snapshots, date);
    expect(detectAnomalies(orgId, map, date)).toHaveLength(0);
  });

  it('skips series with no observed value on detected date', () => {
    // All rows are baseline (before detected date)
    const snapshots = Array.from({ length: 14 }, (_, i) => ({
      source: 'google_ads', metric_name: 'spend', dimension: null,
      value: 1000, snapshot_date: subtractDays(date, i + 1),
    }));
    const map = groupIntoSeries(snapshots, date);
    expect(detectAnomalies(orgId, map, date)).toHaveLength(0);
  });

  it('correctly assigns org_id, source, metric_name, dimension', () => {
    const snapshots = makeSnapshots(500, 1000, { date, source: 'meta_ads', metricName: 'impressions', dimension: 'camp-A' });
    const map = groupIntoSeries(snapshots, date);
    const anomalies = detectAnomalies(orgId, map, date);
    expect(anomalies[0]).toMatchObject({
      org_id: 'org-1',
      source: 'meta_ads',
      metric_name: 'impressions',
      dimension: 'camp-A',
      detected_date: date,
    });
  });
});

// ── runAnomalyDetectionForOrg ─────────────────────────────────────────────────

describe('runAnomalyDetectionForOrg', () => {
  beforeEach(() => vi.resetAllMocks());

  it('skips when no snapshot data found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));
    await expect(runAnomalyDetectionForOrg('org-1', '2026-07-10')).resolves.toBeUndefined();
    // upsert should not be called
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(1);
  });

  it('queries the correct 14-day window', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));
    await runAnomalyDetectionForOrg('org-1', '2026-07-10');
    const chain = vi.mocked(supabaseAdmin.from).mock.results[0].value;
    expect(chain.gte).toHaveBeenCalledWith('snapshot_date', '2026-06-26');
    expect(chain.lte).toHaveBeenCalledWith('snapshot_date', '2026-07-10');
  });

  it('upserts anomaly rows when anomalies are detected', async () => {
    const snapshots = makeSnapshots(1000, 100, { date: '2026-07-10' }); // −90%
    const upsertChain = makeChain(null, null);

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(snapshots, null)) // fetch snapshots
      .mockReturnValueOnce(upsertChain);               // upsert anomalies

    await runAnomalyDetectionForOrg('org-1', '2026-07-10');
    expect(upsertChain.upsert).toHaveBeenCalledOnce();
    const [rows] = upsertChain.upsert.mock.calls[0] as [{ severity: string }[]];
    expect(rows[0].severity).toBe('high');
  });

  it('does not upsert when no anomalies detected (small deviation)', async () => {
    const snapshots = makeSnapshots(1000, 1050, { date: '2026-07-10' }); // +5%
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain(snapshots, null));

    await runAnomalyDetectionForOrg('org-1', '2026-07-10');
    // from() called once for fetch; NOT called a second time for upsert
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(1);
  });

  it('throws when snapshot fetch returns an error', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain(null, { message: 'DB down' }));
    await expect(runAnomalyDetectionForOrg('org-1', '2026-07-10')).rejects.toThrow('DB down');
  });
});

// ── runAnomalyDetectionForAllActiveOrgs ──────────────────────────────────────

describe('runAnomalyDetectionForAllActiveOrgs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('runs detection for each eligible org', async () => {
    vi.mocked(getAirEligibleOrgIds).mockResolvedValue(['org-a', 'org-b']);
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));

    await runAnomalyDetectionForAllActiveOrgs('2026-07-10');
    // Each org makes one from() call (fetch snapshots, returns empty so no upsert)
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2);
  });

  it('continues to next org when one fails', async () => {
    vi.mocked(getAirEligibleOrgIds).mockResolvedValue(['org-bad', 'org-ok']);
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(null, { message: 'exploded' })) // org-bad
      .mockReturnValueOnce(makeChain([], null));                      // org-ok

    await expect(
      runAnomalyDetectionForAllActiveOrgs('2026-07-10'),
    ).resolves.toBeUndefined();
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalledTimes(2);
  });
});
