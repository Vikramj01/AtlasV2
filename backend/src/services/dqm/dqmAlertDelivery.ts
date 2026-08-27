/**
 * DQM Alert Delivery
 *
 * Wires dqm_gtg / dqm_dma alerts (already written to health_alerts by
 * dqmOrchestrator.ts's applyAlertDecision()) to per-org email/Slack delivery.
 *
 * Detection, scheduling, and in-app storage already existed — this module is
 * purely the missing "reach a human" step (B12 in
 * ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md).
 *
 * Delivery channels are per-org (dqm_alert_preferences), not env-var-gated
 * like the operator alert path (services/usage/alertDelivery.ts) — DQM
 * alerts are client-facing, not internal.
 *
 * Design contract: sendDQMAlertNotification() NEVER throws. A delivery
 * failure must not crash the DQM orchestrator run that triggered it.
 */

import { env } from '@/config/env';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import type { AlertType, AlertSeverity } from '@/types/health';

const RESEND_URL = 'https://api.resend.com/emails';

interface DQMPrefs {
  email_enabled: boolean;
  slack_enabled: boolean;
  slack_webhook_url: string | null;
  recipient_user_ids: string[];
}

const DEFAULT_PREFS: DQMPrefs = {
  email_enabled: true,
  slack_enabled: false,
  slack_webhook_url: null,
  recipient_user_ids: [],
};

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendDQMAlertNotification(
  orgId: string,
  alertType: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
): Promise<void> {
  try {
    const prefs = await getPrefs(orgId);

    const results = await Promise.allSettled([
      prefs.email_enabled ? sendEmail(orgId, prefs, alertType, severity, title, message) : Promise.resolve(),
      prefs.slack_enabled ? sendSlack(prefs, severity, title, message) : Promise.resolve(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(
          { err: result.reason instanceof Error ? result.reason.message : String(result.reason), orgId, alertType },
          '[dqmAlertDelivery] Delivery channel threw unexpectedly',
        );
      }
    }
  } catch (err) {
    // Never let a delivery failure surface to the orchestrator — the alert
    // itself already made it into health_alerts regardless.
    logger.error(
      { err: err instanceof Error ? err.message : String(err), orgId, alertType },
      '[dqmAlertDelivery] Failed to dispatch DQM alert notification',
    );
  }
}

// ── Preferences + recipients ─────────────────────────────────────────────────

async function getPrefs(orgId: string): Promise<DQMPrefs> {
  const { data, error } = await supabaseAdmin
    .from('dqm_alert_preferences')
    .select('email_enabled, slack_enabled, slack_webhook_url, recipient_user_ids')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message, orgId }, '[dqmAlertDelivery] Failed to load preferences');
    return DEFAULT_PREFS;
  }

  return (data as DQMPrefs | null) ?? DEFAULT_PREFS;
}

async function resolveRecipientEmails(orgId: string, recipientUserIds: string[]): Promise<string[]> {
  if (!env.RESEND_API_KEY) return [];

  // If no explicit recipients configured, fall back to the org's members —
  // same fallback pattern as ihc/alertService.ts's getOrgOwnerIds().
  const userIds = recipientUserIds.length > 0 ? recipientUserIds : await getOrgOwnerIds(orgId);
  if (userIds.length === 0) return [];

  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error || !data) return [];

  return data.users
    .filter((u) => userIds.includes(u.id) && u.email)
    .map((u) => u.email as string);
}

async function getOrgOwnerIds(orgId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .limit(5);
  return (data ?? []).map((r: { id: string }) => r.id);
}

// ── Email delivery ────────────────────────────────────────────────────────────

async function sendEmail(
  orgId: string,
  prefs: DQMPrefs,
  alertType: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const recipients = await resolveRecipientEmails(orgId, prefs.recipient_user_ids);
  if (recipients.length === 0) return;

  const accent = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#d97706' : '#2563eb';
  const label = severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info';
  const subject = `[Atlas] Data Quality Alert — ${title}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr>
          <td style="background:${accent};padding:16px 24px;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#ffffff;">
              Atlas Data Quality Monitor &mdash; ${label}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#111827;">${escapeHtml(title)}</p>
            <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${escapeHtml(message)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 24px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              ${escapeHtml(alertType)} &middot; Atlas &mdash; atlas.vimi.digital
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: recipients, subject, html }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    logger.error({ status: res.status, message: body.message, orgId }, '[dqmAlertDelivery] Resend API error');
  } else {
    logger.info({ orgId, to: recipients.length, subject }, '[dqmAlertDelivery] Alert email sent');
  }
}

// ── Slack delivery ────────────────────────────────────────────────────────────

async function sendSlack(
  prefs: DQMPrefs,
  severity: AlertSeverity,
  title: string,
  message: string,
): Promise<void> {
  if (!prefs.slack_webhook_url) return;

  const emoji = severity === 'critical' ? ':red_circle:' : severity === 'warning' ? ':warning:' : ':information_source:';

  const res = await fetch(prefs.slack_webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `${emoji} *Atlas Data Quality Alert*\n*${title}*\n${message}` }),
  });

  if (!res.ok) {
    logger.error({ status: res.status }, '[dqmAlertDelivery] Slack webhook returned non-2xx');
  } else {
    logger.info('[dqmAlertDelivery] Alert posted to Slack');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
