/**
 * Planning Mode API routes — all endpoints under /api/planning
 *
 * All routes are protected by authMiddleware.
 * POST /sessions is additionally protected by planningLimiter.
 *
 * Follows the same structure as journeys.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateAllOutputs } from '@/services/planning/generators/outputGenerator';
import { authMiddleware } from '../middleware/authMiddleware';
import { planningLimiter } from '../middleware/planningLimiter';
import { planningQueue } from '@/services/queue/jobQueue';
import {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  createPage,
  getPagesBySession,
  getPageWithSignedUrl,
  getRecommendationsBySession,
  getRecommendation,
  updateRecommendationDecision,
  getApprovedRecommendations,
  getOutputs,
  getOutput,
} from '@/services/database/planningQueries';
import { getScreenshotSignedUrl } from '@/services/database/supabase';
import {
  createJourney,
  upsertStage,
  upsertPlatforms,
} from '@/services/database/journeyQueries';
import type { Platform as JourneyPlatform } from '@/types/journey';
import type { CreateSessionInput, UpdateDecisionInput } from '@/types/planning';

const router = Router();
router.use(authMiddleware);

// ── POST /api/planning/sessions ───────────────────────────────────────────────
// Create a planning session, persist pages, enqueue the scan job.
// Returns immediately with session_id + status.

router.post('/sessions', planningLimiter, async (req: Request, res: Response) => {
  try {
    const { website_url, business_type, business_description, selected_platforms, pages, page_urls } =
      req.body as CreateSessionInput & {
        pages?: Array<{ url: string; page_type?: string }>;
        page_urls?: string[];
      };

    if (!website_url || !business_type) {
      return res.status(400).json({ error: 'website_url and business_type are required' });
    }

    // Accept either `pages` (array of objects) or `page_urls` (array of strings)
    const normalizedPages: Array<{ url: string; page_type?: string }> =
      Array.isArray(pages) && pages.length > 0
        ? pages
        : Array.isArray(page_urls) && page_urls.length > 0
          ? page_urls.map((url) => ({ url }))
          : [];

    if (normalizedPages.length === 0) {
      return res.status(400).json({ error: 'At least one page URL is required' });
    }
    if (normalizedPages.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 pages per session (MVP limit)' });
    }

    const validBusinessTypes = ['ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'];
    if (!validBusinessTypes.includes(business_type)) {
      return res.status(400).json({ error: `business_type must be one of: ${validBusinessTypes.join(', ')}` });
    }

    const userId = req.user!.id;

    // Create session
    const session = await createSession(userId, {
      website_url,
      business_type: business_type as CreateSessionInput['business_type'],
      business_description,
      selected_platforms: selected_platforms ?? ['ga4'],
      pages: [],
    });

    // Create page records
    await Promise.all(
      normalizedPages.map((p, idx) =>
        createPage(session.id, p.url, p.page_type ?? 'custom', idx + 1),
      ),
    );

    // Enqueue the scan job
    await planningQueue.add({ session_id: session.id });

    res.status(201).json({
      session_id: session.id,
      status: session.status,
      website_url: session.website_url,
      business_type: session.business_type,
      page_count: normalizedPages.length,
      created_at: session.created_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ── GET /api/planning/sessions ────────────────────────────────────────────────

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await listSessions(req.user!.id);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── GET /api/planning/sessions/:id ───────────────────────────────────────────
// Returns session with its pages and scan progress.

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const pages = await getPagesBySession(session.id);

    const completed = pages.filter((p) => p.status === 'done').length;
    const failed = pages.filter((p) => p.status === 'failed').length;

    res.json({
      session,
      pages,
      progress: { total: pages.length, completed, failed },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── GET /api/planning/sessions/:id/recommendations ───────────────────────────
// Returns all recommendations for the session, grouped by page.

router.get('/sessions/:id/recommendations', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.status === 'scanning' || session.status === 'setup') {
      return res.status(202).json({
        message: 'Scan in progress. Poll GET /sessions/:id for status.',
        status: session.status,
      });
    }

    const recs = await getRecommendationsBySession(session.id);

    // Group by page_id for convenience
    const byPage: Record<string, typeof recs> = {};
    for (const rec of recs) {
      if (!byPage[rec.page_id]) byPage[rec.page_id] = [];
      byPage[rec.page_id].push(rec);
    }

    res.json({
      session_id: session.id,
      total: recs.length,
      recommendations: recs,
      by_page: byPage,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── PATCH /api/planning/sessions/:id/recommendations/:recId ──────────────────
// Record a user decision: approved / skipped / modified

router.patch('/sessions/:id/recommendations/:recId', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const rec = await getRecommendation(req.params.recId);
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });

    const { user_decision, modified_config } = req.body as UpdateDecisionInput;
    const validDecisions = ['approved', 'skipped', 'modified'];
    if (!validDecisions.includes(user_decision)) {
      return res.status(400).json({ error: `user_decision must be one of: ${validDecisions.join(', ')}` });
    }

    const updated = await updateRecommendationDecision(
      req.params.recId,
      user_decision,
      modified_config,
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── POST /api/planning/sessions/:id/generate ─────────────────────────────────
// Trigger output generation (GTM JSON, dataLayer spec, implementation guide).
// Stub for Sprint PM-3 — marks session as 'generating' and returns a placeholder.

router.post('/sessions/:id/generate', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.status !== 'review_ready' && session.status !== 'outputs_ready') {
      return res.status(409).json({
        error: `Session must be in review_ready state to generate outputs. Current status: ${session.status}`,
      });
    }

    const approved = await getApprovedRecommendations(session.id);
    if (approved.length === 0) {
      return res.status(400).json({
        error: 'No approved recommendations found. Approve at least one recommendation before generating outputs.',
      });
    }

    // Mark as generating before the (synchronous) generation run
    await updateSessionStatus(session.id, 'generating');

    const result = await generateAllOutputs(session);

    res.json({
      session_id: session.id,
      status: 'outputs_ready',
      outputs: result.outputs.map(o => ({
        id: o.id,
        type: o.output_type,
        mime_type: o.mime_type,
        version: o.version,
        generated_at: o.generated_at,
        download_url: `/api/planning/sessions/${session.id}/outputs/${o.id}/download`,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── GET /api/planning/sessions/:id/outputs ────────────────────────────────────

router.get('/sessions/:id/outputs', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const outputs = await getOutputs(session.id);
    res.json(outputs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── GET /api/planning/sessions/:id/outputs/:outputId/download ─────────────────

router.get('/sessions/:id/outputs/:outputId/download', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const output = await getOutput(req.params.outputId, session.id);
    if (!output) return res.status(404).json({ error: 'Output not found' });

    if (output.content_text) {
      res.setHeader('Content-Type', output.mime_type);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${output.output_type}.${output.mime_type.includes('html') ? 'html' : 'json'}"`,
      );
      return res.send(output.content_text);
    }

    if (output.content) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${output.output_type}.json"`);
      return res.json(output.content);
    }

    res.status(404).json({ error: 'Output has no content yet' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── POST /api/planning/sessions/:id/handoff ───────────────────────────────────
// Create a Journey in the Journey Builder matching the approved recommendations.
// User reviews the auto-created Journey before running an audit.
// Stub for Sprint PM-5 — handoff logic needs the output generators from PM-3.

router.post('/sessions/:id/handoff', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.status !== 'outputs_ready') {
      return res.status(409).json({
        error: `Session must be in outputs_ready state to hand off. Current status: ${session.status}`,
      });
    }

    // Load approved recommendations + scanned pages
    const [approvedRecs, pages] = await Promise.all([
      getApprovedRecommendations(session.id),
      getPagesBySession(session.id),
    ]);

    if (approvedRecs.length === 0) {
      return res.status(409).json({ error: 'No approved recommendations to hand off.' });
    }

    // Create a Journey in the Journey Builder
    const journey = await createJourney(req.user!.id, {
      name: `Tracking Plan — ${session.website_url}`,
      business_type: session.business_type as 'ecommerce' | 'saas' | 'lead_gen' | 'custom',
      implementation_format: 'gtm',
    });

    // Group approved recs by page (preserve page_order for stage_order)
    const pageMap = new Map(pages.map((p) => [p.id, p]));
    const recsByPage = new Map<string, typeof approvedRecs>();
    for (const rec of approvedRecs) {
      const list = recsByPage.get(rec.page_id) ?? [];
      list.push(rec);
      recsByPage.set(rec.page_id, list);
    }

    // Upsert one stage per page that has approved recs
    const pagesWithRecs = pages.filter((p) => recsByPage.has(p.id));
    await Promise.all(
      pagesWithRecs.map((page, idx) => {
        const recs = recsByPage.get(page.id) ?? [];
        return upsertStage(journey.id, {
          stage_order: idx + 1,
          label: page.page_title ?? `Page ${idx + 1}`,
          page_type: page.page_type ?? 'unknown',
          sample_url: page.url,
          actions: recs.map((r) => r.action_type),
        });
      }),
    );

    // Map planning platforms to journey platforms
    const platformMap: Record<string, JourneyPlatform> = {
      ga4:        'ga4',
      google_ads: 'google_ads',
      meta:       'meta',
      tiktok:     'tiktok',
      sgtm:       'sgtm',
    };
    const journeyPlatforms = (session.selected_platforms as string[])
      .filter((p) => platformMap[p])
      .map((p) => ({
        platform: platformMap[p],
        is_active: true,
        measurement_id: null as string | null,
        config: {} as Record<string, unknown>,
      }));

    if (journeyPlatforms.length > 0) {
      await upsertPlatforms(journey.id, { platforms: journeyPlatforms });
    }

    res.json({ journey_id: journey.id, message: 'Journey created from planning session.' });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// ── GET /api/planning/sessions/:id/pages/:pageId/screenshot ──────────────────
// Return a fresh signed URL for a page's screenshot (30-min expiry).

router.get('/sessions/:id/pages/:pageId/screenshot', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const page = await getPageWithSignedUrl(req.params.pageId);
    if (!page.screenshot_signed_url) {
      return res.status(404).json({ error: 'No screenshot available for this page' });
    }

    res.json({ signed_url: page.screenshot_signed_url, expires_in_seconds: 1800 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export { router as planningRouter };
