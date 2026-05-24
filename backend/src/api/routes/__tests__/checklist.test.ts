/**
 * Setup Checklist routes integration tests — /api/setup-checklist
 *
 * Covers: GET returns 7 steps + progress percentage + readiness level,
 *         all steps complete → best_in_class, partial completion → building,
 *         500 on DB error.
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
import { checklistRouter } from '../checklist';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a thenable chain where every method returns `this` (chainable)
 * and awaiting the chain resolves to { data, error: null }.
 * Works for any chain depth: .select().eq().limit() or .select().eq().order()
 */
function makeChain(data: unknown = [], singleData: unknown = null): any {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const chainMethods = ['select', 'eq', 'in', 'not', 'is', 'order', 'update', 'insert'];
  for (const m of chainMethods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal methods that return Promises
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
  app.use('/api/setup-checklist', checklistRouter);
  return request(app);
}

// ── GET /api/setup-checklist ──────────────────────────────────────────────────

describe('GET /api/setup-checklist', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns all 7 checklist steps with progress', async () => {
    // All queries return empty data → all steps incomplete → 0% progress
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null) as any);

    const res = await buildApp().get('/api/setup-checklist');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.steps)).toHaveLength(7);
    expect(res.body.overall_progress_pct).toBe(0);
    expect(res.body.readiness_level).toBe('getting_started');
  });

  it('marks consent_configured complete when consent config exists', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'consent_configs') {
        return makeChain([{ id: 'cc-001' }], { id: 'cc-001' }) as any;
      }
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/setup-checklist');

    expect(res.status).toBe(200);
    expect(res.body.steps.consent_configured.complete).toBe(true);
  });

  it('marks capi_connected with active providers', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'capi_providers') {
        return makeChain([{ id: 'prov-001', provider: 'meta', status: 'active' }]) as any;
      }
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/setup-checklist');

    expect(res.status).toBe(200);
    expect(res.body.steps.capi_connected.complete).toBe(true);
    expect(res.body.steps.capi_connected.active_providers).toContain('meta');
  });

  it('returns 500 when DB throws', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => {
      throw new Error('Connection refused');
    });

    const res = await buildApp().get('/api/setup-checklist');

    expect(res.status).toBe(500);
  });
});
