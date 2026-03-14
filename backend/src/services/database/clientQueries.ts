import { supabaseAdmin as supabase } from './supabase';
import type {
  Client,
  ClientPlatform,
  ClientPage,
  ClientWithDetails,
  CreateClientRequest,
  UpdateClientRequest,
  UpsertPlatformsRequest,
  UpsertPagesRequest,
} from '../../types/organisation';
import type { Deployment, ClientOutput } from '../../types/signal';

// ─── Clients ──────────────────────────────────────────────────────────────────

export async function createClient(
  orgId: string,
  data: CreateClientRequest & { detected_platform?: string },
): Promise<Client> {
  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      organisation_id: orgId,
      name: data.name,
      website_url: data.website_url,
      business_type: data.business_type,
      notes: data.notes ?? null,
      detected_platform: data.detected_platform ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create client: ${error.message}`);
  return client as Client;
}

export async function listClients(orgId: string): Promise<ClientWithDetails[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list clients: ${error.message}`);

  const clients = (data ?? []) as Client[];
  const results: ClientWithDetails[] = [];

  for (const client of clients) {
    const [platforms, pages, deploymentCount] = await Promise.all([
      getClientPlatforms(client.id),
      getClientPages(client.id),
      supabase
        .from('deployments')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .then((r) => r.count ?? 0),
    ]);

    // Get latest audit score for this client
    const { data: latestAudit } = await supabase
      .from('audits')
      .select('id, created_at, audit_reports(report_json)')
      .eq('client_id', client.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let signal_health: number | null = null;
    let last_audit_at: string | null = null;
    if (latestAudit) {
      const row = latestAudit as Record<string, unknown>;
      last_audit_at = row['created_at'] as string;
      const reports = row['audit_reports'] as Array<{ report_json: { executive_summary: { scores: { conversion_signal_health: number } } } }> | null;
      signal_health = reports?.[0]?.report_json?.executive_summary?.scores?.conversion_signal_health ?? null;
    }

    results.push({ ...client, platforms, pages, signal_health, last_audit_at, deployment_count: deploymentCount as number });
  }

  return results;
}

export async function getClient(clientId: string, orgId: string): Promise<ClientWithDetails | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('organisation_id', orgId)
    .single();

  if (error) return null;
  const client = data as Client;

  const [platforms, pages] = await Promise.all([
    getClientPlatforms(client.id),
    getClientPages(client.id),
  ]);

  return { ...client, platforms, pages };
}

export async function updateClient(
  clientId: string,
  orgId: string,
  data: UpdateClientRequest,
): Promise<Client> {
  const { data: client, error } = await supabase
    .from('clients')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', clientId)
    .eq('organisation_id', orgId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update client: ${error.message}`);
  return client as Client;
}

export async function archiveClient(clientId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', clientId)
    .eq('organisation_id', orgId);
  if (error) throw new Error(`Failed to archive client: ${error.message}`);
}

// ─── Client Platforms ─────────────────────────────────────────────────────────

export async function getClientPlatforms(clientId: string): Promise<ClientPlatform[]> {
  const { data, error } = await supabase
    .from('client_platforms')
    .select('*')
    .eq('client_id', clientId)
    .order('platform');

  if (error) return [];
  return (data ?? []) as ClientPlatform[];
}

export async function upsertClientPlatforms(
  clientId: string,
  req: UpsertPlatformsRequest,
): Promise<ClientPlatform[]> {
  const rows = req.platforms.map((p) => ({
    client_id: clientId,
    platform: p.platform,
    is_active: p.is_active,
    measurement_id: p.measurement_id ?? null,
    config: p.config ?? {},
  }));

  const { data, error } = await supabase
    .from('client_platforms')
    .upsert(rows, { onConflict: 'client_id,platform' })
    .select('*');

  if (error) throw new Error(`Failed to upsert client platforms: ${error.message}`);
  return (data ?? []) as ClientPlatform[];
}

// ─── Client Pages ─────────────────────────────────────────────────────────────

export async function getClientPages(clientId: string): Promise<ClientPage[]> {
  const { data, error } = await supabase
    .from('client_pages')
    .select('*')
    .eq('client_id', clientId)
    .order('stage_order');

  if (error) return [];
  return (data ?? []) as ClientPage[];
}

export async function upsertClientPages(
  clientId: string,
  req: UpsertPagesRequest,
): Promise<ClientPage[]> {
  // Delete existing pages and replace — simplest approach for MVP
  await supabase.from('client_pages').delete().eq('client_id', clientId);

  const rows = req.pages.map((p) => ({
    client_id: clientId,
    label: p.label,
    url: p.url,
    page_type: p.page_type ?? 'custom',
    stage_order: p.stage_order,
  }));

  const { data, error } = await supabase
    .from('client_pages')
    .insert(rows)
    .select('*');

  if (error) throw new Error(`Failed to upsert client pages: ${error.message}`);
  return (data ?? []) as ClientPage[];
}

// ─── Deployments ─────────────────────────────────────────────────────────────

export async function listDeployments(clientId: string): Promise<Deployment[]> {
  const { data, error } = await supabase
    .from('deployments')
    .select('*, signal_packs(*)')
    .eq('client_id', clientId)
    .order('deployed_at', { ascending: false });

  if (error) throw new Error(`Failed to list deployments: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as Deployment),
    pack: row['signal_packs'] as Deployment['pack'],
  }));
}

export async function deployPack(
  clientId: string,
  packId: string,
  signalOverrides: Deployment['signal_overrides'] = {},
): Promise<Deployment> {
  const { data, error } = await supabase
    .from('deployments')
    .upsert(
      { client_id: clientId, pack_id: packId, signal_overrides: signalOverrides },
      { onConflict: 'client_id,pack_id' },
    )
    .select('*')
    .single();

  if (error) throw new Error(`Failed to deploy pack: ${error.message}`);
  return data as Deployment;
}

export async function removeDeployment(deploymentId: string, clientId: string): Promise<void> {
  const { error } = await supabase
    .from('deployments')
    .delete()
    .eq('id', deploymentId)
    .eq('client_id', clientId);
  if (error) throw new Error(`Failed to remove deployment: ${error.message}`);
}

export async function markDeploymentGenerated(deploymentId: string): Promise<void> {
  await supabase
    .from('deployments')
    .update({ last_generated_at: new Date().toISOString() })
    .eq('id', deploymentId);
}

// ─── Client Outputs ───────────────────────────────────────────────────────────

export async function listClientOutputs(clientId: string): Promise<ClientOutput[]> {
  const { data, error } = await supabase
    .from('client_outputs')
    .select('*')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false });

  if (error) throw new Error(`Failed to list outputs: ${error.message}`);
  return (data ?? []) as ClientOutput[];
}

export async function saveClientOutput(
  clientId: string,
  outputType: ClientOutput['output_type'],
  outputData: Record<string, unknown>,
  sourceDeployments: ClientOutput['source_deployments'],
): Promise<ClientOutput> {
  // Increment version by checking existing outputs of this type
  const { count } = await supabase
    .from('client_outputs')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('output_type', outputType);

  const { data, error } = await supabase
    .from('client_outputs')
    .insert({
      client_id: clientId,
      output_type: outputType,
      output_data: outputData,
      version: (count ?? 0) + 1,
      source_deployments: sourceDeployments,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to save client output: ${error.message}`);
  return data as ClientOutput;
}

export async function getClientOutput(
  outputId: string,
  clientId: string,
): Promise<ClientOutput | null> {
  const { data } = await supabase
    .from('client_outputs')
    .select('*')
    .eq('id', outputId)
    .eq('client_id', clientId)
    .single();
  return (data as ClientOutput | null);
}

// ─── Clients using a specific pack (for bulk regenerate) ─────────────────────

export async function getClientsByPack(packId: string, orgId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from('deployments')
    .select('clients(*)')
    .eq('pack_id', packId);

  if (error) return [];

  const clients: Client[] = [];
  for (const row of (data ?? [])) {
    const client = (row as Record<string, unknown>)['clients'] as Client | null;
    if (client && client.organisation_id === orgId) {
      clients.push(client);
    }
  }
  return clients;
}
