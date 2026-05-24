/**
 * Enricher routes integration tests — /api/enricher
 *
 * Covers: POST /runs (201, validation 400, DMA not-connected 400),
 *         GET /runs (list with telemetry).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/enricher/enricherService', () => ({
  runAudienceEnricher: vi.fn(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@/integrations/google/dmaClient', () => ({
  DMAClientError: class DMAClientError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
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

import * as enricherService from '@/services/enricher/enricherService';
import { supabaseAdmin } from '@/services/database/supabase';
import { DMAClientError } from '@/integrations/google/dmaClient';
import { enricherRouter } from '../enricher';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_BODY = {
  destinations: [{ type: 'GOOGLE_ADS', customerId: '123456789' }],
  contacts: [{ email: 'customer@example.com', first_name: 'Alice' }],
  operation_type: 'CREATE',
};

const MOCK_RUN = {
  id: 'run-001',
  status: 'completed',
  record_count: 1,
  matched_count: 1,
  match_rate: 100,
  created_at: '2026-01-01T00:00:00Z',
};

// Supabase chainable mock
function makeChain(data: unknown = []) {
  const chain: any = {
    then(resolve: Function) { resolve({ data, error: null }); },
  };
  const methods = ['select', 'eq', 'order', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/enricher', enricherRouter);
  return request(app);
}

// ── POST /api/enricher/runs ───────────────────────────────────────────────────

describe('POST /api/enricher/runs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates enricher run and returns 201', async () => {
    vi.mocked(enricherService.runAudienceEnricher).mockResolvedValue(MOCK_RUN as any);

    const res = await buildApp().post('/api/enricher/runs').send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('run-001');
    expect(enricherService.runAudienceEnricher).toHaveBeenCalledOnce();
  });

  it('returns 400 when destinations array is empty', async () => {
    const res = await buildApp().post('/api/enricher/runs').send({
      ...VALID_BODY,
      destinations: [],
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when contacts array is missing', async () => {
    const res = await buildApp().post('/api/enricher/runs').send({
      destinations: [{ type: 'GOOGLE_ADS' }],
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 with DMA_NOT_CONNECTED error when credentials missing', async () => {
    const err = new DMAClientError(401, 'Unauthorized');
    vi.mocked(enricherService.runAudienceEnricher).mockRejectedValue(err);

    const res = await buildApp().post('/api/enricher/runs').send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DMA_NOT_CONNECTED');
  });

  it('returns 400 for invalid destination type', async () => {
    const res = await buildApp().post('/api/enricher/runs').send({
      ...VALID_BODY,
      destinations: [{ type: 'INVALID_PLATFORM' }],
    });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/enricher/runs ────────────────────────────────────────────────────

describe('GET /api/enricher/runs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of enricher runs', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([MOCK_RUN]) as any);

    const res = await buildApp().get('/api/enricher/runs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns empty array when no runs exist', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeChain([]) as any);

    const res = await buildApp().get('/api/enricher/runs');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
