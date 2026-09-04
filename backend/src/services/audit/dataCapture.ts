/**
 * Data capture helpers — instrument a Playwright Page to collect:
 *   - window.dataLayer pushes
 *   - Outbound network requests (GA4, Meta, Google Ads, GTM, sGTM, LinkedIn, TikTok, Microsoft UET)
 *   - Cookies and localStorage snapshots
 */
import type { DataLayerEvent, NetworkRequest, CookieSnapshot, LocalStorageSnapshot, DetailedCookie, ConsoleError } from '@/types/audit';
import { PLATFORM_MATCHER_HOSTS } from '@/services/validation/register/platformDetection';

// URLs we want to capture (ad/analytics platforms). Built as a superset of
// PLATFORM_MATCHER_HOSTS (every host any declared-platform matcher looks
// for — see platformDetection.ts) plus infra this file alone cares about
// (GA4/GTM/sGTM loader and collect endpoints, Meta's separate pixel-loader
// script). Spreading PLATFORM_MATCHER_HOSTS in, rather than each platform's
// hosts being hand-copied here a second time, is what makes a declared
// platform structurally undetectable (Site Evaluation Coverage & Honesty
// PRD §8.3, defect #4) impossible to reintroduce by omission — see the
// invariant test below.
export const TRACKED_URL_PATTERNS = [
  'analytics.google.com',
  'google-analytics.com',
  'connect.facebook.net',
  'googletagmanager.com',
  'sgtm',
  'gtm-msr',
  '/g/collect',
  '/mp/collect',
  ...Object.values(PLATFORM_MATCHER_HOSTS).flat(),
];

export function shouldCaptureUrl(url: string): boolean {
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
 * A mutable step-name reference so a single listener registration always
 * reads the current step without needing to be re-registered per navigation.
 * journeySimulator uses this; stageSimulator passes plain strings.
 */
export interface StepRef {
  current: string;
}

/**
 * Set up network request interception on a Playwright page.
 * Accepts either a plain string (stageSimulator — one listener per stage) or
 * a StepRef object (journeySimulator — one listener for the whole session).
 *
 * KEY FIX: captures POST body via req.postData() so rules that match on
 * r.body (GA4, Meta, Google Ads) work correctly.
 */
export function interceptNetworkRequests(
  page: {
    on: (event: string, handler: (req: unknown) => void) => void;
  },
  sink: NetworkRequest[],
  stepNameOrRef: string | StepRef,
): void {
  const getStep = (): string =>
    typeof stepNameOrRef === 'string' ? stepNameOrRef : stepNameOrRef.current;

  page.on('request', (rawReq: unknown) => {
    const req = rawReq as {
      url(): string;
      method(): string;
      headers(): Record<string, string>;
      postData?(): string | null;
    };
    const url = req.url();
    if (!shouldCaptureUrl(url)) return;
    const request: NetworkRequest = {
      url,
      method: req.method(),
      headers: req.headers(),
      body: req.postData?.() ?? undefined,
      timestamp: Date.now(),
      step: getStep(),
    };
    sink.push(request);
  });

  page.on('response', (rawRes: unknown) => {
    const res = rawRes as {
      url(): string;
      status(): number;
      request(): { timing?(): { startTime: number; responseEnd: number } };
    };
    const url = res.url();
    if (!shouldCaptureUrl(url)) return;
    const step = getStep();
    const existing = sink.find((r) => r.url === url && r.step === step);
    if (existing) {
      try {
        existing.statusCode = res.status();
      } catch {
        // Status not always available
      }
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

  // A request that never got a response at all (DNS failure, connection
  // refused, blocked by the browser/an extension) — used by NO_TAG_LOAD_ERRORS
  // (L1.16): a tag that fails to load reports as absent everywhere else, not
  // as broken, so this is the only place that distinguishes the two.
  page.on('requestfailed', (rawReq: unknown) => {
    const req = rawReq as { url(): string };
    const url = req.url();
    if (!shouldCaptureUrl(url)) return;
    const step = getStep();
    const existing = sink.find((r) => r.url === url && r.step === step);
    if (existing) existing.failed = true;
  });
}

/**
 * Set up console-error and uncaught-exception interception on a
 * Playwright page — used by Hygiene & Integrity's NO_CONSOLE_ERRORS_FROM_
 * MEASUREMENT_CODE (L12.4) and CONVERSION_SURFACE_REACHABLE_WITHOUT_
 * JAVASCRIPT_ERRORS (L12.8). Registered once for the whole session, same
 * StepRef pattern as interceptNetworkRequests.
 */
export function interceptConsoleErrors(
  page: {
    on: (event: string, handler: (arg: unknown) => void) => void;
  },
  sink: ConsoleError[],
  stepNameOrRef: string | StepRef,
): void {
  const getStep = (): string =>
    typeof stepNameOrRef === 'string' ? stepNameOrRef : stepNameOrRef.current;

  page.on('console', (rawMsg: unknown) => {
    const msg = rawMsg as { type?: () => string; text?: () => string };
    if (msg.type?.() !== 'error') return;
    sink.push({ message: msg.text?.() ?? '', step: getStep() });
  });

  page.on('pageerror', (rawErr: unknown) => {
    const err = rawErr as { message?: string } | string;
    const message = typeof err === 'string' ? err : err.message ?? String(err);
    sink.push({ message, step: getStep() });
  });
}

/**
 * Capture a cookie snapshot from the current page context — both the flat
 * name→value map existing callers rely on, and each cookie's full
 * attribute set (domain/expires/secure/sameSite) for Storage Durability
 * (L3) rules that need more than presence.
 */
export async function captureCookies(
  context: {
    cookies: (urls?: string[]) => Promise<Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      expires?: number;
      secure?: boolean;
      sameSite?: string;
    }>>;
  },
  step: string,
): Promise<CookieSnapshot> {
  const cookies = await context.cookies();
  const cookieMap: Record<string, string> = {};
  const detailed: DetailedCookie[] = [];
  for (const c of cookies) {
    cookieMap[c.name] = c.value;
    detailed.push({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '',
      path: c.path ?? '/',
      expires: c.expires ?? -1,
      secure: c.secure ?? false,
      sameSite: c.sameSite === 'Strict' || c.sameSite === 'None' ? c.sameSite : 'Lax',
    });
  }
  return { step, cookies: cookieMap, detailed };
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
 * Capture a sessionStorage snapshot from the page — see AuditData.sessionStorage's
 * docstring on why this is captured separately from localStorage.
 */
export async function captureSessionStorage(
  page: { evaluate: (fn: () => Record<string, string>) => Promise<Record<string, string>> },
  step: string,
): Promise<LocalStorageSnapshot> {
  try {
    const entries = await page.evaluate(() => {
      const result: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) result[key] = sessionStorage.getItem(key) ?? '';
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

/**
 * Merge all cookie snapshots' detailed attribute sets into one array, one
 * entry per cookie name — later steps override earlier ones (most recent
 * wins), same semantics as mergeCookies above.
 */
export function mergeDetailedCookies(snapshots: CookieSnapshot[]): DetailedCookie[] {
  const merged = new Map<string, DetailedCookie>();
  for (const snap of snapshots) {
    for (const cookie of snap.detailed ?? []) {
      merged.set(cookie.name, cookie);
    }
  }
  return [...merged.values()];
}
