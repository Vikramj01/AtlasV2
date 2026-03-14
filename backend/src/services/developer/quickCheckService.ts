/**
 * Quick Check Service
 *
 * Runs a rapid Browserbase single-page check to verify if tracking
 * has been correctly implemented on a given URL.
 *
 * Unlike the full planning scan (Bull job queue), this is synchronous —
 * the result is returned directly in the HTTP response.
 * Expected runtime: 8–15 seconds.
 *
 * Used by:
 *  - Developer Portal: POST /api/dev/:shareToken/pages/:pageId/quickcheck
 */
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import logger from '@/utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuickCheckTracking {
  gtm: boolean;
  gtm_container_id: string | undefined;
  ga4: boolean;
  ga4_measurement_id: string | undefined;
  meta_pixel: boolean;
  meta_pixel_id: string | undefined;
  google_ads: boolean;
  datalayer_events: string[];
}

export interface QuickCheckResult {
  url: string;
  checked_at: string;
  duration_ms: number;
  tracking: QuickCheckTracking;
  overall_status: 'tracking_found' | 'partial' | 'not_found' | 'error';
  summary: string;
}

// ── Playwright duck-types (same pattern as pageCaptureService.ts) ─────────────

interface PlaywrightBrowser {
  newContext(opts?: object): Promise<PlaywrightContext>;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, opts?: object): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  on(event: string, handler: (req: unknown) => void): void;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Visit `url` with a fresh Browserbase session, detect installed tracking,
 * and return a QuickCheckResult.
 *
 * The session is created and destroyed within this call (not reused).
 */
export async function runQuickCheck(url: string): Promise<QuickCheckResult> {
  const startTime = Date.now();
  const checkedAt = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as {
    chromium: { connectOverCDP(url: string): Promise<PlaywrightBrowser> };
  };

  const session = await createBrowserbaseSession();
  const cdpUrl = getCDPUrl(session.id);

  logger.info({ sessionId: session.id, url }, 'Quick check started');

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const networkUrls: string[] = [];
  page.on('request', (rawReq: unknown) => {
    const req = rawReq as { url(): string };
    networkUrls.push(req.url());
  });

  try {
    // Navigate — cascade through wait strategies
    await page
      .goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
      .catch(() => page.goto(url, { waitUntil: 'load', timeout: 15_000 }))
      .catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 }));

    // Brief pause for async tag manager scripts to fire
    await new Promise((r) => setTimeout(r, 1500));

    // ── dataLayer ──────────────────────────────────────────────────────────────
    const rawDatalayerEvents = await page
      .evaluate(() => {
        const dl = (window as unknown as { dataLayer?: Array<{ event?: string }> }).dataLayer ?? [];
        return [...new Set(dl.map((e) => e?.event ?? '').filter(Boolean))];
      })
      .catch(() => [] as string[]);

    // Filter out GTM lifecycle events — these fire on every page with GTM installed
    // and are not meaningful conversion/tracking events added by a developer.
    const GTM_DEFAULT_EVENTS = new Set([
      'gtm.dom', 'gtm.load', 'gtm.js', 'gtm.init', 'gtm.init_consent',
      'gtm.click', 'gtm.linkClick', 'gtm.scrollDepth', 'gtm.historyChange',
      'gtm.historyChange-v2', 'gtm.elementVisibility', 'gtm.timer',
    ]);
    const datalayerEvents = rawDatalayerEvents.filter((e) => !GTM_DEFAULT_EVENTS.has(e));

    // ── Script sources ─────────────────────────────────────────────────────────
    const scriptSources = await page
      .evaluate(() => {
        const srcs: string[] = [];
        for (const s of Array.from(document.querySelectorAll('script[src]'))) {
          srcs.push((s as HTMLScriptElement).src);
        }
        // Also inspect short inline scripts for GTM container markers
        for (const s of Array.from(document.querySelectorAll('script:not([src])'))) {
          const text = (s.textContent ?? '').slice(0, 300);
          if (text.includes('GTM-') || text.includes('gtm.js')) srcs.push(`inline:${text}`);
        }
        return srcs;
      })
      .catch(() => [] as string[]);

    const all = [...scriptSources, ...networkUrls];

    // ── Signal detection ───────────────────────────────────────────────────────
    const gtmSource = all.find((s) => s.includes('googletagmanager.com/gtm'));
    const gtm = !!gtmSource;
    const gtm_container_id = gtmSource ? extractId([gtmSource], /GTM-[A-Z0-9]+/) : undefined;

    const ga4 = all.some(
      (s) =>
        s.includes('googletagmanager.com') ||
        s.includes('google-analytics.com') ||
        s.includes('gtag/js'),
    );
    const ga4_measurement_id = extractId(all, /G-[A-Z0-9]+/);

    const meta_pixel = all.some(
      (s) => s.includes('connect.facebook.net') || s.includes('fbevents.js'),
    );
    const meta_pixel_id =
      extractId(networkUrls, /id=(\d{15,16})/) ??
      extractId(scriptSources, /fbq\('init',\s*['"](\d{15,16})['"]\)/);

    const google_ads = all.some(
      (s) =>
        s.includes('googleadservices') || s.includes('/pagead/') || /AW-[0-9]+/.test(s),
    );

    const tracking: QuickCheckTracking = {
      gtm,
      gtm_container_id,
      ga4,
      ga4_measurement_id,
      meta_pixel,
      meta_pixel_id,
      google_ads,
      datalayer_events: datalayerEvents,
    };

    // ── Status + summary ───────────────────────────────────────────────────────
    // `tracking_found` requires BOTH infrastructure (GTM/GA4) AND at least one
    // meaningful custom dataLayer event — confirming the developer actually pushed
    // conversion events, not just that pre-existing scripts are present.
    // `partial` = infrastructure scripts found but no custom events yet.
    // `not_found` = nothing detected at all.
    const hasInfrastructure = gtm || ga4 || meta_pixel || google_ads;
    const hasMeaningfulEvents = datalayerEvents.length > 0;
    const hasAny = hasInfrastructure || hasMeaningfulEvents;
    const hasCore = hasInfrastructure && hasMeaningfulEvents;

    const overall_status: QuickCheckResult['overall_status'] = hasCore
      ? 'tracking_found'
      : hasAny
        ? 'partial'
        : 'not_found';

    const parts: string[] = [];
    if (gtm) parts.push(`GTM${gtm_container_id ? ` (${gtm_container_id})` : ''}`);
    if (ga4) parts.push(`GA4${ga4_measurement_id ? ` (${ga4_measurement_id})` : ''}`);
    if (meta_pixel) parts.push(`Meta Pixel${meta_pixel_id ? ` (${meta_pixel_id})` : ''}`);
    if (google_ads) parts.push('Google Ads');
    if (datalayerEvents.length > 0)
      parts.push(`${datalayerEvents.length} dataLayer event${datalayerEvents.length !== 1 ? 's' : ''}`);

    const infraList = parts.filter((p) => !p.includes('dataLayer')).join(', ');
    const summary =
      overall_status === 'partial' && hasInfrastructure && !hasMeaningfulEvents
        ? `Pre-existing scripts detected (${infraList || 'unknown'}). No custom dataLayer events found yet — add the recommended pushes and re-check.`
        : parts.length > 0
          ? `Detected: ${parts.join(', ')}`
          : 'No tracking detected on this page';

    const duration_ms = Date.now() - startTime;

    logger.info({ url, overall_status, duration_ms }, 'Quick check complete');

    return { url, checked_at: checkedAt, duration_ms, tracking, overall_status, summary };
  } finally {
    await context.close().catch(() => {});
    await (browser as unknown as { close?: () => Promise<void> }).close?.().catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractId(sources: string[], pattern: RegExp): string | undefined {
  for (const src of sources) {
    const m = src.match(pattern);
    if (m) return m[1] ?? m[0];
  }
  return undefined;
}
