/**
 * Unit tests for journeySimulator's probeDomainReachable (Check Register v2
 * L0.4 — "Product domain reachable"). global.fetch is mocked; no network or
 * browser required.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeDomainReachable } from '../journeySimulator';

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
