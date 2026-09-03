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
  mergeCookies,
  mergeLocalStorage,
  type StepRef,
} from './dataCapture';
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

      // document.referrer for L2.11 — deliberately the last evaluate() call
      // in the step, after flushDataLayer's, so it can never intercept the
      // dataLayer sink flush.
      if (step.name === 'landing') {
        landingReferrerCaptured = await page.evaluate(() => document.referrer).catch(() => '') as string;
      }

      // Snapshot cookies and localStorage
      cookieSnapshots.push(await captureCookies(context, step.name));
      localStorageSnapshots.push(
        await captureLocalStorage(page as Parameters<typeof captureLocalStorage>[0], step.name),
      );
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
  const mergedStorage = mergeLocalStorage(localStorageSnapshots);

  // Check if Meta Pixel set fbclid-related cookies
  const hasFBPixelOnLanding = !!(mergedCookies['_fbp'] || mergedCookies['_fbc']);

  // L0.4 — only probe when product_domain is a distinct host from the
  // marketing domain; a same-site value has nothing separate to prove.
  let productDomainReachable: boolean | undefined;
  if (opts.product_domain) {
    try {
      const sameHost = new URL(opts.product_domain).host === new URL(opts.website_url).host;
      productDomainReachable = sameHost ? undefined : await probeDomainReachable(opts.product_domain);
    } catch {
      productDomainReachable = false; // product_domain wasn't a parseable URL — treat as unreachable, not skipped
    }
  }

  return {
    audit_id: opts.audit_id,
    website_url: opts.website_url,
    funnel_type: opts.funnel_type,
    region: opts.region,
    product_domain: opts.product_domain,
    product_domain_reachable: productDomainReachable,
    connected_gtm_container_id: opts.connected_gtm_container_id,
    steps_visited: steps.map((s) => s.name),
    landing_final_url: landingFinalUrl,
    landing_referrer_captured: landingReferrerCaptured,
    dataLayer,
    networkRequests,
    cookieSnapshots,
    localStorageSnapshots,
    injected,
    test_email: opts.test_email,
    test_phone: opts.test_phone,
    urlParams,
    storage: mergedStorage,
    cookies: mergedCookies,
    pageMetadata: {
      pixel_fbclid: hasFBPixelOnLanding,
      gtm_script_srcs: gtmScriptSrcs,
    },
  };
}
