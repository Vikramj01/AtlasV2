import { Router } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { supabaseAdmin } from '@/services/database/supabase';
import { dqmQueue } from '@/services/queue/jobQueue';

export const dqmRouter = Router();

// GET /api/dqm/status — returns current DQM state for the authenticated org
dqmRouter.get('/status', authMiddleware, async (req, res) => {
  const userId = req.user!.id;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();

  const orgId = (profile as { organization_id?: string } | null)?.organization_id ?? userId;

  const [gtgRows, dmaState] = await Promise.all([
    supabaseAdmin
      .from('dqm_gtg_checks')
      .select('check_status, http_status, response_ms, error_message, checked_at')
      .eq('org_id', orgId)
      .order('checked_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('dqm_dma_poll_state')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);

  res.json({
    gtg: {
      recent_checks: gtgRows.data ?? [],
      latest_status: (gtgRows.data?.[0] as { check_status?: string } | undefined)?.check_status ?? 'unknown',
    },
    dma: dmaState.data ?? null,
  });
});

// POST /api/dqm/trigger — manually trigger a DQM run for the authenticated org
dqmRouter.post('/trigger', authMiddleware, async (req, res) => {
  const userId = req.user!.id;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();

  const orgId = (profile as { organization_id?: string } | null)?.organization_id ?? userId;

  await dqmQueue.add({ trigger: 'manual', org_id: orgId });
  res.json({ queued: true, org_id: orgId });
});
