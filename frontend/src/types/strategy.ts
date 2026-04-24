// ── Shared enums ──────────────────────────────────────────────────────────────

export type BusinessType =
  | 'ecommerce'
  | 'lead_gen'
  | 'b2b_saas'
  | 'marketplace'
  | 'nonprofit'
  | 'other';

export type EventSource = 'pixel' | 'capi' | 'offline' | 'none';

export type OutcomeCategory =
  | 'purchase'
  | 'qualified_lead'
  | 'activation_milestone'
  | 'retention_event'
  | 'donation';

export type EventVerdict = 'CONFIRM' | 'AUGMENT' | 'REPLACE';

// ── Legacy wizard types (Sprint 1 — single-objective wizard) ──────────────────

export type WizardStep = 1 | 2 | 'output';

export interface Step1Data {
  businessType: BusinessType;
  outcomeDescription: string;
  outcomeTimingDays: number;
}

export interface Step2Data {
  currentEventName: string;
  eventSource: EventSource;
  valueDataPresent: boolean;
}

/** Sprint 1 Claude response shape — preserved for the legacy wizard flow. */
export interface LegacyStrategyBrief {
  outcomeCategory: OutcomeCategory;
  eventVerdict: EventVerdict;
  verdictRationale: string;
  recommendedEventName: string | null;
  recommendedEventRationale: string | null;
  proxyEventRequired: boolean;
  proxyEventName: string | null;
  proxyEventRationale: string | null;
  summaryMarkdown: string;
}

// ── Multi-objective types (Sprint 1.6a) ───────────────────────────────────────

export type BriefMode = 'single' | 'multi';

export interface StrategyObjective {
  id: string;
  brief_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  platforms: string[];
  current_event: string | null;
  outcome_timing_days: number | null;
  verdict: EventVerdict | null;
  outcome_category: OutcomeCategory | null;
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

export interface StrategyObjectiveCampaign {
  id: string;
  objective_id: string;
  organization_id: string;
  platform: string;
  campaign_name: string | null;
  budget: number | null;
  created_at: string;
}

export interface StrategyBriefRecord {
  id: string;
  organization_id: string;
  client_id: string | null;
  project_id: string | null;
  mode: BriefMode;
  brief_name: string | null;
  version_no: number;
  locked_at: string | null;
  superseded_by: string | null;
  created_at: string;
  // Legacy single-objective fields (null for multi-mode briefs)
  business_outcome: string | null;
  outcome_timing_days: number | null;
  current_event: string | null;
  verdict: string | null;
  proxy_event: string | null;
  rationale: string | null;
}

export interface StrategyBriefWithObjectives extends StrategyBriefRecord {
  objectives: StrategyObjective[];
}

// ── API input types ───────────────────────────────────────────────────────────

export interface CreateBriefInput {
  mode?: BriefMode;
  brief_name?: string;
  client_id?: string;
  project_id?: string;
}

export interface PatchBriefInput {
  mode?: BriefMode;
  brief_name?: string;
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

export interface AddCampaignInput {
  platform: string;
  campaign_name?: string;
  budget?: number;
}

export interface ObjectiveEvalResult {
  objective: StrategyObjective;
  platformRationale: Record<string, string> | null;
}
