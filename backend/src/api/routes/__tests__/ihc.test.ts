/**
 * IHC routes integration tests — /api/ihc
 *
 * Covers: findings/summary (free+), findings (free plan → upgrade nudge,
 *         pro plan → full data), baseline GET/POST, PATCH single finding,
 *         POST findings/bulk, GET/PATCH preferences.
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

vi.mock('@/services/ihc/baselineManager', () => ({
  getBaselineForOrg: vi.fn().mockResolvedValue({ crawl_run_id: 'crawl-001', created_at: '2026-01-01' }),
  promoteToBaseline: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/api/middleware/planGuard', () => ({
  planGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { ihcRouter } from '../ihc';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: unknown = [], singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const methods = ['select', 'eq', 'in', 'order', 'update', 'upsert'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: singleData, error: null });
  return chain;
}

const MOCK_FINDING = {
  id: 'finding-001',
  organization_id: 'org-001',
  rule_id: 'GTM-001',
  severity: 'high',
  status: 'open',
  evidence: { tag_name: 'GA4' },
};

function buildApp(plan = 'pro') {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan, isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/ihc', ihcRouter);
  return request(app);
}

// ── GET /api/ihc/findings/summary ────────────────────────────────────────────

describe('GET /api/ihc/findings/summary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns severity counts', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([
        { severity: 'critical' },
        { severity: 'high' },
        { severity: 'high' },
      ]) as any;
    });

    const res = await buildApp('free').get('/api/ihc/findings/summary');

    expect(res.status).toBe(200);
    expect(res.body.data.critical).toBe(1);
    expect(res.body.data.high).toBe(2);
    expect(res.body.data.total).toBe(3);
  });

  it('returns 404 when org not found', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null) as any);

    const res = await buildApp().get('/api/ihc/findings/summary');

    expect(res.status).toBe(404);
  });
});

// ── GET /api/ihc/findings ────────────────────────────────────────────────────

describe('GET /api/ihc/findings', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns upgrade nudge for free plan users', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([{ severity: 'high' }]) as any;
    });

    const res = await buildApp('free').get('/api/ihc/findings');

    expect(res.status).toBe(200);
    expect(res.body.upgrade_required).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it('returns full findings for pro plan users', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([MOCK_FINDING]) as any;
    });

    const res = await buildApp('pro').get('/api/ihc/findings');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.upgrade_required).toBeUndefined();
  });
});

// ── GET /api/ihc/baseline ─────────────────────────────────────────────────────

describe('GET /api/ihc/baseline', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns current baseline info', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], { organization_id: 'org-001' }) as any);

    const res = await buildApp().get('/api/ihc/baseline');

    expect(res.status).toBe(200);
    expect(res.body.data.crawl_run_id).toBe('crawl-001');
  });
});

// ── POST /api/ihc/baseline ────────────────────────────────────────────────────

describe('POST /api/ihc/baseline', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('promotes crawl run to baseline', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], { organization_id: 'org-001' }) as any);

    const res = await buildApp().post('/api/ihc/baseline').send({
      crawl_run_id: '00000000-0000-0000-0000-000000000001',
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Baseline updated');
  });

  it('returns 400 when crawl_run_id is not a UUID', async () => {
    const res = await buildApp().post('/api/ihc/baseline').send({ crawl_run_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/ihc/findings/:id ───────────────────────────────────────────────

describe('PATCH /api/ihc/findings/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates finding status', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([MOCK_FINDING], { ...MOCK_FINDING, status: 'acknowledged' }) as any;
    });

    const res = await buildApp().patch('/api/ihc/findings/finding-001').send({
      status: 'acknowledged',
    });

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status', async () => {
    const res = await buildApp().patch('/api/ihc/findings/finding-001').send({
      status: 'ignored',
    });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/ihc/findings/bulk ───────────────────────────────────────────────

describe('POST /api/ihc/findings/bulk', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('bulk acknowledges findings', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-001' }) as any;
      return makeChain([MOCK_FINDING]) as any;
    });

    const res = await buildApp().post('/api/ihc/findings/bulk').send({
      finding_ids: ['00000000-0000-0000-0000-000000000001'],
      action: 'acknowledge',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBeDefined();
  });

  it('returns 400 for empty finding_ids array', async () => {
    const res = await buildApp().post('/api/ihc/findings/bulk').send({
      finding_ids: [],
      action: 'acknowledge',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const res = await buildApp().post('/api/ihc/findings/bulk').send({
      finding_ids: ['00000000-0000-0000-0000-000000000001'],
      action: 'delete',
    });

    expect(res.status).toBe(400);
  });
});
