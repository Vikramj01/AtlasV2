/**
 * Developer Portal routes
 *
 * Two groups of endpoints:
 *
 * 1. Share management (JWT-protected, owner only):
 *    POST   /api/planning/sessions/:id/share
 *    GET    /api/planning/sessions/:id/share
 *    DELETE /api/planning/sessions/:id/share/:shareId
 *    GET    /api/planning/sessions/:id/progress
 *
 * 2. Developer portal (public, share-token auth):
 *    GET    /api/dev/:shareToken
 *    PATCH  /api/dev/:shareToken/pages/:pageId/status
 *    GET    /api/dev/:shareToken/outputs/:outputId/download
 *
 * The /api/dev/* endpoints do NOT require a JWT. They authenticate via the
 * share token itself. The backend validates: exists, is_active, not expired.
 * supabaseAdmin is used throughout (no user JWT context on public routes).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { env } from '@/config/env';
import {
  generateShareToken,
  validateShareToken,
  listSharesForSession,
  revokeShare,
  aggregateProgress,
  updatePageStatus,
} from '@/services/developer/shareService';
import { runQuickCheck } from '@/services/developer/quickCheckService';
import { initProgressForShare } from '@/services/database/developerQueries';
import {
  getSession,
  getPagesBySession,
  getOutput,
  getOutputs,
} from '@/services/database/planningQueries';

// ── Rate limiter for public developer portal endpoints ────────────────────────
// Separate from the global limiter since these routes have no JWT.

const devPortalLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many requests. Please slow down.' }),
});

// ── Rate limiter for quick checks (20/hour per share token) ───────────────────
// Quick checks spin up a full Browserbase session — higher cost than reads.

const quickCheckLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hour
  max: 20,
  keyGenerator: (req) => (req.params as { shareToken?: string }).shareToken ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) =>
    res.status(429).json({ error: 'Quick check limit reached (20/hour). Please wait before checking again.' }),
});

// ── Router: share management (JWT-protected) ──────────────────────────────────

const shareRouter = Router({ mergeParams: true });
shareRouter.use(authMiddleware);

// POST /api/planning/sessions/:id/share — generate a share token
shareRouter.post('/', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const pages = await getPagesBySession(session.id);

    const result = await generateShareToken(session.id, req.user!.id, env.FRONTEND_URL);

    // Initialise progress rows for every page (all start as 'not_started')
    await initProgressForShare(result.share_id, pages.map((p) => p.id));

    res.status(201).json(result);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// GET /api/planning/sessions/:id/share — list active shares
shareRouter.get('/', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const shares = await listSharesForSession(session.id, req.user!.id);
    res.json({ shares });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// DELETE /api/planning/sessions/:id/share/:shareId — revoke a share link
shareRouter.delete('/:shareId', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const ok = await revokeShare(req.params.shareId, req.user!.id);
    if (!ok) return res.status(404).json({ error: 'Share not found' });

    res.json({ revoked: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// GET /api/planning/sessions/:id/progress — get implementation progress summary
shareRouter.get('/progress', async (req: Request, res: Response) => {
  try {
    const session = await getSession(req.params.id, req.user!.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const shares = await listSharesForSession(session.id, req.user!.id);
    if (shares.length === 0) {
      return res.json({ has_share: false, progress: null });
    }

    // Use the most recent active share
    const progress = await aggregateProgress(shares[0].id);
    res.json({ has_share: true, share_id: shares[0].id, progress });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── Router: developer portal (public, token-auth) ────────────────────────────

const devRouter = Router();
devRouter.use(devPortalLimiter);

// Helper: validate token or return 401
async function requireToken(token: string, res: Response) {
  const validated = await validateShareToken(token);
  if (!validated) {
    res.status(401).json({ error: 'Invalid or expired share link.' });
    return null;
  }
  return validated;
}

// GET /api/dev/:shareToken — full developer portal payload
devRouter.get('/:shareToken', async (req: Request, res: Response) => {
  try {
    const validated = await requireToken(req.params.shareToken, res);
    if (!validated) return;

    const [session, pages, outputs] = await Promise.all([
      getSession(validated.session_id, validated.user_id),
      getPagesBySession(validated.session_id),
      getOutputs(validated.session_id),
    ]);

    if (!session) return res.status(404).json({ error: 'Session not found' });

    const progress = await aggregateProgress(validated.share_id);

    // Build a map of page_id → status for easy lookup
    const statusMap = new Map(progress.pages.map((p) => [p.page_id, p]));

    // Extract datalayer spec content for each page
    const datalayerOutput = outputs.find((o) => o.output_type === 'datalayer_spec');
    const datalayerContent = datalayerOutput?.content as Record<string, unknown> | null;

    const portalPages = pages.map((page) => {
      const prog = statusMap.get(page.id);
      // Try to find per-page code from the datalayer spec output
      const pageCode = datalayerContent
        ? extractPageCode(datalayerContent, page.url)
        : null;

      return {
        page_id: page.id,
        page_url: page.url,
        page_label: page.page_title ?? page.url,
        page_type: page.page_type,
        datalayer_code: pageCode,
        status: prog?.status ?? 'not_started',
        developer_notes: prog?.developer_notes ?? null,
      };
    });

    res.json({
      session_id: session.id,
      site_url: session.website_url,
      site_title: session.website_url,
      prepared_by: validated.user_id, // Resolved to email on frontend via separate lookup
      generated_at: session.created_at,
      share_id: validated.share_id,
      pages: portalPages,
      outputs: outputs.map((o) => ({
        id: o.id,
        output_type: o.output_type,
        mime_type: o.mime_type,
      })),
      progress,
    });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// PATCH /api/dev/:shareToken/pages/:pageId/status — update page implementation status
devRouter.patch('/:shareToken/pages/:pageId/status', async (req: Request, res: Response) => {
  try {
    const validated = await requireToken(req.params.shareToken, res);
    if (!validated) return;

    const { status, developer_notes } = req.body as {
      status?: string;
      developer_notes?: string;
    };

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    await updatePageStatus(
      validated.share_id,
      req.params.pageId,
      status,
      developer_notes,
    );

    res.json({ updated: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid status')) {
      return res.status(400).json({ error: err.message });
    }
    sendInternalError(res, err);
  }
});

// GET /api/dev/:shareToken/outputs/:outputId/download — download output file
devRouter.get('/:shareToken/outputs/:outputId/download', async (req: Request, res: Response) => {
  try {
    const validated = await requireToken(req.params.shareToken, res);
    if (!validated) return;

    const output = await getOutput(req.params.outputId, validated.session_id);
    if (!output) return res.status(404).json({ error: 'Output not found' });

    if (output.content_text) {
      const ext = output.mime_type.includes('html') ? 'html' : 'json';
      res.setHeader('Content-Type', output.mime_type);
      res.setHeader('Content-Disposition', `attachment; filename="atlas-${output.output_type}.${ext}"`);
      return res.send(output.content_text);
    }

    if (output.content) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="atlas-${output.output_type}.json"`);
      return res.json(output.content);
    }

    res.status(404).json({ error: 'Output has no content' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// POST /api/dev/:shareToken/pages/:pageId/quickcheck — live tracking verification
devRouter.post(
  '/:shareToken/pages/:pageId/quickcheck',
  quickCheckLimiter,
  async (req: Request, res: Response) => {
    try {
      const validated = await requireToken(req.params.shareToken, res);
      if (!validated) return;

      // Look up the page URL from the session so we don't trust client-supplied URLs
      const pages = await getPagesBySession(validated.session_id);
      const page = pages.find((p) => p.id === req.params.pageId);
      if (!page) return res.status(404).json({ error: 'Page not found in this share' });

      const result = await runQuickCheck(page.url);
      res.json(result);
    } catch (err) {
      // Quick check failures are non-fatal — return structured error
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: `Quick check failed: ${message}` });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractPageCode(
  datalayerContent: Record<string, unknown>,
  pageUrl: string,
): string | null {
  // The datalayer spec stores per-page code keyed by URL or page index.
  // Try a few common shapes from the generator.
  const pages = datalayerContent.pages as Array<{
    url?: string;
    page_url?: string;
    code?: string;
    dataLayer_code?: string;
    snippet?: string;
  }> | undefined;

  if (!Array.isArray(pages)) return null;

  const match = pages.find(
    (p) => p.url === pageUrl || p.page_url === pageUrl,
  );

  return match?.code ?? match?.dataLayer_code ?? match?.snippet ?? null;
}

export { shareRouter, devRouter };
