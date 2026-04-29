/**
 * Integration tests for the Crawl API routes (/api/crawl)
 *
 * All external dependencies are mocked via Vitest:
 *   - Supabase (auth + all DB tables)
 *   - Bull crawlQueue
 *   - pageDiscovery helpers
 *   - subscriptionQueries
 *
 * Auth: every request includes `Authorization: Bearer test-token`.
 * The supabase auth mock always resolves with a fixed test user.
 *
 * Scenarios covered:
 *   POST /trigger
 *     1.  Returns 400 when mode is invalid
 *     2.  Returns 402 when no active subscription
 *     3.  Returns 400 when page scope is empty
 *     4.  Returns 202 with crawl_run_id and pages_queued on success
 *     5.  Queues job with correct org_id (never trusts body org_id)
 *     6.  Returns 500 when crawl_runs insert fails
 *
 *   POST /seed-pages
 *     7.  Returns 400 when urls array is missing
 *     8.  Returns 400 when a URL is invalid
 *     9.  Returns 201 with { seeded: N } on success
 *     10. Returns 500 when seedPageScopeFromAdUrls throws
 *
 *   GET /runs
 *     11. Returns array of runs for the authenticated org
 *     12. Returns empty array when no runs exist
 *
 *   GET /run/:crawl_run_id
 *     13. Returns 404 when run not found or wrong org
 *     14. Returns { run, pages } on success
 *
 *   GET /page-scope
 *     15. Returns active page scope for the org
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Request } from 'express';
import request from 'supertest';

// ── Module mocks (must be before imports that use them) ───────────────────────

// vi.hoisted ensures these are initialised before vi.mock() factories run
const mockFromFn  = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: { id: 'test-org-id', email: 'test@example.com' } },
    error: null,
  }),
);

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: mockGetUser },
    from: mockFromFn,
  },
}));

vi.mock('@/services/queue/jobQueue', () => ({
  crawlQueue: {
    add:   vi.fn().mockResolvedValue({ id: 'job-1' }),
    on:    vi.fn(),
    process: vi.fn(),
  },
}));

vi.mock('@/services/crawl/pageDiscovery', () => ({
  discoverPages:           vi.fn(),
  seedPageScopeFromAdUrls: vi.fn(),
}));

vi.mock('@/services/database/subscriptionQueries', () => ({
  getActiveSubscription: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { crawlRouter } from '../crawl';
import { crawlQueue } from '@/services/queue/jobQueue';
import * as pageDiscovery from '@/services/crawl/pageDiscovery';
import * as subscriptionQueries from '@/services/database/subscriptionQueries';

// ── Test app ──────────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/crawl', crawlRouter);
  return app;
}

/** Every request must carry this header so authMiddleware passes. */
const AUTH = { Authorization: 'Bearer test-token' };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SUB = { tier: 'monitor', org_id: 'test-org-id' };

const MOCK_PAGES = [
  { scope_id: 'scope-1', crawl_page_id: '', url: 'https://example.com/', domain: 'example.com', url_type: 'ad_destination', priority: 1 },
  { scope_id: 'scope-2', crawl_page_id: '', url: 'https://example.com/pricing', domain: 'example.com', url_type: 'ad_destination', priority: 0 },
];

const MOCK_RUN = {
  id: 'run-uuid',
  org_id: 'test-org-id',
  mode: 'onboarding',
  status: 'queued',
  triggered_by: 'manual',
  total_pages: 2,
  pages_completed: 0,
  pages_failed: 0,
  created_at: '2026-05-30T00:00:00Z',
};

const MOCK_PAGE_ROWS = [
  { id: 'cp-1', url: 'https://example.com/' },
  { id: 'cp-2', url: 'https://example.com/pricing' },
];

/**
 * Builds the supabase fluent mock for the `trigger` happy path.
 * Sequence of `.from()` calls:
 *   1. profiles → auth plan lookup (from authMiddleware)
 *   2. crawl_runs INSERT → returns MOCK_RUN
 *   3. crawl_pages INSERT → returns MOCK_PAGE_ROWS
 */
function mockSupabaseForTrigger() {
  let callCount = 0;
  mockFromFn.mockImplementation((table: string) => {
    callCount++;

    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }),
      };
    }

    if (table === 'crawl_runs') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: MOCK_RUN, error: null }),
          }),
        }),
      };
    }

    if (table === 'crawl_pages') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: MOCK_PAGE_ROWS, error: null }),
        }),
      };
    }

    return {};
  });
}

function mockSupabaseAuth() {
  mockFromFn.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }),
      };
    }
    return {};
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/crawl/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-org-id', email: 'test@example.com' } },
      error: null,
    });
  });

  it('returns 400 when mode is invalid', async () => {
    mockSupabaseAuth();
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'invalid_mode' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request body');
  });

  it('returns 402 when no active subscription exists', async () => {
    mockSupabaseAuth();
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(null);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'onboarding' });

    expect(res.status).toBe(402);
    expect(res.body.error).toContain('subscription');
  });

  it('returns 400 when page scope is empty', async () => {
    mockSupabaseAuth();
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(MOCK_SUB as ReturnType<typeof subscriptionQueries.getActiveSubscription> extends Promise<infer T> ? T : never);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue([]);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'onboarding' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No pages in scope');
  });

  it('returns 202 with crawl_run_id and pages_queued on success', async () => {
    mockSupabaseForTrigger();
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(MOCK_SUB as ReturnType<typeof subscriptionQueries.getActiveSubscription> extends Promise<infer T> ? T : never);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue(MOCK_PAGES);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'onboarding' });

    expect(res.status).toBe(202);
    expect(res.body.crawl_run_id).toBe('run-uuid');
    expect(res.body.pages_queued).toBe(2);
  });

  it('enqueues job using org_id from auth, not from request body', async () => {
    mockSupabaseForTrigger();
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(MOCK_SUB as ReturnType<typeof subscriptionQueries.getActiveSubscription> extends Promise<infer T> ? T : never);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue(MOCK_PAGES);

    const app = buildTestApp();
    await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'onboarding', org_id: 'attacker-org-id' }); // should be ignored

    const addCall = vi.mocked(crawlQueue.add).mock.calls[0][0] as { org_id: string };
    expect(addCall.org_id).toBe('test-org-id');
    expect(addCall.org_id).not.toBe('attacker-org-id');
  });

  it('backfills crawl_page_id before enqueuing', async () => {
    mockSupabaseForTrigger();
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(MOCK_SUB as ReturnType<typeof subscriptionQueries.getActiveSubscription> extends Promise<infer T> ? T : never);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue(MOCK_PAGES);

    const app = buildTestApp();
    await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'onboarding' });

    const jobData = vi.mocked(crawlQueue.add).mock.calls[0][0] as { pages: typeof MOCK_PAGES };
    // All pages must have a non-empty crawl_page_id
    expect(jobData.pages.every(p => p.crawl_page_id !== '')).toBe(true);
    expect(jobData.pages[0].crawl_page_id).toBe('cp-1');
    expect(jobData.pages[1].crawl_page_id).toBe('cp-2');
  });

  it('returns 500 when crawl_runs insert fails', async () => {
    mockSupabaseAuth();
    // Override crawl_runs to return an error
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }),
        };
      }
      if (table === 'crawl_runs') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'insert error' } }),
            }),
          }),
        };
      }
      return {};
    });
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(MOCK_SUB as ReturnType<typeof subscriptionQueries.getActiveSubscription> extends Promise<infer T> ? T : never);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue(MOCK_PAGES);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/trigger')
      .set(AUTH)
      .send({ mode: 'onboarding' });

    expect(res.status).toBe(500);
  });
});

// ── POST /seed-pages ──────────────────────────────────────────────────────────

describe('POST /api/crawl/seed-pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-org-id', email: 'test@example.com' } },
      error: null,
    });
    mockSupabaseAuth();
  });

  it('returns 400 when urls is missing', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/seed-pages')
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request body');
  });

  it('returns 400 when a URL is not valid', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/seed-pages')
      .set(AUTH)
      .send({ urls: ['not-a-url'] });

    expect(res.status).toBe(400);
  });

  it('returns 201 with seeded count on success', async () => {
    vi.mocked(pageDiscovery.seedPageScopeFromAdUrls).mockResolvedValue(undefined);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/seed-pages')
      .set(AUTH)
      .send({ urls: ['https://example.com/page1', 'https://example.com/page2'], source: 'manual' });

    expect(res.status).toBe(201);
    expect(res.body.seeded).toBe(2);
  });

  it('calls seedPageScopeFromAdUrls with the authenticated org_id', async () => {
    vi.mocked(pageDiscovery.seedPageScopeFromAdUrls).mockResolvedValue(undefined);

    const app = buildTestApp();
    await request(app)
      .post('/api/crawl/seed-pages')
      .set(AUTH)
      .send({ urls: ['https://example.com/'], source: 'google_ads' });

    expect(vi.mocked(pageDiscovery.seedPageScopeFromAdUrls)).toHaveBeenCalledWith(
      'test-org-id',
      ['https://example.com/'],
      'google_ads',
    );
  });

  it('returns 500 when seedPageScopeFromAdUrls throws', async () => {
    vi.mocked(pageDiscovery.seedPageScopeFromAdUrls).mockRejectedValue(new Error('db error'));

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/crawl/seed-pages')
      .set(AUTH)
      .send({ urls: ['https://example.com/'] });

    expect(res.status).toBe(500);
  });
});

// ── GET /runs ─────────────────────────────────────────────────────────────────

describe('GET /api/crawl/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-org-id', email: 'test@example.com' } },
      error: null,
    });
  });

  it('returns an array of runs for the authenticated org', async () => {
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) };
      }
      if (table === 'crawl_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [MOCK_RUN], error: null }),
        };
      }
      return {};
    });

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/runs').set(AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('run-uuid');
  });

  it('returns empty array when no runs exist', async () => {
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) };
      }
      if (table === 'crawl_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {};
    });

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/runs').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── GET /run/:crawl_run_id ────────────────────────────────────────────────────

describe('GET /api/crawl/run/:crawl_run_id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-org-id', email: 'test@example.com' } },
      error: null,
    });
  });

  it('returns 404 when run not found or belongs to different org', async () => {
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) };
      }
      if (table === 'crawl_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        };
      }
      return {};
    });

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/run/nonexistent-id').set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Crawl run not found');
  });

  it('returns { run, pages } on success', async () => {
    const mockPages = [
      { id: 'cp-1', crawl_run_id: 'run-uuid', url: 'https://example.com/', status: 'completed', detected_signals: [] },
    ];

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) };
      }
      if (table === 'crawl_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_RUN, error: null }),
        };
      }
      if (table === 'crawl_pages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: mockPages, error: null }),
        };
      }
      return {};
    });

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/run/run-uuid').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe('run-uuid');
    expect(res.body.pages).toHaveLength(1);
    expect(res.body.pages[0].url).toBe('https://example.com/');
  });
});

// ── GET /page-scope ───────────────────────────────────────────────────────────

describe('GET /api/crawl/page-scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-org-id', email: 'test@example.com' } },
      error: null,
    });
  });

  it('returns active page scope for the org', async () => {
    const mockScope = [
      { id: 'scope-1', org_id: 'test-org-id', url: 'https://example.com/', domain: 'example.com', is_active: true, priority: 5 },
    ];

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) };
      }
      if (table === 'org_page_scope') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: mockScope, error: null }),
        };
      }
      return {};
    });

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/page-scope').set(AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].url).toBe('https://example.com/');
  });

  it('returns empty array when no scope entries exist', async () => {
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) };
      }
      if (table === 'org_page_scope') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {};
    });

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/page-scope').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── Auth enforcement ──────────────────────────────────────────────────────────

describe('Auth enforcement', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/runs'); // no .set(AUTH)
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid token' } });
    mockFromFn.mockReturnValue({});

    const app = buildTestApp();
    const res = await request(app).get('/api/crawl/runs').set({ Authorization: 'Bearer bad-token' });
    expect(res.status).toBe(401);
  });
});
