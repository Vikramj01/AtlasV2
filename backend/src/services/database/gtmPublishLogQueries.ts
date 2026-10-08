/** gtm_publish_log reads/writes (GA4 Admin / L11 / Junk Gate PRD §A.6). Service-role only. */
import { supabaseAdmin as supabase } from './supabase';

export interface GtmPublishLogRow {
  id: string;
  organization_id: string;
  client_id: string | null;
  connection_id: string;
  account_id: string;
  container_id: string;
  workspace_id: string | null;
  action: 'publish' | 'rollback';
  published_version_id: string;
  previous_version_id: string | null;
  rollback_of: string | null;
  rolled_back_at: string | null;
  user_id: string;
  created_at: string;
}

export type NewGtmPublishLog = Omit<GtmPublishLogRow, 'id' | 'created_at' | 'rolled_back_at'>;

export async function insertPublishLog(row: NewGtmPublishLog): Promise<GtmPublishLogRow> {
  const { data, error } = await supabase.from('gtm_publish_log').insert(row).select('*').single();
  if (error || !data) throw new Error(`gtm_publish_log insert failed: ${error?.message}`);
  return data as GtmPublishLogRow;
}

export async function getPublishLog(id: string, organizationId: string): Promise<GtmPublishLogRow | null> {
  const { data } = await supabase.from('gtm_publish_log').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  return (data as GtmPublishLogRow | null) ?? null;
}

export async function listPublishLog(organizationId: string, connectionId?: string, limit = 20): Promise<GtmPublishLogRow[]> {
  let q = supabase.from('gtm_publish_log').select('*').eq('organization_id', organizationId);
  if (connectionId) q = q.eq('connection_id', connectionId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`gtm_publish_log list failed: ${error.message}`);
  return (data ?? []) as GtmPublishLogRow[];
}

/** Marks a publish row rolled back. Guarded on `rolled_back_at IS NULL` so a double rollback cannot both succeed. Returns whether this call claimed it. */
export async function markRolledBack(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('gtm_publish_log')
    .update({ rolled_back_at: new Date().toISOString() })
    .eq('id', id)
    .is('rolled_back_at', null)
    .select('id');
  if (error) throw new Error(`gtm_publish_log update failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
