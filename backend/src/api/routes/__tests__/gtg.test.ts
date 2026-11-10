/**
 * Google tag gateway routes (docs/prd/google-tag-gateway.md §9).
 * A fake in-memory database stands in for Supabase; global fetch is stubbed for the probe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFakeDb, type FakeDb } from '@/services/gtg/__tests__/fakeSupabase';

let db: FakeDb;
vi.mock('@/services/database/supabase', () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }));
vi.mock('@/api/middleware/authMiddleware', () => ({ authMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('@/api/middleware/orgMiddleware', () => ({ orgMiddleware: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('@/services/database/clientQueries', () => ({
  getClient: async (clientId: string, orgId: string) =>
    db.tables['clients'].find((c) => c['id'] === clientId && c['organisation_id'] === orgId) ?? null,
}));

import { gtgRouter, resetGtgVerifyThrottle } from '../gtg';

const ORG = 'org-1';
const CLIENT = 'client-1';
const base = `/api/organisations/${ORG}/clients/${CLIENT}/gtg`;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/organisations', gtgRouter);
  return request(a);
}

const resp = (status: number, body = '') => ({ status, ok: status < 300, headers: { get: () => 'text/plain' }, text: async () => body });

beforeEach(() => {
  resetGtgVerifyThrottle();
  db = createFakeDb({
    clients: [{ id: CLIENT, organisation_id: ORG, status: 'active', website_url: 'https://www.example.com', gtg_status: 'unknown' }],
    client_gtg_endpoints: [],
    dqm_gtg_checks: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

const body = { hostname: 'www.example.com', reserved_path: '/metrics/', tag_or_container: 'gtm-abc1234' };

describe('GET /gtg', () => {
  it('returns the status, an empty registry and the cap for a fresh client', async () => {
    const res = await app().get(base);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'unknown', capture_status: 'unknown', probe_status: 'none', endpoints: [], max_endpoints: 10 });
  });
  it('a stored junk status reads as unknown, never as a guess', async () => {
    db.tables['clients'][0]['gtg_status'] = 'active';
    expect((await app().get(base)).body.data.status).toBe('unknown');
  });
  it('404 for a client outside the org', async () => {
    expect((await app().get(`/api/organisations/other-org/clients/${CLIENT}/gtg`)).status).toBe(404);
  });
  it('lists endpoints with their probe URLs', async () => {
    await app().post(`${base}/endpoints`).send(body);
    const res = await app().get(base);
    expect(res.body.data.endpoints[0].probe_urls).toEqual({
      healthy: 'https://www.example.com/metrics/healthy', geo: 'https://www.example.com/metrics/?validate_geo=healthy',
    });
  });
});

describe('POST /gtg/endpoints', () => {
  it('registers a normalised endpoint as operator_declared', async () => {
    const res = await app().post(`${base}/endpoints`).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234', source: 'operator_declared' });
    expect(res.body.error).toBeNull();
  });
  it('rejects a host that is not the client site (Atlas never probes an arbitrary host)', async () => {
    const res = await app().post(`${base}/endpoints`).send({ ...body, hostname: 'evil.com' });
    expect(res.status).toBe(400);
    expect(db.tables['client_gtg_endpoints']).toHaveLength(0);
  });
  it('rejects the root path, an over-long path and an invalid ID', async () => {
    for (const bad of [{ reserved_path: '/' }, { reserved_path: '/' + 'a'.repeat(101) }, { tag_or_container: 'UA-1-1' }]) {
      expect((await app().post(`${base}/endpoints`).send({ ...body, ...bad })).status).toBe(400);
    }
  });
  it('rejects a missing field via Zod', async () => {
    expect((await app().post(`${base}/endpoints`).send({ hostname: 'www.example.com' })).status).toBe(400);
  });
  it('rejects an eleventh endpoint', async () => {
    for (let i = 0; i < 10; i++) await app().post(`${base}/endpoints`).send({ ...body, reserved_path: `/p${i}` });
    const res = await app().post(`${base}/endpoints`).send({ ...body, reserved_path: '/extra' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Too many/);
  });
});

describe('DELETE /gtg/endpoints/:id', () => {
  it('removes the endpoint, and with none left clears the stale probe result', async () => {
    const created = await app().post(`${base}/endpoints`).send(body);
    Object.assign(db.tables['clients'][0], { gtg_capture_status: 'detected_unverified', gtg_probe_status: 'ok', gtg_probe_checked_at: new Date().toISOString(), gtg_status: 'verified' });
    const res = await app().delete(`${base}/endpoints/${created.body.data.id}`);
    expect(res.status).toBe(200);
    expect(db.tables['client_gtg_endpoints']).toHaveLength(0);
    expect(db.tables['clients'][0]).toMatchObject({ gtg_probe_status: 'none', gtg_status: 'detected_unverified' });
  });
  it('404 for an unknown endpoint', async () => {
    expect((await app().delete(`${base}/endpoints/nope`)).status).toBe(404);
  });
});

describe('POST /gtg/verify', () => {
  it('422 when no path is registered yet', async () => {
    const res = await app().post(`${base}/verify`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No gateway path/);
  });

  it('probes the registered path, stores the result and returns the new status', async () => {
    Object.assign(db.tables['clients'][0], { gtg_capture_status: 'detected_unverified' });
    await app().post(`${base}/endpoints`).send(body);
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, 'ok')));

    const res = await app().post(`${base}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('verified');
    expect(res.body.data.results[0]).toMatchObject({ path_status: 'pass', geo_status: 'pass', verdict: 'ok' });
    expect(db.tables['client_gtg_endpoints'][0]).toMatchObject({ is_verified: true, geo_verified: true });
    expect(db.tables['dqm_gtg_checks']).toHaveLength(1);
  });

  it('reports a failing path honestly as broken', async () => {
    await app().post(`${base}/endpoints`).send(body);
    vi.stubGlobal('fetch', vi.fn(async () => resp(404, 'Not found')));
    const res = await app().post(`${base}/verify`);
    expect(res.body.data.status).toBe('broken');
    expect(res.body.data.results[0].verdict).toBe('broken');
  });

  it('throttles repeat verification of the same client', async () => {
    await app().post(`${base}/endpoints`).send(body);
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, 'ok')));
    expect((await app().post(`${base}/verify`)).status).toBe(200);
    expect((await app().post(`${base}/verify`)).status).toBe(429);
  });
});
