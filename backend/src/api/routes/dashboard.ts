/**
 * Action Dashboard API — /api/dashboard
 *
 * GET /api/dashboard           — returns DashboardResponse with summary metrics and prioritised action cards
 * GET /api/dashboard/atlas-score — composite AtlasScore (overall + three sub-scores)
 * GET /api/dashboard/next-action — single highest-priority next action for the user
 * GET /api/dashboard/setup-progress — which SET UP sidebar steps are complete
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { buildDashboard } from '@/services/dashboard/dashboardService';
import { buildAtlasScore } from '@/services/dashboard/atlasScoreService';
import { buildNextAction } from '@/services/dashboard/nextActionService';
import { getRecentActivity } from '@/services/dashboard/activityService';
import { getSetupProgress } from '@/services/dashboard/setupProgressService';
import { getDashboardSummary } from '@/services/dashboard/dashboardSummaryService';
import { supabaseAdmin } from '@/services/database/supabase';
import { z } from 'zod';

export const dashboardRouter = Router();
dashboardRouter.use(authMiddleware);

// ── GET /api/dashboard ────────────────────────────────────────────────────────

dashboardRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const dashboard = await buildDashboard(userId);
    res.json(dashboard);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/dashboard/atlas-score ───────────────────────────────────────────

dashboardRouter.get('/atlas-score', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const score = await buildAtlasScore(userId);
    res.json({ data: score, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/dashboard/next-action ───────────────────────────────────────────

dashboardRouter.get('/next-action', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const skipStrategy = req.query.skip_strategy === '1';
  try {
    const action = await buildNextAction(userId, skipStrategy);
    res.json({ data: action, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/dashboard/activity ───────────────────────────────────────────────

dashboardRouter.get('/activity', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const activity = await getRecentActivity(userId);
    res.json({ data: activity, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/dashboard/setup-progress ────────────────────────────────────────

dashboardRouter.get('/setup-progress', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const progress = await getSetupProgress(userId);
    res.json({ data: progress, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/dashboard/summary ────────────────────────────────────────────────

dashboardRouter.get('/summary', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const sinceParam = typeof req.query['since'] === 'string' ? req.query['since'] : null;
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id, previous_login_at')
      .eq('id', userId)
      .single();

    if (!profile) {
      res.status(404).json({ data: null, error: 'Profile not found', message: null });
      return;
    }

    const orgId = (profile as { organization_id: string }).organization_id;
    const previousLogin = (profile as { previous_login_at: string | null }).previous_login_at;
    const since = sinceParam ?? previousLogin;

    const summary = await getDashboardSummary(orgId, userId, since);
    res.json({ data: summary, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/dashboard/alerts/review ────────────────────────────────────────

const reviewSchema = z.object({
  reviews: z.array(z.object({
    source_table: z.enum(['audit_findings', 'reconciliation_findings', 'dqm_gtg_checks', 'health_drop']),
    source_id: z.string().min(1),
  })).min(1).max(50),
});

dashboardRouter.post('/alerts/review', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: parsed.error.errors[0]?.message ?? 'Invalid request', message: null });
    return;
  }

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();

    if (!profile) {
      res.status(404).json({ data: null, error: 'Profile not found', message: null });
      return;
    }

    const orgId = (profile as { organization_id: string }).organization_id;

    const rows = parsed.data.reviews.map((r) => ({
      organization_id: orgId,
      source_table: r.source_table,
      source_id: r.source_id,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    }));

    await supabaseAdmin
      .from('dashboard_alert_reviews')
      .upsert(rows, { onConflict: 'organization_id,source_table,source_id' });

    res.json({ data: { reviewed_count: rows.length }, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});
