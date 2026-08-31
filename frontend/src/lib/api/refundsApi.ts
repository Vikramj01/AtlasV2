/**
 * Refund/return feedback — API Client
 *
 * Follows the same pattern as capiApi.ts / consentApi.ts.
 */

import { supabase } from '@/lib/supabase';
import type { RefundEvent, RecordRefundPayload } from '@/types/refunds';

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
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message ?? body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const refundsApi = {
  async list(): Promise<RefundEvent[]> {
    const result = await apiFetch<{ data: RefundEvent[] }>('/api/refunds');
    return result.data;
  },

  async record(payload: RecordRefundPayload): Promise<RefundEvent> {
    const result = await apiFetch<{ data: RefundEvent }>('/api/refunds', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result.data;
  },

  async downloadAdjustmentCsv(refundId: string, filename: string): Promise<void> {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE}/api/refunds/${refundId}/adjustment.csv`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) throw new Error(`Failed to download adjustment CSV: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
