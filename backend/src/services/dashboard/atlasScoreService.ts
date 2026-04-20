import { supabaseAdmin as supabase } from '@/services/database/supabase';

export interface AtlasScore {
  overall: number;
  foundation: number;      // strategy locked + consent live + GTM deployed
  signal_quality: number;  // tracking health check results + match quality
  channel_performance: number; // channel leak report
  updated_at: string;
}

export async function buildAtlasScore(userId: string): Promise<AtlasScore> {
  const now = new Date().toISOString();

  const [healthResult, consentResult, capiResult, sessionResult, briefResult, channelResult] =
    await Promise.all([
      supabase
        .from('health_scores')
        .select('overall_score, signal_health, capi_delivery_rate, computed_at')
        .eq('user_id', userId)
        .maybeSingle(),

      supabase
        .from('consent_configs')
        .select('id')
        .eq('organization_id', userId)
        .limit(1),

      supabase
        .from('capi_providers')
        .select('id, status')
        .eq('organization_id', userId),

      supabase
        .from('planning_sessions')
        .select('id')
        .eq('user_id', userId)
        .in('status', ['outputs_ready'])
        .limit(1),

      supabase
        .from('strategy_briefs')
        .select('id')
        .eq('organization_id', userId)
        .limit(1),

      supabase
        .from('channel_sessions')
        .select('id')
        .eq('organization_id', userId)
        .limit(1),
    ]);

  // ── Foundation sub-score (0–100) ──────────────────────────────────────────
  // 33 pts — strategy brief created
  // 34 pts — consent configured
  // 33 pts — GTM container deployed (planning session outputs_ready)
  const strategyLocked = (briefResult.data?.length ?? 0) > 0;
  const consentLive = (consentResult.data?.length ?? 0) > 0;
  const gtmDeployed = (sessionResult.data?.length ?? 0) > 0;

  const foundation = Math.round(
    (strategyLocked ? 33 : 0) + (consentLive ? 34 : 0) + (gtmDeployed ? 33 : 0),
  );

  // ── Signal quality sub-score (0–100) ──────────────────────────────────────
  // Derived from health_scores.overall_score (already 0–100).
  // Falls back to 0 if no health data yet.
  const signalQuality = Math.round(
    (healthResult.data?.overall_score as number | null) ?? 0,
  );

  // ── Channel performance sub-score (0–100) ─────────────────────────────────
  // Derived from health_scores.signal_health (0–100).
  // Falls back to 0 if no channel data present.
  const hasChannelData = (channelResult.data?.length ?? 0) > 0;
  const channelPerformance = hasChannelData
    ? Math.round((healthResult.data?.signal_health as number | null) ?? 0)
    : 0;

  // ── Overall (weighted average) ────────────────────────────────────────────
  // foundation 30%, signal_quality 50%, channel_performance 20%
  const overall = Math.round(
    foundation * 0.3 + signalQuality * 0.5 + channelPerformance * 0.2,
  );

  const updatedAt =
    (healthResult.data?.computed_at as string | null) ?? now;

  return { overall, foundation, signal_quality: signalQuality, channel_performance: channelPerformance, updated_at: updatedAt };
}
