/**
 * Rate limiter for Planning Mode session creation.
 * Free: 1 planning session/month
 * Pro: 10/month
 * Agency: unlimited
 *
 * Mirrors the pattern of auditLimiter.ts.
 */
import type { Request, Response, NextFunction } from 'express';
import { countPlanningSessionsThisMonth } from '@/services/database/planningQueries';
import logger from '@/utils/logger';

const PLAN_LIMITS: Record<string, number> = {
  free: 1,
  pro: 10,
  agency: Infinity,
};

export async function planningLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id: user_id, plan } = req.user!;
  const limit = PLAN_LIMITS[plan] ?? 1;

  if (limit === Infinity) {
    next();
    return;
  }

  const count = await countPlanningSessionsThisMonth(user_id);

  if (count >= limit) {
    logger.info({ user_id, plan, count, limit }, 'Planning session limit reached');
    res.status(429).json({
      error: 'Monthly planning session limit reached',
      limit,
      used: count,
      plan,
      upgrade_url: '/settings/billing',
    });
    return;
  }

  next();
}
