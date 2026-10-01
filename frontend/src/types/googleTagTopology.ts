// Google Tag Topology (PRD docs/prd/google-tag-topology.md) — mirrors the backend
// shapes returned by /api/organisations/:orgId/clients/:clientId/google-tag-topology
// and /api/gtm/split-plan*.

export type TopologyVerdict = 'SPLIT' | 'COMBINED' | 'COMBINED_ADS_PRIMARY' | 'UNKNOWN';
/** How strongly the verdict is established. 'assumed' and 'none' must be shown as needing confirmation. */
export type TopologyStrength = 'declared' | 'observed' | 'assumed' | 'none';
export type TopologySource = 'gtm_api' | 'runtime_observed' | 'operator_declared';
export type DeclarationSource = 'CLIENT_CONFIRMED' | 'OPERATOR_ASSUMED';

export interface CombinedGoogleTag {
  google_tag_id: string;
  primary_destination_id: string | null;
  destination_ids: string[];
}

export interface TopologyRecord {
  id: string;
  google_tag_id: string;
  primary_destination_id: string | null;
  destination_ids: string[];
  source: TopologySource;
  declaration_source?: DeclarationSource | null;
  inferred?: boolean;
  evidence_class: string;
  observed_at: string;
  is_current: boolean;
}

export interface TopologyVerdictResult {
  verdict: TopologyVerdict;
  strength: TopologyStrength;
  combined_tags: CombinedGoogleTag[];
  destination_count: number;
}

export interface GoogleTagTopology extends TopologyVerdictResult {
  current: TopologyRecord[];
  history: TopologyRecord[];
}

export interface DeclareTopologyRequest {
  google_tag_id: string;
  primary_destination_id?: string;
  destination_ids: string[];
  declaration_source: DeclarationSource;
}

export interface SplitGuidanceStep {
  step: number;
  title: string;
  body: string;
  /** 'unverified' steps must be shown with a qualifier, never as fact. */
  evidence: 'verified' | 'unverified';
}

export type SplitConflictCode = 'multiple_destinations' | 'existing_not_sitewide' | 'name_conflict' | 'invalid_delta';

export interface SplitConflict {
  code: SplitConflictCode;
  message: string;
}

export interface SplitDiff {
  tags_added: string[];
  variables_added: string[];
  triggers_added: string[];
  already_covered: string[];
}

export interface SplitPlanResponse {
  plan_id: string | null;
  delta: Record<string, unknown> | null;
  diff: SplitDiff;
  conflicts: SplitConflict[];
  destinations: { ga4: string | null; google_ads: string | null };
  guidance: SplitGuidanceStep[];
  topology: TopologyVerdictResult;
  can_deploy_draft: boolean;
}

export interface SplitDeployResponse {
  plan_id: string;
  status: string;
  workspace_id: string;
  workspace_url: string;
  tags_created: number;
}

export interface SplitVerifyResponse {
  plan_id: string;
  status: string;
  verified: boolean;
  reasons: string[];
  topology: TopologyVerdictResult;
}
