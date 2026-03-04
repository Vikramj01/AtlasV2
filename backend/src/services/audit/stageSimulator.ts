/**
 * Stage-aware Journey Simulator
 * Drives Playwright through a user-defined journey (from ValidationSpec)
 * and returns per-stage capture data instead of a single flat capture.
 */
import type { ValidationSpec } from '@/types/journey';
import type { DataLayerEvent, NetworkRequest } from '@/types/audit';
import {
  instrumentDataLayer,
  flushDataLayer,
  interceptNetworkRequests,
  captureCookies,
  captureLocalStorage,
} from './dataCapture';
import logger from '@/utils/logger';

export interface StageCapture {
  stage_id?: string;       // Set after DB lookup
  stage_order: number;
  stage_label: string;
  url_navigated: string;
  url_actual: string;
  navigation_success: boolean;
  load_time_ms: number;
  datalayer_events: DataLayerEvent[];
  network_requests: NetworkRequest[];
  cookies: Record<string, string>;
  local_storage: Record<string, string>;
  errors: string[];
  skipped: boolean;        // true when no URL was provided
}

// Same synthetic click IDs as the original simulator
function makeSyntheticIds() {
  const ts = Date.now();
  return { gclid: `test_gclid_${ts}`, fbclid: `test_fbclid_${ts}` };
}

function injectClickIds(url: string, gclid: string, fbclid: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('gclid', gclid);
    u.searchParams.set('fbclid', fbclid);
    return u.toString();
  } catch {
    return url;
  }
}

type PlaywrightBrowser = {
  newContext: (opts?: object) => Promise<PlaywrightContext>;
};

type PlaywrightContext = {
  newPage: () => Promise<PlaywrightPage>;
  cookies: (urls?: string[]) => Promise<Array<{ name: string; value: string }>>;
  close: () => Promise<void>;
};

type PlaywrightPage = {
  goto: (url: string, opts?: object) => Promise<{ url(): string } | null>;
  evaluate: (fn: (() => unknown) | string) => Promise<unknown>;
  on: (event: string, handler: (req: unknown) => void) => void;
  addInitScript: (script: string) => Promise<void>;
  waitForSelector: (sel: string, opts?: object) => Promise<unknown>;
  url: () => string;
  exposeFunction?: (name: string, fn: (...args: unknown[]) => unknown) => Promise<void>;
};

export async function simulateJourneyFromSpec(
  browser: PlaywrightBrowser,
  spec: ValidationSpec,
  testEmail?: string,
  testPhone?: string,
): Promise<StageCapture[]> {
  const injected = makeSyntheticIds();
  const captures: StageCapture[] = [];

  const context = await browser.newContext({
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'x-test-email': testEmail ?? '', 'x-test-phone': testPhone ?? '' },
  });

  const page = await context.newPage();

  // Instrument dataLayer once before any navigation (addInitScript persists across navigations)
  const sinkDataLayer: DataLayerEvent[] = [];
  await instrumentDataLayer(page as Parameters<typeof instrumentDataLayer>[0], sinkDataLayer, 'init');

  const sinkNetwork: NetworkRequest[] = [];

  const sortedStages = [...spec.stages].sort((a, b) => a.stage_order - b.stage_order);

  try {
    for (const stage of sortedStages) {
      const rawUrl = stage.sample_url;

      // Stage has no URL — mark as skipped
      if (!rawUrl) {
        captures.push({
          stage_order: stage.stage_order,
          stage_label: stage.stage_label,
          url_navigated: '',
          url_actual: '',
          navigation_success: false,
          load_time_ms: 0,
          datalayer_events: [],
          network_requests: [],
          cookies: {},
          local_storage: {},
          errors: [],
          skipped: true,
        });
        continue;
      }

      // First stage: inject synthetic click IDs
      const urlToNavigate =
        stage.stage_order === 1 ? injectClickIds(rawUrl, injected.gclid, injected.fbclid) : rawUrl;

      logger.debug({ stage: stage.stage_label, url: urlToNavigate }, 'Navigating to stage');

      const stageSinkDL: DataLayerEvent[] = [];
      const stageSinkNet: NetworkRequest[] = [];

      // Intercept network for this stage
      interceptNetworkRequests(page, stageSinkNet, stage.stage_label);

      const errors: string[] = [];
      let navigationSuccess = false;
      let actualUrl = urlToNavigate;
      const startTime = Date.now();

      try {
        const response = await page
          .goto(urlToNavigate, { waitUntil: 'networkidle', timeout: 15000 })
          .catch(() =>
            page.goto(urlToNavigate, { waitUntil: 'domcontentloaded', timeout: 10000 }),
          );

        actualUrl = page.url();
        navigationSuccess = true;

        // Allow tags to fire
        await new Promise((r) => setTimeout(r, 2000));

        // Collect dataLayer events from this page
        await flushDataLayer(page as Parameters<typeof flushDataLayer>[0], stageSinkDL, stage.stage_label);

        void response; // used only for side effect
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        logger.warn({ stage: stage.stage_label, err: msg }, 'Navigation failed');
      }

      const loadTime = Date.now() - startTime;

      // Snapshot cookies and localStorage
      const cookieArr = await context.cookies().catch(() => [] as Array<{ name: string; value: string }>);
      const cookieMap: Record<string, string> = {};
      for (const c of cookieArr) cookieMap[c.name] = c.value;

      const localStorage = await captureLocalStorage(
        page as Parameters<typeof captureLocalStorage>[0],
        stage.stage_label,
      ).catch(() => ({ step: stage.stage_label, entries: {} }));

      captures.push({
        stage_order: stage.stage_order,
        stage_label: stage.stage_label,
        url_navigated: urlToNavigate,
        url_actual: actualUrl,
        navigation_success: navigationSuccess,
        load_time_ms: loadTime,
        datalayer_events: stageSinkDL,
        network_requests: stageSinkNet,
        cookies: cookieMap,
        local_storage: localStorage.entries,
        errors,
        skipped: false,
      });
    }
  } finally {
    await context.close().catch(() => {});
  }

  return captures;
}
