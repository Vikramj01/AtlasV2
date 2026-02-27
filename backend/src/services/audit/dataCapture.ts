/**
 * Data capture helpers — instrument a Playwright Page to collect:
 *   - window.dataLayer pushes
 *   - Outbound network requests (GA4, Meta, Google Ads, GTM, sGTM)
 *   - Cookies and localStorage snapshots
 */
import type { DataLayerEvent, NetworkRequest, CookieSnapshot, LocalStorageSnapshot } from '@/types/audit';

// URLs we want to capture (ad/analytics platforms)
const TRACKED_URL_PATTERNS = [
  'analytics.google.com',
  'facebook.com/tr',
  'google.com/pagead',
  'googleads.g.doubleclick.net',
  'googletagmanager.com',
  'sgtm',
  'gtm-msr',
  '.co/collect',
];

function shouldCaptureUrl(url: string): boolean {
  return TRACKED_URL_PATTERNS.some((pattern) => url.includes(pattern));
}

/**
 * Instrument a Playwright page to collect dataLayer events.
 * Must be called before navigation.
 */
export async function instrumentDataLayer(
  page: { evaluate: (fn: string | (() => void)) => Promise<void> },
  sink: DataLayerEvent[],
  stepName: string,
): Promise<void> {
  await (page as unknown as { addInitScript: (script: string) => Promise<void> }).addInitScript(`
    (function() {
      window.__atlasDataLayerSink = window.__atlasDataLayerSink || [];
      const _push = window.dataLayer ? window.dataLayer.push.bind(window.dataLayer) : null;
      if (!window.dataLayer) window.dataLayer = [];
      const original = window.dataLayer.push.bind(window.dataLayer);
      window.dataLayer.push = function(...args) {
        args.forEach(ev => {
          window.__atlasDataLayerSink.push(Object.assign({}, ev, {
            __step: '${stepName}',
            __timestamp: Date.now()
          }));
        });
        return original(...args);
      };
    })();
  `);

  // Expose a channel for flushing events to Node.js context
  const ctx = page as {
    exposeFunction?: (name: string, fn: (...args: unknown[]) => unknown) => Promise<void>;
  };
  if (ctx.exposeFunction) {
    await ctx.exposeFunction('__atlasFlush', (events: unknown) => {
      if (Array.isArray(events)) {
        for (const ev of events) {
          const typed = ev as Record<string, unknown>;
          sink.push({
            ...(typed as DataLayerEvent),
            event: String(typed['event'] ?? ''),
            timestamp: Number(typed['__timestamp'] ?? Date.now()),
            step: stepName,
          });
        }
      }
    });
  }
}

/**
 * Flush any remaining dataLayer events from the page.
 */
export async function flushDataLayer(
  page: { evaluate: (fn: () => unknown) => Promise<unknown> },
  sink: DataLayerEvent[],
  stepName: string,
): Promise<void> {
  try {
    const events = await page.evaluate(() => {
      const collected = (window as unknown as { __atlasDataLayerSink?: unknown[] }).__atlasDataLayerSink ?? [];
      (window as unknown as { __atlasDataLayerSink: unknown[] }).__atlasDataLayerSink = [];
      return collected;
    });
    if (Array.isArray(events)) {
      for (const ev of events) {
        const typed = ev as Record<string, unknown>;
        sink.push({
          ...(typed as DataLayerEvent),
          event: String(typed['event'] ?? ''),
          timestamp: Number(typed['__timestamp'] ?? Date.now()),
          step: stepName,
        });
      }
    }
  } catch {
    // Page may have navigated — safe to ignore
  }
}

/**
 * Set up network request interception on a Playwright page.
 * Returns cleanup function.
 */
export function interceptNetworkRequests(
  page: {
    on: (event: string, handler: (req: unknown) => void) => void;
  },
  sink: NetworkRequest[],
  stepName: string,
): void {
  page.on('request', (rawReq: unknown) => {
    const req = rawReq as {
      url(): string;
      method(): string;
      headers(): Record<string, string>;
      timing?(): { startTime: number };
    };
    const url = req.url();
    if (!shouldCaptureUrl(url)) return;
    const request: NetworkRequest = {
      url,
      method: req.method(),
      headers: req.headers(),
      timestamp: Date.now(),
      step: stepName,
    };
    sink.push(request);
  });

  page.on('response', (rawRes: unknown) => {
    const res = rawRes as {
      url(): string;
      request(): { timing?(): { startTime: number; responseEnd: number } };
    };
    const url = res.url();
    if (!shouldCaptureUrl(url)) return;
    const existing = sink.find((r) => r.url === url && r.step === stepName);
    if (existing) {
      try {
        const timing = res.request().timing?.();
        if (timing) {
          existing.loadTime = Math.round(timing.responseEnd - timing.startTime);
        }
      } catch {
        // Timing not always available
      }
    }
  });
}

/**
 * Capture a cookie snapshot from the current page context.
 */
export async function captureCookies(
  context: { cookies: (urls?: string[]) => Promise<Array<{ name: string; value: string }>> },
  step: string,
): Promise<CookieSnapshot> {
  const cookies = await context.cookies();
  const cookieMap: Record<string, string> = {};
  for (const c of cookies) {
    cookieMap[c.name] = c.value;
  }
  return { step, cookies: cookieMap };
}

/**
 * Capture a localStorage snapshot from the page.
 */
export async function captureLocalStorage(
  page: { evaluate: (fn: () => Record<string, string>) => Promise<Record<string, string>> },
  step: string,
): Promise<LocalStorageSnapshot> {
  try {
    const entries = await page.evaluate(() => {
      const result: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) result[key] = localStorage.getItem(key) ?? '';
      }
      return result;
    });
    return { step, entries };
  } catch {
    return { step, entries: {} };
  }
}

/**
 * Merge all cookie snapshots into a single flat map.
 * Later steps override earlier ones (most recent wins).
 */
export function mergeCookies(snapshots: CookieSnapshot[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const snap of snapshots) {
    Object.assign(merged, snap.cookies);
  }
  return merged;
}

/**
 * Merge all localStorage snapshots into a single flat map.
 */
export function mergeLocalStorage(snapshots: LocalStorageSnapshot[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const snap of snapshots) {
    Object.assign(merged, snap.entries);
  }
  return merged;
}
