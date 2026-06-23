/**
 * Insights route integration tests — /api/insights
 *
 * Covers:
 *   GET  /            — feed, empty, DB error
 *   PATCH /:id        — happy path, bad status, DB error, org isolation
 *   POST /trigger     — queues job, already_queued, dedup by state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/api/middleware/planGuard', () => ({
  planGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/services/queue/jobQueue', () => ({
  airIngestionQueue: {
    add:    vi.fn(),
    getJob: vi.fn(),
  },
}));

vi.mock('@/services/air/ingestion/airIngestionUtils', () => ({
  yesterday: () => '2026-07-10',
}));

import { supabaseAdmin } from '@/services/database/supabase';
import { airIngestionQueue } from '@/services/queue/jobQueue';
import { insightsRouter } from '../insights';

// ── Chain builder ─────────────────────────────────────────────────────────────

function makeChain(data: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const terminal = { data, error };
  const resolved = Promise.resolve(terminal);
  for (const m of ['select', 'eq', 'order', 'limit', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: Function) => resolved.then(resolve);
  return chain as any;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROFILE_ROW  = { organization_id: 'org-1' };

const INSIGHT_ROW = {
  id:            'ins-1',
  narrative:     'Spend dropped 60% yesterday versus the 14-day average.',
  status:        'unread',
  model_version: 'claude-sonnet-4-6',
  anomaly_id:    'anom-1',
  created_at:    '2026-07-10T09:00:00Z',
  air_anomalies: {
    source: 'google_ads', metric_name: 'spend', dimension: null,
    detected_date: '2026-07-10', deviation_pct: -60, severity: 'high',
    observed_value: 400, baseline_value: 1000,
  },
};

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/insights', insightsRouter);
  return request(app);
}

// ── GET /api/insights ─────────────────────────────────────────────────────────

describe('GET /api/insights', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns insight feed for the authenticated org', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))   // profiles
      .mockReturnValueOnce(makeChain([INSIGHT_ROW], null)); // air_insights

    const res = await buildApp().get('/api/insights');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].narrative).toBe('Spend dropped 60% yesterday versus the 14-day average.');
    expect(res.body.data[0].air_anomalies.severity).toBe('high');
  });

  it('returns empty array when no insights exist', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain([], null));

    const res = await buildApp().get('/api/insights');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('uses org_id from profile to scope query', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain([], null));

    await buildApp().get('/api/insights');

    const insightsChain = vi.mocked(supabaseAdmin.from).mock.results[1].value;
    expect(insightsChain.eq).toHaveBeenCalledWith('org_id', 'org-1');
  });

  it('returns 500 when DB fetch fails', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain(null, { message: 'DB down' }));

    const res = await buildApp().get('/api/insights');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch insights');
  });
});

// ── PATCH /api/insights/:id ───────────────────────────────────────────────────

describe('PATCH /api/insights/:id', () => {
  beforeEach(() => vi.resetAllMocks());

  it('marks insight as read', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain(null, null));

    const res = await buildApp()
      .patch('/api/insights/ins-1')
      .send({ status: 'read' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('read');
  });

  it('marks insight as dismissed', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain(null, null));

    const res = await buildApp()
      .patch('/api/insights/ins-1')
      .send({ status: 'dismissed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('dismissed');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await buildApp()
      .patch('/api/insights/ins-1')
      .send({ status: 'archived' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('status must be');
  });

  it('scopes update to the authenticated org (eq org_id)', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain(null, null));

    await buildApp().patch('/api/insights/ins-1').send({ status: 'read' });

    const updateChain = vi.mocked(supabaseAdmin.from).mock.results[1].value;
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'ins-1');
    expect(updateChain.eq).toHaveBeenCalledWith('org_id', 'org-1');
  });

  it('returns 500 when DB update fails', async () => {
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(makeChain(PROFILE_ROW, null))
      .mockReturnValueOnce(makeChain(null, { message: 'update failed' }));

    const res = await buildApp()
      .patch('/api/insights/ins-1')
      .send({ status: 'dismissed' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to update insight');
  });
});

// ── POST /api/insights/trigger ────────────────────────────────────────────────

describe('POST /api/insights/trigger', () => {
  beforeEach(() => vi.resetAllMocks());

  it('enqueues an AIR job and returns 202 queued', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(PROFILE_ROW, null));
    vi.mocked(airIngestionQueue.getJob as any).mockResolvedValue(null);
    vi.mocked(airIngestionQueue.add as any).mockResolvedValue({ id: 'job-1' });

    const res = await buildApp().post('/api/insights/trigger');

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.date).toBe('2026-07-10');
    expect(airIngestionQueue.add).toHaveBeenCalledOnce();

    const [payload, opts] = (airIngestionQueue.add as any).mock.calls[0];
    expect(payload.trigger).toBe('manual');
    expect(payload.org_id).toBe('org-1');
    expect(opts.jobId).toBe('air-ingest:org-1:manual');
  });

  it('returns 202 already_queued when an active job exists for that org', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(PROFILE_ROW, null));
    const mockJob = { getState: vi.fn().mockResolvedValue('active') };
    vi.mocked(airIngestionQueue.getJob as any).mockResolvedValue(mockJob);

    const res = await buildApp().post('/api/insights/trigger');

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('already_queued');
    expect(airIngestionQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues a new job when the previous job completed', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(PROFILE_ROW, null));
    const mockJob = { getState: vi.fn().mockResolvedValue('completed') };
    vi.mocked(airIngestionQueue.getJob as any).mockResolvedValue(mockJob);
    vi.mocked(airIngestionQueue.add as any).mockResolvedValue({ id: 'job-2' });

    const res = await buildApp().post('/api/insights/trigger');

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
    expect(airIngestionQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 202 already_queued when job is waiting (not just active)', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(PROFILE_ROW, null));
    const mockJob = { getState: vi.fn().mockResolvedValue('waiting') };
    vi.mocked(airIngestionQueue.getJob as any).mockResolvedValue(mockJob);

    const res = await buildApp().post('/api/insights/trigger');

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('already_queued');
  });

  it('returns 500 when queue add throws', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeChain(PROFILE_ROW, null));
    vi.mocked(airIngestionQueue.getJob as any).mockResolvedValue(null);
    vi.mocked(airIngestionQueue.add as any).mockRejectedValue(new Error('Redis down'));

    const res = await buildApp().post('/api/insights/trigger');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
