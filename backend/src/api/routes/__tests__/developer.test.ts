/**
 * Developer portal routes integration tests
 *
 * shareRouter  (/api/planning/sessions/:id/share*)
 *   POST   — create share token (201, 404 session not found)
 *   GET    — list active shares
 *   DELETE — revoke share (404 share not found)
 *   GET /progress — implementation progress
 *
 * devRouter (/api/dev/*)
 *   GET /:shareToken        — portal payload (401 invalid token)
 *   PATCH /:token/pages/:id/status — update status (400 missing status)
 *   GET  /:token/outputs/:id/download — download output
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/services/developer/shareService', () => ({
  generateShareToken: vi.fn(),
  validateShareToken: vi.fn(),
  listSharesForSession: vi.fn(),
  revokeShare: vi.fn(),
  aggregateProgress: vi.fn(),
  updatePageStatus: vi.fn(),
  notifyMarketerIfComplete: vi.fn(),
}));

vi.mock('@/services/developer/quickCheckService', () => ({
  runQuickCheck: vi.fn(),
}));

vi.mock('@/services/database/developerQueries', () => ({
  initProgressForShare: vi.fn(),
}));

vi.mock('@/services/database/planningQueries', () => ({
  getSession: vi.fn(),
  getPagesBySession: vi.fn(),
  getOutput: vi.fn(),
  getOutputs: vi.fn(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: {
      admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { email: 'dev@example.com' } } }) },
    },
    from: vi.fn(),
  },
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/config/env', () => ({
  env: {
    SUPER_ADMIN_EMAILS: [],
    ADMIN_EMAILS: [],
    FRONTEND_URL: 'https://app.example.com',
  },
}));

import * as shareService from '@/services/developer/shareService';
import * as planningQueries from '@/services/database/planningQueries';
import * as developerQueries from '@/services/database/developerQueries';
import { shareRouter, devRouter } from '../developer';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SESSION = {
  id: 'session-001',
  user_id: 'u1',
  website_url: 'https://example.com',
  status: 'outputs_ready',
};

const MOCK_SHARE = {
  id: 'share-001',
  share_id: 'share-001',
  session_id: 'session-001',
  user_id: 'u1',
  token: 'abc123token',
  is_active: true,
};

const MOCK_VALIDATED = {
  share_id: 'share-001',
  session_id: 'session-001',
  user_id: 'u1',
};

const MOCK_PROGRESS = {
  pages: [],
  overall_pct: 0,
};

// ── Test apps ─────────────────────────────────────────────────────────────────

function buildShareApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/planning/sessions/:id/share', shareRouter);
  return request(app);
}

function buildDevApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/dev', devRouter);
  return request(app);
}

// ── POST /api/planning/sessions/:id/share ─────────────────────────────────────

describe('POST /api/planning/sessions/:id/share', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates share token and returns 201', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getPagesBySession).mockResolvedValue([]);
    vi.mocked(shareService.generateShareToken).mockResolvedValue({
      share_id: 'share-001',
      token: 'abc123token',
      share_url: 'https://app.example.com/dev/abc123token',
    } as any);
    vi.mocked(developerQueries.initProgressForShare).mockResolvedValue(undefined);

    const res = await buildShareApp().post('/api/planning/sessions/session-001/share').send({
      developer_email: 'dev@example.com',
    });

    expect(res.status).toBe(201);
    expect(res.body.share_id).toBe('share-001');
  });

  it('returns 404 when session does not exist', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(null);

    const res = await buildShareApp().post('/api/planning/sessions/missing/share').send({});

    expect(res.status).toBe(404);
  });
});

// ── GET /api/planning/sessions/:id/share ──────────────────────────────────────

describe('GET /api/planning/sessions/:id/share', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists active shares for session', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(shareService.listSharesForSession).mockResolvedValue([MOCK_SHARE] as any);

    const res = await buildShareApp().get('/api/planning/sessions/session-001/share');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.shares)).toBe(true);
    expect(res.body.shares).toHaveLength(1);
  });

  it('returns 404 when session not found', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(null);

    const res = await buildShareApp().get('/api/planning/sessions/missing/share');

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/planning/sessions/:id/share/:shareId ─────────────────────────

describe('DELETE /api/planning/sessions/:id/share/:shareId', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('revokes share and returns revoked=true', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(shareService.revokeShare).mockResolvedValue(true);

    const res = await buildShareApp().delete('/api/planning/sessions/session-001/share/share-001');

    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
  });

  it('returns 404 when share does not exist', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(shareService.revokeShare).mockResolvedValue(false);

    const res = await buildShareApp().delete('/api/planning/sessions/session-001/share/missing');

    expect(res.status).toBe(404);
  });
});

// ── GET /api/planning/sessions/:id/progress ───────────────────────────────────

describe('GET /api/planning/sessions/:id/progress', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns progress when share exists', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(shareService.listSharesForSession).mockResolvedValue([MOCK_SHARE] as any);
    vi.mocked(shareService.aggregateProgress).mockResolvedValue(MOCK_PROGRESS as any);

    const res = await buildShareApp().get('/api/planning/sessions/session-001/share/progress');

    expect(res.status).toBe(200);
    expect(res.body.has_share).toBe(true);
    expect(res.body.progress).toBeDefined();
  });

  it('returns has_share=false when no shares exist', async () => {
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(shareService.listSharesForSession).mockResolvedValue([]);

    const res = await buildShareApp().get('/api/planning/sessions/session-001/share/progress');

    expect(res.status).toBe(200);
    expect(res.body.has_share).toBe(false);
  });
});

// ── GET /api/dev/:shareToken ──────────────────────────────────────────────────

describe('GET /api/dev/:shareToken', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 for invalid or expired share token', async () => {
    vi.mocked(shareService.validateShareToken).mockResolvedValue(null);

    const res = await buildDevApp().get('/api/dev/invalid-token');

    expect(res.status).toBe(401);
  });

  it('returns developer portal payload for valid token', async () => {
    vi.mocked(shareService.validateShareToken).mockResolvedValue(MOCK_VALIDATED as any);
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(planningQueries.getPagesBySession).mockResolvedValue([]);
    vi.mocked(planningQueries.getOutputs).mockResolvedValue([]);
    vi.mocked(shareService.aggregateProgress).mockResolvedValue({ pages: [], overall_pct: 0 } as any);

    const res = await buildDevApp().get('/api/dev/valid-token');

    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe('session-001');
    expect(res.body.pages).toBeDefined();
  });
});

// ── PATCH /api/dev/:shareToken/pages/:pageId/status ──────────────────────────

describe('PATCH /api/dev/:shareToken/pages/:pageId/status', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates page status', async () => {
    vi.mocked(shareService.validateShareToken).mockResolvedValue(MOCK_VALIDATED as any);
    vi.mocked(shareService.updatePageStatus).mockResolvedValue(undefined);
    vi.mocked(planningQueries.getSession).mockResolvedValue(MOCK_SESSION as any);
    vi.mocked(shareService.notifyMarketerIfComplete).mockResolvedValue(undefined);

    const res = await buildDevApp()
      .patch('/api/dev/valid-token/pages/page-001/status')
      .send({ status: 'implemented' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
  });

  it('returns 400 when status is missing', async () => {
    vi.mocked(shareService.validateShareToken).mockResolvedValue(MOCK_VALIDATED as any);

    const res = await buildDevApp()
      .patch('/api/dev/valid-token/pages/page-001/status')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── GET /api/dev/:shareToken/outputs/:outputId/download ──────────────────────

describe('GET /api/dev/:shareToken/outputs/:outputId/download', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 404 when output does not exist', async () => {
    vi.mocked(shareService.validateShareToken).mockResolvedValue(MOCK_VALIDATED as any);
    vi.mocked(planningQueries.getOutput).mockResolvedValue(null);

    const res = await buildDevApp().get('/api/dev/valid-token/outputs/out-001/download');

    expect(res.status).toBe(404);
  });

  it('serves JSON output with correct headers', async () => {
    vi.mocked(shareService.validateShareToken).mockResolvedValue(MOCK_VALIDATED as any);
    vi.mocked(planningQueries.getOutput).mockResolvedValue({
      id: 'out-001',
      output_type: 'gtm_container',
      mime_type: 'application/json',
      content: { tags: [] },
      content_text: null,
    } as any);

    const res = await buildDevApp().get('/api/dev/valid-token/outputs/out-001/download');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment');
  });
});
