/**
 * Google Tag Topology Sprint 4 — /api/gtm/split-plan routes.
 *
 * AC 12: deploy creates a draft workspace and never publishes.
 * AC 13: a plan reaches `verified` only after a fresh observation (route-level).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// One flexible chain: resolves profiles' organization_id AND the connection's encrypted credentials.
vi.mock('@/services/database/supabase', () => {
  const chain: any = { then: (resolve: Function) => resolve({ data: null, error: null }) };
  for (const m of ['select', 'eq', 'update']) chain[m] = () => chain;
  chain.single = async () => ({ data: { organization_id: 'org-1', oauth_credentials_encrypted: 'enc' }, error: null });
  return { supabaseAdmin: { from: () => chain } };
});
vi.mock('@/services/gtm/gtmCredentials', () => ({
  encryptGtmCredentials: vi.fn().mockReturnValue('enc2'),
  decryptGtmCredentials: vi.fn().mockReturnValue({ access_token: 'old', refresh_token: 'rt', expires_at: 0, scope: 'x' }),
}));
vi.mock('@/services/gtm/containerParser', () => ({ parseContainerJson: vi.fn(), validateContainerJsonShape: vi.fn() }));
vi.mock('@/services/queue/jobQueue', () => ({ gtmContainerSyncQueue: { add: vi.fn() } }));
vi.mock('@/services/gtm/gtmDeployService', () => ({ deployContainerToGtm: vi.fn() }));
vi.mock('@/services/capi/dedupStore', () => ({ dedupRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('@/api/middleware/authMiddleware', () => ({ authMiddleware: (_r: any, _s: any, n: any) => n() }));
vi.mock('@/api/middleware/planGuard', () => ({ planGuard: () => (_r: any, _s: any, n: any) => n() }));
vi.mock('@/utils/apiError', () => ({ sendInternalError: (res: any) => res.status(500).json({ error: 'Internal server error' }) }));
vi.mock('@/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/config/env', () => ({
  env: {
    SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [], FRONTEND_URL: 'https://app.example.com',
    GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', OAUTH_STATE_SECRET: 'test-oauth-state-secret-32-chars!!',
  },
}));
vi.mock('@/services/google/googleTagSplitService', () => ({ loadSplitPlanContext: vi.fn(), buildSplitPlan: vi.fn() }));
vi.mock('@/services/database/discontinuityQueries', () => ({ writeClientDiscontinuities: vi.fn() }));
vi.mock('@/services/database/googleTagSplitPlanQueries', () => ({
  insertSplitPlan: vi.fn(), getSplitPlan: vi.fn(), markSplitPlanDeployed: vi.fn(), markSplitPlanVerified: vi.fn(),
}));

import { deployContainerToGtm } from '@/services/gtm/gtmDeployService';
import { loadSplitPlanContext, buildSplitPlan } from '@/services/google/googleTagSplitService';
import { insertSplitPlan, getSplitPlan, markSplitPlanVerified } from '@/services/database/googleTagSplitPlanQueries';
import { writeClientDiscontinuities } from '@/services/database/discontinuityQueries';
import { gtmRouter } from '../gtm';

const CONN = '11111111-1111-4111-8111-111111111111';
const DELTA = { containerVersion: { tag: [{ name: 'Google Tag - Google Ads' }] } };

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => { req.user = { id: 'u1', email: 'u@test.com', plan: 'pro', isSuperAdmin: false }; next(); });
  app.use(express.json());
  app.use('/api/gtm', gtmRouter);
  return request(app);
}

const ctx = (over: Record<string, unknown> = {}) => ({
  connection: { id: CONN, client_id: 'c1', account_id: 'acc', container_id: 'GTM-1', auth_method: 'oauth', ...over },
  snapshot: { snapshot_at: '2026-10-01T12:00:00Z', container: { tags: [], triggers: [], variables: [] } },
  clientId: 'c1',
  secondaryDomains: [],
  topologyRows: [{ id: 't1', observed_at: '2026-10-01T12:00:00Z' }],
  topology: { verdict: 'UNKNOWN', strength: 'none', combined_tags: [], destination_count: 0 },
});
const built = (conflicts: unknown[] = [], delta: unknown = DELTA) => ({
  plan: { delta, diff: { tags_added: ['Google Tag - Google Ads'] }, conflicts, destinations: { ga4: 'G-1', google_ads: 'AW-1' } },
  guidance: [{ step: 1 }],
  topology: { verdict: 'UNKNOWN' },
});

beforeEach(() => vi.clearAllMocks());

describe('POST /api/gtm/split-plan', () => {
  it('returns the plan with no side effects by default', async () => {
    vi.mocked(loadSplitPlanContext).mockResolvedValue(ctx() as any);
    vi.mocked(buildSplitPlan).mockReturnValue(built() as any);
    const res = await buildApp().post('/api/gtm/split-plan').send({ connection_id: CONN });
    expect(res.status).toBe(200);
    expect(res.body.data.can_deploy_draft).toBe(true);
    expect(res.body.data.plan_id).toBeNull();
    expect(insertSplitPlan).not.toHaveBeenCalled();
  });

  it('persists a planned row only when asked, and not when there are conflicts', async () => {
    vi.mocked(loadSplitPlanContext).mockResolvedValue(ctx() as any);
    vi.mocked(buildSplitPlan).mockReturnValue(built() as any);
    vi.mocked(insertSplitPlan).mockResolvedValue({ id: 'plan-1' } as any);
    const ok = await buildApp().post('/api/gtm/split-plan').send({ connection_id: CONN, persist: true });
    expect(ok.body.data.plan_id).toBe('plan-1');

    vi.mocked(insertSplitPlan).mockClear();
    vi.mocked(buildSplitPlan).mockReturnValue(built([{ code: 'name_conflict', message: 'x' }], null) as any);
    const blocked = await buildApp().post('/api/gtm/split-plan').send({ connection_id: CONN, persist: true });
    expect(blocked.body.data.can_deploy_draft).toBe(false);
    expect(insertSplitPlan).not.toHaveBeenCalled();
  });

  it('manual-upload connections cannot deploy a draft but still get the plan', async () => {
    vi.mocked(loadSplitPlanContext).mockResolvedValue(ctx({ auth_method: 'manual_upload' }) as any);
    vi.mocked(buildSplitPlan).mockReturnValue(built() as any);
    const res = await buildApp().post('/api/gtm/split-plan').send({ connection_id: CONN });
    expect(res.body.data.can_deploy_draft).toBe(false);
    expect(res.body.data.delta).not.toBeNull();
  });

  it('404 / 409 / 400 paths', async () => {
    vi.mocked(loadSplitPlanContext).mockResolvedValue('no_connection');
    expect((await buildApp().post('/api/gtm/split-plan').send({ connection_id: CONN })).status).toBe(404);
    vi.mocked(loadSplitPlanContext).mockResolvedValue('no_snapshot');
    expect((await buildApp().post('/api/gtm/split-plan').send({ connection_id: CONN })).status).toBe(409);
    expect((await buildApp().post('/api/gtm/split-plan').send({ connection_id: 'nope' })).status).toBe(400);
  });
});

describe('POST /api/gtm/split-plan/deploy (AC 12)', () => {
  it('creates a draft workspace named for the split, records a deployed_draft row, and never publishes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600 }) }));
    vi.mocked(loadSplitPlanContext).mockResolvedValue(ctx() as any);
    vi.mocked(buildSplitPlan).mockReturnValue(built() as any);
    vi.mocked(deployContainerToGtm).mockResolvedValue({ workspace_id: 'ws9', workspace_url: 'u', tags_created: 1 } as any);
    vi.mocked(insertSplitPlan).mockResolvedValue({ id: 'plan-2', status: 'deployed_draft' } as any);

    const res = await buildApp().post('/api/gtm/split-plan/deploy').send({ connection_id: CONN });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ plan_id: 'plan-2', status: 'deployed_draft', workspace_id: 'ws9' });
    expect(res.body.message).toContain('Nothing has been published');
    // The deploy receives the DELTA, the refreshed token, and a split-named workspace.
    const [token, account, container, delta, options] = vi.mocked(deployContainerToGtm).mock.calls[0] as any[];
    expect([token, account, container]).toEqual(['fresh', 'acc', 'GTM-1']);
    expect(delta).toEqual(DELTA);
    expect(options.workspaceName).toMatch(/^Atlas · Google tag split · \d{4}-\d{2}-\d{2}$/);
    expect(vi.mocked(insertSplitPlan).mock.calls[0][0]).toMatchObject({ status: 'deployed_draft', deployedWorkspaceId: 'ws9' });
    vi.unstubAllGlobals();
  });

  it('refuses a manual-upload connection (no write credentials)', async () => {
    vi.mocked(loadSplitPlanContext).mockResolvedValue(ctx({ auth_method: 'manual_upload' }) as any);
    const res = await buildApp().post('/api/gtm/split-plan/deploy').send({ connection_id: CONN });
    expect(res.status).toBe(400);
    expect(deployContainerToGtm).not.toHaveBeenCalled();
  });

  it('refuses to deploy when the plan has conflicts or is empty', async () => {
    vi.mocked(loadSplitPlanContext).mockResolvedValue(ctx() as any);
    vi.mocked(buildSplitPlan).mockReturnValue(built([{ code: 'name_conflict', message: 'x' }], null) as any);
    const res = await buildApp().post('/api/gtm/split-plan/deploy').send({ connection_id: CONN });
    expect(res.status).toBe(409);
    expect(deployContainerToGtm).not.toHaveBeenCalled();
  });

  it('never calls anything but the draft deploy function (no publish path exists in the service)', async () => {
    const svc = await import('@/services/gtm/gtmDeployService');
    expect(Object.keys(svc).filter((k) => /publish/i.test(k))).toEqual([]);
  });
});

describe('POST /api/gtm/split-plan/:id/verify (AC 13)', () => {
  const PLAN = { id: 'p1', status: 'deployed_draft', connection_id: CONN, deployed_at: '2026-10-01T10:00:00Z', created_at: '2026-10-01T09:00:00Z' };

  it('does not mark verified without a fresh observation', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue(PLAN as any);
    vi.mocked(loadSplitPlanContext).mockResolvedValue({ ...ctx(), topologyRows: [], snapshot: { snapshot_at: '2026-10-01T09:30:00Z', container: { tags: [], triggers: [], variables: [] } } } as any);
    const res = await buildApp().post('/api/gtm/split-plan/p1/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(false);
    expect(res.body.data.reasons.length).toBeGreaterThan(0);
    expect(markSplitPlanVerified).not.toHaveBeenCalled();
  });

  it('404s for an unknown plan', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue(null);
    expect((await buildApp().post('/api/gtm/split-plan/p1/verify')).status).toBe(404);
  });
});

describe('POST /api/gtm/split-plan/:id/verify — client-scoped discontinuity (Sprint 5, AC 14)', () => {
  const PLAN = { id: 'p1', status: 'deployed_draft', client_id: 'c1', connection_id: CONN, deployed_at: '2026-10-01T10:00:00Z', created_at: '2026-10-01T09:00:00Z' };
  const FRESH = '2026-10-02T00:00:00Z';
  const googtag = (id: string) => ({ tagId: id, name: id, type: 'googtag', firingTriggerId: ['1'], parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }] });
  const verifiedCtx = () => ({
    ...ctx(),
    snapshot: {
      snapshot_at: FRESH,
      container: { tags: [googtag('G-1'), googtag('AW-1'), { tagId: 'c', name: 'conv', type: 'awct', firingTriggerId: ['1'], parameter: [] }], triggers: [{ triggerId: '1', name: 'All Pages', type: 'PAGEVIEW' }], variables: [] },
    },
    topologyRows: [
      { google_tag_id: 'G-1', primary_destination_id: 'G-1', destination_ids: ['G-1'], source: 'operator_declared', declaration_source: 'CLIENT_CONFIRMED', observed_at: FRESH },
      { google_tag_id: 'AW-1', primary_destination_id: 'AW-1', destination_ids: ['AW-1'], source: 'operator_declared', declaration_source: 'CLIENT_CONFIRMED', observed_at: FRESH },
    ],
  });
  const today = new Date().toISOString().slice(0, 10);

  it('on verification writes one client-scoped discontinuity per affected platform, effective today by default', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue(PLAN as any);
    vi.mocked(loadSplitPlanContext).mockResolvedValue(verifiedCtx() as any);
    vi.mocked(markSplitPlanVerified).mockResolvedValue({ status: 'verified' } as any);
    const res = await buildApp().post('/api/gtm/split-plan/p1/verify').send({});
    expect(res.body.data.verified).toBe(true);
    expect(markSplitPlanVerified).toHaveBeenCalledWith('p1');
    const rows = vi.mocked(writeClientDiscontinuities).mock.calls[0][0] as any[];
    expect(rows.map((r) => r.platform)).toEqual(['ga4', 'google_ads']);
    expect(rows.every((r) => r.kind === 'client_tracking_change' && r.client_id === 'c1' && r.organization_id === 'org-1' && r.effective_date === today)).toBe(true);
  });

  it('uses an operator-supplied earlier split date', async () => {
    // Plan created long ago so the supplied date is valid regardless of the real clock.
    vi.mocked(getSplitPlan).mockResolvedValue({ ...PLAN, created_at: '2020-01-01T00:00:00Z' } as any);
    vi.mocked(loadSplitPlanContext).mockResolvedValue(verifiedCtx() as any);
    vi.mocked(markSplitPlanVerified).mockResolvedValue({ status: 'verified' } as any);
    await buildApp().post('/api/gtm/split-plan/p1/verify').send({ split_date: '2021-06-01' });
    expect((vi.mocked(writeClientDiscontinuities).mock.calls[0][0] as any[])[0].effective_date).toBe('2021-06-01');
  });

  it('400s on a bad split date before changing anything', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue(PLAN as any);
    const res = await buildApp().post('/api/gtm/split-plan/p1/verify').send({ split_date: '2999-01-01' });
    expect(res.status).toBe(400);
    expect(markSplitPlanVerified).not.toHaveBeenCalled();
    expect(writeClientDiscontinuities).not.toHaveBeenCalled();
  });

  it('writes nothing when verification fails', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue(PLAN as any);
    vi.mocked(loadSplitPlanContext).mockResolvedValue({ ...verifiedCtx(), topologyRows: [] } as any);
    const res = await buildApp().post('/api/gtm/split-plan/p1/verify').send({});
    expect(res.body.data.verified).toBe(false);
    expect(writeClientDiscontinuities).not.toHaveBeenCalled();
  });

  it('does not re-write the discontinuity for an already-verified plan', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue({ ...PLAN, status: 'verified' } as any);
    vi.mocked(loadSplitPlanContext).mockResolvedValue(verifiedCtx() as any);
    await buildApp().post('/api/gtm/split-plan/p1/verify').send({});
    expect(writeClientDiscontinuities).not.toHaveBeenCalled();
  });

  it('a failing discontinuity write is non-fatal: the plan is still verified and the response is 200', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue(PLAN as any);
    vi.mocked(loadSplitPlanContext).mockResolvedValue(verifiedCtx() as any);
    vi.mocked(markSplitPlanVerified).mockResolvedValue({ status: 'verified' } as any);
    vi.mocked(writeClientDiscontinuities).mockRejectedValueOnce(new Error('column "kind" does not exist'));
    const res = await buildApp().post('/api/gtm/split-plan/p1/verify').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ verified: true, status: 'verified' });
  });
});

describe('GET /api/gtm/split-plan/:id/download', () => {
  it('returns the delta as an attachment', async () => {
    vi.mocked(getSplitPlan).mockResolvedValue({ id: 'abcdef12-0000', delta: DELTA } as any);
    const res = await buildApp().get('/api/gtm/split-plan/abcdef12-0000/download');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(JSON.parse(res.text)).toEqual(DELTA);
  });
});
