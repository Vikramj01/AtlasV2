/**
 * Dashboard routes integration tests — /api/dashboard
 *
 * Covers: main dashboard, atlas-score, next-action (skip_strategy param),
 *         activity, setup-progress, 500 on service failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/dashboard/dashboardService', () => ({
  buildDashboard: vi.fn(),
}));

vi.mock('@/services/dashboard/atlasScoreService', () => ({
  buildAtlasScore: vi.fn(),
}));

vi.mock('@/services/dashboard/nextActionService', () => ({
  buildNextAction: vi.fn(),
}));

vi.mock('@/services/dashboard/activityService', () => ({
  getRecentActivity: vi.fn(),
}));

vi.mock('@/services/dashboard/setupProgressService', () => ({
  getSetupProgress: vi.fn(),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as dashboardService from '@/services/dashboard/dashboardService';
import * as atlasScoreService from '@/services/dashboard/atlasScoreService';
import * as nextActionService from '@/services/dashboard/nextActionService';
import * as activityService from '@/services/dashboard/activityService';
import * as setupProgressService from '@/services/dashboard/setupProgressService';
import { dashboardRouter } from '../dashboard';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_DASHBOARD = {
  action_cards: [],
  summary: { audit_count: 2, signal_count: 5 },
};

const MOCK_SCORE = {
  overall: 72,
  tracking_coverage: 80,
  signal_quality: 65,
  data_health: 70,
};

const MOCK_NEXT_ACTION = {
  type: 'run_audit',
  title: 'Run your first audit',
  description: 'Discover tracking gaps',
  priority: 1,
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/dashboard', dashboardRouter);
  return request(app);
}

// ── GET /api/dashboard ────────────────────────────────────────────────────────

describe('GET /api/dashboard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns dashboard data', async () => {
    vi.mocked(dashboardService.buildDashboard).mockResolvedValue(MOCK_DASHBOARD as any);

    const res = await buildApp().get('/api/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.action_cards).toBeDefined();
    expect(dashboardService.buildDashboard).toHaveBeenCalledWith('u1');
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(dashboardService.buildDashboard).mockRejectedValue(new Error('DB error'));

    const res = await buildApp().get('/api/dashboard');

    expect(res.status).toBe(500);
  });
});

// ── GET /api/dashboard/atlas-score ───────────────────────────────────────────

describe('GET /api/dashboard/atlas-score', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns score object wrapped in data', async () => {
    vi.mocked(atlasScoreService.buildAtlasScore).mockResolvedValue(MOCK_SCORE as any);

    const res = await buildApp().get('/api/dashboard/atlas-score');

    expect(res.status).toBe(200);
    expect(res.body.data.overall).toBe(72);
    expect(res.body.error).toBeNull();
  });
});

// ── GET /api/dashboard/next-action ───────────────────────────────────────────

describe('GET /api/dashboard/next-action', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns next action', async () => {
    vi.mocked(nextActionService.buildNextAction).mockResolvedValue(MOCK_NEXT_ACTION as any);

    const res = await buildApp().get('/api/dashboard/next-action');

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('run_audit');
    expect(nextActionService.buildNextAction).toHaveBeenCalledWith('u1', false);
  });

  it('passes skip_strategy=true when query param is 1', async () => {
    vi.mocked(nextActionService.buildNextAction).mockResolvedValue(MOCK_NEXT_ACTION as any);

    await buildApp().get('/api/dashboard/next-action?skip_strategy=1');

    expect(nextActionService.buildNextAction).toHaveBeenCalledWith('u1', true);
  });
});

// ── GET /api/dashboard/activity ───────────────────────────────────────────────

describe('GET /api/dashboard/activity', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns activity feed', async () => {
    vi.mocked(activityService.getRecentActivity).mockResolvedValue([{ type: 'audit', ts: '2026-01-01' }] as any);

    const res = await buildApp().get('/api/dashboard/activity');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── GET /api/dashboard/setup-progress ────────────────────────────────────────

describe('GET /api/dashboard/setup-progress', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns setup progress', async () => {
    vi.mocked(setupProgressService.getSetupProgress).mockResolvedValue({ steps_complete: 3, total: 7 } as any);

    const res = await buildApp().get('/api/dashboard/setup-progress');

    expect(res.status).toBe(200);
    expect(res.body.data.steps_complete).toBe(3);
  });
});
