import { supabase } from '@/lib/supabase';
import type { Signal, SignalPack, SignalPackWithSignals } from '@/types/signal';

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
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const signalApi = {
  // Signals
  listSignals: (orgId?: string) =>
    apiFetch<{ signals: Signal[] }>(`/api/signals${orgId ? `?org_id=${orgId}` : ''}`).then((r) => r.signals),

  getSignal: (signalId: string) =>
    apiFetch<Signal>(`/api/signals/${signalId}`),

  createSignal: (data: Partial<Signal> & { organisation_id: string }) =>
    apiFetch<Signal>('/api/signals', { method: 'POST', body: JSON.stringify(data) }),

  updateSignal: (signalId: string, data: Partial<Signal>) =>
    apiFetch<Signal>(`/api/signals/${signalId}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteSignal: (signalId: string) =>
    apiFetch<{ deleted: boolean }>(`/api/signals/${signalId}`, { method: 'DELETE' }),

  // Packs
  listPacks: (orgId?: string) =>
    apiFetch<{ packs: SignalPack[] }>(`/api/signals/packs${orgId ? `?org_id=${orgId}` : ''}`).then((r) => r.packs),

  getPack: (packId: string) =>
    apiFetch<SignalPackWithSignals & { client_count: number; outdated_count: number }>(`/api/signals/packs/${packId}`),

  createPack: (data: { name: string; business_type: string; description?: string; organisation_id?: string }) =>
    apiFetch<SignalPack>('/api/signals/packs', { method: 'POST', body: JSON.stringify(data) }),

  updatePack: (packId: string, data: Partial<SignalPack>) =>
    apiFetch<SignalPack>(`/api/signals/packs/${packId}`, { method: 'PUT', body: JSON.stringify(data) }),

  deletePack: (packId: string) =>
    apiFetch<{ deleted: boolean }>(`/api/signals/packs/${packId}`, { method: 'DELETE' }),

  addSignalToPack: (packId: string, signalId: string, stageHint?: string) =>
    apiFetch(`/api/signals/packs/${packId}/signals`, {
      method: 'POST',
      body: JSON.stringify({ signal_id: signalId, stage_hint: stageHint }),
    }),

  removeSignalFromPack: (packId: string, signalId: string) =>
    apiFetch(`/api/signals/packs/${packId}/signals/${signalId}`, { method: 'DELETE' }),

  regenerateAllForPack: (packId: string, orgId: string) =>
    apiFetch<{ regenerated: number; failed: number; total: number }>(
      `/api/signals/packs/${packId}/regenerate-all?org_id=${orgId}`,
      { method: 'POST' },
    ),
};
