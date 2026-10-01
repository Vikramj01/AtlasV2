/** Client-scoped platform_discontinuities writes (Google Tag Topology PRD §8.1). */
import { supabaseAdmin as supabase } from './supabase';
import type { ClientDiscontinuityRow } from '@/services/google/googleTagDiscontinuities';

/** Idempotent: the (client_id, platform, effective_date, title) constraint makes a re-verify a no-op. */
export async function writeClientDiscontinuities(rows: ClientDiscontinuityRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('platform_discontinuities')
    .upsert(rows, { onConflict: 'client_id,platform,effective_date,title', ignoreDuplicates: true });
  if (error) throw new Error(`writeClientDiscontinuities: ${error.message}`);
}

export interface ClientDiscontinuityRecord {
  id: string;
  platform: string;
  title: string;
  effective_date: string | null;
  description: string;
  organization_id: string;
}

/** Client-scoped rows for an organization whose effective_date falls in [from, to] (YYYY-MM-DD, inclusive). */
export async function listClientDiscontinuitiesInWindow(
  organizationId: string,
  from: string,
  to: string,
): Promise<ClientDiscontinuityRecord[]> {
  const { data, error } = await supabase
    .from('platform_discontinuities')
    .select('id, platform, title, effective_date, description, organization_id')
    .eq('kind', 'client_tracking_change')
    .eq('organization_id', organizationId)
    .gte('effective_date', from)
    .lte('effective_date', to);
  if (error) throw new Error(`listClientDiscontinuitiesInWindow: ${error.message}`);
  return (data ?? []) as ClientDiscontinuityRecord[];
}
