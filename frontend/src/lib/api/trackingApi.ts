import { supabase } from '@/lib/supabase';
import type {
  TrackingStatus,
  DeliverablesBuildResult,
  ShareLinkResult,
  PublicShareResult,
} from '@/types/tracking';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  return body as T;
}

export async function fetchTrackingStatus(clientId: string): Promise<TrackingStatus> {
  const result = await apiFetch<{ data: TrackingStatus; error: string | null }>(
    `/api/tracking/clients/${clientId}/status`,
  );
  if (result.error) throw new Error(result.error);
  return result.data;
}

export async function buildDeliverables(clientId: string): Promise<DeliverablesBuildResult> {
  const result = await apiFetch<{ data: DeliverablesBuildResult; error: string | null }>(
    `/api/tracking/clients/${clientId}/deliverables/build`,
  );
  if (result.error) throw new Error(result.error);
  return result.data;
}

export async function exportDeliverable(
  clientId: string,
  exportType: 'gtm_container' | 'datalayer_spec' | 'combined',
): Promise<void> {
  await apiFetch(`/api/tracking/clients/${clientId}/deliverables/export`, {
    method: 'POST',
    body: JSON.stringify({ export_type: exportType }),
  });
}

export async function generateShareLink(
  clientId: string,
  expiresInDays = 30,
): Promise<ShareLinkResult> {
  const result = await apiFetch<{ data: ShareLinkResult; error: string | null }>(
    `/api/tracking/clients/${clientId}/deliverables/share`,
    { method: 'POST', body: JSON.stringify({ expires_in_days: expiresInDays }) },
  );
  if (result.error) throw new Error(result.error);
  return result.data;
}

export async function fetchPublicShare(token: string): Promise<PublicShareResult> {
  const res = await fetch(`${API_BASE}/api/share/${token}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { error?: string }).error) {
    throw new Error((body as { error?: string }).error ?? 'Link not found or expired');
  }
  return (body as { data: PublicShareResult }).data;
}
