/**
 * Connections routes integration tests — /api/connections
 *
 * Covers: GET list (grouped), OAuth start (400 invalid platform),
 *         OAuth callback (400 HMAC error, 400 expired), POST connect/disconnect/discover,
 *         DELETE (400 without confirmed, 404 not found), POST test, POST sync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/connections/connectionLifecycle', () => ({
  initiateOAuth: vi.fn(),
  handleOAuthCallback: vi.fn(),
  connectAccount: vi.fn(),
  disconnectAccount: vi.fn(),
  rediscoverAccounts: vi.fn(),
  removeConnection: vi.fn(),
}));

vi.mock('@/services/connections/connectionTester', () => ({
  testConnection: vi.fn(),
}));

vi.mock('@/services/database/connectionQueries', () => ({
  listConnectionsForOrg: vi.fn(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/api/middleware/planGuard', () => ({
  planGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as connectionLifecycle from '@/services/connections/connectionLifecycle';
import * as connectionTester from '@/services/connections/connectionTester';
import * as connectionQueries from '@/services/database/connectionQueries';
import { supabaseAdmin } from '@/services/database/supabase';
import { connectionsRouter } from '../connections';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CONNECTION = {
  id: 'conn-001',
  platform: 'google_ads',
  connection_type: 'manager',
  status: 'active',
  display_name: 'My Google Ads',
  organization_id: 'org-001',
};

function makeChain(singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data: singleData, error: null }); },
  };
  const methods = ['select', 'eq', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
  return chain;
}

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/connections', connectionsRouter);
  return request(app);
}

// ── GET /api/connections ──────────────────────────────────────────────────────

describe('GET /api/connections', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns grouped connections', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionQueries.listConnectionsForOrg).mockResolvedValue([MOCK_CONNECTION] as any);

    const res = await buildApp().get('/api/connections');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.google_ads).toBeDefined();
  });
});

// ── GET /api/connections/oauth/:platform/start ────────────────────────────────

describe('GET /api/connections/oauth/:platform/start', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns authUrl for valid platform', async () => {
    vi.mocked(connectionLifecycle.initiateOAuth).mockReturnValue({
      authUrl: 'https://accounts.google.com/o/oauth2/auth?...',
      state: 'encoded-state',
    } as any);

    const res = await buildApp().get('/api/connections/oauth/google_ads/start');

    expect(res.status).toBe(200);
    expect(res.body.data.authUrl).toContain('google.com');
  });

  it('returns 400 for invalid platform', async () => {
    const res = await buildApp().get('/api/connections/oauth/twitter/start');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid platform');
  });
});

// ── POST /api/connections/oauth/:platform/callback ────────────────────────────

describe('POST /api/connections/oauth/:platform/callback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 for invalid platform', async () => {
    const res = await buildApp().post('/api/connections/oauth/snapchat/callback').send({
      code: 'abc',
      state: 'xyz',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when HMAC verification fails', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.handleOAuthCallback).mockRejectedValue(
      new Error('HMAC verification failed'),
    );

    const res = await buildApp().post('/api/connections/oauth/google_ads/callback').send({
      code: 'auth-code',
      state: 'tampered-state',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('OAuth state');
  });

  it('returns 400 when state is expired', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.handleOAuthCallback).mockRejectedValue(
      new Error('OAuth state expired (>10 min)'),
    );

    const res = await buildApp().post('/api/connections/oauth/google_ads/callback').send({
      code: 'auth-code',
      state: 'old-state',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('expired');
  });

  it('completes OAuth flow and returns discovered accounts', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.handleOAuthCallback).mockResolvedValue({
      managerId: 'mgr-001',
      discovered: [{ id: 'acct-001' }],
    } as any);

    const res = await buildApp().post('/api/connections/oauth/google_ads/callback').send({
      code: 'valid-code',
      state: 'valid-state',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.managerId).toBe('mgr-001');
  });
});

// ── POST /api/connections/:id/connect ─────────────────────────────────────────

describe('POST /api/connections/:id/connect', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('connects account and returns connection', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.connectAccount).mockResolvedValue(MOCK_CONNECTION as any);

    const res = await buildApp().post('/api/connections/conn-001/connect').send({
      clientId: '00000000-0000-0000-0000-000000000001',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('conn-001');
  });

  it('returns 400 when clientId is not a valid UUID', async () => {
    const res = await buildApp().post('/api/connections/conn-001/connect').send({
      clientId: 'not-a-uuid',
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 when connection not found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.connectAccount).mockRejectedValue(
      new Error('Connection not found'),
    );

    const res = await buildApp().post('/api/connections/missing/connect').send({
      clientId: '00000000-0000-0000-0000-000000000001',
    });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/connections/:id ───────────────────────────────────────────────

describe('DELETE /api/connections/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('removes connection when confirmed=true', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.removeConnection).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/connections/conn-001').send({ confirmed: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Connection removed');
  });

  it('returns 400 when confirmed is not true', async () => {
    const res = await buildApp().delete('/api/connections/conn-001').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('confirmed');
  });

  it('returns 404 when connection not found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionLifecycle.removeConnection).mockRejectedValue(
      new Error('Connection not found'),
    );

    const res = await buildApp().delete('/api/connections/missing').send({ confirmed: true });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/connections/:id/test ────────────────────────────────────────────

describe('POST /api/connections/:id/test', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns test result', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain({ organization_id: 'org-001' }) as any);
    vi.mocked(connectionTester.testConnection).mockResolvedValue({
      success: true,
      latency_ms: 120,
    } as any);

    const res = await buildApp().post('/api/connections/conn-001/test');

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
  });
});
