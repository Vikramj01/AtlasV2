/**
 * google_tag_topology access (Google Tag Topology PRD §6.2). Rows are
 * append-only snapshots: writing a new observation flips `is_current` on the
 * previous row for the same (client, google_tag_id, source), keeping history
 * so a later re-combination (DQM, Sprint 5) is detectable.
 */
import { supabaseAdmin as supabase } from './supabase';
import { computeTopologyVerdict, type TopologyRow, type TopologyVerdictResult } from '@/services/google/googleTagTopology';

export interface TopologyRecord extends TopologyRow {
  id: string;
  evidence_class: string;
  observed_at: string;
  is_current: boolean;
}

/** DIRECT = a Google tag actually seen loading / a client-confirmed fact; INFERRED = co-occurrence or an operator assumption. */
export function evidenceClassFor(row: TopologyRow): 'DIRECT' | 'INFERRED' {
  if (row.source === 'operator_declared') return row.declaration_source === 'CLIENT_CONFIRMED' ? 'DIRECT' : 'INFERRED';
  return row.inferred ? 'INFERRED' : 'DIRECT';
}

export async function writeTopologySnapshot(args: {
  organizationId: string;
  clientId: string;
  rows: TopologyRow[];
  crawlRunId?: string | null;
  auditId?: string | null;
}): Promise<void> {
  const { organizationId, clientId, rows, crawlRunId = null, auditId = null } = args;
  if (rows.length === 0) return;

  for (const row of rows) {
    const { error: flipError } = await supabase
      .from('google_tag_topology')
      .update({ is_current: false })
      .eq('client_id', clientId)
      .eq('google_tag_id', row.google_tag_id)
      .eq('source', row.source)
      .eq('is_current', true);
    if (flipError) throw new Error(`writeTopologySnapshot(flip): ${flipError.message}`);
  }

  const { error } = await supabase.from('google_tag_topology').insert(
    rows.map((row) => ({
      organization_id: organizationId,
      client_id: clientId,
      google_tag_id: row.google_tag_id,
      primary_destination_id: row.primary_destination_id,
      destination_ids: row.destination_ids,
      source: row.source,
      evidence_class: evidenceClassFor(row),
      declaration_source: row.declaration_source ?? null,
      inferred: row.inferred ?? false,
      crawl_run_id: crawlRunId,
      audit_id: auditId,
      is_current: true,
    })),
  );
  if (error) throw new Error(`writeTopologySnapshot: ${error.message}`);
}

export async function getCurrentTopologyRows(clientId: string): Promise<TopologyRecord[]> {
  const { data, error } = await supabase
    .from('google_tag_topology')
    .select('id, google_tag_id, primary_destination_id, destination_ids, source, declaration_source, inferred, evidence_class, observed_at, is_current')
    .eq('client_id', clientId)
    .eq('is_current', true);
  if (error) throw new Error(`getCurrentTopologyRows: ${error.message}`);
  return (data ?? []) as TopologyRecord[];
}

export async function getTopologyHistory(clientId: string, limit = 50): Promise<TopologyRecord[]> {
  const { data, error } = await supabase
    .from('google_tag_topology')
    .select('id, google_tag_id, primary_destination_id, destination_ids, source, declaration_source, inferred, evidence_class, observed_at, is_current')
    .eq('client_id', clientId)
    .order('observed_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getTopologyHistory: ${error.message}`);
  return (data ?? []) as TopologyRecord[];
}

export async function getTopologyVerdictForClient(clientId: string): Promise<TopologyVerdictResult> {
  return computeTopologyVerdict(await getCurrentTopologyRows(clientId));
}
