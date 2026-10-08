/**
 * GA4 Admin / L11 / Junk Gate PRD §A.5 (AC 4): a config change between two
 * snapshots produces exactly one rolled-up alert for the org.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let windowRows: Array<{ property_id: string; snapshot: unknown; captured_at: string }>;
let priorByProperty: Record<string, { property_id: string; snapshot: unknown; captured_at: string } | null>;

vi.mock('@/services/database/supabase', () => {
  const make = () => {
    let prop: string | undefined;
    let lt = false;
    const chain: any = {};
    for (const m of ['select', 'order', 'limit', 'gte']) chain[m] = () => chain;
    chain.eq = (col: string, v: string) => { if (col === 'property_id') prop = v; return chain; };
    chain.lt = () => { lt = true; return chain; };
    chain.maybeSingle = async () => ({ data: lt && prop ? priorByProperty[prop] ?? null : null, error: null });
    chain.then = (resolve: Function) => resolve({ data: lt ? [] : windowRows, error: null });
    return chain;
  };
  return { supabaseAdmin: { from: () => make() } };
});

import { computeGa4ConfigChangeSignals } from '../ga4ConfigChangeMonitor';
import { evaluateGa4ConfigChangeAlert } from '../dqmAlertEvaluator';

const snap = (currency: string) => ({
  property_id: 'p', currency_code: currency, time_zone: 'UTC', web_streams: [], ads_links: null, data_retention: null,
});

beforeEach(() => { windowRows = []; priorByProperty = {}; });

describe('computeGa4ConfigChangeSignals', () => {
  it('counts a property whose newest snapshot differs from its prior one', async () => {
    windowRows = [{ property_id: 'p1', snapshot: snap('USD'), captured_at: '2026-10-06T10:00:00Z' }];
    priorByProperty = { p1: { property_id: 'p1', snapshot: snap('GBP'), captured_at: '2026-10-01T10:00:00Z' } };
    const r = await computeGa4ConfigChangeSignals('org-1', false);
    expect(r).toEqual({ changedPropertyCount: 1, changeTypes: ['currency'], existingAlertActive: false });
  });

  it('a first snapshot (no prior) is a baseline, not a change', async () => {
    windowRows = [{ property_id: 'p1', snapshot: snap('GBP'), captured_at: '2026-10-06T10:00:00Z' }];
    expect((await computeGa4ConfigChangeSignals('org-1', false)).changedPropertyCount).toBe(0);
  });

  it('rolls several changed properties into one count', async () => {
    windowRows = [
      { property_id: 'p1', snapshot: snap('USD'), captured_at: '2026-10-06T10:00:00Z' },
      { property_id: 'p2', snapshot: snap('EUR'), captured_at: '2026-10-06T11:00:00Z' },
    ];
    priorByProperty = {
      p1: { property_id: 'p1', snapshot: snap('GBP'), captured_at: '2026-10-01T10:00:00Z' },
      p2: { property_id: 'p2', snapshot: snap('GBP'), captured_at: '2026-10-01T10:00:00Z' },
    };
    expect((await computeGa4ConfigChangeSignals('org-1', false)).changedPropertyCount).toBe(2);
  });
});

describe('evaluateGa4ConfigChangeAlert', () => {
  it('opens exactly one warning alert for any number of changed properties', () => {
    const r = evaluateGa4ConfigChangeAlert({ changedPropertyCount: 3, changeTypes: ['currency', 'stream_ids'], existingAlertActive: false });
    expect(r.decision).toBe('open');
    expect(r.severity).toBe('warning');
    expect(r.message).toContain('3 connected GA4 properties');
    expect(r.message).toContain('property currency');
  });

  it('updates (no second alert) while one is already active', () => {
    expect(evaluateGa4ConfigChangeAlert({ changedPropertyCount: 1, changeTypes: ['currency'], existingAlertActive: true }).decision).toBe('update');
  });

  it('resolves once nothing changed in the window, and does nothing when no alert exists', () => {
    expect(evaluateGa4ConfigChangeAlert({ changedPropertyCount: 0, changeTypes: [], existingAlertActive: true }).decision).toBe('resolve');
    expect(evaluateGa4ConfigChangeAlert({ changedPropertyCount: 0, changeTypes: [], existingAlertActive: false }).decision).toBe('none');
  });
});
