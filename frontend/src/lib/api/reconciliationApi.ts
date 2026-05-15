import { supabase } from '@/lib/supabase';

const BASE = '/api/reconciliation';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export interface ReconciliationRun {
  id: string;
  run_type: 'scheduled' | 'manual' | 'post_brief_lock';
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  platforms_run: string[];
  total_findings: number;
  error_summary: string | null;
  brief_id: string | null;
}

export interface ReconciliationFinding {
  id: string;
  run_id: string;
  organization_id: string;
  client_id: string;
  brief_id: string | null;
  objective_id: string | null;
  platform: string;
  dimension: 'delivery' | 'config' | 'alignment' | 'volume';
  severity: 'info' | 'warning' | 'error' | 'critical';
  finding_code: string;
  expected: Record<string, unknown> | null;
  observed: Record<string, unknown> | null;
  narrative: string;
  remediation_hint: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface FindingFilters {
  dimension?: ReconciliationFinding['dimension'];
  severity?: ReconciliationFinding['severity'];
  platform?: string;
  resolved?: boolean;
}

export const reconciliationApi = {
  listRuns(clientId: string) {
    return req<{ data: ReconciliationRun[] }>('GET', `${BASE}/runs?clientId=${clientId}`);
  },

  getRun(runId: string) {
    return req<{
      data: {
        run: ReconciliationRun;
        findings_by_dimension: Record<string, ReconciliationFinding[]>;
        all_findings: ReconciliationFinding[];
      };
    }>('GET', `${BASE}/runs/${runId}`);
  },

  getFindings(runId: string, filters: FindingFilters = {}) {
    const params = new URLSearchParams();
    if (filters.dimension) params.set('dimension', filters.dimension);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.resolved !== undefined) params.set('resolved', String(filters.resolved));
    const qs = params.toString();
    return req<{ data: ReconciliationFinding[] }>('GET', `${BASE}/runs/${runId}/findings${qs ? `?${qs}` : ''}`);
  },

  resolveFinding(findingId: string) {
    return req<{ message: string }>('PATCH', `${BASE}/findings/${findingId}/resolve`);
  },

  triggerRun(clientId: string, briefId?: string) {
    return req<{ data: { runId: string }; message: string }>('POST', `${BASE}/trigger`, {
      clientId,
      briefId,
    });
  },

  getLatestRunForBrief(briefId: string, clientId: string) {
    return this.listRuns(clientId).then((res) => {
      const run = res.data.find((r) => r.brief_id === briefId);
      return run ?? null;
    });
  },
};
