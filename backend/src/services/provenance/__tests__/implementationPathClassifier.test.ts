/**
 * Unit tests for classifyImplementationPaths (Signal vs Implementation PRD P1-02, P1-04).
 */
import { describe, it, expect } from 'vitest';
import { classifyImplementationPaths } from '../implementationPathClassifier';
import type { RequestInitiator, CommercePlatformDetection } from '@/types/audit';

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

// ─── SHOPIFY_WEB_PIXEL (Signal vs Implementation PRD P1-04, path-only per the
// Sprint 10 spike) — activates only when a cross-origin sandboxed-frame
// finding coincides with P1-03's own commerce-platform evidence, never from
// the sandboxed-frame shape alone. ─────────────────────────────────────────
describe('classifyImplementationPaths — SHOPIFY_WEB_PIXEL (P1-04)', () => {
  const SANDBOXED_INITIATOR = makeInitiator({
    url: 'https://www.facebook.com/tr/',
    page_url: 'https://shop.example.com/',
    frame_url: 'https://web-pixel-sandbox.shopifysvc.com/abc123',
    initiator_type: 'UNKNOWN',
  });

  it('classifies SHOPIFY_WEB_PIXEL when commerce-platform detection confirms classic Shopify', () => {
    const shopify: CommercePlatformDetection = { platform: 'shopify', confidence: 'high', indicators: ['window.Shopify global present'] };
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR], shopify);
    expect(result[0].path).toBe('SHOPIFY_WEB_PIXEL');
    expect(result[0].evidence[0]).toContain('Web Pixels Manager sandbox');
    expect(result[0].evidence[0]).toContain('Path-only');
  });

  it('classifies SHOPIFY_WEB_PIXEL when commerce-platform detection confirms Shopify Plus', () => {
    const shopifyPlus: CommercePlatformDetection = { platform: 'shopify_plus', confidence: 'high', indicators: [] };
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR], shopifyPlus);
    expect(result[0].path).toBe('SHOPIFY_WEB_PIXEL');
  });

  it('classifies SHOPIFY_WEB_PIXEL for a headless storefront proxying a Shopify backend (the PureBorn case)', () => {
    const headlessShopify: CommercePlatformDetection = {
      platform: 'headless', confidence: 'medium', indicators: ['cdn.shopify.com asset references found'], detected_backend: 'shopify',
    };
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR], headlessShopify);
    expect(result[0].path).toBe('SHOPIFY_WEB_PIXEL');
  });

  it('never names the specific pixel sub-type (theme/app/custom) — path-only stays UNKNOWN-adjacent, not a guessed sub-type', () => {
    const shopify: CommercePlatformDetection = { platform: 'shopify', confidence: 'high', indicators: [] };
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR], shopify);
    expect(['SHOPIFY_APP_PIXEL', 'SHOPIFY_CUSTOM_PIXEL', 'SHOPIFY_THEME']).not.toContain(result[0].path);
  });

  it('stays UNKNOWN when commerce-platform detection is absent entirely — never guessed from the sandboxed frame alone', () => {
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR]);
    expect(result[0].path).toBe('UNKNOWN');
  });

  it('stays UNKNOWN when commerce-platform detection found a non-Shopify platform', () => {
    const woocommerce: CommercePlatformDetection = { platform: 'woocommerce', confidence: 'high', indicators: ['WooCommerce class marker found on the page'] };
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR], woocommerce);
    expect(result[0].path).toBe('UNKNOWN');
  });

  it('stays UNKNOWN for a headless storefront whose detected backend is not Shopify', () => {
    const headlessSfcc: CommercePlatformDetection = {
      platform: 'headless', confidence: 'medium', indicators: [], detected_backend: 'salesforce_commerce_cloud',
    };
    const result = classifyImplementationPaths([SANDBOXED_INITIATOR], headlessSfcc);
    expect(result[0].path).toBe('UNKNOWN');
  });

  it('does not activate SHOPIFY_WEB_PIXEL for a non-sandboxed request even with Shopify confirmed — commerce-platform evidence alone is not enough', () => {
    const shopify: CommercePlatformDetection = { platform: 'shopify', confidence: 'high', indicators: [] };
    const result = classifyImplementationPaths(
      [makeInitiator({ url: 'https://www.facebook.com/tr/', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' })],
      shopify,
    );
    expect(result[0].path).toBe('DIRECT_SCRIPT');
  });
});
