/**
 * Data Manager routes integration tests — /api/data-manager
 *
 * Covers: GET /:orgId/clients (returns summaries, empty array),
 *         GET /:orgId/export/csv (Content-Type text/csv, Content-Disposition, empty CSV).
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

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/api/middleware/planGuard', () => ({
  planGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { dataManagerRouter } from '../dataManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: unknown = [], singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const methods = ['select', 'eq', 'order'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: singleData, error: null });
  return chain;
}

const MOCK_CLIENT = {
  id: 'client-001',
  name: 'Acme Corp',
  website_url: 'https://acme.com',
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'agency', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/data-manager', dataManagerRouter);
  return request(app);
}

// ── GET /api/data-manager/:orgId/clients ──────────────────────────────────────

describe('GET /api/data-manager/:orgId/clients', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns clients array with summaries', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'clients') return makeChain([MOCK_CLIENT]) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/data-manager/org-001/clients');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clients)).toBe(true);
    expect(res.body.clients).toHaveLength(1);
    expect(res.body.clients[0].client_name).toBe('Acme Corp');
  });

  it('returns empty array when org has no clients', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([]) as any);

    const res = await buildApp().get('/api/data-manager/org-001/clients');

    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(0);
  });

  it('returns 500 when DB query fails', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    } as any);

    const res = await buildApp().get('/api/data-manager/org-001/clients');

    expect(res.status).toBe(500);
  });
});

// ── GET /api/data-manager/:orgId/export/csv ──────────────────────────────────

describe('GET /api/data-manager/:orgId/export/csv', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns CSV with correct Content-Type header', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'clients') return makeChain([MOCK_CLIENT]) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/data-manager/org-001/export/csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('returns CSV with Content-Disposition attachment', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'clients') return makeChain([MOCK_CLIENT]) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/data-manager/org-001/export/csv');

    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');
  });

  it('returns header-only CSV when no clients exist', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([]) as any);

    const res = await buildApp().get('/api/data-manager/org-001/export/csv');

    expect(res.status).toBe(200);
    expect(res.text).toContain('client_name');
  });
});
