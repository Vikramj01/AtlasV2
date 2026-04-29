/**
 * Signal Detector — visits pages via Browserbase/Playwright and detects
 * marketing signals from DOM inspection and network request interception.
 *
 * Architecture: ONE Browserbase session scans multiple pages sequentially.
 * Browserbase bills a minimum of 1 minute per session, so batching pages
 * dramatically reduces cost vs opening a new session per page.
 *
 * Reuses createBrowserbaseSession() + getCDPUrl() from browserbase/client.ts.
 * Uses duck-typed Playwright interfaces (same pattern as sessionOrchestrator.ts)
 * to avoid importing playwright types in tests.
 */
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import type { DetectedSignal, PageScanResult, PageToScan, SignalIssue } from '@/types/crawl';
import logger from '@/utils/logger';

// Duck-typed Playwright interfaces — avoids hard dependency on playwright types
interface PlaywrightBrowser {
  newContext(opts?: object): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, opts?: object): Promise<{ status(): number } | null>;
  evaluate<T>(fn: () => T): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  on(event: 'request', handler: (req: PlaywrightRequest) => void): void;
  close(): Promise<void>;
}
interface PlaywrightRequest {
  url(): string;
  postData(): string | null;
}

export interface ScanBatchResult {
  browserbase_session_id: string;
  browser_minutes_used: number;
  page_results: PageScanResult[];
}

/**
 * Scans a batch of pages in a single Browserbase session.
 * Pages are scanned sequentially within the session to minimise billing.
 */
export async function scanPageBatch(
  pages: PageToScan[],
  org_id: string,
  crawl_run_id: string,
): Promise<ScanBatchResult> {
  const sessionStart = Date.now();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as {
    chromium: { connectOverCDP(url: string): Promise<PlaywrightBrowser> };
  };

  const bbSession = await createBrowserbaseSession({
    org_id,
    crawl_run_id,
    batch_size: String(pages.length),
    scope_ids:  pages.map(p => p.scope_id).join(','),
  });

  const cdpUrl = getCDPUrl(bbSession.id);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = await browser.newContext({
    locale:   'en-US',
    viewport: { width: 1280, height: 800 },
  });

  const page_results: PageScanResult[] = [];

  try {
    for (const targetPage of pages) {
      const pageStart = Date.now();
      const browserPage = await context.newPage();

      const networkRequests: { url: string; postData: string | null }[] = [];
      browserPage.on('request', req => {
        networkRequests.push({ url: req.url(), postData: req.postData() });
      });

      let httpStatus: number | null = null;

      try {
        const response = await browserPage.goto(targetPage.url, {
          waitUntil: 'networkidle',
          timeout:   30_000,
        });
        httpStatus = response?.status() ?? null;

        // Allow late-firing tags to complete
        await browserPage.waitForTimeout(2000);

        const signals = await detectSignalsOnPage(browserPage, networkRequests);

        page_results.push({
          scope_id:        targetPage.scope_id,
          crawl_page_id:   targetPage.crawl_page_id,
          url:             targetPage.url,
          http_status:     httpStatus,
          scan_duration_ms: Date.now() - pageStart,
          signals,
        });

        logger.info(
          { org_id, url: targetPage.url, signals: signals.length },
          'Page scanned successfully',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ org_id, url: targetPage.url, err: message }, 'Page scan failed');
        page_results.push({
          scope_id:        targetPage.scope_id,
          crawl_page_id:   targetPage.crawl_page_id,
          url:             targetPage.url,
          http_status:     httpStatus,
          scan_duration_ms: Date.now() - pageStart,
          signals:         [],
          error:           message,
        });
      } finally {
        await browserPage.close();
        networkRequests.length = 0; // clear for next page in batch
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const totalSeconds = (Date.now() - sessionStart) / 1000;
  // Browserbase bills a minimum of 1 minute per session
  const browser_minutes_used = Math.max(totalSeconds / 60, 1);

  return {
    browserbase_session_id: bbSession.id,
    browser_minutes_used,
    page_results,
  };
}

// ── Signal detection ──────────────────────────────────────────────────────────

async function detectSignalsOnPage(
  page: PlaywrightPage,
  networkRequests: { url: string; postData: string | null }[],
): Promise<DetectedSignal[]> {
  const signals: DetectedSignal[] = [];

  // ── GTM Container ────────────────────────────────────────────────────────────
  const gtmIds = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    return scripts
      .map(s => s.getAttribute('src') ?? '')
      .filter(src => src.includes('googletagmanager.com/gtm.js'))
      .map(src => {
        try { return new URL(src).searchParams.get('id'); } catch { return null; }
      })
      .filter((id): id is string => id !== null);
  });

  for (const gtmId of gtmIds) {
    signals.push({
      signal_type:     'gtm_container',
      signal_name:     null,
      signal_id:       gtmId,
      health_status:   'healthy',
      health_score:    100,
      detected_at:     'page_load',
      firing_triggers: null,
      parameters:      { container_id: gtmId },
      issues:          [],
    });
  }

  // ── GA4 ──────────────────────────────────────────────────────────────────────
  const ga4Hits = networkRequests.filter(r =>
    r.url.includes('google-analytics.com/g/collect') ||
    r.url.includes('analytics.google.com/g/collect'),
  );

  if (ga4Hits.length > 0) {
    const measurementIds = [...new Set(
      ga4Hits
        .map(r => { try { return new URL(r.url).searchParams.get('tid'); } catch { return null; } })
        .filter((id): id is string => id !== null),
    )];

    const issues: SignalIssue[] = [];
    if (ga4Hits.length > measurementIds.length * 2) {
      issues.push({
        code:     'GA4_DUPLICATE_FIRE',
        severity: 'warning',
        message:  `GA4 fired ${ga4Hits.length} times — possible duplicate tag.`,
      });
    }

    signals.push({
      signal_type:     'ga4_base',
      signal_name:     'page_view',
      signal_id:       measurementIds[0] ?? null,
      health_status:   issues.length > 0 ? 'degraded' : 'healthy',
      health_score:    issues.length > 0 ? 70 : 100,
      detected_at:     'page_load',
      firing_triggers: null,
      parameters:      { measurement_ids: measurementIds, hit_count: ga4Hits.length },
      issues,
    });
  }

  // ── Meta Pixel ───────────────────────────────────────────────────────────────
  const metaPixelHits = networkRequests.filter(r =>
    r.url.includes('facebook.com/tr') ||
    r.url.includes('connect.facebook.net'),
  );

  if (metaPixelHits.length > 0) {
    const pixelIds = [...new Set(
      metaPixelHits
        .map(r => { try { return new URL(r.url).searchParams.get('id'); } catch { return null; } })
        .filter((id): id is string => id !== null),
    )];

    const issues: SignalIssue[] = [];
    const missingEventId = metaPixelHits.some(r => {
      try { return !new URL(r.url).searchParams.has('eid'); } catch { return false; }
    });
    if (missingEventId) {
      issues.push({
        code:     'META_MISSING_EVENT_ID',
        severity: 'critical',
        message:  'Meta Pixel firing without event_id — CAPI deduplication will fail.',
      });
    }

    signals.push({
      signal_type:     'meta_pixel',
      signal_name:     null,
      signal_id:       pixelIds[0] ?? null,
      health_status:   issues.some(i => i.severity === 'critical') ? 'misconfigured' : 'healthy',
      health_score:    issues.some(i => i.severity === 'critical') ? 40 : 100,
      detected_at:     'page_load',
      firing_triggers: null,
      parameters:      { pixel_ids: pixelIds },
      issues,
    });
  }

  // ── Google Ads Conversion ────────────────────────────────────────────────────
  const gadsHits = networkRequests.filter(r =>
    r.url.includes('googleadservices.com/pagead/conversion') ||
    r.url.includes('google.com/pagead/conversion'),
  );

  if (gadsHits.length > 0) {
    signals.push({
      signal_type:     'google_ads_conversion',
      signal_name:     null,
      signal_id:       null,
      health_status:   'healthy',
      health_score:    90,
      detected_at:     'page_load',
      firing_triggers: null,
      parameters:      { hit_count: gadsHits.length },
      issues:          [],
    });
  }

  // ── TikTok Pixel ─────────────────────────────────────────────────────────────
  const tiktokHits = networkRequests.filter(r =>
    r.url.includes('analytics.tiktok.com'),
  );

  if (tiktokHits.length > 0) {
    signals.push({
      signal_type:     'tiktok_pixel',
      signal_name:     null,
      signal_id:       null,
      health_status:   'healthy',
      health_score:    90,
      detected_at:     'page_load',
      firing_triggers: null,
      parameters:      { hit_count: tiktokHits.length },
      issues:          [],
    });
  }

  // ── LinkedIn Insight Tag ─────────────────────────────────────────────────────
  const linkedinHits = networkRequests.filter(r =>
    r.url.includes('snap.licdn.com') || r.url.includes('linkedin.com/px'),
  );

  if (linkedinHits.length > 0) {
    signals.push({
      signal_type:     'linkedin_insight',
      signal_name:     null,
      signal_id:       null,
      health_status:   'healthy',
      health_score:    90,
      detected_at:     'page_load',
      firing_triggers: null,
      parameters:      { hit_count: linkedinHits.length },
      issues:          [],
    });
  }

  return signals;
}
