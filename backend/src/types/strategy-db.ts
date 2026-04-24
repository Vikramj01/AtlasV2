// DB row shapes and input types for the strategy tables.

export interface DbStrategyBrief {
  id: string;
  organization_id: string;
  client_id: string | null;
  project_id: string | null;
  mode: 'single' | 'multi';
  brief_name: string | null;
  version_no: number;
  // Legacy single-objective fields (nullable for multi-mode briefs)
  business_outcome: string | null;
  outcome_timing_days: number | null;
  current_event: string | null;
  verdict: string | null;
  proxy_event: string | null;
  rationale: string | null;
  locked_at: string | null;
  superseded_by: string | null;
  created_at: string;
}

export interface DbStrategyObjective {
  id: string;
  brief_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  platforms: string[];
  current_event: string | null;
  outcome_timing_days: number | null;
  verdict: 'CONFIRM' | 'AUGMENT' | 'REPLACE' | null;
  outcome_category: string | null;
  recommended_primary_event: string | null;
  recommended_proxy_event: string | null;
  proxy_event_required: boolean;
  rationale: string | null;
  summary_markdown: string | null;
  locked: boolean;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbStrategyObjectiveCampaign {
  id: string;
  objective_id: string;
  organization_id: string;
  platform: string;
  campaign_name: string | null;
  budget: number | null;
  created_at: string;
}

export interface CreateBriefInput {
  brief_name?: string;
  client_id?: string;
  project_id?: string;
}

export interface CreateObjectiveInput {
  brief_id: string;
  name: string;
  description?: string;
  platforms?: string[];
  current_event?: string;
  outcome_timing_days?: number;
}

export interface UpdateObjectiveInput {
  name?: string;
  description?: string;
  platforms?: string[];
  current_event?: string;
  outcome_timing_days?: number;
}

export interface SetObjectiveEvalInput {
  verdict: 'CONFIRM' | 'AUGMENT' | 'REPLACE';
  outcome_category: string;
  recommended_primary_event: string | null;
  recommended_proxy_event: string | null;
  proxy_event_required: boolean;
  rationale: string;
  summary_markdown: string;
}

export interface AddCampaignInput {
  platform: string;
  campaign_name?: string;
  budget?: number;
}
