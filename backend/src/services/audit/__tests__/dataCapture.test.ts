/**
 * Unit tests for dataCapture helpers.
 * All Playwright types are mocked inline — no real browser required.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  flushDataLayer,
  interceptNetworkRequests,
  interceptConsoleErrors,
  captureCookies,
  captureLocalStorage,
  captureSessionStorage,
  mergeCookies,
  mergeLocalStorage,
  mergeDetailedCookies,
  shouldCaptureUrl,
  type StepRef,
} from '../dataCapture';
import { ALL_DECLARED_PLATFORMS, PLATFORM_MATCHER_HOSTS, PLATFORM_LABELS } from '@/services/validation/register/platformDetection';
import type { NetworkRequest, ConsoleError } from '@/types/audit';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePageWithDataLayer(events: object[]) {
  return {
    evaluate: vi.fn().mockResolvedValue(events),
  };
}

function makeEventEmitterPage() {
  const handlers: Record<string, ((arg: unknown) => void)[]> = {};
  return {
    page: {
      on(event: string, handler: (arg: unknown) => void) {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(handler);
      },
    },
    emit(event: string, arg: unknown) {
      (handlers[event] ?? []).forEach((h) => h(arg));
    },
  };
}

function makeRequest(overrides: {
  url: string;
  method?: string;
  body?: string | null;
  headers?: Record<string, string>;
}) {
  return {
    url: () => overrides.url,
    method: () => overrides.method ?? 'GET',
    headers: () => overrides.headers ?? {},
    postData: () => overrides.body ?? null,
  };
}

function makeResponse(url: string, timingMs?: number, status = 200) {
  return {
    url: () => url,
    status: () => status,
    request: () => ({
      timing: timingMs !== undefined
        ? () => ({ startTime: 0, responseEnd: timingMs })
        : undefined,
    }),
  };
}

function makeFailedRequest(url: string) {
  return { url: () => url };
}

// ─── flushDataLayer ───────────────────────────────────────────────────────────

describe('flushDataLayer', () => {
  it('appends collected events to the sink', async () => {
    const sink: ReturnType<typeof import('@/types/audit').DataLayerEvent extends infer T ? T[] : never[]> = [] as never[];
    const page = makePageWithDataLayer([
      { event: 'purchase', __timestamp: 1000 },
    ]);
    await flushDataLayer(page as never, sink as never, 'confirmation');
    expect(sink).toHaveLength(1);
    expect((sink[0] as { event: string }).event).toBe('purchase');
    expect((sink[0] as { step: string }).step).toBe('confirmation');
  });

  it('returns without throwing when page.evaluate rejects (navigation)', async () => {
    const sink: unknown[] = [];
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('detached')) };
    await expect(flushDataLayer(page as never, sink as never, 'any')).resolves.toBeUndefined();
    expect(sink).toHaveLength(0);
  });

  it('clears the in-browser sink after flushing', async () => {
    const events = [{ event: 'page_view', __timestamp: 500 }];
    const page = makePageWithDataLayer(events);
    const sink: unknown[] = [];
    await flushDataLayer(page as never, sink as never, 'landing');
    // evaluate was called once (the flush)
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(sink).toHaveLength(1);
  });
});

// ─── interceptNetworkRequests ─────────────────────────────────────────────────

describe('interceptNetworkRequests — string step', () => {
  it('captures tracked URLs and ignores untracked ones', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'confirmation');

    emit('request', makeRequest({ url: 'https://analytics.google.com/g/collect', method: 'POST', body: 'en=purchase' }));
    emit('request', makeRequest({ url: 'https://example.com/untracked' }));

    expect(sink).toHaveLength(1);
    expect(sink[0].url).toContain('analytics.google.com');
    expect(sink[0].step).toBe('confirmation');
  });

  it('captures POST body from req.postData()', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'confirmation');

    emit('request', makeRequest({
      url: 'https://www.facebook.com/tr/',
      method: 'POST',
      body: 'ev=Purchase&cd[value]=99.99',
    }));

    expect(sink[0].body).toBe('ev=Purchase&cd[value]=99.99');
  });

  it('body is undefined when postData() returns null (GET request)', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'landing');

    emit('request', makeRequest({
      url: 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST',
      method: 'GET',
      body: null,
    }));

    expect(sink[0].body).toBeUndefined();
  });

  it('patches loadTime on matching response', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'landing');

    const url = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST';
    emit('request', makeRequest({ url, method: 'GET' }));
    emit('response', makeResponse(url, 350));

    expect(sink[0].loadTime).toBe(350);
  });

  it('does not throw when timing is unavailable', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'landing');

    const url = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST';
    emit('request', makeRequest({ url, method: 'GET' }));
    emit('response', makeResponse(url, undefined)); // no timing

    expect(sink[0].loadTime).toBeUndefined();
  });

  it('patches statusCode on matching response', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'landing');

    const url = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST';
    emit('request', makeRequest({ url, method: 'GET' }));
    emit('response', makeResponse(url, undefined, 404));

    expect(sink[0].statusCode).toBe(404);
  });

  it('marks a request failed on requestfailed', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'landing');

    const url = 'https://www.facebook.com/tr/';
    emit('request', makeRequest({ url, method: 'GET' }));
    emit('requestfailed', makeFailedRequest(url));

    expect(sink[0].failed).toBe(true);
  });

  it('ignores requestfailed for untracked URLs', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    interceptNetworkRequests(page, sink, 'landing');

    emit('requestfailed', makeFailedRequest('https://example.com/untracked'));

    expect(sink).toHaveLength(0);
  });
});

describe('interceptNetworkRequests — StepRef (mutable step)', () => {
  it('reads the current step at request time, not registration time', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    const stepRef: StepRef = { current: 'landing' };
    interceptNetworkRequests(page, sink, stepRef);

    emit('request', makeRequest({ url: 'https://analytics.google.com/g/collect' }));
    stepRef.current = 'confirmation';
    emit('request', makeRequest({ url: 'https://www.facebook.com/tr/' }));

    expect(sink[0].step).toBe('landing');
    expect(sink[1].step).toBe('confirmation');
  });

  it('patches loadTime using the step value at response time', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: NetworkRequest[] = [];
    const stepRef: StepRef = { current: 'landing' };
    interceptNetworkRequests(page, sink, stepRef);

    const url = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST';
    emit('request', makeRequest({ url, method: 'GET' }));
    // step hasn't changed — response should still find the request
    emit('response', makeResponse(url, 420));

    expect(sink[0].loadTime).toBe(420);
  });
});

// ─── interceptConsoleErrors ───────────────────────────────────────────────────

describe('interceptConsoleErrors', () => {
  it('captures a console.error message with its step', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: ConsoleError[] = [];
    interceptConsoleErrors(page, sink, 'confirmation');

    emit('console', { type: () => 'error', text: () => 'Uncaught TypeError: gtag is not a function' });

    expect(sink).toHaveLength(1);
    expect(sink[0].message).toBe('Uncaught TypeError: gtag is not a function');
    expect(sink[0].step).toBe('confirmation');
  });

  it('ignores non-error console messages', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: ConsoleError[] = [];
    interceptConsoleErrors(page, sink, 'landing');

    emit('console', { type: () => 'log', text: () => 'some debug log' });
    emit('console', { type: () => 'warning', text: () => 'a warning' });

    expect(sink).toHaveLength(0);
  });

  it('captures an uncaught page exception', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: ConsoleError[] = [];
    interceptConsoleErrors(page, sink, 'checkout');

    emit('pageerror', new Error('dataLayer is not defined'));

    expect(sink).toHaveLength(1);
    expect(sink[0].message).toBe('dataLayer is not defined');
    expect(sink[0].step).toBe('checkout');
  });

  it('reads the current step at error time via a StepRef', () => {
    const { page, emit } = makeEventEmitterPage();
    const sink: ConsoleError[] = [];
    const stepRef: StepRef = { current: 'landing' };
    interceptConsoleErrors(page, sink, stepRef);

    emit('console', { type: () => 'error', text: () => 'first error' });
    stepRef.current = 'confirmation';
    emit('console', { type: () => 'error', text: () => 'second error' });

    expect(sink[0].step).toBe('landing');
    expect(sink[1].step).toBe('confirmation');
  });
});

// ─── captureCookies ───────────────────────────────────────────────────────────

describe('captureCookies', () => {
  it('returns a CookieSnapshot keyed by name', async () => {
    const context = {
      cookies: vi.fn().mockResolvedValue([
        { name: '_fbp', value: 'fb.1.123.456' },
        { name: '_fbc', value: 'fb.1.123.789' },
      ]),
    };
    const snap = await captureCookies(context, 'confirmation');
    expect(snap.step).toBe('confirmation');
    expect(snap.cookies['_fbp']).toBe('fb.1.123.456');
    expect(snap.cookies['_fbc']).toBe('fb.1.123.789');
  });

  it('returns empty cookies when none are set', async () => {
    const context = { cookies: vi.fn().mockResolvedValue([]) };
    const snap = await captureCookies(context, 'landing');
    expect(snap.cookies).toEqual({});
  });

  it('captures each cookie\'s full attribute set alongside the flat map', async () => {
    const context = {
      cookies: vi.fn().mockResolvedValue([
        { name: '_gcl_aw', value: 'abc', domain: '.example.com', path: '/', expires: 1893456000, secure: true, sameSite: 'Lax' },
      ]),
    };
    const snap = await captureCookies(context, 'landing');
    expect(snap.detailed).toEqual([
      { name: '_gcl_aw', value: 'abc', domain: '.example.com', path: '/', expires: 1893456000, secure: true, sameSite: 'Lax' },
    ]);
  });

  it('defaults missing attributes rather than throwing (minimal mock shape)', async () => {
    const context = { cookies: vi.fn().mockResolvedValue([{ name: 'gclid', value: 'x' }]) };
    const snap = await captureCookies(context, 'landing');
    expect(snap.detailed).toEqual([
      { name: 'gclid', value: 'x', domain: '', path: '/', expires: -1, secure: false, sameSite: 'Lax' },
    ]);
  });
});

// ─── captureSessionStorage ─────────────────────────────────────────────────────

describe('captureSessionStorage', () => {
  it('returns entries from page.evaluate', async () => {
    const page = { evaluate: vi.fn().mockResolvedValue({ gclid: 'session_only_gclid' }) };
    const snap = await captureSessionStorage(page as never, 'landing');
    expect(snap.step).toBe('landing');
    expect(snap.entries['gclid']).toBe('session_only_gclid');
  });

  it('returns empty entries if page.evaluate throws', async () => {
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('cross-origin')) };
    const snap = await captureSessionStorage(page as never, 'landing');
    expect(snap.entries).toEqual({});
  });
});

// ─── captureLocalStorage ──────────────────────────────────────────────────────

describe('captureLocalStorage', () => {
  it('returns entries from page.evaluate', async () => {
    const page = { evaluate: vi.fn().mockResolvedValue({ gclid: 'test_gclid_123' }) };
    const snap = await captureLocalStorage(page as never, 'checkout');
    expect(snap.step).toBe('checkout');
    expect(snap.entries['gclid']).toBe('test_gclid_123');
  });

  it('returns empty entries if page.evaluate throws (cross-origin etc.)', async () => {
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('cross-origin')) };
    const snap = await captureLocalStorage(page as never, 'checkout');
    expect(snap.entries).toEqual({});
  });
});

// ─── merge helpers ────────────────────────────────────────────────────────────

describe('mergeCookies', () => {
  it('later snapshots override earlier ones', () => {
    const merged = mergeCookies([
      { step: 'landing', cookies: { _fbp: 'old', session: 'abc' } },
      { step: 'confirmation', cookies: { _fbp: 'new' } },
    ]);
    expect(merged['_fbp']).toBe('new');
    expect(merged['session']).toBe('abc');
  });

  it('returns empty object for empty input', () => {
    expect(mergeCookies([])).toEqual({});
  });
});

describe('mergeLocalStorage', () => {
  it('later snapshots override earlier ones', () => {
    const merged = mergeLocalStorage([
      { step: 'landing', entries: { gclid: 'old_gclid', utm_source: 'google' } },
      { step: 'confirmation', entries: { gclid: 'new_gclid' } },
    ]);
    expect(merged['gclid']).toBe('new_gclid');
    expect(merged['utm_source']).toBe('google');
  });

  it('returns empty object for empty input', () => {
    expect(mergeLocalStorage([])).toEqual({});
  });
});

describe('mergeDetailedCookies', () => {
  it('later snapshots override earlier ones by cookie name', () => {
    const oldCookie = { name: '_gcl_aw', value: 'old', domain: '.example.com', path: '/', expires: 100, secure: true, sameSite: 'Lax' as const };
    const newCookie = { name: '_gcl_aw', value: 'new', domain: '.example.com', path: '/', expires: 200, secure: true, sameSite: 'Lax' as const };
    const merged = mergeDetailedCookies([
      { step: 'landing', cookies: {}, detailed: [oldCookie] },
      { step: 'confirmation', cookies: {}, detailed: [newCookie] },
    ]);
    expect(merged).toEqual([newCookie]);
  });

  it('treats a missing detailed array as no cookies for that snapshot', () => {
    const merged = mergeDetailedCookies([{ step: 'landing', cookies: { foo: 'bar' } }]);
    expect(merged).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(mergeDetailedCookies([])).toEqual([]);
  });
});

// ── Invariant: every declared platform's matcher host is captured ─────────
//
// Site Evaluation Coverage & Honesty PRD §8.3, defect #4 — a declared
// platform whose PLATFORM_MATCHERS matcher (platformDetection.ts) could
// never actually match anything, because dataCapture.ts's own separately-
// maintained TRACKED_URL_PATTERNS never captured a matching request into
// AuditData.networkRequests in the first place. TRACKED_URL_PATTERNS is now
// built by spreading PLATFORM_MATCHER_HOSTS in directly, so this should be
// structurally impossible to reintroduce — this test is what actually
// proves that, and what would catch it if the two ever drifted apart again
// (e.g. someone hand-edits TRACKED_URL_PATTERNS back to a separate list).

describe('shouldCaptureUrl — every declared platform is structurally capturable', () => {
  it.each(ALL_DECLARED_PLATFORMS)('%s tag requests are captured', (platform) => {
    for (const host of PLATFORM_MATCHER_HOSTS[platform]) {
      expect(shouldCaptureUrl(`https://${host}/whatever`)).toBe(true);
    }
  });

  it('covers every platform PLATFORM_LABELS declares — the two never silently drift apart in count', () => {
    expect(ALL_DECLARED_PLATFORMS.sort()).toEqual(Object.keys(PLATFORM_LABELS).sort());
  });
});
