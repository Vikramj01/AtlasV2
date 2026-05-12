import { supabaseAdmin as supabase } from './supabase';

export interface ProxyEventRow {
  id: string;
  name: string;
  lag_class: 'immediate' | 'short_lag' | 'long_lag' | 'deep_lag';
  platform_benefit: 'meta' | 'google' | 'both';
  rationale: string;
  event_type: string;
  verticals: string[];
  is_system: boolean;
  created_at: string;
}

/**
 * Fetch proxy events from the library filtered by lag_class.
 * When businessType is provided, results are further filtered to rows whose
 * verticals array contains that business type OR whose verticals array is empty
 * (meaning the proxy applies to all verticals).
 * When businessType is omitted (null/undefined), all rows matching lag_class are returned.
 */
export async function fetchProxyEvents(
  lagClass: ProxyEventRow['lag_class'],
  businessType?: string | null,
): Promise<ProxyEventRow[]> {
  const { data, error } = await supabase
    .from('proxy_event_library')
    .select('*')
    .eq('lag_class', lagClass)
    .order('name');

  if (error) throw new Error(`Failed to fetch proxy events: ${error.message}`);

  const rows = (data ?? []) as ProxyEventRow[];

  if (!businessType) return rows;

  // Filter client-side: include row if its verticals array is empty OR contains businessType.
  // This avoids a complex Supabase array-overlap query and keeps the logic readable.
  return rows.filter(
    (r) => r.verticals.length === 0 || r.verticals.includes(businessType),
  );
}
