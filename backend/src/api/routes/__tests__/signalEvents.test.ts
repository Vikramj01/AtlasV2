/**
 * Signal Events routes integration tests — /api/signal-events
 *
 * Covers: list (pagination, default time range), aggregates,
 *         single event detail (404 cross-org), export (202 + 422 over limit),
 *         export poll (404 unknown job), validation errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/signalEventQueries', () => ({
  listSignalEvents: vi.fn(),
  getSignalEventDetail: vi.fn(),
  getSignalAggregates: vi.fn(),
  createExportJob: vi.fn(),
  getExportJob: vi.fn(),
  countSignalEvents: vi.fn(),
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

import * as signalEventQueries from '@/services/database/signalEventQueries';
import { signalEventsRouter } from '../signalEvents';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_EVENT = {
  id: 'evt-001',
  organization_id: 'u1',
  event_name: 'Purchase',
  destination: 'meta',
  status: 'delivered',
  event_time: 1700000000,
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_AGGREGATES = {
  total_events: 1000,
  delivered: 950,
  failed: 50,
  dedup_rate: 0.05,
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/signal-events', signalEventsRouter);
  return request(app);
}

const ISO_FROM = '2026-01-01T00:00:00.000Z';
const ISO_TO = '2026-01-02T00:00:00.000Z';

// ── GET /api/signal-events ────────────────────────────────────────────────────

describe('GET /api/signal-events', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns paginated signal event list', async () => {
    vi.mocked(signalEventQueries.listSignalEvents).mockResolvedValue({
      rows: [MOCK_EVENT],
      next_cursor: null,
    } as any);

    const res = await buildApp().get(`/api/signal-events?from=${ISO_FROM}&to=${ISO_TO}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.count).toBe(1);
  });

  it('returns 400 for invalid from timestamp', async () => {
    const res = await buildApp().get('/api/signal-events?from=not-a-date&to=2026-01-02T00:00:00.000Z');

    expect(res.status).toBe(400);
  });

  it('uses defaults when no query params provided', async () => {
    vi.mocked(signalEventQueries.listSignalEvents).mockResolvedValue({ rows: [], next_cursor: null } as any);

    const res = await buildApp().get('/api/signal-events');

    expect(res.status).toBe(200);
    expect(signalEventQueries.listSignalEvents).toHaveBeenCalledOnce();
  });
});

// ── GET /api/signal-events/aggregates ─────────────────────────────────────────

describe('GET /api/signal-events/aggregates', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns aggregate metrics', async () => {
    vi.mocked(signalEventQueries.getSignalAggregates).mockResolvedValue(MOCK_AGGREGATES as any);

    const res = await buildApp().get('/api/signal-events/aggregates');

    expect(res.status).toBe(200);
    expect(res.body.data.total_events).toBe(1000);
  });
});

// ── GET /api/signal-events/:event_id ─────────────────────────────────────────

describe('GET /api/signal-events/:event_id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns event detail', async () => {
    vi.mocked(signalEventQueries.getSignalEventDetail).mockResolvedValue(MOCK_EVENT as any);

    const res = await buildApp().get('/api/signal-events/evt-001');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('evt-001');
  });

  it('returns 404 for cross-org or missing event', async () => {
    vi.mocked(signalEventQueries.getSignalEventDetail).mockResolvedValue(null);

    const res = await buildApp().get('/api/signal-events/other-org-evt');

    expect(res.status).toBe(404);
  });
});

// ── POST /api/signal-events/export ────────────────────────────────────────────

describe('POST /api/signal-events/export', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates export job and returns 202 with job_id', async () => {
    vi.mocked(signalEventQueries.countSignalEvents).mockResolvedValue(5000);
    vi.mocked(signalEventQueries.createExportJob).mockResolvedValue({ id: 'job-001' } as any);

    const res = await buildApp().post('/api/signal-events/export').send({
      from: ISO_FROM,
      to: ISO_TO,
    });

    expect(res.status).toBe(202);
    expect(res.body.data.job_id).toBe('job-001');
    expect(res.body.data.row_estimate).toBe(5000);
  });

  it('returns 422 when row count exceeds 100k limit', async () => {
    vi.mocked(signalEventQueries.countSignalEvents).mockResolvedValue(150_000);

    const res = await buildApp().post('/api/signal-events/export').send({
      from: ISO_FROM,
      to: ISO_TO,
    });

    expect(res.status).toBe(422);
    expect(res.body.row_estimate).toBe(150_000);
  });

  it('returns 400 when from/to are missing', async () => {
    const res = await buildApp().post('/api/signal-events/export').send({});

    expect(res.status).toBe(400);
  });
});

// ── GET /api/signal-events/export/:job_id ─────────────────────────────────────

describe('GET /api/signal-events/export/:job_id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns export job status', async () => {
    vi.mocked(signalEventQueries.getExportJob).mockResolvedValue({
      id: 'job-001',
      status: 'completed',
      download_url: 'https://storage.example.com/export.csv',
    } as any);

    const res = await buildApp().get('/api/signal-events/export/job-001');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  it('returns 404 when export job not found', async () => {
    vi.mocked(signalEventQueries.getExportJob).mockResolvedValue(null);

    const res = await buildApp().get('/api/signal-events/export/missing');

    expect(res.status).toBe(404);
  });
});
