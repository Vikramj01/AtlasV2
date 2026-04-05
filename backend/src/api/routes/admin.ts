import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { adminMiddleware } from '@/api/middleware/adminMiddleware';
import {
  getAdminStats,
  listAdminUsers,
  setUserPlan,
  getActivityFeed,
  getAdminAlerts,
  dismissAdminAlert,
  deleteUser,
} from '@/services/database/adminQueries';
import logger from '@/utils/logger';

const router = Router();

// All admin routes require auth + admin email check
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/me — lightweight check used by frontend to verify admin access
router.get('/me', (_req: Request, res: Response) => {
  res.json({ isAdmin: true });
});

// GET /api/admin/stats — system-wide overview
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getAdminStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Admin: failed to get stats');
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/users — all users with plan + usage counts
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await listAdminUsers();
    res.json({ users });
  } catch (err) {
    logger.error({ err }, 'Admin: failed to list users');
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PATCH /api/admin/users/:id/plan — change a user's plan
router.patch('/users/:id/plan', async (req: Request, res: Response) => {
  const { plan } = req.body as { plan?: string };
  if (!['free', 'pro', 'agency'].includes(plan ?? '')) {
    res.status(400).json({ error: 'plan must be one of: free, pro, agency' });
    return;
  }
  try {
    await setUserPlan(req.params.id, plan!);
    res.json({ updated: true });
  } catch (err) {
    logger.error({ err, userId: req.params.id }, 'Admin: failed to update user plan');
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// GET /api/admin/activity — recent audits + planning sessions across all users
router.get('/activity', async (_req: Request, res: Response) => {
  try {
    const items = await getActivityFeed();
    res.json({ items });
  } catch (err) {
    logger.error({ err }, 'Admin: failed to get activity feed');
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// GET /api/admin/alerts — all health alerts
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const alerts = await getAdminAlerts();
    res.json({ alerts });
  } catch (err) {
    logger.error({ err }, 'Admin: failed to get alerts');
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// DELETE /api/admin/users/:id — permanently delete a user and all their data
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    await deleteUser(req.params.id);
    logger.info({ userId: req.params.id }, 'Admin: user deleted');
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err, userId: req.params.id }, 'Admin: failed to delete user');
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// PATCH /api/admin/alerts/:id/dismiss — dismiss a health alert
router.patch('/alerts/:id/dismiss', async (req: Request, res: Response) => {
  try {
    await dismissAdminAlert(req.params.id);
    res.json({ dismissed: true });
  } catch (err) {
    logger.error({ err, alertId: req.params.id }, 'Admin: failed to dismiss alert');
    res.status(500).json({ error: 'Failed to dismiss alert' });
  }
});

export { router as adminRouter };
