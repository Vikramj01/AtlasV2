/**
 * Unit tests for detectCommercePlatform (Signal vs Implementation PRD P1-03).
 */
import { describe, it, expect } from 'vitest';
import { detectCommercePlatform } from '../commercePlatformDetector';
import type { CommercePlatformSignals } from '../commercePlatformDetector';

function makeSignals(overrides: Partial<CommercePlatformSignals> = {}): CommercePlatformSignals {
  return {
    scriptSrcs: [],
    linkHrefs: [],
    hasShopifyGlobal: false,
    hasWooCommerceMarker: false,
    hasHeadlessFrameworkMarker: false,
    generatorMeta: null,
    ...overrides,
  };
}

describe('detectCommercePlatform', () => {
  it('detects classic Shopify via window.Shopify global plus CDN evidence — high confidence', () => {
    const result = detectCommercePlatform(
      makeSignals({ hasShopifyGlobal: true, scriptSrcs: ['https://cdn.shopify.com/s/files/1/theme.js'] }),
    );
    expect(result.platform).toBe('shopify');
    expect(result.confidence).toBe('high');
    expect(result.indicators).toContain('window.Shopify global present');
    expect(result.indicators).toContain('cdn.shopify.com asset reference found');
    expect(result.detected_backend).toBeUndefined();
  });

  it('detects Shopify from CDN asset evidence alone, no theme JS running — medium confidence', () => {
    const result = detectCommercePlatform(
      makeSignals({ hasShopifyGlobal: false, linkHrefs: ['https://cdn.shopify.com/s/files/1/style.css'] }),
    );
    expect(result.platform).toBe('shopify');
    expect(result.confidence).toBe('medium');
    expect(result.indicators).toEqual(['cdn.shopify.com asset reference found']);
  });

  it('detects a headless storefront proxying Shopify backend evidence with no theme JS — the PureBorn case', () => {
    const result = detectCommercePlatform(
      makeSignals({
        hasHeadlessFrameworkMarker: true,
        hasShopifyGlobal: false,
        scriptSrcs: ['https://cdn.shopify.com/s/files/1/product-image.jpg'],
      }),
    );
    expect(result.platform).toBe('headless');
    expect(result.detected_backend).toBe('shopify');
    expect(result.confidence).toBe('medium');
    expect(result.indicators).toEqual(
      expect.arrayContaining([
        'Decoupled frontend framework detected (no server-rendered theme markup)',
        'cdn.shopify.com asset references found with no Shopify theme JS running',
      ]),
    );
  });

  it('prefers headless-with-backend over a bare Shopify match when both a headless marker and window.Shopify would otherwise be ambiguous', () => {
    // hasShopifyGlobal true means the theme JS IS running, so this should NOT be headless
    // even though a headless framework marker is also present (e.g. a Shopify Hydrogen-style setup
    // where the theme JS still initializes) — headless requires the ABSENCE of the Shopify global.
    const result = detectCommercePlatform(
      makeSignals({
        hasHeadlessFrameworkMarker: true,
        hasShopifyGlobal: true,
        scriptSrcs: ['https://cdn.shopify.com/s/files/1/theme.js'],
      }),
    );
    expect(result.platform).toBe('shopify');
  });

  it('detects a headless storefront proxying Salesforce Commerce Cloud backend evidence', () => {
    const result = detectCommercePlatform(
      makeSignals({
        hasHeadlessFrameworkMarker: true,
        scriptSrcs: ['https://example.com/on/demandware.store/Sites-example-Site/default/checkout'],
      }),
    );
    expect(result.platform).toBe('headless');
    expect(result.detected_backend).toBe('salesforce_commerce_cloud');
    expect(result.confidence).toBe('medium');
  });

  it('detects Salesforce Commerce Cloud via demandware asset evidence (non-headless)', () => {
    const result = detectCommercePlatform(
      makeSignals({ scriptSrcs: ['https://example.com/on/demandware.static/Sites-example-Site/default/app.js'] }),
    );
    expect(result.platform).toBe('salesforce_commerce_cloud');
    expect(result.confidence).toBe('high');
    expect(result.indicators[0]).toContain('demandware');
  });

  it('detects WooCommerce via a page class marker', () => {
    const result = detectCommercePlatform(makeSignals({ hasWooCommerceMarker: true }));
    expect(result.platform).toBe('woocommerce');
    expect(result.confidence).toBe('high');
    expect(result.indicators).toEqual(['WooCommerce class marker found on the page']);
  });

  it('detects WooCommerce via an asset URL when no page class marker is present', () => {
    const result = detectCommercePlatform(
      makeSignals({ scriptSrcs: ['https://example.com/wp-content/plugins/woocommerce/assets/js/frontend.js'] }),
    );
    expect(result.platform).toBe('woocommerce');
    expect(result.confidence).toBe('high');
    expect(result.indicators[0]).toContain('woocommerce');
  });

  it('detects a generic headless SPA when no known commerce backend evidence is present', () => {
    const result = detectCommercePlatform(makeSignals({ hasHeadlessFrameworkMarker: true }));
    expect(result.platform).toBe('spa');
    expect(result.confidence).toBe('medium');
    expect(result.indicators).toEqual([
      'Decoupled frontend framework detected (no server-rendered theme markup)',
      'No known commerce-backend asset pattern found',
    ]);
    expect(result.detected_backend).toBeUndefined();
  });

  it('falls back to custom with a generator meta indicator when present', () => {
    const result = detectCommercePlatform(makeSignals({ generatorMeta: 'WordPress 6.4' }));
    expect(result.platform).toBe('custom');
    expect(result.confidence).toBe('low');
    expect(result.indicators).toEqual(['<meta name="generator"> tag: "WordPress 6.4"']);
  });

  it('falls back to custom with no indicators when nothing at all was detected', () => {
    const result = detectCommercePlatform(makeSignals());
    expect(result.platform).toBe('custom');
    expect(result.confidence).toBe('low');
    expect(result.indicators).toEqual([]);
  });

  it('never emits shopify_plus — no signal in this detector distinguishes it from classic Shopify', () => {
    const result = detectCommercePlatform(
      makeSignals({ hasShopifyGlobal: true, scriptSrcs: ['https://cdn.shopify.com/s/files/1/theme.js'] }),
    );
    expect(result.platform).not.toBe('shopify_plus');
  });

  it('prioritizes Shopify over Salesforce Commerce Cloud and WooCommerce when multiple evidence types are present', () => {
    const result = detectCommercePlatform(
      makeSignals({
        hasShopifyGlobal: true,
        hasWooCommerceMarker: true,
        scriptSrcs: [
          'https://cdn.shopify.com/s/files/1/theme.js',
          'https://example.com/on/demandware.static/app.js',
        ],
      }),
    );
    expect(result.platform).toBe('shopify');
  });
});
