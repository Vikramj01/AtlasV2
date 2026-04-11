import { supabase } from '@/lib/supabase';
import type { TaxonomyNode, NamingConvention, ValidationResult, TaxonomySearchResult } from '@/types/taxonomy';

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

export interface ConventionPreviewResult {
  renames: Array<{ signal_id: string; signal_key: string; current: string; proposed: string }>;
  examples: { example_event: string; example_param: string };
  total_signals: number;
}

export interface CreateEventRequest {
  organization_id: string;
  parent_path: string;
  slug: string;
  name: string;
  description?: string;
  funnel_stage?: string;
  parameter_schema: {
    required: Array<{ key: string; label: string; type: string; description: string; format: string | null }>;
    optional: Array<{ key: string; label: string; type: string; description: string; format: string | null }>;
  };
  platform_mappings?: Record<string, unknown>;
  icon?: string;
}

export const taxonomyApi = {
  // ── Tree & events ──────────────────────────────────────────────────────────
  getTree: (orgId: string) =>
    apiFetch<{ tree: TaxonomyNode[] }>(`/api/taxonomy/tree?org_id=${orgId}`).then((r) => r.tree),

  getEvents: (orgId: string, filters?: { category?: string; funnel_stage?: string }) => {
    const params = new URLSearchParams({ org_id: orgId });
    if (filters?.category) params.set('category', filters.category);
    if (filters?.funnel_stage) params.set('funnel_stage', filters.funnel_stage);
    return apiFetch<{ events: TaxonomyNode[] }>(`/api/taxonomy/events?${params}`).then((r) => r.events);
  },

  search: (orgId: string, q: string) =>
    apiFetch<{ results: TaxonomySearchResult[] }>(
      `/api/taxonomy/search?org_id=${encodeURIComponent(orgId)}&q=${encodeURIComponent(q)}`,
    ).then((r) => r.results),

  getNode: (id: string) =>
    apiFetch<{ node: TaxonomyNode }>(`/api/taxonomy/${id}`).then((r) => r.node),

  // ── Create / update / delete ───────────────────────────────────────────────
  createEvent: (data: CreateEventRequest) =>
    apiFetch<{ node: TaxonomyNode }>('/api/taxonomy/event', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.node),

  createCategory: (data: {
    organization_id: string;
    parent_path?: string;
    slug: string;
    name: string;
    description?: string;
    icon?: string;
  }) =>
    apiFetch<{ node: TaxonomyNode }>('/api/taxonomy/category', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.node),

  updateNode: (
    id: string,
    data: Partial<Pick<TaxonomyNode, 'name' | 'description' | 'funnel_stage' | 'platform_mappings' | 'parameter_schema' | 'icon' | 'display_order'>>,
  ) =>
    apiFetch<{ node: TaxonomyNode }>(`/api/taxonomy/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }).then((r) => r.node),

  deleteNode: (id: string, force = false) =>
    apiFetch<{ success: boolean }>(`/api/taxonomy/${id}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),

  // ── Naming convention ──────────────────────────────────────────────────────
  getConvention: (orgId: string) =>
    apiFetch<{ convention: NamingConvention }>(`/api/naming-convention?org_id=${orgId}`).then(
      (r) => r.convention,
    ),

  updateConvention: (data: Partial<NamingConvention> & { organization_id: string }) =>
    apiFetch<{ convention: NamingConvention }>('/api/naming-convention', {
      method: 'PUT',
      body: JSON.stringify(data),
    }).then((r) => r.convention),

  validateName: (name: string, type: 'event' | 'param', orgId: string) =>
    apiFetch<ValidationResult>('/api/naming-convention/validate', {
      method: 'POST',
      body: JSON.stringify({ name, type, org_id: orgId }),
    }),

  previewConvention: (orgId: string, proposed: Partial<NamingConvention>) =>
    apiFetch<ConventionPreviewResult>('/api/naming-convention/preview', {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, proposed }),
    }),
};
