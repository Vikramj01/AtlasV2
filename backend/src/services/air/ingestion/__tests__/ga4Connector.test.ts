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
  fetchGA4ChannelMetrics,
  buildGA4MetricRows,
  ingestGA4,
} from '../ga4Connector';

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

function makeGA4Response(rows: { channel: string; sessions: number; keyEvents: number; engaged: number; bounceRate: number; engagementRate: number }[]) {
  return {
    ok: true,
    json: () => Promise.resolve({
      rows: rows.map((r) => ({
        dimensionValues: [{ value: r.channel }],
        metricValues: [
          { value: String(r.sessions) },
          { value: String(r.keyEvents) },
          { value: String(r.engaged) },
          { value: String(r.bounceRate) },
          { value: String(r.engagementRate) },
        ],
      })),
    }),
  } as unknown as Response;
}

// ── fetchGA4ChannelMetrics ────────────────────────────────────────────────────

describe('fetchGA4ChannelMetrics', () => {
  beforeEach(() => vi.resetAllMocks());

  it('parses channel rows from GA4 runReport response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeGA4Response([{ channel: 'Organic Search', sessions: 1000, keyEvents: 50, engaged: 700, bounceRate: 0.3, engagementRate: 0.7 }]),
    );

    const rows = await fetchGA4ChannelMetrics('123456789', 'tok', '2026-07-10');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channelGroup: 'Organic Search',
      sessions: 1000,
      keyEvents: 50,
      engagedSessions: 700,
      bounceRate: 0.3,
      engagementRate: 0.7,
    });
  });

  it('returns empty array when API returns no rows', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const rows = await fetchGA4ChannelMetrics('123456789', 'tok', '2026-07-10');
    expect(rows).toHaveLength(0);
  });

  it('throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    } as unknown as Response);

    await expect(fetchGA4ChannelMetrics('123456789', 'tok', '2026-07-10')).rejects.toThrow('403');
  });

  it('sends Authorization header with Bearer token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    await fetchGA4ChannelMetrics('123456789', 'my-token', '2026-07-10');
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-token');
  });
});

// ── buildGA4MetricRows ────────────────────────────────────────────────────────

describe('buildGA4MetricRows', () => {
  const channelRows = [
    { channelGroup: 'Organic Search', sessions: 1000, keyEvents: 50,  engagedSessions: 700, bounceRate: 0.3,  engagementRate: 0.7 },
    { channelGroup: 'Paid Search',    sessions: 500,  keyEvents: 30,  engagedSessions: 350, bounceRate: 0.3,  engagementRate: 0.7 },
  ];

  it('emits per-channel rows with channelGroup dimension', () => {
    const rows = buildGA4MetricRows('org-1', channelRows, '2026-07-10');
    const organicSessions = rows.find((r) => r.metric_name === 'sessions' && r.dimension === 'Organic Search');
    expect(organicSessions?.value).toBe(1000);
    expect(organicSessions?.source).toBe('ga4');
  });

  it('emits account-level session aggregates with null dimension', () => {
    const rows = buildGA4MetricRows('org-1', channelRows, '2026-07-10');
    const totalSessions = rows.find((r) => r.metric_name === 'sessions' && r.dimension === null);
    expect(totalSessions?.value).toBe(1500);
  });

  it('recomputes engagement_rate from summed sessions at account level', () => {
    const rows = buildGA4MetricRows('org-1', channelRows, '2026-07-10');
    const engagementRate = rows.find((r) => r.metric_name === 'engagement_rate' && r.dimension === null);
    // (700 + 350) / (1000 + 500) = 1050/1500 = 0.7
    expect(engagementRate?.value).toBeCloseTo(1050 / 1500);
  });

  it('recomputes bounce_rate from summed sessions at account level', () => {
    const rows = buildGA4MetricRows('org-1', channelRows, '2026-07-10');
    const bounceRate = rows.find((r) => r.metric_name === 'bounce_rate' && r.dimension === null);
    // (1500 - 1050) / 1500 = 450/1500 = 0.3
    expect(bounceRate?.value).toBeCloseTo(450 / 1500);
  });

  it('omits account-level rate rows when total sessions are zero', () => {
    const noSessions = [{ channelGroup: 'Direct', sessions: 0, keyEvents: 0, engagedSessions: 0, bounceRate: 0, engagementRate: 0 }];
    const rows = buildGA4MetricRows('org-1', noSessions, '2026-07-10');
    expect(rows.find((r) => r.metric_name === 'bounce_rate' && r.dimension === null)).toBeUndefined();
    expect(rows.find((r) => r.metric_name === 'engagement_rate' && r.dimension === null)).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    const rows = buildGA4MetricRows('org-1', [], '2026-07-10');
    expect(rows).toHaveLength(0);
  });
});

// ── ingestGA4 ─────────────────────────────────────────────────────────────────

describe('ingestGA4', () => {
  beforeEach(() => vi.resetAllMocks());

  it('skips gracefully when no connections found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));
    await expect(ingestGA4('org-no-conn', '2026-07-10')).resolves.toBeUndefined();
  });

  it('strips "properties/" prefix from account_id', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ id: 'conn-1', account_id: 'properties/123456789' }], null))
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens).mockResolvedValue({ access_token: 'tok', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    await ingestGA4('org-1', '2026-07-10');
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('properties/123456789');
    expect(url).not.toContain('properties/properties/');
  });

  it('accepts bare numeric property id without prefix', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([{ id: 'conn-2', account_id: '987654321' }], null))
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens).mockResolvedValue({ access_token: 'tok', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);

    await ingestGA4('org-1', '2026-07-10');
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('properties/987654321');
  });

  it('continues to next connection when one fetch fails', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain([
        { id: 'conn-bad', account_id: '111' },
        { id: 'conn-ok',  account_id: '222' },
      ], null))
      .mockReturnValue(makeChain(null, null));

    vi.mocked(resolveTokens)
      .mockRejectedValueOnce(new Error('token error'))
      .mockResolvedValueOnce({ access_token: 'tok2', expires_at: 9999999999000, token_type: 'Bearer' });

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);

    await expect(ingestGA4('org-multi', '2026-07-10')).resolves.toBeUndefined();
    expect(resolveTokens).toHaveBeenCalledTimes(2);
  });
});
