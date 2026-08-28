import { supabase } from '@/lib/supabase';
import type {
  SignalValidatorRun,
  SignalValidatorScanResponse,
  SignalValidatorCheckoutResponse,
  SignalValidatorPurchaseStatus,
} from '@/types/campaignSignalValidator';

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
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const campaignSignalValidatorApi = {
  // ── In-app (authenticated) ────────────────────────────────────────────────
  scan(url: string, clientId?: string | null): Promise<{ data: SignalValidatorScanResponse }> {
    return apiFetch('/api/campaign-signal-validator/scan', {
      method: 'POST',
      body: JSON.stringify({ url, client_id: clientId ?? undefined }),
    });
  },

  listRuns(clientId?: string | null): Promise<{ data: SignalValidatorRun[] }> {
    const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
    return apiFetch(`/api/campaign-signal-validator/runs${query}`);
  },

  getRun(runId: string): Promise<{ data: SignalValidatorRun }> {
    return apiFetch(`/api/campaign-signal-validator/runs/${runId}`);
  },

  downloadPdf(runId: string): Promise<Blob> {
    return getAuthHeader().then((auth) =>
      fetch(`${API_BASE}/api/campaign-signal-validator/runs/${runId}/pdf`, {
        headers: { Authorization: auth },
      }).then((r) => r.blob())
    );
  },

  // ── Standalone (public, paid) ────────────────────────────────────────────
  createCheckout(url: string, email: string): Promise<{ data: SignalValidatorCheckoutResponse }> {
    return publicFetch('/api/campaign-signal-validator/checkout', {
      method: 'POST',
      body: JSON.stringify({ url, email }),
    });
  },

  getPurchaseStatus(sessionId: string): Promise<{ data: SignalValidatorPurchaseStatus }> {
    return publicFetch(`/api/campaign-signal-validator/purchases/${sessionId}`);
  },
};
