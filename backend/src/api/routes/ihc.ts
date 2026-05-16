/**
 * IHC Findings — /api/ihc
 *
 * GET /api/ihc/findings          — full findings list (pro+)
 * GET /api/ihc/findings/summary  — severity counts only (free+, upsell hook)
 *
 * Free plan receives counts only; pro+ receives full finding detail.
 * Both endpoints require auth and resolve org_id from profiles.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
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
