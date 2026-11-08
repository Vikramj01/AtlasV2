/**
 * Google tag gateway fixture across every detector that used to key on a Google
 * hostname (docs/prd/google-tag-gateway.md §4.2, acceptance criteria 4–7).
 * Each positive case has a control that proves the assertion can fail.
 */
import { describe, it, expect } from 'vitest';
import type { AuditData } from '@/types/audit';
import {
  DIRECT_REQUESTS, GTG_ADS_ID, GTG_CONTAINER_ID, GTG_GA4_ID, GTG_HTML, GTG_REQUESTS, GTG_SITE_URL, GTG_URLS,
  STANDARD_GTM_SNIPPET, req,
} from '../../audit/__tests__/fixtures/gtgSite';
import * as cheerio from 'cheerio';
import { detectTracking } from '../../planning/siteDetectionService';
import { detectExistingTracking } from '../../planning/pageCaptureService';
import { classifyStageGaps } from '../../audit/gapClassifier';
import { detectPossibleServerSideGtm } from '../../audit/siteSetupDetector';
import { buildSiteSetupSummary } from '../../audit/siteSetupDetector';
import { shouldCaptureUrl } from '../../audit/dataCapture';
import { platformTagDetected } from '../../validation/register/platformDetection';
import {
  GA4_CONFIG_TAG_PRESENT, GOOGLE_ADS_AW_ID_PRESENT, GTAG_LOADER_PRESENT, GTM_CONTAINER_LOADED,
} from '../../validation/register/L1';
import { extractGoogleTagObservation, observationToRows, computeTopologyVerdict } from '../googleTagTopology';
import { contextForSite } from '../googleEndpointMatcher';

function auditData(networkRequests = GTG_REQUESTS, over: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'a', website_url: GTG_SITE_URL, funnel_type: 'ecommerce', region: 'us', rule_set_version: 'v2',
    site_type: 'ecommerce', declared_platforms: ['google_ads'], dataLayer: [], networkRequests,
    cookieSnapshots: [], localStorageSnapshots: [], injected: { gclid: '', fbclid: '' },
    pageMetadata: { gtm_script_srcs: [] },
    ...over,
  } as AuditData;
}

describe('Planning site detection (AC 4)', () => {
  it('finds the GTM container behind a gateway path and does not read it as absent', () => {
    const t = detectTracking(cheerio.load(GTG_HTML), GTG_HTML, GTG_SITE_URL);
    expect(t.gtm_detected).toBe(true);
    expect(t.gtm_container_id).toBe(GTG_CONTAINER_ID);
  });
  it('control: a page with no GTM snippet still reports none', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    expect(detectTracking(cheerio.load(html), html, GTG_SITE_URL).gtm_detected).toBe(false);
  });
  it('control: the standard Google-hosted snippet is unchanged', () => {
    const html = `<html><head>${STANDARD_GTM_SNIPPET}</head></html>`;
    const t = detectTracking(cheerio.load(html), html, GTG_SITE_URL);
    expect(t.gtm_detected).toBe(true);
    expect(t.gtm_container_id).toBe(GTG_CONTAINER_ID);
  });
});

describe('Planning page capture', () => {
  const page = (scripts: string[]) => ({ evaluate: async () => scripts, url: () => GTG_SITE_URL }) as never;

  it('detects GTM, GA4 and Ads served from the site own domain', async () => {
    const d = await detectExistingTracking(
      page([GTG_URLS.container]),
      [GTG_URLS.container, GTG_URLS.ga4Hit, GTG_URLS.adsHit],
      GTG_SITE_URL,
    );
    expect(d.gtm_detected).toBe(true);
    expect(d.gtm_container_id).toBe(GTG_CONTAINER_ID);
    expect(d.ga4_detected).toBe(true);
    expect(d.google_ads_detected).toBe(true);
  });
  it('control: nothing Google means nothing detected', async () => {
    const d = await detectExistingTracking(page(['https://www.example.com/app.js']), ['https://www.example.com/app.js'], GTG_SITE_URL);
    expect(d.gtm_detected).toBe(false);
    expect(d.ga4_detected).toBe(false);
  });
});

describe('gapClassifier (AC 5)', () => {
  const spec = {
    stage_order: 1, stage_label: 'Landing', sample_url: GTG_SITE_URL, expected_events: [],
    expected_platforms: [
      { platform: 'ga4', must_detect_tag: true, must_receive_event: false, endpoint_patterns: [] },
      { platform: 'google_ads', must_detect_tag: true, must_receive_event: false, endpoint_patterns: [] },
    ],
  };
  const capture = (network_requests = GTG_REQUESTS) => ({
    stage_order: 1, stage_label: 'Landing', url_navigated: GTG_SITE_URL, url_actual: GTG_SITE_URL,
    navigation_success: true, load_time_ms: 1, datalayer_events: [], network_requests, cookies: {},
    local_storage: {}, gtm_script_srcs: [], errors: [], skipped: false,
  });

  it('raises no base-tag-missing gap for a correct gateway deployment', () => {
    const gaps = classifyStageGaps(spec as never, capture() as never);
    expect(gaps.filter((g) => g.sub_type === 'platform_tag_absent')).toEqual([]);
  });
  it('control: the same site with no Google traffic does raise them', () => {
    const gaps = classifyStageGaps(spec as never, capture([req('https://www.example.com/app.js')]) as never);
    expect(gaps.filter((g) => g.sub_type === 'platform_tag_absent').length).toBe(2);
  });
  it('control: a pre-gateway Google-direct site is unchanged', () => {
    const gaps = classifyStageGaps(spec as never, capture(DIRECT_REQUESTS) as never);
    expect(gaps.filter((g) => g.sub_type === 'platform_tag_absent')).toEqual([]);
  });
});

describe('Check Register L1 rules', () => {
  const withContainer = auditData(GTG_REQUESTS, { pageMetadata: { gtm_script_srcs: [GTG_URLS.container] } });

  it('GTM_CONTAINER_LOADED passes from a gateway-served container', () => {
    expect(GTM_CONTAINER_LOADED.test(withContainer).status).toBe('pass');
  });
  it('GA4_CONFIG_TAG_PRESENT passes from a gateway GA4 hit', () => {
    expect(GA4_CONFIG_TAG_PRESENT.test(withContainer).status).toBe('pass');
  });
  it('GTAG_LOADER_PRESENT passes from a gateway Google tag load', () => {
    const d = auditData([req(`https://www.example.com/metrics/?id=${GTG_GA4_ID}`)]);
    expect(GTAG_LOADER_PRESENT.test(d).status).toBe('pass');
  });
  it('GOOGLE_ADS_AW_ID_PRESENT passes when Ads hits are first-party and the AW- ID is not in any loader URL', () => {
    const r = GOOGLE_ADS_AW_ID_PRESENT.test(withContainer);
    expect(r.status).toBe('pass');
    expect(r.technical_details.found).toContain(GTG_ADS_ID);
  });
  it('control: an unattributable same-site /g/collect (no gateway loader) is not counted as GA4', () => {
    const d = auditData([req(`https://www.example.com/x/g/collect?v=2&tid=${GTG_GA4_ID}`)]);
    expect(GA4_CONFIG_TAG_PRESENT.test(d).status).toBe('fail');
  });
  it('control: no Google traffic at all still fails', () => {
    expect(GA4_CONFIG_TAG_PRESENT.test(auditData([])).status).toBe('fail');
    expect(GTAG_LOADER_PRESENT.test(auditData([])).status).toBe('fail');
  });
});

describe('Google tag topology (AC 6)', () => {
  it('records the loaded tag IDs and attributable destinations of a gateway site', () => {
    const obs = extractGoogleTagObservation(
      [req(`https://www.example.com/metrics/?id=${GTG_GA4_ID}`), req(`https://www.example.com/metrics/g/collect?tid=${GTG_GA4_ID}`)],
      contextForSite(GTG_SITE_URL),
    );
    expect(obs.loaded_tag_ids).toEqual([GTG_GA4_ID]);
    expect(obs.destination_ids).toEqual([GTG_GA4_ID]);
    expect(obs.attributed).toEqual([{ loaded_tag_id: GTG_GA4_ID, destination_id: GTG_GA4_ID }]);
  });
  it('control: without the site context the same capture records nothing (the pre-gateway blind spot)', () => {
    const obs = extractGoogleTagObservation([req(`https://www.example.com/metrics/?id=${GTG_GA4_ID}`)]);
    expect(obs.loaded_tag_ids).toEqual([]);
  });
  it('does not degrade a split gateway site to UNKNOWN', () => {
    const obs = extractGoogleTagObservation(
      [
        req(`https://www.example.com/metrics/?id=${GTG_GA4_ID}`),
        req(`https://www.example.com/metrics/?id=${GTG_ADS_ID}`),
        req(`https://www.example.com/metrics/g/collect?tid=${GTG_GA4_ID}`),
        req(GTG_URLS.adsHit),
      ],
      contextForSite(GTG_SITE_URL),
    );
    expect(computeTopologyVerdict(observationToRows(obs)).verdict).toBe('SPLIT');
  });
});

describe('possible server-side GTM heuristic (AC 7)', () => {
  const host = 'www.example.com';
  it('does not label gateway traffic as possible sGTM', () => {
    const r = detectPossibleServerSideGtm(GTG_REQUESTS, host);
    expect(r.matched_heuristics).not.toContain('firstparty_measurement_protocol_shape');
    expect(r.detected).toBe(false);
  });
  it('control: an unattributable first-party /g/collect is still flagged, and the caveat names both explanations', () => {
    const r = detectPossibleServerSideGtm([req(`https://www.example.com/x/g/collect?tid=${GTG_GA4_ID}`)], host);
    expect(r.matched_heuristics).toContain('firstparty_measurement_protocol_shape');
    expect(r.caveat).toMatch(/gateway/i);
    expect(r.caveat).toMatch(/server-side GTM/i);
  });
  it('control: a custom sGTM subdomain is still flagged', () => {
    const r = detectPossibleServerSideGtm([req(`https://sgtm.example.com/g/collect?tid=${GTG_GA4_ID}`)], host);
    expect(r.detected).toBe(true);
  });
  it('Site Setup summary reads the gateway container and GA4 hit', () => {
    const s = buildSiteSetupSummary(
      { dataLayer: [], networkRequests: GTG_REQUESTS, website_url: GTG_SITE_URL, commerce_platform: undefined } as never,
      [GTG_URLS.container],
    );
    expect(s.gtm_container.container_ids).toEqual([GTG_CONTAINER_ID]);
    expect(s.tags.find((t) => t.platform === 'ga4')?.detected).toBe(true);
    expect(s.possible_server_side_gtm.detected).toBe(false);
  });
});

describe('platform detection and capture filter', () => {
  it('Google Ads is detected from a first-party Ads hit', () => {
    expect(platformTagDetected('google_ads', auditData(GTG_REQUESTS))).toBe(true);
  });
  it('control: no Ads traffic means not detected', () => {
    expect(platformTagDetected('google_ads', auditData([req('https://www.example.com/app.js')]))).toBe(false);
  });
  it('the capture filter keeps first-party gateway requests', () => {
    expect(shouldCaptureUrl(GTG_URLS.container)).toBe(true);
    expect(shouldCaptureUrl(GTG_URLS.ga4Hit)).toBe(true);
    expect(shouldCaptureUrl('https://www.example.com/products?id=42')).toBe(false);
  });
});
