/**
 * Page Capture Engine — visits a URL via Browserbase and extracts
 * everything the AI analysis layer needs: screenshot, simplified DOM,
 * interactive elements, forms, and existing tracking detection.
 *
 * Reuses createBrowserbaseSession() + getCDPUrl() from browserbase/client.ts.
 * Reuses PLATFORM_SCHEMAS from journey/platformSchemas.ts for tracking detection.
 */
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import { PLATFORM_SCHEMAS } from '@/services/journey/platformSchemas';
import { simplifyDOM, extractInteractiveElements, extractForms } from './domSimplifier';
import { uploadScreenshot } from '@/services/database/supabase';
import type { PageCapture, ExistingTrackingDetection } from '@/types/planning';
import logger from '@/utils/logger';

// Playwright types we actually use (duck-typed to avoid importing playwright in tests)
interface PlaywrightBrowser {
  newContext(opts?: object): Promise<PlaywrightContext>;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, opts?: object): Promise<unknown>;
  screenshot(opts?: object): Promise<Buffer>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  url(): string;
  title(): Promise<string>;
  on(event: string, handler: (req: unknown) => void): void;
  waitForLoadState(state: string, opts?: object): Promise<void>;
}

export interface CapturePageOptions {
  /** If provided, the screenshot will be uploaded to Supabase Storage */
  upload?: { userId: string; sessionId: string; pageId: string };
}

/**
 * Visit `url` using a Browserbase-managed Playwright session,
 * extract all data needed for AI analysis, and return a `PageCapture`.
 *
 * The caller is responsible for providing a connected browser instance
 * so that multi-page sessions can reuse the same Browserbase session.
 *
 * Pass `options.upload` to persist the screenshot to Supabase Storage.
 * When provided, `PageCapture.screenshot_base64` is cleared and
 * `screenshot_storage_path` is set instead (to avoid holding large
 * base64 buffers in memory across many pages).
 */
export async function capturePage(
  browser: PlaywrightBrowser,
  url: string,
  options: CapturePageOptions = {},
): Promise<PageCapture & { screenshot_storage_path?: string }> {
  const startTime = Date.now();

  // Do NOT override userAgent — let Browserbase's fingerprint setting supply a
  // realistic Windows/macOS Chrome UA. Overriding with a Linux string is a
  // common bot signal and defeats the stealth proxy configuration.
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // Track network requests for existing tracking detection
  const networkUrls: string[] = [];
  page.on('request', (rawReq: unknown) => {
    const req = rawReq as { url(): string };
    networkUrls.push(req.url());
  });

  let actualUrl = url;

  try {
    // Navigate — try networkidle first (all XHR settled), then degrade gracefully.
    // 'load' is used as the final fallback because 'domcontentloaded' fires before
    // JS-rendered content appears, which produces poor screenshots on SPAs.
    await page
      .goto(url, { waitUntil: 'networkidle', timeout: 20000 })
      .catch(() => page.goto(url, { waitUntil: 'load', timeout: 15000 }))
      .catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }));

    actualUrl = page.url();

    // Brief pause for tag manager / async scripts to fire
    await new Promise((r) => setTimeout(r, 1500));

    // ── Screenshot (JPEG 80% quality, viewport only = 1280×800) ────────────
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    }).catch(async () =>
      // Fallback: full viewport without clip if clip fails
      page.screenshot({ type: 'jpeg', quality: 80 }),
    );
    const screenshot_base64 = screenshotBuffer.toString('base64');

    // ── Page metadata ────────────────────────────────────────────────────────
    const page_title = await page.title().catch(() => '');

    const meta_tags = await page.evaluate(() => {
      const tags: Record<string, string> = {};
      for (const meta of Array.from(document.querySelectorAll('meta[name], meta[property]'))) {
        const key = meta.getAttribute('name') ?? meta.getAttribute('property') ?? '';
        const val = meta.getAttribute('content') ?? '';
        if (key && val) tags[key] = val.slice(0, 200);
      }
      return tags;
    });

    // ── DOM extraction ───────────────────────────────────────────────────────
    const [simplified_dom, interactive_elements, forms] = await Promise.all([
      simplifyDOM(page),
      extractInteractiveElements(page),
      extractForms(page),
    ]);

    // ── Existing tracking detection ──────────────────────────────────────────
    const existing_tracking = await detectExistingTracking(page, networkUrls);

    const page_load_time_ms = Date.now() - startTime;

    logger.info(
      {
        url,
        actual_url: actualUrl,
        interactive_count: interactive_elements.length,
        forms_count: forms.length,
        load_ms: page_load_time_ms,
      },
      'Page capture complete',
    );

    // ── Optional screenshot upload ────────────────────────────────────────────
    let screenshot_storage_path: string | undefined;
    let screenshot_base64_out = screenshot_base64;

    if (options.upload) {
      const { userId, sessionId, pageId } = options.upload;
      const buffer = Buffer.from(screenshot_base64, 'base64');
      screenshot_storage_path = await uploadScreenshot(userId, sessionId, pageId, buffer).catch((err) => {
        logger.warn({ err: err.message, pageId }, 'Screenshot upload failed — continuing without storage path');
        return undefined;
      });

      // If upload succeeded, clear base64 from memory — sessionOrchestrator will
      // re-fetch via signed URL when needed. Keep it only for standalone/test usage.
      if (screenshot_storage_path) {
        screenshot_base64_out = '';
      }
    }

    return {
      url,
      actual_url: actualUrl,
      page_title,
      screenshot_base64: screenshot_base64_out,
      simplified_dom,
      interactive_elements,
      forms,
      existing_tracking,
      meta_tags,
      page_load_time_ms,
      screenshot_storage_path,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Detect which tracking platforms are already installed on the page.
 * Uses script_patterns and network_patterns from PLATFORM_SCHEMAS.
 */
async function detectExistingTracking(
  page: PlaywrightPage,
  networkUrls: string[],
): Promise<ExistingTrackingDetection> {
  // Get all script src attributes and inline script snippets
  const scriptSources = await page.evaluate(() => {
    const srcs: string[] = [];
    for (const s of Array.from(document.querySelectorAll('script[src]'))) {
      srcs.push((s as HTMLScriptElement).src);
    }
    // Also check first 200 chars of inline scripts for GTM container IDs
    for (const s of Array.from(document.querySelectorAll('script:not([src])'))) {
      const text = (s.textContent ?? '').slice(0, 200);
      if (text.includes('GTM-') || text.includes('gtm.js')) srcs.push(`inline:${text}`);
    }
    return srcs;
  }).catch(() => [] as string[]);

  // Check for existing dataLayer events
  const datalayerEvents = await page.evaluate(() => {
    const dl = (window as unknown as { dataLayer?: Array<{ event?: string }> }).dataLayer ?? [];
    return dl.map((e) => e?.event ?? '').filter(Boolean);
  }).catch(() => [] as string[]);

  const detection: ExistingTrackingDetection = {
    gtm_detected: false,
    ga4_detected: false,
    meta_pixel_detected: false,
    google_ads_detected: false,
    tiktok_pixel_detected: false,
    linkedin_insight_detected: false,
    walkeros_detected: false,
    other_tags: [],
    datalayer_events_found: [...new Set(datalayerEvents)],
  };

  const allSources = [...scriptSources, ...networkUrls];

  for (const schema of PLATFORM_SCHEMAS) {
    const matchesScript = schema.detection.script_patterns.some((p) =>
      allSources.some((s) => s.includes(p)),
    );
    const matchesNetwork = schema.detection.network_patterns.some((p) =>
      networkUrls.some((s) => s.includes(p)),
    );
    const detected = matchesScript || matchesNetwork;

    if (!detected) continue;

    switch (schema.platform) {
      case 'ga4':
        detection.ga4_detected = true;
        // Try to extract measurement ID
        detection.ga4_measurement_id = extractId(allSources, /G-[A-Z0-9]+/);
        break;
      case 'google_ads':
        detection.google_ads_detected = true;
        detection.google_ads_id = extractId(allSources, /AW-[0-9]+/);
        break;
      case 'meta':
        detection.meta_pixel_detected = true;
        detection.meta_pixel_id = extractId(allSources, /fbevents\.js.*?['"](\d{15,16})['"]/) ||
          extractId(networkUrls, /id=(\d{15,16})/);
        break;
      case 'tiktok':
        detection.tiktok_pixel_detected = true;
        break;
      case 'linkedin':
        detection.linkedin_insight_detected = true;
        break;
    }
  }

  // GTM detection (check scripts + look for GTM container ID)
  const gtmMatch = allSources.find((s) => s.includes('googletagmanager.com/gtm'));
  if (gtmMatch) {
    detection.gtm_detected = true;
    detection.gtm_container_id = extractId([gtmMatch], /GTM-[A-Z0-9]+/);
  }

  // WalkerOS detection
  if (allSources.some((s) => s.includes('walkeros') || s.includes('walker-os'))) {
    detection.walkeros_detected = true;
  }

  return detection;
}

function extractId(sources: string[], pattern: RegExp): string | undefined {
  for (const src of sources) {
    const m = src.match(pattern);
    if (m) return m[1] ?? m[0];
  }
  return undefined;
}

/**
 * Convenience wrapper: creates a Browserbase session, connects Playwright,
 * runs capturePage(), and closes the session.
 *
 * Use this for single-page captures (e.g., the dev test script).
 * For multi-page sessions, create one browser instance and call capturePage() repeatedly.
 */
export async function capturePageStandalone(url: string): Promise<PageCapture> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as {
    chromium: { connectOverCDP(url: string): Promise<PlaywrightBrowser> };
  };

  const session = await createBrowserbaseSession();
  const cdpUrl = getCDPUrl(session.id);

  logger.info({ sessionId: session.id, url }, 'Starting standalone page capture');

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    return await capturePage(browser, url);
  } finally {
    // Browserbase cleans up on its end; no explicit browser.close() needed
    await (browser as unknown as { close?: () => Promise<void> }).close?.().catch(() => {});
  }
}
