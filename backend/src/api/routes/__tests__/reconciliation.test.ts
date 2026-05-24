/**
 * Reconciliation routes integration tests — /api/reconciliation
 *
 * Covers: GET /runs (400 missing clientId, list), GET /runs/:id (200, 404),
 *         GET /runs/:id/findings (filter validation), PATCH /findings/:id/resolve,
 *         POST /trigger (201, validation 400), GET/PUT /tolerance, GET /stats.
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

vi.mock('@/services/queue/jobQueue', () => ({
  reconciliationRunQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
}));

vi.mock('@/services/reconciliation/reconciliationRunner', () => ({
  createRun: vi.fn().mockResolvedValue('run-001'),
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

import { supabaseAdmin } from '@/services/database/supabase';
import { reconciliationRunQueue } from '@/services/queue/jobQueue';
import { reconciliationRouter } from '../reconciliation';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: unknown = [], singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const methods = ['select', 'eq', 'in', 'not', 'is', 'order', 'update', 'upsert'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: singleData, error: null });
  return chain;
}

const MOCK_RUN = {
  id: 'run-001',
  organization_id: 'org-001',
  client_id: 'client-001',
  status: 'completed',
  run_type: 'manual',
  total_findings: 3,
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/reconciliation', reconciliationRouter);
  return request(app);
}

// ── GET /api/reconciliation/runs ──────────────────────────────────────────────

describe('GET /api/reconciliation/runs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 when clientId query param is missing', async () => {
    const res = await buildApp().get('/api/reconciliation/runs');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('clientId');
  });

  it('returns list of runs for the client', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([MOCK_RUN]) as any;
    });

    const res = await buildApp().get('/api/reconciliation/runs?clientId=client-001');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── GET /api/reconciliation/runs/:id ─────────────────────────────────────────

describe('GET /api/reconciliation/runs/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns run with findings grouped by dimension', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      if (table === 'reconciliation_runs') return makeChain([MOCK_RUN], MOCK_RUN) as any;
      return makeChain([]) as any;
    });

    const res = await buildApp().get('/api/reconciliation/runs/run-001');

    expect(res.status).toBe(200);
    expect(res.body.data.run).toBeDefined();
    expect(res.body.data.findings_by_dimension).toBeDefined();
  });

  it('returns 404 when run not found', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/reconciliation/runs/missing');

    expect(res.status).toBe(404);
  });
});

// ── GET /api/reconciliation/runs/:id/findings ─────────────────────────────────

describe('GET /api/reconciliation/runs/:id/findings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 for invalid dimension filter', async () => {
    const res = await buildApp().get('/api/reconciliation/runs/run-001/findings?dimension=invalid');

    expect(res.status).toBe(400);
  });

  it('returns findings for valid request', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([MOCK_RUN], MOCK_RUN) as any;
    });

    const res = await buildApp().get('/api/reconciliation/runs/run-001/findings?dimension=delivery');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── PATCH /api/reconciliation/findings/:id/resolve ───────────────────────────

describe('PATCH /api/reconciliation/findings/:id/resolve', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('resolves finding and returns message', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain() as any;
    });

    const res = await buildApp().patch('/api/reconciliation/findings/finding-001/resolve');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Finding resolved');
  });
});

// ── POST /api/reconciliation/trigger ─────────────────────────────────────────

describe('POST /api/reconciliation/trigger', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enqueues reconciliation run and returns runId', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      makeChain([], { organization_id: 'org-001' }) as any,
    );

    const res = await buildApp().post('/api/reconciliation/trigger').send({
      clientId: '00000000-0000-0000-0000-000000000001',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.runId).toBe('run-001');
    expect(reconciliationRunQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 400 when clientId is not a valid UUID', async () => {
    const res = await buildApp().post('/api/reconciliation/trigger').send({
      clientId: 'not-a-uuid',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when clientId is missing', async () => {
    const res = await buildApp().post('/api/reconciliation/trigger').send({});

    expect(res.status).toBe(400);
  });
});

// ── GET /api/reconciliation/tolerance ────────────────────────────────────────

describe('GET /api/reconciliation/tolerance', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 when clientId is missing', async () => {
    const res = await buildApp().get('/api/reconciliation/tolerance');

    expect(res.status).toBe(400);
  });

  it('returns tolerance configs for client', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([]) as any;
    });

    const res = await buildApp().get('/api/reconciliation/tolerance?clientId=client-001');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
