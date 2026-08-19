import { supabaseAdmin as supabase } from './supabase';

/**
 * Returns the container_id of a client's most recently connected GTM container
 * (OAuth or manual upload), or null if the client has no connection. A client
 * can accumulate multiple connection rows over time — this returns the newest.
 */
export async function getConnectedGtmContainerId(clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('gtm_container_connections')
    .select('container_id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`getConnectedGtmContainerId: ${error.message}`);
  return (data as { container_id: string } | null)?.container_id ?? null;
}
