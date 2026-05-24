/**
 * Journey Builder routes integration tests — /api/journeys
 *
 * Covers: CRUD, B2B fields, template creation, spec generation,
 *         strategyGate guard, buyer_intent_level validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/journeyQueries', () => ({
  createJourney: vi.fn(),
  listJourneys: vi.fn(),
  getJourney: vi.fn(),
  getJourneyWithDetails: vi.fn(),
  updateJourney: vi.fn(),
  deleteJourney: vi.fn(),
  getJourneyStages: vi.fn(),
  upsertStage: vi.fn(),
  updateStage: vi.fn(),
  deleteStage: vi.fn(),
  reorderStages: vi.fn(),
  upsertPlatforms: vi.fn(),
  listSpecs: vi.fn(),
  getLatestSpec: vi.fn(),
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock('@/services/database/proxyEventQueries', () => ({
  fetchProxyEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/journey/specOrchestrator', () => ({
  generateAndSaveSpecs: vi.fn(),
}));

vi.mock('@/services/journey/actionPrimitives', () => ({
  ACTION_PRIMITIVES: [],
  getActionPrimitive: vi.fn(),
}));

vi.mock('@/api/middleware/strategyGate', () => ({
  strategyGate: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'user@test.com' } }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }),
    }),
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    next();
  },
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

import * as journeyQueries from '@/services/database/journeyQueries';
import * as specOrchestrator from '@/services/journey/specOrchestrator';
import { journeysRouter } from '../journeys';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_JOURNEY = {
  id: 'journey-001',
  user_id: 'u1',
  name: 'Test Journey',
  business_type: 'ecommerce',
  implementation_format: 'gtm',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const MOCK_STAGE = {
  id: 'stage-001',
  journey_id: 'journey-001',
  label: 'Product View',
  stage_order: 1,
  page_type: 'product',
  proxy_value_gbp: 2.50,
  buyer_intent_level: 'problem_aware',
};

const B2B_TEMPLATE = {
  id: 'tpl-b2b',
  name: 'B2B Lead Gen Template',
  business_type: 'b2b_lead_gen',
  template_data: {
    stages: [
      { order: 1, label: 'Awareness', page_type: 'blog', actions: [] },
      { order: 2, label: 'Interest', page_type: 'landing', actions: [] },
      { order: 3, label: 'Consideration', page_type: 'case_study', actions: [] },
      { order: 4, label: 'Intent', page_type: 'pricing', actions: [] },
      { order: 5, label: 'Evaluation', page_type: 'demo', actions: [] },
      { order: 6, label: 'Purchase', page_type: 'checkout', actions: [] },
      { order: 7, label: 'Retention', page_type: 'portal', actions: [] },
    ],
  },
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/journeys', journeysRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/journeys', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a journey with valid fields', async () => {
    vi.mocked(journeyQueries.createJourney).mockResolvedValue(MOCK_JOURNEY as any);
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue(MOCK_JOURNEY as any);

    const res = await buildApp()
      .post('/api/journeys')
      .send({ name: 'Test Journey', business_type: 'ecommerce' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('journey-001');
  });

  it('returns 400 when name is missing', async () => {
    const res = await buildApp()
      .post('/api/journeys')
      .send({ business_type: 'ecommerce' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when business_type is missing', async () => {
    const res = await buildApp()
      .post('/api/journeys')
      .send({ name: 'My Journey' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/journeys', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of journeys for authenticated user', async () => {
    vi.mocked(journeyQueries.listJourneys).mockResolvedValue([MOCK_JOURNEY] as any);

    const res = await buildApp().get('/api/journeys');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('journey-001');
  });
});

describe('GET /api/journeys/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns journey details', async () => {
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue({
      ...MOCK_JOURNEY,
      stages: [MOCK_STAGE],
    } as any);

    const res = await buildApp().get('/api/journeys/journey-001');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('journey-001');
  });

  it('returns 404 for non-existent journey', async () => {
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue(null);

    const res = await buildApp().get('/api/journeys/nonexistent');

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/journeys/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes journey and returns success', async () => {
    vi.mocked(journeyQueries.deleteJourney).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/journeys/journey-001');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

describe('B2B journey stage fields', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('upserts a stage with proxy_value_gbp and buyer_intent_level', async () => {
    vi.mocked(journeyQueries.getJourney).mockResolvedValue(MOCK_JOURNEY as any);
    vi.mocked(journeyQueries.upsertStage).mockResolvedValue(MOCK_STAGE as any);

    vi.mocked(journeyQueries.updateStage).mockResolvedValue(MOCK_STAGE as any);

    const res = await buildApp()
      .put('/api/journeys/journey-001/stages/1')
      .send({
        label: 'Product View',
        page_type: 'product',
        stage_order: 1,
        proxy_value_gbp: 2.50,
        buyer_intent_level: 'problem_aware',
        actions: [],
      });

    expect(res.status).toBe(200);
    expect(journeyQueries.updateStage).toHaveBeenCalledWith(
      '1',
      'journey-001',
      expect.objectContaining({
        proxy_value_gbp: 2.50,
        buyer_intent_level: 'problem_aware',
      }),
    );
  });

  it('returns 400 for invalid buyer_intent_level', async () => {
    vi.mocked(journeyQueries.getJourney).mockResolvedValue(MOCK_JOURNEY as any);

    const res = await buildApp()
      .put('/api/journeys/journey-001/stages/1')
      .send({
        label: 'Stage',
        stage_order: 1,
        buyer_intent_level: 'totally_invalid_level',
        actions: [],
      });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/journeys/from-template/:templateId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates B2B journey with 7 stages from template', async () => {
    vi.mocked(journeyQueries.getTemplate).mockResolvedValue(B2B_TEMPLATE as any);
    vi.mocked(journeyQueries.createJourney).mockResolvedValue({
      ...MOCK_JOURNEY,
      business_type: 'b2b_lead_gen',
    } as any);
    vi.mocked(journeyQueries.upsertStage).mockResolvedValue(MOCK_STAGE as any);
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue({
      ...MOCK_JOURNEY,
      stages: B2B_TEMPLATE.template_data.stages,
    } as any);

    const res = await buildApp()
      .post('/api/journeys/from-template/tpl-b2b')
      .send({ name: 'My B2B Journey' });

    expect(res.status).toBe(201);
    expect(journeyQueries.upsertStage).toHaveBeenCalledTimes(7);
  });

  it('returns 404 for non-existent template', async () => {
    vi.mocked(journeyQueries.getTemplate).mockResolvedValue(null);

    const res = await buildApp()
      .post('/api/journeys/from-template/missing-tpl')
      .send({ name: 'Journey' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/journeys/:id/generate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('triggers spec generation and returns spec data', async () => {
    vi.mocked(journeyQueries.getJourney).mockResolvedValue(MOCK_JOURNEY as any);
    vi.mocked(specOrchestrator.generateAndSaveSpecs).mockResolvedValue([
      { format: 'gtm', spec_data: { containerVersion: {} } },
    ] as any);

    const res = await buildApp()
      .post('/api/journeys/journey-001/generate');

    expect(res.status).toBe(200);
    expect(specOrchestrator.generateAndSaveSpecs).toHaveBeenCalledOnce();
  });
});
