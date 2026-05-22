/**
 * Enricher Module — API Client
 *
 * All Bid Signal Enricher API calls go through this module.
 * Follows the same pattern as capiApi.ts.
 */

import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export interface EnricherDestination {
  type: 'GOOGLE_ADS' | 'GA4' | 'DV360' | 'CM360';
  customerId?: string;
  propertyId?: string;
  advertiserId?: string;
}

export interface EnricherRun {
  id: string;
  ingest_type: string;
  destinations: EnricherDestination[];
  operation_type: string;
  status: string;
  record_count: number;
  matched_count: number | null;
  failed_count: number | null;
  match_rate: number | null;
  error_message: string | null;
  triggered_by: string;
  created_at: string;
}

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

export const enricherApi = {
  triggerRun(payload: {
    destinations: EnricherDestination[];
    contacts: Array<{ email?: string; phone?: string; first_name?: string; last_name?: string; zip?: string; country?: string }>;
    operation_type?: 'CREATE' | 'REMOVE';
  }): Promise<{ data: { run_id: string; record_count: number; matched_count: number; failed_count: number; match_rate: number; member_errors: Array<{ index: number; code: string; message: string }> } }> {
    return apiFetch('/api/enricher/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listRuns(): Promise<{ data: EnricherRun[] }> {
    return apiFetch('/api/enricher/runs');
  },
};
