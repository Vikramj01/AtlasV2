import { describe, it, expect } from 'vitest';
import { makeNetworkRequest } from '@/services/validation/__tests__/mockAuditData';
import {
  detectGa4,
  detectMetaPixel,
  detectGoogleAds,
  detectTikTokPixel,
  detectLinkedInInsight,
  detectMicrosoftUet,
  extractGtmContainerIdsFromScriptSrcs,
} from '@/services/detection/trackingSignals';
import {
  buildDataLayerInventory,
  detectPossibleServerSideGtm,
  buildSiteSetupSummary,
} from '../siteSetupDetector';
import type { DataLayerEvent } from '@/types/audit';

describe('trackingSignals detectors', () => {
  it('detectGa4 extracts the measurement ID from tid', () => {
    const match = detectGa4([
      makeNetworkRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC123&en=page_view' }),
    ]);
    expect(match.hitCount).toBe(1);
    expect(match.ids).toEqual(['G-ABC123']);
  });

  it('detectGa4 returns no hits for unrelated requests', () => {
    const match = detectGa4([makeNetworkRequest({ url: 'https://example.com/some/other/path' })]);
    expect(match.hitCount).toBe(0);
    expect(match.ids).toEqual([]);
  });

  it('detectMetaPixel extracts the pixel ID from id param', () => {
    const match = detectMetaPixel([
      makeNetworkRequest({ url: 'https://www.facebook.com/tr/?id=1234567890&ev=PageView' }),
    ]);
    expect(match.hitCount).toBe(1);
    expect(match.ids).toEqual(['1234567890']);
  });

  it('detectGoogleAds counts hits without requiring an ID', () => {
    const match = detectGoogleAds([
      makeNetworkRequest({ url: 'https://www.googleadservices.com/pagead/conversion/123456789/' }),
    ]);
    expect(match.hitCount).toBe(1);
  });

  it('detectTikTokPixel counts hits to analytics.tiktok.com', () => {
    const match = detectTikTokPixel([makeNetworkRequest({ url: 'https://analytics.tiktok.com/api/v2/pixel' })]);
    expect(match.hitCount).toBe(1);
  });

  it('detectLinkedInInsight counts hits to snap.licdn.com or linkedin.com/px', () => {
    const match = detectLinkedInInsight([makeNetworkRequest({ url: 'https://snap.licdn.com/li.lms-analytics/insight.min.js' })]);
    expect(match.hitCount).toBe(1);
  });

  it('detectMicrosoftUet extracts the tag ID from the ti param', () => {
    const match = detectMicrosoftUet([
      makeNetworkRequest({ url: 'https://bat.bing.com/action/0?ti=12345678&Ver=2' }),
    ]);
    expect(match.hitCount).toBe(1);
    expect(match.ids).toEqual(['12345678']);
  });

  it('extractGtmContainerIdsFromScriptSrcs parses the id query param from gtm.js', () => {
    const ids = extractGtmContainerIdsFromScriptSrcs([
      'https://www.googletagmanager.com/gtm.js?id=GTM-ABCDEF',
      'https://example.com/some-other-script.js',
    ]);
    expect(ids).toEqual(['GTM-ABCDEF']);
  });

  it('extractGtmContainerIdsFromScriptSrcs dedupes repeated container IDs', () => {
    const ids = extractGtmContainerIdsFromScriptSrcs([
      'https://www.googletagmanager.com/gtm.js?id=GTM-ABCDEF',
      'https://www.googletagmanager.com/gtm.js?id=GTM-ABCDEF',
    ]);
    expect(ids).toEqual(['GTM-ABCDEF']);
  });

  it('extractGtmContainerIdsFromScriptSrcs returns empty array when no GTM script present', () => {
    expect(extractGtmContainerIdsFromScriptSrcs(['https://example.com/app.js'])).toEqual([]);
  });
});

describe('detectPossibleServerSideGtm', () => {
  const HOST = 'example.com';

  it('flags a URL containing the sgtm keyword at low confidence', () => {
    const result = detectPossibleServerSideGtm(
      [makeNetworkRequest({ url: 'https://sgtm.example.com/g/collect' })],
      HOST,
    );
    expect(result.detected).toBe(true);
    expect(result.matched_heuristics).toContain('domain_keyword');
  });

  it('flags a first-party host serving a GA4 Measurement Protocol shape at medium confidence', () => {
    const result = detectPossibleServerSideGtm(
      [makeNetworkRequest({ url: 'https://collect.example.com/g/collect?tid=G-XYZ' })],
      HOST,
    );
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.matched_heuristics).toContain('firstparty_measurement_protocol_shape');
  });

  it('flags a first-party host forwarding a Meta CAPI-shaped payload', () => {
    const result = detectPossibleServerSideGtm(
      [makeNetworkRequest({
        url: 'https://collect.example.com/capi-forward',
        body: JSON.stringify({ event_name: 'Purchase', event_id: 'abc123', action_source: 'website' }),
      })],
      HOST,
    );
    expect(result.detected).toBe(true);
    expect(result.matched_heuristics).toContain('firstparty_capi_forward_shape');
  });

  it('does not flag third-party GA4/Meta traffic as server-side GTM', () => {
    const result = detectPossibleServerSideGtm(
      [
        makeNetworkRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-XYZ' }),
        makeNetworkRequest({ url: 'https://www.facebook.com/tr/?id=123' }),
      ],
      HOST,
    );
    expect(result.detected).toBe(false);
    expect(result.matched_heuristics).toEqual([]);
  });

  it('always includes a caveat string when detected', () => {
    const result = detectPossibleServerSideGtm(
      [makeNetworkRequest({ url: 'https://sgtm.example.com/collect' })],
      HOST,
    );
    expect(result.caveat.length).toBeGreaterThan(0);
  });
});

describe('buildDataLayerInventory', () => {
  it('groups events by name with occurrence count, param keys, and steps seen', () => {
    const events: DataLayerEvent[] = [
      { event: 'page_view', timestamp: 1, step: 'landing', __step: 'landing', __timestamp: 1 } as DataLayerEvent,
      { event: 'page_view', timestamp: 2, step: 'product' } as DataLayerEvent,
      { event: 'purchase', timestamp: 3, step: 'confirmation', transaction_id: 'ORDER-1', value: 10 } as DataLayerEvent,
    ];
    const inventory = buildDataLayerInventory(events);

    const pageView = inventory.find((e) => e.event_name === 'page_view');
    expect(pageView?.occurrence_count).toBe(2);
    expect(pageView?.steps_seen.sort()).toEqual(['landing', 'product']);
    expect(pageView?.parameter_keys).toEqual([]);

    const purchase = inventory.find((e) => e.event_name === 'purchase');
    expect(purchase?.occurrence_count).toBe(1);
    expect(purchase?.parameter_keys).toEqual(['transaction_id', 'value']);
  });

  it('excludes internal bookkeeping keys from parameter_keys', () => {
    const events: DataLayerEvent[] = [
      { event: 'custom_event', timestamp: 1, step: 'landing', __step: 'landing', __timestamp: 1, foo: 'bar' } as DataLayerEvent,
    ];
    const inventory = buildDataLayerInventory(events);
    expect(inventory[0].parameter_keys).toEqual(['foo']);
  });

  it('returns an empty array for no events', () => {
    expect(buildDataLayerInventory([])).toEqual([]);
  });
});

describe('buildSiteSetupSummary', () => {
  it('assembles tags, gtm container, dataLayer inventory, and sGTM signal together', () => {
    const summary = buildSiteSetupSummary(
      {
        website_url: 'https://example.com',
        dataLayer: [{ event: 'page_view', timestamp: 1, step: 'landing' } as DataLayerEvent],
        networkRequests: [
          makeNetworkRequest({ url: 'https://www.google-analytics.com/g/collect?tid=G-ABC123' }),
        ],
      },
      ['https://www.googletagmanager.com/gtm.js?id=GTM-XXXX'],
    );

    expect(summary.gtm_container).toEqual({
      detected: true,
      container_ids: ['GTM-XXXX'],
      connected_container_id: null,
      ids_match: null,
    });
    const ga4Tag = summary.tags.find((t) => t.platform === 'ga4');
    expect(ga4Tag?.detected).toBe(true);
    expect(ga4Tag?.ids).toEqual(['G-ABC123']);
    expect(summary.datalayer_inventory).toHaveLength(1);
    expect(summary.possible_server_side_gtm.detected).toBe(false);
    expect(summary.generated_at).toBeTruthy();
  });

  it('reports no GTM container and no tags when nothing was captured', () => {
    const summary = buildSiteSetupSummary(
      { website_url: 'https://example.com', dataLayer: [], networkRequests: [] },
      [],
    );
    expect(summary.gtm_container.detected).toBe(false);
    expect(summary.tags.every((t) => !t.detected)).toBe(true);
  });

  it('flags ids_match true when the live-detected container matches the connected one', () => {
    const summary = buildSiteSetupSummary(
      { website_url: 'https://example.com', dataLayer: [], networkRequests: [] },
      ['https://www.googletagmanager.com/gtm.js?id=GTM-XXXX'],
      'GTM-XXXX',
    );
    expect(summary.gtm_container.connected_container_id).toBe('GTM-XXXX');
    expect(summary.gtm_container.ids_match).toBe(true);
  });

  it('flags ids_match false when the live-detected container differs from the connected one', () => {
    const summary = buildSiteSetupSummary(
      { website_url: 'https://example.com', dataLayer: [], networkRequests: [] },
      ['https://www.googletagmanager.com/gtm.js?id=GTM-YYYY'],
      'GTM-XXXX',
    );
    expect(summary.gtm_container.connected_container_id).toBe('GTM-XXXX');
    expect(summary.gtm_container.ids_match).toBe(false);
  });

  it('leaves ids_match null when no container is connected to compare against', () => {
    const summary = buildSiteSetupSummary(
      { website_url: 'https://example.com', dataLayer: [], networkRequests: [] },
      ['https://www.googletagmanager.com/gtm.js?id=GTM-XXXX'],
      null,
    );
    expect(summary.gtm_container.ids_match).toBeNull();
  });
});
