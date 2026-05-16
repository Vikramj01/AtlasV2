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

  getTolerance(clientId: string) {
    return req<{ data: ToleranceConfig[] }>('GET', `${BASE}/tolerance?clientId=${clientId}`);
  },

  upsertTolerance(body: UpsertToleranceInput) {
    return req<{ data: ToleranceConfig }>('PUT', `${BASE}/tolerance`, body);
  },

  getStats(clientId: string, opts: { days?: number; eventName?: string; platform?: string } = {}) {
    const params = new URLSearchParams({ clientId });
    if (opts.days) params.set('days', String(opts.days));
    if (opts.eventName) params.set('eventName', opts.eventName);
    if (opts.platform) params.set('platform', opts.platform);
    return req<{ data: EventStatGroup[] }>('GET', `${BASE}/stats?${params}`);
  },
};

export interface ToleranceConfig {
  id: string;
  client_id: string;
  event_name: string | null;
  platform: string | null;
  volume_tolerance_pct: number;
  dedup_warn_threshold: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertToleranceInput {
  clientId: string;
  eventName?: string | null;
  platform?: string | null;
  volumeTolerancePct?: number;
  dedupWarnThreshold?: number;
  enabled?: boolean;
}

export interface EventStatRow {
  date: string;
  event_name: string;
  platform: string;
  platform_count: number;
  atlas_count: number | null;
  delta_pct: number | null;
  quality_signals: Record<string, number> | null;
}

export interface EventStatGroup {
  event_name: string;
  platform: string;
  rows: EventStatRow[];
}
