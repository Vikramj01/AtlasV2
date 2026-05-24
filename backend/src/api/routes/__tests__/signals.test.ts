/**
 * Signal Library routes integration tests — /api/signals
 *
 * Covers: signal CRUD, org membership gate, pack CRUD,
 *         cross-org isolation, taxonomy validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/signalQueries', () => ({
  listSignals: vi.fn(),
  getSignal: vi.fn(),
  createSignal: vi.fn(),
  updateSignal: vi.fn(),
  deleteSignal: vi.fn(),
  listSignalPacks: vi.fn(),
  getSignalPack: vi.fn(),
  getSignalPackWithSignals: vi.fn(),
  createSignalPack: vi.fn(),
  updateSignalPack: vi.fn(),
  deleteSignalPack: vi.fn(),
  addSignalToPack: vi.fn(),
  removeSignalFromPack: vi.fn(),
  countClientsUsingPack: vi.fn(),
  countOutdatedDeployments: vi.fn(),
  incrementPackVersion: vi.fn(),
}));

vi.mock('@/services/database/orgQueries', () => ({
  getOrgMembership: vi.fn(),
}));

vi.mock('@/services/database/taxonomyQueries', () => ({
  fetchTaxonomyNode: vi.fn(),
}));

vi.mock('@/services/database/namingConventionQueries', () => ({
  getNamingConvention: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/signals/namingConvention', () => ({
  validateEventName: vi.fn().mockReturnValue({ valid: true, errors: [], suggestions: [] }),
}));

vi.mock('@/services/signals/composableOutputGenerator', () => ({
  generateComposableOutputs: vi.fn(),
}));

vi.mock('@/services/database/clientQueries', () => ({
  getClientsByPack: vi.fn().mockResolvedValue([]),
  getClient: vi.fn(),
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

import * as signalQueries from '@/services/database/signalQueries';
import * as orgQueries from '@/services/database/orgQueries';
import * as taxonomyQueries from '@/services/database/taxonomyQueries';
import { signalsRouter } from '../signals';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SIGNAL = {
  id: 'sig-001',
  organisation_id: 'org-001',
  key: 'purchase',
  name: 'Purchase',
  description: 'User completes a purchase',
  category: 'ecommerce',
  platform_mappings: { google_ads: 'purchase', meta: 'Purchase' },
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_PACK = {
  id: 'pack-001',
  organisation_id: 'org-001',
  name: 'Ecommerce Core',
  description: 'Essential ecommerce events',
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/signals', signalsRouter);
  return request(app);
}

// ── Signal CRUD ───────────────────────────────────────────────────────────────

describe('GET /api/signals', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns system signals when no org_id provided', async () => {
    vi.mocked(signalQueries.listSignals).mockResolvedValue([MOCK_SIGNAL] as any);

    const res = await buildApp().get('/api/signals');

    expect(res.status).toBe(200);
    expect(res.body.signals).toHaveLength(1);
  });

  it('returns org-scoped signals when org_id provided and user is member', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);
    vi.mocked(signalQueries.listSignals).mockResolvedValue([MOCK_SIGNAL] as any);

    const res = await buildApp().get('/api/signals?org_id=org-001');

    expect(res.status).toBe(200);
    expect(signalQueries.listSignals).toHaveBeenCalledWith('org-001');
  });

  it('returns 403 when user is not a member of the org', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue(null);

    const res = await buildApp().get('/api/signals?org_id=other-org');

    expect(res.status).toBe(403);
    expect(signalQueries.listSignals).not.toHaveBeenCalled();
  });
});

describe('POST /api/signals', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a signal with required fields', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);
    vi.mocked(signalQueries.createSignal).mockResolvedValue(MOCK_SIGNAL as any);

    const res = await buildApp()
      .post('/api/signals')
      .send({
        organisation_id: 'org-001',
        key: 'purchase',
        name: 'Purchase',
        description: 'User completes a purchase',
        category: 'ecommerce',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('sig-001');
  });

  it('returns 400 when required fields are missing', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);

    const res = await buildApp()
      .post('/api/signals')
      .send({
        organisation_id: 'org-001',
        key: 'purchase',
        // missing name, description, category
      });

    expect(res.status).toBe(400);
  });

  it('returns 403 when user not in org', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue(null);

    const res = await buildApp()
      .post('/api/signals')
      .send({
        organisation_id: 'another-org',
        key: 'purchase',
        name: 'Purchase',
        description: 'desc',
        category: 'ecommerce',
      });

    expect(res.status).toBe(403);
  });

  it('returns 404 when taxonomy_event_id does not exist', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(null);

    const res = await buildApp()
      .post('/api/signals')
      .send({
        organisation_id: 'org-001',
        key: 'purchase',
        name: 'Purchase',
        description: 'desc',
        category: 'ecommerce',
        taxonomy_event_id: 'nonexistent-tax',
      });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/signals/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes a signal successfully', async () => {
    vi.mocked(signalQueries.getSignal).mockResolvedValue(MOCK_SIGNAL as any);
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);
    vi.mocked(signalQueries.deleteSignal).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/signals/sig-001');

    expect(res.status).toBe(200);
    expect(signalQueries.deleteSignal).toHaveBeenCalledWith('sig-001', 'org-001');
  });

  it('returns 404 for non-existent signal', async () => {
    vi.mocked(signalQueries.getSignal).mockResolvedValue(null);

    const res = await buildApp().delete('/api/signals/missing');

    expect(res.status).toBe(404);
  });
});

// ── Signal Packs ──────────────────────────────────────────────────────────────

describe('GET /api/signals/packs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns packs for org', async () => {
    vi.mocked(signalQueries.listSignalPacks).mockResolvedValue([MOCK_PACK] as any);

    const res = await buildApp().get('/api/signals/packs?org_id=org-001');

    expect(res.status).toBe(200);
  });
});

describe('POST /api/signals/packs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a signal pack', async () => {
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);
    vi.mocked(signalQueries.createSignalPack).mockResolvedValue(MOCK_PACK as any);

    const res = await buildApp()
      .post('/api/signals/packs')
      .send({
        organisation_id: 'org-001',
        name: 'Ecommerce Core',
        business_type: 'ecommerce',
        description: 'Essential ecommerce events',
      });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/signals/packs/:packId/signals', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('adds a signal to a pack', async () => {
    vi.mocked(signalQueries.getSignalPack).mockResolvedValue(MOCK_PACK as any);
    vi.mocked(orgQueries.getOrgMembership).mockResolvedValue({ id: 'm-1' } as any);
    vi.mocked(signalQueries.addSignalToPack).mockResolvedValue(undefined);

    const res = await buildApp()
      .post('/api/signals/packs/pack-001/signals')
      .send({ signal_id: 'sig-001' });

    expect(res.status).toBe(201);
    expect(signalQueries.addSignalToPack).toHaveBeenCalledWith('pack-001', 'sig-001', undefined, true);
  });
});
