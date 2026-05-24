/**
 * DQM routes integration tests — /api/dqm
 *
 * Covers: GET /status returns gtg + dma state,
 *         POST /trigger enqueues job and returns queued=true.
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
  dqmQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { dqmQueue } from '@/services/queue/jobQueue';
import { dqmRouter } from '../dqm';

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

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/dqm', dqmRouter);
  return request(app);
}

// ── GET /api/dqm/status ───────────────────────────────────────────────────────

describe('GET /api/dqm/status', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns gtg checks and dma state', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'dqm_gtg_checks') {
        return makeChain([{ check_status: 'pass', checked_at: '2026-01-01T00:00:00Z' }]) as any;
      }
      if (table === 'dqm_dma_poll_state') {
        return makeChain([], { avg_match_rate: 55, total_members_30d: 1000 }) as any;
      }
      return makeChain() as any;
    });

    const res = await buildApp().get('/api/dqm/status');

    expect(res.status).toBe(200);
    expect(res.body.gtg).toBeDefined();
    expect(res.body.dma).toBeDefined();
  });

  it('returns latest_status unknown when no gtg checks', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([], null) as any);

    const res = await buildApp().get('/api/dqm/status');

    expect(res.status).toBe(200);
    expect(res.body.gtg.latest_status).toBe('unknown');
    expect(res.body.dma).toBeNull();
  });
});

// ── POST /api/dqm/trigger ─────────────────────────────────────────────────────

describe('POST /api/dqm/trigger', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enqueues DQM job and returns queued=true', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      makeChain([], { organization_id: 'org-001' }) as any,
    );

    const res = await buildApp().post('/api/dqm/trigger');

    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(dqmQueue.add).toHaveBeenCalledOnce();
  });
});
