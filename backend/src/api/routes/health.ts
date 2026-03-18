/**
 * Health Dashboard API — /api/health
 *
 * GET  /api/health          — latest score + active alerts for the user
 * GET  /api/health/history  — time-series snapshots (last 30 days)
 * POST /api/health/compute  — manually trigger pipeline (debounced: once per 5 min)
 * POST /api/health/alerts/:alertId/acknowledge — mark alert as seen
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { healthQueue } from '@/services/queue/jobQueue';
import {
  getHealthScore,
  getActiveAlerts,
  getSnapshots,
  acknowledgeAlert,
} from '@/services/database/healthQueries';
import logger from '@/utils/logger';

export const healthRouter = Router();
healthRouter.use(authMiddleware);

// ── GET /api/health ───────────────────────────────────────────────────────────

healthRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const [score, alerts] = await Promise.all([
      getHealthScore(userId),
      getActiveAlerts(userId),
    ]);

    res.json({
      score,
      alerts,
      has_data: score !== null,
    });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/health/history ───────────────────────────────────────────────────

healthRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  try {
    const snapshots = await getSnapshots(userId, days);
    res.json({ snapshots });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/health/compute ──────────────────────────────────────────────────
// Enqueues a single-user health computation job.
// Simple debounce: rejects if a job for this user was queued in the last 5 min.

healthRouter.post('/compute', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const jobId = `health-manual-${userId}`;

    // Check if a job already exists
    const existing = await healthQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active') {
        res.status(202).json({ status: 'already_queued' });
        return;
      }
    }

    await healthQueue.add(
      { trigger: 'manual', user_id: userId },
      { jobId, attempts: 1, removeOnComplete: true },
    );

    logger.info({ userId }, 'Manual health computation enqueued');
    res.status(202).json({ status: 'queued' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/health/alerts/:alertId/acknowledge ──────────────────────────────

healthRouter.post(
  '/alerts/:alertId/acknowledge',
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user.id;
    const { alertId } = req.params;
    try {
      const ok = await acknowledgeAlert(alertId, userId);
      if (!ok) {
        res.status(404).json({ error: 'Alert not found' });
        return;
      }
      res.json({ acknowledged: true });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);
