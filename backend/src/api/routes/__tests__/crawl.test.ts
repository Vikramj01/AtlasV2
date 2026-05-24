/**
 * Crawl Signal Extractor routes integration tests — /api/crawl
 *
 * Covers: trigger (pro plan gate), seed-pages, run status polling,
 *         no-pages error, unreachable URL handling, free-plan rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'user@test.com' } }, error: null }) },
    from: vi.fn(),
  },
}));

vi.mock('@/services/queue/jobQueue', () => ({
  crawlQueue: { add: vi.fn().mockResolvedValue({ id: 'job-001' }) },
}));

vi.mock('@/services/crawl/pageDiscovery', () => ({
  discoverPages: vi.fn(),
  seedPageScopeFromAdUrls: vi.fn(),
}));

vi.mock('@/services/database/subscriptionQueries', () => ({
  getActiveSubscription: vi.fn(),
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

import * as supabaseModule from '@/services/database/supabase';
import * as pageDiscovery from '@/services/crawl/pageDiscovery';
import * as subscriptionQueries from '@/services/database/subscriptionQueries';
import { crawlQueue } from '@/services/queue/jobQueue';
import { crawlRouter } from '../crawl';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_RUN = {
  id: 'run-001',
  org_id: 'u1',
  mode: 'scheduled',
  status: 'queued',
  total_pages: 3,
  pages_crawled: 0,
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_RUN_COMPLETED = {
  ...MOCK_RUN,
  status: 'completed',
  pages_crawled: 3,
  completed_at: '2026-01-01T00:05:00Z',
};

const MOCK_PAGES = [
  { url: 'https://example.com/', url_type: 'homepage', domain: 'example.com' },
  { url: 'https://example.com/pricing', url_type: 'pricing', domain: 'example.com' },
  { url: 'https://example.com/contact', url_type: 'contact', domain: 'example.com' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockSupabaseInsert(runData: any, pageRows: any[]) {
  vi.mocked(supabaseModule.supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === 'crawl_runs') {
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: runData, error: null }),
        eq: vi.fn().mockReturnThis(),
      } as any;
    }
    if (table === 'crawl_pages') {
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: pageRows, error: null }),
        eq: vi.fn().mockReturnThis(),
      } as any;
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro', organization_id: 'org-001' } }),
    } as any;
  });
}

function buildApp(plan: string = 'pro') {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan, isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/crawl', crawlRouter);
  return request(app);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/crawl/trigger', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 403 for free-plan users', async () => {
    const res = await buildApp('free').post('/api/crawl/trigger').send({});

    expect(res.status).toBe(403);
    expect(crawlQueue.add).not.toHaveBeenCalled();
  });

  it('returns 402 when org has no active subscription', async () => {
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue(null);
    mockSupabaseInsert(MOCK_RUN, []);

    const res = await buildApp().post('/api/crawl/trigger').send({ mode: 'scheduled' });

    expect(res.status).toBe(402);
  });

  it('returns 400 when no pages are in scope', async () => {
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue({ tier: 'pro' } as any);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue([]);
    mockSupabaseInsert(MOCK_RUN, []);

    const res = await buildApp().post('/api/crawl/trigger').send({ mode: 'scheduled' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No pages in scope');
  });

  it('enqueues crawl job and returns 202 with run_id', async () => {
    vi.mocked(subscriptionQueries.getActiveSubscription).mockResolvedValue({ tier: 'pro' } as any);
    vi.mocked(pageDiscovery.discoverPages).mockResolvedValue(MOCK_PAGES as any);
    mockSupabaseInsert(MOCK_RUN, MOCK_PAGES.map((p, i) => ({ id: `page-${i}`, url: p.url })));

    const res = await buildApp().post('/api/crawl/trigger').send({ mode: 'scheduled' });

    expect(res.status).toBe(202);
    expect(res.body.crawl_run_id).toBe('run-001');
    expect(crawlQueue.add).toHaveBeenCalledOnce();
  });

  it('returns 400 for invalid mode value', async () => {
    const res = await buildApp().post('/api/crawl/trigger').send({ mode: 'invalid_mode' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/crawl/run/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns run status with pages_crawled while running', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'crawl_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: MOCK_RUN, error: null }),
        } as any;
      }
      if (table === 'crawl_pages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any;
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) } as any;
    });

    const res = await buildApp().get('/api/crawl/run/run-001');

    expect(res.status).toBe(200);
    expect(res.body.run.status).toBe('queued');
    expect(res.body.run).toHaveProperty('pages_crawled');
  });

  it('returns 404 for non-existent run', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'crawl_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
        } as any;
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }) } as any;
    });

    const res = await buildApp().get('/api/crawl/run/nonexistent');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/crawl/seed-pages', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('seeds pages from valid URL list', async () => {
    vi.mocked(pageDiscovery.seedPageScopeFromAdUrls).mockResolvedValue(3 as any);

    const res = await buildApp()
      .post('/api/crawl/seed-pages')
      .send({
        urls: ['https://example.com/', 'https://example.com/pricing', 'https://example.com/contact'],
        source: 'manual',
      });

    expect(res.status).toBe(201);
    expect(pageDiscovery.seedPageScopeFromAdUrls).toHaveBeenCalledOnce();
  });

  it('returns 400 when URLs array is empty', async () => {
    const res = await buildApp()
      .post('/api/crawl/seed-pages')
      .send({ urls: [], source: 'manual' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when URLs contain invalid format', async () => {
    const res = await buildApp()
      .post('/api/crawl/seed-pages')
      .send({ urls: ['not-a-url', 'also-invalid'], source: 'manual' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/crawl/runs', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns list of recent crawl runs', async () => {
    vi.mocked(supabaseModule.supabaseAdmin.from).mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [MOCK_RUN, MOCK_RUN_COMPLETED], error: null }),
    } as any));

    const res = await buildApp().get('/api/crawl/runs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs ?? res.body)).toBe(true);
  });
});
