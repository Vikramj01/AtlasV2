/**
 * Email Service
 *
 * Thin wrapper around the Resend REST API (https://resend.com).
 * No SDK — just a fetch() call to the /emails endpoint.
 *
 * If RESEND_API_KEY is not set, emails are silently skipped so the app
 * still works in local development without an email provider configured.
 *
 * Two transactional emails:
 *   - Developer invite:       sent when a marketer generates a share link
 *   - Marketer completion:    sent when a developer marks all pages implemented
 */

import { env } from '@/config/env';
import logger from '@/utils/logger';

const RESEND_API_URL = 'https://api.resend.com/emails';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SendResult {
  ok: boolean;
  error?: string;
}

// ── Core send helper ──────────────────────────────────────────────────────────

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    logger.warn({ subject: opts.subject }, '[emailService] RESEND_API_KEY not set — email skipped');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
      logger.error({ status: res.status, message: msg }, '[emailService] Resend API error');
      return { ok: false, error: msg };
    }

    logger.info({ subject: opts.subject }, '[emailService] Email sent');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ message }, '[emailService] Network error');
    return { ok: false, error: message };
  }
}

// ── Email 1: Developer invite ─────────────────────────────────────────────────

/**
 * Sent to the developer when the marketer generates a share link and
 * provides the developer's email address.
 */
export async function sendDeveloperInvite(opts: {
  developerEmail: string;
  developerName: string | null;
  marketerEmail: string;
  siteName: string;
  shareUrl: string;
}): Promise<SendResult> {
  const greeting = opts.developerName ? `Hi ${opts.developerName},` : 'Hi,';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#1e40af;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Atlas</p>
          <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;">Signal Health Platform</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;color:#111827;">${greeting}</p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
            <strong>${opts.marketerEmail}</strong> has shared a tracking implementation plan with you for
            <strong>${opts.siteName}</strong>.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
            Open the link below to see exactly what dataLayer code to implement, page by page.
            No Atlas account required.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#1e40af;border-radius:8px;padding:12px 24px;">
              <a href="${opts.shareUrl}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                Open Implementation Portal →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">Or copy this link:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;background:#f3f4f6;padding:10px 12px;border-radius:6px;font-family:monospace;">
            ${opts.shareUrl}
          </p>
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            This link expires in 90 days. If you have questions about the tracking requirements, contact ${opts.marketerEmail}.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;">Sent via Atlas — atlas.vimi.digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail({
    to: opts.developerEmail,
    subject: `Tracking implementation plan for ${opts.siteName}`,
    html,
  });
}

// ── Email 4: Signup confirmation ──────────────────────────────────────────────

/**
 * Sent when a new user signs up. Contains the Supabase-generated confirmation
 * link so they can verify their email and activate their account.
 */
export async function sendSignupConfirmationEmail(opts: {
  to: string;
  confirmUrl: string;
}): Promise<SendResult> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#1e40af;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Atlas</p>
          <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;">Signal Health Platform</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111827;">Confirm your email address</p>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
            Thanks for signing up to Atlas. Click the button below to verify your email
            address and activate your account. This link expires in 24 hours.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#1e40af;border-radius:8px;padding:12px 24px;">
              <a href="${opts.confirmUrl}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                Confirm email address →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">Or copy this link:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;background:#f3f4f6;padding:10px 12px;border-radius:6px;font-family:monospace;">
            ${opts.confirmUrl}
          </p>
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            If you didn't create an Atlas account, you can safely ignore this email.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;">Sent via Atlas — atlas.vimi.digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail({
    to: opts.to,
    subject: 'Confirm your Atlas account',
    html,
  });
}

// ── Email 3: Password reset ───────────────────────────────────────────────────

/**
 * Sent when a user requests a password reset. Contains the Supabase-generated
 * recovery link so we never route through Supabase's own SMTP configuration.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<SendResult> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#1e40af;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Atlas</p>
          <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;">Signal Health Platform</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#111827;">Reset your password</p>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
            We received a request to reset the password for your Atlas account.
            Click the button below to choose a new password.
            This link expires in 1 hour.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background:#1e40af;border-radius:8px;padding:12px 24px;">
              <a href="${opts.resetUrl}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                Reset password →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">Or copy this link:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;background:#f3f4f6;padding:10px 12px;border-radius:6px;font-family:monospace;">
            ${opts.resetUrl}
          </p>
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            If you didn't request a password reset, you can safely ignore this email.
            Your password won't change until you click the link above.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;">Sent via Atlas — atlas.vimi.digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail({
    to: opts.to,
    subject: 'Reset your Atlas password',
    html,
  });
}

// ── Email 2: Marketer completion notification ─────────────────────────────────

/**
 * Sent to the marketer when the developer marks the last page as
 * implemented/verified — triggers once per share, not per status update.
 */
export async function sendMarketerCompletionNotification(opts: {
  marketerEmail: string;
  siteName: string;
  developerName: string | null;
  progressUrl: string;
}): Promise<SendResult> {
  const devLabel = opts.developerName ? `Your developer (${opts.developerName})` : 'Your developer';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:#166534;padding:24px 32px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Atlas</p>
          <p style="margin:4px 0 0;font-size:12px;color:#bbf7d0;">Signal Health Platform</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:22px;">🎉</p>
          <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#111827;">
            Tracking implementation complete for ${opts.siteName}
          </p>
          <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
            ${devLabel} has marked all pages as implemented. Your tracking is ready to verify.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
            Run an Atlas audit to confirm every conversion signal is firing correctly across
            GA4, Meta, Google Ads, and sGTM.
          </p>
          <!-- Primary CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
            <tr><td style="background:#166534;border-radius:8px;padding:12px 24px;">
              <a href="${opts.progressUrl}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">
                View Implementation Progress →
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:13px;color:#9ca3af;">
            From the progress view, you can launch an audit directly.
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#166534;">What to do next</p>
            <ol style="margin:0;padding:0 0 0 16px;font-size:13px;color:#374151;line-height:1.8;">
              <li>Open your planning session and click <strong>Set Up Audit Mode</strong></li>
              <li>Review the pre-populated audit journey</li>
              <li>Run the audit — results in ~60 seconds</li>
            </ol>
          </div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;">
          <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;">Sent via Atlas — atlas.vimi.digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendEmail({
    to: opts.marketerEmail,
    subject: `Your developer has finished implementing tracking for ${opts.siteName}`,
    html,
  });
}
