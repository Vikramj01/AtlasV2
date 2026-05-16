/**
 * IHC Alert Service
 *
 * Delivers Implementation Health Check alerts to org users via:
 *   • Email (Resend) — critical (immediate batch), high (daily digest),
 *                      medium (weekly digest), low (in-app only)
 *   • In-app feed  — writes to health_alerts table for all severities
 *
 * Dedup contract:
 *   - A finding alerts ONCE on first open transition.
 *   - No further alerts while finding stays open and unchanged.
 *   - Severity escalation (re-open at higher severity) triggers a new alert.
 *   - Resolved then re-opened within 24 h → suppressed (anti-flap).
 *   - Resolved then re-opened after 24 h → new alert.
 *   - `suppressed` status silences all alerts for the suppression window.
 *
 * Critical batching:
 *   - 15-minute rolling window per org (configurable via ihc_alert_preferences).
 *   - Up to 10 findings per email; excess deferred to next batch.
 */

import { env } from '@/config/env';
import logger from '@/utils/logger';
import { supabaseAdmin } from '@/services/database/supabase';
import { RULE_INTERPRETATIONS } from './ruleInterpretations';
import type { RuleInterpretation } from './ruleInterpretations';

const RESEND_URL = 'https://api.resend.com/emails';
const FRONTEND_URL = env.FRONTEND_URL;
const MAX_CRITICAL_PER_BATCH = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertableFinding {
  id: string;
  organization_id: string;
  property_id: string;
  rule_id: string;
  validation_layer: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  evidence: Record<string, unknown>;
  first_detected_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  last_alerted_at: string | null;
}

interface IHCPrefs {
  email_critical_enabled: boolean;
  email_high_digest_enabled: boolean;
  email_medium_digest_enabled: boolean;
  email_low_enabled: boolean;
  daily_digest_hour: number;
  weekly_digest_day: number;
  weekly_digest_hour: number;
  critical_alert_batch_minutes: number;
  recipient_user_ids: string[];
  paused_properties: string[];
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check for new critical findings and send immediate batch email.
 * Called by ihcAlertQueue after each ihcRulesQueue / ihcDriftQueue completion.
 */
export async function runCriticalAlertBatch(orgId: string): Promise<void> {
  const prefs = await getPrefs(orgId);
  if (!prefs?.email_critical_enabled) return;

  const batchMinutes = prefs.critical_alert_batch_minutes ?? 15;
  const since = new Date(Date.now() - batchMinutes * 60 * 1000).toISOString();

  // New open critical findings not yet alerted (or re-opened after 24h suppression window)
  const { data: findings, error } = await supabaseAdmin
    .from('audit_findings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('severity', 'critical')
    .eq('status', 'open')
    .gte('first_detected_at', since)
    .or('last_alerted_at.is.null,last_alerted_at.lt.' + since);

  if (error) {
    logger.error({ err: error.message, orgId }, 'IHC alert: failed to query critical findings');
    return;
  }

  const eligible = (findings ?? []).filter((f: AlertableFinding) =>
    !prefs.paused_properties.includes(f.property_id) && !isAntiFlap(f),
  );

  if (eligible.length === 0) return;

  const recipients = await resolveRecipientEmails(orgId, prefs.recipient_user_ids);
  if (recipients.length === 0) return;

  // Process in batches of MAX_CRITICAL_PER_BATCH
  for (let i = 0; i < eligible.length; i += MAX_CRITICAL_PER_BATCH) {
    const batch = eligible.slice(i, i + MAX_CRITICAL_PER_BATCH);
    const batchId = `critical-${orgId}-${Date.now()}-${i}`;

    await sendCriticalEmail(recipients, batch, batchId);
    await writeAlertLog(orgId, batch, 'critical_immediate', batchId);
    await markAlerted(batch.map((f: AlertableFinding) => f.id));
    await writeInAppAlerts(orgId, batch);
  }
}

/**
 * Send daily digest for high-severity open findings.
 * Called by the daily digest cron job at the org's configured hour.
 */
export async function runDailyDigest(orgId: string): Promise<void> {
  const prefs = await getPrefs(orgId);
  if (!prefs?.email_high_digest_enabled) return;

  const { data: findings, error } = await supabaseAdmin
    .from('audit_findings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('severity', 'high')
    .eq('status', 'open');

  if (error) {
    logger.error({ err: error.message, orgId }, 'IHC alert: failed to query high findings');
    return;
  }

  const eligible = (findings ?? []).filter(
    (f: AlertableFinding) => !prefs.paused_properties.includes(f.property_id),
  );
  if (eligible.length === 0) return;

  const recipients = await resolveRecipientEmails(orgId, prefs.recipient_user_ids);
  if (recipients.length === 0) return;

  const batchId = `daily-${orgId}-${Date.now()}`;
  await sendDigestEmail(recipients, eligible, 'daily', batchId);
  await writeAlertLog(orgId, eligible, 'daily_digest', batchId);
  await markAlerted(eligible.map((f: AlertableFinding) => f.id));
  await writeInAppAlerts(orgId, eligible);
}

/**
 * Send weekly digest for medium-severity open findings.
 * Called by the weekly digest cron job on configured day + hour.
 */
export async function runWeeklyDigest(orgId: string): Promise<void> {
  const prefs = await getPrefs(orgId);
  if (!prefs?.email_medium_digest_enabled) return;

  const { data: findings, error } = await supabaseAdmin
    .from('audit_findings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('severity', 'medium')
    .eq('status', 'open');

  if (error) {
    logger.error({ err: error.message, orgId }, 'IHC alert: failed to query medium findings');
    return;
  }

  const eligible = (findings ?? []).filter(
    (f: AlertableFinding) => !prefs.paused_properties.includes(f.property_id),
  );
  if (eligible.length === 0) return;

  const recipients = await resolveRecipientEmails(orgId, prefs.recipient_user_ids);
  if (recipients.length === 0) return;

  const batchId = `weekly-${orgId}-${Date.now()}`;
  await sendDigestEmail(recipients, eligible, 'weekly', batchId);
  await writeAlertLog(orgId, eligible, 'weekly_digest', batchId);
  await markAlerted(eligible.map((f: AlertableFinding) => f.id));
  await writeInAppAlerts(orgId, eligible);
}

// ── Email builders ─────────────────────────────────────────────────────────────

async function sendCriticalEmail(
  recipients: string[],
  findings: AlertableFinding[],
  batchId: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const isSingle = findings.length === 1;
  const f = findings[0]!;
  const interp = RULE_INTERPRETATIONS[f.rule_id];
  const subject = isSingle
    ? `[Atlas] Critical: ${interp?.title ?? f.rule_id} on ${f.property_id}`
    : `[Atlas] ${findings.length} Critical Issues Detected`;

  const findingCards = findings
    .map((finding) => buildFindingCard(finding, 'critical'))
    .join('\n');

  const html = buildEmailShell(
    subject,
    '#dc2626',
    `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      ${findings.length === 1
        ? 'A critical implementation health issue requires your immediate attention.'
        : `${findings.length} critical implementation health issues require your immediate attention.`}
    </p>
    ${findingCards}
    <div style="margin-top:24px;padding:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
      <p style="margin:0;font-size:12px;color:#92400e;">
        Batch ID: ${batchId} — Issues detected within the last
        ${Math.round((Date.now() - new Date(f.first_detected_at).getTime()) / 60000)} minutes.
        <a href="${FRONTEND_URL}/settings/implementation-health" style="color:#c2410c;">
          View all findings →
        </a>
      </p>
    </div>
  `,
  );

  await sendEmail(recipients, subject, html, batchId);
}

async function sendDigestEmail(
  recipients: string[],
  findings: AlertableFinding[],
  cadence: 'daily' | 'weekly',
  batchId: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const label = cadence === 'daily' ? 'Daily' : 'Weekly';
  const severity = cadence === 'daily' ? 'high' : 'medium';
  const subject = `[Atlas] ${label} IHC Digest — ${findings.length} ${severity}-severity issue${findings.length !== 1 ? 's' : ''}`;

  const findingCards = findings
    .map((f) => buildFindingCard(f, severity as 'high' | 'medium'))
    .join('\n');

  const html = buildEmailShell(
    subject,
    cadence === 'daily' ? '#d97706' : '#7c3aed',
    `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Your ${label.toLowerCase()} Implementation Health digest. The following
      ${severity}-severity issues are currently open.
    </p>
    ${findingCards}
    <div style="margin-top:24px;text-align:center;">
      <a href="${FRONTEND_URL}/settings/implementation-health"
         style="display:inline-block;padding:10px 20px;background:#1B2A4A;color:#fff;
                border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
        View all findings in Atlas
      </a>
    </div>
  `,
  );

  await sendEmail(recipients, subject, html, batchId);
}

function buildFindingCard(
  f: AlertableFinding,
  severity: 'critical' | 'high' | 'medium',
): string {
  const interp: RuleInterpretation | undefined = RULE_INTERPRETATIONS[f.rule_id];
  const severityColor =
    severity === 'critical' ? '#dc2626' : severity === 'high' ? '#d97706' : '#7c3aed';
  const effortLabel = interp?.estimated_effort
    ? `Effort: ${interp.estimated_effort}`
    : '';

  return `
  <div style="margin-bottom:16px;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;
              border-left:4px solid ${severityColor};border-radius:6px;">
    <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#111827;">
      ${escHtml(interp?.title ?? f.rule_id)}
    </p>
    <p style="margin:0 0 8px;font-size:11px;color:#6b7280;font-family:monospace;">
      ${escHtml(f.rule_id)} · ${escHtml(f.property_id)} · Detected ${new Date(f.first_detected_at).toLocaleDateString()}
    </p>
    ${interp?.business_impact ? `
    <p style="margin:0 0 6px;font-size:13px;color:#374151;">
      <strong>Impact:</strong> ${escHtml(interp.business_impact)}
    </p>` : ''}
    ${interp?.fix_summary ? `
    <p style="margin:0 0 6px;font-size:13px;color:#374151;">
      <strong>Fix:</strong> ${escHtml(interp.fix_summary)}
    </p>` : ''}
    <p style="margin:0;font-size:12px;color:#6b7280;">
      ${escHtml(interp?.recommended_owner ? `Owner: ${interp.recommended_owner}` : '')}
      ${effortLabel ? ` · ${effortLabel}` : ''}
    </p>
  </div>`;
}

function buildEmailShell(title: string, accentColor: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr>
          <td style="background:${accentColor};padding:16px 24px;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#ffffff;">
              Atlas Implementation Health — ${escHtml(title)}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:12px 24px;border-top:1px solid #f3f4f6;text-align:center;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">
              Atlas · <a href="${FRONTEND_URL}/settings/implementation-health" style="color:#6b7280;">
                Manage alert preferences
              </a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  batchId: string,
): Promise<void> {
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      logger.error({ status: res.status, body, batchId }, 'IHC alert: Resend API error');
    } else {
      logger.info({ batchId, to: to.length, subject }, 'IHC alert email sent');
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), batchId },
      'IHC alert: email delivery failed',
    );
  }
}

// ── In-app feed ────────────────────────────────────────────────────────────────

async function writeInAppAlerts(orgId: string, findings: AlertableFinding[]): Promise<void> {
  const rows = findings.map((f) => {
    const interp = RULE_INTERPRETATIONS[f.rule_id];
    return {
      user_id: orgId, // health_alerts uses user_id; for IHC we store org_id here
      alert_type: 'ihc_finding',
      severity: f.severity === 'critical' || f.severity === 'high' ? 'critical' : 'warning',
      title: interp?.title ?? f.rule_id,
      message: interp?.business_impact ?? `Implementation health issue detected (${f.rule_id})`,
      is_active: true,
      details: {
        finding_id: f.id,
        rule_id: f.rule_id,
        property_id: f.property_id,
        validation_layer: f.validation_layer,
        ihc_severity: f.severity,
      },
    };
  });

  const { error } = await supabaseAdmin.from('health_alerts').insert(rows);
  if (error) {
    logger.error({ err: error.message, orgId }, 'IHC alert: failed to write in-app alerts');
  }
}

// ── Dedup helpers ──────────────────────────────────────────────────────────────

/** Anti-flap: suppress if finding was resolved and re-opened within 24 h. */
function isAntiFlap(f: AlertableFinding): boolean {
  if (!f.resolved_at) return false;
  const resolvedAt = new Date(f.resolved_at).getTime();
  const reopenedAt = new Date(f.first_detected_at).getTime();
  return reopenedAt - resolvedAt < 24 * 60 * 60 * 1000;
}

async function markAlerted(findingIds: string[]): Promise<void> {
  if (findingIds.length === 0) return;
  const { error } = await supabaseAdmin
    .from('audit_findings')
    .update({ last_alerted_at: new Date().toISOString() })
    .in('id', findingIds);
  if (error) {
    logger.error({ err: error.message }, 'IHC alert: failed to mark last_alerted_at');
  }
}

async function writeAlertLog(
  orgId: string,
  findings: AlertableFinding[],
  alertType: string,
  batchId: string,
): Promise<void> {
  const rows = findings.map((f) => ({
    organization_id: orgId,
    finding_id: f.id,
    alert_type: alertType,
    batch_id: batchId,
  }));
  const { error } = await supabaseAdmin.from('ihc_alert_log').insert(rows);
  if (error) {
    logger.error({ err: error.message, batchId }, 'IHC alert: failed to write alert log');
  }
}

// ── Preferences + recipients ───────────────────────────────────────────────────

async function getPrefs(orgId: string): Promise<IHCPrefs | null> {
  const { data, error } = await supabaseAdmin
    .from('ihc_alert_preferences')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message, orgId }, 'IHC alert: failed to load preferences');
    return null;
  }

  // Return defaults when no row exists (org hasn't customised prefs yet)
  return data ?? {
    email_critical_enabled: true,
    email_high_digest_enabled: true,
    email_medium_digest_enabled: true,
    email_low_enabled: false,
    daily_digest_hour: 9,
    weekly_digest_day: 1,
    weekly_digest_hour: 9,
    critical_alert_batch_minutes: 15,
    recipient_user_ids: [],
    paused_properties: [],
  };
}

async function resolveRecipientEmails(
  orgId: string,
  recipientUserIds: string[],
): Promise<string[]> {
  if (!env.RESEND_API_KEY) return [];

  // If no explicit recipients configured, fall back to the org owner's email.
  const userIds =
    recipientUserIds.length > 0
      ? recipientUserIds
      : await getOrgOwnerIds(orgId);

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

// ── Utility ────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Digest scheduler helpers ───────────────────────────────────────────────────

/**
 * Run daily digest for all pro/agency orgs whose configured digest hour matches
 * the current UTC hour. Called from the ihcDigestQueue daily cron at each UTC hour.
 */
export async function runDailyDigestsForDueOrgs(): Promise<void> {
  const currentHour = new Date().getUTCHours();

  const { data: prefs, error } = await supabaseAdmin
    .from('ihc_alert_preferences')
    .select('organization_id, daily_digest_hour, email_high_digest_enabled')
    .eq('email_high_digest_enabled', true)
    .eq('daily_digest_hour', currentHour);

  if (error) {
    logger.error({ err: error.message }, 'IHC digest scheduler: failed to query preferences');
    return;
  }

  // Also include orgs on pro/agency without custom prefs (default hour = 9)
  if (currentHour === 9) {
    const { data: defaultOrgs } = await supabaseAdmin
      .from('org_subscriptions')
      .select('organization_id')
      .in('plan', ['pro', 'agency'])
      .eq('status', 'active');

    const configuredOrgIds = new Set((prefs ?? []).map((p: { organization_id: string }) => p.organization_id));
    const unconfiguredOrgs = (defaultOrgs ?? []).filter(
      (o: { organization_id: string }) => !configuredOrgIds.has(o.organization_id),
    );

    for (const org of unconfiguredOrgs) {
      await runDailyDigest(org.organization_id).catch((err) =>
        logger.error({ err: err instanceof Error ? err.message : String(err), orgId: org.organization_id }, 'IHC daily digest failed'),
      );
    }
  }

  for (const pref of (prefs ?? [])) {
    await runDailyDigest((pref as { organization_id: string }).organization_id).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'IHC daily digest failed'),
    );
  }
}

/**
 * Run weekly digest for all pro/agency orgs whose configured day+hour matches
 * the current UTC day + hour. Called from the ihcDigestQueue weekly cron.
 */
export async function runWeeklyDigestsForDueOrgs(): Promise<void> {
  const now = new Date();
  const currentDay = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // ISO: 1=Mon, 7=Sun
  const currentHour = now.getUTCHours();

  const { data: prefs, error } = await supabaseAdmin
    .from('ihc_alert_preferences')
    .select('organization_id, weekly_digest_day, weekly_digest_hour, email_medium_digest_enabled')
    .eq('email_medium_digest_enabled', true)
    .eq('weekly_digest_day', currentDay)
    .eq('weekly_digest_hour', currentHour);

  if (error) {
    logger.error({ err: error.message }, 'IHC weekly digest scheduler: failed to query preferences');
    return;
  }

  // Monday 09:00 UTC = default weekly digest for unconfigured orgs
  if (currentDay === 1 && currentHour === 9) {
    const { data: defaultOrgs } = await supabaseAdmin
      .from('org_subscriptions')
      .select('organization_id')
      .in('plan', ['pro', 'agency'])
      .eq('status', 'active');

    const configuredOrgIds = new Set((prefs ?? []).map((p: { organization_id: string }) => p.organization_id));
    const unconfiguredOrgs = (defaultOrgs ?? []).filter(
      (o: { organization_id: string }) => !configuredOrgIds.has(o.organization_id),
    );

    for (const org of unconfiguredOrgs) {
      await runWeeklyDigest(org.organization_id).catch((err) =>
        logger.error({ err: err instanceof Error ? err.message : String(err), orgId: org.organization_id }, 'IHC weekly digest failed'),
      );
    }
  }

  for (const pref of (prefs ?? [])) {
    await runWeeklyDigest((pref as { organization_id: string }).organization_id).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'IHC weekly digest failed'),
    );
  }
}
