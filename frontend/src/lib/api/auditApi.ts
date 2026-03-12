import { supabase } from '@/lib/supabase';
import type {
  StartAuditInput,
  AuditStartResponse,
  AuditStatusResponse,
  ReportJSON,
} from '@/types/audit';
import type { AuditHistoryItem } from '@/components/audit/AuditHistoryTable';

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
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const auditApi = {
  start(input: StartAuditInput): Promise<AuditStartResponse> {
    return apiFetch('/api/audits/start', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getStatus(audit_id: string): Promise<AuditStatusResponse> {
    return apiFetch(`/api/audits/${audit_id}`);
  },

  getReport(audit_id: string): Promise<ReportJSON> {
    return apiFetch(`/api/audits/${audit_id}/report`);
  },

  list(): Promise<AuditHistoryItem[]> {
    return apiFetch('/api/audits');
  },

  export(audit_id: string, format: 'pdf' | 'json' | 'both'): Promise<Blob> {
    return getAuthHeader().then((auth) =>
      fetch(`${API_BASE}/api/audits/${audit_id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ format }),
      }).then((r) => r.blob())
    );
  },

  startFromJourney(journey_id: string, opts?: { test_email?: string; test_phone?: string }): Promise<{ audit_id: string; journey_id: string; status: string }> {
    return apiFetch('/api/audits/start-from-journey', {
      method: 'POST',
      body: JSON.stringify({ journey_id, ...opts }),
    });
  },

  getGaps(audit_id: string): Promise<unknown[]> {
    return apiFetch(`/api/audits/${audit_id}/gaps`);
  },

  delete(audit_id: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/audits/${audit_id}`, { method: 'DELETE' });
  },
};
