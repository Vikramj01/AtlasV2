/**
 * Unit tests for classifyImplementationPaths (Signal vs Implementation PRD P1-02).
 */
import { describe, it, expect } from 'vitest';
import { classifyImplementationPaths } from '../implementationPathClassifier';
import type { RequestInitiator } from '@/types/audit';

function makeInitiator(overrides: Partial<RequestInitiator> & { url: string }): RequestInitiator {
  return {
    step: 'landing',
    page_url: 'https://shop.example.com/',
    initiator_type: 'script',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('classifyImplementationPaths', () => {
  it('classifies GTM when the initiator chain includes a gtm.js loader', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://www.facebook.com/tr/?id=123',
        initiator_script_url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC',
        initiator_stack: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'],
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ platform: 'meta', page: 'landing', path: 'GTM' });
    expect(result[0].evidence[0]).toContain('gtm.js');
  });

  it('classifies GTM when the GTM loader appears deeper in the stack, not just the innermost frame', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://analytics.tiktok.com/api/v2/pixel',
        initiator_script_url: 'https://analytics.tiktok.com/i18n/pixel/events.js',
        initiator_stack: ['https://www.googletagmanager.com/gtm.js?id=GTM-XYZ', 'https://analytics.tiktok.com/i18n/pixel/events.js'],
      }),
    ]);
    expect(result[0].path).toBe('GTM');
  });

  it('classifies a server-side (sGTM) container endpoint as GTM too, via the gtm-msr pattern', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://www.facebook.com/tr/',
        initiator_script_url: 'https://sgtm.example.com/gtm-msr.js',
      }),
    ]);
    expect(result[0].path).toBe('GTM');
  });

  it("classifies DIRECT_SCRIPT when the platform's own loader fired it, with no GTM in the chain", () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://www.facebook.com/tr/?id=123',
        initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js',
      }),
    ]);
    expect(result[0].path).toBe('DIRECT_SCRIPT');
    expect(result[0].evidence[0]).toContain('connect.facebook.net');
  });

  it('classifies google_ads DIRECT_SCRIPT via the AW-specific gtag loader (no dedicated own-loader detector, falls back to PLATFORM_MATCHER_HOSTS)', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://googleadservices.com/pagead/conversion/123',
        initiator_script_url: 'https://www.googletagmanager.com/gtag/js?id=AW-123456',
      }),
    ]);
    expect(result[0]).toMatchObject({ platform: 'google_ads', path: 'DIRECT_SCRIPT' });
  });

  it('does not confuse gtag.js (Google direct loader) with gtm.js (GTM container) — classifies as DIRECT_SCRIPT', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://www.google-analytics.com/g/collect?tid=G-ABC',
        initiator_script_url: 'https://www.googletagmanager.com/gtag/js?id=G-ABC',
      }),
    ]);
    // google-analytics.com isn't a DeclaredPlatform host, so this request itself
    // isn't classified — GA4 isn't one of the 8 ad platforms this register scores.
    expect(result).toHaveLength(0);
  });

  it('ignores a request whose own URL matches no declared-platform host at all', () => {
    const result = classifyImplementationPaths([makeInitiator({ url: 'https://example.com/some-first-party-endpoint' })]);
    expect(result).toHaveLength(0);
  });

  it('classifies UNKNOWN (never fabricates a mechanism) for a request fired from a cross-origin sandboxed frame', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://www.facebook.com/tr/',
        page_url: 'https://shop.example.com/',
        frame_url: 'https://web-pixel-sandbox.shopifysvc.com/abc123',
        initiator_type: 'UNKNOWN',
      }),
    ]);
    expect(result[0].path).toBe('UNKNOWN');
    expect(result[0].evidence[0]).toContain('cross-origin');
    expect(result[0].evidence[0]).not.toContain('Shopify Web Pixel is'); // never asserted as a positive claim
  });

  it('does not treat a same-origin iframe as sandboxed', () => {
    const result = classifyImplementationPaths([
      makeInitiator({
        url: 'https://www.facebook.com/tr/',
        page_url: 'https://shop.example.com/checkout',
        frame_url: 'https://shop.example.com/checkout-widget',
        initiator_type: 'UNKNOWN',
      }),
    ]);
    expect(result[0].evidence[0]).not.toContain('cross-origin');
    expect(result[0].evidence[0]).toContain('genuinely unknown');
  });

  it("classifies UNKNOWN with a distinct explanation for CDP's own UNKNOWN initiator type (preload/sendBeacon/worker)", () => {
    const result = classifyImplementationPaths([
      makeInitiator({ url: 'https://www.facebook.com/tr/', initiator_type: 'UNKNOWN', initiator_script_url: undefined, initiator_stack: undefined }),
    ]);
    expect(result[0].path).toBe('UNKNOWN');
    expect(result[0].evidence[0]).toContain('genuinely unknown, not evidence of absence');
  });

  it('classifies UNKNOWN with a generic explanation when the initiator type is known but the chain matches nothing', () => {
    const result = classifyImplementationPaths([
      makeInitiator({ url: 'https://www.facebook.com/tr/', initiator_type: 'parser' }),
    ]);
    expect(result[0].path).toBe('UNKNOWN');
    expect(result[0].evidence[0]).toContain('parser');
  });

  // P1-06's own signal — a platform genuinely carrying more than one path
  // on the same page must not be collapsed into a single verdict.
  it('emits separate rows for the same platform+page when two genuinely distinct paths are observed', () => {
    const result = classifyImplementationPaths([
      makeInitiator({ url: 'https://www.facebook.com/tr/?a=1', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
      makeInitiator({
        url: 'https://www.facebook.com/tr/?a=2',
        initiator_script_url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC',
        initiator_stack: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'],
      }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.path).sort()).toEqual(['DIRECT_SCRIPT', 'GTM']);
    expect(result.every((r) => r.platform === 'meta' && r.page === 'landing')).toBe(true);
  });

  it('merges repeated hits of the same platform+page+path into one row, deduping request URLs and evidence', () => {
    const result = classifyImplementationPaths([
      makeInitiator({ url: 'https://www.facebook.com/tr/?a=1', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
      makeInitiator({ url: 'https://www.facebook.com/tr/?a=2', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
      makeInitiator({ url: 'https://www.facebook.com/tr/?a=1', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }), // exact duplicate
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].request_urls).toEqual(['https://www.facebook.com/tr/?a=1', 'https://www.facebook.com/tr/?a=2']);
    expect(result[0].evidence).toHaveLength(1);
  });

  it('keeps the same platform+path separate per distinct page', () => {
    const result = classifyImplementationPaths([
      makeInitiator({ url: 'https://www.facebook.com/tr/', step: 'landing', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
      makeInitiator({ url: 'https://www.facebook.com/tr/', step: 'checkout', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.page).sort()).toEqual(['checkout', 'landing']);
  });

  it('returns an empty array for no initiators', () => {
    expect(classifyImplementationPaths([])).toEqual([]);
  });

  it('classifies each declared platform independently for a multi-platform page', () => {
    const result = classifyImplementationPaths([
      makeInitiator({ url: 'https://www.facebook.com/tr/', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
      makeInitiator({ url: 'https://analytics.tiktok.com/api/v2/pixel', initiator_script_url: 'https://analytics.tiktok.com/i18n/pixel/events.js' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.platform === 'meta')?.path).toBe('DIRECT_SCRIPT');
    expect(result.find((r) => r.platform === 'tiktok')?.path).toBe('DIRECT_SCRIPT');
  });
});
