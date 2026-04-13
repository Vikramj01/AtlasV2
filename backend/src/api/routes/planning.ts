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
import rateLimit from 'express-rate-limit';
import { generateAllOutputs } from '@/services/planning/generators/outputGenerator';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { planningLimiter } from '../middleware/planningLimiter';
import { validateUrl, validateUrls } from '@/utils/urlValidator';
import { sendInternalError } from '@/utils/apiError';
import logger from '@/utils/logger';
import { planningQueue } from '@/services/queue/jobQueue';
import { detectSite } from '@/services/planning/siteDetectionService';
import { detectPiiWarnings } from '@/services/planning/piiDetectionService';
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
  createRecommendations,
  updateRecommendationDecision,
  getApprovedRecommendations,
  getOutputs,
  getOutput,
  deleteSession,
} from '@/services/database/planningQueries';
import type { CreateRecommendationInput } from '@/services/database/planningQueries';
import { getScreenshotSignedUrl } from '@/services/database/supabase';
import {
  createJourney,
  updateJourney,
  upsertStage,
  upsertPlatforms,
} from '@/services/database/journeyQueries';
import type { Platform as JourneyPlatform } from '@/types/journey';
import type { CreateSessionInput, UpdateDecisionInput } from '@/types/planning';

const router = Router();
router.use(authMiddleware, planGuard('pro'));

// ── Rate limiter for site detection (10 req/min per user) ────────────────────
const detectRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many detection requests. Please wait a minute.' }),
});

// ── POST /api/planning/detect ─────────────────────────────────────────────────
// Lightweight site detection — no Browserbase, no AI.
// Returns platform, business type, and existing tracking in ~2 seconds.

router.post('/detect', detectRateLimit, async (req: Request, res: Response) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: `Invalid URL: ${urlValidation.error}` });
    }

    const detection = await detectSite(url);
    res.json(detection);
  } catch (err) {
    // Detection failures are non-fatal — return a structured error so the frontend
    // can fall back to the manual form gracefully.
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ url: req.body?.url, err: message }, 'Site detection failed');
    res.status(422).json({ error: `Detection failed: ${message}` });
  }
});

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

    // Validate all URLs before touching the DB or enqueueing
    const websiteUrlResult = validateUrl(website_url);
    if (!websiteUrlResult.valid) {
      return res.status(400).json({ error: `Invalid website_url: ${websiteUrlResult.error}` });
    }

    const pageUrlError = validateUrls(normalizedPages.map((p) => p.url));
    if (pageUrlError) {
      return res.status(400).json({ error: `Invalid page URL: ${pageUrlError}` });
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
    sendInternalError(res, err);
  }
});

// ── GET /api/planning/sessions ────────────────────────────────────────────────

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await listSessions(req.user!.id);
    res.json({ sessions });
  } catch (err) {
    sendInternalError(res, err);
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
    sendInternalError(res, err);
  }
});

// ── PATCH /api/planning/sessions/:id ─────────────────────────────────────────
// Update mutable fields on a planning session.
// Currently supports: consent_config_id (set or clear).

router.patch('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { consent_config_id } = req.body as { consent_config_id?: string | null };

    const { error } = await (await import('@/services/database/supabase'))
      .supabaseAdmin
      .from('planning_sessions')
      .update({ consent_config_id: consent_config_id ?? null })
      .eq('id', session.id)
      .eq('user_id', req.user!.id);

    if (error) throw error;

    res.json({ updated: true });
  } catch (err) {
    sendInternalError(res, err);
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
    sendInternalError(res, err);
  }
});

// ── POST /api/planning/sessions/:id/recommendations ───────────────────────────
// Create a single custom (manually-added) recommendation and mark it approved.

router.post('/sessions/:id/recommendations', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const body = req.body as Omit<CreateRecommendationInput, 'source'>;
    if (!body.page_id || !body.action_type || !body.event_name) {
      return res.status(400).json({ error: 'page_id, action_type, and event_name are required' });
    }

    const [rec] = await createRecommendations([
      {
        ...body,
        required_params: body.required_params ?? [],
        optional_params: body.optional_params ?? [],
        confidence_score: body.confidence_score ?? 1,
        business_justification: body.business_justification ?? `Manually added: ${body.event_name}`,
        affected_platforms: body.affected_platforms ?? [],
        source: 'manual',
      },
    ]);

    // Auto-approve manual recommendations
    const approved = await updateRecommendationDecision(rec.id, 'approved', undefined);
    res.status(201).json(approved);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PATCH /api/planning/sessions/:id/recommendations/:recId ──────────────────
// Record a user decision: approved / skipped / modified

router.patch('/sessions/:id/recommendations/:recId', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const rec = await getRecommendation(req.params.recId, session.id);
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
    sendInternalError(res, err);
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
    sendInternalError(res, err);
  }
});

// ── GET /api/planning/sessions/:id/outputs ────────────────────────────────────

router.get('/sessions/:id/outputs', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const outputs = await getOutputs(session.id);
    res.json({ outputs });
  } catch (err) {
    sendInternalError(res, err);
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
    sendInternalError(res, err);
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
          page_type: page.page_type ?? 'custom',
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

    // Link the journey back to its source planning session for the feedback loop
    await updateJourney(journey.id, req.user!.id, {
      source_planning_session_id: session.id,
    });

    res.json({ journey_id: journey.id, message: 'Journey created from planning session.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/planning/sessions/:id/pages/:pageId/screenshot ──────────────────
// Return a fresh signed URL for a page's screenshot (30-min expiry).

router.get('/sessions/:id/pages/:pageId/screenshot', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const page = await getPageWithSignedUrl(req.params.pageId, session.id);
    if (!page.screenshot_signed_url) {
      logger.warn({ pageId: req.params.pageId, hasStoragePath: !!page.screenshot_url }, '[screenshot] No signed URL available');
      return res.status(404).json({ error: 'No screenshot available for this page' });
    }

    res.json({ url: page.screenshot_signed_url, expires_in_seconds: 1800 });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/planning/sessions/:id/rescan ────────────────────────────────────
// Re-scan all pages and compare against existing approved recommendations.
// Enqueues a job on planningQueue with job_type: 'rescan'.
// Returns immediately; poll GET /changes for results.

router.post('/sessions/:id/rescan', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.status !== 'outputs_ready' && session.status !== 'review_ready') {
      return res.status(409).json({
        error: `Session must be in outputs_ready or review_ready state to re-scan. Current: ${session.status}`,
      });
    }

    const sessionAny = session as unknown as Record<string, unknown>;
    const currentRescan = sessionAny['rescan_results'] as { status?: string } | null;
    if (currentRescan?.status === 'scanning') {
      return res.status(409).json({ error: 'A re-scan is already in progress for this session.' });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await planningQueue.add({ session_id: session.id, job_type: 'rescan' } as any);

    res.json({ queued: true, session_id: session.id });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/planning/sessions/:id/changes ─────────────────────────────────────
// Returns the latest rescan_results, or { rescan_results: null } if no rescan done.

router.get('/sessions/:id/changes', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const sessionAny = session as unknown as Record<string, unknown>;
    res.json({
      rescan_results: sessionAny['rescan_results'] ?? null,
      last_rescan_at: sessionAny['last_rescan_at'] ?? null,
    });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/planning/sessions/:id/pii-warnings ───────────────────────────────
// Returns PII warnings for the session's approved recommendations.
// No new data is stored — this is a pure derivation from existing recommendations.

router.get('/sessions/:id/pii-warnings', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const allRecs = await getRecommendationsBySession(req.params.id);
    const approvedRecs = allRecs.filter(
      (r) => r.user_decision === 'approved' || r.user_decision === 'modified' || r.user_decision == null
    );

    const warnings = detectPiiWarnings(approvedRecs as Parameters<typeof detectPiiWarnings>[0]);
    res.json({ warnings });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/planning/sessions/:id ─────────────────────────────────────────

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    await deleteSession(session.id, req.user!.id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as planningRouter };
