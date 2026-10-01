/**
 * Google Tag Topology Sprint 5 (AC 14): client-scoped discontinuities reach only
 * that client's reconciliation run, and a missing migration can't silently drop
 * every annotation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
let scopedResult: { data: unknown; error: unknown };
let fallbackResult: { data: unknown; error: unknown };
let connections: unknown[];

vi.mock('@/services/database/supabase', () => {
  const connChain: any = {};
  for (const m of ['select', 'eq']) connChain[m] = () => connChain;
  connChain.then = (resolve: Function) => resolve({ data: connections, error: null });

  // A fresh chain per from() call: only the scoped query calls .or(), so the
  // fallback query (no .or) resolves to fallbackResult.
  const makeDiscChain = () => {
    let usedOr = false;
    const chain: any = {};
    for (const m of ['select', 'in']) chain[m] = (...args: unknown[]) => { calls.push({ table: 'platform_discontinuities', method: m, args }); return chain; };
    chain.or = (...args: unknown[]) => { usedOr = true; calls.push({ table: 'platform_discontinuities', method: 'or', args }); return chain; };
    chain.then = (resolve: Function) => resolve(usedOr ? scopedResult : fallbackResult);
    return chain;
  };

  return { supabaseAdmin: { from: (t: string) => (t === 'platform_connections' ? connChain : makeDiscChain()) } };
});
vi.mock('../findingWriter', () => ({ writeFinding: vi.fn() }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { writeFinding } from '../findingWriter';
import { runDiscontinuityDiff } from '../discontinuityDiff';

const platformRow = { id: 'p1', platform: 'meta', title: 'Meta change', effective_date: null, description: 'd' };
const splitRow = { id: 'c1', platform: 'ga4', title: 'Google tag split', effective_date: new Date().toISOString().slice(0, 10), description: 'split' };

beforeEach(() => {
  calls.length = 0;
  vi.mocked(writeFinding).mockReset();
  connections = [{ id: 'conn-1', platform: 'ga4' }, { id: 'conn-2', platform: 'meta' }];
  scopedResult = { data: [platformRow, splitRow], error: null };
  fallbackResult = { data: [platformRow], error: null };
});

describe('runDiscontinuityDiff scoping', () => {
  it('queries platform-wide rows OR this client\'s own client-scoped rows — never another client\'s', async () => {
    await runDiscontinuityDiff('run-1', 'client-A', 'org-1');
    const or = calls.find((c) => c.method === 'or');
    expect(or?.args[0]).toBe('kind.eq.platform,client_id.eq.client-A');
  });

  it('writes a finding for the client\'s own split discontinuity as well as platform-wide ones', async () => {
    await runDiscontinuityDiff('run-1', 'client-A', 'org-1');
    const titles = vi.mocked(writeFinding).mock.calls.map((c) => (c[0].observed as { title: string }).title);
    expect(titles).toEqual(expect.arrayContaining(['Meta change', 'Google tag split']));
  });

  it('falls back to platform-wide rows when the scoped query errors (migration not applied), instead of dropping every annotation', async () => {
    scopedResult = { data: null, error: { message: 'column platform_discontinuities.kind does not exist' } };
    await runDiscontinuityDiff('run-1', 'client-A', 'org-1');
    const titles = vi.mocked(writeFinding).mock.calls.map((c) => (c[0].observed as { title: string }).title);
    expect(titles).toEqual(['Meta change']);
  });

  it('does nothing for a client with no active connections', async () => {
    connections = [];
    await runDiscontinuityDiff('run-1', 'client-A', 'org-1');
    expect(writeFinding).not.toHaveBeenCalled();
  });
});
