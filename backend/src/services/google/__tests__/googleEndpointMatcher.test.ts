import { describe, it, expect } from 'vitest';
import {
  classifyGoogleRequest,
  classifyGoogleRequests,
  extractGtmContainerIds,
  isSameSite,
  looksLikeGoogleRequestShape,
  parseInlineGtmSnippet,
  summariseGoogleCapture,
} from '../googleEndpointMatcher';

const ctx = { siteHostname: 'www.example.com' };

describe('classifyGoogleRequest — Google-owned hosts (pre-GTG behaviour preserved)', () => {
  it('gtm.js on googletagmanager.com', () => {
    expect(classifyGoogleRequest('https://www.googletagmanager.com/gtm.js?id=GTM-ABC123')).toEqual({
      kind: 'gtm_container_load', transport: 'google_direct', tagId: 'GTM-ABC123', reservedPath: null,
    });
  });
  it('gtag/js with an Ads ID', () => {
    const c = classifyGoogleRequest('https://www.googletagmanager.com/gtag/js?id=AW-123456789');
    expect(c).toMatchObject({ kind: 'google_tag_load', transport: 'google_direct', tagId: 'AW-123456789' });
  });
  it('GA4 collect on google-analytics.com and analytics.google.com', () => {
    for (const host of ['www.google-analytics.com', 'analytics.google.com', 'region1.google-analytics.com']) {
      expect(classifyGoogleRequest(`https://${host}/g/collect?v=2&tid=G-ABCDEF1234`)).toMatchObject({
        kind: 'ga4_hit', transport: 'google_direct', tagId: 'G-ABCDEF1234',
      });
    }
  });
  it('Ads conversion hit', () => {
    expect(classifyGoogleRequest('https://www.googleadservices.com/pagead/conversion/123456789/?label=x')).toMatchObject({
      kind: 'ads_hit', transport: 'google_direct', tagId: 'AW-123456789',
    });
  });
  it('a Google URL that is not a tag request is other/google_direct', () => {
    expect(classifyGoogleRequest('https://www.google.com/maps')).toMatchObject({ kind: 'other', transport: 'google_direct' });
  });
  it('works without a site context for Google hosts', () => {
    expect(classifyGoogleRequest('https://www.googletagmanager.com/gtm.js?id=GTM-ABC123').kind).toBe('gtm_container_load');
  });
});

describe('classifyGoogleRequest — gateway shapes', () => {
  it('GTM container load through a reserved path is gtg with the path recorded', () => {
    expect(classifyGoogleRequest('https://www.example.com/metrics/?id=GTM-ABC123&l=dataLayer', ctx)).toEqual({
      kind: 'gtm_container_load', transport: 'gtg', tagId: 'GTM-ABC123', reservedPath: '/metrics',
    });
  });
  it('a relative script src resolves against the site', () => {
    expect(classifyGoogleRequest('/metrics/?id=GTM-ABC123', ctx)).toMatchObject({ kind: 'gtm_container_load', transport: 'gtg' });
  });
  it('gtag load with an ID through a reserved path', () => {
    expect(classifyGoogleRequest('https://www.example.com/x7k2q/?id=G-ABCDEF1234', ctx)).toMatchObject({
      kind: 'google_tag_load', transport: 'gtg', reservedPath: '/x7k2q', tagId: 'G-ABCDEF1234',
    });
  });
  it('a first-party /g/collect on its own is ambiguous, not gtg', () => {
    expect(classifyGoogleRequest('https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234', ctx)).toMatchObject({
      kind: 'ga4_hit', transport: 'unknown_first_party',
    });
  });
  it('a registered path makes the hit gtg', () => {
    expect(
      classifyGoogleRequest('https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234', { ...ctx, knownGtgPaths: ['/metrics'] }),
    ).toMatchObject({ transport: 'gtg', reservedPath: '/metrics' });
  });
  it('a known sGTM origin wins over everything', () => {
    expect(
      classifyGoogleRequest('https://data.example.com/gtm.js?id=GTM-ABC123', { ...ctx, knownSgtmOrigins: ['https://data.example.com'] }),
    ).toMatchObject({ transport: 'sgtm' });
  });
  it('an sGTM hostname signature is sgtm, not gtg', () => {
    expect(classifyGoogleRequest('https://sgtm.example.com/g/collect?tid=G-ABCDEF1234', ctx)).toMatchObject({ transport: 'sgtm' });
  });
  it('/gtm.js on the site host (self-hosted or sGTM) is not claimed as gtg', () => {
    expect(classifyGoogleRequest('https://www.example.com/gtm.js?id=GTM-ABC123', ctx).transport).toBe('unknown_first_party');
  });
  it('a loader on a different subdomain is not claimed as gtg', () => {
    expect(classifyGoogleRequest('https://data.example.com/abc/?id=GTM-ABC123', ctx).transport).toBe('unknown_first_party');
  });
});

describe('classifyGoogleRequest — not Google', () => {
  it('a third-party host with a coincidental id= is other/not_google', () => {
    expect(classifyGoogleRequest('https://cdn.vendor.io/widget?id=GTM-ABC123', ctx)).toMatchObject({ kind: 'other', transport: 'not_google' });
  });
  it('a foreign /g/collect is not counted', () => {
    expect(classifyGoogleRequest('https://tracker.other.net/g/collect?tid=G-ABCDEF1234', ctx).kind).toBe('other');
  });
  it('a malformed id is not a tag ID', () => {
    expect(classifyGoogleRequest('https://www.example.com/page?id=G-1', ctx).kind).toBe('other');
    expect(classifyGoogleRequest('https://www.example.com/page?id=12345', ctx).kind).toBe('other');
  });
  it('garbage input does not throw', () => {
    expect(classifyGoogleRequest('not a url').kind).toBe('other');
  });
  it('same-site does not mean the same base for a different registrable domain', () => {
    expect(isSameSite('a.evil.co.uk', 'www.example.co.uk')).toBe(false);
    expect(isSameSite('shop.example.co.uk', 'www.example.co.uk')).toBe(true);
  });
});

describe('classifyGoogleRequests — capture-level inference', () => {
  const reqs = (urls: string[]) => urls.map((url) => ({ url }));

  it('a hit under a gateway loader prefix becomes gtg', () => {
    const out = classifyGoogleRequests(
      reqs([
        'https://www.example.com/metrics/?id=GTM-ABC123',
        'https://www.example.com/metrics/g/collect?v=2&tid=G-ABCDEF1234',
        'https://www.example.com/other/g/collect?tid=G-ABCDEF1234',
      ]),
      ctx,
    );
    expect(out[1]).toMatchObject({ kind: 'ga4_hit', transport: 'gtg', reservedPath: '/metrics' });
    expect(out[2].transport).toBe('unknown_first_party');
  });

  it('a bare /path/ with no query is a Google tag load only when a tagged hit follows under the prefix', () => {
    const withHit = classifyGoogleRequests(
      reqs(['https://www.example.com/abc12/', 'https://www.example.com/abc12/g/collect?tid=G-ABCDEF1234']),
      ctx,
    );
    expect(withHit[0]).toMatchObject({ kind: 'google_tag_load', transport: 'gtg', reservedPath: '/abc12', tagId: 'G-ABCDEF1234' });
    expect(withHit[1].transport).toBe('gtg');

    const without = classifyGoogleRequests(reqs(['https://www.example.com/abc12/']), ctx);
    expect(without[0].kind).toBe('other');
  });

  it('a bare path with an untagged hit does not qualify', () => {
    const out = classifyGoogleRequests(
      reqs(['https://www.example.com/abc12/', 'https://www.example.com/abc12/g/collect']),
      ctx,
    );
    expect(out[0].kind).toBe('other');
  });

  it('GTG and custom-domain sGTM on one site are told apart', () => {
    const out = classifyGoogleRequests(
      reqs([
        'https://www.example.com/metrics/?id=GTM-ABC123',
        'https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234',
        'https://sgtm.example.com/g/collect?tid=G-ABCDEF1234',
      ]),
      { ...ctx, knownSgtmOrigins: ['sgtm.example.com'] },
    );
    expect(out.map((c) => c.transport)).toEqual(['gtg', 'gtg', 'sgtm']);
  });

  it('summarises a gateway capture', () => {
    const s = summariseGoogleCapture(
      classifyGoogleRequests(
        reqs([
          'https://www.example.com/metrics/?id=GTM-ABC123',
          'https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234',
          'https://www.googleadservices.com/pagead/conversion/123456789/',
        ]),
        ctx,
      ),
    );
    expect(s).toMatchObject({
      gtmContainerIds: ['GTM-ABC123'], ga4HitIds: ['G-ABCDEF1234'], adsHitIds: ['AW-123456789'],
      gtgPaths: ['/metrics'], hasGtgTraffic: true, hasGoogleDirectLoad: false,
    });
  });

  it('a Google-direct capture has no gateway traffic', () => {
    const s = summariseGoogleCapture(
      classifyGoogleRequests(reqs(['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123']), ctx),
    );
    expect(s).toMatchObject({ hasGtgTraffic: false, hasGoogleDirectLoad: true, gtgPaths: [] });
  });
});

describe('inline GTM snippet', () => {
  const standard = `(function(w,d,s,l,i){w[l]=w[l]||[];var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-ABC123');`;
  const gateway = standard.replace('https://www.googletagmanager.com/gtm.js?id=', '/metrics/?id=');

  it('parses the standard snippet', () => {
    expect(parseInlineGtmSnippet(standard)).toEqual({
      containerId: 'GTM-ABC123', url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123',
    });
  });
  it('parses the gateway snippet', () => {
    expect(parseInlineGtmSnippet(gateway)).toEqual({ containerId: 'GTM-ABC123', url: '/metrics/?id=GTM-ABC123' });
  });
  it('returns null for unrelated script text', () => {
    expect(parseInlineGtmSnippet('console.log("GTM-ABC123")')).toBeNull();
  });
  it('extractGtmContainerIds reads src values and inline snippets, de-duplicated', () => {
    expect(
      extractGtmContainerIds(['/metrics/?id=GTM-ABC123', `inline:${gateway}`, 'https://cdn.vendor.io/app.js'], ctx),
    ).toEqual(['GTM-ABC123']);
  });
});

describe('looksLikeGoogleRequestShape (capture filter, no site context)', () => {
  it('accepts first-party gateway shapes', () => {
    expect(looksLikeGoogleRequestShape('https://www.example.com/metrics/?id=GTM-ABC123')).toBe(true);
    expect(looksLikeGoogleRequestShape('https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234')).toBe(true);
  });
  it('rejects ordinary URLs', () => {
    expect(looksLikeGoogleRequestShape('https://www.example.com/products?id=42')).toBe(false);
    expect(looksLikeGoogleRequestShape('https://www.example.com/app.js')).toBe(false);
  });
});
