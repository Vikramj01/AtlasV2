/**
 * Unit tests for stepUrlResolver.ts (Site Evaluation Coverage & Honesty PRD
 * §7, Phase 2). global.fetch is stubbed per test — no network or browser
 * required, same convention as journeySimulator.test.ts's
 * probeDomainReachable tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveStepUrls } from '../stepUrlResolver';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ECOMMERCE_STEP_KEYS = ['landing', 'product', 'checkout', 'confirmation'];

/** Maps an exact URL to a canned response; anything unmapped 404s. HEAD and GET share the same map — tests only care about status/body per URL. */
function makeFetchMock(routes: Record<string, { ok: boolean; text?: string }>) {
  return vi.fn().mockImplementation(async (url: string) => {
    const route = routes[url];
    if (!route) return { ok: false, status: 404, text: async () => '' };
    return { ok: route.ok, status: route.ok ? 200 : 404, text: async () => route.text ?? '' };
  });
}

describe('resolveStepUrls', () => {
  it('returns nothing when every step key already has a user-supplied URL', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: {
        landing: 'https://shop.example.com',
        product: 'https://shop.example.com/product/widget',
        checkout: 'https://shop.example.com/checkout',
        confirmation: 'https://shop.example.com/order-confirmed',
      },
    });
    expect(resolved).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never overrides a user-supplied entry — only fills gaps', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: true, text: 'Sitemap: https://shop.example.com/sitemap.xml' },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        text: '<urlset><url><loc>https://shop.example.com/checkout</loc></url></urlset>',
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: { landing: 'https://shop.example.com', product: 'https://shop.example.com/already-set' },
    });
    expect(resolved.product).toBeUndefined(); // 'product' had a user-supplied URL — never touched
    expect(resolved.checkout?.url).toBe('https://shop.example.com/checkout');
  });

  it('resolves via robots.txt → sitemap.xml when both point to real, scoreable pages', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: true, text: 'Sitemap: https://shop.example.com/my-sitemap.xml' },
      'https://shop.example.com/my-sitemap.xml': {
        ok: true,
        text: `<urlset>
          <url><loc>https://shop.example.com/product/widget</loc></url>
          <url><loc>https://shop.example.com/checkout</loc></url>
          <url><loc>https://shop.example.com/order-confirmation</loc></url>
          <url><loc>https://shop.example.com/about-us</loc></url>
        </urlset>`,
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: { landing: 'https://shop.example.com' },
    });
    expect(resolved.product?.url).toBe('https://shop.example.com/product/widget');
    expect(resolved.product?.source).toBe('sitemap');
    expect(resolved.checkout?.url).toBe('https://shop.example.com/checkout');
    expect(resolved.confirmation?.url).toBe('https://shop.example.com/order-confirmation');
  });

  it('falls back to /sitemap.xml directly when robots.txt has no Sitemap: line', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: true, text: 'User-agent: *\nDisallow: /admin' },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        text: '<urlset><url><loc>https://shop.example.com/checkout</loc></url></urlset>',
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'checkout'],
      url_map: {},
    });
    expect(resolved.checkout?.url).toBe('https://shop.example.com/checkout');
    expect(resolved.checkout?.source).toBe('sitemap');
  });

  it('recurses exactly one level into a sitemap index', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        text: `<sitemapindex>
          <sitemap><loc>https://shop.example.com/sitemap-products.xml</loc></sitemap>
        </sitemapindex>`,
      },
      'https://shop.example.com/sitemap-products.xml': {
        ok: true,
        text: '<urlset><url><loc>https://shop.example.com/product/widget</loc></url></urlset>',
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'product'],
      url_map: {},
    });
    expect(resolved.product?.url).toBe('https://shop.example.com/product/widget');
    expect(resolved.product?.source).toBe('sitemap');
  });

  it('falls back to landing-page link harvest when no sitemap exists', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': { ok: false },
      'https://shop.example.com': {
        ok: true,
        text: `<html><body>
          <a href="/product/widget">Shop now</a>
          <a href="https://shop.example.com/checkout">Checkout</a>
          <a href="https://other-site.com/checkout">Unrelated</a>
        </body></html>`,
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: { landing: 'https://shop.example.com' },
    });
    expect(resolved.product?.url).toBe('https://shop.example.com/product/widget');
    expect(resolved.product?.source).toBe('nav_link');
    expect(resolved.checkout?.url).toBe('https://shop.example.com/checkout');
    // confirmation was never linked from the landing page and has no path-heuristic hit either — stays unresolved.
    expect(resolved.confirmation).toBeUndefined();
  });

  it('falls back to HEAD-verified path heuristics when neither sitemap nor landing links resolve a key', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': { ok: false },
      'https://shop.example.com': { ok: true, text: '<html><body>No useful links here</body></html>' },
      'https://shop.example.com/checkout': { ok: true },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'checkout'],
      url_map: {},
    });
    expect(resolved.checkout?.url).toBe('https://shop.example.com/checkout');
    expect(resolved.checkout?.source).toBe('heuristic');
  });

  it('leaves a key unresolved (not a throw) when every strategy fails to find it', async () => {
    vi.stubGlobal('fetch', makeFetchMock({}));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: {},
    });
    expect(resolved).toEqual({});
  });

  it('short-circuits — does not call fetch for later strategies once every key is resolved', async () => {
    const fetchMock = makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: true, text: 'Sitemap: https://shop.example.com/sitemap.xml' },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        text: '<urlset><url><loc>https://shop.example.com/checkout</loc></url></urlset>',
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'checkout'],
      url_map: {},
    });
    // Only robots.txt + sitemap.xml — never reached the landing-page fetch (strategy 3) or any heuristic HEAD (strategy 4).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── Cross-origin filtering ────────────────────────────────────────────────

  it('ignores a cross-origin sitemap entry unless it matches a declared product_domain/checkout_domain', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        text: '<urlset><url><loc>https://evil-other-site.com/checkout</loc></url></urlset>',
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'checkout'],
      url_map: {},
    });
    expect(resolved.checkout).toBeUndefined();
  });

  it('accepts a cross-origin candidate when it matches the declared checkout_domain', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        text: '<urlset><url><loc>https://checkout.stripe-hosted.com/checkout</loc></url></urlset>',
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'checkout'],
      url_map: {},
      checkout_domain: 'https://checkout.stripe-hosted.com',
    });
    expect(resolved.checkout?.url).toBe('https://checkout.stripe-hosted.com/checkout');
  });

  // ── SSRF ────────────────────────────────────────────────────────────────────

  it('never fetches when website_url itself fails SSRF validation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const resolved = await resolveStepUrls({
      website_url: 'http://localhost:9000',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: {},
    });
    expect(resolved).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a candidate targeting a private/internal host even when it matches a declared domain (SSRF check runs independently of the cross-origin allowlist)', async () => {
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': {
        ok: true,
        // 169.254.169.254 (cloud metadata endpoint) matches the declared
        // checkout_domain below by hostname, so the cross-origin allowlist
        // alone would accept it — SSRF validation must still reject it.
        text: '<urlset><url><loc>http://169.254.169.254/checkout</loc></url></urlset>',
      },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ['landing', 'checkout'],
      url_map: {},
      checkout_domain: 'http://169.254.169.254',
    });
    expect(resolved.checkout).toBeUndefined();
  });

  // ── Budget ──────────────────────────────────────────────────────────────────

  it('returns partial results without hanging when the fetch budget is exhausted', async () => {
    // Every fetch resolves instantly but never matches anything scoreable —
    // this proves the resolver terminates (doesn't hang) and returns
    // whatever it has, not that it literally times out at 15s (this test
    // would be far too slow for that).
    vi.stubGlobal('fetch', makeFetchMock({
      'https://shop.example.com/robots.txt': { ok: false },
      'https://shop.example.com/sitemap.xml': { ok: false },
      'https://shop.example.com': { ok: true, text: '<html><body>no links</body></html>' },
    }));
    const resolved = await resolveStepUrls({
      website_url: 'https://shop.example.com',
      step_keys: ECOMMERCE_STEP_KEYS,
      url_map: {},
    });
    expect(resolved).toEqual({});
  });
});
