/**
 * Auth routes — /api/auth
 *
 * These routes handle auth flows that need server-side logic unavailable on
 * the frontend (e.g. generating signed links via the admin API, sending emails
 * through our own Resend integration instead of Supabase's SMTP config).
 *
 * Public — no authMiddleware required.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '@/services/database/supabase';
import { sendPasswordResetEmail } from '@/services/email/emailService';
import { env } from '@/config/env';
import logger from '@/utils/logger';

const router = Router();

// ── Rate limiter: 5 reset requests per IP per 15 minutes ─────────────────────
// Prevents email enumeration / abuse without blocking legitimate use.

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many reset requests. Please wait 15 minutes and try again.' }),
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
//
// Generates a Supabase password-recovery link server-side (bypassing Supabase's
// own SMTP configuration entirely) and sends it via our direct Resend integration.
//
// Always returns 200 with the same message regardless of whether the email
// exists — prevents email enumeration.

router.post('/forgot-password', resetLimiter, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const normalised = email.trim().toLowerCase();

  // Always respond with this message — never leak whether an account exists.
  const OK_RESPONSE = { message: 'If an account exists for that email, a reset link has been sent.' };

  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalised,
      options: {
        redirectTo: `${env.FRONTEND_URL}/reset-password`,
      },
    });

    if (error || !data?.properties?.action_link) {
      // Log the real error server-side but don't expose it to the caller.
      logger.warn({ email: normalised, error: error?.message }, '[auth] generateLink failed or no account');
      return res.json(OK_RESPONSE);
    }

    const resetUrl = data.properties.action_link;

    const result = await sendPasswordResetEmail({ to: normalised, resetUrl });

    if (!result.ok) {
      logger.error({ email: normalised, error: result.error }, '[auth] Failed to send reset email via Resend');
      // Still return OK to avoid enumeration — but log so we can investigate.
    } else {
      logger.info({ email: normalised }, '[auth] Password reset email sent');
    }

    return res.json(OK_RESPONSE);
  } catch (err) {
    logger.error({ err }, '[auth] Unexpected error in forgot-password');
    return res.json(OK_RESPONSE);
  }
});

export { router as authRouter };
