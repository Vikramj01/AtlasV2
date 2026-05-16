/**
 * IHC — /api/ihc
 *
 * Findings:
 *   GET /api/ihc/findings          — full findings list (pro+)
 *   GET /api/ihc/findings/summary  — severity counts only (free+, upsell hook)
 *
 * Baseline management (pro+):
 *   GET  /api/ihc/baseline         — current baseline info for this org
 *   POST /api/ihc/baseline         — promote a crawl run to baseline
 *
 * Free plan receives counts only; pro+ receives full finding detail.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

export const ihcRouter = Router();
ihcRouter.use(authMiddleware);

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data.organization_id as string;
}

// ── GET /api/ihc/findings/summary  (free+) ───────────────────────────────────
// Returns open finding counts per severity — visible on all plans as an upsell hook.

ihcRouter.get('/findings/summary', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('audit_findings')
    .select('severity')
    .eq('organization_id', orgId)
    .eq('status', 'open');

  if (error) {
    logger.error({ err: error.message, orgId }, 'ihc/findings/summary: DB error');
    res.status(500).json({ error: 'Failed to fetch findings summary' });
    return;
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  for (const row of data ?? []) {
    const sev = row.severity as keyof typeof counts;
    if (sev in counts) counts[sev]++;
    counts.total++;
  }

  res.json({ data: counts });
});

// ── GET /api/ihc/findings  (pro+) ────────────────────────────────────────────
// Returns full finding details. Free plan users receive only the summary and an upgrade nudge.

ihcRouter.get('/findings', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isPro = req.user!.plan === 'pro' || req.user!.plan === 'agency' || req.user!.isSuperAdmin;

  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  // Free plan: return summary counts + upgrade nudge, no finding detail
  if (!isPro) {
    const { data: rows, error } = await supabaseAdmin
      .from('audit_findings')
      .select('severity')
      .eq('organization_id', orgId)
      .eq('status', 'open');

    if (error) {
      logger.error({ err: error.message, orgId }, 'ihc/findings: DB error (free summary)');
      res.status(500).json({ error: 'Failed to fetch findings' });
      return;
    }

    const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    for (const row of rows ?? []) {
      const sev = row.severity as keyof typeof counts;
      if (sev in counts) counts[sev]++;
      counts.total++;
    }

    res.json({
      data: null,
      summary: counts,
      upgrade_required: true,
      message: `${counts.total} open finding${counts.total !== 1 ? 's' : ''} detected. Upgrade to Pro to view details and remediation steps.`,
    });
    return;
  }

  // Pro+ plan: return full findings
  const { property_id } = req.query;

  let query = supabaseAdmin
    .from('audit_findings')
    .select('id, property_id, rule_id, validation_layer, severity, status, evidence, first_detected_at, last_seen_at, resolved_at')
    .eq('organization_id', orgId)
    .order('severity', { ascending: true })
    .order('last_seen_at', { ascending: false });

  if (typeof property_id === 'string') {
    query = query.eq('property_id', property_id);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ err: error.message, orgId }, 'ihc/findings: DB error');
    res.status(500).json({ error: 'Failed to fetch findings' });
    return;
  }

  res.json({ data: data ?? [] });
});

// ── Baseline management (pro+) ────────────────────────────────────────────────

const promoteBaselineSchema = z.object({
  crawl_run_id: z.string().uuid(),
});

// GET /api/ihc/baseline — current baseline info
ihcRouter.get('/baseline', planGuard('pro'), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const { getBaselineForOrg } = await import('@/services/ihc/baselineManager');
  const baseline = await getBaselineForOrg(orgId);

  res.json({ data: baseline });
});

// POST /api/ihc/baseline — promote a crawl run to baseline
ihcRouter.post('/baseline', planGuard('pro'), async (req: Request, res: Response) => {
  const parsed = promoteBaselineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'crawl_run_id (UUID) is required' });
    return;
  }

  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const { promoteToBaseline } = await import('@/services/ihc/baselineManager');
  const result = await promoteToBaseline(orgId, parsed.data.crawl_run_id);

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ data: { crawl_run_id: parsed.data.crawl_run_id }, message: 'Baseline updated' });
});
