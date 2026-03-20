import { Request, Response, NextFunction } from 'express';
import { env } from '@/config/env';

/**
 * Must be applied AFTER authMiddleware (requires req.user).
 * Returns 403 if the authenticated user's email is not in ADMIN_EMAILS.
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_EMAILS.includes(req.user.email.toLowerCase())) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
