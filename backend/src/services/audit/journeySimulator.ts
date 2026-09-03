/**
 * Journey Simulator
 * Drives a Playwright browser through a multi-step user journey and
 * assembles the raw AuditData needed for validation.
 */
import type { AuditData, FunnelType, Region, DataLayerEvent, NetworkRequest, CookieSnapshot, LocalStorageSnapshot } from '@/types/audit';
import { JOURNEY_CONFIGS } from '@/services/browserbase/journeyConfigs';
import {
  instrumentDataLayer,
  flushDataLayer,
  interceptNetworkRequests,
  captureCookies,
  captureLocalStorage,
  captureSessionStorage,
  mergeCookies,
  mergeLocalStorage,
  mergeDetailedCookies,
  type StepRef,
} from './dataCapture';
import { extractGa4ClientId, ga4SessionStartDetected } from '@/services/detection/trackingSignals';
import logger from '@/utils/logger';

/**
 * Synthetic click IDs + UTM params injected on landing — lets validation
 * rules check whether the site actually captures/stores an identifier we
 * know we sent, rather than just observing whatever real traffic happened
 * to arrive with. Covers every platform Check Register v2's L2 (Click ID
 * Capture) layer checks, not just gclid/fbclid.
 */
function makeSyntheticIds() {
  const ts = Date.now();
  return {
    gclid:       `test_gclid_${ts}`,
    fbclid:      `test_fbclid_${ts}`,
    gbraid:      `test_gbraid_${ts}`,
    wbraid:      `test_wbraid_${ts}`,
    ttclid:      `test_ttclid_${ts}`,
    li_fat_id:   `test_lifatid_${ts}`,
    msclkid:     `test_msclkid_${ts}`,
    utm_source:  'atlas_audit',
    utm_medium:  'cpc',
    utm_campaign: `atlas_audit_${ts}`,
    utm_content: 'atlas_test_content',
    utm_term:    'atlas_test_term',
  };
}

/** Append every synthetic click ID / UTM param onto a URL string. */
function injectSyntheticParams(url: string, params: Record<string, string | undefined>): string {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) u.searchParams.set(key, value);
  }
  return u.toString();
}

/** Referer header set on the landing navigation — simulates arriving via an ad click, for L2.11. */
const LANDING_REFERRER = 'https://www.google.com/';

export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * Scans the landing page's <a href> tags for links to the declared product/
 * checkout domain and checks how many carry GA4's `_gl` cross-domain linker
 * parameter — the transport mechanism CROSS_DOMAIN_LINKER_CONFIGURED (L4.1)
 * and _GL_PARAMETER_APPENDED_ON_OUTBOUND_LINKS (L4.2) both read.
 */
export async function scanOutboundCrossDomainLinks(
  page: { evaluate: (fn: () => unknown) => Promise<unknown> },
  targetHosts: string[],
): Promise<{ total: number; withGl: number }> {
  if (targetHosts.length === 0) return { total: 0, withGl: 0 };
  try {
    const hrefs = await page
      .evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href))
      .catch(() => []) as string[];
    let total = 0;
    let withGl = 0;
    for (const href of hrefs) {
      const host = hostnameOf(href);
      if (!host || !targetHosts.includes(host)) continue;
      total += 1;
      try {
        if (new URL(href).searchParams.has('_gl')) withGl += 1;
      } catch { /* unreachable — href already parsed by hostnameOf */ }
    }
    return { total, withGl };
  } catch {
    return { total: 0, withGl: 0 };
  }
}

/**
 * Live HTTP reachability probe for a Scan Input domain (L0.4 — "Product
 * domain reachable"). Rules stay pure/synchronous (see engine.ts docstrings),
 * so this runs here, once, before AuditData is returned — the same pattern
 * as sgtmVerified (resolved by the caller, read synchronously by the rule).
 * A HEAD request is enough; any non-5xx response counts as reachable (a 401/
 * 403 auth wall is still "reachable", per L0.4's own "crawlable to the auth
 * wall" framing — this only proves the door exists, not that it opens).
 */
export async function probeDomainReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface SimulatorOptions {
  audit_id: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  url_map: Record<string, string>;
  test_email?: string;
  test_phone?: string;
  /** Check Register v2 Scan Input — see probeDomainReachable above. */
  product_domain?: string;
  /** Check Register v2 Scan Input — used by scanOutboundCrossDomainLinks (L4.1/L4.2). */
  checkout_domain?: string;
  /** Resolved by the caller (getConnectedGtmContainerId) before simulation — see AuditData.connected_gtm_container_id. */
  connected_gtm_container_id?: string;
}

/**
 * Run the full journey simulation using an already-connected Playwright browser.
 * Returns the assembled AuditData ready for validation.
 */
export async function simulateJourney(
  browser: {
    newContext: (opts?: object) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, opts?: object) => Promise<unknown>;
        evaluate: (fn: () => unknown) => Promise<unknown>;
        on: (event: string, handler: (req: unknown) => void) => void;
        addInitScript: (script: string) => Promise<void>;
        waitForSelector: (sel: string, opts?: object) => Promise<unknown>;
        click?: (sel: string) => Promise<void>;
        fill?: (sel: string, value: string) => Promise<void>;
        /** Current page URL — used to detect redirects on the landing navigation (L2.9/L2.10). */
        url?: () => string;
      }>;
      cookies: (urls?: string[]) => Promise<Array<{ name: string; value: string }>>;
      close: () => Promise<void>;
    }>;
  },
  opts: SimulatorOptions,
): Promise<AuditData> {
  const injected = makeSyntheticIds();
  const steps = JOURNEY_CONFIGS[opts.funnel_type] ?? JOURNEY_CONFIGS['ecommerce'];

  const dataLayer: DataLayerEvent[] = [];
  const networkRequests: NetworkRequest[] = [];
  const cookieSnapshots: CookieSnapshot[] = [];
  const localStorageSnapshots: LocalStorageSnapshot[] = [];
  const sessionStorageSnapshots: LocalStorageSnapshot[] = [];
  const gtmScriptSrcs: string[] = [];

  const context = await browser.newContext({
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Instrument dataLayer before first navigation so push() is intercepted on every page load
  await instrumentDataLayer(page as Parameters<typeof instrumentDataLayer>[0], dataLayer, 'init');

  // Single listener for all steps — uses a mutable ref so step name stays current
  const stepRef: StepRef = { current: 'init' };
  interceptNetworkRequests(page, networkRequests, stepRef);

  let landingFinalUrl: string | undefined;
  let landingReferrerCaptured: string | undefined;
  let outboundCrossDomainLinks: { total: number; withGl: number } | undefined;
  let productDomainReachable: boolean | undefined;
  let marketingGa4ClientId: string | undefined;
  let productDomainGa4ClientId: string | undefined;
  let productDomainSessionStartDetected: boolean | undefined;

  const crossDomainTargets = [opts.product_domain, opts.checkout_domain]
    .filter((d): d is string => !!d)
    .map(hostnameOf)
    .filter((h): h is string => !!h);

  try {
    for (const step of steps) {
      stepRef.current = step.name;
      let url = opts.url_map[step.urlKey] ?? opts.website_url;

      // Inject click IDs + UTM params on landing page
      if (step.name === 'landing') {
        url = injectSyntheticParams(url, injected);
      }

      logger.debug({ step: step.name, url }, 'Navigating to step');

      const gotoOpts = step.name === 'landing'
        ? { waitUntil: 'networkidle', referer: LANDING_REFERRER }
        : { waitUntil: 'networkidle' };

      await page.goto(url, gotoOpts).catch(() => {
        // Fallback: wait for domcontentloaded
        return page.goto(url, { waitUntil: 'domcontentloaded' });
      });

      if (step.name === 'landing') {
        landingFinalUrl = page.url ? page.url() : url;
      }

      if (step.waitFor) {
        await page.waitForSelector(step.waitFor, { timeout: 5000 }).catch(() => {});
      }

      // Execute step actions
      for (const action of step.actions ?? []) {
        if (action.type === 'wait') {
          await new Promise((r) => setTimeout(r, action.ms));
        } else if (action.type === 'scroll_bottom') {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        } else if (action.type === 'click' && page.click) {
          await page.click(action.selector).catch(() => {});
        } else if (action.type === 'fill' && page.fill) {
          await page.fill(action.selector, action.value).catch(() => {});
        }
      }

      // Flush dataLayer events collected during this step
      await flushDataLayer(page as Parameters<typeof flushDataLayer>[0], dataLayer, step.name);

      // Collect <script src> values for live GTM container ID detection
      const stepScriptSrcs = await page
        .evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src') ?? ''))
        .catch(() => []) as string[];
      gtmScriptSrcs.push(...stepScriptSrcs);

      // document.referrer for L2.11, and an outbound-link scan for L4.1/L4.2
      // — both deliberately after flushDataLayer's evaluate() call, so
      // neither can ever intercept the dataLayer sink flush.
      if (step.name === 'landing') {
        landingReferrerCaptured = await page.evaluate(() => document.referrer).catch(() => '') as string;
        outboundCrossDomainLinks = await scanOutboundCrossDomainLinks(page, crossDomainTargets);
      }

      // Snapshot cookies, localStorage, and sessionStorage
      cookieSnapshots.push(await captureCookies(context, step.name));
      localStorageSnapshots.push(
        await captureLocalStorage(page as Parameters<typeof captureLocalStorage>[0], step.name),
      );
      sessionStorageSnapshots.push(
        await captureSessionStorage(page as Parameters<typeof captureSessionStorage>[0], step.name),
      );
    }

    // Cross-Domain Continuity probe (L4.3/L4.4) — only when product_domain
    // is a genuinely distinct, reachable host (reuses the same
    // reachability probe L0.4 needs, computed once here rather than
    // twice). Navigates the SAME context/page there, as a real cross-
    // domain click would, so cookies that are actually parent-domain-
    // scoped carry over exactly as they would for a real visitor.
    if (opts.product_domain) {
      try {
        const sameHost = new URL(opts.product_domain).host === new URL(opts.website_url).host;
        if (!sameHost) {
          productDomainReachable = await probeDomainReachable(opts.product_domain);
          if (productDomainReachable) {
            marketingGa4ClientId = extractGa4ClientId(networkRequests, mergeCookies(cookieSnapshots));

            stepRef.current = 'product_domain';
            const productDomain = opts.product_domain;
            await page.goto(productDomain, { waitUntil: 'networkidle' }).catch(() =>
              page.goto(productDomain, { waitUntil: 'domcontentloaded' }),
            );
            await flushDataLayer(page as Parameters<typeof flushDataLayer>[0], dataLayer, 'product_domain');
            const productCookieSnapshot = await captureCookies(context, 'product_domain');
            cookieSnapshots.push(productCookieSnapshot);

            const productDomainRequests = networkRequests.filter((r) => r.step === 'product_domain');
            productDomainGa4ClientId = extractGa4ClientId(productDomainRequests, productCookieSnapshot.cookies);
            productDomainSessionStartDetected = ga4SessionStartDetected(productDomainRequests);
          }
        }
      } catch {
        productDomainReachable = false; // product_domain wasn't a parseable URL — treat as unreachable, not skipped
      }
    }
  } finally {
    await context.close();
  }

  // Build derived lookup maps for validation rules
  const landingUrl = opts.url_map['landing'] ?? opts.website_url;
  const urlParams: Record<string, string> = {};
  try {
    new URL(injectSyntheticParams(landingUrl, injected))
      .searchParams
      .forEach((v, k) => { urlParams[k] = v; });
  } catch { /* invalid URL — ignore */ }

  const mergedCookies = mergeCookies(cookieSnapshots);
  const mergedDetailedCookies = mergeDetailedCookies(cookieSnapshots);
  const mergedStorage = mergeLocalStorage(localStorageSnapshots);
  const mergedSessionStorage = mergeLocalStorage(sessionStorageSnapshots);

  // Check if Meta Pixel set fbclid-related cookies
  const hasFBPixelOnLanding = !!(mergedCookies['_fbp'] || mergedCookies['_fbc']);

  return {
    audit_id: opts.audit_id,
    website_url: opts.website_url,
    funnel_type: opts.funnel_type,
    region: opts.region,
    product_domain: opts.product_domain,
    product_domain_reachable: productDomainReachable,
    checkout_domain: opts.checkout_domain,
    connected_gtm_container_id: opts.connected_gtm_container_id,
    steps_visited: steps.map((s) => s.name),
    landing_final_url: landingFinalUrl,
    landing_referrer_captured: landingReferrerCaptured,
    outboundCrossDomainLinks,
    marketingGa4ClientId,
    productDomainGa4ClientId,
    productDomainSessionStartDetected,
    dataLayer,
    networkRequests,
    cookieSnapshots,
    localStorageSnapshots,
    injected,
    test_email: opts.test_email,
    test_phone: opts.test_phone,
    urlParams,
    storage: mergedStorage,
    sessionStorage: mergedSessionStorage,
    cookies: mergedCookies,
    detailedCookies: mergedDetailedCookies,
    pageMetadata: {
      pixel_fbclid: hasFBPixelOnLanding,
      gtm_script_srcs: gtmScriptSrcs,
    },
  };
}
