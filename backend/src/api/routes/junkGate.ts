/**
 * Junk conversion gate API — everything under /api/junk-gate (GA4 Admin / L11 / Junk Gate PRD
 * §C.8–C.9, C2). `pro` plan, org-scoped (org id = the authenticated user's id, like /api/capi).
 *
 * GET  /config?client_id=      — the client's gate config (defaults when none saved) + clamp info
 * PUT  /config                 — save the config (Zod-validated; mode defaults to observe)
 * GET  /holds                  — review queue / observe-mode "would have held" log
 * POST /holds/:id/release      — release one hold (delivers through the normal pipeline)
 * POST /holds/:id/reject       — reject one hold (never delivered)
 * POST /holds/bulk             — release / reject up to 100 holds
 * GET  /metrics?client_id=     — hold rate, per-rule hit + overturn rates, auto-release/drop counts
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { sendInternalError } from '@/utils/apiError';
import { resolveGateConfig } from '@/services/capi/junkGate/config';
import { JUNK_RULE_IDS } from '@/services/capi/junkGate/types';
import { holdCeilingHours } from '@/services/capi/junkGate/holdWindows';
import { computeJunkMetrics } from '@/services/capi/junkGate/metrics';
import { releaseHold, rejectHold, type HoldActionResult } from '@/services/capi/junkGate/release';
import {
  clientBelongsToOrg, getFullJunkGateConfig, upsertJunkGateConfig, listHolds, listProvidersForClient, listMetricRows, type HoldRow,
} from '@/services/database/junkGateQueries';

export const junkGateRouter = Router();
junkGateRouter.use(authMiddleware, planGuard('pro'));

const fail = (res: Response, status: number, error: string, message: string): void => {
  res.status(status).json({ data: null, error, message });
};

const ConfigBody = z.object({
  client_id: z.string().uuid(),
  mode: z.enum(['off', 'observe', 'enforce']).optional(),
  event_names: z.array(z.string().min(1).max(100)).max(50).optional(),
  rule_flags: z.record(z.enum(JUNK_RULE_IDS), z.boolean()).optional(),
  thresholds: z.object({
    duplicate_window_minutes: z.number().positive().max(1440),
    velocity_max: z.number().int().positive().max(1000),
    velocity_window_minutes: z.number().positive().max(1440),
    suspect_soft_hits: z.number().int().min(1).max(10),
    min_submit_ms: z.number().int().min(100).max(60_000),
  }).partial().optional(),
  action_junk: z.enum(['hold', 'drop', 'send']).optional(),
  action_suspect: z.enum(['hold', 'drop', 'send']).optional(),
  hold_timeout_hours: z.number().int().min(1).max(72).optional(),
  timeout_action: z.enum(['release', 'drop']).optional(),
  hold_rate_alert_pct: z.number().int().min(1).max(100).optional(),
}).strict();

async function configView(orgId: string, clientId: string) {
  const row = await getFullJunkGateConfig(orgId, clientId);
  const config = resolveGateConfig(row);
  const providers = await listProvidersForClient(orgId, clientId);
  const ceiling = providers.length > 0 ? holdCeilingHours(providers) : null;
  return {
    config,
    saved: !!row,
    // The shortest-window ceiling across this client's providers; a longer saved timeout is shortened to it.
    hold_ceiling_hours: ceiling,
    timeout_will_clamp: ceiling !== null && config.hold_timeout_hours > ceiling,
  };
}

junkGateRouter.get('/config', async (req: Request, res: Response): Promise<void> => {
  const clientId = z.string().uuid().safeParse(req.query.client_id);
  if (!clientId.success) return fail(res, 400, 'VALIDATION_FAILED', 'client_id is required');
  const orgId = req.user!.id;
  try {
    if (!(await clientBelongsToOrg(orgId, clientId.data))) return fail(res, 404, 'NOT_FOUND', 'Client not found');
    res.json({ data: await configView(orgId, clientId.data), error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to load junk gate config');
  }
});

junkGateRouter.put('/config', async (req: Request, res: Response): Promise<void> => {
  const parsed = ConfigBody.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid request body');
  const orgId = req.user!.id;
  try {
    if (!(await clientBelongsToOrg(orgId, parsed.data.client_id))) return fail(res, 404, 'NOT_FOUND', 'Client not found');
    await upsertJunkGateConfig(orgId, parsed.data);
    res.json({ data: await configView(orgId, parsed.data.client_id), error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to save junk gate config');
  }
});

const HOLD_STATUSES = ['observed', 'held', 'released', 'rejected', 'auto_released', 'auto_dropped'] as const;
const ListQuery = z.object({
  client_id: z.string().uuid().optional(),
  status: z.string().optional(),
  verdict: z.enum(['junk', 'suspect']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function toView(row: HoldRow, now: number) {
  const remaining = row.status === 'held' && row.expires_at ? Math.max(0, Math.round((new Date(row.expires_at).getTime() - now) / 1000)) : null;
  return {
    id: row.id,
    client_id: row.client_id,
    event_name: row.event_name,
    event_time: row.event_time,
    verdict: row.verdict,
    status: row.status,
    // Rule ids and non-PII evidence only (an e-mail DOMAIN at most) — see rules.ts.
    rule_hits: row.rule_hits,
    delivery_class: row.delivery_class,
    expires_at: row.expires_at,
    seconds_remaining: remaining,
    timeout_hours_applied: row.timeout_hours_applied,
    timeout_clamped: row.timeout_clamped,
    decided_at: row.decided_at,
    created_at: row.created_at,
    // Observe mode never held anything: this row is the "would have held" log.
    would_have_held: row.status === 'observed',
  };
}

junkGateRouter.get('/holds', async (req: Request, res: Response): Promise<void> => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) return fail(res, 400, 'VALIDATION_FAILED', q.error.issues[0]?.message ?? 'Invalid query');
  const statuses = q.data.status ? q.data.status.split(',').filter((s): s is (typeof HOLD_STATUSES)[number] => (HOLD_STATUSES as readonly string[]).includes(s)) : undefined;
  try {
    const { rows, total } = await listHolds(req.user!.id, { ...q.data, status: statuses });
    const now = Date.now();
    res.json({ data: { holds: rows.map((r) => toView(r, now)), total }, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to list held conversions');
  }
});

const respond = (res: Response, r: HoldActionResult): void => {
  if (r.outcome === 'not_found') return fail(res, 404, 'NOT_FOUND', 'Hold not found');
  if (r.outcome === 'not_held') return fail(res, 409, 'NOT_HELD', 'This conversion is no longer being held');
  res.json({ data: r, error: null, message: null });
};

junkGateRouter.post('/holds/bulk', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), action: z.enum(['release', 'reject']) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid request body');
  const orgId = req.user!.id;
  try {
    const results: Array<{ id: string } & HoldActionResult> = [];
    for (const id of parsed.data.ids) {
      const r = parsed.data.action === 'release' ? await releaseHold(id, orgId, orgId) : await rejectHold(id, orgId, orgId);
      results.push({ id, ...r });
    }
    res.json({ data: { results, done: results.filter((r) => r.outcome === 'done').length }, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to process held conversions');
  }
});

junkGateRouter.post('/holds/:id/release', async (req: Request, res: Response): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return fail(res, 400, 'VALIDATION_FAILED', 'Invalid hold id');
  try { respond(res, await releaseHold(id.data, req.user!.id, req.user!.id)); } catch (err) { sendInternalError(res, err, 'Failed to release held conversion'); }
});

junkGateRouter.post('/holds/:id/reject', async (req: Request, res: Response): Promise<void> => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return fail(res, 400, 'VALIDATION_FAILED', 'Invalid hold id');
  try { respond(res, await rejectHold(id.data, req.user!.id, req.user!.id)); } catch (err) { sendInternalError(res, err, 'Failed to reject held conversion'); }
});

junkGateRouter.get('/metrics', async (req: Request, res: Response): Promise<void> => {
  const q = z.object({ client_id: z.string().uuid(), days: z.coerce.number().int().min(1).max(90).default(30) }).safeParse(req.query);
  if (!q.success) return fail(res, 400, 'VALIDATION_FAILED', q.error.issues[0]?.message ?? 'client_id is required');
  const orgId = req.user!.id;
  try {
    if (!(await clientBelongsToOrg(orgId, q.data.client_id))) return fail(res, 404, 'NOT_FOUND', 'Client not found');
    const since = new Date(Date.now() - q.data.days * 86_400_000).toISOString();
    const { rows, truncated } = await listMetricRows(orgId, q.data.client_id, since);
    res.json({ data: computeJunkMetrics(rows, q.data.days, truncated), error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to compute junk gate metrics');
  }
});
