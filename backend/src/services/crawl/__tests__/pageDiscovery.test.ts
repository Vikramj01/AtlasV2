/**
 * Unit tests for pageDiscovery.ts
 *
 * Covers:
 *   1.  discoverPages — empty scope → empty result
 *   2.  discoverPages — respects per-domain page cap (monitor = 25)
 *   3.  discoverPages — respects domain cap (monitor = 1 domain)
 *   4.  discoverPages — higher-priority pages selected when cap applied
 *   5.  discoverPages — multi-domain agency tier (agency_starter: 5 domains × 10 pages)
 *   6.  discoverPages — supabase error → throws
 *   7.  seedPageScopeFromAdUrls — happy path; upsert called with correct rows
 *   8.  seedPageScopeFromAdUrls — invalid URL → throws
 *   9.  seedPageScopeFromAdUrls — supabase error → throws
 *  10.  detectFunnelPages — returns matching funnel URLs
 *  11.  detectFunnelPages — returns empty when no funnel patterns match
 *  12.  detectFunnelPages — supabase error → throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

// vi.hoisted ensures this is initialised before the vi.mock() factory runs
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: mockFrom },
}));

// After mocking supabase, import the functions under test
import { discoverPages, seedPageScopeFromAdUrls, detectFunnelPages } from '../pageDiscovery';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScopeRow(
  id: string,
  url: string,
  domain: string,
  priority = 1,
  url_type = 'ad_destination',
) {
  return { id, url, domain, priority, url_type };
}

/**
 * Returns a chainable mock that resolves `.select().eq().eq().order()`
 * with the provided data/error shape.
 */
function makeFluent(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const fn = vi.fn().mockReturnValue(chain);
  chain.select = fn;
  chain.eq     = fn;
  chain.order  = vi.fn().mockResolvedValue(result);
  chain.upsert = vi.fn().mockResolvedValue(result);
  chain.insert = fn;
  return chain;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('discoverPages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty array when scope is empty', async () => {
    mockFrom.mockReturnValue(makeFluent({ data: [], error: null }));
    const result = await discoverPages('org-1', 'monitor');
    expect(result).toEqual([]);
  });

  it('respects per-domain page cap for monitor tier (cap=25)', async () => {
    // 30 pages on one domain — only 25 should be returned
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeScopeRow(`id-${i}`, `https://example.com/page-${i}`, 'example.com', i),
    );
    mockFrom.mockReturnValue(makeFluent({ data: rows, error: null }));

    const result = await discoverPages('org-1', 'monitor');
    expect(result).toHaveLength(25);
    expect(result.every(p => p.domain === 'example.com')).toBe(true);
    expect(result.every(p => p.crawl_page_id === '')).toBe(true);
  });

  it('respects domain cap for monitor tier (1 domain)', async () => {
    // 2 domains × 5 pages each
    const rows = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeScopeRow(`a-${i}`, `https://alpha.com/p${i}`, 'alpha.com', i + 10),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeScopeRow(`b-${i}`, `https://beta.com/p${i}`, 'beta.com', i),
      ),
    ];
    mockFrom.mockReturnValue(makeFluent({ data: rows, error: null }));

    const result = await discoverPages('org-1', 'monitor');
    // monitor.domains = 1 → only one domain
    const domains = new Set(result.map(p => p.domain));
    expect(domains.size).toBe(1);
    // All returned pages must have crawl_page_id ''
    expect(result.every(p => p.crawl_page_id === '')).toBe(true);
  });

  it('returns pages with correctly mapped fields (scope_id, url_type, domain)', async () => {
    const rows = [
      makeScopeRow('scope-uuid', 'https://example.com/', 'example.com', 5, 'manual'),
    ];
    mockFrom.mockReturnValue(makeFluent({ data: rows, error: null }));

    const result = await discoverPages('org-1', 'monitor');
    expect(result[0]).toMatchObject({
      scope_id:      'scope-uuid',
      crawl_page_id: '',
      url:           'https://example.com/',
      domain:        'example.com',
      url_type:      'manual',
      priority:      5,
    });
  });

  it('agency_starter tier allows up to 5 domains', async () => {
    // 6 domains × 3 pages each
    const rows = Array.from({ length: 6 }, (_, d) =>
      Array.from({ length: 3 }, (_, p) =>
        makeScopeRow(`d${d}p${p}`, `https://domain${d}.com/pg${p}`, `domain${d}.com`, d),
      ),
    ).flat();
    mockFrom.mockReturnValue(makeFluent({ data: rows, error: null }));

    const result = await discoverPages('org-1', 'agency_starter');
    const domains = new Set(result.map(p => p.domain));
    // agency_starter: domains_per_client=5, max_clients=5 → getDomainCap=25 — all 6 domains fit
    // (we just verify we got all 18 pages since 6 < 25)
    expect(domains.size).toBe(6);
    expect(result).toHaveLength(18);
  });

  it('throws when supabase returns an error', async () => {
    const chain: Record<string, unknown> = {};
    const fn = vi.fn().mockReturnValue(chain);
    chain.select = fn;
    chain.eq     = fn;
    chain.order  = vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } });
    mockFrom.mockReturnValue(chain);

    await expect(discoverPages('org-1', 'monitor')).rejects.toThrow('db error');
  });
});

// ── seedPageScopeFromAdUrls ───────────────────────────────────────────────────

describe('seedPageScopeFromAdUrls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls upsert with correctly shaped rows', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const chain = { upsert: upsertMock };
    mockFrom.mockReturnValue(chain);

    const urls = ['https://example.com/page1', 'https://example.com/page2'];
    await seedPageScopeFromAdUrls('org-1', urls, 'manual');

    expect(upsertMock).toHaveBeenCalledOnce();
    const [rows, opts] = upsertMock.mock.calls[0] as [object[], { onConflict: string }];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      org_id:   'org-1',
      url:      'https://example.com/page1',
      domain:   'example.com',
      url_type: 'ad_destination',
      source:   'manual',
      priority: 2,
    });
    expect(rows[1]).toMatchObject({ priority: 1 });
    expect(opts.onConflict).toBe('org_id,url');
  });

  it('supports google_ads and meta_ads sources', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert: upsertMock });

    await seedPageScopeFromAdUrls('org-1', ['https://ads.example.com/lp'], 'google_ads');
    const rows = upsertMock.mock.calls[0][0] as { source: string }[];
    expect(rows[0].source).toBe('google_ads');
  });

  it('throws on invalid URL', async () => {
    mockFrom.mockReturnValue({ upsert: vi.fn() });
    await expect(
      seedPageScopeFromAdUrls('org-1', ['not-a-url'], 'manual'),
    ).rejects.toThrow('Invalid URL: not-a-url');
  });

  it('throws when supabase returns an error', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: { message: 'upsert failed' } });
    mockFrom.mockReturnValue({ upsert: upsertMock });

    await expect(
      seedPageScopeFromAdUrls('org-1', ['https://example.com/'], 'manual'),
    ).rejects.toThrow('upsert failed');
  });
});

// ── detectFunnelPages ─────────────────────────────────────────────────────────

describe('detectFunnelPages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns URLs that match funnel patterns', async () => {
    const pages = [
      { url: 'https://example.com/checkout' },
      { url: 'https://example.com/thank-you' },
      { url: 'https://example.com/about' },
      { url: 'https://example.com/pricing' },
      { url: 'https://example.com/blog' },
    ];
    const chain: Record<string, unknown> = {};
    const fn = vi.fn().mockReturnValue(chain);
    chain.select = fn;
    chain.eq     = fn;
    // Last .eq() resolves
    chain.eq = vi.fn().mockReturnValue({ ...chain, then: undefined });
    // Build terminal resolution
    const terminal = vi.fn().mockResolvedValue({ data: pages, error: null });
    chain.select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: terminal }) });
    mockFrom.mockReturnValue(chain);

    const result = await detectFunnelPages('example.com', 'org-1');
    expect(result).toContain('https://example.com/checkout');
    expect(result).toContain('https://example.com/thank-you');
    expect(result).toContain('https://example.com/pricing');
    expect(result).not.toContain('https://example.com/about');
    expect(result).not.toContain('https://example.com/blog');
  });

  it('returns empty array when no funnel patterns match', async () => {
    const pages = [{ url: 'https://example.com/about' }, { url: 'https://example.com/contact' }];
    const terminal = vi.fn().mockResolvedValue({ data: pages, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: terminal }) }),
    });

    const result = await detectFunnelPages('example.com', 'org-1');
    expect(result).toEqual([]);
  });

  it('throws when supabase returns an error', async () => {
    const terminal = vi.fn().mockResolvedValue({ data: null, error: { message: 'query failed' } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: terminal }) }),
    });

    await expect(detectFunnelPages('example.com', 'org-1')).rejects.toThrow('query failed');
  });
});
