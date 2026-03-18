import { supabase } from '@/lib/supabase';
import type {
  HealthDashboardResponse,
  HealthHistoryResponse,
} from '@/types/health';

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

export const healthApi = {
  getDashboard: () =>
    apiFetch<HealthDashboardResponse>('/api/health'),

  getHistory: (days = 30) =>
    apiFetch<HealthHistoryResponse>(`/api/health/history?days=${days}`),

  triggerCompute: () =>
    apiFetch<{ status: string }>('/api/health/compute', { method: 'POST' }),

  acknowledgeAlert: (alertId: string) =>
    apiFetch<{ acknowledged: boolean }>(`/api/health/alerts/${alertId}/acknowledge`, { method: 'POST' }),
};
