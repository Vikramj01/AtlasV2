import { supabase } from '@/lib/supabase';
import type {
  LegacyStrategyBrief,
  StrategyBriefRecord,
  StrategyBriefWithObjectives,
  StrategyObjective,
  StrategyObjectiveCampaign,
  CreateBriefInput,
  CreateObjectiveInput,
  UpdateObjectiveInput,
  AddCampaignInput,
  ObjectiveEvalResult,
} from '@/types/strategy';

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

// ── Legacy types (Sprint 1 wizard) ────────────────────────────────────────────

export interface StrategyEvalInput {
  businessType: string;
  outcomeDescription: string;
  outcomeTimingDays: number;
  currentEventName: string;
  eventSource: string;
  valueDataPresent: boolean;
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

export async function evaluateStrategy(input: StrategyEvalInput): Promise<LegacyStrategyBrief> {
  const body = await apiFetch<{ data: LegacyStrategyBrief }>('/api/strategy/evaluate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.data;
}

// ── Multi-objective API client ────────────────────────────────────────────────

export const strategyApi = {
  // Legacy (Sprint 1 compat)
  evaluate: evaluateStrategy,

  saveBrief: (input: SaveBriefInput) =>
    apiFetch<{ data: { id: string } }>('/api/strategy/save-brief', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Briefs
  createBrief: (input: CreateBriefInput) =>
    apiFetch<{ data: StrategyBriefRecord }>('/api/strategy/briefs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listBriefs: () =>
    apiFetch<{ data: StrategyBriefRecord[] }>('/api/strategy/briefs'),

  getBrief: (id: string) =>
    apiFetch<{ data: StrategyBriefWithObjectives }>(`/api/strategy/briefs/${id}`),

  deleteBrief: (id: string) =>
    apiFetch<{ data: null }>(`/api/strategy/briefs/${id}`, { method: 'DELETE' }),

  // Objectives
  createObjective: (input: CreateObjectiveInput) =>
    apiFetch<{ data: StrategyObjective; message: string | null }>('/api/strategy/objectives', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getObjective: (id: string) =>
    apiFetch<{ data: StrategyObjective }>(`/api/strategy/objectives/${id}`),

  updateObjective: (id: string, input: UpdateObjectiveInput) =>
    apiFetch<{ data: StrategyObjective }>(`/api/strategy/objectives/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteObjective: (id: string) =>
    apiFetch<{ data: null }>(`/api/strategy/objectives/${id}`, { method: 'DELETE' }),

  evaluateObjective: (id: string) =>
    apiFetch<{ data: ObjectiveEvalResult }>(`/api/strategy/objectives/${id}/evaluate`, {
      method: 'POST',
    }),

  lockObjective: (id: string) =>
    apiFetch<{ data: StrategyObjective }>(`/api/strategy/objectives/${id}/lock`, {
      method: 'POST',
    }),

  addCampaign: (objectiveId: string, input: AddCampaignInput) =>
    apiFetch<{ data: StrategyObjectiveCampaign }>(`/api/strategy/objectives/${objectiveId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
