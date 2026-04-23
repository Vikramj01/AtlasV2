import { supabase } from '@/lib/supabase';
import type {
  LegacyStrategyBrief,
  StrategyBrief,
  StrategyObjective,
  ObjectiveCampaign,
  BriefMode,
  ObjectivePlatform,
  ObjectiveVerdict,
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

// ── Legacy types (Sprint 1 backward compat) ───────────────────────────────────

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

export async function evaluateStrategy(input: StrategyEvalInput): Promise<LegacyStrategyBrief> {
  const body = await apiFetch<{ data: LegacyStrategyBrief }>('/api/strategy/evaluate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.data;
}

// ── Sprint 1.6 input types ────────────────────────────────────────────────────

export interface CreateBriefInput {
  mode: BriefMode;
  brief_name?: string;
  client_id?: string;
  project_id?: string;
}

export interface AddObjectiveInput {
  name: string;
  business_outcome: string;
  outcome_timing_days: number;
  current_event?: string;
  platforms: ObjectivePlatform[];
  priority?: number;
}

export interface PatchObjectiveInput {
  name?: string;
  business_outcome?: string;
  outcome_timing_days?: number;
  current_event?: string;
  platforms?: ObjectivePlatform[];
  priority?: number;
}

export interface AddCampaignInput {
  platform: ObjectivePlatform;
  campaign_identifier?: string;
  notes?: string;
}

export interface ObjectiveVerdictResponse {
  verdict: ObjectiveVerdict;
  recommended_primary_event: string;
  recommended_proxy_event: string | null;
  rationale: string;
  warnings: string[];
}

export interface AddObjectiveResponse {
  objective: StrategyObjective;
  soft_cap_warning: boolean;
}

// ── Unified strategy API ──────────────────────────────────────────────────────

export const strategyApi = {
  // ── Legacy (Sprint 1) ────────────────────────────────────────────────────────

  evaluate: evaluateStrategy,

  saveBrief: (input: SaveBriefInput) =>
    apiFetch<{ data: { id: string } }>('/api/strategy/save-brief', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listBriefs: () =>
    apiFetch<{ data: SavedStrategyBrief[] }>('/api/strategy/briefs'),

  // ── Sprint 1.6: Brief CRUD ───────────────────────────────────────────────────

  createBrief: async (input: CreateBriefInput): Promise<StrategyBrief> => {
    const body = await apiFetch<{ data: StrategyBrief }>('/api/strategy/briefs/create', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return body.data;
  },

  getBrief: async (briefId: string): Promise<StrategyBrief> => {
    const body = await apiFetch<{ data: StrategyBrief }>(`/api/strategy/briefs/${briefId}`);
    return body.data;
  },

  patchBrief: (briefId: string, fields: { brief_name?: string; mode?: BriefMode }) =>
    apiFetch<{ data: null }>(`/api/strategy/briefs/${briefId}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),

  lockBrief: (briefId: string) =>
    apiFetch<{ data: null }>(`/api/strategy/briefs/${briefId}/lock`, { method: 'POST' }),

  // ── Sprint 1.6: Objective CRUD ───────────────────────────────────────────────

  addObjective: async (briefId: string, input: AddObjectiveInput): Promise<AddObjectiveResponse> => {
    const body = await apiFetch<{ data: StrategyObjective; soft_cap_warning: boolean }>(
      `/api/strategy/briefs/${briefId}/objectives`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return { objective: body.data, soft_cap_warning: body.soft_cap_warning };
  },

  patchObjective: (objectiveId: string, input: PatchObjectiveInput) =>
    apiFetch<{ data: null }>(`/api/strategy/objectives/${objectiveId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteObjective: (objectiveId: string) =>
    apiFetch<{ data: null }>(`/api/strategy/objectives/${objectiveId}`, { method: 'DELETE' }),

  evaluateObjective: async (objectiveId: string, businessType: string): Promise<ObjectiveVerdictResponse> => {
    const body = await apiFetch<{ data: ObjectiveVerdictResponse }>(
      `/api/strategy/objectives/${objectiveId}/evaluate`,
      { method: 'POST', body: JSON.stringify({ businessType }) },
    );
    return body.data;
  },

  lockObjective: (objectiveId: string) =>
    apiFetch<{ data: null }>(`/api/strategy/objectives/${objectiveId}/lock`, { method: 'POST' }),

  // ── Sprint 1.6: Campaign CRUD ────────────────────────────────────────────────

  addCampaign: async (objectiveId: string, input: AddCampaignInput): Promise<ObjectiveCampaign> => {
    const body = await apiFetch<{ data: ObjectiveCampaign }>(
      `/api/strategy/objectives/${objectiveId}/campaigns`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return body.data;
  },

  deleteCampaign: (campaignId: string) =>
    apiFetch<{ data: null }>(`/api/strategy/campaigns/${campaignId}`, { method: 'DELETE' }),
};
