import { supabase } from '@/lib/supabase';
import type { SignalEventRow, SignalEventDetail, SignalAggregates, ExportJob } from '@/types/signal-tracking';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: auth, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface ListResponse {
  data: SignalEventRow[];
  next_cursor: string | null;
  count: number;
}

interface AggregatesResponse {
  data: SignalAggregates;
}

interface DetailResponse {
  data: SignalEventDetail;
}

interface ExportCreateResponse {
  data: { job_id: string; row_estimate: number };
}

interface ExportPollResponse {
  data: ExportJob;
}

export interface ListParams {
  from: string;
  to: string;
  destinations?: string[];
  event_names?: string[];
  statuses?: string[];
  dedup_statuses?: string[];
  cursor?: string;
  limit?: number;
}

function toQueryString(params: Record<string, string | string[] | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) parts.push(`${k}=${encodeURIComponent(v.join(','))}`);
    } else {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export const signalEventsApi = {
  list: (p: ListParams) =>
    apiFetch<ListResponse>(`/api/signal-events${toQueryString({
      from:           p.from,
      to:             p.to,
      destinations:   p.destinations,
      event_names:    p.event_names,
      statuses:       p.statuses,
      dedup_statuses: p.dedup_statuses,
      cursor:         p.cursor,
      limit:          p.limit ?? 50,
    })}`),

  aggregates: (from: string, to: string, destinations?: string[]) =>
    apiFetch<AggregatesResponse>(`/api/signal-events/aggregates${toQueryString({ from, to, destinations })}`),

  detail: (event_id: string) =>
    apiFetch<DetailResponse>(`/api/signal-events/${encodeURIComponent(event_id)}`),

  createExport: (body: { from: string; to: string; destinations?: string[]; event_names?: string[]; statuses?: string[] }) =>
    apiFetch<ExportCreateResponse>('/api/signal-events/export', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  pollExport: (job_id: string) =>
    apiFetch<ExportPollResponse>(`/api/signal-events/export/${job_id}`),
};
