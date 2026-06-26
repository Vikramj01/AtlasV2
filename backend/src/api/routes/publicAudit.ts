/**
 * Public Audit Routes — no authentication required.
 * Rate-limited by IP (publicAuditLimiter).
 *
 * POST /api/public/audit              Submit a URL for auditing
 * GET  /api/public/audit/:token       Poll status / fetch results
 * POST /api/public/audit/:token/email Capture email for CTA
 */
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { supabaseAdmin } from '@/services/database/supabase';
import { publicAuditQueue } from '@/services/queue/jobQueue';
import { publicAuditHourlyLimiter, publicAuditDailyLimiter } from '@/api/middleware/publicAuditLimiter';
import { sendPublicAuditLeadNotification, sendPublicAuditReportEmail } from '@/services/email/emailService';
import { env } from '@/config/env';
import logger from '@/utils/logger';

export const publicAuditRouter = Router();

// ── Validation ────────────────────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
];

function isPrivateOrLocalhost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some(p => p.test(hostname));
}

const SubmitSchema = z.object({
  url: z.string().url('Must be a valid URL').max(500).refine(
    (val) => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch { return false; }
    },
    { message: 'URL must use http or https protocol' },
  ).refine(
    (val) => {
      try {
        return !isPrivateOrLocalhost(new URL(val).hostname);
      } catch { return false; }
    },
    { message: 'Private or local addresses are not allowed' },
  ),
});

const EmailSchema = z.object({
  email: z.string().email('Must be a valid email address').max(254),
});

// ── POST /api/public/audit ────────────────────────────────────────────────────

publicAuditRouter.post(
  '/',
  publicAuditDailyLimiter,
  publicAuditHourlyLimiter,
  async (req, res) => {
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { url } = parsed.data;
    const rawIp   = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const ip_hash = crypto.createHash('sha256').update(rawIp).digest('hex');

    const { data: run, error } = await supabaseAdmin
      .from('public_audit_runs')
      .insert({ url, ip_hash })
      .select('id, token')
      .single();

    if (error || !run) {
      logger.error({ error, url }, 'Failed to create public_audit_run');
      res.status(500).json({ error: 'Failed to start audit. Please try again.' });
      return;
    }

    await publicAuditQueue.add({ run_id: run.id, url });

    logger.info({ runId: run.id, url }, 'Public audit job enqueued');

    res.status(202).json({
      token:             run.token,
      estimated_seconds: 25,
    });
  },
);

// ── GET /api/public/audit/:token ──────────────────────────────────────────────

publicAuditRouter.get('/:token', async (req, res) => {
  const { token } = req.params;

  const { data: run, error } = await supabaseAdmin
    .from('public_audit_runs')
    .select('token, status, score, grade, findings, ai_summary, site_meta, error, expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !run) {
    res.status(404).json({ error: 'Audit report not found or has expired.' });
    return;
  }

  res.json({ data: run });
});

// ── POST /api/public/audit/:token/email ───────────────────────────────────────

publicAuditRouter.post('/:token/email', async (req, res) => {
  const parsed = EmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { token } = req.params;
  const { email } = parsed.data;

  const { data: run, error } = await supabaseAdmin
    .from('public_audit_runs')
    .update({ email })
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .select('url, score, grade, ai_summary')
    .single();

  if (error || !run) {
    res.status(404).json({ error: 'Audit report not found or has expired.' });
    return;
  }

  const reportUrl = `${env.FRONTEND_URL}/audit/results/${token}`;
  const signupUrl = `${env.FRONTEND_URL}/login`;

  // Fire both emails in parallel — neither failure should block the response
  Promise.all([
    sendPublicAuditLeadNotification({
      visitorEmail: email,
      url:          run.url,
      score:        run.score ?? null,
      grade:        run.grade ?? null,
      reportUrl,
    }),
    sendPublicAuditReportEmail({
      to:        email,
      url:       run.url,
      score:     run.score ?? null,
      grade:     run.grade ?? null,
      aiSummary: run.ai_summary ?? null,
      reportUrl,
      signupUrl,
    }),
  ]).catch((err) => logger.error({ err, token }, 'Public audit email dispatch failed'));

  res.json({ data: { ok: true } });
});
