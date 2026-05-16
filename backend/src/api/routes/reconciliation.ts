/**
 * Platform Reconciliation — Reconciliation routes
 *
 * GET    /api/reconciliation/runs?clientId=X          — list runs for a client
 * GET    /api/reconciliation/runs/:id                 — run detail with findings by dimension
 * GET    /api/reconciliation/runs/:id/findings        — findings with optional filters
 * PATCH  /api/reconciliation/findings/:id/resolve     — mark a finding resolved
 * POST   /api/reconciliation/trigger                  — manual run for a client
 * GET    /api/reconciliation/tolerance?clientId=X     — list tolerance configs
 * PUT    /api/reconciliation/tolerance                — upsert tolerance config
 * GET    /api/reconciliation/stats?clientId=X         — daily event stats time-series
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { reconciliationRunQueue } from '@/services/queue/jobQueue';
import { createRun } from '@/services/reconciliation/reconciliationRunner';

export const reconciliationRouter = Router();

reconciliationRouter.use(authMiddleware);

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

// ── GET /api/reconciliation/runs ──────────────────────────────────────────────

reconciliationRouter.get(
  '/runs',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const clientId = req.query.clientId as string | undefined;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('reconciliation_runs')
        .select('id, run_type, started_at, finished_at, status, platforms_run, total_findings, error_summary, brief_id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      res.json({ data: data ?? [] });
    } catch (err) {
      sendInternalError(res, err, 'GET /api/reconciliation/runs');
    }
  },
);

// ── GET /api/reconciliation/runs/:id ─────────────────────────────────────────

reconciliationRouter.get(
  '/runs/:id',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await resolveOrgId(req.user.id);

      const { data: run, error: runErr } = await supabaseAdmin
        .from('reconciliation_runs')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .single();

      if (runErr || !run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      const { data: findings, error: findErr } = await supabaseAdmin
        .from('reconciliation_findings')
        .select('*')
        .eq('run_id', req.params.id)
        .order('severity', { ascending: false })
        .order('dimension');

      if (findErr) throw findErr;

      // Group findings by dimension
      const byDimension: Record<string, unknown[]> = {
        delivery: [],
        config: [],
        alignment: [],
        volume: [],
      };
      for (const f of findings ?? []) {
        const dim = (f as { dimension: string }).dimension;
        (byDimension[dim] ??= []).push(f);
      }

      res.json({ data: { run, findings_by_dimension: byDimension, all_findings: findings ?? [] } });
    } catch (err) {
      sendInternalError(res, err, 'GET /api/reconciliation/runs/:id');
    }
  },
);

// ── GET /api/reconciliation/runs/:id/findings ─────────────────────────────────

const FindingsQuerySchema = z.object({
  dimension: z.enum(['delivery', 'config', 'alignment', 'volume']).optional(),
  severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
  platform: z.string().optional(),
  resolved: z.enum(['true', 'false']).optional(),
});

reconciliationRouter.get(
  '/runs/:id/findings',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = FindingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);

      // Verify run belongs to org
      const { data: run } = await supabaseAdmin
        .from('reconciliation_runs')
        .select('id')
        .eq('id', req.params.id)
        .eq('organization_id', orgId)
        .single();

      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      let query = supabaseAdmin
        .from('reconciliation_findings')
        .select('*')
        .eq('run_id', req.params.id);

      const { dimension, severity, platform, resolved } = parsed.data;
      if (dimension) query = query.eq('dimension', dimension);
      if (severity) query = query.eq('severity', severity);
      if (platform) query = query.eq('platform', platform);
      if (resolved === 'true') query = query.not('resolved_at', 'is', null);
      if (resolved === 'false') query = query.is('resolved_at', null);

      const { data, error } = await query.order('severity', { ascending: false }).order('dimension');
      if (error) throw error;

      res.json({ data: data ?? [] });
    } catch (err) {
      sendInternalError(res, err, 'GET /api/reconciliation/runs/:id/findings');
    }
  },
);

// ── PATCH /api/reconciliation/findings/:id/resolve ────────────────────────────

reconciliationRouter.patch(
  '/findings/:id/resolve',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await resolveOrgId(req.user.id);
      const { error } = await supabaseAdmin
        .from('reconciliation_findings')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('organization_id', orgId);

      if (error) throw error;
      res.json({ message: 'Finding resolved' });
    } catch (err) {
      sendInternalError(res, err, 'PATCH /api/reconciliation/findings/:id/resolve');
    }
  },
);

// ── POST /api/reconciliation/trigger ─────────────────────────────────────────

const TriggerBody = z.object({
  clientId: z.string().uuid(),
  briefId: z.string().uuid().optional(),
});

reconciliationRouter.post(
  '/trigger',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = TriggerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const { clientId, briefId } = parsed.data;

      const runId = await createRun(orgId, clientId, 'manual', briefId);
      await reconciliationRunQueue.add({
        runId,
        organizationId: orgId,
        clientId,
        briefId: briefId ?? null,
        runType: 'manual',
      });

      res.json({ data: { runId }, message: 'Reconciliation run enqueued' });
    } catch (err) {
      sendInternalError(res, err, 'POST /api/reconciliation/trigger');
    }
  },
);

// ── GET /api/reconciliation/tolerance ────────────────────────────────────────

reconciliationRouter.get(
  '/tolerance',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const clientId = req.query.clientId as string | undefined;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('reconciliation_tolerance_configs')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('created_at', { ascending: true }) as unknown as { data: unknown[] | null; error: Error | null };

      if (error) throw error;
      res.json({ data: data ?? [] });
    } catch (err) {
      sendInternalError(res, err, 'GET /api/reconciliation/tolerance');
    }
  },
);

// ── PUT /api/reconciliation/tolerance ────────────────────────────────────────

const ToleranceBody = z.object({
  clientId: z.string().uuid(),
  eventName: z.string().optional().nullable(),
  platform: z.enum(['google_ads', 'meta', 'ga4']).optional().nullable(),
  volumeTolerancePct: z.number().min(0).max(100).optional(),
  dedupWarnThreshold: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
});

reconciliationRouter.put(
  '/tolerance',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ToleranceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const { clientId, eventName, platform, volumeTolerancePct, dedupWarnThreshold, enabled } = parsed.data;

      const patch: Record<string, unknown> = {
        organization_id: orgId,
        client_id: clientId,
        event_name: eventName ?? null,
        platform: platform ?? null,
        updated_at: new Date().toISOString(),
      };
      if (volumeTolerancePct !== undefined) patch.volume_tolerance_pct = volumeTolerancePct;
      if (dedupWarnThreshold !== undefined) patch.dedup_warn_threshold = dedupWarnThreshold;
      if (enabled !== undefined) patch.enabled = enabled;

      const { data, error } = await (supabaseAdmin
        .from('reconciliation_tolerance_configs') as unknown as {
          upsert: (row: Record<string, unknown>, opts: object) => {
            select: (cols: string) => { single: () => Promise<{ data: unknown; error: Error | null }> };
          };
        })
        .upsert(patch, { onConflict: 'organization_id,client_id,event_name,platform' })
        .select('*')
        .single();

      if (error) throw error;
      res.json({ data });
    } catch (err) {
      sendInternalError(res, err, 'PUT /api/reconciliation/tolerance');
    }
  },
);

// ── GET /api/reconciliation/stats ─────────────────────────────────────────────

const StatsQuerySchema = z.object({
  clientId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(90).optional().default(7),
  eventName: z.string().optional(),
  platform: z.enum(['google_ads', 'meta', 'ga4']).optional(),
});

reconciliationRouter.get(
  '/stats',
  planGuard('pro'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = StatsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    try {
      const orgId = await resolveOrgId(req.user.id);
      const { clientId, days, eventName, platform } = parsed.data;

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let connQuery = supabaseAdmin
        .from('platform_connections')
        .select('id, platform')
        .eq('client_id', clientId)
        .eq('organization_id', orgId)
        .eq('status', 'active');
      if (platform) connQuery = connQuery.eq('platform', platform);

      const { data: connections } = await connQuery as unknown as { data: { id: string; platform: string }[] | null };
      if (!connections?.length) {
        res.json({ data: [] });
        return;
      }

      const connIds = connections.map((c) => c.id);
      const connPlatform = new Map(connections.map((c) => [c.id, c.platform]));

      let statsQuery = supabaseAdmin
        .from('platform_event_stats_daily')
        .select('connection_id, date, event_name, platform_count, atlas_count, delta_pct, quality_signals')
        .in('connection_id', connIds)
        .gte('date', since)
        .order('date', { ascending: false });
      if (eventName) statsQuery = statsQuery.eq('event_name', eventName);

      const { data: rows, error } = await statsQuery as unknown as {
        data: { connection_id: string; date: string; event_name: string; platform_count: number; atlas_count: number | null; delta_pct: number | null; quality_signals: unknown }[] | null;
        error: Error | null;
      };
      if (error) throw error;

      // Group by event_name + platform
      const grouped = new Map<string, unknown[]>();
      for (const row of rows ?? []) {
        const plt = connPlatform.get(row.connection_id) ?? 'unknown';
        const key = `${row.event_name}::${plt}`;
        const entry = grouped.get(key) ?? [];
        entry.push({ ...row, platform: plt });
        grouped.set(key, entry);
      }

      const result = Array.from(grouped.entries()).map(([key, entries]) => {
        const [evtName, plt] = key.split('::');
        return { event_name: evtName, platform: plt, rows: entries };
      });

      res.json({ data: result });
    } catch (err) {
      sendInternalError(res, err, 'GET /api/reconciliation/stats');
    }
  },
);
