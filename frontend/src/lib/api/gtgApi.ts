import { supabase } from '@/lib/supabase';
import type { GtgStatus } from '@/lib/gtgStatus';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export type GtgProbeSummary = 'none' | 'inconclusive' | 'broken' | 'ok' | 'no_geo';

export interface GtgEndpoint {
  id: string;
  hostname: string;
  reserved_path: string;
  tag_or_container: string;
  source: 'detected' | 'operator_declared' | 'atlas_generated';
  is_verified: boolean;
  geo_verified: boolean;
  verified_at: string | null;
  probe_urls: { healthy: string; geo: string };
}

export interface GtgOverview {
  status: GtgStatus;
  status_updated_at: string | null;
  went_live_at: string | null;
  capture_status: GtgStatus;
  probe_status: GtgProbeSummary;
  probe_checked_at: string | null;
  endpoints: GtgEndpoint[];
  recent_checks: Array<{
    endpoint_id: string | null; check_status: string; geo_status: string | null; http_status: number | null;
    response_ms: number | null; error_message: string | null; checked_at: string;
  }>;
  max_endpoints: number;
}

export interface GtgVerifyResult {
  status: GtgStatus;
  probe_status: GtgProbeSummary;
  probe_checked_at: string | null;
  results: Array<{
    endpoint_id: string;
    path_status: 'pass' | 'degraded' | 'fail' | 'timeout' | 'error';
    geo_status: 'pass' | 'fail' | 'skipped';
    verdict: 'ok' | 'no_geo' | 'broken' | 'inconclusive';
    http_status: number | null;
    response_ms: number | null;
    message: string | null;
  }>;
}

export interface GtgEndpointInput {
  hostname: string;
  reserved_path: string;
  tag_or_container: string;
}

async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: await authHeader(), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Prefer the specific message (e.g. which validation rule failed) over the short error label.
    const b = body as { error?: string; message?: string };
    throw new Error(b.message && b.message !== b.error ? b.message : b.error ?? `Request failed: ${res.status}`);
  }
  return (body as { data: T }).data;
}

const base = (orgId: string, clientId: string) => `/api/organisations/${orgId}/clients/${clientId}/gtg`;

export const gtgApi = {
  getOverview: (orgId: string, clientId: string) => call<GtgOverview>(base(orgId, clientId)),
  addEndpoint: (orgId: string, clientId: string, body: GtgEndpointInput) =>
    call<GtgEndpoint>(`${base(orgId, clientId)}/endpoints`, { method: 'POST', body: JSON.stringify(body) }),
  removeEndpoint: (orgId: string, clientId: string, endpointId: string) =>
    call<{ removed: boolean }>(`${base(orgId, clientId)}/endpoints/${endpointId}`, { method: 'DELETE' }),
  verify: (orgId: string, clientId: string) => call<GtgVerifyResult>(`${base(orgId, clientId)}/verify`, { method: 'POST' }),
};
