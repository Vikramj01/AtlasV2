// Mirror of backend types — keep in sync with backend/src/types/audit.ts

export type FunnelType = 'ecommerce' | 'saas' | 'lead_gen';
export type Region = 'us' | 'eu' | 'global';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RuleStatus = 'pass' | 'fail' | 'warning' | 'skipped' | 'not_run';

// ─── Check Register v2 — Scan Inputs ──────────────────────────────────────────
// Atlas Check Register v1.0 (2 September 2026) — "Scan Inputs" sheet.

/** Which rule library produced a given audit's results — scores are not comparable across versions. */
export type RuleSetVersion = 'v1-legacy' | 'v2';

export type SiteType =
  | 'plg_saas'
  | 'ecommerce'
  | 'lead_gen_b2b'
  | 'marketplace'
  | 'app_install'
  | 'subscription_media';

export type SecondaryMotion = 'none' | 'sales_assisted' | 'hybrid';

export type DeclaredPlatform =
  | 'google_ads'
  | 'meta'
  | 'tiktok'
  | 'linkedin'
  | 'microsoft'
  | 'reddit'
  | 'pinterest';

/** Regions field granularity the consent layer (L8) needs — distinct from the legacy `Region` (us/eu/global). */
export type TrafficRegion = 'eea' | 'uk' | 'switzerland' | 'brazil' | 'us' | 'other';

export type CMP = 'onetrust' | 'cookiebot' | 'usercentrics' | 'custom' | 'none';

export interface DeclaredConversion {
  name: string;
  kind: 'primary' | 'secondary';
}

/** The four Scan Inputs collected before a Check Register v2 scan runs, plus the optional unlocks. */
export interface ScanInputs {
  site_type: SiteType;
  secondary_motion?: SecondaryMotion;
  declared_platforms: DeclaredPlatform[];
  primary_channel: DeclaredPlatform;
  monthly_spend_band?: string;
  traffic_regions: TrafficRegion[];
  cmp?: CMP;
  website_url: string;
  product_domain?: string;
  checkout_domain?: string;
  additional_properties?: string[];
  test_email?: string;
  test_phone?: string;
  declared_conversions?: DeclaredConversion[];
}

// ─── Step coverage (Site Evaluation Coverage & Honesty PRD, Phase 1) ─────────

export type StepUrlSource = 'user_supplied' | 'sitemap' | 'nav_link' | 'heuristic' | 'fallback_landing';

export interface StepCoverage {
  step: string;
  requested_url: string;
  final_url?: string;
  source: StepUrlSource;
  distinct_from_landing: boolean;
  navigation_success: boolean;
  error?: string;
}

export interface AuditScores {
  conversion_signal_health: number;
  attribution_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  optimization_strength: 'Weak' | 'Moderate' | 'Strong';
  data_consistency_score: 'Low' | 'Medium' | 'High';
}

export type ValidationLayerFilter =
  // v1 (5 layers)
  | 'signal_initiation'
  | 'parameter_completeness'
  | 'persistence'
  | 'tag_configuration'
  | 'implementation_drift'
  // v2 — Check Register (13 layers, L0-L12). 'parameter_completeness' above
  // is shared with v2's L6 — same concept, larger rule set.
  | 'scope_configuration'
  | 'foundation_tags'
  | 'click_id_capture'
  | 'storage_durability'
  | 'cross_domain_continuity'
  | 'event_firing'
  | 'identity_match_quality'
  | 'consent'
  | 'server_side_delivery'
  | 'deduplication'
  | 'reconciliation'
  | 'hygiene_integrity';

export interface ReportIssue {
  rule_id: string;
  severity: Severity;
  problem: string;
  why_it_matters: string;
  recommended_owner: string;
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
  validation_layer?: ValidationLayerFilter;
}

export interface JourneyStageIssue {
  rule_id: string;
  /** Plain-language headline for this issue (see getIssueHeadline in the interpretation engine). */
  label: string;
}

export interface JourneyStage {
  stage: string;
  status: RuleStatus;
  issues: JourneyStageIssue[];
}

export interface PlatformFailedRuleDetail {
  rule_id: string;
  /** Full business-impact sentence(s) for this rule (see getIssueImpact in the interpretation engine). */
  impact: string;
}

export interface PlatformBreakdown {
  platform: string;
  status: 'healthy' | 'at_risk' | 'broken' | 'not_included';
  risk_explanation: string;
  failed_rules: string[];
  failed_rule_details: PlatformFailedRuleDetail[];
}

export interface ValidationResult {
  rule_id: string;
  validation_layer: string;
  status: RuleStatus;
  severity: Severity;
  technical_details: {
    found: string;
    expected: string;
    evidence: string[];
  };
}

export interface AuditComparison {
  previous_audit_id: string;
  previous_score: number;
  current_score: number;
  delta: number;
  previous_audit_date: string;
}

export type DetectedTagPlatform =
  | 'ga4'
  | 'meta_pixel'
  | 'google_ads'
  | 'linkedin_insight'
  | 'tiktok_pixel'
  | 'microsoft_uet';

export interface DataLayerEventInventoryEntry {
  event_name: string;
  occurrence_count: number;
  parameter_keys: string[];
  steps_seen: string[];
}

export interface DetectedTagSignal {
  platform: DetectedTagPlatform;
  detected: boolean;
  ids: string[];
  hit_count: number;
  evidence_urls: string[];
}

export interface DetectedGtmContainer {
  detected: boolean;
  container_ids: string[];
  connected_container_id: string | null;
  ids_match: boolean | null;
}

export type ServerSideGtmHeuristic =
  | 'domain_keyword'
  | 'firstparty_measurement_protocol_shape'
  | 'firstparty_capi_forward_shape';

export interface PossibleServerSideGtm {
  detected: boolean;
  confidence: 'low' | 'medium';
  candidate_hosts: string[];
  matched_heuristics: ServerSideGtmHeuristic[];
  evidence_urls: string[];
  caveat: string;
}

export interface SiteSetupSummary {
  generated_at: string;
  datalayer_inventory: DataLayerEventInventoryEntry[];
  tags: DetectedTagSignal[];
  gtm_container: DetectedGtmContainer;
  possible_server_side_gtm: PossibleServerSideGtm;
}

export interface ReportJSON {
  audit_id: string;
  website_url: string;
  generated_at: string;
  /** Which rule library produced this report — never compare scores across versions. Absent on reports generated before this field existed; treat as 'v1-legacy'. */
  rule_set_version?: RuleSetVersion;
  executive_summary: {
    overall_status: 'healthy' | 'partially_broken' | 'critical';
    business_summary: string;
    scores: AuditScores;
  };
  journey_stages: JourneyStage[];
  platform_breakdown: PlatformBreakdown[];
  issues: ReportIssue[];
  site_setup: SiteSetupSummary;
  technical_appendix: {
    validation_results: ValidationResult[];
    raw_network_requests: unknown[];
    raw_datalayer_events: unknown[];
  };
  comparison?: AuditComparison | null;
}

// API response shapes

export interface AuditStartResponse {
  audit_id: string;
  status: 'queued';
  created_at: string;
}

export interface AuditStatusResponse {
  audit_id: string;
  status: AuditStatus;
  progress: number;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface StartAuditInput {
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  url_map: Record<string, string>;
  test_email?: string;
  test_phone?: string;
  client_id?: string;
}

/** POST /api/audits/start payload for a Check Register v2 scan. */
export interface StartAuditInputV2 extends ScanInputs {
  url_map: Record<string, string>;
  client_id?: string;
}
