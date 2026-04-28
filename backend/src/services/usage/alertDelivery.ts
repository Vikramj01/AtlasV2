/**
 * Operator Alert Delivery
 *
 * Shared utility for sending internal operational alerts (margin threshold
 * breaches, fair-use cap violations, Browserbase reconciliation gaps).
 *
 * Delivery channels — enabled by env vars, both optional:
 *   OPERATOR_ALERT_EMAIL       → Resend email (uses the existing email service pattern)
 *   OPERATOR_SLACK_WEBHOOK_URL → Slack incoming webhook
 *
 * If neither is configured, alerts are written to console only so they remain
 * visible in Render logs. This is the safe fallback — the alert is never lost,
 * just less immediately noticeable.
 *
 * Design contract: sendOperatorAlert() NEVER throws. A delivery failure must
 * not crash the nightly job that triggered the alert.
 */

import { env } from '@/config/env';
import logger from '@/utils/logger';

export type AlertSeverity = 'medium' | 'high';

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendOperatorAlert(
  message: string,
  severity: AlertSeverity,
): Promise<void> {
  // Always write to console so Render logs capture every alert regardless of
  // whether delivery channels are configured.
  if (severity === 'high') {
    console.error(`[OPERATOR ALERT] ${message}`);
  } else {
    console.warn(`[OPERATOR ALERT] ${message}`);
  }

  const results = await Promise.allSettled([
    sendEmail(message, severity),
    sendSlack(message, severity),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason instanceof Error ? result.reason.message : String(result.reason) },
        '[alertDelivery] Delivery channel threw unexpectedly',
      );
    }
  }
}

// ── Email delivery ────────────────────────────────────────────────────────────

async function sendEmail(message: string, severity: AlertSeverity): Promise<void> {
  if (!env.OPERATOR_ALERT_EMAIL || !env.RESEND_API_KEY) return;

  const severityLabel = severity === 'high' ? '🔴 HIGH' : '🟡 MEDIUM';
  const subject = `[Atlas Alert] ${severityLabel} — ${firstLine(message)}`;

  // Plain-text-style HTML — internal alert, not customer-facing.
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:10px;border:1px solid ${severity === 'high' ? '#fca5a5' : '#fde68a'};overflow:hidden;">
        <tr>
          <td style="background:${severity === 'high' ? '#dc2626' : '#d97706'};padding:16px 24px;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#ffffff;">
              Atlas Operator Alert &mdash; ${severityLabel}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <pre style="margin:0;font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;font-family:ui-monospace,'Cascadia Code',monospace;">${escapeHtml(message)}</pre>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 24px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">Atlas — atlas.vimi.digital</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [env.OPERATOR_ALERT_EMAIL],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      logger.error(
        { status: res.status, message: body.message },
        '[alertDelivery] Resend API error',
      );
    } else {
      logger.info({ subject }, '[alertDelivery] Alert email sent');
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[alertDelivery] Failed to send alert email',
    );
  }
}

// ── Slack delivery ────────────────────────────────────────────────────────────

async function sendSlack(message: string, severity: AlertSeverity): Promise<void> {
  if (!env.OPERATOR_SLACK_WEBHOOK_URL) return;

  const emoji = severity === 'high' ? ':red_circle:' : ':warning:';

  try {
    const res = await fetch(env.OPERATOR_SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `${emoji} *Atlas Operator Alert*\n\`\`\`${message}\`\`\`` }),
    });

    if (!res.ok) {
      logger.error({ status: res.status }, '[alertDelivery] Slack webhook returned non-2xx');
    } else {
      logger.info('[alertDelivery] Alert posted to Slack');
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[alertDelivery] Failed to post Slack alert',
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function firstLine(s: string): string {
  return s.split('\n')[0]?.slice(0, 80) ?? 'Alert';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
