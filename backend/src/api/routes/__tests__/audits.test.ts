/**
 * Audits routes integration tests — /api/audits
 *
 * Covers: start (enqueues job, 202), get status, get report (409 if pending,
 *         comparison delta), export (pdf/json/zip), gaps, user isolation (403),
 *         start-from-journey, delete, validation errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/queries', () => ({
  createAudit: vi.fn(),
  getAudit: vi.fn(),
  getReport: vi.fn(),
  listAudits: vi.fn(),
  deleteAudit: vi.fn(),
  getPreviousAuditScore: vi.fn(),
  linkAuditToClient: vi.fn(),
}));

vi.mock('@/services/database/clientQueries', () => ({
  getClient: vi.fn(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { organization_id: 'org-001' }, error: null }),
    })),
  },
}));

vi.mock('@/services/database/journeyQueries', () => ({
  getJourneyWithDetails: vi.fn(),
  getLatestSpec: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  auditQueue: { add: vi.fn() },
}));

vi.mock('@/services/export/pdfGenerator', () => ({
  generatePDF: vi.fn(),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/api/middleware/auditLimiter', () => ({
  auditLimiter: (_req: any, _res: any, next: any) => next(),
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

import * as dbQueries from '@/services/database/queries';
import * as journeyQueries from '@/services/database/journeyQueries';
import * as clientQueries from '@/services/database/clientQueries';
import { auditQueue } from '@/services/queue/jobQueue';
import * as pdfGenerator from '@/services/export/pdfGenerator';
import auditRouter from '../audits';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_AUDIT = {
  id: 'audit-001',
  user_id: 'u1',
  website_url: 'https://example.com',
  funnel_type: 'ecommerce',
  status: 'completed',
  progress: 100,
  created_at: '2026-01-01T00:00:00Z',
  completed_at: '2026-01-01T00:05:00Z',
  error_message: null,
};

const MOCK_REPORT = {
  audit_id: 'audit-001',
  executive_summary: {
    scores: { conversion_signal_health: 87, attribution_risk_level: 'Low' },
    recommendations: [],
  },
  validation_results: [],
};

const MOCK_JOURNEY = {
  id: 'journey-001',
  user_id: 'u1',
  name: 'Test Journey',
  stages: [{ id: 'stage-001', sample_url: 'https://example.com', name: 'Landing' }],
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/audits', auditRouter);
  return request(app);
}

// ── POST /api/audits/start ────────────────────────────────────────────────────

describe('POST /api/audits/start', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates audit, enqueues job, returns 202 with audit_id', async () => {
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      funnel_type: 'ecommerce',
      url_map: { homepage: 'https://example.com', checkout: 'https://example.com/checkout' },
    });

    expect(res.status).toBe(202);
    expect(res.body.audit_id).toBe('audit-001');
    expect(res.body.status).toBe('queued');
    expect(auditQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 400 when website_url is missing', async () => {
    const res = await buildApp().post('/api/audits/start').send({
      funnel_type: 'ecommerce',
      url_map: {},
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid funnel_type', async () => {
    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      funnel_type: 'invalid_type',
      url_map: {},
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid website_url format', async () => {
    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'not-a-url',
      funnel_type: 'ecommerce',
      url_map: {},
    });

    expect(res.status).toBe(400);
  });

  it('creates a client-linked audit when a valid client_id is provided', async () => {
    const clientId = '11111111-1111-1111-1111-111111111111';
    vi.mocked(clientQueries.getClient).mockResolvedValue({ id: clientId } as any);
    vi.mocked(dbQueries.createAudit).mockResolvedValue({ ...MOCK_AUDIT, client_id: clientId } as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      funnel_type: 'ecommerce',
      url_map: { homepage: 'https://example.com' },
      client_id: clientId,
    });

    expect(res.status).toBe(202);
    expect(dbQueries.createAudit).toHaveBeenCalledWith(expect.objectContaining({ client_id: clientId }));
  });

  it('returns 404 when client_id does not resolve to an accessible client', async () => {
    vi.mocked(clientQueries.getClient).mockResolvedValue(null);

    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      funnel_type: 'ecommerce',
      url_map: { homepage: 'https://example.com' },
      client_id: '11111111-1111-1111-1111-111111111111',
    });

    expect(res.status).toBe(404);
    expect(dbQueries.createAudit).not.toHaveBeenCalled();
  });

  it('queue payload does not contain test_email or test_phone (PII safety)', async () => {
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      funnel_type: 'ecommerce',
      url_map: { homepage: 'https://example.com' },
      test_email: 'test@example.com',
      test_phone: '+14155551234',
    });

    const payload = vi.mocked(auditQueue.add as any).mock.calls[0][0];
    expect(payload).not.toHaveProperty('test_email');
    expect(payload).not.toHaveProperty('test_phone');
  });

  // ── v2 Check Register Scan Inputs ──────────────────────────────────────────

  it('accepts a v2 payload (site_type) without funnel_type and tags rule_set_version', async () => {
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      site_type: 'plg_saas',
      declared_platforms: ['google_ads', 'meta'],
      primary_channel: 'google_ads',
      traffic_regions: ['us'],
      url_map: { landing: 'https://example.com' },
    });

    expect(res.status).toBe(202);
    expect(dbQueries.createAudit).toHaveBeenCalledWith(
      expect.objectContaining({ rule_set_version: 'v2', site_type: 'plg_saas', funnel_type: 'saas' }),
    );
    const queuePayload = vi.mocked(auditQueue.add as any).mock.calls[0][0];
    expect(queuePayload.rule_set_version).toBe('v2');
    expect(queuePayload.declared_platforms).toEqual(['google_ads', 'meta']);
  });

  it('maps each site_type onto the legacy funnel_type column correctly', async () => {
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    const cases: Array<[string, string]> = [
      ['plg_saas', 'saas'],
      ['ecommerce', 'ecommerce'],
      ['lead_gen_b2b', 'lead_gen'],
      ['marketplace', 'ecommerce'],
      ['app_install', 'saas'],
      ['subscription_media', 'saas'],
    ];

    for (const [site_type, expectedFunnel] of cases) {
      vi.mocked(dbQueries.createAudit).mockClear();
      await buildApp().post('/api/audits/start').send({
        website_url: 'https://example.com',
        site_type,
        declared_platforms: ['google_ads'],
        primary_channel: 'google_ads',
        traffic_regions: ['us'],
        url_map: { landing: 'https://example.com' },
      });
      expect(dbQueries.createAudit).toHaveBeenCalledWith(expect.objectContaining({ funnel_type: expectedFunnel }));
    }
  });

  it('defaults product_domain to website_url when not supplied', async () => {
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      site_type: 'plg_saas',
      declared_platforms: ['google_ads'],
      primary_channel: 'google_ads',
      traffic_regions: ['us'],
      url_map: { landing: 'https://example.com' },
    });

    expect(dbQueries.createAudit).toHaveBeenCalledWith(
      expect.objectContaining({ product_domain: 'https://example.com' }),
    );
  });

  it('returns 400 when site_type is given without declared_platforms/primary_channel/traffic_regions', async () => {
    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      site_type: 'plg_saas',
      url_map: { landing: 'https://example.com' },
    });

    expect(res.status).toBe(400);
    expect(dbQueries.createAudit).not.toHaveBeenCalled();
  });

  it('returns 400 when neither funnel_type nor site_type is supplied', async () => {
    const res = await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      url_map: {},
    });

    expect(res.status).toBe(400);
  });

  it('does not tag rule_set_version for a v1 (funnel_type) payload', async () => {
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    await buildApp().post('/api/audits/start').send({
      website_url: 'https://example.com',
      funnel_type: 'ecommerce',
      url_map: { homepage: 'https://example.com' },
    });

    expect(dbQueries.createAudit).toHaveBeenCalledWith(
      expect.not.objectContaining({ rule_set_version: expect.anything() }),
    );
  });
});

// ── GET /api/audits ───────────────────────────────────────────────────────────

describe('GET /api/audits', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of audits for the user', async () => {
    vi.mocked(dbQueries.listAudits).mockResolvedValue([MOCK_AUDIT] as any);

    const res = await buildApp().get('/api/audits');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(dbQueries.listAudits).toHaveBeenCalledWith('u1');
  });
});

// ── GET /api/audits/:audit_id ─────────────────────────────────────────────────

describe('GET /api/audits/:audit_id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns audit status and progress', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);

    const res = await buildApp().get('/api/audits/audit-001');

    expect(res.status).toBe(200);
    expect(res.body.audit_id).toBe('audit-001');
    expect(res.body.status).toBe('completed');
  });

  it('returns 404 for non-existent audit', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(null);

    const res = await buildApp().get('/api/audits/nonexistent');

    expect(res.status).toBe(404);
  });

  it('returns 403 when audit belongs to a different user', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue({ ...MOCK_AUDIT, user_id: 'other-user' } as any);

    const res = await buildApp().get('/api/audits/audit-001');

    expect(res.status).toBe(403);
  });
});

// ── GET /api/audits/:audit_id/report ─────────────────────────────────────────

describe('GET /api/audits/:audit_id/report', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns full report when audit is completed', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(dbQueries.getReport).mockResolvedValue(MOCK_REPORT as any);
    vi.mocked(dbQueries.getPreviousAuditScore).mockResolvedValue(null);

    const res = await buildApp().get('/api/audits/audit-001/report');

    expect(res.status).toBe(200);
    expect(res.body.executive_summary).toBeDefined();
    expect(res.body.comparison).toBeNull();
  });

  it('includes score comparison when a previous audit exists', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(dbQueries.getReport).mockResolvedValue(MOCK_REPORT as any);
    vi.mocked(dbQueries.getPreviousAuditScore).mockResolvedValue({
      audit_id: 'audit-000',
      score: 72,
      created_at: '2026-03-01T00:00:00Z',
    } as any);

    const res = await buildApp().get('/api/audits/audit-001/report');

    expect(res.status).toBe(200);
    expect(res.body.comparison.delta).toBe(15); // 87 - 72
    expect(res.body.comparison.previous_score).toBe(72);
  });

  it('returns 409 when audit is still running', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue({ ...MOCK_AUDIT, status: 'running', progress: 45 } as any);

    const res = await buildApp().get('/api/audits/audit-001/report');

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('running');
  });

  it('returns 403 when audit belongs to another user', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue({ ...MOCK_AUDIT, user_id: 'other' } as any);

    const res = await buildApp().get('/api/audits/audit-001/report');

    expect(res.status).toBe(403);
  });
});

// ── POST /api/audits/:audit_id/export ────────────────────────────────────────

describe('POST /api/audits/:audit_id/export', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns JSON export with correct Content-Type', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(dbQueries.getReport).mockResolvedValue(MOCK_REPORT as any);

    const res = await buildApp().post('/api/audits/audit-001/export').send({ format: 'json' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('.json');
  });

  it('returns PDF export with correct Content-Type', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(dbQueries.getReport).mockResolvedValue(MOCK_REPORT as any);
    vi.mocked(pdfGenerator.generatePDF).mockResolvedValue(Buffer.from('fake-pdf') as any);

    const res = await buildApp().post('/api/audits/audit-001/export').send({ format: 'pdf' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  it('returns 400 for invalid format', async () => {
    const res = await buildApp().post('/api/audits/audit-001/export').send({ format: 'csv' });

    expect(res.status).toBe(400);
  });

  it('returns 409 when audit not completed', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue({ ...MOCK_AUDIT, status: 'running' } as any);

    const res = await buildApp().post('/api/audits/audit-001/export').send({ format: 'pdf' });

    expect(res.status).toBe(409);
  });
});

// ── POST /api/audits/start-from-journey ──────────────────────────────────────

describe('POST /api/audits/start-from-journey', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates audit from journey and enqueues job', async () => {
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue(MOCK_JOURNEY as any);
    vi.mocked(journeyQueries.getLatestSpec).mockResolvedValue({ spec_data: { rules: [] } } as any);
    vi.mocked(dbQueries.createAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(auditQueue.add as any).mockResolvedValue({ id: 'job-001' });

    const res = await buildApp().post('/api/audits/start-from-journey').send({ journey_id: 'journey-001' });

    expect(res.status).toBe(202);
    expect(res.body.journey_id).toBe('journey-001');
    expect(auditQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 404 when journey does not exist', async () => {
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue(null);

    const res = await buildApp().post('/api/audits/start-from-journey').send({ journey_id: 'missing' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when journey has no validation spec', async () => {
    vi.mocked(journeyQueries.getJourneyWithDetails).mockResolvedValue(MOCK_JOURNEY as any);
    vi.mocked(journeyQueries.getLatestSpec).mockResolvedValue(null);

    const res = await buildApp().post('/api/audits/start-from-journey').send({ journey_id: 'journey-001' });

    expect(res.status).toBe(409);
  });

  it('returns 400 when journey_id is missing', async () => {
    const res = await buildApp().post('/api/audits/start-from-journey').send({});

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/audits/:audit_id ──────────────────────────────────────────────

describe('DELETE /api/audits/:audit_id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes audit belonging to authenticated user', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(dbQueries.deleteAudit).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/audits/audit-001');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it('returns 403 when audit belongs to another user', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue({ ...MOCK_AUDIT, user_id: 'other-user' } as any);

    const res = await buildApp().delete('/api/audits/audit-001');

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/audits/:audit_id/link-client ───────────────────────────────────

describe('PATCH /api/audits/:audit_id/link-client', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

  it('links an existing audit to a client the user can access', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(clientQueries.getClient).mockResolvedValue({ id: CLIENT_ID } as any);
    vi.mocked(dbQueries.linkAuditToClient).mockResolvedValue({ ...MOCK_AUDIT, client_id: CLIENT_ID } as any);

    const res = await buildApp()
      .patch('/api/audits/audit-001/link-client')
      .send({ client_id: CLIENT_ID });

    expect(res.status).toBe(200);
    expect(res.body.client_id).toBe(CLIENT_ID);
    expect(dbQueries.linkAuditToClient).toHaveBeenCalledWith('audit-001', CLIENT_ID, 'u1');
  });

  it('returns 400 for a malformed client_id', async () => {
    const res = await buildApp()
      .patch('/api/audits/audit-001/link-client')
      .send({ client_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the audit does not exist', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(null);

    const res = await buildApp()
      .patch('/api/audits/audit-001/link-client')
      .send({ client_id: CLIENT_ID });

    expect(res.status).toBe(404);
  });

  it('returns 403 when the audit belongs to another user', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue({ ...MOCK_AUDIT, user_id: 'other-user' } as any);

    const res = await buildApp()
      .patch('/api/audits/audit-001/link-client')
      .send({ client_id: CLIENT_ID });

    expect(res.status).toBe(403);
  });

  it('returns 404 when the client is not accessible to the user', async () => {
    vi.mocked(dbQueries.getAudit).mockResolvedValue(MOCK_AUDIT as any);
    vi.mocked(clientQueries.getClient).mockResolvedValue(null);

    const res = await buildApp()
      .patch('/api/audits/audit-001/link-client')
      .send({ client_id: CLIENT_ID });

    expect(res.status).toBe(404);
  });
});
