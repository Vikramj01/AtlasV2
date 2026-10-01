import { supabase } from '@/lib/supabase';
import type {
  DeclareTopologyRequest,
  GoogleTagTopology,
  SplitDeployResponse,
  SplitPlanResponse,
  SplitVerifyResponse,
  TopologyVerdictResult,
} from '@/types/googleTagTopology';
import type { GTMContainer } from '@/types/ihc';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string; message?: string }).error ?? (body as { message?: string }).message;
    throw new Error(message ?? `Request failed: ${res.status}`);
  }
  return res;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiFetch(path, init)).json() as Promise<T>;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const googleTagTopologyApi = {
  async getTopology(orgId: string, clientId: string): Promise<GoogleTagTopology> {
    const res = await apiJson<{ data: GoogleTagTopology }>(`/api/organisations/${orgId}/clients/${clientId}/google-tag-topology`);
    return res.data;
  },

  async declare(orgId: string, clientId: string, body: DeclareTopologyRequest): Promise<TopologyVerdictResult> {
    const res = await apiJson<{ data: TopologyVerdictResult }>(
      `/api/organisations/${orgId}/clients/${clientId}/google-tag-topology/declare`,
      post(body),
    );
    return res.data;
  },

  /** The org's connected GTM containers (the split plan is built per connection). */
  async listContainers(): Promise<GTMContainer[]> {
    const res = await apiJson<{ data: GTMContainer[] }>('/api/gtm/containers');
    return res.data ?? [];
  },

  async planSplit(connectionId: string, persist = false): Promise<SplitPlanResponse> {
    const res = await apiJson<{ data: SplitPlanResponse }>('/api/gtm/split-plan', post({ connection_id: connectionId, persist }));
    return res.data;
  },

  async deploySplit(connectionId: string, planId?: string): Promise<SplitDeployResponse> {
    const res = await apiJson<{ data: SplitDeployResponse }>(
      '/api/gtm/split-plan/deploy',
      post({ connection_id: connectionId, ...(planId ? { plan_id: planId } : {}) }),
    );
    return res.data;
  },

  /** `splitDate` (YYYY-MM-DD, optional) is when the operator actually split the tags, if earlier than today. */
  async verifySplit(planId: string, splitDate?: string): Promise<SplitVerifyResponse> {
    const res = await apiJson<{ data: SplitVerifyResponse }>(
      `/api/gtm/split-plan/${planId}/verify`,
      post(splitDate ? { split_date: splitDate } : {}),
    );
    return res.data;
  },

  /** The delta as GTM import JSON (needs the auth header, so it is fetched, not linked). */
  async downloadSplit(planId: string): Promise<Blob> {
    return (await apiFetch(`/api/gtm/split-plan/${planId}/download`)).blob();
  },
};
