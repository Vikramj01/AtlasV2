/**
 * GTM routes integration tests — /api/gtm
 *
 * Covers: POST /connect (returns auth_url, validates required fields),
 *         POST /upload (201, invalid container JSON 400),
 *         GET /containers (returns list),
 *         DELETE /containers/:id (200).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@/services/gtm/gtmCredentials', () => ({
  encryptGtmCredentials: vi.fn().mockReturnValue('encrypted-blob'),
  decryptGtmCredentials: vi.fn(),
}));

vi.mock('@/services/gtm/containerParser', () => ({
  parseContainerJson: vi.fn().mockReturnValue({
    container_id: 'GTM-XXXXX',
    tags: [{ id: 1, name: 'GA4' }],
    triggers: [{ id: 1, name: 'All Pages' }],
  }),
  validateContainerJsonShape: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  gtmContainerSyncQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
}));

vi.mock('@/services/gtm/gtmDeployService', () => ({
  deployContainerToGtm: vi.fn(),
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

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/config/env', () => ({
  env: {
    SUPER_ADMIN_EMAILS: [],
    ADMIN_EMAILS: [],
    FRONTEND_URL: 'https://app.example.com',
    GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
    OAUTH_STATE_SECRET: 'test-oauth-state-secret-32-chars!!',
  },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import * as containerParser from '@/services/gtm/containerParser';
import * as gtmCredentials from '@/services/gtm/gtmCredentials';
import { deployContainerToGtm } from '@/services/gtm/gtmDeployService';
import { gtmContainerSyncQueue } from '@/services/queue/jobQueue';
import { gtmRouter } from '../gtm';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: unknown = [], singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const methods = ['select', 'eq', 'order', 'update', 'insert', 'upsert', 'delete'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: singleData, error: null });
  return chain;
}

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/gtm', gtmRouter);
  return request(app);
}

// ── POST /api/gtm/connect ─────────────────────────────────────────────────────

describe('POST /api/gtm/connect', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns auth_url and state for valid request', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      makeChain([], { organization_id: 'org-001' }) as any,
    );

    const res = await buildApp().post('/api/gtm/connect').send({
      property_id: '00000000-0000-0000-0000-000000000001',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.auth_url).toContain('accounts.google.com');
    expect(res.body.data.state).toBeDefined();
  });

  it('returns 400 when property_id is missing', async () => {
    const res = await buildApp().post('/api/gtm/connect').send({});

    expect(res.status).toBe(400);
  });
});

// ── POST /api/gtm/upload ──────────────────────────────────────────────────────

describe('POST /api/gtm/upload', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('uploads container JSON and returns 201 with metadata', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      makeChain([], { id: 'conn-001' }) as any,
    );

    const res = await buildApp().post('/api/gtm/upload').send({
      property_id: '00000000-0000-0000-0000-000000000001',
      container_json: {
        exportFormatVersion: 2,
        containerVersion: { container: { containerId: 'GTM-XXXXX' } },
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.container_id).toBe('GTM-XXXXX');
    expect(gtmContainerSyncQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 400 when container JSON fails shape validation', async () => {
    vi.mocked(containerParser.validateContainerJsonShape).mockReturnValue({
      valid: false,
      error: 'Missing exportFormatVersion',
    });

    const res = await buildApp().post('/api/gtm/upload').send({
      property_id: '00000000-0000-0000-0000-000000000001',
      container_json: { invalid: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid GTM container JSON');
  });

  it('returns 400 when required fields missing', async () => {
    const res = await buildApp().post('/api/gtm/upload').send({
      container_json: {},
    });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/gtm/deploy ──────────────────────────────────────────────────────

const MINIMAL_CONTAINER = {
  exportFormatVersion: 2,
  containerVersion: { tag: [], trigger: [], variable: [], folder: [], builtInVariable: [] },
};

describe('POST /api/gtm/deploy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(containerParser.validateContainerJsonShape).mockReturnValue({ valid: true });
  });

  it('returns 404 when the connection is not found', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().post('/api/gtm/deploy').send({
      connection_id: '00000000-0000-0000-0000-000000000002',
      container_json: MINIMAL_CONTAINER,
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when the connection was manually uploaded (no write credentials)', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([], {
        id: 'conn-001', account_id: '111', container_id: 'GTM-XXXXX', auth_method: 'manual_upload',
      }) as any;
    });

    const res = await buildApp().post('/api/gtm/deploy').send({
      connection_id: '00000000-0000-0000-0000-000000000002',
      container_json: MINIMAL_CONTAINER,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('manual upload');
    expect(deployContainerToGtm).not.toHaveBeenCalled();
  });

  it('returns 400 when the oauth connection has no account_id on file', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([], {
        id: 'conn-001', account_id: null, container_id: 'GTM-XXXXX', auth_method: 'oauth',
      }) as any;
    });

    const res = await buildApp().post('/api/gtm/deploy').send({
      connection_id: '00000000-0000-0000-0000-000000000002',
      container_json: MINIMAL_CONTAINER,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('account ID');
  });

  it('returns 400 when container JSON fails shape validation', async () => {
    vi.mocked(containerParser.validateContainerJsonShape).mockReturnValue({ valid: false, error: 'bad shape' });

    const res = await buildApp().post('/api/gtm/deploy').send({
      connection_id: '00000000-0000-0000-0000-000000000002',
      container_json: { invalid: true },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid GTM container JSON');
  });

  it('deploys via an oauth connection and returns the deploy summary', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([], {
        id: 'conn-001',
        account_id: '111',
        container_id: 'GTM-XXXXX',
        auth_method: 'oauth',
        oauth_credentials_encrypted: 'encrypted-blob',
      }) as any;
    });
    vi.mocked(gtmCredentials.decryptGtmCredentials).mockReturnValue({
      access_token: 'old-at', refresh_token: 'rt', expires_at: Date.now() - 1000, scope: 'x',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-at', expires_in: 3600 }),
    }));
    vi.mocked(deployContainerToGtm).mockResolvedValue({
      workspace_id: 'ws1',
      workspace_url: 'https://tagmanager.google.com/#/container/accounts/111/containers/GTM-XXXXX/workspaces/ws1',
      folders_created: 1,
      variables_created: 2,
      triggers_created: 1,
      tags_created: 3,
      built_in_variables_enabled: 2,
    });

    const res = await buildApp().post('/api/gtm/deploy').send({
      connection_id: '00000000-0000-0000-0000-000000000002',
      container_json: MINIMAL_CONTAINER,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.workspace_id).toBe('ws1');
    expect(deployContainerToGtm).toHaveBeenCalledWith('new-at', '111', 'GTM-XXXXX', expect.any(Object));
  });
});

// ── GET /api/gtm/containers ───────────────────────────────────────────────────

describe('GET /api/gtm/containers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of connected containers', async () => {
    const containers = [{ id: 'conn-001', container_id: 'GTM-XXXXX', auth_method: 'oauth' }];
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain(containers) as any;
    });

    const res = await buildApp().get('/api/gtm/containers');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── DELETE /api/gtm/containers/:id ───────────────────────────────────────────

describe('DELETE /api/gtm/containers/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('disconnects container and returns success message', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain() as any;
    });

    const res = await buildApp().delete('/api/gtm/containers/conn-001');

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('disconnected');
  });
});
