/**
 * Consent Hub — API Client
 *
 * All Consent Hub API calls go through this module.
 * Follows the same pattern as auditApi.ts.
 */

import { supabase } from '@/lib/supabase';
import type {
  ConsentConfig,
  ConsentAnalyticsResponse,
  ConsentAnalyticsParams,
  RecordConsentRequest,
  RecordConsentResponse,
  GetConsentResponse,
  DeleteConsentResponse,
} from '@/types/consent';

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

export const consentApi = {
  // ── Config ────────────────────────────────────────────────────────────────

  /** Get the consent config for a project. Returns null if not configured yet. */
  getConfig(projectId: string): Promise<ConsentConfig> {
    return apiFetch(`/api/consent/config/${projectId}`);
  },

  /** Create or update (upsert) a consent config. */
  saveConfig(
    projectId: string,
    organizationId: string,
    config: Partial<Omit<ConsentConfig, 'id' | 'project_id' | 'organization_id' | 'created_at' | 'updated_at'>>,
  ): Promise<ConsentConfig> {
    return apiFetch('/api/consent/config', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, organization_id: organizationId, ...config }),
    });
  },

  // ── Consent Records ───────────────────────────────────────────────────────

  /**
   * Record a visitor's consent decision.
   * Note: does NOT use auth — this can be called from a banner snippet.
   * But we expose it here too for programmatic use from the Atlas dashboard.
   */
  async recordConsent(payload: RecordConsentRequest): Promise<RecordConsentResponse> {
    const res = await fetch(`${API_BASE}/api/consent/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      throw new Error(body.message ?? `Consent record failed: ${res.status}`);
    }
    return res.json() as Promise<RecordConsentResponse>;
  },

  /** Get the latest consent state for a visitor. */
  getConsentState(projectId: string, visitorId: string): Promise<GetConsentResponse> {
    return apiFetch(`/api/consent/${projectId}/${encodeURIComponent(visitorId)}`);
  },

  /** Delete all consent records for a visitor (right to erasure). */
  deleteConsentRecords(projectId: string, visitorId: string): Promise<DeleteConsentResponse> {
    return apiFetch(`/api/consent/${projectId}/${encodeURIComponent(visitorId)}`, {
      method: 'DELETE',
    });
  },

  // ── Analytics ─────────────────────────────────────────────────────────────

  getAnalytics(
    projectId: string,
    params: Partial<ConsentAnalyticsParams> = {},
  ): Promise<ConsentAnalyticsResponse> {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return apiFetch(`/api/consent/${projectId}/analytics${qs ? `?${qs}` : ''}`);
  },
};
