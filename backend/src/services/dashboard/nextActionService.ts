import { supabaseAdmin as supabase } from '@/services/database/supabase';

export interface NextAction {
  action_id: string;
  copy: string;
  cta_route: string;
  eta_minutes: number;
  priority: number;
}

export async function buildNextAction(userId: string): Promise<NextAction> {
  const [briefResult, sessionResult, healthResult, capiResult, consentResult, outputResult] =
    await Promise.all([
      supabase
        .from('strategy_briefs')
        .select('id')
        .eq('organization_id', userId)
        .limit(1),

      supabase
        .from('planning_sessions')
        .select('id, created_at')
        .eq('user_id', userId)
        .in('status', ['outputs_ready', 'review_ready'])
        .order('created_at', { ascending: false })
        .limit(1),

      supabase
        .from('health_scores')
        .select('overall_score, computed_at')
        .eq('user_id', userId)
        .maybeSingle(),

      supabase
        .from('capi_providers')
        .select('id, provider, status')
        .eq('organization_id', userId)
        .eq('status', 'active'),

      supabase
        .from('consent_configs')
        .select('id, gcm_mapping')
        .eq('organization_id', userId)
        .limit(1),

      supabase
        .from('planning_outputs')
        .select('output_type, created_at')
        .eq('output_type', 'gtm_container')
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

  // Priority 1 — No strategy brief
  const hasBrief = (briefResult.data?.length ?? 0) > 0;
  if (!hasBrief) {
    return {
      action_id: 'no_strategy_brief',
      copy: 'Lock your conversion event',
      cta_route: '/planning/strategy',
      eta_minutes: 3,
      priority: 1,
    };
  }

  // Priority 2 — Site not scanned in 30 days
  const lastSession = sessionResult.data?.[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (!lastSession || lastSession.created_at < thirtyDaysAgo) {
    return {
      action_id: 'site_not_scanned',
      copy: 'Rescan your site',
      cta_route: '/planning',
      eta_minutes: 5,
      priority: 2,
    };
  }

  // Priority 3 — Critical tracking gap in health score
  const healthScore = (healthResult.data?.overall_score as number | null) ?? null;
  if (healthScore !== null && healthScore < 50) {
    return {
      action_id: 'critical_tracking_gap',
      copy: 'Fix critical tracking gaps',
      cta_route: '/health',
      eta_minutes: 0, // hand to dev
      priority: 3,
    };
  }

  // Priority 4 — Meta match quality < 6.0
  const hasMetaCapi = (capiResult.data ?? []).some(
    (p: { provider: string }) => p.provider === 'meta',
  );
  if (hasMetaCapi) {
    const { data: metaHealth } = await supabase
      .from('health_scores')
      .select('capi_delivery_rate')
      .eq('user_id', userId)
      .maybeSingle();

    const deliveryRate = (metaHealth?.capi_delivery_rate as number | null) ?? null;
    if (deliveryRate !== null && deliveryRate < 60) {
      return {
        action_id: 'low_meta_match_quality',
        copy: 'Improve Meta match quality',
        cta_route: '/integrations/capi',
        eta_minutes: 15,
        priority: 4,
      };
    }
  }

  // Priority 5 — Consent Mode v2 not active
  const consentConfig = consentResult.data?.[0];
  const gcmMapping = consentConfig?.gcm_mapping as Record<string, unknown> | null;
  const consentModeActive = gcmMapping && Object.keys(gcmMapping).length > 0;
  if (!consentModeActive) {
    return {
      action_id: 'consent_mode_v2_inactive',
      copy: 'Turn on Consent Mode v2',
      cta_route: '/consent',
      eta_minutes: 10,
      priority: 5,
    };
  }

  // Priority 6 — GTM file generated but no active CAPI deployment signal
  const hasGtmOutput = (outputResult.data?.length ?? 0) > 0;
  const hasActiveCapi = (capiResult.data?.length ?? 0) > 0;
  if (hasGtmOutput && !hasActiveCapi) {
    return {
      action_id: 'gtm_not_deployed',
      copy: 'Deploy your Google Tag Manager setup file',
      cta_route: '/planning',
      eta_minutes: 20,
      priority: 6,
    };
  }

  // Priority 7 — All green
  return {
    action_id: 'all_green',
    copy: "Run this week's tracking check",
    cta_route: '/audit/start',
    eta_minutes: 2,
    priority: 7,
  };
}
