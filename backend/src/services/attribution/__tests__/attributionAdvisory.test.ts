import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { getLatestAttributionChainForClient } from '../attributionAdvisory';
import type { AttributionChainResult } from '../chainModel';

function makeChain(resolvedData: unknown = null, resolvedError: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data: resolvedData, error: resolvedError };
  const resolved = Promise.resolve(terminal);

  for (const m of ['select', 'eq', 'not', 'order', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: typeof terminal) => void) => resolved.then(resolve);
  return chain as unknown as ReturnType<typeof supabaseAdmin.from>;
}

const CLEAN_CHAIN: AttributionChainResult = {
  links: { arrival: 'PASS', persistence: 'PASS', form_carriage: 'PASS', crm_arrival: 'NOT_OBSERVED', real_population: 'NOT_OBSERVED' },
  break_at: null,
  break_evidence: '',
  remedy_tier: null,
  not_observed_reason: null,
  scope: 'pre_connection',
};

describe('getLatestAttributionChainForClient', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when the client has no runs at all', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([]));
    expect(await getLatestAttributionChainForClient('client-1')).toBeNull();
  });

  it('returns null when the query itself errors', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain(null, new Error('db down')));
    expect(await getLatestAttributionChainForClient('client-1')).toBeNull();
  });

  it('returns null when no run in the recent window carries an attribution_chain (e.g. all ecommerce/saas scans)', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([
      { id: 'run-1', url: 'https://example.com', completed_at: '2026-09-01T00:00:00Z', verdict: { rating: 'strong', score: 90 } },
    ]));
    expect(await getLatestAttributionChainForClient('client-1')).toBeNull();
  });

  it('returns the most recent run whose verdict carries an attribution_chain, skipping newer runs without one', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([
      { id: 'run-newer', url: 'https://example.com', completed_at: '2026-09-15T00:00:00Z', verdict: { rating: 'strong', score: 90 } },
      { id: 'run-older', url: 'https://example.com', completed_at: '2026-09-01T00:00:00Z', verdict: { rating: 'moderate', score: 55, attribution_chain: CLEAN_CHAIN } },
    ]));
    const result = await getLatestAttributionChainForClient('client-1');
    expect(result?.run_id).toBe('run-older');
    expect(result?.chain).toEqual(CLEAN_CHAIN);
  });

  it('never throws when supabaseAdmin.from itself throws', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => { throw new Error('unexpected'); });
    await expect(getLatestAttributionChainForClient('client-1')).resolves.toBeNull();
  });
});
