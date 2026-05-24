/**
 * Consent Hub routes integration tests — /api/consent
 *
 * Covers: record consent, get latest state, delete records (erasure),
 *         analytics, config CRUD, GCM state mapping, invalid project.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/consentQueries', () => ({
  createConsentRecord: vi.fn(),
  getLatestConsentRecord: vi.fn(),
  deleteConsentRecords: vi.fn(),
  getConsentAnalytics: vi.fn(),
  getConsentConfig: vi.fn(),
  upsertConsentConfig: vi.fn(),
}));

vi.mock('@/services/consent/gcmMapper', () => ({
  buildGCMState: vi.fn().mockReturnValue({
    ad_storage: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  }),
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

import * as consentQueries from '@/services/database/consentQueries';
import * as gcmMapper from '@/services/consent/gcmMapper';
import { consentRouter } from '../consent';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  id: 'cfg-001',
  organization_id: 'org-001',
  project_id: 'proj-001',
  gcm_enabled: true,
  gcm_mapping: { analytics: 'analytics_storage', advertising: 'ad_storage' },
  regulation: 'GDPR',
  banner_config: { ttl_days: 180 },
};

const MOCK_CONSENT_RECORD = {
  id: 'rec-001',
  project_id: 'proj-001',
  visitor_id: 'visitor-abc',
  consent_id: 'cid-001',
  decisions: { analytics: true, advertising: false },
  gcm_state: { ad_storage: 'denied', analytics_storage: 'granted' },
  regulation: 'GDPR',
  created_at: '2026-05-01T00:00:00Z',
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/consent', consentRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/consent/record', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates consent record with GCM state for valid project', async () => {
    vi.mocked(consentQueries.getConsentConfig).mockResolvedValue(MOCK_CONFIG as any);
    vi.mocked(consentQueries.createConsentRecord).mockResolvedValue(MOCK_CONSENT_RECORD as any);

    const res = await buildApp()
      .post('/api/consent/record')
      .send({
        project_id: 'proj-001',
        visitor_id: 'visitor-abc',
        consent_id: 'cid-001',
        decisions: { analytics: true, advertising: false },
        source: 'banner',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('rec-001');
    expect(gcmMapper.buildGCMState).toHaveBeenCalledOnce();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await buildApp()
      .post('/api/consent/record')
      .send({
        project_id: 'proj-001',
        // missing visitor_id, consent_id, decisions, source
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FIELDS');
  });

  it('returns 400 when project_id is invalid', async () => {
    vi.mocked(consentQueries.getConsentConfig).mockResolvedValue(null);

    const res = await buildApp()
      .post('/api/consent/record')
      .send({
        project_id: 'nonexistent',
        visitor_id: 'v1',
        consent_id: 'c1',
        decisions: {},
        source: 'banner',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PROJECT');
  });

  it('populates GCM fields: ad_storage, analytics_storage, ad_user_data', async () => {
    vi.mocked(consentQueries.getConsentConfig).mockResolvedValue(MOCK_CONFIG as any);
    vi.mocked(consentQueries.createConsentRecord).mockResolvedValue(MOCK_CONSENT_RECORD as any);

    await buildApp()
      .post('/api/consent/record')
      .send({
        project_id: 'proj-001',
        visitor_id: 'v2',
        consent_id: 'c2',
        decisions: { analytics: true, advertising: true },
        source: 'banner',
      });

    const createCall = vi.mocked(consentQueries.createConsentRecord).mock.calls[0][0];
    expect(createCall.gcm_state).toBeDefined();
    expect(createCall.gcm_state).toHaveProperty('ad_storage');
    expect(createCall.gcm_state).toHaveProperty('analytics_storage');
  });
});

describe('GET /api/consent/:projectId/:visitorId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns latest consent record for visitor', async () => {
    vi.mocked(consentQueries.getLatestConsentRecord).mockResolvedValue(MOCK_CONSENT_RECORD as any);

    const res = await buildApp().get('/api/consent/proj-001/visitor-abc');

    expect(res.status).toBe(200);
    expect(res.body.visitor_id).toBe('visitor-abc');
  });

  it('returns 404 when no record exists', async () => {
    vi.mocked(consentQueries.getLatestConsentRecord).mockResolvedValue(null);

    const res = await buildApp().get('/api/consent/proj-001/unknown-visitor');

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/consent/:projectId/:visitorId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes consent records for right-to-erasure', async () => {
    vi.mocked(consentQueries.deleteConsentRecords).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/consent/proj-001/visitor-abc');

    expect(res.status).toBe(200);
    expect(consentQueries.deleteConsentRecords).toHaveBeenCalledWith('proj-001', 'visitor-abc');
  });
});

describe('GET /api/consent/:projectId/analytics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns consent analytics with grant/deny breakdown', async () => {
    vi.mocked(consentQueries.getConsentConfig).mockResolvedValue(MOCK_CONFIG as any);
    vi.mocked(consentQueries.getConsentAnalytics).mockResolvedValue({
      total_records: 1000,
      granted_count: 750,
      denied_count: 250,
      grant_rate: 0.75,
    } as any);

    const res = await buildApp().get('/api/consent/proj-001/analytics');

    expect(res.status).toBe(200);
    expect(res.body.grant_rate).toBe(0.75);
  });
});

describe('POST /api/consent/config', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates/updates consent config', async () => {
    vi.mocked(consentQueries.upsertConsentConfig).mockResolvedValue(MOCK_CONFIG as any);

    const res = await buildApp()
      .post('/api/consent/config')
      .send({
        project_id: 'proj-001',
        organization_id: 'org-001',
        gcm_enabled: true,
        regulation: 'GDPR',
      });

    expect(res.status).toBe(200);
    expect(consentQueries.upsertConsentConfig).toHaveBeenCalledOnce();
  });
});
