/**
 * Platform Reconciliation — Reconciliation routes
 *
 * GET    /api/reconciliation/runs?clientId=X          — list runs for a client
 * GET    /api/reconciliation/runs/:id                 — run detail with findings by dimension
 * GET    /api/reconciliation/runs/:id/findings        — findings with optional filters
 * PATCH  /api/reconciliation/findings/:id/resolve     — mark a finding resolved
 * POST   /api/reconciliation/trigger                  — manual run for a client
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
