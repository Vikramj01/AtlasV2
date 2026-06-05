/**
 * Slack Integration routes
 *
 * Destination management (org-scoped):
 *   GET    /api/slack/destinations              — list configured destinations
 *   POST   /api/slack/destinations              — add a destination
 *   PATCH  /api/slack/destinations/:id          — update name / channel_hint / enabled
 *   DELETE /api/slack/destinations/:id          — remove a destination
 *   POST   /api/slack/destinations/:id/test     — send test message
 *
 * Share endpoints (one per result type):
 *   POST   /api/slack/share/audit/:auditId
 *   POST   /api/slack/share/brief/:briefId
 *   POST   /api/slack/share/reconciliation/:runId
 *   POST   /api/slack/share/ihc/:clientId
 *   POST   /api/slack/share/signals
 *   POST   /api/slack/share/crawl/:runId
 *
 * All routes require authMiddleware + planGuard('pro').
 * Webhook URLs are encrypted at rest using AES-256-GCM.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import {
  sendSlackMessage,
  buildAuditMessage,
  buildStrategyBriefMessage,
  buildReconciliationMessage,
  buildIHCMessage,
  buildSignalAggregatesMessage,
  buildCrawlRunMessage,
} from '@/services/slack/slackDelivery';

export const slackRouter = Router();
slackRouter.use(authMiddleware, planGuard('pro'));

// ── Encryption (same pattern as capi/credentials.ts) ─────────────────────────

interface EncEnvelope { iv: string; tag: string; ciphertext: string }

function getEncKey(): Buffer {
  const hex = env.CAPI_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CAPI_ENCRYPTION_KEY must be set in production');
    }
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex, 'hex');
}

function encryptText(plain: string): string {
  const key = getEncKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const env: EncEnvelope = { iv: iv.toString('hex'), tag: tag.toString('hex'), ciphertext: ct.toString('hex') };
  return JSON.stringify(env);
}

function decryptText(encrypted: string): string {
  const key = getEncKey();
  const { iv, tag, ciphertext } = JSON.parse(encrypted) as EncEnvelope;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

// ── Org ID resolution ─────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

// ── Destination helper: fetch + decrypt webhook URL ───────────────────────────

async function getDestinationWebhook(
  destinationId: string,
  orgId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('slack_destinations')
    .select('webhook_url, enabled')
    .eq('id', destinationId)
    .eq('organization_id', orgId)
    .single();

  if (!data || !data.enabled) return null;
  return decryptText(data.webhook_url as string);
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateDestinationSchema = z.object({
  name: z.string().min(1).max(100),
  webhook_url: z.string().url().startsWith('https://hooks.slack.com/'),
  channel_hint: z.string().max(100).optional(),
});

const UpdateDestinationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  channel_hint: z.string().max(100).nullable().optional(),
  enabled: z.boolean().optional(),
});

const ShareBodySchema = z.object({
  destinationId: z.string().uuid(),
});

// ── GET /api/slack/destinations ───────────────────────────────────────────────

slackRouter.get('/destinations', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const { data, error } = await supabaseAdmin
      .from('slack_destinations')
      .select('id, name, channel_hint, enabled, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ data: data ?? [] });
  } catch (err) {
    sendInternalError(res, err, 'GET /api/slack/destinations');
  }
});

// ── POST /api/slack/destinations ──────────────────────────────────────────────

slackRouter.post('/destinations', async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateDestinationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const encrypted = encryptText(parsed.data.webhook_url);

    const { data, error } = await supabaseAdmin
      .from('slack_destinations')
      .insert({
        organization_id: orgId,
        name: parsed.data.name,
        webhook_url: encrypted,
        channel_hint: parsed.data.channel_hint ?? null,
      })
      .select('id, name, channel_hint, enabled, created_at')
      .single();

    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/destinations');
  }
});

// ── PATCH /api/slack/destinations/:id ────────────────────────────────────────

slackRouter.patch('/destinations/:id', async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateDestinationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.channel_hint !== undefined) patch.channel_hint = parsed.data.channel_hint;
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;

    const { data, error } = await supabaseAdmin
      .from('slack_destinations')
      .update(patch)
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .select('id, name, channel_hint, enabled, created_at')
      .single();

    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Destination not found' }); return; }
    res.json({ data });
  } catch (err) {
    sendInternalError(res, err, 'PATCH /api/slack/destinations/:id');
  }
});

// ── DELETE /api/slack/destinations/:id ───────────────────────────────────────

slackRouter.delete('/destinations/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const { error } = await supabaseAdmin
      .from('slack_destinations')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', orgId);

    if (error) throw error;
    res.json({ message: 'Destination deleted' });
  } catch (err) {
    sendInternalError(res, err, 'DELETE /api/slack/destinations/:id');
  }
});

// ── POST /api/slack/destinations/:id/test ────────────────────────────────────

slackRouter.post('/destinations/:id/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(req.params.id, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const ok = await sendSlackMessage(
      webhookUrl,
      [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: ':white_check_mark: *Atlas connection test* — this destination is working correctly.' },
        },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Atlas · atlas.vimi.digital' }] },
      ],
      'Atlas connection test',
    );

    if (!ok) { res.status(502).json({ error: 'Failed to deliver test message to Slack' }); return; }
    res.json({ message: 'Test message sent' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/destinations/:id/test');
  }
});

// ── POST /api/slack/share/audit/:auditId ─────────────────────────────────────

slackRouter.post('/share/audit/:auditId', async (req: Request, res: Response): Promise<void> => {
  const parsed = ShareBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'destinationId is required' }); return; }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(parsed.data.destinationId, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const { data: report, error } = await supabaseAdmin
      .from('audit_reports')
      .select('report_json')
      .eq('audit_id', req.params.auditId)
      .single();

    if (error || !report) { res.status(404).json({ error: 'Audit report not found' }); return; }

    const rj = report.report_json as {
      executive_summary?: {
        overall_status?: string;
        business_summary?: string;
        scores?: {
          conversion_signal_health?: number;
          attribution_risk_level?: string;
        };
      };
      issues?: Array<{ severity: string }>;
    };

    const counts = { critical: 0, high: 0 };
    for (const issue of rj.issues ?? []) {
      if (issue.severity === 'critical') counts.critical++;
      else if (issue.severity === 'high') counts.high++;
    }

    const { blocks, text } = buildAuditMessage({
      auditId: req.params.auditId,
      status: rj.executive_summary?.overall_status ?? 'unknown',
      businessSummary: rj.executive_summary?.business_summary ?? '',
      conversionSignalHealth: rj.executive_summary?.scores?.conversion_signal_health ?? 0,
      attributionRisk: rj.executive_summary?.scores?.attribution_risk_level ?? '—',
      criticalCount: counts.critical,
      highCount: counts.high,
    });

    const ok = await sendSlackMessage(webhookUrl, blocks, text);
    if (!ok) { res.status(502).json({ error: 'Failed to deliver message to Slack' }); return; }
    res.json({ message: 'Shared to Slack' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/share/audit/:auditId');
  }
});

// ── POST /api/slack/share/brief/:briefId ─────────────────────────────────────

slackRouter.post('/share/brief/:briefId', async (req: Request, res: Response): Promise<void> => {
  const parsed = ShareBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'destinationId is required' }); return; }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(parsed.data.destinationId, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const { data: brief, error: briefErr } = await supabaseAdmin
      .from('strategy_briefs')
      .select('brief_name, version_no, locked_at, client_id')
      .eq('id', req.params.briefId)
      .eq('organization_id', orgId)
      .single();

    if (briefErr || !brief) { res.status(404).json({ error: 'Brief not found' }); return; }

    const { data: objectives } = await supabaseAdmin
      .from('strategy_objectives')
      .select('name, verdict, platforms')
      .eq('brief_id', req.params.briefId)
      .eq('organization_id', orgId);

    let clientName: string | null = null;
    if (brief.client_id) {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('name')
        .eq('id', brief.client_id)
        .single();
      clientName = client?.name ?? null;
    }

    const { blocks, text } = buildStrategyBriefMessage({
      briefName: brief.brief_name,
      clientName,
      versionNo: brief.version_no,
      locked: !!brief.locked_at,
      objectives: (objectives ?? []).map((o) => ({
        name: o.name,
        verdict: o.verdict as string | null,
        platforms: (o.platforms ?? []) as string[],
      })),
    });

    const ok = await sendSlackMessage(webhookUrl, blocks, text);
    if (!ok) { res.status(502).json({ error: 'Failed to deliver message to Slack' }); return; }
    res.json({ message: 'Shared to Slack' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/share/brief/:briefId');
  }
});

// ── POST /api/slack/share/reconciliation/:runId ───────────────────────────────

slackRouter.post('/share/reconciliation/:runId', async (req: Request, res: Response): Promise<void> => {
  const parsed = ShareBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'destinationId is required' }); return; }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(parsed.data.destinationId, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const { data: run, error: runErr } = await supabaseAdmin
      .from('reconciliation_runs')
      .select('id, status, platforms_run, total_findings, client_id')
      .eq('id', req.params.runId)
      .eq('organization_id', orgId)
      .single();

    if (runErr || !run) { res.status(404).json({ error: 'Reconciliation run not found' }); return; }

    const { data: findings } = await supabaseAdmin
      .from('reconciliation_findings')
      .select('severity, narrative, dimension, platform')
      .eq('run_id', req.params.runId)
      .is('resolved_at', null)
      .order('severity', { ascending: true })
      .limit(20);

    const bySeverity: Record<string, number> = {};
    for (const f of findings ?? []) {
      const sev = f.severity as string;
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }

    let clientName: string | null = null;
    if (run.client_id) {
      const { data: client } = await supabaseAdmin.from('clients').select('name').eq('id', run.client_id).single();
      clientName = client?.name ?? null;
    }

    const { blocks, text } = buildReconciliationMessage({
      runId: run.id,
      clientName,
      status: run.status,
      platformsRun: (run.platforms_run ?? []) as string[],
      totalFindings: run.total_findings ?? 0,
      bySeverity,
      topFindings: (findings ?? []).slice(0, 5).map((f) => ({
        narrative: f.narrative as string,
        severity: f.severity as string,
        dimension: f.dimension as string,
        platform: f.platform as string,
      })),
    });

    const ok = await sendSlackMessage(webhookUrl, blocks, text);
    if (!ok) { res.status(502).json({ error: 'Failed to deliver message to Slack' }); return; }
    res.json({ message: 'Shared to Slack' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/share/reconciliation/:runId');
  }
});

// ── POST /api/slack/share/ihc ─────────────────────────────────────────────────

slackRouter.post('/share/ihc', async (req: Request, res: Response): Promise<void> => {
  const parsed = ShareBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'destinationId is required' }); return; }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(parsed.data.destinationId, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const { data: findings } = await supabaseAdmin
      .from('audit_findings')
      .select('severity')
      .eq('organization_id', orgId)
      .in('status', ['open', 'acknowledged']);

    const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    for (const f of findings ?? []) {
      const sev = f.severity as string;
      counts.total++;
      if (sev === 'critical') counts.critical++;
      else if (sev === 'high') counts.high++;
      else if (sev === 'medium') counts.medium++;
      else counts.low++;
    }

    const { blocks, text } = buildIHCMessage({ clientName: null, ...counts });
    const ok = await sendSlackMessage(webhookUrl, blocks, text);
    if (!ok) { res.status(502).json({ error: 'Failed to deliver message to Slack' }); return; }
    res.json({ message: 'Shared to Slack' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/share/ihc');
  }
});

// ── POST /api/slack/share/signals ─────────────────────────────────────────────

slackRouter.post('/share/signals', async (req: Request, res: Response): Promise<void> => {
  const parsed = ShareBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'destinationId is required' }); return; }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(parsed.data.destinationId, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const { data: agg } = await supabaseAdmin
      .from('capi_events')
      .select('match_quality_score, latency_ms')
      .eq('organization_id', orgId)
      .gte('processed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5000);

    const events = agg ?? [];
    const totalSignals = events.length;
    const matchScores = events.map((e) => e.match_quality_score as number | null).filter((v): v is number => v != null);
    const latencies = events.map((e) => e.latency_ms as number | null).filter((v): v is number => v != null);
    const avgMatchQuality = matchScores.length ? matchScores.reduce((a, b) => a + b, 0) / matchScores.length : null;
    const avgLatencyMs = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

    const { blocks, text } = buildSignalAggregatesMessage({
      provider: null,
      totalSignals,
      avgMatchQuality,
      dedupHitRate: null,
      avgLatencyMs,
    });

    const ok = await sendSlackMessage(webhookUrl, blocks, text);
    if (!ok) { res.status(502).json({ error: 'Failed to deliver message to Slack' }); return; }
    res.json({ message: 'Shared to Slack' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/share/signals');
  }
});

// ── POST /api/slack/share/crawl/:runId ───────────────────────────────────────

slackRouter.post('/share/crawl/:runId', async (req: Request, res: Response): Promise<void> => {
  const parsed = ShareBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'destinationId is required' }); return; }

  try {
    const orgId = await resolveOrgId(req.user.id);
    const webhookUrl = await getDestinationWebhook(parsed.data.destinationId, orgId);
    if (!webhookUrl) { res.status(404).json({ error: 'Destination not found or disabled' }); return; }

    const { data: run, error: runErr } = await supabaseAdmin
      .from('crawl_runs')
      .select('id, mode, status, total_pages, pages_completed, started_at, completed_at, duration_seconds')
      .eq('id', req.params.runId)
      .eq('org_id', orgId)
      .single();

    if (runErr || !run) { res.status(404).json({ error: 'Crawl run not found' }); return; }

    const { data: signals } = await supabaseAdmin
      .from('detected_signals')
      .select('health_status, is_regression')
      .eq('crawl_run_id', req.params.runId);

    const sigStats = { healthy: 0, degraded: 0, missing: 0, total: 0, regressions: 0 };
    for (const s of signals ?? []) {
      sigStats.total++;
      const hs = s.health_status as string;
      if (hs === 'healthy') sigStats.healthy++;
      else if (hs === 'degraded' || hs === 'misconfigured') sigStats.degraded++;
      else if (hs === 'missing') sigStats.missing++;
      if (s.is_regression) sigStats.regressions++;
    }

    const { blocks, text } = buildCrawlRunMessage({
      runId: run.id,
      mode: run.mode as string,
      status: run.status as string,
      totalPages: run.total_pages ?? 0,
      pagesCompleted: run.pages_completed ?? 0,
      signalsFound: sigStats.total,
      signalsHealthy: sigStats.healthy,
      signalsDegraded: sigStats.degraded,
      signalsMissing: sigStats.missing,
      regressionsCount: sigStats.regressions,
      durationSeconds: run.duration_seconds as number | null,
    });

    const ok = await sendSlackMessage(webhookUrl, blocks, text);
    if (!ok) { res.status(502).json({ error: 'Failed to deliver message to Slack' }); return; }
    res.json({ message: 'Shared to Slack' });
  } catch (err) {
    sendInternalError(res, err, 'POST /api/slack/share/crawl/:runId');
  }
});

