import { supabaseAdmin } from '../database/supabase';

export interface StepState {
  id: string;
  phase: 1 | 2;
  status: 'complete' | 'incomplete' | 'skipped';
  required: boolean;
  completed_at: string | null;
  skipped_at: string | null;
}

export interface OnboardingStatus {
  overall_status: 'not_started' | 'in_progress' | 'complete';
  completed_at: string | null;
  dismissed_at: string | null;
  first_client: { id: string; name: string; website_url: string | null } | null;
  steps: Record<string, StepState>;
  phase_1_complete: boolean;
  phase_2_complete: boolean;
  org_type: 'agency' | 'brand';
  primary_client_id: string | null;
}

interface StoredStepEntry {
  status: 'skipped';
  at: string;
}

export async function getOnboardingStatus(orgId: string): Promise<OnboardingStatus> {
  // Load persisted state, first client, and org details concurrently
  const [stateResult, firstClientResult, orgResult] = await Promise.all([
    supabaseAdmin
      .from('organisation_onboarding_state')
      .select('steps_state, dismissed_at, completed_at')
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('clients')
      .select('id, name, website_url')
      .eq('organisation_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('organisations')
      .select('org_type, primary_client_id')
      .eq('id', orgId)
      .maybeSingle(),
  ]);

  const stepsState = (stateResult.data?.steps_state ?? {}) as Record<string, StoredStepEntry>;
  const dismissed_at = stateResult.data?.dismissed_at ?? null;
  const stored_completed_at = stateResult.data?.completed_at ?? null;
  const firstClient = firstClientResult.data as { id: string; name: string; website_url: string | null } | null;
  const orgType = ((orgResult.data as { org_type?: string } | null)?.org_type ?? 'agency') as 'agency' | 'brand';
  const primaryClientId = (orgResult.data as { primary_client_id?: string | null } | null)?.primary_client_id ?? null;

  // Run all derivation queries in parallel
  const [
    namingConvRow,
    orgRow,
    signalPackRow,
    memberCountResult,
    platformConnRow,
    step23DeployRow,
    step23PlanningRow,
    step23JourneyRow,
    step24ExportsResult,
    step25CrawlRow,
  ] = await Promise.all([
    // 1.1 — naming convention exists
    supabaseAdmin
      .from('naming_conventions')
      .select('id')
      .eq('organization_id', orgId)
      .limit(1)
      .maybeSingle(),

    // 1.2 — taxonomy_accepted_at
    supabaseAdmin
      .from('organisations')
      .select('taxonomy_accepted_at')
      .eq('id', orgId)
      .maybeSingle(),

    // 1.3 — any signal pack for this org
    supabaseAdmin
      .from('signal_packs')
      .select('id')
      .eq('organisation_id', orgId)
      .limit(1)
      .maybeSingle(),

    // 1.4 — member count
    supabaseAdmin
      .from('organisation_members')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId),

    // 2.2 — active platform connection for first client
    firstClient
      ? supabaseAdmin
          .from('platform_connections')
          .select('id')
          .eq('client_id', firstClient.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // 2.3a — deployed signal pack for first client
    firstClient
      ? supabaseAdmin
          .from('deployments')
          .select('id')
          .eq('client_id', firstClient.id)
          .eq('status', 'deployed')
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // 2.3b — approved planning recommendation for first client's sessions
    firstClient
      ? supabaseAdmin
          .from('planning_recommendations')
          .select('id')
          .eq('approved', true)
          .in(
            'session_id',
            await supabaseAdmin
              .from('planning_sessions')
              .select('id')
              .eq('client_id', firstClient.id)
              .then((r) => (r.data ?? []).map((s: { id: string }) => s.id)),
          )
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // 2.3c — journey linked to first client
    firstClient
      ? supabaseAdmin
          .from('journeys')
          .select('id')
          .eq('client_id', firstClient.id)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // 2.4 — both gtm_container and datalayer_spec exports exist
    firstClient
      ? supabaseAdmin
          .from('client_deliverable_exports')
          .select('export_type')
          .eq('client_id', firstClient.id)
          .in('export_type', ['gtm_container', 'datalayer_spec'])
      : Promise.resolve({ data: [] }),

    // 2.5 — baseline crawl run matching first client's site URL
    firstClient?.website_url
      ? supabaseAdmin
          .from('crawl_runs')
          .select('id')
          .eq('is_baseline', true)
          .eq('site_url', firstClient.website_url)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Derive step statuses
  const isSkipped = (stepId: string) => stepsState[stepId]?.status === 'skipped';
  const skippedAt = (stepId: string) => stepsState[stepId]?.at ?? null;

  const step11Complete = !!namingConvRow.data;
  const step12Complete = !!(orgRow.data as { taxonomy_accepted_at: string | null } | null)
    ?.taxonomy_accepted_at;
  const step13Complete = !!signalPackRow.data || isSkipped('1.3');
  const step14Complete = (memberCountResult.count ?? 0) > 1 || isSkipped('1.4');

  const step21Complete = !!firstClient;
  const step22Complete = !!platformConnRow.data;
  const step23Complete = !!step23DeployRow.data || !!step23PlanningRow.data || !!step23JourneyRow.data;

  const exportTypes = new Set(
    ((step24ExportsResult as { data: { export_type: string }[] | null }).data ?? []).map(
      (r) => r.export_type,
    ),
  );
  const step24Complete = exportTypes.has('gtm_container') && exportTypes.has('datalayer_spec');
  const step25Complete = !!step25CrawlRow.data;

  const steps: Record<string, StepState> = {
    '1.1': {
      id: '1.1',
      phase: 1,
      status: step11Complete ? 'complete' : 'incomplete',
      required: true,
      completed_at: step11Complete ? null : null,
      skipped_at: null,
    },
    '1.2': {
      id: '1.2',
      phase: 1,
      status: step12Complete ? 'complete' : isSkipped('1.2') ? 'skipped' : 'incomplete',
      required: false,
      completed_at: null,
      skipped_at: isSkipped('1.2') ? skippedAt('1.2') : null,
    },
    '1.3': {
      id: '1.3',
      phase: 1,
      status: signalPackRow.data ? 'complete' : isSkipped('1.3') ? 'skipped' : 'incomplete',
      required: false,
      completed_at: null,
      skipped_at: isSkipped('1.3') ? skippedAt('1.3') : null,
    },
    '1.4': {
      id: '1.4',
      phase: 1,
      status: (memberCountResult.count ?? 0) > 1 ? 'complete' : isSkipped('1.4') ? 'skipped' : 'incomplete',
      required: false,
      completed_at: null,
      skipped_at: isSkipped('1.4') ? skippedAt('1.4') : null,
    },
    '2.1': {
      id: '2.1',
      phase: 2,
      status: step21Complete ? 'complete' : 'incomplete',
      required: true,
      completed_at: null,
      skipped_at: null,
    },
    '2.2': {
      id: '2.2',
      phase: 2,
      status: step22Complete ? 'complete' : 'incomplete',
      required: true,
      completed_at: null,
      skipped_at: null,
    },
    '2.3': {
      id: '2.3',
      phase: 2,
      status: step23Complete ? 'complete' : 'incomplete',
      required: true,
      completed_at: null,
      skipped_at: null,
    },
    '2.4': {
      id: '2.4',
      phase: 2,
      status: step24Complete ? 'complete' : 'incomplete',
      required: true,
      completed_at: null,
      skipped_at: null,
    },
    '2.5': {
      id: '2.5',
      phase: 2,
      status: step25Complete ? 'complete' : 'incomplete',
      required: true,
      completed_at: null,
      skipped_at: null,
    },
  };

  // Phase completion
  const phase_1_complete =
    step11Complete && (step12Complete || isSkipped('1.2')) && step13Complete && step14Complete;
  const phase_2_complete =
    step21Complete && step22Complete && step23Complete && step24Complete && step25Complete;

  // Overall status
  const requiredComplete = step11Complete && step21Complete && step22Complete && step23Complete && step24Complete && step25Complete;
  const allOptionalResolved = (step12Complete || isSkipped('1.2')) && step13Complete && step14Complete;
  const isFullyComplete = requiredComplete && allOptionalResolved;

  const allIncomplete =
    !step11Complete && !step12Complete && !step13Complete && !step14Complete &&
    !step21Complete && !step22Complete && !step23Complete && !step24Complete && !step25Complete;

  const overall_status: 'not_started' | 'in_progress' | 'complete' = isFullyComplete
    ? 'complete'
    : allIncomplete
    ? 'not_started'
    : 'in_progress';

  // Write completed_at if newly complete
  let completed_at = stored_completed_at;
  if (isFullyComplete && !completed_at) {
    completed_at = new Date().toISOString();
    await supabaseAdmin
      .from('organisation_onboarding_state')
      .upsert(
        { organization_id: orgId, completed_at, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
  }

  return {
    overall_status,
    completed_at,
    dismissed_at,
    first_client: firstClient,
    steps,
    phase_1_complete,
    phase_2_complete,
    org_type: orgType,
    primary_client_id: primaryClientId,
  };
}
