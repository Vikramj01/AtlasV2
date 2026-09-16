/**
 * Unit tests for detectDuplicateImplementations (Signal vs Implementation PRD P1-06).
 */
import { describe, it, expect } from 'vitest';
import { detectDuplicateImplementations } from '../duplicateImplementationDetector';
import type { ImplementationPathClassification } from '@/types/audit';

function makeClassification(overrides: Partial<ImplementationPathClassification> & { path: ImplementationPathClassification['path'] }): ImplementationPathClassification {
  return {
    platform: 'meta',
    page: 'landing',
    request_urls: [],
    evidence: [],
    ...overrides,
  };
}

describe('detectDuplicateImplementations', () => {
  it('flags a platform reaching the same page through two distinct known paths', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ path: 'GTM', request_urls: ['https://www.facebook.com/tr/?a=1'], evidence: ['via gtm.js'] }),
      makeClassification({ path: 'DIRECT_SCRIPT', request_urls: ['https://www.facebook.com/tr/?a=2'], evidence: ['via connect.facebook.net'] }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ platform: 'meta', page: 'landing' });
    expect(findings[0].paths.sort()).toEqual(['DIRECT_SCRIPT', 'GTM']);
    expect(findings[0].request_urls).toEqual(['https://www.facebook.com/tr/?a=1', 'https://www.facebook.com/tr/?a=2']);
    expect(findings[0].evidence).toEqual(['via gtm.js', 'via connect.facebook.net']);
  });

  it('does not flag a single path, even with many requests merged into one row', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ path: 'DIRECT_SCRIPT', request_urls: ['https://www.facebook.com/tr/?a=1', 'https://www.facebook.com/tr/?a=2'] }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not flag two UNKNOWN rows for the same platform+page — unknown twice is not two confirmed mechanisms', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ path: 'UNKNOWN', evidence: ['reason A'] }),
      makeClassification({ path: 'UNKNOWN', evidence: ['reason B'] }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not flag a known path alongside an UNKNOWN one — only known paths count toward duplication', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ path: 'GTM' }),
      makeClassification({ path: 'UNKNOWN' }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('keeps findings separate per page for the same platform', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ path: 'GTM', page: 'landing' }),
      makeClassification({ path: 'DIRECT_SCRIPT', page: 'landing' }),
      makeClassification({ path: 'GTM', page: 'checkout' }),
      makeClassification({ path: 'DIRECT_SCRIPT', page: 'checkout' }),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.page).sort()).toEqual(['checkout', 'landing']);
  });

  it('keeps findings separate per platform on the same page', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ platform: 'meta', path: 'GTM' }),
      makeClassification({ platform: 'meta', path: 'DIRECT_SCRIPT' }),
      makeClassification({ platform: 'tiktok', path: 'GTM' }),
      makeClassification({ platform: 'tiktok', path: 'DIRECT_SCRIPT' }),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.platform).sort()).toEqual(['meta', 'tiktok']);
  });

  it('does not flag a platform with a single known path plus other platforms/pages with their own single paths', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ platform: 'meta', page: 'landing', path: 'GTM' }),
      makeClassification({ platform: 'tiktok', page: 'landing', path: 'DIRECT_SCRIPT' }),
      makeClassification({ platform: 'meta', page: 'checkout', path: 'DIRECT_SCRIPT' }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('dedupes identical request URLs/evidence across the merged paths', () => {
    const findings = detectDuplicateImplementations([
      makeClassification({ path: 'GTM', request_urls: ['https://www.facebook.com/tr/?a=1'], evidence: ['shared evidence'] }),
      makeClassification({ path: 'DIRECT_SCRIPT', request_urls: ['https://www.facebook.com/tr/?a=1'], evidence: ['shared evidence'] }),
    ]);
    expect(findings[0].request_urls).toEqual(['https://www.facebook.com/tr/?a=1']);
    expect(findings[0].evidence).toEqual(['shared evidence']);
  });

  it('returns an empty array for no classifications', () => {
    expect(detectDuplicateImplementations([])).toEqual([]);
  });

  // The full pipeline shape: classifyImplementationPaths() feeding directly
  // into this detector, matching the sprint plan's "close to free" claim.
  it('composes with classifyImplementationPaths end to end', async () => {
    const { classifyImplementationPaths } = await import('../implementationPathClassifier');
    const classifications = classifyImplementationPaths([
      {
        url: 'https://www.facebook.com/tr/?a=1', step: 'landing', page_url: 'https://shop.example.com/',
        initiator_type: 'script', initiator_script_url: 'https://connect.facebook.net/en_US/fbevents.js', timestamp: Date.now(),
      },
      {
        url: 'https://www.facebook.com/tr/?a=2', step: 'landing', page_url: 'https://shop.example.com/',
        initiator_type: 'script', initiator_script_url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC',
        initiator_stack: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'], timestamp: Date.now(),
      },
    ]);
    const findings = detectDuplicateImplementations(classifications);
    expect(findings).toHaveLength(1);
    expect(findings[0].platform).toBe('meta');
    expect(findings[0].paths.sort()).toEqual(['DIRECT_SCRIPT', 'GTM']);
  });

  // P1-04's own "close to free" case: a GTM tag plus a genuine Shopify Web
  // Pixels Manager sandbox both firing the same platform's signal on one
  // page — the highest-commercial-value shape this whole detector exists
  // for on a Shopify site, per duplicateImplementationDetector.ts's header.
  it('composes with classifyImplementationPaths end to end for a GTM-plus-Shopify-Web-Pixel duplicate', async () => {
    const { classifyImplementationPaths } = await import('../implementationPathClassifier');
    const classifications = classifyImplementationPaths(
      [
        {
          url: 'https://www.facebook.com/tr/?a=1', step: 'landing', page_url: 'https://shop.example.com/',
          initiator_type: 'UNKNOWN', frame_url: 'https://web-pixel-sandbox.shopifysvc.com/abc123', timestamp: Date.now(),
        },
        {
          url: 'https://www.facebook.com/tr/?a=2', step: 'landing', page_url: 'https://shop.example.com/',
          initiator_type: 'script', initiator_script_url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC',
          initiator_stack: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC'], timestamp: Date.now(),
        },
      ],
      { platform: 'shopify', confidence: 'high', indicators: ['window.Shopify global present'] },
    );
    const findings = detectDuplicateImplementations(classifications);
    expect(findings).toHaveLength(1);
    expect(findings[0].platform).toBe('meta');
    expect(findings[0].paths.sort()).toEqual(['GTM', 'SHOPIFY_WEB_PIXEL']);
  });
});
