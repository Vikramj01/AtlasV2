// ── Legacy Sprint 1 types (kept for backward compatibility) ───────────────────

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

// ── Sprint 1.6 types — multi-objective model ──────────────────────────────────

export type ObjectivePlatform = 'meta' | 'google' | 'linkedin' | 'tiktok' | 'other';
export type ObjectiveVerdict = 'keep' | 'add_proxy' | 'switch';
export type BriefMode = 'single' | 'multiple';

export interface ObjectiveCampaign {
  id: string;
  objective_id: string;
  organization_id: string;
  platform: ObjectivePlatform;
  campaign_identifier: string | null;
  notes: string | null;
  created_at: string;
}

export interface StrategyObjective {
  id: string;
  brief_id: string;
  organization_id: string;
  name: string;
  priority: number;
  business_outcome: string;
  outcome_timing_days: number;
  current_event: string | null;
  platforms: ObjectivePlatform[];
  verdict: ObjectiveVerdict | null;
  recommended_primary_event: string | null;
  recommended_proxy_event: string | null;
  rationale: string | null;
  warnings: string[];
  locked: boolean;
  locked_at: string | null;
  campaigns: ObjectiveCampaign[];
  created_at: string;
  updated_at: string;
}

export interface StrategyBrief {
  id: string;
  organization_id: string;
  client_id: string | null;
  project_id: string | null;
  mode: BriefMode;
  brief_name: string | null;
  version_no: number;
  objectives: StrategyObjective[];
  locked_at: string | null;
  superseded_by: string | null;
  created_at: string;
}

// ── Wizard form state types ───────────────────────────────────────────────────

export interface ObjectiveFormData {
  name: string;
  businessType: BusinessType;
  businessOutcome: string;
  outcomeTimingDays: number;
  currentEvent: string;
  noCurrentEvent: boolean;
  platforms: ObjectivePlatform[];
}

export const OUTCOME_TIMING_OPTIONS: { label: string; value: number }[] = [
  { label: 'Same day (0–1 days)', value: 1 },
  { label: '2–7 days', value: 7 },
  { label: '8–30 days', value: 30 },
  { label: '31–90 days', value: 60 },
  { label: 'More than 90 days', value: 120 },
];

export const PLATFORM_LABELS: Record<ObjectivePlatform, string> = {
  meta: 'Meta',
  google: 'Google Ads',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  other: 'Other',
};
