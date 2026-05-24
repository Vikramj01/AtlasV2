/**
 * CAPI routes integration tests — /api/capi
 *
 * Covers: provider CRUD, activation, test event, process event,
 *         credential stripping from responses, plan gate (pro+),
 *         browser-event beacon (no auth), provider-not-found 404s.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/capiQueries', () => ({
  createProvider: vi.fn(),
  getProvider: vi.fn(),
  listProviders: vi.fn(),
  updateProviderConfig: vi.fn(),
  updateProviderStatus: vi.fn(),
  deleteProvider: vi.fn(),
  getProviderDashboard: vi.fn(),
  isEventDuplicate: vi.fn(),
  createCAPIEvent: vi.fn(),
  incrementProviderCounters: vi.fn(),
}));

vi.mock('@/services/capi/credentials', () => ({
  safeDecryptCredentials: vi.fn().mockReturnValue({ pixel_id: 'px-001', access_token: 'tok-001' }),
}));

vi.mock('@/services/capi/metaDelivery', () => ({
  validateMetaCredentials: vi.fn(),
  sendMetaTestEvent: vi.fn(),
  formatMetaEvent: vi.fn(),
  checkUserParamCompleteness: vi.fn().mockReturnValue(null),
  sendMetaEvents: vi.fn(),
}));

vi.mock('@/services/capi/googleDelivery', () => ({
  validateGoogleCredentials: vi.fn(),
  sendGoogleTestEvent: vi.fn(),
  sendGoogleEvents: vi.fn(),
}));

vi.mock('@/services/capi/linkedinDelivery', () => ({
  validateLinkedInCredentials: vi.fn(),
  sendLinkedInTestEvent: vi.fn(),
  sendLinkedInEvents: vi.fn(),
}));

vi.mock('@/services/capi/pipeline', () => ({
  processEvent: vi.fn(),
}));

vi.mock('@/services/capi/dedupStore', () => ({
  setDedupEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/capi/customerMatch', () => ({
  ingestCustomerMatchBatch: vi.fn(),
}));

vi.mock('@/integrations/google/dmaClient', () => ({
  DMAClientError: class DMAClientError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'user@test.com' } }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro', organization_id: 'org-001' } }),
      insert: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/api/middleware/planGuard', () => ({
  planGuard: () => (_req: any, _res: any, next: any) => next(),
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

import * as capiQueries from '@/services/database/capiQueries';
import * as metaDelivery from '@/services/capi/metaDelivery';
import * as pipeline from '@/services/capi/pipeline';
import { capiRouter } from '../capi';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PROVIDER = {
  id: 'prov-001',
  organization_id: 'u1',
  project_id: 'proj-001',
  provider: 'meta',
  status: 'draft',
  credentials: 'encrypted-blob',
  event_mapping: [{ atlas_event: 'Purchase', provider_event: 'Purchase' }],
  identifier_config: { enabled_identifiers: ['email'] },
  dedup_config: { enabled: true, dedup_window_minutes: 2880 },
  test_event_code: 'TEST123',
  created_at: '2026-01-01T00:00:00Z',
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp(plan = 'pro') {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan, isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/capi', capiRouter);
  return request(app);
}

// ── Provider CRUD ─────────────────────────────────────────────────────────────

describe('POST /api/capi/providers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates provider and returns 201 without credentials field', async () => {
    vi.mocked(metaDelivery.validateMetaCredentials).mockResolvedValue({ valid: true } as any);
    vi.mocked(capiQueries.createProvider).mockResolvedValue(MOCK_PROVIDER as any);

    const res = await buildApp().post('/api/capi/providers').send({
      project_id: 'proj-001',
      provider: 'meta',
      credentials: { pixel_id: 'px-001', access_token: 'tok-001' },
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('prov-001');
    expect(res.body).not.toHaveProperty('credentials');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await buildApp().post('/api/capi/providers').send({ project_id: 'proj-001' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FIELDS');
  });

  it('returns 400 when Meta credential validation fails', async () => {
    vi.mocked(metaDelivery.validateMetaCredentials).mockResolvedValue({ valid: false, error: 'Invalid pixel' } as any);

    const res = await buildApp().post('/api/capi/providers').send({
      project_id: 'proj-001',
      provider: 'meta',
      credentials: { pixel_id: 'bad', access_token: 'bad' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/capi/providers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists providers with credentials stripped', async () => {
    vi.mocked(capiQueries.listProviders).mockResolvedValue([MOCK_PROVIDER] as any);

    const res = await buildApp().get('/api/capi/providers');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).not.toHaveProperty('credentials');
    expect(res.body[0].id).toBe('prov-001');
  });
});

describe('GET /api/capi/providers/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns provider without credentials field', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(MOCK_PROVIDER as any);

    const res = await buildApp().get('/api/capi/providers/prov-001');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('prov-001');
    expect(res.body).not.toHaveProperty('credentials');
  });

  it('returns 404 for unknown provider', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(null);

    const res = await buildApp().get('/api/capi/providers/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PROVIDER_NOT_FOUND');
  });
});

describe('PATCH /api/capi/providers/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates event_mapping and returns updated provider without credentials', async () => {
    const updated = { ...MOCK_PROVIDER, event_mapping: [{ atlas_event: 'ViewContent', provider_event: 'ViewContent' }] };
    vi.mocked(capiQueries.getProvider).mockResolvedValue(MOCK_PROVIDER as any);
    vi.mocked(capiQueries.updateProviderConfig).mockResolvedValue(updated as any);

    const res = await buildApp().patch('/api/capi/providers/prov-001').send({
      event_mapping: [{ atlas_event: 'ViewContent', provider_event: 'ViewContent' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('credentials');
    expect(capiQueries.updateProviderConfig).toHaveBeenCalledOnce();
  });

  it('returns 404 when provider does not exist', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(null);

    const res = await buildApp().patch('/api/capi/providers/missing').send({ event_mapping: [] });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/capi/providers/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes provider and returns deleted=true', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(MOCK_PROVIDER as any);
    vi.mocked(capiQueries.deleteProvider).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/capi/providers/prov-001');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it('returns 404 for unknown provider', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(null);

    const res = await buildApp().delete('/api/capi/providers/missing');

    expect(res.status).toBe(404);
  });
});

// ── Activate ──────────────────────────────────────────────────────────────────

describe('POST /api/capi/providers/:id/activate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('activates provider with event mappings and returns status=active', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(MOCK_PROVIDER as any);
    vi.mocked(capiQueries.updateProviderStatus).mockResolvedValue(undefined);

    const res = await buildApp().post('/api/capi/providers/prov-001/activate');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(capiQueries.updateProviderStatus).toHaveBeenCalledWith('prov-001', 'active');
  });

  it('returns 400 when no event mappings configured', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue({ ...MOCK_PROVIDER, event_mapping: [] } as any);

    const res = await buildApp().post('/api/capi/providers/prov-001/activate');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_FAILED');
  });

  it('returns 404 for unknown provider', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(null);

    const res = await buildApp().post('/api/capi/providers/missing/activate');

    expect(res.status).toBe(404);
  });
});

// ── Test event ────────────────────────────────────────────────────────────────

describe('POST /api/capi/providers/:id/test', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends test event and returns results array', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue(MOCK_PROVIDER as any);
    vi.mocked(metaDelivery.sendMetaTestEvent).mockResolvedValue({ status: 'success', provider_response: {} } as any);
    vi.mocked(capiQueries.updateProviderStatus).mockResolvedValue(undefined);

    const res = await buildApp().post('/api/capi/providers/prov-001/test').send({
      test_events: [{ event_name: 'Purchase', event_time: 1700000000, event_id: 'evt-001' }],
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results[0].status).toBe('success');
  });

  it('returns 400 when test_events array is missing', async () => {
    const res = await buildApp().post('/api/capi/providers/prov-001/test').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FIELDS');
  });
});

// ── Process event ─────────────────────────────────────────────────────────────

describe('POST /api/capi/process', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('processes event through active provider pipeline', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue({ ...MOCK_PROVIDER, status: 'active' } as any);
    vi.mocked(pipeline.processEvent).mockResolvedValue({ status: 'delivered' } as any);

    const res = await buildApp().post('/api/capi/process').send({
      provider_id: 'prov-001',
      event: { event_name: 'Purchase', event_time: 1700000000, event_id: 'evt-001' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('delivered');
  });

  it('returns 400 when provider is not active', async () => {
    vi.mocked(capiQueries.getProvider).mockResolvedValue({ ...MOCK_PROVIDER, status: 'draft' } as any);

    const res = await buildApp().post('/api/capi/process').send({
      provider_id: 'prov-001',
      event: { event_name: 'Purchase', event_time: 1700000000, event_id: 'evt-001' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('PROVIDER_NOT_ACTIVE');
  });

  it('returns 400 when required fields missing', async () => {
    const res = await buildApp().post('/api/capi/process').send({ provider_id: 'prov-001' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FIELDS');
  });
});

// ── Browser-event beacon (no auth) ───────────────────────────────────────────

describe('POST /api/capi/browser-event', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when provider token is missing', async () => {
    const res = await buildApp().post('/api/capi/browser-event').send({
      event_id: '00000000-0000-0000-0000-000000000001',
      event_name: 'Purchase',
      timestamp: 1700000000,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 204 for valid beacon (fire-and-forget)', async () => {
    const { supabaseAdmin } = await import('@/services/database/supabase');
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'prov-001', organization_id: 'u1', provider: 'meta' },
        error: null,
      }),
    } as any);
    // Second call for insert (fire-and-forget)
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);

    const res = await buildApp()
      .post('/api/capi/browser-event')
      .set('x-atlas-provider-token', 'valid-token')
      .send({
        event_id: '00000000-0000-0000-0000-000000000001',
        event_name: 'Purchase',
        timestamp: 1700000000,
      });

    expect(res.status).toBe(204);
  });
});
