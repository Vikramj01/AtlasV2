import { supabase } from '@/lib/supabase';
import type { AirInsight, InsightStatus } from '@/types/air';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const insightsApi = {
  getInsights: () =>
    apiFetch<{ data: AirInsight[]; message: string | null }>('/api/insights'),

  updateStatus: (id: string, status: InsightStatus) =>
    apiFetch<{ data: { status: InsightStatus }; message: string | null }>(`/api/insights/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
