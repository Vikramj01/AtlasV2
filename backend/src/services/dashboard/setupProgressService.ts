import { supabaseAdmin as supabase } from '@/services/database/supabase';

export interface SetupProgress {
  completedSteps: string[];
}

async function resolveOrgId(userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? userId;
}

async function count(
  table: string,
  filters: Record<string, string>,
): Promise<number> {
  try {
    let q = supabase.from(table).select('id', { count: 'exact', head: true });
    for (const [col, val] of Object.entries(filters)) {
      q = q.eq(col, val);
    }
    const { count: n } = await q;
    return n ?? 0;
  } catch {
    return 0;
  }
}

export async function getSetupProgress(userId: string): Promise<SetupProgress> {
  const orgId = await resolveOrgId(userId);
  const completed: string[] = [];

  const [
    strategyCount,
    siteScanCount,
    trackingPlanCount,
    tagLibraryCount,
    consentCount,
    capiCount,
    connectionsCount,
  ] = await Promise.all([
    // Step 1 — locked strategy brief
    count('strategy_briefs', { organization_id: orgId }),
    // Step 2 — completed planning session
    count('planning_sessions', { user_id: userId, status: 'outputs_ready' }),
    // Step 3 — any journey exists
    count('journeys', { user_id: userId }),
    // Step 4 — any signal in the library
    count('signals', { user_id: userId }),
    // Step 5 — consent config saved
    count('consent_configs', { organization_id: userId }),
    // Step 6 — active CAPI provider
    count('capi_providers', { organization_id: userId, status: 'active' }),
    // Step 7 — at least one platform connected
    count('platform_connections', { organization_id: orgId }),
  ]);

  if (strategyCount > 0)    completed.push('strategy');
  if (siteScanCount > 0)    completed.push('site-scan');
  if (trackingPlanCount > 0) completed.push('tracking-plan');
  if (tagLibraryCount > 0)  completed.push('tag-library');
  if (consentCount > 0)     completed.push('consent');
  if (capiCount > 0)        completed.push('capi');
  if (connectionsCount > 0) completed.push('connections');

  return { completedSteps: completed };
}
