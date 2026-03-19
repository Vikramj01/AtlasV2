import { supabase } from '@/lib/supabase';
import type { Schedule, CreateScheduleInput } from '@/types/schedule';

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
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const scheduleApi = {
  list: (): Promise<Schedule[]> =>
    apiFetch('/api/schedules'),

  get: (id: string): Promise<Schedule> =>
    apiFetch(`/api/schedules/${id}`),

  create: (input: CreateScheduleInput): Promise<Schedule> =>
    apiFetch('/api/schedules', { method: 'POST', body: JSON.stringify(input) }),

  update: (
    id: string,
    input: Partial<{ name: string; frequency: string; day_of_week: number | null; hour_utc: number; is_active: boolean }>,
  ): Promise<Schedule> =>
    apiFetch(`/api/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

  delete: (id: string): Promise<{ deleted: boolean }> =>
    apiFetch(`/api/schedules/${id}`, { method: 'DELETE' }),

  /** Trigger an immediate run regardless of next_run_at. */
  runNow: (id: string): Promise<{ audit_id: string; status: string }> =>
    apiFetch(`/api/schedules/${id}/run`, { method: 'POST' }),
};
