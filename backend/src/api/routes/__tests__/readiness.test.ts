/**
 * Readiness Score routes integration tests — /api/readiness-score
 *
 * Covers: GET returns score + level + 6 items + 5 dma_checks,
 *         score=0 when all criteria unmet (getting_started),
 *         score increases with active CAPI + consent,
 *         GTG recommendation present when no sGTM container.
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

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { readinessRouter } from '../readiness';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChain(data: unknown = [], singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const methods = ['select', 'eq', 'in', 'order'];
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
  app.use('/api/readiness-score', readinessRouter);
  return request(app);
}

// ── GET /api/readiness-score ──────────────────────────────────────────────────

describe('GET /api/readiness-score', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns score + level + 6 items + 5 dma_checks when all empty', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null) as any);

    const res = await buildApp().get('/api/readiness-score');

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0);
    expect(res.body.level).toBe('getting_started');
    expect(res.body.items).toHaveLength(6);
    expect(res.body.dma_checks).toHaveLength(5);
  });

  it('earns consent points when consent config exists', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'consent_configs') return makeChain([{ id: 'cc-001' }]) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/readiness-score');

    expect(res.status).toBe(200);
    const consentItem = res.body.items.find((i: any) => i.key === 'consent_configured');
    expect(consentItem.earned).toBe(true);
    expect(res.body.score).toBeGreaterThanOrEqual(20);
  });

  it('earns CAPI points when active provider exists', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'capi_providers') {
        return makeChain([{
          id: 'prov-001',
          provider: 'meta',
          status: 'active',
          identifier_config: { enabled_identifiers: ['email'] },
        }]) as any;
      }
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/readiness-score');

    expect(res.status).toBe(200);
    const capiItem = res.body.items.find((i: any) => i.key === 'capi_connected');
    expect(capiItem.earned).toBe(true);
  });

  it('includes GTG recommendation when no sGTM container connected', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null) as any);

    const res = await buildApp().get('/api/readiness-score');

    expect(res.status).toBe(200);
    expect(res.body.gtg_recommendation).not.toBeNull();
    expect(res.body.gtg_recommendation.cdn_guides.length).toBeGreaterThan(0);
  });

  it('returns 500 when DB throws', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => {
      throw new Error('Connection refused');
    });

    const res = await buildApp().get('/api/readiness-score');

    expect(res.status).toBe(500);
  });
});
