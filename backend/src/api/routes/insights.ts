import { Router } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { planGuard } from '@/api/middleware/planGuard';
import { supabaseAdmin } from '@/services/database/supabase';

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
