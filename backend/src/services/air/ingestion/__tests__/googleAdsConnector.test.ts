import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/services/connections/tokenManager', () => ({
  resolveTokens: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: { GOOGLE_ADS_DEVELOPER_TOKEN: 'test-dev-token' },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import {
  fetchCampaignPerformance,
  buildMetricRows,
  ingestGoogleAds,
} from '../googleAdsConnector';

// ── Query chain builder ───────────────────────────────────────────────────────

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'in', 'upsert', 'insert', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

// ── fetchCampaignPerformance ──────────────────────────────────────────────────

describe('fetchCampaignPerformance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses stream response into campaign rows', async () => {
    const streamLine = JSON.stringify({
      results: [
        {
          segments: { date: '2026-07-10' },
          campaign: { id: '111', name: 'Brand' },
          metrics: { costMicros: '5000000', conversions: '10', impressions: '1000', clicks: '50' },
        },
      ],
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(streamLine),
    } as unknown as Response);

    const rows = await fetchCampaignPerformance('1234567890', 'tok', '2026-07-10');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      campaignId: '111',
      campaignName: 'Brand',
      date: '2026-07-10',
      costMicros: 5_000_000,
      conversions: 10,
      impressions: 1000,
      clicks: 50,
    });
  });

  it('returns empty array when API returns no results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ results: [] })),
    } as unknown as Response);

    const rows = await fetchCampaignPerformance('123', 'tok', '2026-07-10');
    expect(rows).toHaveLength(0);
  });

  it('throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as unknown as Response);

    await expect(fetchCampaignPerformance('123', 'tok', '2026-07-10')).rejects.toThrow('401');
  });

  it('skips malformed stream chunks without throwing', async () => {
    const mixed = [
      'not-json',
      JSON.stringify({ results: [{ segments: { date: '2026-07-10' }, campaign: { id: '222', name: 'X' }, metrics: { costMicros: '1000000', conversions: '2', impressions: '200', clicks: '10' } }] }),
    ].join('\n');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mixed),
    } as unknown as Response);

    const rows = await fetchCampaignPerformance('123', 'tok', '2026-07-10');
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe('222');
  });

  it('passes login-customer-id header when managerId is provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') } as unknown as Response);
    await fetchCampaignPerformance('123', 'tok', '2026-07-10', '999');

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['login-customer-id']).toBe('999');
  });
});

// ── buildMetricRows ───────────────────────────────────────────────────────────

describe('buildMetricRows', () => {
  const campaignRows = [
    { campaignId: 'C1', campaignName: 'Brand', date: '2026-07-10', costMicros: 10_000_000, conversions: 5, impressions: 2000, clicks: 100 },
    { campaignId: 'C2', campaignName: 'Generic', date: '2026-07-10', costMicros: 5_000_000, conversions: 2, impressions: 1000, clicks: 40 },
  ];

  it('emits per-campaign rows with campaign_id dimension', () => {
    const rows = buildMetricRows('org-1', campaignRows, '2026-07-10');
    const c1Spend = rows.find((r) => r.metric_name === 'spend' && r.dimension === 'C1');
    expect(c1Spend?.value).toBeCloseTo(10); // 10_000_000 micros → £10
  });

  it('emits account-level aggregates with null dimension', () => {
    const rows = buildMetricRows('org-1', campaignRows, '2026-07-10');
    const totalSpend = rows.find((r) => r.metric_name === 'spend' && r.dimension === null);
    expect(totalSpend?.value).toBeCloseTo(15); // 10 + 5
  });

  it('computes CPA correctly', () => {
    const rows = buildMetricRows('org-1', campaignRows, '2026-07-10');
    const totalCpa = rows.find((r) => r.metric_name === 'cpa' && r.dimension === null);
    // total spend £15 / 7 conversions ≈ 2.14
    expect(totalCpa?.value).toBeCloseTo(15 / 7);
  });

  it('omits CPA row when conversions are zero', () => {
    const noCv = [{ ...campaignRows[0], conversions: 0 }];
    const rows = buildMetricRows('org-1', noCv, '2026-07-10');
    expect(rows.find((r) => r.metric_name === 'cpa' && r.dimension === null)).toBeUndefined();
  });

  it('computes CTR correctly', () => {
    const rows = buildMetricRows('org-1', campaignRows, '2026-07-10');
    const totalCtr = rows.find((r) => r.metric_name === 'ctr' && r.dimension === null);
    // (100 + 40) / (2000 + 1000) = 140/3000 ≈ 0.0467
    expect(totalCtr?.value).toBeCloseTo(140 / 3000);
  });

  it('returns empty array for empty campaign input', () => {
    const rows = buildMetricRows('org-1', [], '2026-07-10');
    expect(rows).toHaveLength(0);
  });
});

// ── ingestGoogleAds ───────────────────────────────────────────────────────────

describe('ingestGoogleAds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips gracefully when no connections found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));
    await expect(ingestGoogleAds('org-no-conn', '2026-07-10')).resolves.toBeUndefined();
  });

  it('calls resolveTokens and writes metric rows for active connection', async () => {
    // First call: platform_connections query → one connection
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ id: 'conn-1', account_id: '123-456-7890', parent_connection_id: null }], null))
      // Second call: upsert into air_metric_snapshots
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens).mockResolvedValue({ access_token: 'tok', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        results: [{
          segments: { date: '2026-07-10' },
          campaign: { id: 'C1', name: 'Brand' },
          metrics: { costMicros: '2000000', conversions: '4', impressions: '500', clicks: '25' },
        }],
      })),
    } as unknown as Response);

    await ingestGoogleAds('org-1', '2026-07-10');

    expect(resolveTokens).toHaveBeenCalledWith('conn-1');
  });

  it('continues to next connection when one connection fetch fails', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([
        { id: 'conn-bad', account_id: '111', parent_connection_id: null },
        { id: 'conn-ok',  account_id: '222', parent_connection_id: null },
      ], null))
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens)
      .mockRejectedValueOnce(new Error('token decrypt failed'))
      .mockResolvedValueOnce({ access_token: 'tok2', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('{}') } as unknown as Response);

    await expect(ingestGoogleAds('org-multi', '2026-07-10')).resolves.toBeUndefined();
    expect(resolveTokens).toHaveBeenCalledTimes(2);
  });
});
