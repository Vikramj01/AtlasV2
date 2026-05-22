import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ClientDMARow {
  client_id: string;
  client_name: string;
  website_url: string;
  gtg_active: boolean;
  avg_match_rate: number | null;
  upload_success_rate: number | null;
  total_members_30d: number;
  destination_count: number;
  last_dma_activity: string | null;
  trend_points: Array<{ date: string; matchRate: number | null }>;
  needs_action: string[];
}

export const dataManagerApi = {
  getClients(orgId: string): Promise<{ clients: ClientDMARow[] }> {
    return apiFetch(`/api/data-manager/${orgId}/clients`);
  },

  getExportUrl(orgId: string): string {
    return `${API_BASE}/api/data-manager/${orgId}/export/csv`;
  },
};
