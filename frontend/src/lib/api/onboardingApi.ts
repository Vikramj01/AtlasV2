import { supabase } from '@/lib/supabase';
import type { OnboardingStatus } from '@/types/onboarding';

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
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function post(path: string, body?: unknown) {
  return apiFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export const onboardingApi = {
  getStatus: () =>
    apiFetch<{ data: OnboardingStatus; error: string | null; message: string | null }>('/api/onboarding/status'),

  skipStep: (step_id: string) =>
    post('/api/onboarding/skip', { step_id }),

  dismiss: () =>
    post('/api/onboarding/dismiss'),

  reset: () =>
    post('/api/onboarding/reset'),

  acceptTaxonomy: () =>
    post('/api/onboarding/accept-taxonomy'),
};
