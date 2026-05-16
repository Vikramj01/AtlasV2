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

// ── Finding status management (pro+) ─────────────────────────────────────────

const updateFindingSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'suppressed', 'open']),
  resolution_note: z.string().max(1000).optional(),
  suppressed_until: z.string().datetime().optional(),
});

const bulkActionSchema = z.object({
  finding_ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['acknowledge', 'resolve', 'suppress', 'reopen']),
  resolution_note: z.string().max(1000).optional(),
  suppressed_until: z.string().datetime().optional(),
});

// PATCH /api/ihc/findings/:id — update a single finding's status
ihcRouter.patch('/findings/:id', planGuard('pro'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = updateFindingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const update: Record<string, unknown> = {
    status: parsed.data.status,
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.resolution_note !== undefined) {
    update.resolution_note = parsed.data.resolution_note;
  }
  if (parsed.data.suppressed_until !== undefined) {
    update.suppressed_until = parsed.data.suppressed_until;
  }
  if (parsed.data.status === 'resolved') {
    update.resolved_at = new Date().toISOString();
  }
  if (parsed.data.status === 'open') {
    update.resolved_at = null;
  }

  const { data, error } = await supabaseAdmin
    .from('audit_findings')
    .update(update)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('id, status')
    .single();

  if (error || !data) {
    logger.error({ err: error?.message, id, orgId }, 'ihc/findings PATCH: DB error');
    res.status(error ? 500 : 404).json({ error: error?.message ?? 'Finding not found' });
    return;
  }

  res.json({ data, message: `Finding ${parsed.data.status}` });
});

// POST /api/ihc/findings/bulk — bulk status update
ihcRouter.post('/findings/bulk', planGuard('pro'), async (req: Request, res: Response) => {
  const parsed = bulkActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const actionToStatus = {
    acknowledge: 'acknowledged',
    resolve: 'resolved',
    suppress: 'suppressed',
    reopen: 'open',
  } as const;

  const status = actionToStatus[parsed.data.action];
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.resolution_note !== undefined) update.resolution_note = parsed.data.resolution_note;
  if (parsed.data.suppressed_until !== undefined) update.suppressed_until = parsed.data.suppressed_until;
  if (status === 'resolved') update.resolved_at = new Date().toISOString();
  if (status === 'open') update.resolved_at = null;

  const { data, error } = await supabaseAdmin
    .from('audit_findings')
    .update(update)
    .in('id', parsed.data.finding_ids)
    .eq('organization_id', orgId)
    .select('id');

  if (error) {
    logger.error({ err: error.message, orgId }, 'ihc/findings/bulk: DB error');
    res.status(500).json({ error: 'Bulk update failed' });
    return;
  }

  res.json({
    data: { updated: (data ?? []).length },
    message: `${(data ?? []).length} finding${(data ?? []).length !== 1 ? 's' : ''} ${status}`,
  });
});

// ── Preferences (pro+) ────────────────────────────────────────────────────────

const prefsSchema = z.object({
  email_critical_enabled: z.boolean().optional(),
  email_high_digest_enabled: z.boolean().optional(),
  email_medium_digest_enabled: z.boolean().optional(),
  email_low_enabled: z.boolean().optional(),
  daily_digest_hour: z.number().int().min(0).max(23).optional(),
  weekly_digest_day: z.number().int().min(1).max(7).optional(),
  weekly_digest_hour: z.number().int().min(0).max(23).optional(),
  critical_alert_batch_minutes: z.number().int().min(5).max(120).optional(),
  recipient_user_ids: z.array(z.string().uuid()).optional(),
  paused_properties: z.array(z.string()).optional(),
});

// GET /api/ihc/preferences
ihcRouter.get('/preferences', planGuard('pro'), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('ihc_alert_preferences')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message, orgId }, 'ihc/preferences GET: DB error');
    res.status(500).json({ error: 'Failed to load preferences' });
    return;
  }

  res.json({ data: data ?? null });
});

// PATCH /api/ihc/preferences
ihcRouter.patch('/preferences', planGuard('pro'), async (req: Request, res: Response) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const userId = req.user!.id;
  const orgId = await resolveOrgId(userId);
  if (!orgId) {
    res.status(404).json({ error: 'Organisation not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('ihc_alert_preferences')
    .upsert(
      { organization_id: orgId, ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' },
    )
    .select('*')
    .single();

  if (error) {
    logger.error({ err: error.message, orgId }, 'ihc/preferences PATCH: DB error');
    res.status(500).json({ error: 'Failed to save preferences' });
    return;
  }

  res.json({ data, message: 'Preferences saved' });
});
