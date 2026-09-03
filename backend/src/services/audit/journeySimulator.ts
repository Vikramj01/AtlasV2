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

// Synthetic click IDs injected on landing — allows persistence validation
function makeSyntheticIds() {
  const ts = Date.now();
  return {
    gclid:  `test_gclid_${ts}`,
    fbclid: `test_fbclid_${ts}`,
  };
}

/** Append synthetic click ID params to a URL string */
function injectClickIds(url: string, gclid: string, fbclid: string): string {
  const u = new URL(url);
  u.searchParams.set('gclid',  gclid);
  u.searchParams.set('fbclid', fbclid);
  return u.toString();
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

  try {
    for (const step of steps) {
      stepRef.current = step.name;
      let url = opts.url_map[step.urlKey] ?? opts.website_url;

      // Inject click IDs on landing page
      if (step.name === 'landing') {
        url = injectClickIds(url, injected.gclid, injected.fbclid);
      }

      logger.debug({ step: step.name, url }, 'Navigating to step');

      await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {
        // Fallback: wait for domcontentloaded
        return page.goto(url, { waitUntil: 'domcontentloaded' });
      });

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
    new URL(injectClickIds(landingUrl, injected.gclid, injected.fbclid))
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
