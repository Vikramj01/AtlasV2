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
  resolveKlaviyoMetricId,
  fetchKlaviyoMetricAggregate,
  fetchKlaviyoDailyMetrics,
  buildKlaviyoMetricRows,
  ingestKlaviyo,
} from '../klaviyoConnector';

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'in']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

function aggregateResponse(measurements: Record<string, number[]>) {
  return {
    ok: true,
    json: () => Promise.resolve({
      data: { attributes: { data: [{ dimensions: [], measurements }] } },
    }),
  } as unknown as Response;
}

// ── resolveKlaviyoMetricId ────────────────────────────────────────────────────

describe('resolveKlaviyoMetricId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the metric id when found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'metric-123' }] }),
    } as unknown as Response);

    const id = await resolveKlaviyoMetricId('key', 'Placed Order');
    expect(id).toBe('metric-123');
  });

  it('returns null when the account has never recorded that metric', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as unknown as Response);

    const id = await resolveKlaviyoMetricId('key', 'Placed Order');
    expect(id).toBeNull();
  });

  it('throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as unknown as Response);

    await expect(resolveKlaviyoMetricId('bad-key', 'Placed Order')).rejects.toThrow('401');
  });
});

// ── fetchKlaviyoMetricAggregate ───────────────────────────────────────────────

describe('fetchKlaviyoMetricAggregate', () => {
  beforeEach(() => vi.resetAllMocks());

  it('sums measurement buckets from the response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      aggregateResponse({ count: [42], sum_value: [1250.5], unique: [30] }),
    );

    const result = await fetchKlaviyoMetricAggregate('key', 'metric-1', '2026-09-01');
    expect(result).toEqual({ count: 42, sum_value: 1250.5, unique: 30 });
  });

  it('sends a UTC day-window filter for the given date', async () => {
    global.fetch = vi.fn().mockResolvedValue(aggregateResponse({ count: [0], sum_value: [0], unique: [0] }));

    await fetchKlaviyoMetricAggregate('key', 'metric-1', '2026-09-01');
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.data.attributes.filter).toEqual([
      'greater-or-equal(datetime,2026-09-01T00:00:00+00:00)',
      'less-than(datetime,2026-09-02T00:00:00+00:00)',
    ]);
  });

  it('throws on non-200 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    } as unknown as Response);

    await expect(fetchKlaviyoMetricAggregate('key', 'metric-1', '2026-09-01')).rejects.toThrow('400');
  });
});

// ── fetchKlaviyoDailyMetrics ──────────────────────────────────────────────────

describe('fetchKlaviyoDailyMetrics', () => {
  beforeEach(() => vi.resetAllMocks());

  it('maps all four metrics when every one resolves', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (!opts?.body) {
        // GET /metrics/ lookups — route by metric name in the filter query string
        if (url.includes('Placed%20Order')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: 'm-order' }] }) });
        if (url.includes('Received%20Email')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: 'm-received' }] }) });
        if (url.includes('Opened%20Email')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: 'm-opened' }] }) });
        if (url.includes('Clicked%20Email')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: 'm-clicked' }] }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      // POST /metric-aggregates/
      const body = JSON.parse(opts.body as string);
      const metricId = body.data.attributes.metric_id;
      const byMetric: Record<string, { count: number[]; sum_value: number[]; unique: number[] }> = {
        'm-order':    { count: [12], sum_value: [980.25], unique: [12] },
        'm-received': { count: [5000], sum_value: [0], unique: [5000] },
        'm-opened':   { count: [1200], sum_value: [0], unique: [1200] },
        'm-clicked':  { count: [300], sum_value: [0], unique: [300] },
      };
      return Promise.resolve(aggregateResponse(byMetric[metricId]));
    });

    const metrics = await fetchKlaviyoDailyMetrics('key', '2026-09-01');
    expect(metrics).toEqual({
      sends: 5000,
      opens: 1200,
      clicks: 300,
      conversions: 12,
      revenue: 980.25,
    });
  });

  it('leaves a metric null when the account never recorded that event', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (!opts?.body) {
        // Only "Placed Order" resolves; the other three don't exist for this account.
        if (url.includes('Placed%20Order')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ id: 'm-order' }] }) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve(aggregateResponse({ count: [7], sum_value: [500], unique: [7] }));
    });

    const metrics = await fetchKlaviyoDailyMetrics('key', '2026-09-01');
    expect(metrics).toEqual({
      sends: null,
      opens: null,
      clicks: null,
      conversions: 7,
      revenue: 500,
    });
  });
});

// ── buildKlaviyoMetricRows ────────────────────────────────────────────────────

describe('buildKlaviyoMetricRows', () => {
  it('emits one account-level row per non-null metric', () => {
    const rows = buildKlaviyoMetricRows('org-1', {
      sends: 100, opens: 40, clicks: 10, conversions: 3, revenue: 250.5,
    }, '2026-09-01');

    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.source === 'klaviyo' && r.dimension === null)).toBe(true);
    expect(rows.find((r) => r.metric_name === 'revenue')?.value).toBe(250.5);
  });

  it('omits metrics that are null (never recorded, not zero)', () => {
    const rows = buildKlaviyoMetricRows('org-1', {
      sends: null, opens: null, clicks: null, conversions: 3, revenue: 250.5,
    }, '2026-09-01');

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.metric_name).sort()).toEqual(['conversions', 'revenue']);
  });

  it('returns empty array when every metric is null', () => {
    const rows = buildKlaviyoMetricRows('org-1', {
      sends: null, opens: null, clicks: null, conversions: null, revenue: null,
    }, '2026-09-01');
    expect(rows).toHaveLength(0);
  });
});

// ── ingestKlaviyo ─────────────────────────────────────────────────────────────

describe('ingestKlaviyo', () => {
  beforeEach(() => vi.resetAllMocks());

  it('skips gracefully when no connections found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null));
    await expect(ingestKlaviyo('org-no-conn', '2026-09-01')).resolves.toBeUndefined();
  });

  it('calls resolveTokens and fetches metrics for an active connection', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([{ id: 'conn-1' }], null));
    vi.mocked(resolveTokens).mockResolvedValue({ access_token: 'private-key', expires_at: 0, token_type: 'private_api_key' });

    global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (!opts?.body) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      return Promise.resolve(aggregateResponse({ count: [0], sum_value: [0], unique: [0] }));
    });

    await ingestKlaviyo('org-1', '2026-09-01');
    expect(resolveTokens).toHaveBeenCalledWith('conn-1');
  });

  it('continues to next connection when one token resolution fails', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([{ id: 'conn-bad' }, { id: 'conn-ok' }], null));
    vi.mocked(resolveTokens)
      .mockRejectedValueOnce(new Error('token decrypt failed'))
      .mockResolvedValueOnce({ access_token: 'key2', expires_at: 0, token_type: 'private_api_key' });

    global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (!opts?.body) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      return Promise.resolve(aggregateResponse({ count: [0], sum_value: [0], unique: [0] }));
    });

    await expect(ingestKlaviyo('org-multi', '2026-09-01')).resolves.toBeUndefined();
    expect(resolveTokens).toHaveBeenCalledTimes(2);
  });
});
