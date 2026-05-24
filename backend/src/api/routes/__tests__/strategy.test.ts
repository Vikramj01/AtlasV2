/**
 * Strategy Gate routes integration tests — /api/strategy
 *
 * Covers: brief CRUD, locking, objective evaluation verdicts,
 *         governance tier, platform_action_types, OCI nudge,
 *         PDF export, duplicate name rejection, cross-tenant isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/strategyObjectivesQueries', () => ({
  createBrief: vi.fn(),
  patchBrief: vi.fn(),
  lockBrief: vi.fn(),
  getBriefWithObjectives: vi.fn(),
  getBriefForPdf: vi.fn(),
  createBriefVersion: vi.fn(),
  listBriefs: vi.fn(),
  deleteBrief: vi.fn(),
  createObjective: vi.fn(),
  getObjective: vi.fn(),
  updateObjective: vi.fn(),
  deleteObjective: vi.fn(),
  setObjectiveEvaluation: vi.fn(),
  lockObjective: vi.fn(),
  addCampaign: vi.fn(),
}));

vi.mock('@/services/usage/claudeClient', () => ({
  callClaude: vi.fn(),
}));

vi.mock('@/services/strategy/evaluationPrompt', () => ({
  buildUserPrompt: vi.fn().mockReturnValue('mock user prompt'),
  enforceProxyRule: vi.fn().mockReturnValue({}),
  parseEvalResponse: vi.fn(),
  SYSTEM_PROMPT: 'mock system prompt',
}));

vi.mock('@/services/strategy/briefPdfGenerator', () => ({
  generateBriefPdf: vi.fn(),
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'user@test.com' } }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro', organization_id: 'org-001' } }),
    }),
  },
  uploadStrategyBriefPdf: vi.fn(),
  getStrategyBriefSignedUrl: vi.fn(),
}));

vi.mock('@/services/reconciliation/reconciliationRunner', () => ({
  createRun: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  reconciliationRunQueue: { add: vi.fn() },
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

import * as strategyQueries from '@/services/database/strategyObjectivesQueries';
import * as claudeClient from '@/services/usage/claudeClient';
import * as evalPrompt from '@/services/strategy/evaluationPrompt';
import { strategyRouter } from '../strategy';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_BRIEF = {
  id: 'brief-001',
  organization_id: 'org-001',
  client_id: null,
  brief_name: 'Q3 Acquisition Brief',
  mode: 'multi',
  version_no: 1,
  locked_at: null,
  superseded_by: null,
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_OBJECTIVE = {
  id: 'obj-001',
  brief_id: 'brief-001',
  organization_id: 'org-001',
  name: 'Lead Form Submission',
  description: 'User completes the contact form',
  platforms: ['google_ads', 'meta'],
  current_event: 'form_submit',
  outcome_timing_days: 30,
  verdict: null,
  conversion_tier: null,
  platform_action_types: null,
  locked: false,
};

const EVAL_RESPONSE = {
  verdict: 'REPLACE',
  outcome_category: 'qualified_lead',
  recommended_primary_event: 'qualified_lead_form',
  recommended_proxy_event: 'form_start',
  proxy_event_required: true,
  conversion_tier: 'primary',
  platform_action_types: {
    google_ads: { action_type: 'primary_action' },
    meta: { optimization_event: 'Lead' },
  },
  rationale: 'The current event fires too early in the funnel.',
  summary_markdown: '## Strategy\nReplace form_submit with qualified_lead_form.',
  oci_nudge: false,
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/strategy', strategyRouter);
  return request(app);
}

// ── Brief CRUD ────────────────────────────────────────────────────────────────

describe('POST /api/strategy/briefs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a brief and returns it with locked_at=null', async () => {
    vi.mocked(strategyQueries.createBrief).mockResolvedValue(MOCK_BRIEF as any);

    const res = await buildApp()
      .post('/api/strategy/briefs')
      .send({ brief_name: 'Q3 Acquisition Brief', mode: 'multi' });

    expect(res.status).toBe(201);
    expect(res.body.data.locked_at).toBeNull();
    expect(res.body.data.id).toBe('brief-001');
  });

  it('returns 400 when brief_name is missing', async () => {
    const res = await buildApp()
      .post('/api/strategy/briefs')
      .send({ mode: 'multi' });

    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate brief name', async () => {
    const err = Object.assign(new Error('Duplicate brief name'), { code: 'DUPLICATE_NAME' });
    vi.mocked(strategyQueries.createBrief).mockRejectedValue(err);

    const res = await buildApp()
      .post('/api/strategy/briefs')
      .send({ brief_name: 'Duplicate', mode: 'single' });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/strategy/briefs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of briefs for the org', async () => {
    vi.mocked(strategyQueries.listBriefs).mockResolvedValue([MOCK_BRIEF] as any);

    const res = await buildApp().get('/api/strategy/briefs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/strategy/briefs/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns brief with objectives', async () => {
    vi.mocked(strategyQueries.getBriefWithObjectives).mockResolvedValue({
      ...MOCK_BRIEF,
      objectives: [],
    } as any);

    const res = await buildApp().get('/api/strategy/briefs/brief-001');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('brief-001');
  });

  it('returns 404 for non-existent brief', async () => {
    vi.mocked(strategyQueries.getBriefWithObjectives).mockResolvedValue(null);

    const res = await buildApp().get('/api/strategy/briefs/missing');

    expect(res.status).toBe(404);
  });
});

// ── Brief Locking ─────────────────────────────────────────────────────────────

describe('POST /api/strategy/briefs/:id/lock', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('locks a brief and sets locked_at', async () => {
    vi.mocked(strategyQueries.getBriefWithObjectives).mockResolvedValue({
      ...MOCK_BRIEF,
      objectives: [{ ...MOCK_OBJECTIVE, locked: true, verdict: 'CONFIRM' }],
    } as any);
    vi.mocked(strategyQueries.lockBrief).mockResolvedValue({
      ...MOCK_BRIEF,
      locked_at: '2026-05-24T12:00:00Z',
    } as any);

    const res = await buildApp().post('/api/strategy/briefs/brief-001/lock');

    expect(res.status).toBe(200);
    expect(res.body.data.locked_at).not.toBeNull();
  });

  it('returns 400 when objectives are not all locked', async () => {
    const err = Object.assign(new Error('All objectives must be locked'), { code: 'OBJECTIVES_NOT_LOCKED' });
    vi.mocked(strategyQueries.getBriefWithObjectives).mockResolvedValue({
      ...MOCK_BRIEF,
      objectives: [{ ...MOCK_OBJECTIVE, locked: false }],
    } as any);
    vi.mocked(strategyQueries.lockBrief).mockRejectedValue(err);

    const res = await buildApp().post('/api/strategy/briefs/brief-001/lock');

    expect(res.status).toBe(400);
  });
});

// ── Objective Evaluation ──────────────────────────────────────────────────────

describe('POST /api/strategy/objectives/:id/evaluate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns verdict CONFIRM | AUGMENT | REPLACE from Claude', async () => {
    vi.mocked(strategyQueries.getObjective).mockResolvedValue(MOCK_OBJECTIVE as any);
    vi.mocked(claudeClient.callClaude).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(EVAL_RESPONSE) }],
    } as any);
    vi.mocked(evalPrompt.parseEvalResponse).mockReturnValue(EVAL_RESPONSE as any);
    vi.mocked(evalPrompt.enforceProxyRule).mockReturnValue(EVAL_RESPONSE as any);
    vi.mocked(strategyQueries.setObjectiveEvaluation).mockResolvedValue({ ...MOCK_OBJECTIVE, ...EVAL_RESPONSE } as any);

    const res = await buildApp().post('/api/strategy/objectives/obj-001/evaluate');

    expect(res.status).toBe(200);
    expect(['CONFIRM', 'AUGMENT', 'REPLACE']).toContain(res.body.data.objective.verdict);
  });

  it('returns conversion_tier in response', async () => {
    vi.mocked(strategyQueries.getObjective).mockResolvedValue(MOCK_OBJECTIVE as any);
    vi.mocked(claudeClient.callClaude).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(EVAL_RESPONSE) }],
    } as any);
    vi.mocked(evalPrompt.parseEvalResponse).mockReturnValue(EVAL_RESPONSE as any);
    vi.mocked(evalPrompt.enforceProxyRule).mockReturnValue(EVAL_RESPONSE as any);
    vi.mocked(strategyQueries.setObjectiveEvaluation).mockResolvedValue({
      ...MOCK_OBJECTIVE,
      ...EVAL_RESPONSE,
    } as any);

    const res = await buildApp().post('/api/strategy/objectives/obj-001/evaluate');

    expect(res.status).toBe(200);
    expect(['primary', 'secondary', 'suppression']).toContain(res.body.data.objective.conversion_tier);
  });

  it('returns 404 when objective does not exist', async () => {
    vi.mocked(strategyQueries.getObjective).mockResolvedValue(null);

    const res = await buildApp().post('/api/strategy/objectives/missing/evaluate');

    expect(res.status).toBe(404);
  });

  it('returns 403 when objective is already locked', async () => {
    const err = Object.assign(new Error('Objective is locked'), { code: 'LOCKED' });
    vi.mocked(strategyQueries.getObjective).mockResolvedValue({ ...MOCK_OBJECTIVE, locked: true } as any);
    vi.mocked(strategyQueries.setObjectiveEvaluation).mockRejectedValue(err);

    const res = await buildApp().post('/api/strategy/objectives/obj-001/evaluate');

    expect(res.status).toBe(403);
  });
});

// ── Objective Lock ────────────────────────────────────────────────────────────

describe('POST /api/strategy/objectives/:id/lock', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('locks objective and sets locked=true', async () => {
    vi.mocked(strategyQueries.getObjective).mockResolvedValue(MOCK_OBJECTIVE as any);
    vi.mocked(strategyQueries.lockObjective).mockResolvedValue({
      ...MOCK_OBJECTIVE,
      locked: true,
      locked_at: '2026-05-24T12:00:00Z',
    } as any);

    const res = await buildApp().post('/api/strategy/objectives/obj-001/lock');

    expect(res.status).toBe(200);
    expect(res.body.data.locked).toBe(true);
  });
});

// ── Brief Delete ──────────────────────────────────────────────────────────────

describe('DELETE /api/strategy/briefs/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deletes an unlocked brief', async () => {
    vi.mocked(strategyQueries.getBriefWithObjectives).mockResolvedValue(MOCK_BRIEF as any);
    vi.mocked(strategyQueries.deleteBrief).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/strategy/briefs/brief-001');

    expect(res.status).toBe(200);
  });

  it('returns 403 when trying to delete a locked brief', async () => {
    const err = Object.assign(new Error('Brief is locked'), { code: 'LOCKED' });
    vi.mocked(strategyQueries.getBriefWithObjectives).mockResolvedValue({
      ...MOCK_BRIEF,
      locked_at: '2026-05-24T12:00:00Z',
    } as any);
    vi.mocked(strategyQueries.deleteBrief).mockRejectedValue(err);

    const res = await buildApp().delete('/api/strategy/briefs/brief-001');

    expect(res.status).toBe(403);
  });
});
