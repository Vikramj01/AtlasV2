/**
 * GA4 Admin / L11 / Junk Gate PRD Part A1 (AC 1, 7): a snapshot row is written
 * on first sync and not on a repeat with unchanged config; no PII reaches the
 * snapshot; an optional read failing (esp. v1alpha enhanced measurement) never
 * fabricates a change or an absence.
 *
 * Fixtures are shaped from the live Discovery Documents verified in Sprint 0
 * (revision 20261003).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let connRow: { account_id: string; client_id: string | null } | null;
let latest: { snapshot: unknown; snapshot_hash: string } | null;
const inserts: Array<Record<string, unknown>> = [];

vi.mock('@/services/database/supabase', () => {
  const connChain: any = {};
  connChain.select = () => connChain; connChain.eq = () => connChain;
  connChain.single = async () => ({ data: connRow, error: null });
  const snapChain: any = {};
  for (const m of ['select', 'eq', 'order', 'limit']) snapChain[m] = () => snapChain;
  snapChain.maybeSingle = async () => ({ data: latest, error: null });
  snapChain.insert = async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; };
  return { supabaseAdmin: { from: (t: string) => (t === 'platform_connections' ? connChain : snapChain) } };
});
vi.mock('@/services/connections/tokenManager', () => ({ resolveTokens: vi.fn(async () => ({ access_token: 'tok' })) }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { syncGa4Config, hashSnapshot, canonicalJson, normaliseAdsLinks } from '../ga4ConfigSync';

type Routes = Record<string, unknown | 'FAIL'>;
let routes: Routes;

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key || routes[key] === 'FAIL') return { ok: false, status: key ? 500 : 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[key] };
  }));
}

const baseRoutes = (): Routes => ({
  // Order matters: more specific substrings first.
  'v1alpha/properties/123/dataStreams/9/enhancedMeasurementSettings': { name: 'x', streamEnabled: true, formInteractionsEnabled: true, scrollsEnabled: true },
  'v1beta/properties/123/dataStreams': {
    dataStreams: [{
      name: 'properties/123/dataStreams/9', type: 'WEB_DATA_STREAM', createTime: '2026-01-01T00:00:00Z',
      webStreamData: { measurementId: 'G-ABC123', defaultUri: 'https://shop.example.com' },
    }],
  },
  'v1beta/properties/123/googleAdsLinks': {
    googleAdsLinks: [{ name: 'l', customerId: '123-456-7890', adsPersonalizationEnabled: true, creatorEmailAddress: 'person@example.com', updateTime: 't' }],
  },
  'v1beta/properties/123/dataRetentionSettings': { eventDataRetention: 'FOURTEEN_MONTHS', userDataRetention: 'FOURTEEN_MONTHS' },
  'v1beta/properties/123': { name: 'properties/123', currencyCode: 'GBP', timeZone: 'Europe/London', updateTime: 'u' },
});

beforeEach(() => {
  inserts.length = 0;
  connRow = { account_id: '123', client_id: 'client-1' };
  latest = null;
  routes = baseRoutes();
  installFetch();
});

describe('syncGa4Config', () => {
  it('writes a snapshot on first sync', async () => {
    const result = await syncGa4Config('conn-1', 'org-1');
    expect(result?.changed).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ organization_id: 'org-1', connection_id: 'conn-1', client_id: 'client-1', property_id: '123' });
    expect(result?.snapshot).toMatchObject({
      currency_code: 'GBP',
      time_zone: 'Europe/London',
      web_streams: [{ stream_id: '9', measurement_id: 'G-ABC123', default_uri: 'https://shop.example.com', enhanced_measurement: { stream_enabled: true, form_interactions_enabled: true } }],
      ads_links: [{ customer_id: '1234567890', ads_personalization_enabled: true }],
      data_retention: { event_data_retention: 'FOURTEEN_MONTHS', user_data_retention: 'FOURTEEN_MONTHS' },
    });
  });

  it('writes no new row on a repeat sync with unchanged config', async () => {
    const first = await syncGa4Config('conn-1', 'org-1');
    latest = { snapshot: first!.snapshot, snapshot_hash: first!.hash };
    inserts.length = 0;
    const second = await syncGa4Config('conn-1', 'org-1');
    expect(second?.changed).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('writes a new row when config changes, and hands back the previous snapshot', async () => {
    const first = await syncGa4Config('conn-1', 'org-1');
    latest = { snapshot: first!.snapshot, snapshot_hash: first!.hash };
    inserts.length = 0;
    (routes['v1alpha/properties/123/dataStreams/9/enhancedMeasurementSettings'] as Record<string, unknown>).formInteractionsEnabled = false;
    const second = await syncGa4Config('conn-1', 'org-1');
    expect(second?.changed).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(second?.previous).toEqual(first!.snapshot);
  });

  it('contains no PII: the Ads link creator email never reaches the snapshot', async () => {
    const result = await syncGa4Config('conn-1', 'org-1');
    expect(JSON.stringify(result?.snapshot)).not.toContain('person@example.com');
    expect(JSON.stringify(inserts[0])).not.toContain('@');
  });

  it('a failing v1alpha enhanced-measurement read yields null (not observed), never a fabricated value', async () => {
    routes['v1alpha/properties/123/dataStreams/9/enhancedMeasurementSettings'] = 'FAIL';
    const result = await syncGa4Config('conn-1', 'org-1');
    expect(result?.snapshot.web_streams[0].enhanced_measurement).toBeNull();
  });

  it('a failing optional read carries the previous value forward, so no false change row is written', async () => {
    const first = await syncGa4Config('conn-1', 'org-1');
    latest = { snapshot: first!.snapshot, snapshot_hash: first!.hash };
    inserts.length = 0;
    routes['v1alpha/properties/123/dataStreams/9/enhancedMeasurementSettings'] = 'FAIL';
    routes['v1beta/properties/123/googleAdsLinks'] = 'FAIL';
    routes['v1beta/properties/123/dataRetentionSettings'] = 'FAIL';
    const second = await syncGa4Config('conn-1', 'org-1');
    expect(second?.changed).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(second?.carried_forward.sort()).toEqual(['ads_links', 'data_retention', 'enhanced_measurement:9']);
  });

  it('throws when a required read (data streams) fails, writing nothing', async () => {
    routes['v1beta/properties/123/dataStreams'] = 'FAIL';
    await expect(syncGa4Config('conn-1', 'org-1')).rejects.toThrow(/dataStreams/);
    expect(inserts).toHaveLength(0);
  });

  it('skips app (non-web) streams', async () => {
    routes['v1beta/properties/123/dataStreams'] = { dataStreams: [{ name: 'properties/123/dataStreams/5', type: 'ANDROID_APP_DATA_STREAM', androidAppStreamData: { packageName: 'p' } }] };
    const result = await syncGa4Config('conn-1', 'org-1');
    expect(result?.snapshot.web_streams).toEqual([]);
  });

  it('records a connection with no client association with client_id null', async () => {
    connRow = { account_id: '123', client_id: null };
    await syncGa4Config('conn-1', 'org-1');
    expect(inserts[0].client_id).toBeNull();
  });

  it('returns null when the connection does not exist', async () => {
    connRow = null;
    expect(await syncGa4Config('conn-1', 'org-1')).toBeNull();
  });
});

describe('hashing and normalisation', () => {
  it('canonicalJson ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('hash is stable across stream/link ordering the normaliser fixes', () => {
    const links = normaliseAdsLinks([{ customerId: '222-222-2222' }, { customerId: '111-111-1111' }]);
    expect(links.map((l) => l.customer_id)).toEqual(['1111111111', '2222222222']);
    const snap = { property_id: '1', currency_code: 'GBP', time_zone: 'UTC', web_streams: [], ads_links: links, data_retention: null };
    expect(hashSnapshot(snap)).toBe(hashSnapshot({ ...snap }));
  });
});
