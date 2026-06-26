/**
 * IP-based rate limiter for the public (no-login) audit endpoint.
 * Uses two in-memory windows: 3 audits/hour, 10 audits/day.
 * IPs are never stored raw — the caller must hash before DB insertion.
 */
import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

function rateLimitHandler(_req: Request, res: Response): void {
  res.status(429).json({
    error: 'Too many audit requests. Please try again later.',
    retry_after: 3600,
  });
}

export const publicAuditHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.ip ?? 'unknown',
});

export const publicAuditDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.ip ?? 'unknown',
});
