import { supabase } from '@/lib/supabase';
import type { LagClass, ProxyEvent } from '@/types/journey';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

/**
 * Fetch proxy event recommendations for a given lag class.
 * When businessType is provided the backend further filters by vertical.
 */
export async function getProxyEvents(
  lagClass: LagClass,
  businessType?: string | null,
): Promise<ProxyEvent[]> {
  const headers = await authHeaders();
  const params = new URLSearchParams({ lag_class: lagClass });
  if (businessType) params.set('business_type', businessType);

  const res = await fetch(`${API_BASE}/api/journeys/proxy-events?${params.toString()}`, {
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch proxy events: ${res.status}`);
  }

  const json = await res.json();
  return (json.data ?? []) as ProxyEvent[];
}
