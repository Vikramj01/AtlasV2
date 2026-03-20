import { supabase } from '@/lib/supabase';

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

export interface AdminStats {
  users_total: number;
  users_by_plan: Record<string, number>;
  audits_this_month: number;
  planning_this_month: number;
  health_alerts_active: number;
}

export interface AdminUser {
  id: string;
  email: string;
  plan: string;
  created_at: string;
  audit_count: number;
  planning_count: number;
}

export interface ActivityItem {
  id: string;
  type: 'audit' | 'planning';
  user_id: string;
  website_url: string;
  status: string;
  funnel_type?: string;
  created_at: string;
}

export interface AdminAlert {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  is_active: boolean;
  details: Record<string, unknown> | null;
  created_at: string;
}

export const adminApi = {
  /** Returns { isAdmin: true } if the current user is an admin, throws 403 otherwise. */
  check: () => apiFetch<{ isAdmin: boolean }>('/api/admin/me'),

  getStats: () => apiFetch<AdminStats>('/api/admin/stats'),

  getUsers: () => apiFetch<{ users: AdminUser[] }>('/api/admin/users'),

  setUserPlan: (userId: string, plan: string) =>
    apiFetch<{ updated: boolean }>(`/api/admin/users/${userId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan }),
    }),

  getActivity: () => apiFetch<{ items: ActivityItem[] }>('/api/admin/activity'),

  getAlerts: () => apiFetch<{ alerts: AdminAlert[] }>('/api/admin/alerts'),

  dismissAlert: (alertId: string) =>
    apiFetch<{ dismissed: boolean }>(`/api/admin/alerts/${alertId}/dismiss`, { method: 'PATCH' }),
};
