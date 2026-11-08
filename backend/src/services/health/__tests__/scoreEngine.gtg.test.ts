/**
 * GTG re-sourcing in the org health score (docs/prd/google-tag-gateway.md §5).
 * AC 1: a GTM connection with no gateway is not "Active".
 * AC 2: a working gateway with no GTM connection is not capped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { computeOverallScore, fetchGTGStatus } from '../scoreEngine';

function clientsChain(result: { data: unknown; error: unknown }) {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockResolvedValue(result);
  return chain;
}

describe('computeOverallScore GTG cap', () => {
  // 100 across the board so any cap is visible
  const score = (status: Parameters<typeof computeOverallScore>[5]) =>
    computeOverallScore(100, 100, 100, 0, 100, status, 100);

  it('caps at 85 when not_detected', () => expect(score('not_detected')).toBe(85));
  it('caps at 85 when broken', () => expect(score('broken')).toBe(85));
  it.each(['verified', 'verified_no_geo', 'unknown', 'not_applicable', 'partial', 'detected_unverified', 'legacy'] as const)(
    'does not cap when %s',
    (status) => expect(score(status)).toBe(100),
  );
});

describe('fetchGTGStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads clients.gtg_status and never gtm_container_connections', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
      if (table === 'clients') return clientsChain({ data: [{ gtg_status: 'verified' }], error: null });
      throw new Error(`unexpected table ${table}`);
    }) as any);
    expect(await fetchGTGStatus('org-1')).toBe('verified');
    const tables = vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0]);
    expect(tables).not.toContain('gtm_container_connections');
  });

  it('is unknown (uncapped) when the read fails', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(clientsChain({ data: null, error: new Error('column missing') }) as any);
    expect(await fetchGTGStatus('org-1')).toBe('unknown');
  });

  it('is unknown for an org with no clients', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(clientsChain({ data: [], error: null }) as any);
    expect(await fetchGTGStatus('org-1')).toBe('unknown');
  });
});
