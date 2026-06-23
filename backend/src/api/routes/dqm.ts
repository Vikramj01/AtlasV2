import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { supabaseAdmin } from '@/services/database/supabase';
import { dqmQueue } from '@/services/queue/jobQueue';

export const dqmRouter = Router();

async function resolveOrgId(userId: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  return (profile as { organization_id?: string } | null)?.organization_id ?? userId;
}

// GET /api/dqm/status — returns current DQM state for the authenticated org
dqmRouter.get('/status', authMiddleware, async (req, res) => {
  const orgId = await resolveOrgId(req.user!.id);

  const [gtgRows, dmaRow] = await Promise.all([
    supabaseAdmin
      .from('dqm_gtg_checks')
      .select('check_status, http_status, response_ms, error_message, checked_at')
      .eq('org_id', orgId)
      .order('checked_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('dqm_dma_poll_state')
      .select('last_polled_at, last_successful_at, upload_success_rate, avg_match_rate, total_members_30d, destination_count, error_categories, backoff_until, consecutive_failures, updated_at')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);

  type GTGRow = {
    check_status: string;
    http_status: number | null;
    response_ms: number | null;
    error_message: string | null;
    checked_at: string;
  };
  type DMARow = {
    last_polled_at: string | null;
    last_successful_at: string | null;
    upload_success_rate: number | null;
    avg_match_rate: number | null;
    total_members_30d: number;
    destination_count: number;
    error_categories: Record<string, number>;
    backoff_until: string | null;
    consecutive_failures: number;
    updated_at: string;
  };

  const checks = (gtgRows.data ?? []) as GTGRow[];
  const latestStatus = checks[0]?.check_status ?? 'unknown';

  const dma = dmaRow.data as DMARow | null;
  const backoffUntil = dma?.backoff_until ?? null;
  const isInBackoff = backoffUntil !== null && new Date(backoffUntil) > new Date();

  res.json({
    data: {
      gtg: {
        latest_status: latestStatus,
        recent_checks: checks,
      },
      dma: dma
        ? {
            last_polled_at:      dma.last_polled_at,
            last_successful_at:  dma.last_successful_at,
            upload_success_rate: dma.upload_success_rate,
            avg_match_rate:      dma.avg_match_rate,
            total_members_30d:   dma.total_members_30d,
            destination_count:   dma.destination_count,
            error_categories:    dma.error_categories,
            consecutive_failures: dma.consecutive_failures,
            backoff_until:       backoffUntil,
            is_in_backoff:       isInBackoff,
            updated_at:          dma.updated_at,
          }
        : null,
    },
  });
});

// GET /api/dqm/runs — paginated run log for the authenticated org
const runsQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

dqmRouter.get('/runs', authMiddleware, async (req, res) => {
  const parsed = runsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    return;
  }
  const { limit, offset } = parsed.data;
  const orgId = await resolveOrgId(req.user!.id);

  const { data, error } = await supabaseAdmin
    .from('dqm_run_log')
    .select('id, check_type, status, latency_ms, triggered_by, alert_action, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch DQM run log' });
    return;
  }

  res.json({ data: data ?? [] });
});

// POST /api/dqm/trigger — manually trigger a DQM run for the authenticated org
dqmRouter.post('/trigger', authMiddleware, async (req, res) => {
  const orgId = await resolveOrgId(req.user!.id);
  await dqmQueue.add({ trigger: 'manual', org_id: orgId });
  res.json({ data: { queued: true, org_id: orgId } });
});
