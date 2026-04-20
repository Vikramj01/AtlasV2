import { supabase } from '@/lib/supabase';
import type { StrategyBrief } from '@/types/strategy';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function getAuthHeader(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface StrategyEvalInput {
  businessType: string;
  outcomeDescription: string;
  outcomeTimingDays: number;
  currentEventName: string;
  eventSource: string;
  valueDataPresent: boolean;
}

export interface SavedStrategyBrief {
  id: string;
  verdict: 'keep' | 'add_proxy' | 'switch';
  business_outcome: string;
  current_event: string | null;
  proxy_event: string | null;
  rationale: string | null;
  created_at: string;
}

export interface SaveBriefInput {
  business_outcome: string;
  outcome_timing_days: number;
  current_event?: string;
  verdict: 'keep' | 'add_proxy' | 'switch';
  proxy_event?: string;
  rationale?: string;
  client_id?: string;
  project_id?: string;
}

export async function evaluateStrategy(input: StrategyEvalInput): Promise<StrategyBrief> {
  const body = await apiFetch<{ data: StrategyBrief }>('/api/strategy/evaluate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.data;
}

export const strategyApi = {
  evaluate: evaluateStrategy,

  saveBrief: (input: SaveBriefInput) =>
    apiFetch<{ data: { id: string } }>('/api/strategy/save-brief', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listBriefs: () =>
    apiFetch<{ data: SavedStrategyBrief[] }>('/api/strategy/briefs'),
};
