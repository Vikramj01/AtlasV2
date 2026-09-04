/**
 * Unit tests for journeySimulator's probeDomainReachable (Check Register v2
 * L0.4 — "Product domain reachable"), scanOutboundCrossDomainLinks
 * (L4.1/L4.2), and normalizeUrlForCoverage (StepCoverage's distinct-from-
 * landing comparison — Site Evaluation Coverage & Honesty PRD, Phase 1).
 * global.fetch is mocked; no network or browser required.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeDomainReachable, hostnameOf, scanOutboundCrossDomainLinks, normalizeUrlForCoverage } from '../journeySimulator';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('probeDomainReachable', () => {
  it('returns true for a 2xx/3xx/4xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    await expect(probeDomainReachable('https://app.example.com')).resolves.toBe(true);
  });

  it('returns true for a 401/403 auth wall — the door exists even if it does not open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    await expect(probeDomainReachable('https://app.example.com')).resolves.toBe(true);
  });

  it('returns false for a 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503 }));
    await expect(probeDomainReachable('https://app.example.com')).resolves.toBe(false);
  });

  it('returns false when fetch rejects (DNS failure, connection refused, etc.)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    await expect(probeDomainReachable('https://nonexistent.example.com')).resolves.toBe(false);
  });

  it('returns false when the request times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })),
    );
    await expect(probeDomainReachable('https://slow.example.com', 10)).resolves.toBe(false);
  });
});

describe('hostnameOf', () => {
  it('strips a leading www.', () => {
    expect(hostnameOf('https://www.example.com/path')).toBe('example.com');
  });

  it('returns the bare hostname when there is no www.', () => {
    expect(hostnameOf('https://app.example.com/path?x=1')).toBe('app.example.com');
  });

  it('returns undefined for an unparseable URL', () => {
    expect(hostnameOf('not a url')).toBeUndefined();
  });
});

describe('scanOutboundCrossDomainLinks', () => {
  function makePage(hrefs: string[]) {
    return { evaluate: vi.fn().mockResolvedValue(hrefs) };
  }

  it('returns zero counts when no target hosts are given', async () => {
    const page = makePage(['https://app.example.com/']);
    await expect(scanOutboundCrossDomainLinks(page, [])).resolves.toEqual({ total: 0, withGl: 0 });
  });

  it('counts links to a target host and how many carry _gl', async () => {
    const page = makePage([
      'https://app.example.com/dashboard?_gl=1abc123',
      'https://app.example.com/pricing',
      'https://unrelated.com/',
    ]);
    await expect(scanOutboundCrossDomainLinks(page, ['app.example.com'])).resolves.toEqual({ total: 2, withGl: 1 });
  });

  it('ignores unparseable hrefs and links to non-target hosts', async () => {
    const page = makePage(['javascript:void(0)', 'https://other.com/']);
    await expect(scanOutboundCrossDomainLinks(page, ['app.example.com'])).resolves.toEqual({ total: 0, withGl: 0 });
  });

  it('returns zero counts when page.evaluate throws', async () => {
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('detached')) };
    await expect(scanOutboundCrossDomainLinks(page, ['app.example.com'])).resolves.toEqual({ total: 0, withGl: 0 });
  });
});

describe('normalizeUrlForCoverage', () => {
  it('strips a trailing slash', () => {
    expect(normalizeUrlForCoverage('https://example.com/path/')).toBe(normalizeUrlForCoverage('https://example.com/path'));
  });

  it('never strips the root path down to nothing', () => {
    expect(normalizeUrlForCoverage('https://example.com')).toBe(normalizeUrlForCoverage('https://example.com/'));
  });

  it('drops the hash', () => {
    expect(normalizeUrlForCoverage('https://example.com/path#section')).toBe(normalizeUrlForCoverage('https://example.com/path'));
  });

  it('drops query params — required so injected synthetic click IDs/UTMs never affect the comparison', () => {
    expect(normalizeUrlForCoverage('https://example.com/path?gclid=test_gclid_123&utm_source=atlas_audit'))
      .toBe(normalizeUrlForCoverage('https://example.com/path'));
  });

  it('lowercases the host and path', () => {
    expect(normalizeUrlForCoverage('https://EXAMPLE.com/Path')).toBe(normalizeUrlForCoverage('https://example.com/path'));
  });

  it('resolves a protocol-relative URL against the placeholder base', () => {
    expect(normalizeUrlForCoverage('//example.com/path')).toBe(normalizeUrlForCoverage('https://example.com/path'));
  });

  it('distinguishes genuinely different paths', () => {
    expect(normalizeUrlForCoverage('https://example.com/checkout')).not.toBe(normalizeUrlForCoverage('https://example.com/'));
  });

  it('returns undefined for an unparseable URL', () => {
    expect(normalizeUrlForCoverage('not a url')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeUrlForCoverage(undefined)).toBeUndefined();
  });
});
