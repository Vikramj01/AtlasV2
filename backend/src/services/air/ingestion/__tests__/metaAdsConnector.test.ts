import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/services/connections/tokenManager', () => ({
  resolveTokens: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/air/ingestion/airIngestionUtils', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/air/ingestion/airIngestionUtils')>();
  return { ...mod, writeMetricRows: vi.fn().mockResolvedValue(undefined) };
});

import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import {
  fetchMetaCampaignInsights,
  buildMetaMetricRows,
  ingestMetaAds,
} from '../metaAdsConnector';

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'in', 'upsert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

// ── fetchMetaCampaignInsights ─────────────────────────────────────────────────

describe('fetchMetaCampaignInsights', () => {
  beforeEach(() => vi.resetAllMocks());

  it('parses campaign insights from Graph API response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{
          campaign_id: '111',
          campaign_name: 'Brand',
          spend: '50.00',
          impressions: '10000',
          clicks: '500',
          actions: [
            { action_type: 'purchase', value: '10' },
            { action_type: 'link_click', value: '500' },
          ],
        }],
        paging: {},
      }),
    } as unknown as Response);

    const rows = await fetchMetaCampaignInsights('123456', 'tok', '2026-07-10');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      campaignId: '111',
      campaignName: 'Brand',
      spend: 50,
      impressions: 10000,
      clicks: 500,
      conversions: 10, // only 'purchase' counts; 'link_click' is excluded
    });
  });

  it('sums only recognised conversion action types', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{
          campaign_id: '222',
          campaign_name: 'Lead Gen',
          spend: '100.00',
          impressions: '5000',
          clicks: '200',
          actions: [
            { action_type: 'lead', value: '8' },
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
            { action_type: 'video_view', value: '999' }, // should be excluded
          ],
        }],
        paging: {},
      }),
    } as unknown as Response);

    const rows = await fetchMetaCampaignInsights('123456', 'tok', '2026-07-10');
    expect(rows[0].conversions).toBe(11); // 8 + 3
  });

  it('paginates through multiple pages', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ campaign_id: 'A', spend: '10', impressions: '100', clicks: '5', actions: [] }],
          paging: { next: 'https://graph.facebook.com/v19.0/page2' },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ campaign_id: 'B', spend: '20', impressions: '200', clicks: '10', actions: [] }],
          paging: {},
        }),
      } as unknown as Response);

    const rows = await fetchMetaCampaignInsights('123456', 'tok', '2026-07-10');
    expect(rows).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    } as unknown as Response);

    await expect(fetchMetaCampaignInsights('123456', 'tok', '2026-07-10')).rejects.toThrow('403');
  });

  it('skips rows missing campaign_id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { spend: '10', impressions: '100', clicks: '5', actions: [] }, // no campaign_id
          { campaign_id: 'C', spend: '20', impressions: '200', clicks: '10', actions: [] },
        ],
        paging: {},
      }),
    } as unknown as Response);

    const rows = await fetchMetaCampaignInsights('123456', 'tok', '2026-07-10');
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe('C');
  });
});

// ── buildMetaMetricRows ───────────────────────────────────────────────────────

describe('buildMetaMetricRows', () => {
  const insights = [
    { campaignId: 'C1', campaignName: 'Brand',   spend: 100, impressions: 5000, clicks: 250, conversions: 10 },
    { campaignId: 'C2', campaignName: 'Generic', spend: 50,  impressions: 2000, clicks: 80,  conversions: 4 },
  ];

  it('emits per-campaign rows with campaign_id dimension', () => {
    const rows = buildMetaMetricRows('org-1', insights, '2026-07-10');
    const c1Spend = rows.find((r) => r.metric_name === 'spend' && r.dimension === 'C1');
    expect(c1Spend?.value).toBe(100);
    expect(c1Spend?.source).toBe('meta_ads');
  });

  it('emits account-level aggregates with null dimension', () => {
    const rows = buildMetaMetricRows('org-1', insights, '2026-07-10');
    const totalSpend = rows.find((r) => r.metric_name === 'spend' && r.dimension === null);
    expect(totalSpend?.value).toBe(150);
  });

  it('computes CPA correctly at account level', () => {
    const rows = buildMetaMetricRows('org-1', insights, '2026-07-10');
    const totalCpa = rows.find((r) => r.metric_name === 'cpa' && r.dimension === null);
    // 150 spend / 14 conversions ≈ 10.71
    expect(totalCpa?.value).toBeCloseTo(150 / 14);
  });

  it('computes CTR correctly at account level', () => {
    const rows = buildMetaMetricRows('org-1', insights, '2026-07-10');
    const totalCtr = rows.find((r) => r.metric_name === 'ctr' && r.dimension === null);
    // (250 + 80) / (5000 + 2000) = 330/7000 ≈ 0.0471
    expect(totalCtr?.value).toBeCloseTo(330 / 7000);
  });

  it('omits CPA when total conversions are zero', () => {
    const noCv = [{ ...insights[0], conversions: 0 }];
    const rows = buildMetaMetricRows('org-1', noCv, '2026-07-10');
    expect(rows.find((r) => r.metric_name === 'cpa' && r.dimension === null)).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    const rows = buildMetaMetricRows('org-1', [], '2026-07-10');
    expect(rows).toHaveLength(0);
  });
});

// ── ingestMetaAds ─────────────────────────────────────────────────────────────

describe('ingestMetaAds', () => {
  beforeEach(() => vi.resetAllMocks());

  it('skips gracefully when no connections found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));
    await expect(ingestMetaAds('org-no-conn', '2026-07-10')).resolves.toBeUndefined();
  });

  it('calls resolveTokens and fetches insights for active connection', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ id: 'conn-1', account_id: 'act_123456' }], null))
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens).mockResolvedValue({ access_token: 'tok', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], paging: {} }),
    } as unknown as Response);

    await ingestMetaAds('org-1', '2026-07-10');
    expect(resolveTokens).toHaveBeenCalledWith('conn-1');
    // act_ prefix stripped before passing to API
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('act_123456');
  });

  it('continues to next connection when one fetch fails', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([
        { id: 'conn-bad', account_id: 'act_111' },
        { id: 'conn-ok',  account_id: 'act_222' },
      ], null))
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens)
      .mockRejectedValueOnce(new Error('token decrypt failed'))
      .mockResolvedValueOnce({ access_token: 'tok2', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [], paging: {} }) } as unknown as Response);

    await expect(ingestMetaAds('org-multi', '2026-07-10')).resolves.toBeUndefined();
    expect(resolveTokens).toHaveBeenCalledTimes(2);
  });
});
