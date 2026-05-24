/**
 * Channel Insights routes integration tests — /api/channels
 *
 * Covers: overview, journeys, diagnostics, session ingestion,
 *         resolve diagnostic, compute trigger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/channelQueries', () => ({
  getChannelOverviews: vi.fn(),
  getJourneyMaps: vi.fn(),
  getJourneyMapByChannel: vi.fn(),
  getActiveDiagnostics: vi.fn(),
  getDistinctChannelSites: vi.fn(),
  resolveDiagnostic: vi.fn(),
}));

vi.mock('@/services/channels/sessionIngestion', () => ({
  ingestSession: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  channelQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
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

import * as channelQueries from '@/services/database/channelQueries';
import * as sessionIngestion from '@/services/channels/sessionIngestion';
import { channelsRouter } from '../channels';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_OVERVIEW = [
  {
    channel: 'paid_search',
    sessions: 1200,
    conversions: 85,
    health_score: 92,
    site: 'example.com',
  },
  {
    channel: 'organic_social',
    sessions: 450,
    conversions: 20,
    health_score: 78,
    site: 'example.com',
  },
];

const MOCK_DIAGNOSTIC = {
  id: 'diag-001',
  channel: 'paid_search',
  issue_type: 'missing_gclid',
  severity: 'critical',
  description: 'GCLID not captured on 12% of paid search sessions',
  status: 'active',
};

const MOCK_JOURNEY_MAP = {
  channel: 'paid_search',
  stages: [
    { name: 'Landing', count: 1200, drop_off_pct: 0 },
    { name: 'Product View', count: 900, drop_off_pct: 25 },
    { name: 'Add to Cart', count: 420, drop_off_pct: 53 },
    { name: 'Purchase', count: 85, drop_off_pct: 80 },
  ],
};

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/channels', channelsRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/channels/overview', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns channel overview with sessions, conversions, health_score', async () => {
    vi.mocked(channelQueries.getChannelOverviews).mockResolvedValue(MOCK_OVERVIEW as any);
    vi.mocked(channelQueries.getDistinctChannelSites).mockResolvedValue(['example.com'] as any);

    const res = await buildApp().get('/api/channels/overview');

    expect(res.status).toBe(200);
    expect(res.body.overviews).toHaveLength(2);
    expect(res.body.overviews[0]).toHaveProperty('sessions');
    expect(res.body.overviews[0]).toHaveProperty('conversions');
    expect(res.body.overviews[0]).toHaveProperty('health_score');
  });

  it('returns empty state for org with no data', async () => {
    vi.mocked(channelQueries.getChannelOverviews).mockResolvedValue([]);
    vi.mocked(channelQueries.getDistinctChannelSites).mockResolvedValue([]);

    const res = await buildApp().get('/api/channels/overview');

    expect(res.status).toBe(200);
    expect(res.body.has_data).toBe(false);
  });

  it('respects days query param (capped at 90)', async () => {
    vi.mocked(channelQueries.getChannelOverviews).mockResolvedValue([]);
    vi.mocked(channelQueries.getDistinctChannelSites).mockResolvedValue([]);

    await buildApp().get('/api/channels/overview?days=180');

    expect(channelQueries.getChannelOverviews).toHaveBeenCalledWith('u1', undefined, 90);
  });
});

describe('GET /api/channels/journeys', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns journey maps for all channels', async () => {
    vi.mocked(channelQueries.getJourneyMaps).mockResolvedValue([MOCK_JOURNEY_MAP] as any);

    const res = await buildApp().get('/api/channels/journeys');

    expect(res.status).toBe(200);
    expect(res.body.journeys).toHaveLength(1);
    expect(res.body.journeys[0].stages).toBeDefined();
  });
});

describe('GET /api/channels/journeys/:channel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns funnel stages with drop-off percentages for a channel', async () => {
    vi.mocked(channelQueries.getJourneyMapByChannel).mockResolvedValue(MOCK_JOURNEY_MAP as any);

    const res = await buildApp().get('/api/channels/journeys/paid_search');

    expect(res.status).toBe(200);
    expect(res.body.journey.stages).toHaveLength(4);
    expect(res.body.journey.stages[3].drop_off_pct).toBe(80);
  });

  it('returns 404 when channel has no data', async () => {
    vi.mocked(channelQueries.getJourneyMapByChannel).mockResolvedValue(null);

    const res = await buildApp().get('/api/channels/journeys/unknown_channel');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/channels/diagnostics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns active diagnostics with severity and issue type', async () => {
    vi.mocked(channelQueries.getActiveDiagnostics).mockResolvedValue([MOCK_DIAGNOSTIC] as any);

    const res = await buildApp().get('/api/channels/diagnostics');

    expect(res.status).toBe(200);
    expect(res.body.diagnostics ?? res.body).toBeDefined();
    const diagnostics = res.body.diagnostics ?? res.body;
    const d = Array.isArray(diagnostics) ? diagnostics[0] : diagnostics;
    expect(d).toHaveProperty('severity');
  });
});

describe('POST /api/channels/diagnostics/:id/resolve', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('marks diagnostic as resolved', async () => {
    vi.mocked(channelQueries.resolveDiagnostic).mockResolvedValue({
      ...MOCK_DIAGNOSTIC,
      status: 'resolved',
    } as any);

    const res = await buildApp().post('/api/channels/diagnostics/diag-001/resolve');

    expect(res.status).toBe(200);
    expect(channelQueries.resolveDiagnostic).toHaveBeenCalledWith('diag-001', 'u1');
  });
});

describe('POST /api/channels/ingest', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ingests a session with events', async () => {
    vi.mocked(sessionIngestion.ingestSession).mockResolvedValue({ session_id: 'sess-001' } as any);

    const res = await buildApp()
      .post('/api/channels/ingest')
      .send({
        session_id: 'sess-001',
        website_url: 'https://example.com',
        landing_page: '/home',
        channel: 'paid_search',
        events: [
          { event_name: 'page_view', timestamp: Date.now() },
          { event_name: 'add_to_cart', timestamp: Date.now() },
        ],
      });

    expect(res.status).toBe(201);
    expect(sessionIngestion.ingestSession).toHaveBeenCalledOnce();
  });

  it('returns 400 when session_id is missing', async () => {
    const res = await buildApp()
      .post('/api/channels/ingest')
      .send({ channel: 'organic', events: [] });

    expect(res.status).toBe(400);
  });
});
