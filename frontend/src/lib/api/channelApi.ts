import { supabase } from '@/lib/supabase';
import type {
  ChannelOverviewResponse,
  ChannelJourneysResponse,
  ChannelDiagnosticsResponse,
  ChannelType,
  ChannelJourneyMap,
} from '@/types/channel';

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

export const channelApi = {
  getOverview: (site?: string, days?: number) => {
    const params = new URLSearchParams();
    if (site) params.set('site', site);
    if (days) params.set('days', String(days));
    const qs = params.toString();
    return apiFetch<ChannelOverviewResponse>(`/api/channels/overview${qs ? `?${qs}` : ''}`);
  },

  getJourneys: (site?: string, days?: number) => {
    const params = new URLSearchParams();
    if (site) params.set('site', site);
    if (days) params.set('days', String(days));
    const qs = params.toString();
    return apiFetch<ChannelJourneysResponse>(`/api/channels/journeys${qs ? `?${qs}` : ''}`);
  },

  getJourneyByChannel: (channel: ChannelType, site?: string) => {
    const params = new URLSearchParams();
    if (site) params.set('site', site);
    const qs = params.toString();
    return apiFetch<{ journey: ChannelJourneyMap }>(
      `/api/channels/journeys/${channel}${qs ? `?${qs}` : ''}`,
    );
  },

  getDiagnostics: (site?: string) => {
    const params = new URLSearchParams();
    if (site) params.set('site', site);
    const qs = params.toString();
    return apiFetch<ChannelDiagnosticsResponse>(`/api/channels/diagnostics${qs ? `?${qs}` : ''}`);
  },

  triggerCompute: (site?: string) =>
    apiFetch<{ status: string }>('/api/channels/compute', {
      method: 'POST',
      body: site ? JSON.stringify({ site }) : undefined,
    }),

  resolveDiagnostic: (id: string) =>
    apiFetch<{ resolved: boolean }>(`/api/channels/diagnostics/${id}/resolve`, { method: 'POST' }),
};
