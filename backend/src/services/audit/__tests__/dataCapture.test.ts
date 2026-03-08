/**
 * Unit tests for dataCapture helpers.
 * All Playwright types are mocked inline — no real browser required.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  flushDataLayer,
  interceptNetworkRequests,
  captureCookies,
  captureLocalStorage,
  mergeCookies,
  mergeLocalStorage,
  type StepRef,
} from '../dataCapture';
import type { NetworkRequest } from '@/types/audit';

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

function makeResponse(url: string, timingMs?: number) {
  return {
    url: () => url,
    request: () => ({
      timing: timingMs !== undefined
        ? () => ({ startTime: 0, responseEnd: timingMs })
        : undefined,
    }),
  };
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
