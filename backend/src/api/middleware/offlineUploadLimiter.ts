/**
 * Rate limiter for the offline conversion CSV upload endpoint.
 *
 * Limits are enforced per authenticated user (org) to prevent abuse:
 *   - Free plan:   5 uploads per 15 minutes
 *   - Pro plan:    20 uploads per 15 minutes
 *   - Agency plan: unlimited
 *
 * Uses express-rate-limit with an in-process memory store keyed on
 * `${userId}:${plan}` so limits are per-org, not per-IP.
 *
 * This is intentionally stricter than the global API rate limiter
 * because file upload + CSV parsing is computationally expensive.
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const PLAN_MAX: Record<string, number> = {
  free:   5,
  pro:    20,
  agency: 1_000, // effectively unlimited
};

export const offlineUploadLimiter = rateLimit({
  windowMs: WINDOW_MS,
  // Dynamic limit based on the authenticated user's plan
  limit: (req: Request) => {
    const plan = req.user?.plan ?? 'free';
    return PLAN_MAX[plan] ?? PLAN_MAX.free;
  },
  // Key by user id — one counter per org, not per IP
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anonymous',
  standardHeaders: 'draft-7', // Return RateLimit-* headers
  legacyHeaders: false,
  message: {
    error: 'UPLOAD_RATE_LIMIT',
    message: 'Too many uploads. Please wait before uploading again.',
  },
  skip: (req: Request) => (req.user?.plan ?? 'free') === 'agency',
});
