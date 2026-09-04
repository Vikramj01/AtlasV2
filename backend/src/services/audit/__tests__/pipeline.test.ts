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
import { runRegister } from '@/services/validation/register/engine';
import { calculateV2Scores } from '@/services/validation/register/scoring';

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

// ─── step_coverage (Site Evaluation Coverage & Honesty PRD, Phase 1) ─────────

describe('simulateJourney — step_coverage', () => {
  it('marks every step user_supplied and distinct from landing when url_map gives each a real, different URL', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);

    expect(auditData.step_coverage).toHaveLength(4);
    const [landing, product, checkout, confirmation] = auditData.step_coverage!;

    expect(landing.step).toBe('landing');
    expect(landing.source).toBe('user_supplied');
    expect(landing.distinct_from_landing).toBe(false); // never distinct from itself
    expect(landing.navigation_success).toBe(true);

    for (const step of [product, checkout, confirmation]) {
      expect(step.source).toBe('user_supplied');
      expect(step.distinct_from_landing).toBe(true);
      expect(step.navigation_success).toBe(true);
    }
  });

  it('marks a step fallback_landing and NOT distinct when url_map omits its key entirely', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      url_map: { landing: 'https://shop.example.com' }, // product/checkout/confirmation all fall back
    });

    const nonLanding = auditData.step_coverage!.filter((s) => s.step !== 'landing');
    expect(nonLanding).toHaveLength(3);
    for (const step of nonLanding) {
      expect(step.source).toBe('fallback_landing');
      expect(step.distinct_from_landing).toBe(false);
    }
  });

  it('marks every step NOT distinct when url_map points every key at the same homepage URL (the defect this PRD exists to fix)', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      url_map: {
        landing: 'https://shop.example.com',
        product: 'https://shop.example.com',
        checkout: 'https://shop.example.com',
        confirmation: 'https://shop.example.com',
      },
    });

    // These are 'user_supplied' — the URL was explicitly given — but still
    // not distinct, because it's the same page as landing. source and
    // distinct_from_landing are independent signals.
    const nonLanding = auditData.step_coverage!.filter((s) => s.step !== 'landing');
    expect(nonLanding.every((s) => s.source === 'user_supplied')).toBe(true);
    expect(nonLanding.every((s) => s.distinct_from_landing === false)).toBe(true);
  });

  it('a step whose navigation fails entirely does not abort the other steps (defect #1)', async () => {
    const { mockBrowser, mockPage } = makeMockBrowser();
    mockPage.goto.mockImplementation(async (url: string) => {
      if (url.includes('order-confirmed')) {
        throw new Error('net::ERR_NAME_NOT_RESOLVED');
      }
      return null;
    });

    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);

    // landing, product, checkout each navigate once; confirmation is tried
    // twice (primary + domcontentloaded fallback), both of which fail.
    expect(mockPage.goto).toHaveBeenCalledTimes(5);

    const coverage = auditData.step_coverage!;
    expect(coverage).toHaveLength(4);

    const confirmation = coverage.find((s) => s.step === 'confirmation')!;
    expect(confirmation.navigation_success).toBe(false);
    expect(confirmation.error).toBeTruthy();

    const otherSteps = coverage.filter((s) => s.step !== 'confirmation');
    expect(otherSteps.every((s) => s.navigation_success)).toBe(true);
  });

  // ── resolved_sources (Phase 2, §7/§8) ─────────────────────────────────────
  // The orchestrator merges stepUrlResolver.ts's discovered URLs directly
  // into url_map before calling simulateJourney, so a url_map entry alone
  // can't distinguish "the user gave us this" from "the resolver found
  // this." resolved_sources is what carries that distinction through.

  it('reports the resolver\'s source (sitemap/nav_link/heuristic) for a url_map entry it filled, not user_supplied', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      url_map: {
        landing: 'https://shop.example.com',
        product: 'https://shop.example.com/product/widget', // genuinely user-supplied
        checkout: 'https://shop.example.com/checkout',       // resolver-filled
        confirmation: 'https://shop.example.com/order-confirmed', // resolver-filled
      },
      resolved_sources: {
        checkout: 'sitemap',
        confirmation: 'heuristic',
      },
    });

    const byStep = new Map(auditData.step_coverage!.map((s) => [s.step, s]));
    expect(byStep.get('landing')?.source).toBe('user_supplied');
    expect(byStep.get('product')?.source).toBe('user_supplied');
    expect(byStep.get('checkout')?.source).toBe('sitemap');
    expect(byStep.get('confirmation')?.source).toBe('heuristic');
  });

  it('ignores a resolved_sources entry for a step key that has no url_map entry at all (nothing to mislabel)', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      url_map: { landing: 'https://shop.example.com' }, // product/checkout/confirmation all absent
      resolved_sources: { product: 'sitemap' }, // stale/inconsistent — resolver claims a source but url_map disagrees
    });

    const product = auditData.step_coverage!.find((s) => s.step === 'product')!;
    // Absence from url_map wins — still falls back to landing, not "sitemap".
    expect(product.source).toBe('fallback_landing');
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
    expect(scores.conversion_signal_health).toBeGreaterThan(50);
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

  it('returns all 43 results regardless of captured data', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, BASE_OPTS);
    const results = runAllRules(auditData);
    expect(results).toHaveLength(43);
  });
});

// ─── consent_capture (Site Evaluation Coverage & Honesty PRD §6.5) ──────────
//
// makeMockBrowser's generic evaluate() mock (drains dataLayerEvents
// regardless of which call site invoked it) can't distinguish a consent
// detection/dismissal call from any other evaluate() call, so this uses a
// purpose-built mock that inspects the second argument — only
// consentBanner.ts's functions ever call page.evaluate(fn, arg) with an arg
// in this codebase, so an arg carrying `.selectors` unambiguously identifies
// a consent-related call.

function makeConsentAwareMockBrowser() {
  const pageListeners: Record<string, Array<(arg: unknown) => void>> = {};
  let consentEvaluateCalls = 0;

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
    goto: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockImplementation(async (_fn: unknown, arg?: unknown) => {
      if (arg && typeof arg === 'object' && 'selectors' in (arg as object)) {
        consentEvaluateCalls += 1;
        if (consentEvaluateCalls === 1) {
          // detectConsentBanner's call
          return { present: true, vendor: 'onetrust', selector: '#onetrust-accept-btn-handler' };
        }
        // dismissConsentBanner's call — simulate the click causing a
        // previously-gated Google Ads tag to fire for the first time.
        const fakeReq = {
          url: () => 'https://www.googleadservices.com/pagead/conversion/123',
          method: () => 'GET',
          headers: () => ({}),
          postData: () => null,
        };
        (pageListeners['request'] ?? []).forEach((h) => h(fakeReq));
        return true;
      }
      return []; // dataLayer flush / script-src collection / localStorage — not under test here
    }),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    cookies: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = { newContext: vi.fn().mockResolvedValue(mockContext) };
  return { mockBrowser, mockPage };
}

describe('simulateJourney — consent_capture', () => {
  it('records the detected vendor/dismissal outcome, and a tag gated behind the banner appears in tags_after but not tags_before', async () => {
    const { mockBrowser } = makeConsentAwareMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, {
      ...BASE_OPTS,
      declared_platforms: ['google_ads'],
      cmp: 'onetrust',
    });

    expect(auditData.consent_capture).toBeDefined();
    expect(auditData.consent_capture?.banner_present).toBe(true);
    expect(auditData.consent_capture?.vendor).toBe('onetrust');
    expect(auditData.consent_capture?.dismissed).toBe(true);
    expect(auditData.consent_capture?.declared_cmp).toBe('onetrust');
    expect(auditData.consent_capture?.tags_before).not.toContain('google_ads');
    expect(auditData.consent_capture?.tags_after).toContain('google_ads');
  });

  it('reports no banner and empty tags_before/tags_after when nothing was ever detected or fired', async () => {
    const { mockBrowser, mockPage } = makeConsentAwareMockBrowser();
    // Override: neither detect nor dismiss finds anything, and dismiss never fires a network request.
    let consentCalls = 0;
    mockPage.evaluate.mockImplementation(async (_fn: unknown, arg?: unknown) => {
      if (arg && typeof arg === 'object' && 'selectors' in (arg as object)) {
        consentCalls += 1;
        return consentCalls === 1 ? { present: false } : false;
      }
      return [];
    });

    const auditData = await simulateJourney(mockBrowser as never, { ...BASE_OPTS, declared_platforms: ['google_ads'] });

    expect(auditData.consent_capture?.banner_present).toBe(false);
    expect(auditData.consent_capture?.dismissed).toBe(false);
    expect(auditData.consent_capture?.tags_before).toEqual([]);
    expect(auditData.consent_capture?.tags_after).toEqual([]);
  });
});

// ─── Full v2 pipeline: step_coverage → runRegister precondition gating ──────
//
// Site Evaluation Coverage & Honesty PRD, Phase 1 (§13 test plan): a
// homepage-only scan must skip every conversion_surface-gated rule rather
// than fail it, and a scan reaching real distinct pages must skip none of
// them. Unlike the v1 pipeline above, this exercises the Check Register v2
// path (runRegister/calculateV2Scores) end-to-end from simulateJourney's
// real step_coverage output — not a hand-built AuditData fixture.

const V2_BASE_OPTS: SimulatorOptions = {
  ...BASE_OPTS,
  site_type: 'ecommerce',
  rule_set_version: 'v2',
  declared_platforms: ['google_ads'],
  primary_channel: 'google_ads',
  traffic_regions: ['us'],
  declared_conversions: [{ name: 'purchase', kind: 'primary' }],
};

/** Rules skipped specifically by the new precondition engine — not a rule that self-skips for an unrelated reason (e.g. no product_domain declared). */
function skippedForConversionSurface(results: ReturnType<typeof runRegister>) {
  return results.filter(
    (r) => r.status === 'skipped' && r.technical_details.found.startsWith('Not tested — the crawl never reached'),
  );
}

describe('Full v2 pipeline — step_coverage → runRegister precondition gating', () => {
  it('a homepage-only scan yields L0.3 fail and skips (not fails) every conversion_surface-gated rule', async () => {
    const { mockBrowser } = makeMockBrowser();
    const auditData = await simulateJourney(mockBrowser as never, {
      ...V2_BASE_OPTS,
      url_map: { landing: 'https://shop.example.com' }, // product/checkout/confirmation all fall back to it
    });

    expect(auditData.step_coverage?.some((s) => s.distinct_from_landing)).toBe(false);

    const results = runRegister(auditData);
    expect(results.find((r) => r.rule_id === 'CONVERSION_SURFACE_IDENTIFIED')?.status).toBe('fail');

    const skipped = skippedForConversionSurface(results);
    // L4.3, L4.4, all of L5 (12), L6 (10), L7 (10) that are applicable to an
    // ecommerce/google_ads audit — a large majority of the register, per the
    // PRD's own "~42 skipped" estimate for a homepage-only ecommerce scan.
    expect(skipped.length).toBeGreaterThanOrEqual(25);

    // scoring.ts's scored() excludes 'skipped' from every denominator — this
    // is the observable effect: far fewer rules count toward the score.
    const scoredCount = results.filter((r) => r.status !== 'skipped').length;
    expect(scoredCount).toBeLessThan(results.length - 20);
    expect(() => calculateV2Scores(results)).not.toThrow();
  });

  it('a scan reaching real, distinct step URLs yields L0.3 pass and zero precondition-driven skips', async () => {
    const { mockBrowser } = makeMockBrowser();
    // V2_BASE_OPTS inherits BASE_OPTS's url_map, which already gives product/checkout/confirmation distinct paths.
    const auditData = await simulateJourney(mockBrowser as never, V2_BASE_OPTS);

    expect(auditData.step_coverage?.filter((s) => s.distinct_from_landing).length).toBe(3);

    const results = runRegister(auditData);
    expect(results.find((r) => r.rule_id === 'CONVERSION_SURFACE_IDENTIFIED')?.status).toBe('pass');
    expect(skippedForConversionSurface(results)).toHaveLength(0);
  });
});
