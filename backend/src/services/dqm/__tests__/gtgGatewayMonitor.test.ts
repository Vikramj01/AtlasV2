/**
 * End-to-end through the monitor: registered endpoint → probe → stored check →
 * verification flags → per-client status → org alert input. Fetch is injected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeDb, type FakeDb } from '../../gtg/__tests__/fakeSupabase';

let db: FakeDb;
vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }));

import { runGtgChecks } from '../gtgGatewayMonitor';
import { applyCaptureGtgStatus, getOrgGtgStatusCounts } from '@/services/database/gtgQueries';
import { evaluateGTGAlert } from '../dqmAlertEvaluator';
import { GTG_REQUESTS, GTG_SITE_URL } from '../../audit/__tests__/fixtures/gtgSite';
import type { GtgFetch } from '../gtgProbe';

const ORG = 'org-1';

const resp = (status: number, body = '', ct = 'text/plain') =>
  ({ status, ok: status < 300, headers: { get: () => ct }, text: async () => body }) as never;

beforeEach(() => {
  db = createFakeDb({
    clients: [
      { id: 'c1', organisation_id: ORG, status: 'active', gtg_status: 'unknown' },
      { id: 'c2', organisation_id: ORG, status: 'active', gtg_status: 'unknown' },
    ],
    client_gtg_endpoints: [
      { id: 'e1', org_id: ORG, client_id: 'c1', hostname: 'www.one.com', reserved_path: '/metrics', tag_or_container: 'GTM-AAAA111', is_verified: false, geo_verified: false },
      { id: 'e2', org_id: ORG, client_id: 'c2', hostname: 'www.two.com', reserved_path: '/gw', tag_or_container: 'GTM-BBBB222', is_verified: false, geo_verified: false },
    ],
    dqm_gtg_checks: [],
  });
});

describe('runGtgChecks', () => {
  it('probes only registered endpoints, stores per-client check rows, and sets the verification flags', async () => {
    const fetchImpl: GtgFetch = vi.fn(async () => resp(200, 'ok')) as never;
    const run = await runGtgChecks(ORG, 2000, { fetchImpl });

    expect(run.results).toHaveLength(2);
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0])).toEqual([
      'https://www.one.com/metrics/healthy', 'https://www.one.com/metrics/?validate_geo=healthy',
      'https://www.two.com/gw/healthy', 'https://www.two.com/gw/?validate_geo=healthy',
    ]);
    expect(db.tables['dqm_gtg_checks']).toHaveLength(2);
    expect(db.tables['dqm_gtg_checks'][0]).toMatchObject({ org_id: ORG, client_id: 'c1', endpoint_id: 'e1', check_status: 'pass', geo_status: 'pass' });
    expect(db.tables['client_gtg_endpoints'].map((e) => [e['is_verified'], e['geo_verified']])).toEqual([[true, true], [true, true]]);
  });

  it('AC 3 end to end: routing works, location headers missing → verified_no_geo → a medium (warning) alert', async () => {
    await applyCaptureGtgStatus('c1', 'https://www.one.com/', GTG_REQUESTS.map((r) => ({ ...r, url: r.url.replace('www.example.com', 'www.one.com') })));
    const fetchImpl: GtgFetch = vi.fn(async (url: string) => (url.includes('validate_geo') ? resp(200, 'no location') : resp(200, 'ok'))) as never;
    await runGtgChecks(ORG, 2000, { clientId: 'c1', fetchImpl });

    expect(db.tables['clients'][0]['gtg_status']).toBe('verified_no_geo');
    const counts = await getOrgGtgStatusCounts(ORG);
    const decision = evaluateGTGAlert({ brokenCount: counts.broken, noGeoCount: counts.noGeo, partialCount: counts.partial, existingAlertActive: false });
    expect(decision).toMatchObject({ decision: 'open', severity: 'warning' });
  });

  it('a deliberately broken test path → broken → a critical alert (the Sprint 3 exit criterion)', async () => {
    await applyCaptureGtgStatus('c1', 'https://www.one.com/', GTG_REQUESTS.map((r) => ({ ...r, url: r.url.replace('www.example.com', 'www.one.com') })));
    const fetchImpl: GtgFetch = vi.fn(async () => resp(404, 'Not found')) as never;
    await runGtgChecks(ORG, 2000, { fetchImpl });

    expect(db.tables['clients'][0]['gtg_status']).toBe('broken');
    expect(db.tables['clients'][1]['gtg_status']).toBe('broken'); // broken whatever the page shows
    expect(db.tables['client_gtg_endpoints'].every((e) => e['is_verified'] === false)).toBe(true);
    const counts = await getOrgGtgStatusCounts(ORG);
    expect(evaluateGTGAlert({ brokenCount: counts.broken, noGeoCount: 0, partialCount: 0, existingAlertActive: false })).toMatchObject({ decision: 'open', severity: 'critical' });
  });

  it('recovery: a later clean run clears broken and the alert resolves', async () => {
    await applyCaptureGtgStatus('c1', 'https://www.one.com/', GTG_REQUESTS.map((r) => ({ ...r, url: r.url.replace('www.example.com', 'www.one.com') })));
    await runGtgChecks(ORG, 2000, { clientId: 'c1', fetchImpl: vi.fn(async () => resp(404)) as never });
    expect(db.tables['clients'][0]['gtg_status']).toBe('broken');
    await runGtgChecks(ORG, 2000, { clientId: 'c1', fetchImpl: vi.fn(async () => resp(200, 'ok')) as never });
    expect(db.tables['clients'][0]['gtg_status']).toBe('verified');
    const counts = await getOrgGtgStatusCounts(ORG);
    expect(evaluateGTGAlert({ brokenCount: counts.broken, noGeoCount: counts.noGeo, partialCount: counts.partial, existingAlertActive: true }).decision).toBe('resolve');
  });

  it('a rate-limited run is inconclusive: it neither verifies nor breaks a client', async () => {
    await runGtgChecks(ORG, 2000, { fetchImpl: vi.fn(async () => resp(429)) as never });
    expect(db.tables['clients'].map((c) => c['gtg_status'])).toEqual(['unknown', 'unknown']);
    expect(db.tables['client_gtg_endpoints'].every((e) => e['is_verified'] === false)).toBe(true);
  });

  it('no registered endpoints → no probing, no writes', async () => {
    db.tables['client_gtg_endpoints'].length = 0;
    const fetchImpl = vi.fn();
    const run = await runGtgChecks(ORG, 2000, { fetchImpl: fetchImpl as never });
    expect(run.results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.tables['dqm_gtg_checks']).toHaveLength(0);
  });

  it('one client failing to update does not stop the others', async () => {
    const orig = db.from.bind(db);
    let first = true;
    db.from = (t: string) => {
      if (t === 'clients' && first) { first = false; db.failing.add('clients'); const r = orig(t); db.failing.delete('clients'); return r; }
      return orig(t);
    };
    const run = await runGtgChecks(ORG, 2000, { fetchImpl: vi.fn(async () => resp(200, 'ok')) as never });
    expect(run.results).toHaveLength(2);
  });
});

describe('evaluateGTGAlert is driven by the combined status, so a capture-only partial alerts too', () => {
  it('partial on a client with no endpoint registered → info', async () => {
    db.tables['clients'][0]['gtg_status'] = 'partial';
    const counts = await getOrgGtgStatusCounts(ORG);
    expect(evaluateGTGAlert({ brokenCount: 0, noGeoCount: 0, partialCount: counts.partial, existingAlertActive: false }).severity).toBe('info');
  });
});

void GTG_SITE_URL;
