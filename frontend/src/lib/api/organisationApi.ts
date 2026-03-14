import { supabase } from '@/lib/supabase';
import type {
  Organisation,
  OrganisationMember,
  Client,
  ClientWithDetails,
  ClientPlatform,
  ClientPage,
  ClientDeployment,
  ClientOutput,
  MemberRole,
  BusinessType,
  PlatformKey,
} from '@/types/organisation';

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

// ── Organisations ──────────────────────────────────────────────────────────────

export const organisationApi = {
  create: (data: { name: string; slug: string }) =>
    apiFetch<Organisation>('/api/organisations', { method: 'POST', body: JSON.stringify(data) }),

  list: () =>
    apiFetch<{ organisations: Organisation[] }>('/api/organisations').then((r) => r.organisations),

  get: (orgId: string) =>
    apiFetch<Organisation & { member_count: number; client_count: number }>(`/api/organisations/${orgId}`),

  update: (orgId: string, data: { name?: string }) =>
    apiFetch<Organisation>(`/api/organisations/${orgId}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (orgId: string) =>
    apiFetch<{ deleted: boolean }>(`/api/organisations/${orgId}`, { method: 'DELETE' }),

  // Members
  listMembers: (orgId: string) =>
    apiFetch<{ members: OrganisationMember[] }>(`/api/organisations/${orgId}/members`).then((r) => r.members),

  inviteMember: (orgId: string, email: string, role: MemberRole = 'member') =>
    apiFetch<OrganisationMember>(`/api/organisations/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  updateMemberRole: (orgId: string, memberId: string, role: MemberRole) =>
    apiFetch<OrganisationMember>(`/api/organisations/${orgId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (orgId: string, memberId: string) =>
    apiFetch<{ deleted: boolean }>(`/api/organisations/${orgId}/members/${memberId}`, { method: 'DELETE' }),
};

// ── Clients ────────────────────────────────────────────────────────────────────

export const clientApi = {
  create: (orgId: string, data: {
    name: string;
    website_url: string;
    business_type: BusinessType;
    notes?: string;
    auto_detect?: boolean;
  }) =>
    apiFetch<Client>(`/api/organisations/${orgId}/clients`, { method: 'POST', body: JSON.stringify(data) }),

  list: (orgId: string) =>
    apiFetch<{ clients: ClientWithDetails[] }>(`/api/organisations/${orgId}/clients`).then((r) => r.clients),

  get: (orgId: string, clientId: string) =>
    apiFetch<ClientWithDetails & { deployments: ClientDeployment[]; outputs: ClientOutput[] }>(
      `/api/organisations/${orgId}/clients/${clientId}`,
    ),

  update: (orgId: string, clientId: string, data: Partial<Client>) =>
    apiFetch<Client>(`/api/organisations/${orgId}/clients/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  archive: (orgId: string, clientId: string) =>
    apiFetch<{ archived: boolean }>(`/api/organisations/${orgId}/clients/${clientId}`, { method: 'DELETE' }),

  setPlatforms: (
    orgId: string,
    clientId: string,
    platforms: Array<{ platform: PlatformKey; is_active: boolean; measurement_id?: string }>
  ) =>
    apiFetch<{ platforms: ClientPlatform[] }>(`/api/organisations/${orgId}/clients/${clientId}/platforms`, {
      method: 'PUT',
      body: JSON.stringify({ platforms }),
    }),

  setPages: (
    orgId: string,
    clientId: string,
    pages: Array<{ label: string; url: string; page_type?: string; stage_order: number }>
  ) =>
    apiFetch<{ pages: ClientPage[] }>(`/api/organisations/${orgId}/clients/${clientId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ pages }),
    }),

  // Deployments
  deployPack: (orgId: string, clientId: string, packId: string, signalOverrides?: Record<string, unknown>) =>
    apiFetch<ClientDeployment>(`/api/organisations/${orgId}/clients/${clientId}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ pack_id: packId, signal_overrides: signalOverrides }),
    }),

  removeDeployment: (orgId: string, clientId: string, deploymentId: string) =>
    apiFetch<{ deleted: boolean }>(
      `/api/organisations/${orgId}/clients/${clientId}/deploy/${deploymentId}`,
      { method: 'DELETE' },
    ),

  // Output generation
  generateOutputs: (orgId: string, clientId: string) =>
    apiFetch<{ outputs: ClientOutput[] }>(`/api/organisations/${orgId}/clients/${clientId}/generate`, { method: 'POST' }),

  regenerateAll: (orgId: string, clientId: string, packId: string) =>
    apiFetch<{ regenerated: number; failed: number; total: number }>(
      `/api/organisations/${orgId}/clients/${clientId}/generate-all`,
      { method: 'POST', body: JSON.stringify({ pack_id: packId }) },
    ),

  listOutputs: (orgId: string, clientId: string) =>
    apiFetch<{ outputs: ClientOutput[] }>(`/api/organisations/${orgId}/clients/${clientId}/outputs`).then((r) => r.outputs),

  downloadOutputUrl: (orgId: string, clientId: string, outputId: string) =>
    `${API_BASE}/api/organisations/${orgId}/clients/${clientId}/outputs/${outputId}/download`,

  // Run audit
  runAudit: (orgId: string, clientId: string, data?: { test_email?: string; test_phone?: string }) =>
    apiFetch<{ audit_id: string; status: string; created_at: string }>(
      `/api/organisations/${orgId}/clients/${clientId}/audit`,
      { method: 'POST', body: JSON.stringify(data ?? {}) },
    ),
};
