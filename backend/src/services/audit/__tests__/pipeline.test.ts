/**
 * Audit pipeline integration tests.
 *
 * Tests the full data flow:
 *   mock Playwright browser → simulateJourney → runAllRules → calculateScores
 *
 * No real browser or network connections are used — all Playwright objects are
 * mocked inline with the exact method signatures that dataCapture.ts expects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simulateJourney, type SimulatorOptions } from '../journeySimulator';
import { runAllRules } from '@/services/validation/engine';
import { calculateScores } from '@/services/scoring/engine';

// ─── Mock browser factory ─────────────────────────────────────────────────────

/**
 * Creates a fake Playwright browser that:
 * - Collects addInitScript calls (dataLayer instrumentation)
 * - Emits configurable fake dataLayer and network events
 * - Returns configurable cookies and localStorage
 */
function makeMockBrowser(opts: {
  dataLayerEvents?: object[];
  networkRequests?: Array<{ url: string; method?: string; body?: string | null }>;
  cookies?: Array<{ name: string; value: string }>;
  localStorage?: Record<string, string>;
} = {}) {
  const {
    dataLayerEvents = [],
    networkRequests: fakeRequests = [],
    cookies: fakeCookies = [],
    localStorage: fakeLocalStorage = {},
  } = opts;

  // Collect registered page listeners
  const pageListeners: Record<string, Array<(arg: unknown) => void>> = {};

  const mockPage = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    exposeFunction: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),

    on(event: string, handler: (arg: unknown) => void) {
      pageListeners[event] = pageListeners[event] ?? [];
      pageListeners[event].push(handler);
    },

    goto: vi.fn().mockImplementation(async () => {
      // Emit fake network requests to registered 'request' listeners
      for (const req of fakeRequests) {
        const fakeReq = {
          url: () => req.url,
          method: () => req.method ?? 'POST',
          headers: () => ({}),
          postData: () => req.body ?? null,
        };
        (pageListeners['request'] ?? []).forEach((h) => h(fakeReq));

        // Emit matching response with a timing
        const fakeRes = {
          url: () => req.url,
          request: () => ({
            timing: () => ({ startTime: 0, responseEnd: 300 }),
          }),
        };
        (pageListeners['response'] ?? []).forEach((h) => h(fakeRes));
      }
      return null;
    }),

    evaluate: vi.fn().mockImplementation(async (fn: (() => unknown) | string) => {
      // flushDataLayer calls evaluate to read window.__atlasDataLayerSink
      // We return the fake events on the first call, then [] on subsequent ones
      if (typeof fn === 'function') {
        const result = [...dataLayerEvents];
        dataLayerEvents.length = 0; // drain after first flush
        return result;
      }
      return fakeLocalStorage;
    }),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    cookies: vi.fn().mockResolvedValue(fakeCookies),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
  };

  return { mockBrowser, mockPage, mockContext };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const BASE_OPTS: SimulatorOptions = {
  audit_id: 'test-audit-001',
  website_url: 'https://shop.example.com',
  funnel_type: 'ecommerce',
  region: 'us',
  url_map: {
    landing: 'https://shop.example.com',
    product: 'https://shop.example.com/product/widget',
    checkout: 'https://shop.example.com/checkout',
    confirmation: 'https://shop.example.com/order-confirmed',
  },
  test_email: 'test@example.com',
  test_phone: '15551234567',
};

const PURCHASE_EVENT = {
  event: 'purchase',
  __timestamp: Date.now(),
  transaction_id: 'ORDER-789',
  value: 129.99,
  currency: 'USD',
  coupon: 'TEST10',
  shipping: 9.99,
  items: [{ id: 'SKU-42', name: 'Widget Pro', price: 129.99, quantity: 1 }],
  user_id: 'usr_abc123',
  event_id: 'evt_xyz789',
  gclid: 'test_gclid_LANDING',
  user_data: {
    email: 'a'.repeat(64),   // 64-char hex SHA256-like
    phone: 'b'.repeat(64),
  },
};

// ─── simulateJourney unit tests ───────────────────────────────────────────────

describe('simulateJourney — AuditData assembly', () => {
  it('returns an AuditData with the correct audit_id and website_url', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(auditData.audit_id).toBe('test-audit-001');
    expect(auditData.website_url).toBe('https://shop.example.com');
    expect(auditData.funnel_type).toBe('ecommerce');
  });

  it('injects gclid and fbclid into the landing URL', async () => {
    const { mockBrowser, mockPage } = makeMockBrowser();
    await simulateJourney(mockBrowser as never, BASE_OPTS);

    // goto should have been called with a URL containing both click IDs on landing
    const firstCall = mockPage.goto.mock.calls[0][0] as string;
    expect(firstCall).toContain('gclid=test_gclid_');
    expect(firstCall).toContain('fbclid=test_fbclid_');
  });

  it('does NOT inject click IDs on non-landing steps', async () => {
    const { mockBrowser, mockPage } = makeMockBrowser();
    await simulateJourney(mockBrowser as never, BASE_OPTS);

    // calls[1] = product, calls[2] = checkout, calls[3] = confirmation
    for (const callIndex of [1, 2, 3]) {
      const url = mockPage.goto.mock.calls[callIndex]?.[0] as string | undefined;
      if (url) {
        expect(url).not.toContain('gclid=');
      }
    }
  });

  it('populates urlParams with injected click IDs', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(auditData.urlParams?.['gclid']).toMatch(/^test_gclid_/);
    expect(auditData.urlParams?.['fbclid']).toMatch(/^test_fbclid_/);
  });

  it('captures cookies from context', async () => {
    const { mockBrowser } = makeMockBrowser({
      cookies: [
        { name: '_fbp', value: 'fb.1.123456.789' },
        { name: '_fbc', value: 'fb.1.123456.abc' },
      ],
    });
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(auditData.cookies?.['_fbp']).toBe('fb.1.123456.789');
    expect(auditData.cookies?.['_fbc']).toBe('fb.1.123456.abc');
  });

  it('captures dataLayer events flushed on each step', async () => {
    const { mockBrowser } = makeMockBrowser({
      dataLayerEvents: [
        { event: 'page_view', __timestamp: Date.now() },
        { event: 'purchase', __timestamp: Date.now(), transaction_id: 'ORDER-1', value: 50, currency: 'USD' },
      ],
    });
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(auditData.dataLayer.some((e) => e.event === 'page_view')).toBe(true);
  });

  it('captures network request body (POST body fix)', async () => {
    const { mockBrowser } = makeMockBrowser({
      networkRequests: [
        {
          url: 'https://www.facebook.com/tr/',
          method: 'POST',
          body: 'ev=Purchase&cd[value]=99.99&cd[currency]=USD',
        },
      ],
    });
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    const metaReq = auditData.networkRequests.find((r) => r.url.includes('facebook.com'));
    expect(metaReq).toBeDefined();
    expect(metaReq?.body).toContain('ev=Purchase');
  });

  it('captures network request step correctly (not stuck at init)', async () => {
    const { mockBrowser } = makeMockBrowser({
      networkRequests: [
        { url: 'https://analytics.google.com/g/collect', method: 'POST', body: 'en=purchase' },
      ],
    });
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    // The request was emitted during the goto call — step should be the current step, not 'init'
    const ga4Req = auditData.networkRequests.find((r) => r.url.includes('analytics.google.com'));
    expect(ga4Req?.step).not.toBe('init');
  });

  it('sets injected.gclid and injected.fbclid', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(auditData.injected.gclid).toMatch(/^test_gclid_/);
    expect(auditData.injected.fbclid).toMatch(/^test_fbclid_/);
  });

  it('closes the browser context on completion', async () => {
    const { mockBrowser, mockContext } = makeMockBrowser();
    await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(mockContext.close).toHaveBeenCalledOnce();
  });

  it('closes the browser context even when goto throws', async () => {
    const { mockBrowser, mockContext, mockPage } = makeMockBrowser();
    mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));
    // Should not throw — goto failure falls back to domcontentloaded
    mockPage.goto.mockResolvedValue(null); // second call succeeds
    await simulateJourney(mockBrowser as never, BASE_OPTS);
    expect(mockContext.close).toHaveBeenCalledOnce();
  });

  it('works with saas funnel type (3 steps)', async () => {
    const { mockBrowser, mockPage } = makeMockBrowser();
    await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      funnel_type: 'saas',
      url_map: {
        landing: 'https://app.example.com',
        signup: 'https://app.example.com/signup',
        onboarding: 'https://app.example.com/welcome',
      },
    });
    // saas has 3 steps: landing, signup, onboarding
    expect(mockPage.goto).toHaveBeenCalledTimes(3);
  });

  it('works with lead_gen funnel type (2 steps)', async () => {
    const { mockBrowser, mockPage } = makeMockBrowser();
    await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      funnel_type: 'lead_gen',
      url_map: {
        landing: 'https://lead.example.com',
        thank_you: 'https://lead.example.com/thank-you',
      },
    });
    expect(mockPage.goto).toHaveBeenCalledTimes(2);
  });
});

// ─── Full pipeline: simulate → validate → score ───────────────────────────────

describe('Full pipeline — mock browser → validation → scoring', () => {
  it('produces passing rules for a well-instrumented site', async () => {
    const gclid = 'test_gclid_PIPELINE';

    const { mockBrowser } = makeMockBrowser({
      dataLayerEvents: [
        { event: 'page_view', __timestamp: Date.now() },
        { event: 'add_to_cart', __timestamp: Date.now() },
        {
          ...PURCHASE_EVENT,
          gclid,
          event_id: 'evt_pipeline_001',
        },
      ],
      networkRequests: [
        { url: 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST', method: 'GET' },
        { url: 'https://analytics.google.com/g/collect', method: 'POST', body: 'en=purchase&epn.transaction_id=ORDER-789' },
        { url: 'https://www.facebook.com/tr/', method: 'POST', body: 'ev=Purchase&cd[value]=129.99' },
        { url: 'https://www.google.com/pagead/1p-conversion/', method: 'POST', body: 'conversion=1' },
        { url: 'https://sgtm.example.com/collect', method: 'POST', body: JSON.stringify({ event_id: 'evt_pipeline_001' }) },
      ],
      cookies: [
        { name: '_fbp', value: 'fb.1.123456.789' },
        { name: '_fbc', value: 'fb.1.123456.fbcid' },
      ],
    });

    const auditData = await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      url_map: {
        ...BASE_OPTS.url_map,
        landing: `https://shop.example.com?gclid=${gclid}`,
      },
    });

    // Simulate Meta Pixel detection on landing
    (auditData.pageMetadata as Record<string, unknown>)['pixel_fbclid'] = true;

    const results = runAllRules(auditData);
    const scores = calculateScores(results);

    // At least the signal initiation layer should pass (all 3 platform events present)
    const ga4 = results.find((r) => r.rule_id === 'GA4_PURCHASE_EVENT_FIRED');
    const meta = results.find((r) => r.rule_id === 'META_PIXEL_PURCHASE_EVENT_FIRED');
    const gads = results.find((r) => r.rule_id === 'GOOGLE_ADS_CONVERSION_EVENT_FIRED');
    const gtm  = results.find((r) => r.rule_id === 'GTM_CONTAINER_LOADED');

    expect(ga4?.status).toBe('pass');
    expect(meta?.status).toBe('pass');
    expect(gads?.status).toBe('pass');
    expect(gtm?.status).toBe('pass');

    // Scores should reflect healthy state
    expect(scores.conversion_signal_health).toBeGreaterThan(60);
    expect(scores.attribution_risk_level).not.toBe('Critical');
  });

  it('produces failing rules for a site with no tracking', async () => {
    const { mockBrowser } = makeMockBrowser(); // no events, no requests
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    const results = runAllRules(auditData);
    const scores = calculateScores(results);

    const failures = results.filter((r) => r.status === 'fail');
    expect(failures.length).toBeGreaterThanOrEqual(10);
    expect(scores.conversion_signal_health).toBeLessThan(50);
    // simulateJourney always injects gclid+fbclid into urlParams, so those two
    // attribution rules pass; only TRANSACTION_ID_PRESENT fails → 'Medium'
    expect(scores.attribution_risk_level).not.toBe('Low');
  });

  it('correctly identifies meta body content from POST body', async () => {
    const { mockBrowser } = makeMockBrowser({
      networkRequests: [
        {
          url: 'https://www.facebook.com/tr/',
          method: 'POST',
          body: 'ev=Purchase&cd[currency]=USD',
        },
      ],
    });
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    const results = runAllRules(auditData);
    const metaRule = results.find((r) => r.rule_id === 'META_PIXEL_PURCHASE_EVENT_FIRED');
    expect(metaRule?.status).toBe('pass');
  });

  it('returns all 26 results regardless of captured data', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    const results = runAllRules(auditData);
    expect(results).toHaveLength(26);
  });
});
