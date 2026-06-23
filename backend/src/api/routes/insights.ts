import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { planGuard } from '@/api/middleware/planGuard';
import { supabaseAdmin } from '@/services/database/supabase';
import { airIngestionQueue } from '@/services/queue/jobQueue';
import { yesterday } from '@/services/air/ingestion/airIngestionUtils';

export const insightsRouter = Router();

async function resolveOrgId(userId: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  return (profile as { organization_id?: string } | null)?.organization_id ?? userId;
}

// GET /api/insights — returns AIR insight feed for the authenticated org.
// Each insight includes the narrated text and the anomaly context that generated it.
insightsRouter.get('/', authMiddleware, planGuard('pro'), async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.user!.id);

    const { data: insights, error } = await supabaseAdmin
      .from('air_insights')
      .select('id, narrative, status, model_version, anomaly_id, created_at, air_anomalies(source, metric_name, dimension, detected_date, deviation_pct, severity, observed_value, baseline_value)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch insights', data: null });
    }

    return res.json({ data: insights ?? [], message: null });
  } catch {
    return res.status(500).json({ error: 'Internal server error', data: null });
  }
});

const patchSchema = z.object({
  status: z.enum(['read', 'dismissed']),
});

// PATCH /api/insights/:id — update an insight's read/dismissed status.
insightsRouter.patch('/:id', authMiddleware, planGuard('pro'), async (req, res) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'status must be "read" or "dismissed"', data: null });
    }

    const orgId = await resolveOrgId(req.user!.id);

    const { error } = await supabaseAdmin
      .from('air_insights')
      .update({ status: parsed.data.status })
      .eq('id', req.params.id)
      .eq('org_id', orgId);

    if (error) {
      return res.status(500).json({ error: 'Failed to update insight', data: null });
    }

    return res.json({ data: { status: parsed.data.status }, message: null });
  } catch {
    return res.status(500).json({ error: 'Internal server error', data: null });
  }
});

// POST /api/insights/trigger — enqueues an on-demand AIR job for the authenticated org.
// Deduplicates by jobId so a second call while a job is active returns 202 already_queued.
insightsRouter.post('/trigger', authMiddleware, planGuard('pro'), async (req, res) => {
  try {
    const orgId = await resolveOrgId(req.user!.id);
    const date  = yesterday();
    const jobId = `air-ingest:${orgId}:manual`;

    const existing = await airIngestionQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (['active', 'waiting', 'delayed'].includes(state)) {
        return res.status(202).json({ data: { status: 'already_queued', date }, message: null });
      }
    }

    await airIngestionQueue.add(
      { trigger: 'manual', org_id: orgId },
      {
        jobId,
        attempts:         2,
        backoff:          { type: 'exponential', delay: 30_000 },
        removeOnComplete: 5,
        removeOnFail:     5,
      },
    );

    return res.status(202).json({ data: { status: 'queued', date }, message: null });
  } catch {
    return res.status(500).json({ error: 'Internal server error', data: null });
  }
});
