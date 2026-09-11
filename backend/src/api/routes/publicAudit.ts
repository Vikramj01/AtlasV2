/**
 * Public Audit Routes — no authentication required.
 * Rate-limited by IP (publicAuditLimiter).
 *
 * POST /api/public/audit              Submit a URL for auditing
 * GET  /api/public/audit/:token       Poll status / fetch results
 * POST /api/public/audit/:token/email Capture email for CTA
 *
 * This is the same Check Register v2 engine authenticated scans use
 * (auditQueue → runAuditOrchestrator → journeySimulator → runRegister) — not
 * a separate lightweight checker. runAuditOrchestrator already treats every
 * org/user-scoped step (usage logging, GTM container lookup, naming
 * conventions, rescan confirmations) as optional and skips it gracefully
 * when auditRow.user_id/client_id is absent, so a public run — an `audits`
 * row with user_id null, is_public true, and a random public_token as its
 * sole access mechanism — runs through it unmodified.
 *
 * A public visitor only supplies a URL, not the full Scan Inputs wizard
 * (site_type/declared_platforms/traffic_regions/...) an authenticated scan
 * collects. Those are inferred from a zero-cost HTML fetch (siteDetectionService)
 * with declaration_source: 'INFERRED_FROM_SITE' — the register's own
 * lower-confidence-declaration tier — rather than guessed silently.
 */
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { getAuditByPublicToken, createAudit, getReport, setAuditLeadEmail } from '@/services/database/queries';
import { auditQueue } from '@/services/queue/jobQueue';
import { publicAuditHourlyLimiter, publicAuditDailyLimiter } from '@/api/middleware/publicAuditLimiter';
import { detectSite } from '@/services/planning/siteDetectionService';
import { validateUrl } from '@/utils/urlValidator';
import { lintReportOutput } from '@/services/reporting/outputLint';
import { sendPublicAuditLeadNotification, sendPublicAuditReportEmail } from '@/services/email/emailService';
import { env } from '@/config/env';
import type { SiteType, DeclaredPlatform, FunnelType } from '@/types/audit';
import logger from '@/utils/logger';

export const publicAuditRouter = Router();

const PUBLIC_AUDIT_TTL_MS = 24 * 60 * 60 * 1000;

// ── Scan Inputs inference ───────────────────────────────────────────────────
// Mirrors audits.ts's StartAuditSchema enums — kept in sync manually, same
// as that file's own local consts (there's no shared export for these).

const BUSINESS_TYPE_TO_SITE_TYPE: Record<string, SiteType> = {
  ecommerce: 'ecommerce',
  saas:      'plg_saas',
  lead_gen:  'lead_gen_b2b',
  content:   'lead_gen_b2b',
  custom:    'lead_gen_b2b',
};

const SITE_TYPE_TO_LEGACY_FUNNEL: Record<SiteType, FunnelType> = {
  plg_saas:           'saas',
  ecommerce:          'ecommerce',
  lead_gen_b2b:       'lead_gen',
  marketplace:        'ecommerce',
  app_install:        'saas',
  subscription_media: 'saas',
};

async function inferScanInputs(url: string): Promise<{
  site_type: SiteType;
  funnel_type: FunnelType;
  declared_platforms: DeclaredPlatform[];
  primary_channel: DeclaredPlatform;
}> {
  const detection = await detectSite(url).catch((err) => {
    logger.warn({ url, err: String(err) }, 'Public audit: site detection failed, using defaults');
    return null;
  });

  const site_type = BUSINESS_TYPE_TO_SITE_TYPE[detection?.inferred_business_type ?? ''] ?? 'lead_gen_b2b';

  const declared_platforms: DeclaredPlatform[] = [];
  if (detection?.existing_tracking.meta_pixel_detected)  declared_platforms.push('meta');
  if (detection?.existing_tracking.google_ads_detected)  declared_platforms.push('google_ads');
  if (detection?.existing_tracking.tiktok_detected)      declared_platforms.push('tiktok');
  if (detection?.existing_tracking.linkedin_detected)    declared_platforms.push('linkedin');
  // Scan Inputs requires at least one declared platform — nothing detected
  // on a zero-cost HTML fetch doesn't mean nothing is there (most ad tags
  // fire behind a consent banner the HTML-only fetch never clicks through),
  // so default to the single most common platform rather than leaving the
  // register with nothing to check against.
  if (declared_platforms.length === 0) declared_platforms.push('google_ads');

  return {
    site_type,
    funnel_type: SITE_TYPE_TO_LEGACY_FUNNEL[site_type],
    declared_platforms,
    primary_channel: declared_platforms[0],
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const SubmitSchema = z.object({
  url: z.string().url('Must be a valid URL').max(500),
});

const EmailSchema = z.object({
  email: z.string().email('Must be a valid email address').max(254),
});

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

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

    const urlResult = validateUrl(parsed.data.url);
    if (!urlResult.valid) {
      res.status(400).json({ error: urlResult.error ?? 'Invalid URL' });
      return;
    }
    const website_url = urlResult.normalized!;

    const rawIp   = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const ip_hash = crypto.createHash('sha256').update(rawIp).digest('hex');

    try {
      const { site_type, funnel_type, declared_platforms, primary_channel } = await inferScanInputs(website_url);

      const audit = await createAudit({
        website_url,
        funnel_type,
        region: 'us',
        is_public: true,
        ip_hash,
        expires_at: new Date(Date.now() + PUBLIC_AUDIT_TTL_MS).toISOString(),
        rule_set_version: 'v2',
        site_type,
        secondary_motion: 'none',
        declared_platforms,
        declaration_source: 'INFERRED_FROM_SITE',
        primary_channel,
        traffic_regions: ['us'],
        cmp: 'none',
      });

      await auditQueue.add({
        audit_id: audit.id,
        website_url,
        funnel_type,
        region: 'us',
        url_map: {},
        rule_set_version: 'v2',
        site_type,
        secondary_motion: 'none',
        declared_platforms,
        declaration_source: 'INFERRED_FROM_SITE',
        primary_channel,
        traffic_regions: ['us'],
        cmp: 'none',
      });

      logger.info({ auditId: audit.id, website_url }, 'Public audit queued (Check Register v2)');

      res.status(202).json({
        token:             audit.public_token,
        estimated_seconds: 60,
      });
    } catch (err) {
      logger.error({ err, website_url }, 'Failed to start public audit');
      res.status(500).json({ error: 'Failed to start audit. Please try again.' });
    }
  },
);

// ── GET /api/public/audit/:token ──────────────────────────────────────────────

publicAuditRouter.get('/:token', async (req, res) => {
  const { token } = req.params;

  const audit = await getAuditByPublicToken(token);
  if (!audit || !audit.expires_at || new Date(audit.expires_at) <= new Date()) {
    res.status(404).json({ error: 'Audit report not found or has expired.' });
    return;
  }

  const statusMap = { queued: 'pending', running: 'scanning', completed: 'done', failed: 'failed' } as const;
  const status = statusMap[audit.status];

  if (status !== 'done') {
    res.json({
      data: {
        token,
        status,
        progress: audit.progress,
        report: null,
        error: audit.error_message ?? null,
        expires_at: audit.expires_at,
      },
    });
    return;
  }

  const report = await getReport(audit.id);
  if (!report) {
    res.status(404).json({ error: 'Audit report not found or has expired.' });
    return;
  }

  // Same output vocabulary lint the authenticated export route gates on
  // (Pre-Connection Scan Confidence Tiering PRD §5) — this report has no
  // operator in the loop to catch bad copy before it ships, so the gate
  // applies to every public view, not just export.
  if (report.rule_set_version === 'v2') {
    const violations = lintReportOutput(report);
    if (violations.length > 0) {
      logger.error({ auditId: audit.id, violations }, 'Public audit: report failed output vocabulary lint');
      res.json({
        data: {
          token,
          status: 'failed',
          progress: 100,
          report: null,
          error: 'This scan could not be completed. Please try again.',
          expires_at: audit.expires_at,
        },
      });
      return;
    }
  }

  res.json({
    data: {
      token,
      status: 'done',
      progress: 100,
      report,
      error: null,
      expires_at: audit.expires_at,
    },
  });
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

  const audit = await getAuditByPublicToken(token);
  if (!audit || !audit.expires_at || new Date(audit.expires_at) <= new Date()) {
    res.status(404).json({ error: 'Audit report not found or has expired.' });
    return;
  }

  await setAuditLeadEmail(audit.id, email);

  const report = audit.status === 'completed' ? await getReport(audit.id) : null;
  const score  = report?.executive_summary.scores.conversion_signal_health ?? null;
  const grade  = score !== null ? gradeFromScore(score) : null;

  const reportUrl = `${env.FRONTEND_URL}/audit/results/${token}`;
  const signupUrl = `${env.FRONTEND_URL}/login`;

  // Fire both emails in parallel — neither failure should block the response
  Promise.all([
    sendPublicAuditLeadNotification({
      visitorEmail: email,
      url:          audit.website_url,
      score,
      grade,
      reportUrl,
    }),
    sendPublicAuditReportEmail({
      to:        email,
      url:       audit.website_url,
      score,
      grade,
      aiSummary: report?.executive_summary.business_summary ?? null,
      reportUrl,
      signupUrl,
    }),
  ]).catch((err) => logger.error({ err, token }, 'Public audit email dispatch failed'));

  res.json({ data: { ok: true } });
});
