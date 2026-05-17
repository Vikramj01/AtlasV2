/**
 * Crawl Signal Extractor API — /api/crawl
 *
 * POST /api/crawl/trigger         — trigger a crawl for the authenticated org
 * POST /api/crawl/seed-pages      — seed org_page_scope from a URL list
 * GET  /api/crawl/runs            — last 10 crawl runs for this org
 * GET  /api/crawl/run/:id         — single run with pages + signals
 * GET  /api/crawl/page-scope      — active page scope for this org
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { crawlQueue } from '@/services/queue/jobQueue';
import { discoverPages, seedPageScopeFromAdUrls } from '@/services/crawl/pageDiscovery';
import { getActiveSubscription } from '@/services/database/subscriptionQueries';
import type { CrawlJobData } from '@/types/crawl';
import logger from '@/utils/logger';

export const crawlRouter = Router();
crawlRouter.use(authMiddleware);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const triggerSchema = z.object({
  mode: z.enum(['onboarding', 'scheduled']).default('scheduled'),
});

const seedPagesSchema = z.object({
  urls:   z.array(z.string().url({ message: 'Each URL must be a valid URL' })).min(1),
  source: z.enum(['google_ads', 'meta_ads', 'manual']).default('manual'),
});

// ── POST /api/crawl/trigger ───────────────────────────────────────────────────
// Queues a crawl run for the authenticated org.

crawlRouter.post('/trigger', planGuard('pro'), async (req: Request, res: Response): Promise<void> => {
  const parse = triggerSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const org_id = req.user.id;
  const { mode } = parse.data;

  try {
    // Get active subscription tier
    const sub = await getActiveSubscription(org_id);
    if (!sub) {
      res.status(402).json({ error: 'No active subscription found for this organisation.' });
      return;
    }

    // Discover pages within tier entitlement
    const pages = await discoverPages(org_id, sub.tier);
    if (!pages.length) {
      res.status(400).json({ error: 'No pages in scope. Add pages via POST /api/crawl/seed-pages first.' });
      return;
    }

    // Create the crawl_run record
    const { data: crawlRun, error: runError } = await supabaseAdmin
      .from('crawl_runs')
      .insert({
        org_id,
        mode,
        status:       'queued',
        triggered_by: 'manual',
        total_pages:  pages.length,
      })
      .select('id')
      .single();

    if (runError || !crawlRun) {
      throw new Error(`Failed to create crawl run: ${runError?.message}`);
    }

    // Insert crawl_pages rows and get their generated IDs back
    const { data: pageRows, error: pageError } = await supabaseAdmin
      .from('crawl_pages')
      .insert(
        pages.map(p => ({
          crawl_run_id: crawlRun.id,
          org_id,
          url:      p.url,
          url_type: p.url_type,
          domain:   p.domain,
          status:   'pending',
        })),
      )
      .select('id, url');

    if (pageError || !pageRows) {
      throw new Error(`Failed to create crawl pages: ${pageError?.message}`);
    }

    // Backfill crawl_page_id on each PageToScan using the generated IDs
    const urlToPageId = new Map(pageRows.map(r => [r.url as string, r.id as string]));
    const pagesWithIds = pages.map(p => ({
      ...p,
      crawl_page_id: urlToPageId.get(p.url) ?? '',
    }));

    const jobData: CrawlJobData = {
      org_id,
      crawl_run_id: crawlRun.id,
      mode,
      pages:        pagesWithIds,
      tier:         sub.tier,
    };

    await crawlQueue.add(jobData);

    logger.info({ org_id, crawl_run_id: crawlRun.id, pages: pages.length, mode }, 'Crawl queued');
    res.status(202).json({ crawl_run_id: crawlRun.id, pages_queued: pages.length });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/crawl/trigger');
  }
});

// ── POST /api/crawl/seed-pages ────────────────────────────────────────────────
// Seeds org_page_scope from a list of ad destination URLs.

crawlRouter.post('/seed-pages', async (req: Request, res: Response): Promise<void> => {
  const parse = seedPagesSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const org_id = req.user.id;
  const { urls, source } = parse.data;

  try {
    await seedPageScopeFromAdUrls(org_id, urls, source);
    logger.info({ org_id, count: urls.length, source }, 'Page scope seeded');
    res.status(201).json({ seeded: urls.length });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/crawl/seed-pages');
  }
});

// ── GET /api/crawl/runs ───────────────────────────────────────────────────────
// Returns the last 10 crawl runs for the authenticated org.

crawlRouter.get('/runs', async (req: Request, res: Response): Promise<void> => {
  const org_id = req.user.id;
  try {
    const { data, error } = await supabaseAdmin
      .from('crawl_runs')
      .select('*')
      .eq('org_id', org_id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);
    res.json(data ?? []);
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crawl/runs');
  }
});

// ── GET /api/crawl/run/:crawl_run_id ─────────────────────────────────────────
// Returns a single crawl run with its page results and detected signals.

crawlRouter.get('/run/:crawl_run_id', async (req: Request, res: Response): Promise<void> => {
  const org_id = req.user.id;
  const { crawl_run_id } = req.params;

  try {
    const { data: run, error: runError } = await supabaseAdmin
      .from('crawl_runs')
      .select('*')
      .eq('id', crawl_run_id)
      .eq('org_id', org_id)      // enforce ownership
      .single();

    if (runError || !run) {
      res.status(404).json({ error: 'Crawl run not found' });
      return;
    }

    const { data: pages, error: pagesError } = await supabaseAdmin
      .from('crawl_pages')
      .select('*, detected_signals(*)')
      .eq('crawl_run_id', crawl_run_id)
      .order('created_at', { ascending: true });

    if (pagesError) throw new Error(pagesError.message);

    res.json({ run, pages: pages ?? [] });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crawl/run/:crawl_run_id');
  }
});

// ── GET /api/crawl/page-scope ─────────────────────────────────────────────────
// Returns the active page scope for the authenticated org.

crawlRouter.get('/page-scope', async (req: Request, res: Response): Promise<void> => {
  const org_id = req.user.id;
  try {
    const { data, error } = await supabaseAdmin
      .from('org_page_scope')
      .select('*')
      .eq('org_id', org_id)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error) throw new Error(error.message);
    res.json(data ?? []);
  } catch (err) {
    sendInternalError(res, err, 'GET /api/crawl/page-scope');
  }
});
