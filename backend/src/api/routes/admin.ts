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
import {
  getUsagePortfolio,
  getOrgDailyBreakdown,
  getOrgDomainBreakdown,
  getOrgAIBreakdown,
  getOrgRawEvents,
} from '@/services/database/usageQueries';
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

// ── Usage routes ──────────────────────────────────────────────────────────────

// GET /api/admin/usage?month=YYYY-MM — portfolio overview (all orgs, given month)
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const month = typeof req.query['month'] === 'string' ? req.query['month'] + '-01' : undefined;
    const portfolio = await getUsagePortfolio(month);
    res.json({ data: portfolio });
  } catch (err) {
    logger.error({ err }, 'Admin: failed to get usage portfolio');
    res.status(500).json({ error: 'Failed to fetch usage portfolio' });
  }
});

// GET /api/admin/usage/:orgId?month=YYYY-MM — per-org drill-down
router.get('/usage/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const month = typeof req.query['month'] === 'string' ? req.query['month'] + '-01' : undefined;
    const [daily, domains, ai_breakdown] = await Promise.all([
      getOrgDailyBreakdown(orgId),
      getOrgDomainBreakdown(orgId, month),
      getOrgAIBreakdown(orgId, month),
    ]);
    res.json({ data: { daily, domains, ai_breakdown } });
  } catch (err) {
    logger.error({ err, orgId: req.params['orgId'] }, 'Admin: failed to get org usage');
    res.status(500).json({ error: 'Failed to fetch org usage' });
  }
});

// GET /api/admin/usage/:orgId/events?page=1&type=page_scan&from=&to=
router.get('/usage/:orgId/events', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const page = parseInt(req.query['page'] as string ?? '1', 10);
    const type = req.query['type'] as string | undefined;
    const from = req.query['from'] as string | undefined;
    const to   = req.query['to']   as string | undefined;
    const result = await getOrgRawEvents(orgId, { page: isNaN(page) ? 1 : page, type, from, to });
    res.json({ data: result });
  } catch (err) {
    logger.error({ err, orgId: req.params['orgId'] }, 'Admin: failed to get org events');
    res.status(500).json({ error: 'Failed to fetch org events' });
  }
});

export { router as adminRouter };
