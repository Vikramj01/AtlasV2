/**
 * GA4 Admin / L11 / Junk Gate PRD §A.5 (AC 4): which snapshot changes are drift,
 * and which of those qualify as a client-scoped tracking discontinuity.
 */
import { describe, it, expect } from 'vitest';
import { diffGa4Snapshots, buildGa4DiscontinuityRows, DISCONTINUITY_CHANGE_TYPES } from '../ga4ConfigDrift';
import type { Ga4ConfigSnapshot } from '../ga4ConfigSync';

const base = (): Ga4ConfigSnapshot => ({
  property_id: '123', currency_code: 'GBP', time_zone: 'Europe/London',
  web_streams: [{ stream_id: '9', measurement_id: 'G-AAA', default_uri: 'https://a.com', enhanced_measurement: { stream_enabled: true, form_interactions_enabled: false } }],
  ads_links: [{ customer_id: '111', ads_personalization_enabled: true }],
  data_retention: { event_data_retention: 'FOURTEEN_MONTHS', user_data_retention: 'FOURTEEN_MONTHS' },
});

describe('diffGa4Snapshots', () => {
  it('reports nothing for identical snapshots', () => {
    expect(diffGa4Snapshots(base(), base())).toEqual([]);
  });

  it('detects each tracked change type', () => {
    const next = base();
    next.web_streams[0].measurement_id = 'G-BBB';
    next.web_streams[0].enhanced_measurement = { stream_enabled: false, form_interactions_enabled: true };
    next.ads_links = [{ customer_id: '222', ads_personalization_enabled: true }];
    next.currency_code = 'USD';
    next.time_zone = 'UTC';
    expect(diffGa4Snapshots(base(), next).map((c) => c.type).sort()).toEqual(
      ['ads_links', 'currency', 'enhanced_form_interactions', 'enhanced_stream_enabled', 'stream_ids', 'time_zone'],
    );
  });

  it('ignores data retention and Ads personalization (not tracked drift)', () => {
    const next = base();
    next.data_retention = { event_data_retention: 'TWO_MONTHS', user_data_retention: 'TWO_MONTHS' };
    next.ads_links![0].ads_personalization_enabled = false;
    expect(diffGa4Snapshots(base(), next)).toEqual([]);
  });

  it('never reads a not-observed section as a change', () => {
    const next = base();
    next.ads_links = null;
    next.web_streams[0].enhanced_measurement = null;
    expect(diffGa4Snapshots(base(), next)).toEqual([]);
    expect(diffGa4Snapshots(next, base())).toEqual([]);
  });

  it('is order-insensitive for stream IDs', () => {
    const a = base(); a.web_streams.push({ stream_id: '8', measurement_id: 'G-ZZZ', default_uri: null, enhanced_measurement: null });
    const b = base(); b.web_streams.unshift({ stream_id: '8', measurement_id: 'G-ZZZ', default_uri: null, enhanced_measurement: null });
    expect(diffGa4Snapshots(a, b).filter((c) => c.type === 'stream_ids')).toEqual([]);
  });
});

describe('buildGa4DiscontinuityRows', () => {
  const args = { organizationId: 'org-1', clientId: 'client-1', effectiveDate: '2026-10-06' };

  it('only stream ID, enhanced form toggle and currency qualify', () => {
    expect([...DISCONTINUITY_CHANGE_TYPES].sort()).toEqual(['currency', 'enhanced_form_interactions', 'stream_ids']);
    const next = base();
    next.web_streams[0].measurement_id = 'G-BBB';
    next.web_streams[0].enhanced_measurement = { stream_enabled: false, form_interactions_enabled: true };
    next.ads_links = [];
    next.currency_code = 'USD';
    next.time_zone = 'UTC';
    const rows = buildGa4DiscontinuityRows({ ...args, changes: diffGa4Snapshots(base(), next) });
    expect(rows.map((r) => r.title).sort()).toEqual([
      'GA4 enhanced measurement form interactions changed',
      'GA4 property currency changed',
      'GA4 stream measurement ID changed',
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ platform: 'ga4', kind: 'client_tracking_change', client_id: 'client-1', organization_id: 'org-1', effective_date: '2026-10-06' });
    }
  });

  it('produces no rows for non-qualifying changes only (Ads link, time zone, enhanced on/off)', () => {
    const next = base();
    next.ads_links = [];
    next.time_zone = 'UTC';
    next.web_streams[0].enhanced_measurement = { stream_enabled: false, form_interactions_enabled: false };
    expect(buildGa4DiscontinuityRows({ ...args, changes: diffGa4Snapshots(base(), next) })).toEqual([]);
  });

  it('emits one row per qualifying type even if a type repeats', () => {
    const changes = [{ type: 'currency' as const, detail: 'a' }, { type: 'currency' as const, detail: 'b' }];
    expect(buildGa4DiscontinuityRows({ ...args, changes })).toHaveLength(1);
  });
});
