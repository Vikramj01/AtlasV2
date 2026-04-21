/**
 * Action Dashboard API — /api/dashboard
 *
 * GET /api/dashboard           — returns DashboardResponse with summary metrics and prioritised action cards
 * GET /api/dashboard/atlas-score — composite AtlasScore (overall + three sub-scores)
 * GET /api/dashboard/next-action — single highest-priority next action for the user
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { buildDashboard } from '@/services/dashboard/dashboardService';
import { buildAtlasScore } from '@/services/dashboard/atlasScoreService';
import { buildNextAction } from '@/services/dashboard/nextActionService';
import { getRecentActivity } from '@/services/dashboard/activityService';

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
  try {
    const action = await buildNextAction(userId);
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
