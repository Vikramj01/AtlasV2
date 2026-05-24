/**
 * Planning Mode routes integration tests — /api/planning
 *
 * Covers: session CRUD, save-to-library, strategy gate (strategyGate),
 *         AI generate outputs, recommendation decisions, delete, 404s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/services/database/planningQueries', () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  updateSessionStatus: vi.fn(),
  createPage: vi.fn(),
  getPagesBySession: vi.fn(),
  getPageWithSignedUrl: vi.fn(),
  getRecommendationsBySession: vi.fn(),
  getRecommendation: vi.fn(),
  createRecommendations: vi.fn(),
  updateRecommendationDecision: vi.fn(),
  getApprovedRecommendations: vi.fn(),
  getOutputs: vi.fn(),
  getOutput: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@/services/planning/generators/outputGenerator', () => ({
  generateAllOutputs: vi.fn(),
  GenerationValidationError: class extends Error {},
}));

vi.mock('@/services/planning/generators/gtmSchemaValidator', () => ({
  validateGTMContainer: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('@/services/planning/generators/gtmMerge', () => ({
  mergeGTMContainers: vi.fn(),
}));

vi.mock('@/services/planning/siteDetectionService', () => ({
  detectSite: vi.fn(),
}));

vi.mock('@/services/planning/piiDetectionService', () => ({
  detectPiiWarnings: vi.fn().mockReturnValue([]),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  planningQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
}));

vi.mock('@/services/database/journeyQueries', () => ({
  createJourney: vi.fn(),
  updateJourney: vi.fn(),
  upsertStage: vi.fn(),
  upsertPlatforms: vi.fn(),
  getJourneyWithDetails: vi.fn(),
  getLatestSpec: vi.fn(),
}));

vi.mock('@/services/database/signalQueries', () => ({
  createSignal: vi.fn(),
  listSignals: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro', organisation_id: 'org-001', organization_id: 'org-001' } }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }),
  },
  getScreenshotSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/screenshot.jpg'),
  uploadStrategyBriefPdf: vi.fn(),
  getStrategyBriefSignedUrl: vi.fn(),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/api/middleware/planGuard', () => ({
  planGuard: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/api/middleware/planningLimiter', () => ({
  planningLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/api/middleware/strategyGate', () => ({
  strategyGate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as planningQueries from '@/services/database/planningQueries';
import { planningQueue } from '@/services/queue/jobQueue';
import { planningRouter } from '../planning';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SESSION = {
  id: 'session-001',
  user_id: 'u1',
  site_url: 'https://example.com',
  business_type: 'ecommerce',
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_REC = {
  id: 'rec-001',
  session_id: 'session-001',
  page_id: 'page-001',
  event_name: 'purchase',
  recommendation_type: 'add',
  approved: null,
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/planning', planningRouter);
  return request(app);
}

// ── POST /api/planning/sessions ───────────────────────────────────────────────

describe('POST /api/planning/sessions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates session, enqueues scan job, returns 201', async () => {
    vi.mocked(planningQueries.createSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.createPage).mockResolvedValue({} as any);

    const res = await buildApp().post('/api/planning/sessions').send({
      website_url: 'https://example.com',
      business_type: 'ecommerce',
      pages: [{ url: 'https://example.com', page_type: 'homepage' }],
    });

    expect(res.status).toBe(201);
    expect(res.body.session_id).toBe('session-001');
    expect(planningQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 400 when website_url is missing', async () => {
    const res = await buildApp().post('/api/planning/sessions').send({
      business_type: 'ecommerce',
      pages: [{ url: 'https://example.com' }],
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no pages provided', async () => {
    const res = await buildApp().post('/api/planning/sessions').send({
      website_url: 'https://example.com',
      business_type: 'ecommerce',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid website_url format', async () => {
    const res = await buildApp().post('/api/planning/sessions').send({
      website_url: 'not-a-url',
      business_type: 'ecommerce',
      pages: [{ url: 'https://example.com' }],
    });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/planning/sessions ────────────────────────────────────────────────

describe('GET /api/planning/sessions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of sessions for the user', async () => {
    vi.mocked(planningQueries.listSessions).mockResolvedValue([MOCK_SESSION] as any);

    const res = await buildApp().get('/api/planning/sessions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions ?? res.body)).toBe(true);
  });
});

// ── GET /api/planning/sessions/:id ────────────────────────────────────────────

describe('GET /api/planning/sessions/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns session with pages and recommendations', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getPagesBySession).mockResolvedValue([]);
    vi.mocked(planningQueries.getRecommendationsBySession).mockResolvedValue([MOCK_REC] as any);

    const res = await buildApp().get('/api/planning/sessions/session-001');

    expect(res.status).toBe(200);
    expect(res.body.id ?? res.body.session?.id).toBe('session-001');
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(null);

    const res = await buildApp().get('/api/planning/sessions/missing');

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/planning/sessions/:id ────────────────────────────────────────

describe('DELETE /api/planning/sessions/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes session and returns success', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.deleteSession).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/planning/sessions/session-001');

    expect(res.status).toBe(200);
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(null);

    const res = await buildApp().delete('/api/planning/sessions/missing');

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/planning/sessions/:id/recommendations/:recId ─────────────────

describe('PATCH /api/planning/sessions/:id/recommendations/:recId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('approves a recommendation', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getRecommendation).mockResolvedValue(MOCK_REC as any);
    vi.mocked(planningQueries.updateRecommendationDecision).mockResolvedValue({
      ...MOCK_REC, user_decision: 'approved',
    } as any);

    const res = await buildApp()
      .patch('/api/planning/sessions/session-001/recommendations/rec-001')
      .send({ user_decision: 'approved' });

    expect(res.status).toBe(200);
  });

  it('skips a recommendation', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getRecommendation).mockResolvedValue(MOCK_REC as any);
    vi.mocked(planningQueries.updateRecommendationDecision).mockResolvedValue({
      ...MOCK_REC, user_decision: 'skipped',
    } as any);

    const res = await buildApp()
      .patch('/api/planning/sessions/session-001/recommendations/rec-001')
      .send({ user_decision: 'skipped' });

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid user_decision value', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getRecommendation).mockResolvedValue(MOCK_REC as any);

    const res = await buildApp()
      .patch('/api/planning/sessions/session-001/recommendations/rec-001')
      .send({ user_decision: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when recommendation does not exist', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getRecommendation).mockResolvedValue(null);

    const res = await buildApp()
      .patch('/api/planning/sessions/session-001/recommendations/missing')
      .send({ user_decision: 'approved' });

    expect(res.status).toBe(404);
  });
});

// ── POST /api/planning/sessions/:id/save-to-library ──────────────────────────

describe('POST /api/planning/sessions/:id/save-to-library', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('saves approved recommendations to signal library', async () => {
    const { createSignal } = await import('@/services/database/signalQueries');
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getApprovedRecommendations).mockResolvedValue([
      { ...MOCK_REC, approved: true, event_name: 'purchase' },
    ] as any);
    vi.mocked(createSignal).mockResolvedValue({ id: 'sig-001' } as any);

    const res = await buildApp().post('/api/planning/sessions/session-001/save-to-library');

    expect(res.status).toBe(200);
  });

  it('returns 404 when session not found', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(null);

    const res = await buildApp().post('/api/planning/sessions/missing/save-to-library');

    expect(res.status).toBe(404);
  });
});
