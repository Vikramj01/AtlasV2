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
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SlackDestination {
  id: string;
  name: string;
  channel_hint: string | null;
  enabled: boolean;
  created_at: string;
}

export const slackApi = {
  listDestinations: () =>
    apiFetch<{ data: SlackDestination[] }>('/api/slack/destinations').then((r) => r.data),

  createDestination: (payload: { name: string; webhook_url: string; channel_hint?: string }) =>
    apiFetch<{ data: SlackDestination }>('/api/slack/destinations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((r) => r.data),

  updateDestination: (
    id: string,
    patch: { name?: string; channel_hint?: string | null; enabled?: boolean },
  ) =>
    apiFetch<{ data: SlackDestination }>(`/api/slack/destinations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.data),

  deleteDestination: (id: string) =>
    apiFetch<{ message: string }>(`/api/slack/destinations/${id}`, { method: 'DELETE' }),

  testDestination: (id: string) =>
    apiFetch<{ message: string }>(`/api/slack/destinations/${id}/test`, { method: 'POST' }),

  shareAudit: (auditId: string, destinationId: string) =>
    apiFetch<{ message: string }>(`/api/slack/share/audit/${auditId}`, {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    }),

  shareBrief: (briefId: string, destinationId: string) =>
    apiFetch<{ message: string }>(`/api/slack/share/brief/${briefId}`, {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    }),

  shareReconciliation: (runId: string, destinationId: string) =>
    apiFetch<{ message: string }>(`/api/slack/share/reconciliation/${runId}`, {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    }),

  shareIHC: (destinationId: string) =>
    apiFetch<{ message: string }>('/api/slack/share/ihc', {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    }),

  shareSignals: (destinationId: string) =>
    apiFetch<{ message: string }>('/api/slack/share/signals', {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    }),

  shareCrawl: (runId: string, destinationId: string) =>
    apiFetch<{ message: string }>(`/api/slack/share/crawl/${runId}`, {
      method: 'POST',
      body: JSON.stringify({ destinationId }),
    }),
};
