/**
 * Unit tests for buildImplementationArchitectureSummary / confidenceForPath
 * (Signal vs Implementation PRD P1-05).
 */
import { describe, it, expect } from 'vitest';
import { buildImplementationArchitectureSummary, confidenceForPath } from '../implementationArchitectureSummary';
import type { RequestInitiator, CommercePlatformDetection, ImplementationPath } from '@/types/audit';

function makeInitiator(overrides: Partial<RequestInitiator> & { url: string }): RequestInitiator {
  return {
    step: 'landing',
    page_url: 'https://shop.example.com/',
    initiator_type: 'script',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('confidenceForPath', () => {
  it('is high for a directly-matched loader/script path', () => {
    expect(confidenceForPath('GTM')).toBe('high');
    expect(confidenceForPath('DIRECT_SCRIPT')).toBe('high');
  });

  it('is medium for every path derived from indirect/corroborating evidence', () => {
    const indirectPaths: Exclude<ImplementationPath, 'UNKNOWN'>[] = [
      'SHOPIFY_WEB_PIXEL', 'SHOPIFY_APP_PIXEL', 'SHOPIFY_CUSTOM_PIXEL', 'SHOPIFY_THEME', 'SERVER_SIDE', 'HYBRID',
    ];
    for (const path of indirectPaths) {
      expect(confidenceForPath(path)).toBe('medium');
    }
  });
});

describe('buildImplementationArchitectureSummary', () => {
  it('returns undefined when request_provenance is absent — never a fabricated empty-array shell', () => {
    expect(buildImplementationArchitectureSummary({})).toBeUndefined();
  });

  it('returns undefined when request_provenance is an empty array', () => {
    expect(buildImplementationArchitectureSummary({ request_provenance: [] })).toBeUndefined();
  });

  it('puts a directly-attributed path in paths with a derived confidence, and threads commerce_platform through unchanged', () => {
    const commercePlatform: CommercePlatformDetection = { platform: 'shopify', confidence: 'high', indicators: ['window.Shopify global present'] };
    const summary = buildImplementationArchitectureSummary({
      request_provenance: [
        makeInitiator({ url: 'https://www.facebook.com/tr/', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
      ],
      commerce_platform: commercePlatform,
    });
    expect(summary).toBeDefined();
    expect(summary?.commerce_platform).toEqual(commercePlatform);
    expect(summary?.paths).toEqual([
      {
        platform: 'meta', page: 'landing', path: 'DIRECT_SCRIPT', confidence: 'high',
        request_urls: ['https://www.facebook.com/tr/'],
        evidence: ["Initiated by meta's own script, loaded directly (not via GTM): https://connect.facebook.net/en_US/fbevents.js"],
      },
    ]);
    expect(summary?.unattributed).toEqual([]);
    expect(summary?.duplicates).toEqual([]);
  });

  it('routes an UNKNOWN classification to unattributed, not paths — never a fabricated confidence', () => {
    const summary = buildImplementationArchitectureSummary({
      request_provenance: [makeInitiator({ url: 'https://www.facebook.com/tr/', initiator_type: 'UNKNOWN' })],
    });
    expect(summary?.paths).toEqual([]);
    expect(summary?.unattributed).toHaveLength(1);
    expect(summary?.unattributed[0]).toMatchObject({ platform: 'meta', page: 'landing' });
    expect(summary?.commerce_platform).toBeUndefined();
  });

  it('classifies a cross-origin sandboxed frame as SHOPIFY_WEB_PIXEL (medium confidence) when commerce_platform confirms Shopify', () => {
    const summary = buildImplementationArchitectureSummary({
      request_provenance: [
        makeInitiator({
          url: 'https://www.facebook.com/tr/',
          frame_url: 'https://web-pixel-sandbox.shopifysvc.com/abc123',
          initiator_type: 'UNKNOWN',
        }),
      ],
      commerce_platform: { platform: 'headless', confidence: 'medium', indicators: [], detected_backend: 'shopify' },
    });
    expect(summary?.paths).toEqual([
      expect.objectContaining({ platform: 'meta', path: 'SHOPIFY_WEB_PIXEL', confidence: 'medium' }),
    ]);
    expect(summary?.unattributed).toEqual([]);
  });

  it('surfaces a P1-06 duplicate finding when the same platform+page carries two distinct known paths', () => {
    const summary = buildImplementationArchitectureSummary({
      request_provenance: [
        makeInitiator({ url: 'https://www.facebook.com/tr/?a=1', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js' }),
        makeInitiator({
          url: 'https://www.facebook.com/tr/?a=2',
          initiator_script_url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC',
          initiator_stack: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'],
        }),
      ],
    });
    expect(summary?.duplicates).toHaveLength(1);
    expect(summary?.duplicates[0]).toMatchObject({ platform: 'meta', page: 'landing' });
    expect(summary?.duplicates[0].paths.sort()).toEqual(['DIRECT_SCRIPT', 'GTM']);
    // Both rows still appear individually in paths — duplicates is a highlight, not a replacement.
    expect(summary?.paths).toHaveLength(2);
  });

  it('ignores requests matching no declared-platform host at all (e.g. GA4)', () => {
    const summary = buildImplementationArchitectureSummary({
      request_provenance: [makeInitiator({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC' })],
    });
    expect(summary?.paths).toEqual([]);
    expect(summary?.unattributed).toEqual([]);
    expect(summary?.duplicates).toEqual([]);
  });
});
