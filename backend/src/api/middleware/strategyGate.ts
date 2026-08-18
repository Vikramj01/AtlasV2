import type { Request, Response, NextFunction } from 'express';

/**
 * strategyGate — no longer blocks. The strategy brief nudge is enforced purely
 * as a dismissible frontend banner (StrategyGateGuard); this middleware is kept
 * as a pass-through on its existing routes so route wiring doesn't need to change.
 * Applied to POST /api/planning/sessions, POST /api/journeys, POST client deploy.
 */
export async function strategyGate(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  next();
}
