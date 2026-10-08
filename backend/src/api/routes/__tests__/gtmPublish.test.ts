/**
 * POST /api/gtm/publish, /publish/:logId/rollback, GET /publish-log, and the
 * can_publish flag on GET /containers (GA4 Admin / L11 / Junk Gate PRD §A.6, AC 6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let connectionRow: unknown;
let containersRows: unknown[];
vi.mock('@/services/database/supabase', () => {
  const make = (table: string) => {
    const chain: any = {};
    for (const m of ['select', 'eq', 'order', 'update', 'insert', 'delete']) chain[m] = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn(async () => ({ data: table === 'profiles' ? { organization_id: 'org-1' } : { oauth_credentials_encrypted: 'enc' }, error: null }));
    chain.maybeSingle = vi.fn(async () => ({ data: connectionRow, error: null }));
    chain.then = (resolve: Function) => resolve({ data: containersRows, error: null });
    return chain;
  };
  return { supabaseAdmin: { from: (t: string) => make(t) } };
});

const decrypt = vi.fn();
vi.mock('@/services/gtm/gtmCredentials', () => ({ encryptGtmCredentials: vi.fn(() => 'enc'), decryptGtmCredentials: (...a: unknown[]) => decrypt(...a) }));
vi.mock('@/services/gtm/containerParser', () => ({ parseContainerJson: vi.fn(), validateContainerJsonShape: vi.fn() }));
vi.mock('@/services/gtm/gtmDeployService', () => ({ deployContainerToGtm: vi.fn() }));
vi.mock('@/services/google/googleTagSplitService', () => ({ loadSplitPlanContext: vi.fn(), buildSplitPlan: vi.fn() }));
vi.mock('@/services/google/googleTagSplitVerification', () => ({ evaluateSplitVerification: vi.fn() }));
vi.mock('@/services/google/googleTagDiscontinuities', () => ({ buildSplitDiscontinuityRows: vi.fn(), resolveSplitEffectiveDate: vi.fn() }));
vi.mock('@/services/database/discontinuityQueries', () => ({ writeClientDiscontinuities: vi.fn() }));
vi.mock('@/services/database/googleTagSplitPlanQueries', () => ({ insertSplitPlan: vi.fn(), getSplitPlan: vi.fn(), markSplitPlanDeployed: vi.fn(), markSplitPlanVerified: vi.fn() }));

const publishAtlasWorkspace = vi.fn();
const republishVersion = vi.fn();
vi.mock('@/services/gtm/gtmPublishService', async () => {
  const actual = await vi.importActual<typeof import('@/services/gtm/gtmPublishService')>('@/services/gtm/gtmPublishService');
  return { ...actual, publishAtlasWorkspace: (...a: unknown[]) => publishAtlasWorkspace(...a), republishVersion: (...a: unknown[]) => republishVersion(...a) };
});
const insertPublishLog = vi.fn();
const getPublishLog = vi.fn();
const listPublishLog = vi.fn();
const markRolledBack = vi.fn();
vi.mock('@/services/database/gtmPublishLogQueries', () => ({
  insertPublishLog: (...a: unknown[]) => insertPublishLog(...a),
  getPublishLog: (...a: unknown[]) => getPublishLog(...a),
  listPublishLog: (...a: unknown[]) => listPublishLog(...a),
  markRolledBack: (...a: unknown[]) => markRolledBack(...a),
}));
vi.mock('@/services/queue/jobQueue', () => ({ gtmContainerSyncQueue: { add: vi.fn().mockResolvedValue({ id: 'j' }) } }));
vi.mock('@/services/capi/dedupStore', () => ({ dedupRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('@/api/middleware/authMiddleware', () => ({ authMiddleware: (_r: any, _s: any, n: any) => n() }));
vi.mock('@/api/middleware/planGuard', () => ({ planGuard: () => (_r: any, _s: any, n: any) => n() }));
vi.mock('@/utils/apiError', () => ({ sendInternalError: (res: any) => res.status(500).json({ error: 'Internal server error' }) }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [], FRONTEND_URL: 'https://app.example.com', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 's', OAUTH_STATE_SECRET: 'test-oauth-state-secret-32-chars!!' },
}));

import { gtmRouter } from '../gtm';
import { gtmContainerSyncQueue } from '@/services/queue/jobQueue';
import { GtmPublishRefused } from '@/services/gtm/gtmPublishService';
import { GTM_SCOPE, GTM_SCOPE_READONLY, GTM_SCOPE_EDIT_CONTAINERS } from '@/services/gtm/gtmScopes';

const CONN = '11111111-1111-4111-8111-111111111111';
const app = () => {
  const a = express();
  a.use((req: any, _res: any, next: any) => { req.user = { id: 'u1', email: 'u@test.com', plan: 'pro', isSuperAdmin: false }; next(); });
  a.use(express.json());
  a.use('/api/gtm', gtmRouter);
  return request(a);
};

const oauthConn = (over: Record<string, unknown> = {}) => ({ id: CONN, client_id: 'client-1', account_id: '1', container_id: '2', auth_method: 'oauth', oauth_credentials_encrypted: 'enc', ...over });
const body = (over: Record<string, unknown> = {}) => ({ connection_id: CONN, workspace_id: '9', confirm: true, ...over });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  connectionRow = oauthConn();
  containersRows = [];
  decrypt.mockReturnValue({ scope: GTM_SCOPE, refresh_token: 'r', access_token: 'a', expires_at: 0 });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600 }), text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
  publishAtlasWorkspace.mockResolvedValue({ published_version_id: '42', previous_version_id: '41' });
  insertPublishLog.mockResolvedValue({ id: 'log-1' });
});

describe('POST /api/gtm/publish', () => {
  it('refuses without the confirmation flag — nothing is touched', async () => {
    for (const confirm of [undefined, false, 'true', 1]) {
      const res = await app().post('/api/gtm/publish').send(body({ confirm }));
      expect(res.status).toBe(400);
      if (confirm === undefined || confirm === false) expect(res.body.code).toBe('CONFIRMATION_REQUIRED');
    }
    expect(publishAtlasWorkspace).not.toHaveBeenCalled();
    expect(insertPublishLog).not.toHaveBeenCalled();
  });

  it('refuses an old-scope connection with a named error, never attempting the publish', async () => {
    decrypt.mockReturnValue({ scope: `${GTM_SCOPE_READONLY} ${GTM_SCOPE_EDIT_CONTAINERS}` });
    const res = await app().post('/api/gtm/publish').send(body());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GTM_RECONNECT_REQUIRED');
    expect(res.body.error).toMatch(/Reconnect via OAuth to enable publishing/);
    expect(publishAtlasWorkspace).not.toHaveBeenCalled();
  });

  it('refuses a manual-upload connection (no write credentials)', async () => {
    connectionRow = oauthConn({ auth_method: 'manual_upload', oauth_credentials_encrypted: null });
    const res = await app().post('/api/gtm/publish').send(body());
    expect(res.status).toBe(400);
    expect(publishAtlasWorkspace).not.toHaveBeenCalled();
  });

  it('404s a connection outside the org', async () => {
    connectionRow = null;
    expect((await app().post('/api/gtm/publish').send(body())).status).toBe(404);
  });

  it('publishes, logs the replaced version and the user, and queues a snapshot', async () => {
    const res = await app().post('/api/gtm/publish').send(body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ log_id: 'log-1', published_version_id: '42', previous_version_id: '41', rollback_available: true, snapshot_queued: true });
    expect(insertPublishLog).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: 'org-1', connection_id: CONN, client_id: 'client-1', workspace_id: '9', action: 'publish',
      published_version_id: '42', previous_version_id: '41', user_id: 'u1',
    }));
    expect(gtmContainerSyncQueue.add).toHaveBeenCalledWith({ connection_id: CONN, organization_id: 'org-1' });
  });

  it('first-ever publish: logged, but rollback is reported unavailable', async () => {
    publishAtlasWorkspace.mockResolvedValue({ published_version_id: '42', previous_version_id: null });
    const res = await app().post('/api/gtm/publish').send(body());
    expect(res.body.data.rollback_available).toBe(false);
  });

  it('a log write failure after a successful publish still reports success, honestly', async () => {
    insertPublishLog.mockRejectedValue(new Error('db'));
    const res = await app().post('/api/gtm/publish').send(body());
    expect(res.status).toBe(201);
    expect(res.body.data.log_id).toBeNull();
    expect(res.body.data.rollback_available).toBe(false);
    expect(res.body.message).toMatch(/publish log could not be written/);
  });

  it('a queue failure never fails the publish', async () => {
    vi.mocked(gtmContainerSyncQueue.add).mockRejectedValueOnce(new Error('redis'));
    const res = await app().post('/api/gtm/publish').send(body());
    expect(res.status).toBe(201);
    expect(res.body.data.snapshot_queued).toBe(false);
  });

  it('maps service refusals to named errors (non-Atlas workspace 403, compiler error 409) and logs nothing', async () => {
    publishAtlasWorkspace.mockRejectedValueOnce(new GtmPublishRefused('NOT_ATLAS_WORKSPACE', 'x'));
    let res = await app().post('/api/gtm/publish').send(body());
    expect([res.status, res.body.code]).toEqual([403, 'NOT_ATLAS_WORKSPACE']);
    publishAtlasWorkspace.mockRejectedValueOnce(new GtmPublishRefused('COMPILER_ERROR', 'y'));
    res = await app().post('/api/gtm/publish').send(body());
    expect([res.status, res.body.code]).toEqual([409, 'COMPILER_ERROR']);
    expect(insertPublishLog).not.toHaveBeenCalled();
  });
});

describe('POST /api/gtm/publish/:logId/rollback', () => {
  const logRow = (over: Record<string, unknown> = {}) => ({
    id: 'log-1', action: 'publish', connection_id: CONN, published_version_id: '42', previous_version_id: '41', rolled_back_at: null, ...over,
  });

  beforeEach(() => {
    getPublishLog.mockResolvedValue(logRow());
    republishVersion.mockResolvedValue({ previous_version_id: '42' });
    insertPublishLog.mockResolvedValue({ id: 'log-2' });
    markRolledBack.mockResolvedValue(true);
  });

  it('refuses without the confirmation flag', async () => {
    const res = await app().post('/api/gtm/publish/log-1/rollback').send({});
    expect([res.status, res.body.code]).toEqual([400, 'CONFIRMATION_REQUIRED']);
    expect(republishVersion).not.toHaveBeenCalled();
  });

  it('re-publishes the logged previous version, expecting the logged publish to still be live, and logs the rollback', async () => {
    const res = await app().post('/api/gtm/publish/log-1/rollback').send({ confirm: true });
    expect(res.status).toBe(201);
    expect(republishVersion).toHaveBeenCalledWith(expect.objectContaining({ versionId: '41', expectedLiveVersionId: '42', accountId: '1', containerId: '2' }));
    expect(insertPublishLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'rollback', published_version_id: '41', previous_version_id: '42', rollback_of: 'log-1', user_id: 'u1' }));
    expect(markRolledBack).toHaveBeenCalledWith('log-1');
    expect(res.body.data.restored_version_id).toBe('41');
  });

  it('404s an unknown/other-org log', async () => {
    getPublishLog.mockResolvedValue(null);
    expect((await app().post('/api/gtm/publish/nope/rollback').send({ confirm: true })).status).toBe(404);
  });

  it('refuses when there is nothing to roll back to (first-ever publish)', async () => {
    getPublishLog.mockResolvedValue(logRow({ previous_version_id: null }));
    const res = await app().post('/api/gtm/publish/log-1/rollback').send({ confirm: true });
    expect([res.status, res.body.code]).toEqual([409, 'NO_PREVIOUS_VERSION']);
    expect(republishVersion).not.toHaveBeenCalled();
  });

  it('refuses a second rollback and a rollback of a rollback', async () => {
    getPublishLog.mockResolvedValue(logRow({ rolled_back_at: '2026-10-06T10:00:00Z' }));
    expect((await app().post('/api/gtm/publish/log-1/rollback').send({ confirm: true })).body.code).toBe('ALREADY_ROLLED_BACK');
    getPublishLog.mockResolvedValue(logRow({ action: 'rollback' }));
    expect((await app().post('/api/gtm/publish/log-1/rollback').send({ confirm: true })).body.code).toBe('NOT_A_PUBLISH');
    expect(republishVersion).not.toHaveBeenCalled();
  });

  it('refuses on an old-scope connection with the named reconnect error', async () => {
    decrypt.mockReturnValue({ scope: GTM_SCOPE_EDIT_CONTAINERS });
    const res = await app().post('/api/gtm/publish/log-1/rollback').send({ confirm: true });
    expect([res.status, res.body.code]).toEqual([403, 'GTM_RECONNECT_REQUIRED']);
  });

  it('does not roll back over a later publish by someone else (LIVE_VERSION_CHANGED), and records nothing', async () => {
    republishVersion.mockRejectedValue(new GtmPublishRefused('LIVE_VERSION_CHANGED', 'moved'));
    const res = await app().post('/api/gtm/publish/log-1/rollback').send({ confirm: true });
    expect([res.status, res.body.code]).toEqual([409, 'LIVE_VERSION_CHANGED']);
    expect(insertPublishLog).not.toHaveBeenCalled();
    expect(markRolledBack).not.toHaveBeenCalled();
  });
});

describe('GET /api/gtm/containers — can_publish, never credentials', () => {
  it('reports what each stored grant can do and strips the encrypted credentials', async () => {
    containersRows = [
      { id: 'a', auth_method: 'oauth', container_id: 'C1', oauth_credentials_encrypted: 'enc-new' },
      { id: 'b', auth_method: 'oauth', container_id: 'C2', oauth_credentials_encrypted: 'enc-old' },
      { id: 'c', auth_method: 'manual_upload', container_id: 'C3', oauth_credentials_encrypted: null },
    ];
    decrypt.mockImplementation((enc: string) => ({ scope: enc === 'enc-new' ? GTM_SCOPE : GTM_SCOPE_EDIT_CONTAINERS }));
    const res = await app().get('/api/gtm/containers');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map((r: any) => [r.id, r]));
    expect([byId.a.can_deploy, byId.a.can_publish]).toEqual([true, true]);
    expect([byId.b.can_deploy, byId.b.can_publish]).toEqual([true, false]);
    expect([byId.c.can_deploy, byId.c.can_publish]).toEqual([false, false]);
    expect(JSON.stringify(res.body)).not.toContain('enc-');
    expect(JSON.stringify(res.body)).not.toContain('oauth_credentials_encrypted');
  });

  it('a grant that cannot be decrypted reports no capabilities rather than failing the list', async () => {
    containersRows = [{ id: 'a', auth_method: 'oauth', container_id: 'C1', oauth_credentials_encrypted: 'garbage' }];
    decrypt.mockImplementation(() => { throw new Error('bad'); });
    const res = await app().get('/api/gtm/containers');
    expect(res.status).toBe(200);
    expect(res.body.data[0].can_publish).toBe(false);
  });
});

describe('GET /api/gtm/publish-log', () => {
  it('lists the org\'s records, optionally for one connection', async () => {
    listPublishLog.mockResolvedValue([{ id: 'log-1' }]);
    const res = await app().get(`/api/gtm/publish-log?connection_id=${CONN}`);
    expect(res.body.data).toEqual([{ id: 'log-1' }]);
    expect(listPublishLog).toHaveBeenCalledWith('org-1', CONN);
  });
});
