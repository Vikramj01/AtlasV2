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

// ── Rate limiter: 10 signups per IP per hour ──────────────────────────────────
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many signup attempts. Please try again later.' }),
});

// ── Rate limiter: 5 reset requests per IP per 15 minutes ─────────────────────
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many reset requests. Please wait 15 minutes and try again.' }),
});

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
//
// Creates a new user via the admin API with email_confirm: true so no
// confirmation email is required. Supabase's own SMTP is never involved.
// The frontend signs in normally after this returns 201.

router.post('/signup', signupLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalised = email.trim().toLowerCase();

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalised,
      password,
      email_confirm: true, // skip confirmation email entirely
    });

    if (error) {
      // Surface friendly errors for common cases
      if (error.message.toLowerCase().includes('already registered') ||
          error.message.toLowerCase().includes('already been registered') ||
          error.message.toLowerCase().includes('duplicate')) {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      logger.error({ email: normalised, error: error.message }, '[auth] signup failed');
      return res.status(400).json({ error: error.message });
    }

    logger.info({ userId: data.user?.id, email: normalised }, '[auth] User created');
    return res.status(201).json({ id: data.user?.id, email: data.user?.email });
  } catch (err) {
    logger.error({ err }, '[auth] Unexpected error in signup');
    return res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
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
