/**
 * Naming Convention routes integration tests — /api/naming-convention
 *
 * Covers: GET convention, PUT upsert, POST validate, POST preview,
 *         POST apply, validation errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/namingConventionQueries', () => ({
  getNamingConvention: vi.fn(),
  upsertNamingConvention: vi.fn(),
}));

vi.mock('@/services/database/signalQueries', () => ({
  listSignals: vi.fn().mockResolvedValue([]),
  updateSignal: vi.fn(),
}));

vi.mock('@/services/signals/namingConvention', () => ({
  validateEventName: vi.fn().mockReturnValue({ valid: true, errors: [], suggestions: [] }),
  validateParamKey: vi.fn().mockReturnValue({ valid: true, errors: [], suggestions: [] }),
  generateEventName: vi.fn().mockImplementation((name: string) => name),
  buildExamples: vi.fn().mockReturnValue({ example_event: 'purchase', example_param: 'product_id' }),
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

import * as namingConventionQueries from '@/services/database/namingConventionQueries';
import * as namingConvention from '@/services/signals/namingConvention';
import * as signalQueries from '@/services/database/signalQueries';
import { namingConventionsRouter } from '../namingConventions';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CONVENTION = {
  organization_id: 'u1',
  event_case: 'snake_case',
  param_case: 'snake_case',
  event_prefix: null,
  max_event_name_length: 40,
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/naming-convention', namingConventionsRouter);
  return request(app);
}

// ── GET /api/naming-convention ────────────────────────────────────────────────

describe('GET /api/naming-convention', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns org naming convention', async () => {
    vi.mocked(namingConventionQueries.getNamingConvention).mockResolvedValue(MOCK_CONVENTION as any);

    const res = await buildApp().get('/api/naming-convention');

    expect(res.status).toBe(200);
    expect(res.body.convention.event_case).toBe('snake_case');
  });

  it('uses org_id query param if provided', async () => {
    vi.mocked(namingConventionQueries.getNamingConvention).mockResolvedValue(MOCK_CONVENTION as any);

    await buildApp().get('/api/naming-convention?org_id=other-org');

    expect(namingConventionQueries.getNamingConvention).toHaveBeenCalledWith('other-org');
  });
});

// ── PUT /api/naming-convention ────────────────────────────────────────────────

describe('PUT /api/naming-convention', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates convention and returns saved record', async () => {
    vi.mocked(namingConventionQueries.getNamingConvention).mockResolvedValue(MOCK_CONVENTION as any);
    vi.mocked(namingConventionQueries.upsertNamingConvention).mockResolvedValue({
      ...MOCK_CONVENTION,
      event_case: 'camelCase',
    } as any);

    const res = await buildApp().put('/api/naming-convention').send({ event_case: 'camelCase' });

    expect(res.status).toBe(200);
    expect(res.body.convention.event_case).toBe('camelCase');
  });

  it('returns 400 for invalid event_case', async () => {
    const res = await buildApp().put('/api/naming-convention').send({ event_case: 'UPPER_CASE' });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/naming-convention/validate ──────────────────────────────────────

describe('POST /api/naming-convention/validate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('validates event name against convention', async () => {
    vi.mocked(namingConventionQueries.getNamingConvention).mockResolvedValue(MOCK_CONVENTION as any);
    vi.mocked(namingConvention.validateEventName).mockReturnValue({
      valid: true,
      errors: [],
      suggestions: [],
    });

    const res = await buildApp().post('/api/naming-convention/validate').send({
      name: 'purchase_completed',
      type: 'event',
    });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it('returns validation errors for failing name', async () => {
    vi.mocked(namingConventionQueries.getNamingConvention).mockResolvedValue(MOCK_CONVENTION as any);
    vi.mocked(namingConvention.validateEventName).mockReturnValue({
      valid: false,
      errors: ['Name must be snake_case'],
      suggestions: ['purchase_completed'],
    });

    const res = await buildApp().post('/api/naming-convention/validate').send({
      name: 'PurchaseCompleted',
      type: 'event',
    });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors).toHaveLength(1);
  });

  it('returns 400 when name field missing', async () => {
    const res = await buildApp().post('/api/naming-convention/validate').send({ type: 'event' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const res = await buildApp().post('/api/naming-convention/validate').send({
      name: 'purchase',
      type: 'invalid_type',
    });

    expect(res.status).toBe(400);
  });
});

// ── POST /api/naming-convention/preview ──────────────────────────────────────

describe('POST /api/naming-convention/preview', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows rename preview for existing signals', async () => {
    vi.mocked(namingConventionQueries.getNamingConvention).mockResolvedValue(MOCK_CONVENTION as any);
    vi.mocked(signalQueries.listSignals).mockResolvedValue([
      { id: 'sig-001', key: 'PurchaseCompleted', is_system: false },
    ] as any);
    vi.mocked(namingConvention.generateEventName).mockReturnValue('purchase_completed');

    const res = await buildApp().post('/api/naming-convention/preview').send({
      convention: { event_case: 'snake_case' },
    });

    expect(res.status).toBe(200);
    expect(res.body.total_signals).toBe(1);
    expect(Array.isArray(res.body.renames)).toBe(true);
  });

  it('returns 400 for invalid convention', async () => {
    const res = await buildApp().post('/api/naming-convention/preview').send({
      convention: { event_case: 'INVALID' },
    });

    expect(res.status).toBe(400);
  });
});
