/**
 * Campaign Signal Validator routes — /api/campaign-signal-validator
 *
 * In-app (authenticated, org-scoped):
 *   POST /scan          → run the diagnostic against a client's site
 *   GET  /runs           → list runs for the caller's org
 *   GET  /runs/:id        → fetch a specific run
 *
 * Standalone (public, paid — B9's second delivery surface):
 *   POST /checkout        → create a one-time Stripe Checkout Session
 *   GET  /purchases/:sessionId → poll purchase/run status after checkout
 *
 * Stripe fulfilment itself is handled by the existing /api/billing/webhook
 * handler (see checkoutService.fulfilSignalValidatorPurchase), not a route
 * here — that reuses the raw-body + signature verification already wired up
 * for billing.ts rather than standing up a second webhook endpoint.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { runDiagnostic, getRun, listRunsForOrg } from '@/services/campaignSignalValidator/orchestrator';
import { createSignalValidatorCheckout } from '@/services/campaignSignalValidator/checkoutService';
import { generateSignalValidatorPdf } from '@/services/campaignSignalValidator/pdfGenerator';
import { supabaseAdmin, getSignalValidatorPdfSignedUrl } from '@/services/database/supabase';
import { validateUrl } from '@/utils/urlValidator';
import { env } from '@/config/env';
import logger from '@/utils/logger';

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; plan: 'free' | 'pro' | 'agency'; isSuperAdmin: boolean };
}

async function resolveOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string | null } | null)?.organization_id ?? null;
}

const router = Router();

// Public endpoints are unauthenticated and paid-product-facing — same IP-based
// shape as publicAuditLimiter.ts, sized for a $650 purchase flow rather than a
// free scan (abuse risk is lower, but still worth capping).
function publicRateLimitHandler(_req: Request, res: Response): void {
  res.status(429).json({ error: 'Too many requests. Please try again later.' });
}

const publicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: publicRateLimitHandler,
  keyGenerator: (req) => req.ip ?? 'unknown',
});

// ─── In-app (authenticated) ─────────────────────────────────────────────────

const ScanBody = z.object({
  url: z.string(),
  client_id: z.string().uuid().optional().nullable(),
});

router.post('/scan', authMiddleware, async (req: Request, res: Response) => {
  const parsed = ScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' });
    return;
  }

  const urlCheck = validateUrl(parsed.data.url);
  if (!urlCheck.valid) {
    res.status(400).json({ error: urlCheck.error });
    return;
  }

  try {
    const authReq = req as AuthenticatedRequest;
    const organizationId = await resolveOrgId(authReq.user.id);
    if (!organizationId) {
      res.status(400).json({ error: 'No organisation found for this user' });
      return;
    }

    const result = await runDiagnostic({
      url: urlCheck.normalized!,
      source: 'in_app',
      organizationId,
      clientId: parsed.data.client_id ?? null,
    });

    res.json({ data: result });
  } catch (err) {
    logger.error({ err }, '[campaignSignalValidator] Scan failed');
    res.status(500).json({ error: 'Failed to run diagnostic' });
  }
});

router.get('/runs', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const organizationId = await resolveOrgId(authReq.user.id);
    if (!organizationId) {
      res.status(400).json({ error: 'No organisation found for this user' });
      return;
    }
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : null;
    const runs = await listRunsForOrg(organizationId, clientId);
    res.json({ data: runs });
  } catch (err) {
    logger.error({ err }, '[campaignSignalValidator] Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/runs/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const organizationId = await resolveOrgId(authReq.user.id);
    const run = await getRun(req.params.id);

    if (!run || (run as { organization_id: string | null }).organization_id !== organizationId) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json({ data: run });
  } catch (err) {
    logger.error({ err }, '[campaignSignalValidator] Failed to fetch run');
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

// On-demand PDF, generated per-request (not persisted) — mirrors audits.ts's
// export pattern rather than the standalone flow's storage+signed-URL path,
// since this is authenticated and always regenerable from the stored verdict.
router.get('/runs/:id/pdf', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const organizationId = await resolveOrgId(authReq.user.id);
    const run = await getRun(req.params.id);

    if (!run || (run as { organization_id: string | null }).organization_id !== organizationId) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const row = run as { url: string; verdict: unknown; status: string };
    if (row.status !== 'completed' || !row.verdict) {
      res.status(400).json({ error: 'Run has no completed verdict to export' });
      return;
    }

    const pdfBuffer = await generateSignalValidatorPdf({
      url: row.url,
      verdict: row.verdict as Parameters<typeof generateSignalValidatorPdf>[0]['verdict'],
      generatedAt: new Date(),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="atlas-signal-validator-${req.params.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err }, '[campaignSignalValidator] PDF export failed');
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

// ─── Standalone (public, paid) ──────────────────────────────────────────────

const CheckoutBody = z.object({
  url: z.string(),
  email: z.string().email(),
});

router.post('/checkout', publicLimiter, async (req: Request, res: Response) => {
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' });
    return;
  }

  const urlCheck = validateUrl(parsed.data.url);
  if (!urlCheck.valid) {
    res.status(400).json({ error: urlCheck.error });
    return;
  }

  try {
    const baseUrl = env.FRONTEND_URL;
    const result = await createSignalValidatorCheckout(
      urlCheck.normalized!,
      parsed.data.email,
      `${baseUrl}/tools/campaign-signal-validator/result/{CHECKOUT_SESSION_ID}`,
      `${baseUrl}/tools/campaign-signal-validator`,
    );
    res.json({ data: result });
  } catch (err) {
    logger.error({ err }, '[campaignSignalValidator] Checkout session creation failed');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.get('/purchases/:sessionId', publicLimiter, async (req: Request, res: Response) => {
  try {
    const { data: purchase } = await supabaseAdmin
      .from('signal_validator_purchases')
      .select('status, run_id')
      .eq('checkout_session_id', req.params.sessionId)
      .maybeSingle();

    if (!purchase) {
      res.status(404).json({ error: 'Purchase not found' });
      return;
    }

    const row = purchase as { status: string; run_id: string | null };
    const run = row.run_id ? await getRun(row.run_id) : null;
    const pdfPath = run ? (run as { pdf_storage_path: string | null }).pdf_storage_path : null;
    const pdf_url = pdfPath ? await getSignalValidatorPdfSignedUrl(pdfPath).catch(() => null) : null;

    res.json({ data: { status: row.status, run, pdf_url } });
  } catch (err) {
    logger.error({ err }, '[campaignSignalValidator] Failed to fetch purchase status');
    res.status(500).json({ error: 'Failed to fetch purchase status' });
  }
});

export { router as campaignSignalValidatorRouter };
