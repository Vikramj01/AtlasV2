/**
 * metaEmqPolling unit tests — cadence gating, defensive event_match_quality
 * parsing (bare number vs. nested object), and error-outcome handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/capi/credentials', () => ({
  safeDecryptCredentials: vi.fn(),
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from '@/services/capi/credentials';
import { pollMetaEmqForOrg, saveMetaEmqOutcome, getLatestMetaEmqScores } from '../metaEmqPolling';

function makeChain(resolvedData: unknown = null, resolvedError: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data: resolvedData, error: resolvedError };
  const resolved = Promise.resolve(terminal);

  for (const m of ['select', 'eq', 'order', 'limit', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

describe('pollMetaEmqForOrg', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function mockTables(opts: {
    providers?: Array<{ id: string; credentials: unknown }>;
    lastCheckedAt?: string | null;
  }) {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'capi_providers') return makeChain(opts.providers ?? []) as any;
      if (table === 'dqm_meta_emq_checks') {
        return makeChain(opts.lastCheckedAt ? { checked_at: opts.lastCheckedAt } : null) as any;
      }
      return makeChain(null) as any;
    });
  }

  it('skips a provider polled within the cadence window', async () => {
    mockTables({
      providers: [{ id: 'p1', credentials: 'blob' }],
      lastCheckedAt: new Date().toISOString(),
    });

    const outcomes = await pollMetaEmqForOrg('org-1');
    expect(outcomes).toHaveLength(0);
  });

  it('skips a provider with no dataset_id configured', async () => {
    mockTables({ providers: [{ id: 'p1', credentials: 'blob' }], lastCheckedAt: null });
    vi.mocked(safeDecryptCredentials).mockReturnValue({ pixel_id: 'px', access_token: 'at', dataset_id: '' } as any);

    const outcomes = await pollMetaEmqForOrg('org-1');
    expect(outcomes).toHaveLength(0);
  });

  it('parses a bare-number event_match_quality', async () => {
    mockTables({ providers: [{ id: 'p1', credentials: 'blob' }], lastCheckedAt: null });
    vi.mocked(safeDecryptCredentials).mockReturnValue({ pixel_id: 'px', access_token: 'at', dataset_id: 'ds1' } as any);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { data: [{ event_name: 'Purchase', event_match_quality: 7.2 }] } }),
    }) as any;

    const outcomes = await pollMetaEmqForOrg('org-1');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('ok');
    expect(outcomes[0].results[0]).toMatchObject({ event_name: 'Purchase', emq_score: 7.2 });
  });

  it('parses a nested-object event_match_quality with a score/diagnostics sub-field', async () => {
    mockTables({ providers: [{ id: 'p1', credentials: 'blob' }], lastCheckedAt: null });
    vi.mocked(safeDecryptCredentials).mockReturnValue({ pixel_id: 'px', access_token: 'at', dataset_id: 'ds1' } as any);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: { data: [{ event_name: 'Lead', event_match_quality: { score: 5.5, diagnostics: [{ issue: 'low_match' }] } }] },
      }),
    }) as any;

    const outcomes = await pollMetaEmqForOrg('org-1');
    expect(outcomes[0].results[0].emq_score).toBe(5.5);
    expect(outcomes[0].results[0].diagnostics).toEqual([{ issue: 'low_match' }]);
  });

  it('records an error outcome when the Dataset Quality API request fails', async () => {
    mockTables({ providers: [{ id: 'p1', credentials: 'blob' }], lastCheckedAt: null });
    vi.mocked(safeDecryptCredentials).mockReturnValue({ pixel_id: 'px', access_token: 'at', dataset_id: 'ds1' } as any);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' }) as any;

    const outcomes = await pollMetaEmqForOrg('org-1');
    expect(outcomes[0].status).toBe('error');
    expect(outcomes[0].errorMessage).toContain('401');
  });
});

describe('saveMetaEmqOutcome', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts one row per result on success', async () => {
    const chain = makeChain();
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any);

    await saveMetaEmqOutcome({
      providerId: 'p1', orgId: 'org-1', datasetId: 'ds1', status: 'ok', errorMessage: null,
      results: [
        { event_name: 'Purchase', emq_score: 6.9, diagnostics: null },
        { event_name: 'Lead', emq_score: 4.1, diagnostics: null },
      ],
    });

    expect(chain.insert).toHaveBeenCalledWith([
      expect.objectContaining({ event_name: 'Purchase', emq_score: 6.9, check_status: 'ok' }),
      expect.objectContaining({ event_name: 'Lead', emq_score: 4.1, check_status: 'ok' }),
    ]);
  });

  it('inserts a single error row on failure, without throwing', async () => {
    const chain = makeChain();
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any);

    await saveMetaEmqOutcome({
      providerId: 'p1', orgId: 'org-1', datasetId: 'ds1', status: 'error', errorMessage: 'boom', results: [],
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ check_status: 'error', error_message: 'boom', emq_score: null }),
    );
  });
});

describe('getLatestMetaEmqScores', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('dedupes to the latest row per (provider, event_name)', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([
      { capi_provider_id: 'p1', dataset_id: 'ds1', event_name: 'Purchase', emq_score: 7.0, checked_at: '2026-09-15T10:00:00Z' },
      { capi_provider_id: 'p1', dataset_id: 'ds1', event_name: 'Purchase', emq_score: 6.5, checked_at: '2026-09-15T09:00:00Z' },
      { capi_provider_id: 'p1', dataset_id: 'ds1', event_name: 'Lead', emq_score: 4.0, checked_at: '2026-09-15T10:00:00Z' },
    ]) as any);

    const rows = await getLatestMetaEmqScores('org-1');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.event_name === 'Purchase')?.emq_score).toBe(7.0);
  });
});
