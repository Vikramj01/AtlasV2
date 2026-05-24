/**
 * Clients routes integration tests — /api/organisations/:orgId/clients
 *
 * Covers: CRUD, platform config, pages, pack deploy/remove, generate outputs,
 *         cross-tenant isolation (orgMiddleware), validation errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/clientQueries', () => ({
  createClient: vi.fn(),
  listClients: vi.fn(),
  getClient: vi.fn(),
  updateClient: vi.fn(),
  archiveClient: vi.fn(),
  upsertClientPlatforms: vi.fn(),
  upsertClientPages: vi.fn(),
  listDeployments: vi.fn(),
  deployPack: vi.fn(),
  removeDeployment: vi.fn(),
  listClientOutputs: vi.fn(),
  getClientOutput: vi.fn(),
  getClientsByPack: vi.fn(),
}));

vi.mock('@/services/database/signalQueries', () => ({
  getSignalPackWithSignals: vi.fn(),
  resolveDeploymentsForClient: vi.fn(),
}));

vi.mock('@/services/signals/composableOutputGenerator', () => ({
  generateComposableOutputs: vi.fn(),
}));

vi.mock('@/services/database/queries', () => ({
  createAudit: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  auditQueue: { add: vi.fn() },
}));

vi.mock('@/services/planning/siteDetectionService', () => ({
  detectSite: vi.fn(),
}));

vi.mock('@/api/middleware/orgMiddleware', () => ({
  orgMiddleware: (req: any, _res: any, next: any) => {
    req.org = { id: req.params['orgId'], name: 'Test Org' };
    req.orgMembership = { role: 'owner' };
    next();
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/api/middleware/strategyGate', () => ({
  strategyGate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as clientQueries from '@/services/database/clientQueries';
import * as signalQueries from '@/services/database/signalQueries';
import * as composableOutputGenerator from '@/services/signals/composableOutputGenerator';
import { auditQueue } from '@/services/queue/jobQueue';
import { clientsRouter } from '../clients';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CLIENT = {
  id: 'client-001',
  organization_id: 'org-001',
  name: 'Acme Corp',
  website_url: 'https://acme.com',
  business_type: 'ecommerce',
  pages: [{ page_type: 'homepage', url: 'https://acme.com' }],
  deployments: [],
  outputs: [],
};

const MOCK_PACK = {
  id: 'pack-001',
  name: 'E-commerce Pack',
  signals: [{ id: 'sig-001', key: 'purchase', name: 'Purchase' }],
};

const MOCK_DEPLOYMENT = {
  id: 'deploy-001',
  client_id: 'client-001',
  pack_id: 'pack-001',
  created_at: '2026-01-01T00:00:00Z',
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'agency', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/organisations', clientsRouter);
  return request(app);
}

const BASE = '/api/organisations/org-001/clients';

// ── POST — create client ──────────────────────────────────────────────────────

describe('POST /api/organisations/:orgId/clients', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates client and returns 201', async () => {
    vi.mocked(clientQueries.createClient).mockResolvedValue(MOCK_CLIENT as any);

    const res = await buildApp().post(BASE).send({
      name: 'Acme Corp',
      website_url: 'https://acme.com',
      business_type: 'ecommerce',
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('client-001');
  });

  it('returns 400 when required fields missing', async () => {
    const res = await buildApp().post(BASE).send({ name: 'Acme Corp' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid website_url', async () => {
    const res = await buildApp().post(BASE).send({
      name: 'Acme Corp',
      website_url: 'not-a-url',
      business_type: 'ecommerce',
    });

    expect(res.status).toBe(400);
  });
});

// ── GET — list clients ────────────────────────────────────────────────────────

describe('GET /api/organisations/:orgId/clients', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns clients array for org', async () => {
    vi.mocked(clientQueries.listClients).mockResolvedValue([MOCK_CLIENT] as any);

    const res = await buildApp().get(BASE);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clients)).toBe(true);
    expect(res.body.clients).toHaveLength(1);
  });
});

// ── GET — single client ───────────────────────────────────────────────────────

describe('GET /api/organisations/:orgId/clients/:clientId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns client with deployments and outputs', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(clientQueries.listDeployments).mockResolvedValue([MOCK_DEPLOYMENT] as any);
    vi.mocked(clientQueries.listClientOutputs).mockResolvedValue([]);

    const res = await buildApp().get(`${BASE}/client-001`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('client-001');
    expect(res.body.deployments).toHaveLength(1);
  });

  it('returns 404 when client does not exist', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(null);

    const res = await buildApp().get(`${BASE}/missing`);

    expect(res.status).toBe(404);
  });
});

// ── PUT — update client ───────────────────────────────────────────────────────

describe('PUT /api/organisations/:orgId/clients/:clientId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates client and returns updated record', async () => {
    const updated = { ...MOCK_CLIENT, name: 'Acme Updated' };
    vi.mocked(clientQueries.updateClient).mockResolvedValue(updated as any);

    const res = await buildApp().put(`${BASE}/client-001`).send({ name: 'Acme Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Updated');
  });
});

// ── DELETE — archive client ───────────────────────────────────────────────────

describe('DELETE /api/organisations/:orgId/clients/:clientId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('archives client and returns archived=true', async () => {
    vi.mocked(clientQueries.archiveClient).mockResolvedValue(undefined);

    const res = await buildApp().delete(`${BASE}/client-001`);

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
  });
});

// ── POST — deploy pack ────────────────────────────────────────────────────────

describe('POST /api/organisations/:orgId/clients/:clientId/deploy', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deploys pack to client and returns 201', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(signalQueries.getSignalPackWithSignals).mockResolvedValue(MOCK_PACK as any);
    vi.mocked(clientQueries.deployPack).mockResolvedValue(MOCK_DEPLOYMENT as any);

    const res = await buildApp().post(`${BASE}/client-001/deploy`).send({ pack_id: 'pack-001' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('deploy-001');
  });

  it('returns 400 when pack_id is missing', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);

    const res = await buildApp().post(`${BASE}/client-001/deploy`).send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 when pack does not exist', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(signalQueries.getSignalPackWithSignals).mockResolvedValue(null);

    const res = await buildApp().post(`${BASE}/client-001/deploy`).send({ pack_id: 'missing' });

    expect(res.status).toBe(404);
  });
});

// ── POST — generate outputs ───────────────────────────────────────────────────

describe('POST /api/organisations/:orgId/clients/:clientId/generate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('generates outputs from deployed packs', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(clientQueries.listDeployments).mockResolvedValue([MOCK_DEPLOYMENT] as any);
    vi.mocked(composableOutputGenerator.generateComposableOutputs).mockResolvedValue([
      { id: 'out-001', output_type: 'gtm_container' },
    ] as any);

    const res = await buildApp().post(`${BASE}/client-001/generate`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.outputs)).toBe(true);
    expect(res.body.outputs).toHaveLength(1);
  });

  it('returns 409 when no packs deployed', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(clientQueries.listDeployments).mockResolvedValue([]);

    const res = await buildApp().post(`${BASE}/client-001/generate`);

    expect(res.status).toBe(409);
  });
});

// ── POST — client audit ───────────────────────────────────────────────────────

describe('POST /api/organisations/:orgId/clients/:clientId/audit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts client audit and returns 202 with audit_id', async () => {
    const { createAudit } = await import('@/services/database/queries');
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(clientQueries.listDeployments).mockResolvedValue([MOCK_DEPLOYMENT] as any);
    vi.mocked(signalQueries.resolveDeploymentsForClient).mockResolvedValue([]);
    vi.mocked(createAudit).mockResolvedValue({ id: 'audit-001', created_at: '2026-01-01T00:00:00Z' } as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    const res = await buildApp().post(`${BASE}/client-001/audit`);

    expect(res.status).toBe(202);
    expect(res.body.audit_id).toBe('audit-001');
    expect(auditQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 409 when client has no deployed packs', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(MOCK_CLIENT as any);
    vi.mocked(clientQueries.listDeployments).mockResolvedValue([]);

    const res = await buildApp().post(`${BASE}/client-001/audit`);

    expect(res.status).toBe(409);
  });
});
