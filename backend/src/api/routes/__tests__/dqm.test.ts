/**
 * DQM routes integration tests — /api/dqm
 *
 * Covers: GET /status (data envelope, degraded state, backoff fields),
 *         GET /runs (paginated run log),
 *         POST /trigger (enqueues job).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
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

function makeChain(listData: unknown = [], singleData: unknown = null): any {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.limit       = vi.fn().mockResolvedValue({ data: listData, error: null });
  chain.range       = vi.fn().mockResolvedValue({ data: listData, error: null });
  chain.single      = vi.fn().mockResolvedValue({ data: singleData, error: null });
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

  it('returns { data: { gtg, dma } } envelope', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-1' }) as any;
      if (table === 'dqm_gtg_checks') {
        return makeChain([{ check_status: 'pass', response_ms: 120, checked_at: '2026-01-01T00:00:00Z' }]) as any;
      }
      if (table === 'dqm_dma_poll_state') {
        return makeChain([], {
          avg_match_rate: 55, total_members_30d: 1000, upload_success_rate: 90,
          destination_count: 2, last_polled_at: null, last_successful_at: null,
          error_categories: {}, backoff_until: null, consecutive_failures: 0, updated_at: '2026-01-01T00:00:00Z',
        }) as any;
      }
      return makeChain() as any;
    });

    const res = await buildApp().get('/api/dqm/status');

    expect(res.status).toBe(200);
    expect(res.body.data.gtg).toBeDefined();
    expect(res.body.data.gtg.latest_status).toBe('pass');
    expect(res.body.data.dma).toBeDefined();
    expect(res.body.data.dma.is_in_backoff).toBe(false);
  });

  it('surfaces degraded as latest_status', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-1' }) as any;
      if (table === 'dqm_gtg_checks') {
        return makeChain([{ check_status: 'degraded', response_ms: 2400, checked_at: '2026-01-01T00:00:00Z' }]) as any;
      }
      if (table === 'dqm_dma_poll_state') return makeChain([], null) as any;
      return makeChain() as any;
    });

    const res = await buildApp().get('/api/dqm/status');

    expect(res.status).toBe(200);
    expect(res.body.data.gtg.latest_status).toBe('degraded');
  });

  it('sets is_in_backoff=true when backoff_until is in the future', async () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], { organization_id: 'org-1' }) as any;
      if (table === 'dqm_gtg_checks') return makeChain([]) as any;
      if (table === 'dqm_dma_poll_state') {
        return makeChain([], {
          avg_match_rate: null, total_members_30d: 0, upload_success_rate: 0,
          destination_count: 0, last_polled_at: null, last_successful_at: null,
          error_categories: {}, backoff_until: future, consecutive_failures: 3,
          updated_at: '2026-01-01T00:00:00Z',
        }) as any;
      }
      return makeChain() as any;
    });

    const res = await buildApp().get('/api/dqm/status');

    expect(res.status).toBe(200);
    expect(res.body.data.dma.is_in_backoff).toBe(true);
    expect(res.body.data.dma.consecutive_failures).toBe(3);
    expect(res.body.data.dma.backoff_until).toBe(future);
  });

  it('returns unknown latest_status and null dma when no data', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles') return makeChain([], null) as any;
      return makeChain([], null) as any;
    });

    const res = await buildApp().get('/api/dqm/status');

    expect(res.status).toBe(200);
    expect(res.body.data.gtg.latest_status).toBe('unknown');
    expect(res.body.data.dma).toBeNull();
  });
});

// ── GET /api/dqm/runs ─────────────────────────────────────────────────────────

describe('GET /api/dqm/runs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns paginated run log', async () => {
    const rows = [
      { id: 'r1', check_type: 'gtg', status: 'pass', latency_ms: 120, triggered_by: 'scheduled', alert_action: 'none', created_at: '2026-01-01T00:00:00Z' },
      { id: 'r2', check_type: 'dma', status: 'ok',   latency_ms: null, triggered_by: 'scheduled', alert_action: 'none', created_at: '2026-01-01T00:01:00Z' },
    ];

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'profiles')     return makeChain([], { organization_id: 'org-1' }) as any;
      if (table === 'dqm_run_log')  return makeChain(rows) as any;
      return makeChain() as any;
    });

    const res = await buildApp().get('/api/dqm/runs?limit=10&offset=0');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].check_type).toBe('gtg');
  });

  it('rejects invalid query params', async () => {
    const res = await buildApp().get('/api/dqm/runs?limit=999');
    expect(res.status).toBe(400);
  });
});

// ── POST /api/dqm/trigger ─────────────────────────────────────────────────────

describe('POST /api/dqm/trigger', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enqueues DQM job and returns { data: { queued: true } }', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      makeChain([], { organization_id: 'org-001' }) as any,
    );

    const res = await buildApp().post('/api/dqm/trigger');

    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(dqmQueue.add).toHaveBeenCalledOnce();
    expect(dqmQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'manual', org_id: 'org-001' }),
    );
  });
});
