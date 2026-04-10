import type { Request, Response, NextFunction } from 'express';

/**
 * planGuard — enforce a minimum plan tier on a route or router.
 *
 * Must be applied AFTER authMiddleware (requires req.user.plan).
 *
 * Plan hierarchy:  free (0) < pro (1) < agency (2)
 *
 * Usage:
 *   router.use(authMiddleware, planGuard('pro'));  // pro + agency
 *   router.use(authMiddleware, planGuard('agency')); // agency only
 *
 * On failure returns:
 *   403 { error, requiredPlan, currentPlan }
 */

const PLAN_RANK: Record<'free' | 'pro' | 'agency', number> = {
  free: 0,
  pro: 1,
  agency: 2,
};

export function planGuard(minPlan: 'pro' | 'agency') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const current = req.user.plan;
    if (PLAN_RANK[current] >= PLAN_RANK[minPlan]) {
      next();
      return;
    }
    res.status(403).json({
      error: `This feature requires the ${minPlan} plan or higher. You are on the ${current} plan.`,
      requiredPlan: minPlan,
      currentPlan: current,
    });
  };
}
