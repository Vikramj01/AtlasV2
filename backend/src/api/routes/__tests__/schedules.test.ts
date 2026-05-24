/**
 * Schedules routes integration tests — /api/schedules
 *
 * Covers: CRUD, manual run trigger, validation (funnel_type, frequency,
 *         day_of_week, hour_utc, URL), 404 on missing schedule.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/scheduleQueries', () => ({
  createSchedule: vi.fn(),
  getSchedule: vi.fn(),
  listSchedules: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  markScheduleRan: vi.fn(),
}));

vi.mock('@/services/database/queries', () => ({
  createAudit: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  auditQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
}));

vi.mock('@/utils/urlValidator', () => ({
  validateUrl: vi.fn().mockReturnValue({ valid: true }),
  validateUrls: vi.fn().mockReturnValue(null),
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

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as scheduleQueries from '@/services/database/scheduleQueries';
import * as dbQueries from '@/services/database/queries';
import { auditQueue } from '@/services/queue/jobQueue';
import { schedulesRouter } from '../schedules';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SCHEDULE = {
  id: 'sched-001',
  user_id: 'u1',
  name: 'Weekly E-commerce Audit',
  website_url: 'https://example.com',
  funnel_type: 'ecommerce',
  frequency: 'weekly',
  day_of_week: 1,
  hour_utc: 9,
  url_map: { homepage: 'https://example.com' },
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  region: 'us',
};

const VALID_BODY = {
  name: 'Weekly E-commerce Audit',
  website_url: 'https://example.com',
  funnel_type: 'ecommerce',
  frequency: 'weekly',
  day_of_week: 1,
  hour_utc: 9,
  url_map: { homepage: 'https://example.com' },
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/schedules', schedulesRouter);
  return request(app);
}

// ── POST /api/schedules ───────────────────────────────────────────────────────

describe('POST /api/schedules', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates schedule and returns 201', async () => {
    vi.mocked(scheduleQueries.createSchedule).mockResolvedValue(MOCK_SCHEDULE as any);

    const res = await buildApp().post('/api/schedules').send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('sched-001');
    expect(scheduleQueries.createSchedule).toHaveBeenCalledOnce();
  });

  it('returns 400 when required fields missing', async () => {
    const res = await buildApp().post('/api/schedules').send({ name: 'Test' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid funnel_type', async () => {
    const res = await buildApp().post('/api/schedules').send({
      ...VALID_BODY,
      funnel_type: 'social_media',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid frequency', async () => {
    const res = await buildApp().post('/api/schedules').send({
      ...VALID_BODY,
      frequency: 'monthly',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for weekly schedule missing day_of_week', async () => {
    const res = await buildApp().post('/api/schedules').send({
      ...VALID_BODY,
      day_of_week: undefined,
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid hour_utc (>23)', async () => {
    const res = await buildApp().post('/api/schedules').send({
      ...VALID_BODY,
      hour_utc: 25,
    });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/schedules ────────────────────────────────────────────────────────

describe('GET /api/schedules', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of schedules', async () => {
    vi.mocked(scheduleQueries.listSchedules).mockResolvedValue([MOCK_SCHEDULE] as any);

    const res = await buildApp().get('/api/schedules');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });
});

// ── GET /api/schedules/:id ────────────────────────────────────────────────────

describe('GET /api/schedules/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns schedule by id', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(MOCK_SCHEDULE as any);

    const res = await buildApp().get('/api/schedules/sched-001');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('sched-001');
  });

  it('returns 404 when schedule does not exist', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(null);

    const res = await buildApp().get('/api/schedules/missing');

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/schedules/:id ──────────────────────────────────────────────────

describe('PATCH /api/schedules/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates schedule and returns updated record', async () => {
    const updated = { ...MOCK_SCHEDULE, is_active: false };
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(MOCK_SCHEDULE as any);
    vi.mocked(scheduleQueries.updateSchedule).mockResolvedValue(updated as any);

    const res = await buildApp().patch('/api/schedules/sched-001').send({ is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });

  it('returns 404 when schedule not found', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(null);

    const res = await buildApp().patch('/api/schedules/missing').send({ is_active: false });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid frequency in patch', async () => {
    const res = await buildApp().patch('/api/schedules/sched-001').send({ frequency: 'hourly' });

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/schedules/:id ─────────────────────────────────────────────────

describe('DELETE /api/schedules/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes schedule and returns deleted=true', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(MOCK_SCHEDULE as any);
    vi.mocked(scheduleQueries.deleteSchedule).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/schedules/sched-001');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it('returns 404 when schedule not found', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(null);

    const res = await buildApp().delete('/api/schedules/missing');

    expect(res.status).toBe(404);
  });
});

// ── POST /api/schedules/:id/run ───────────────────────────────────────────────

describe('POST /api/schedules/:id/run', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('triggers manual run and returns 202 with audit_id', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(MOCK_SCHEDULE as any);
    vi.mocked(dbQueries.createAudit).mockResolvedValue({ id: 'audit-001', created_at: '2026-01-01' } as any);
    vi.mocked(scheduleQueries.markScheduleRan).mockResolvedValue(undefined);

    const res = await buildApp().post('/api/schedules/sched-001/run');

    expect(res.status).toBe(202);
    expect(res.body.audit_id).toBe('audit-001');
    expect(res.body.status).toBe('queued');
    expect(auditQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 404 when schedule not found', async () => {
    vi.mocked(scheduleQueries.getSchedule).mockResolvedValue(null);

    const res = await buildApp().post('/api/schedules/missing/run');

    expect(res.status).toBe(404);
  });
});
