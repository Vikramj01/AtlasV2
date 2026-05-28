import { supabase } from '@/lib/supabase';
import type { DashboardResponse, AtlasScore, NextAction, ActivityResponse, OrgDashboardSummary } from '@/types/dashboard';

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

export const dashboardApi = {
  get: () => apiFetch<DashboardResponse>('/api/dashboard'),
  getAtlasScore: () =>
    apiFetch<{ data: AtlasScore }>('/api/dashboard/atlas-score'),
  getNextAction: (opts?: { skipStrategy?: boolean }) =>
    apiFetch<{ data: NextAction }>(
      `/api/dashboard/next-action${opts?.skipStrategy ? '?skip_strategy=1' : ''}`,
    ),
  getActivity: () =>
    apiFetch<ActivityResponse>('/api/dashboard/activity'),
  getSetupProgress: () =>
    apiFetch<{ data: { completedSteps: string[] } }>('/api/dashboard/setup-progress'),

  fetchSummary: (since?: string) =>
    apiFetch<{ data: OrgDashboardSummary; error: null; message: null }>(
      `/api/dashboard/summary${since ? `?since=${encodeURIComponent(since)}` : ''}`,
    ),

  reviewAlerts: (reviews: Array<{ source_table: string; source_id: string }>) =>
    apiFetch<{ data: { reviewed_count: number }; error: null; message: null }>(
      '/api/dashboard/alerts/review',
      { method: 'POST', body: JSON.stringify({ reviews }) },
    ),

  recordLogin: () =>
    apiFetch<{ data: { last_login_at: string; previous_login_at: string | null }; error: null; message: null }>(
      '/api/auth/record-login',
      { method: 'POST' },
    ),
};
