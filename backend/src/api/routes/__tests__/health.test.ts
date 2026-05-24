/**
 * Health Dashboard routes integration tests — /api/health
 *
 * Covers: score + alerts, history snapshots, manual compute (debounce),
 *         alert acknowledgement, user isolation (no cross-user data).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/healthQueries', () => ({
  getHealthScore: vi.fn(),
  getActiveAlerts: vi.fn(),
  getSnapshots: vi.fn(),
  acknowledgeAlert: vi.fn(),
  getDistinctSites: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  healthQueue: {
    add: vi.fn(),
    getJob: vi.fn(),
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

import * as healthQueries from '@/services/database/healthQueries';
import { healthQueue } from '@/services/queue/jobQueue';
import { healthRouter } from '../health';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SCORE = {
  id: 'score-001',
  user_id: 'u1',
  conversion_signal_health: 87,
  attribution_risk_level: 'Low',
  created_at: '2026-05-01T00:00:00Z',
};

const MOCK_ALERTS = [
  { id: 'alert-001', user_id: 'u1', type: 'missing_signal', message: 'GA4 not firing on checkout', severity: 'high', acknowledged: false },
];

const MOCK_SITES = ['https://example.com', 'https://shop.example.com'];

const MOCK_SNAPSHOTS = [
  { id: 'snap-001', user_id: 'u1', score: 87, created_at: '2026-05-01T00:00:00Z' },
  { id: 'snap-002', user_id: 'u1', score: 82, created_at: '2026-04-24T00:00:00Z' },
];

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/health', healthRouter);
  return request(app);
}

// ── GET /api/health ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns score, alerts, sites, and has_data=true when data exists', async () => {
    vi.mocked(healthQueries.getHealthScore).mockResolvedValue(MOCK_SCORE as any);
    vi.mocked(healthQueries.getActiveAlerts).mockResolvedValue(MOCK_ALERTS as any);
    vi.mocked(healthQueries.getDistinctSites).mockResolvedValue(MOCK_SITES);

    const res = await buildApp().get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.score.conversion_signal_health).toBe(87);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.has_data).toBe(true);
    expect(res.body.sites).toEqual(MOCK_SITES);
  });

  it('returns has_data=false when no score exists yet', async () => {
    vi.mocked(healthQueries.getHealthScore).mockResolvedValue(null);
    vi.mocked(healthQueries.getActiveAlerts).mockResolvedValue([]);
    vi.mocked(healthQueries.getDistinctSites).mockResolvedValue([]);

    const res = await buildApp().get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.has_data).toBe(false);
    expect(res.body.score).toBeNull();
  });

  it('returns empty alerts array when none active', async () => {
    vi.mocked(healthQueries.getHealthScore).mockResolvedValue(MOCK_SCORE as any);
    vi.mocked(healthQueries.getActiveAlerts).mockResolvedValue([]);
    vi.mocked(healthQueries.getDistinctSites).mockResolvedValue([]);

    const res = await buildApp().get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
  });
});

// ── GET /api/health/history ───────────────────────────────────────────────────

describe('GET /api/health/history', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns snapshots array for default 30-day window', async () => {
    vi.mocked(healthQueries.getSnapshots).mockResolvedValue(MOCK_SNAPSHOTS as any);

    const res = await buildApp().get('/api/health/history');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.snapshots)).toBe(true);
    expect(res.body.snapshots).toHaveLength(2);
    expect(healthQueries.getSnapshots).toHaveBeenCalledWith('u1', 30, undefined);
  });

  it('respects ?days= query parameter (capped at 90)', async () => {
    vi.mocked(healthQueries.getSnapshots).mockResolvedValue([]);

    await buildApp().get('/api/health/history?days=60');
    expect(healthQueries.getSnapshots).toHaveBeenCalledWith('u1', 60, undefined);

    vi.clearAllMocks();
    vi.mocked(healthQueries.getSnapshots).mockResolvedValue([]);
    await buildApp().get('/api/health/history?days=999');
    expect(healthQueries.getSnapshots).toHaveBeenCalledWith('u1', 90, undefined);
  });

  it('passes site filter from ?site= query parameter', async () => {
    vi.mocked(healthQueries.getSnapshots).mockResolvedValue([]);

    await buildApp().get('/api/health/history?site=https://example.com');

    expect(healthQueries.getSnapshots).toHaveBeenCalledWith('u1', 30, 'https://example.com');
  });
});

// ── POST /api/health/compute ──────────────────────────────────────────────────

describe('POST /api/health/compute', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enqueues job and returns 202 queued', async () => {
    vi.mocked(healthQueue.getJob as any).mockResolvedValue(null);
    vi.mocked(healthQueue.add as any).mockResolvedValue({ id: 'job-1' });

    const res = await buildApp().post('/api/health/compute').send({});

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(healthQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 202 already_queued when an active job exists', async () => {
    const mockJob = { getState: vi.fn().mockResolvedValue('active') };
    vi.mocked(healthQueue.getJob as any).mockResolvedValue(mockJob);

    const res = await buildApp().post('/api/health/compute').send({});

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('already_queued');
    expect(healthQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues new job when previous job completed', async () => {
    const mockJob = { getState: vi.fn().mockResolvedValue('completed') };
    vi.mocked(healthQueue.getJob as any).mockResolvedValue(mockJob);
    vi.mocked(healthQueue.add as any).mockResolvedValue({ id: 'job-2' });

    const res = await buildApp().post('/api/health/compute').send({});

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('queued');
    expect(healthQueue.add).toHaveBeenCalledOnce();
  });
});

// ── POST /api/health/alerts/:alertId/acknowledge ──────────────────────────────

describe('POST /api/health/alerts/:alertId/acknowledge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('acknowledges alert and returns acknowledged=true', async () => {
    vi.mocked(healthQueries.acknowledgeAlert).mockResolvedValue(true as any);

    const res = await buildApp().post('/api/health/alerts/alert-001/acknowledge');

    expect(res.status).toBe(200);
    expect(res.body.acknowledged).toBe(true);
    expect(healthQueries.acknowledgeAlert).toHaveBeenCalledWith('alert-001', 'u1');
  });

  it('returns 404 when alert does not exist or belongs to another user', async () => {
    vi.mocked(healthQueries.acknowledgeAlert).mockResolvedValue(false as any);

    const res = await buildApp().post('/api/health/alerts/nonexistent/acknowledge');

    expect(res.status).toBe(404);
  });
});

// ── GET /api/health/sites ─────────────────────────────────────────────────────

describe('GET /api/health/sites', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of distinct sites for the user', async () => {
    vi.mocked(healthQueries.getDistinctSites).mockResolvedValue(MOCK_SITES);

    const res = await buildApp().get('/api/health/sites');

    expect(res.status).toBe(200);
    expect(res.body.sites).toEqual(MOCK_SITES);
  });
});
