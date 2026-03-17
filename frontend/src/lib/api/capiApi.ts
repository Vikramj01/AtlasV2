/**
 * CAPI Module — API Client
 *
 * All CAPI API calls go through this module.
 * Follows the same pattern as consentApi.ts / auditApi.ts.
 */

import { supabase } from '@/lib/supabase';
import type {
  CAPIProviderConfig,
  CreateProviderRequest,
  CreateProviderResponse,
  TestProviderRequest,
  TestProviderResponse,
  ActivateProviderResponse,
  ProviderDashboardResponse,
  AtlasEvent,
} from '@/types/capi';

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

export const capiApi = {
  // ── Providers ─────────────────────────────────────────────────────────────

  listProviders(): Promise<CAPIProviderConfig[]> {
    return apiFetch('/api/capi/providers');
  },

  getProvider(id: string): Promise<CAPIProviderConfig> {
    return apiFetch(`/api/capi/providers/${id}`);
  },

  createProvider(payload: CreateProviderRequest): Promise<CreateProviderResponse> {
    return apiFetch('/api/capi/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProvider(
    id: string,
    patch: Partial<Pick<CAPIProviderConfig, 'event_mapping' | 'identifier_config' | 'dedup_config' | 'test_event_code'>>,
  ): Promise<CAPIProviderConfig> {
    return apiFetch(`/api/capi/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deleteProvider(id: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/capi/providers/${id}`, { method: 'DELETE' });
  },

  // ── Test + Activate ───────────────────────────────────────────────────────

  testProvider(id: string, testEvents: AtlasEvent[]): Promise<TestProviderResponse> {
    return apiFetch(`/api/capi/providers/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ test_events: testEvents } satisfies TestProviderRequest),
    });
  },

  activateProvider(id: string): Promise<ActivateProviderResponse> {
    return apiFetch(`/api/capi/providers/${id}/activate`, { method: 'POST' });
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getDashboard(id: string, days = 30): Promise<ProviderDashboardResponse> {
    return apiFetch(`/api/capi/providers/${id}/dashboard?days=${days}`);
  },
};
