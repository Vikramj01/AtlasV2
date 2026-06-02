import { supabase } from '@/lib/supabase';
import type {
  ClientIdentityConfig,
  SignalEnrichmentConfig,
  ClientEnrichmentScore,
  SaveIdentityConfigRequest,
  SaveSignalEnrichmentRequest,
  ValidateFieldPathRequest,
  ValidateFieldPathResponse,
  EnrichmentValidationResult,
} from '@/types/enrichment';

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

export const enrichmentApi = {
  // ── Identity Config ────────────────────────────────────────────────────────

  getIdentityConfig: (orgId: string, clientId: string) =>
    apiFetch<{ data: ClientIdentityConfig | null }>(
      `/api/organisations/${orgId}/clients/${clientId}/identity-config`,
    ).then((r) => r.data),

  saveIdentityConfig: (orgId: string, clientId: string, req: SaveIdentityConfigRequest) =>
    apiFetch<{ data: ClientIdentityConfig }>(
      `/api/organisations/${orgId}/clients/${clientId}/identity-config`,
      { method: 'PUT', body: JSON.stringify(req) },
    ).then((r) => r.data),

  validateIdentityConfig: (orgId: string, clientId: string) =>
    apiFetch<{ data: { score: number; identity_score: number } }>(
      `/api/organisations/${orgId}/clients/${clientId}/identity-config/validate`,
      { method: 'POST', body: JSON.stringify({}) },
    ).then((r) => r.data),

  // ── Signal Enrichment ──────────────────────────────────────────────────────

  listSignalEnrichments: (orgId: string, clientId: string, deploymentId: string) =>
    apiFetch<{ data: SignalEnrichmentConfig[] }>(
      `/api/organisations/${orgId}/clients/${clientId}/deployments/${deploymentId}/enrichment`,
    ).then((r) => r.data),

  saveSignalEnrichment: (
    orgId: string,
    clientId: string,
    deploymentId: string,
    signalKey: string,
    req: SaveSignalEnrichmentRequest,
  ) =>
    apiFetch<{ data: SignalEnrichmentConfig; validation: EnrichmentValidationResult }>(
      `/api/organisations/${orgId}/clients/${clientId}/deployments/${deploymentId}/enrichment/${signalKey}`,
      { method: 'PUT', body: JSON.stringify(req) },
    ),

  validateSignalEnrichment: (orgId: string, clientId: string, deploymentId: string, signalKey: string) =>
    apiFetch<{ data: EnrichmentValidationResult }>(
      `/api/organisations/${orgId}/clients/${clientId}/deployments/${deploymentId}/enrichment/${signalKey}/validate`,
      { method: 'POST', body: JSON.stringify({}) },
    ).then((r) => r.data),

  // ── Field Path Validation ──────────────────────────────────────────────────

  validateFieldPath: (orgId: string, clientId: string, req: ValidateFieldPathRequest) =>
    apiFetch<{ data: ValidateFieldPathResponse }>(
      `/api/organisations/${orgId}/clients/${clientId}/validate-field-path`,
      { method: 'POST', body: JSON.stringify(req) },
    ).then((r) => r.data),

  // ── Enrichment Score ───────────────────────────────────────────────────────

  getEnrichmentScore: (orgId: string, clientId: string) =>
    apiFetch<{ data: ClientEnrichmentScore }>(
      `/api/organisations/${orgId}/clients/${clientId}/enrichment-score`,
    ).then((r) => r.data),
};
