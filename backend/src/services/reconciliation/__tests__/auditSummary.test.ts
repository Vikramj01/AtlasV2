/**
 * L11 input resolution (GA4 Admin / L11 / Junk Gate PRD §B.3): no run = undefined
 * (rules skip), a run = its unresolved findings + topology + client-scoped changes,
 * and a failed context read never costs the run's own findings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let run: unknown;
let findings: { data: unknown; error: unknown };
let changes: { data: unknown; error?: unknown } | 'throw';
const seenFilters: string[] = [];

vi.mock('@/services/database/supabase', () => {
  const make = (table: string) => {
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'order', 'limit']) chain[m] = () => chain;
    chain.eq = (col: string, v: string) => { seenFilters.push(`${table}.${col}=${v}`); return chain; };
    chain.is = (col: string) => { seenFilters.push(`${table}.${col} is null`); return chain; };
    chain.maybeSingle = async () => ({ data: run, error: null });
    chain.then = (resolve: Function, reject: Function) => {
      if (table === 'reconciliation_findings') return resolve(findings);
      if (table === 'platform_discontinuities') return changes === 'throw' ? reject(new Error('migration not applied')) : resolve(changes);
      return resolve({ data: [], error: null });
    };
    return chain;
  };
  return { supabaseAdmin: { from: (t: string) => make(t) } };
});
let topologyRows: unknown[] | 'throw';
vi.mock('@/services/database/googleTagTopologyQueries', () => ({
  getCurrentTopologyRows: vi.fn(async () => { if (topologyRows === 'throw') throw new Error('boom'); return topologyRows; }),
}));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { resolveReconciliationSummary, attachReconciliationInputs } from '../auditSummary';

beforeEach(() => {
  seenFilters.length = 0;
  run = { id: 'run-1', finished_at: '2026-10-05T10:00:00Z' };
  findings = { data: [{ platform: 'ga4', dimension: 'config', severity: 'error', finding_code: 'X', resolved_at: null, narrative: 'n' }], error: null };
  changes = { data: [{ platform: 'ga4', title: 'GA4 property currency changed', effective_date: '2026-10-01' }] };
  topologyRows = [];
});

describe('resolveReconciliationSummary', () => {
  it('undefined when the client has no completed run', async () => {
    run = null;
    expect(await resolveReconciliationSummary('client-1')).toBeUndefined();
  });

  it('returns the latest run\'s unresolved findings, topology and client-scoped changes — scoped to this client', async () => {
    const s = await resolveReconciliationSummary('client-1');
    expect(s).toMatchObject({ run_id: 'run-1', run_completed_at: '2026-10-05T10:00:00Z' });
    expect(s!.findings).toHaveLength(1);
    expect(s!.google_tag_topology).toEqual({ verdict: 'UNKNOWN', strength: 'none' });
    expect(s!.tracking_changes).toHaveLength(1);
    expect(seenFilters).toContain('reconciliation_runs.client_id=client-1');
    expect(seenFilters).toContain('platform_discontinuities.client_id=client-1');
    expect(seenFilters).toContain('platform_discontinuities.kind=client_tracking_change');
    expect(seenFilters).toContain('reconciliation_findings.resolved_at is null');
  });

  it('a failed topology or tracking-change read drops that context, never the findings', async () => {
    topologyRows = 'throw';
    changes = 'throw';
    const s = await resolveReconciliationSummary('client-1');
    expect(s!.findings).toHaveLength(1);
    expect(s!.google_tag_topology).toBeUndefined();
    expect(s!.tracking_changes).toBeUndefined();
  });

  it('a failed findings read is treated as no data (L11 skipped), not an empty clean summary', async () => {
    findings = { data: null, error: { message: 'x' } };
    expect(await resolveReconciliationSummary('client-1')).toBeUndefined();
  });
});

describe('attachReconciliationInputs', () => {
  it('no client (bare-URL / public scan): client_linked false, resolver never called', async () => {
    const resolve = vi.fn();
    const a: { client_linked?: boolean; reconciliation_summary?: unknown } = {};
    await attachReconciliationInputs(a, null, resolve);
    expect(a.client_linked).toBe(false);
    expect(a.reconciliation_summary).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a client: client_linked true and the summary attached', async () => {
    const a: { client_linked?: boolean; reconciliation_summary?: unknown } = {};
    await attachReconciliationInputs(a, 'client-1', async () => ({ run_id: 'r', run_completed_at: 't', findings: [] }));
    expect(a.client_linked).toBe(true);
    expect(a.reconciliation_summary).toEqual({ run_id: 'r', run_completed_at: 't', findings: [] });
  });

  it('a resolver failure is non-fatal: linked, but no summary (L11 skipped)', async () => {
    const a: { client_linked?: boolean; reconciliation_summary?: unknown } = {};
    await expect(attachReconciliationInputs(a, 'client-1', async () => { throw new Error('db down'); })).resolves.toBeUndefined();
    expect(a.client_linked).toBe(true);
    expect(a.reconciliation_summary).toBeUndefined();
  });
});
