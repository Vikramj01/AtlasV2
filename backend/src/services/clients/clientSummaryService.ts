import { supabaseAdmin as supabase } from '@/services/database/supabase';

export interface OrgClientSummary {
  total_clients: number;
  clients_with_deployments: number;
  agency_template_packs: number;
}

export async function getOrgClientSummary(orgId: string): Promise<OrgClientSummary> {
  // Fetch active client IDs first, then run the rest in parallel
  const { data: clientRows, count: totalClients } = await supabase
    .from('clients')
    .select('id', { count: 'exact' })
    .eq('organisation_id', orgId)
    .eq('status', 'active');

  const clientIds = (clientRows ?? []).map((r: { id: string }) => r.id);

  const [deploymentsResult, packsResult] = await Promise.all([
    clientIds.length > 0
      ? supabase.from('deployments').select('client_id').in('client_id', clientIds)
      : Promise.resolve({ data: [] }),

    supabase
      .from('signal_packs')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('is_agency_template', true),
  ]);

  const deploymentClientIds = new Set(
    (deploymentsResult.data ?? []).map((r: { client_id: string }) => r.client_id),
  );

  return {
    total_clients: totalClients ?? 0,
    clients_with_deployments: deploymentClientIds.size,
    agency_template_packs: packsResult.count ?? 0,
  };
}
