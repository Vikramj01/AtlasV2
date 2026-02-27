import { Request, Response, NextFunction } from 'express';
import { countAuditsThisMonth } from '@/services/database/queries';
import logger from '@/utils/logger';

const PLAN_LIMITS: Record<string, number> = {
  free: 2,
  pro: 20,
  agency: Infinity,
};

export async function auditLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id: user_id, plan } = req.user;
  const limit = PLAN_LIMITS[plan] ?? 2;

  if (limit === Infinity) {
    next();
    return;
  }

  const count = await countAuditsThisMonth(user_id);

  if (count >= limit) {
    logger.info({ user_id, plan, count, limit }, 'Audit limit reached');
    res.status(429).json({
      error: 'Monthly audit limit reached',
      limit,
      used: count,
      plan,
      upgrade_url: '/settings/billing',
    });
    return;
  }

  next();
}
