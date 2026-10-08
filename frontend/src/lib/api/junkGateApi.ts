/** Junk conversion gate — API client (GA4 Admin / L11 / Junk Gate PRD Part C). */
import { supabase } from '@/lib/supabase';
import type { BulkHoldResult, HeldConversionList, HoldStatus, JunkGateConfig, JunkGateConfigView, JunkVerdict } from '@/types/junkGate';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/api/junk-gate${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...init?.headers },
  });
  const body = await res.json().catch(() => ({})) as { data?: T; error?: string; message?: string };
  if (!res.ok) throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  return body.data as T;
}

export interface ListHoldsParams {
  client_id?: string;
  status?: HoldStatus[];
  verdict?: JunkVerdict;
  limit?: number;
  offset?: number;
}

export const junkGateApi = {
  getConfig: (clientId: string) => apiFetch<JunkGateConfigView>(`/config?client_id=${encodeURIComponent(clientId)}`),

  saveConfig: (clientId: string, patch: Partial<JunkGateConfig>) =>
    apiFetch<JunkGateConfigView>('/config', { method: 'PUT', body: JSON.stringify({ client_id: clientId, ...patch }) }),

  listHolds: (p: ListHoldsParams) => {
    const qs = new URLSearchParams();
    if (p.client_id) qs.set('client_id', p.client_id);
    if (p.status?.length) qs.set('status', p.status.join(','));
    if (p.verdict) qs.set('verdict', p.verdict);
    if (p.limit) qs.set('limit', String(p.limit));
    if (p.offset) qs.set('offset', String(p.offset));
    return apiFetch<HeldConversionList>(`/holds?${qs.toString()}`);
  },

  release: (id: string) => apiFetch<unknown>(`/holds/${id}/release`, { method: 'POST' }),
  reject: (id: string) => apiFetch<unknown>(`/holds/${id}/reject`, { method: 'POST' }),
  bulk: (ids: string[], action: 'release' | 'reject') =>
    apiFetch<BulkHoldResult>('/holds/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) }),
};
