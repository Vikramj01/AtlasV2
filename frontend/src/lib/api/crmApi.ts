import { supabase } from '@/lib/supabase';
import type {
  CrmSyncConfig,
  CreateCrmSyncConfigInput,
  UpdateCrmSyncConfigInput,
  CrmAccountInfo,
  CrmPipeline,
  ReadinessResult,
} from '@/types/crm';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── HubSpot OAuth (two-phase) ────────────────────────────────────────────────

export async function connectHubSpot(clientId?: string): Promise<{ auth_url: string; state: string }> {
  const qs = clientId ? `?client_id=${encodeURIComponent(clientId)}` : '';
  const res = await apiFetch<{ data: { auth_url: string; state: string } }>(`/crm/oauth/hubspot/start${qs}`);
  return res.data;
}

/** Call after HubSpot redirects back to the callback route with `code`/`state`. */
export async function discoverHubSpotPortal(
  code: string,
  state: string,
): Promise<{ ref: string; account: CrmAccountInfo; pipelines: CrmPipeline[] }> {
  const res = await apiFetch<{ data: { ref: string; account: CrmAccountInfo; pipelines: CrmPipeline[] } }>(
    `/crm/oauth/hubspot/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
  return res.data;
}

/** Persists the connection once the discovered portal is confirmed. */
export async function finalizeHubSpotConnection(ref: string): Promise<{ connection_id: string; account: CrmAccountInfo }> {
  const res = await apiFetch<{ data: { connection_id: string; account: CrmAccountInfo } }>(
    '/crm/oauth/hubspot/callback/finalize',
    { method: 'POST', body: JSON.stringify({ ref }) },
  );
  return res.data;
}

// ── Configs ───────────────────────────────────────────────────────────────────

export async function listConfigs(): Promise<CrmSyncConfig[]> {
  const res = await apiFetch<{ data: CrmSyncConfig[] }>('/crm/configs');
  return res.data ?? [];
}

export async function createConfig(input: CreateCrmSyncConfigInput): Promise<CrmSyncConfig> {
  const res = await apiFetch<{ data: CrmSyncConfig }>('/crm/configs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateConfig(id: string, patch: UpdateCrmSyncConfigInput): Promise<CrmSyncConfig> {
  const res = await apiFetch<{ data: CrmSyncConfig }>(`/crm/configs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.data;
}

export async function deleteConfig(id: string): Promise<void> {
  await apiFetch(`/crm/configs/${id}`, { method: 'DELETE' });
}

export async function getPipelines(configId: string): Promise<CrmPipeline[]> {
  const res = await apiFetch<{ data: CrmPipeline[] }>(`/crm/configs/${configId}/pipelines`);
  return res.data ?? [];
}

export async function checkReadiness(configId: string): Promise<ReadinessResult> {
  const res = await apiFetch<{ data: ReadinessResult }>(`/crm/configs/${configId}/readiness`, { method: 'POST' });
  return res.data;
}

export const crmApi = {
  connectHubSpot,
  discoverHubSpotPortal,
  finalizeHubSpotConnection,
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
  getPipelines,
  checkReadiness,
};
