import { supabase } from '@/lib/supabase';
import type {
  ConnectionsResponse,
  PlatformConnectionPublic,
  DiscoveredAccount,
  Platform,
} from '@/types/connections';

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
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const connectionApi = {
  list: () =>
    apiFetch<{ data: ConnectionsResponse }>('/api/connections'),

  startOAuth: (platform: Platform, clientId?: string) => {
    const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
    return apiFetch<{ data: { authUrl: string; state: string } }>(
      `/api/connections/oauth/${platform}/start${qs}`,
    );
  },

  // Called by the frontend OAuth callback page after platform redirects back
  processCallback: (platform: Platform, code: string, state: string) =>
    apiFetch<{
      data: {
        managerId?: string;
        discovered: DiscoveredAccount[];
        standaloneDiscovered: DiscoveredAccount[];
      };
      message: string;
    }>(`/api/connections/oauth/${platform}/callback`, {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    }),

  rediscover: (connectionId: string) =>
    apiFetch<{ data: DiscoveredAccount[]; message: string }>(
      `/api/connections/${connectionId}/discover`,
      { method: 'POST' },
    ),

  connect: (connectionId: string, clientId: string) =>
    apiFetch<{ data: PlatformConnectionPublic; message: string }>(
      `/api/connections/${connectionId}/connect`,
      { method: 'POST', body: JSON.stringify({ clientId }) },
    ),

  disconnect: (connectionId: string) =>
    apiFetch<{ message: string }>(
      `/api/connections/${connectionId}/disconnect`,
      { method: 'POST' },
    ),

  remove: (connectionId: string) =>
    apiFetch<{ message: string }>(
      `/api/connections/${connectionId}`,
      { method: 'DELETE', body: JSON.stringify({ confirmed: true }) },
    ),

  test: (connectionId: string) =>
    apiFetch<{ data: { ok: boolean; latency_ms: number; error?: string } }>(
      `/api/connections/${connectionId}/test`,
      { method: 'POST' },
    ),
};
