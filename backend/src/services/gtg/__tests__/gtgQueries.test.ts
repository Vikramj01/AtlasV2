import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, type FakeDb } from './fakeSupabase';

let db: FakeDb;
vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }));

import {
  applyCaptureGtgStatus, applyProbeStatus, captureEvidence, deleteEndpoint, discoverGtgEndpointsFromCapture,
  endpointsFromCapture, getOrgGtgStatusCounts, listEndpointsForOrg, recordDetectedEndpoints, recordEndpointVerification,
  upsertOperatorEndpoint,
} from '@/services/database/gtgQueries';
import { contextForSite } from '@/services/google/googleEndpointMatcher';
import { DIRECT_REQUESTS, GTG_REQUESTS, GTG_SITE_URL, req } from '../../audit/__tests__/fixtures/gtgSite';
import type { GtgProbeResult } from '@/services/dqm/gtgProbe';

const ORG = 'org-1';
const CLIENT = 'client-1';
const now = new Date('2026-11-10T12:00:00Z');

function seed(client: Record<string, unknown> = {}) {
  db = createFakeDb({
    clients: [{ id: CLIENT, organisation_id: ORG, status: 'active', gtg_status: 'unknown', gtg_capture_status: null, gtg_probe_status: null, gtg_probe_checked_at: null, gtg_went_live_at: null, ...client }],
    client_gtg_endpoints: [],
    dqm_gtg_checks: [],
  });
}
const client = () => db.tables['clients'][0];

beforeEach(() => seed());

describe('captureEvidence / endpointsFromCapture', () => {
  const ctx = contextForSite(GTG_SITE_URL);
  it('gateway capture: first-party gateway load, no Google-direct load', () => {
    expect(captureEvidence(GTG_REQUESTS, ctx)).toEqual({ hasFirstPartyLoad: true, hasGoogleDirectLoad: false, firstPartyIsGateway: true });
  });
  it('pre-gateway capture: Google-direct load only', () => {
    expect(captureEvidence(DIRECT_REQUESTS, ctx)).toEqual({ hasFirstPartyLoad: false, hasGoogleDirectLoad: true, firstPartyIsGateway: false });
  });
  it('hits alone are not loads', () => {
    expect(captureEvidence([req('https://www.example.com/metrics/g/collect?tid=G-ABCDEF1234')], ctx))
      .toEqual({ hasFirstPartyLoad: false, hasGoogleDirectLoad: false, firstPartyIsGateway: false });
  });
  it('a gateway loader reveals its host, reserved path and tag', () => {
    expect(endpointsFromCapture(GTG_REQUESTS, ctx)).toEqual([
      { hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234' },
    ]);
  });
  it('a Google-direct capture, or an unattributable same-site loader, reveals nothing to register', () => {
    expect(endpointsFromCapture(DIRECT_REQUESTS, ctx)).toEqual([]);
    expect(endpointsFromCapture([req('https://www.example.com/gtm.js?id=GTM-ABC1234')], ctx)).toEqual([]);
  });
});

describe('capture-derived status', () => {
  it('a gateway capture on an unknown client → detected_unverified (no GTM connection involved)', async () => {
    expect(await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS)).toBe('detected_unverified');
    expect(client()).toMatchObject({ gtg_status: 'detected_unverified', gtg_capture_status: 'detected_unverified' });
  });
  it('a Google-direct capture → not_detected', async () => {
    expect(await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, DIRECT_REQUESTS)).toBe('not_detected');
  });
  it('a capture that saw no loader never erases an earlier observation', async () => {
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS);
    expect(await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, [req('https://www.example.com/app.js')])).toBeNull();
    expect(client().gtg_capture_status).toBe('detected_unverified');
  });
  it('returns null and writes nothing when the status does not change', async () => {
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, DIRECT_REQUESTS);
    expect(await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, DIRECT_REQUESTS)).toBeNull();
  });
  it('a capture never overwrites an operator-declared not_applicable', async () => {
    seed({ gtg_status: 'not_applicable' });
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, DIRECT_REQUESTS);
    expect(client().gtg_status).toBe('not_applicable');
  });
  it('junk stored values are treated as unknown, not trusted', async () => {
    seed({ gtg_status: 'garbage', gtg_capture_status: 'garbage' });
    expect(await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, DIRECT_REQUESTS)).toBe('not_detected');
  });
});

describe('probe-derived status and ordering', () => {
  it('probe ok first, capture later → verified, and went_live_at is stamped once', async () => {
    await applyProbeStatus(CLIENT, 'ok', now);
    expect(client().gtg_status).toBe('unknown'); // path works, but nothing shows the page uses it yet
    expect(await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS)).toBe('verified');
    const firstLive = client().gtg_went_live_at;
    expect(firstLive).toBeTruthy();
    await applyProbeStatus(CLIENT, 'ok', new Date(now.getTime() + 1000));
    expect(client().gtg_went_live_at).toBe(firstLive);
  });
  it('capture first, probe later → verified (the same answer in the other order)', async () => {
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS);
    expect(await applyProbeStatus(CLIENT, 'ok', new Date())).toBe('verified');
  });
  it('location headers dropping later → verified_no_geo', async () => {
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS);
    await applyProbeStatus(CLIENT, 'ok', new Date());
    expect(await applyProbeStatus(CLIENT, 'no_geo', new Date())).toBe('verified_no_geo');
  });
  it('a broken path → broken, a later inconclusive probe keeps it broken, then a clean probe recovers', async () => {
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS);
    await applyProbeStatus(CLIENT, 'broken', new Date());
    expect(client().gtg_status).toBe('broken');
    expect(await applyProbeStatus(CLIENT, 'inconclusive', new Date())).toBeNull();
    expect(client().gtg_status).toBe('broken');
    expect(await applyProbeStatus(CLIENT, 'ok', new Date())).toBe('verified');
  });
  it('a stored probe older than 24h no longer supports verified when a capture re-evaluates', async () => {
    seed({ gtg_status: 'verified', gtg_capture_status: 'detected_unverified', gtg_probe_status: 'ok', gtg_probe_checked_at: '2020-01-01T00:00:00Z' });
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS);
    // stale probe → inconclusive → keeps the standing verified rather than regress on missing evidence
    expect(client().gtg_status).toBe('verified');
  });
  it('removing the last endpoint (probe none) drops the stale probe result', async () => {
    await applyCaptureGtgStatus(CLIENT, GTG_SITE_URL, GTG_REQUESTS);
    await applyProbeStatus(CLIENT, 'ok', new Date());
    expect(await applyProbeStatus(CLIENT, 'none', new Date())).toBe('detected_unverified');
  });
});

describe('endpoint registry', () => {
  const input = { hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234' };

  it('operator add is stored as operator_declared; re-adding updates, never duplicates', async () => {
    await upsertOperatorEndpoint(ORG, CLIENT, input);
    await upsertOperatorEndpoint(ORG, CLIENT, input);
    expect(db.tables['client_gtg_endpoints']).toHaveLength(1);
    expect(db.tables['client_gtg_endpoints'][0]).toMatchObject({ source: 'operator_declared', org_id: ORG });
  });
  it('correcting the tag resets verification so a stale pass is not inherited', async () => {
    await upsertOperatorEndpoint(ORG, CLIENT, input);
    Object.assign(db.tables['client_gtg_endpoints'][0], { is_verified: true, geo_verified: true, verified_at: 'x' });
    await upsertOperatorEndpoint(ORG, CLIENT, { ...input, tag_or_container: 'GTM-ZZZ9999' });
    expect(db.tables['client_gtg_endpoints'][0]).toMatchObject({ tag_or_container: 'GTM-ZZZ9999', is_verified: false, geo_verified: false, verified_at: null });
  });
  it('caps endpoints per client at 10', async () => {
    for (let i = 0; i < 10; i++) await upsertOperatorEndpoint(ORG, CLIENT, { ...input, reserved_path: `/p${i}` });
    await expect(upsertOperatorEndpoint(ORG, CLIENT, { ...input, reserved_path: '/one-too-many' })).rejects.toThrow(/at most 10/);
  });
  it('a detected endpoint never overwrites an operator entry', async () => {
    await upsertOperatorEndpoint(ORG, CLIENT, { ...input, tag_or_container: 'G-OPERATOR1' });
    expect(await recordDetectedEndpoints(ORG, CLIENT, [input])).toBe(0);
    expect(db.tables['client_gtg_endpoints'][0]).toMatchObject({ source: 'operator_declared', tag_or_container: 'G-OPERATOR1' });
  });
  it('discovery from a gateway capture registers a detected endpoint; a Google-direct capture registers none', async () => {
    expect(await discoverGtgEndpointsFromCapture(ORG, CLIENT, GTG_SITE_URL, DIRECT_REQUESTS)).toBe(0);
    expect(await discoverGtgEndpointsFromCapture(ORG, CLIENT, GTG_SITE_URL, GTG_REQUESTS)).toBe(1);
    expect(db.tables['client_gtg_endpoints'][0]).toMatchObject({ source: 'detected', reserved_path: '/metrics' });
    expect(db.tables['client_gtg_endpoints'][0]['is_verified']).not.toBe(true); // detected is never verified: only the probe verifies
    expect(await discoverGtgEndpointsFromCapture(ORG, CLIENT, GTG_SITE_URL, GTG_REQUESTS)).toBe(0);
  });
  it('delete is scoped to the client', async () => {
    const ep = await upsertOperatorEndpoint(ORG, CLIENT, input);
    expect(await deleteEndpoint('some-other-client', ep.id)).toBe(false);
    expect(await deleteEndpoint(CLIENT, ep.id)).toBe(true);
  });
  it('listEndpointsForOrg returns only active clients endpoints of that org', async () => {
    await upsertOperatorEndpoint(ORG, CLIENT, input);
    db.tables['clients'].push({ id: 'archived', organisation_id: ORG, status: 'archived' });
    db.tables['client_gtg_endpoints'].push({ id: 'x', org_id: ORG, client_id: 'archived', hostname: 'a.example.com', reserved_path: '/z', tag_or_container: 'GTM-AAAA111' });
    const list = await listEndpointsForOrg(ORG);
    expect(list.map((e) => e.client_id)).toEqual([CLIENT]);
  });
});

describe('recordEndpointVerification', () => {
  const result = (verdict: GtgProbeResult['verdict']): GtgProbeResult => ({
    endpointId: 'ep', clientId: CLIENT, healthyUrl: '', pathStatus: 'pass', geoStatus: 'pass', httpStatus: 200, responseMs: 5, errorMessage: null, rateLimited: false, verdict,
  });
  beforeEach(() => db.tables['client_gtg_endpoints'].push({ id: 'ep', org_id: ORG, client_id: CLIENT, hostname: 'w', reserved_path: '/m', tag_or_container: 'GTM-AAAA111', is_verified: false, geo_verified: false, verified_at: null }));

  it('ok → verified + geo_verified; no_geo → verified only; broken → both cleared; inconclusive → untouched', async () => {
    const ep = () => db.tables['client_gtg_endpoints'][0];
    await recordEndpointVerification([result('ok')], now);
    expect(ep()).toMatchObject({ is_verified: true, geo_verified: true, verified_at: now.toISOString() });
    await recordEndpointVerification([result('no_geo')], now);
    expect(ep()).toMatchObject({ is_verified: true, geo_verified: false });
    await recordEndpointVerification([result('inconclusive')], now);
    expect(ep()).toMatchObject({ is_verified: true, geo_verified: false });
    await recordEndpointVerification([result('broken')], now);
    expect(ep()).toMatchObject({ is_verified: false, geo_verified: false });
  });
});

describe('getOrgGtgStatusCounts', () => {
  it('counts only gateway-relevant statuses; unknown, not_applicable and not_detected are not monitored', async () => {
    db = createFakeDb({
      clients: ['broken', 'verified_no_geo', 'partial', 'verified', 'unknown', 'not_applicable', 'not_detected', 'garbage']
        .map((s, i) => ({ id: `c${i}`, organisation_id: ORG, status: 'active', gtg_status: s })),
    });
    expect(await getOrgGtgStatusCounts(ORG)).toEqual({ broken: 1, noGeo: 1, partial: 1, monitored: 4 });
  });
  it('excludes archived clients', async () => {
    db = createFakeDb({ clients: [{ id: 'a', organisation_id: ORG, status: 'archived', gtg_status: 'broken' }] });
    expect((await getOrgGtgStatusCounts(ORG)).broken).toBe(0);
  });
});
