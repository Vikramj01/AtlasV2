/**
 * Google Tag Topology PRD §6.6 back-scan runner (internal list only, D4).
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/googleTagBackscan.ts
 *
 * Reads the newest gtm_container_snapshots row per client-linked connection and
 * each client's current google_tag_topology rows, then prints the three groups
 * from services/google/googleTagBackscan.ts as JSON. Read-only.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { parseContainerJson } from '@/services/gtm/containerParser';
import { runBackscan, type BackscanClient } from '@/services/google/googleTagBackscan';
import { getCurrentTopologyRows } from '@/services/database/googleTagTopologyQueries';

async function main(): Promise<void> {
  const { data: connections, error } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('id, client_id')
    .not('client_id', 'is', null);
  if (error) throw new Error(error.message);

  const clients: BackscanClient[] = [];
  for (const conn of (connections ?? []) as Array<{ id: string; client_id: string }>) {
    const { data: snap } = await supabaseAdmin
      .from('gtm_container_snapshots')
      .select('container_json')
      .eq('connection_id', conn.id)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) continue;

    const [{ data: client }, { data: sgtm }, topology] = await Promise.all([
      supabaseAdmin.from('clients').select('secondary_domains').eq('id', conn.client_id).maybeSingle(),
      supabaseAdmin.from('client_platforms').select('is_verified').eq('client_id', conn.client_id).eq('platform', 'sgtm').maybeSingle(),
      getCurrentTopologyRows(conn.client_id),
    ]);

    clients.push({
      client_id: conn.client_id,
      container: parseContainerJson((snap as { container_json: Record<string, unknown> }).container_json, 'gtm_api'),
      topology_rows: topology,
      secondary_domains: (client as { secondary_domains: string[] | null } | null)?.secondary_domains ?? [],
      sgtm_verified: (sgtm as { is_verified: boolean } | null)?.is_verified ?? false,
    });
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ scanned: clients.length, ...runBackscan(clients) }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
