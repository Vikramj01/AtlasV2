/**
 * Action Dashboard API — /api/dashboard
 *
 * GET /api/dashboard — returns DashboardResponse with summary metrics
 *                      and prioritised action cards
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { buildDashboard } from '@/services/dashboard/dashboardService';

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
