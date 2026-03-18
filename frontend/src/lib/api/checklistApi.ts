import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ChecklistStep {
  complete: boolean;
  [key: string]: unknown;
}

export interface SetupChecklistResponse {
  steps: {
    site_scanned:         ChecklistStep & { planning_session_id: string | null };
    consent_configured:   ChecklistStep & { consent_config_id: string | null };
    tracking_generated:   ChecklistStep & { has_gtm_output: boolean; has_datalayer_output: boolean };
    shared_with_developer: ChecklistStep & { share_count: number };
    capi_connected:       ChecklistStep & { providers: string[]; active_providers: string[] };
    audit_passed:         ChecklistStep & { last_audit_id: string | null; last_audit_date: string | null };
  };
  overall_progress_pct: number;
  readiness_level: 'getting_started' | 'building' | 'strong' | 'best_in_class';
}

export const checklistApi = {
  getChecklist: () => apiFetch<SetupChecklistResponse>('/api/setup-checklist'),
};
