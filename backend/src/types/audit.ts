// ─── Audit inputs ────────────────────────────────────────────────────────────

export type FunnelType = 'ecommerce' | 'saas' | 'lead_gen';
export type Region = 'us' | 'eu' | 'global';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

/** The 5 layers of the original (v1) rule library. */
export type ValidationLayerV1 =
  | 'signal_initiation'
  | 'parameter_completeness'
  | 'persistence'
  | 'tag_configuration'
  | 'implementation_drift';

/**
 * The 13 layers of the Check Register v2 rule library (L0-L12).
 * 'parameter_completeness' is deliberately the same literal as its v1
 * counterpart above — same concept, a larger rule set — so the two collapse
 * to one union member rather than needing a v1/v2-qualified name.
 */
export type ValidationLayerV2 =
  | 'scope_configuration'      // L0
  | 'foundation_tags'          // L1
  | 'click_id_capture'         // L2
  | 'storage_durability'       // L3
  | 'cross_domain_continuity'  // L4
  | 'event_firing'             // L5
  | 'parameter_completeness'   // L6
  | 'identity_match_quality'   // L7
  | 'consent'                  // L8
  | 'server_side_delivery'     // L9
  | 'deduplication'            // L10
  | 'reconciliation'           // L11
  | 'hygiene_integrity';       // L12

export type ValidationLayer = ValidationLayerV1 | ValidationLayerV2;

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RuleStatus = 'pass' | 'fail' | 'warning' | 'skipped' | 'not_run';

// ─── Check Register v2 — Scan Inputs ──────────────────────────────────────────
// Atlas Check Register v1.0 (2 September 2026) — "Scan Inputs" sheet.
// Collected before a v2 scan runs; these drive rule applicability throughout
// the register (see ValidationRule.applies_to / platform_scope below).

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
  // 1. Site type
  site_type: SiteType;
  secondary_motion?: SecondaryMotion;
  // 2. Ad platforms
  declared_platforms: DeclaredPlatform[];
  primary_channel: DeclaredPlatform;
  monthly_spend_band?: string;
  // 3. Regions
  traffic_regions: TrafficRegion[];
  cmp?: CMP;
  // 4. Domains
  website_url: string;
  product_domain?: string;
  checkout_domain?: string;
  additional_properties?: string[];
  // Optional unlocks
  test_email?: string;
  test_phone?: string;
  declared_conversions?: DeclaredConversion[];
}

// ─── Check Register v2 — Rule shape ───────────────────────────────────────────

/**
 * How a rule's applicability is gated by the declared platforms:
 *   'declared' — the sentinel used by L0.1 only: evaluated once per declared
 *                platform (does *that* platform have its tag?), not a single pass/fail.
 *   'any'      — platform-agnostic infrastructure (GTM, dataLayer) — always applicable.
 *   'n/a'      — not platform-gated at all (e.g. domain reachability).
 *   string[]   — only applicable when at least one of these specific platforms is declared.
 */
export type PlatformScope = 'declared' | 'any' | 'n/a' | DeclaredPlatform[];

/** What the rule needs beyond a single browser pass — see the "Beyond the Crawl" sheet. */
export type DetectionMethod = 'crawl' | 'second_pass' | 'credentials' | 'connector';

/** A single Check Register v2 rule. */
export interface ValidationRule {
  /** Canonical Check Register ID, e.g. "L1.4" — stable identifier from the spec, shown in the technical appendix. */
  id: string;
  /** Readable slug used everywhere else code keys off a rule (report/DB rows, interpretations), e.g. "GA4_CONFIG_TAG_PRESENT". */
  rule_id: string;
  layer: ValidationLayerV2;
  /** Short label matching the spreadsheet's "Check" column. */
  check: string;
  severity: Severity;
  applies_to: SiteType[] | 'all';
  platform_scope: PlatformScope;
  detectable_by: DetectionMethod;
  owner: string;
  test(auditData: AuditData): ValidationResult;
}

// ─── Captured data (from Browserbase) ────────────────────────────────────────

export interface DataLayerItem {
  id: string;
  name?: string;
  price?: number;
  quantity?: number;
  [key: string]: unknown;
}

/**
 * A single push to window.dataLayer captured during journey simulation.
 * GA4 ecommerce fields are typed explicitly; all other fields accessible via
 * the index signature.
 */
export interface DataLayerEvent {
  event: string;
  timestamp: number;
  step: string;
  // GA4 ecommerce purchase parameters
  transaction_id?: string;
  value?: number | string;
  currency?: string;
  coupon?: string;
  shipping?: number | null;
  items?: DataLayerItem[];
  user_id?: string;
  event_id?: string;
  gclid?: string;
  user_data?: {
    email?: string;
    phone?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NetworkRequest {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  timestamp: number;
  step: string;
  loadTime?: number; // ms — used by GTM_CONTAINER_LOADED rule
}

export interface CookieSnapshot {
  step: string;
  cookies: Record<string, string>;
}

export interface LocalStorageSnapshot {
  step: string;
  entries: Record<string, string>;
}

// ─── GTM container snapshot (for tag_configuration layer) ────────────────────

export interface GTMConsentSettings {
  consentStatus: 'NOT_SET' | 'NEEDED' | 'NOT_NEEDED';
  consentType?: string[];
}

export interface GTMTag {
  tagId: string;
  name: string;
  type: string;
  firingTriggerId: string[];
  blockingTriggerId?: string[];
  parameter?: Array<{ type: string; key: string; value?: string; list?: unknown[] }>;
  consentSettings?: GTMConsentSettings;
  tagFiringOption?: string;
  monitoringMetadata?: unknown;
}

export interface GTMTrigger {
  triggerId: string;
  name: string;
  type: string;
  filter?: Array<{ type: string; parameter: Array<{ type: string; key: string; value?: string }> }>;
  autoEventFilter?: unknown[];
  customEventFilter?: unknown[];
  parameter?: Array<{ type: string; key: string; value?: string }>;
}

export interface GTMVariable {
  variableId: string;
  name: string;
  type: string;
  parameter?: Array<{ type: string; key: string; value?: string }>;
}

export interface GTMContainerSnapshot {
  container_id: string;
  fetched_at: string;
  source: 'gtm_api' | 'manual_upload';
  tags: GTMTag[];
  triggers: GTMTrigger[];
  variables: GTMVariable[];
  built_in_variables: string[];
  consent_default_tag: GTMTag | null;
}

// ─── CSE signal snapshot (for implementation_drift layer) ────────────────────

/**
 * One detected signal on one page, reconstructed from detected_signals + crawl_pages.
 * Attached to AuditData.crawlSignals by the drift job worker before rules run.
 */
export interface CrawlSignalSnapshot {
  page_url: string;
  signal_type: string;
  signal_name: string | null;
  signal_id: string | null;
  health_status: 'healthy' | 'degraded' | 'missing' | 'duplicate' | 'misconfigured';
  parameters: Record<string, unknown> | null;
}

// ─── Site Setup detection (informational, non-scored) ─────────────────────────

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
  /** The client's connected GTM container (OAuth/manual upload), if one exists. */
  connected_container_id: string | null;
  /**
   * true/false when a connected container exists and can be compared against what
   * was live-detected; null when there's nothing connected to compare against.
   */
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

// ─── AuditData passed to validation engine ───────────────────────────────────

export interface AuditData {
  audit_id: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  /** Which rule library evaluates this AuditData. Defaults to 'v1-legacy' when absent (existing callers). */
  rule_set_version?: RuleSetVersion;
  // Check Register v2 Scan Inputs — present when rule_set_version === 'v2'.
  site_type?: SiteType;
  secondary_motion?: SecondaryMotion;
  declared_platforms?: DeclaredPlatform[];
  primary_channel?: DeclaredPlatform;
  monthly_spend_band?: string;
  traffic_regions?: TrafficRegion[];
  cmp?: CMP;
  product_domain?: string;
  /**
   * Result of a live HTTP reachability probe against product_domain, run by
   * the caller (journeySimulator.ts's probeDomainReachable) before rules run
   * — same pattern as sgtmVerified below. Undefined when product_domain was
   * never set or equals website_url (nothing distinct to probe); L0.4 treats
   * that as 'skipped', not as unreachable.
   */
  product_domain_reachable?: boolean;
  checkout_domain?: string;
  additional_properties?: string[];
  declared_conversions?: DeclaredConversion[];
  dataLayer: DataLayerEvent[];
  networkRequests: NetworkRequest[];
  cookieSnapshots: CookieSnapshot[];
  localStorageSnapshots: LocalStorageSnapshot[];
  injected: {
    gclid: string;
    fbclid: string;
  };
  test_email?: string;
  test_phone?: string;
  // Derived fields — flattened by journeySimulator for quick rule access
  urlParams?: Record<string, string>;      // Landing page URL params
  storage?: Record<string, string>;        // localStorage at conversion step
  cookies?: Record<string, string>;        // Merged cookie map (all steps)
  pageMetadata?: Record<string, unknown>;  // Misc page metadata
  // IHC extensions — absent when the respective data source is not connected
  gtmContainer?: GTMContainerSnapshot;     // tag_configuration layer input
  crawlSignals?: CrawlSignalSnapshot[];    // implementation_drift layer input (current run)
  baselineAuditData?: AuditData;           // implementation_drift layer input (baseline run)
  // True when the client has a verified server-side GTM endpoint on file
  // (client_platforms.platform = 'sgtm', is_verified = true). Resolved by the
  // caller before rules run — rules stay synchronous and don't hit the DB
  // themselves. Undefined when the connection has no associated client_id
  // (e.g. an org-level GTM connection not linked to a specific client).
  sgtmVerified?: boolean;
}

// ─── API inputs ───────────────────────────────────────────────────────────────

export interface StartAuditInput {
  website_url: string;
  funnel_type: FunnelType;
  region?: Region;
  url_map: Record<string, string>;
  test_email?: string;
  test_phone?: string;
}

export interface AuditStartResponse {
  audit_id: string;
  status: AuditStatus;
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

// ─── Validation results ───────────────────────────────────────────────────────

export interface ValidationResult {
  rule_id: string;
  validation_layer: ValidationLayer;
  status: RuleStatus;
  severity: Severity;
  technical_details: {
    found: string;
    expected: string;
    evidence: string[];
  };
}

// ─── Scores ───────────────────────────────────────────────────────────────────

export interface AuditScores {
  conversion_signal_health: number;
  attribution_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  optimization_strength: 'Weak' | 'Moderate' | 'Strong';
  data_consistency_score: 'Low' | 'Medium' | 'High';
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface ReportIssue {
  rule_id: string;
  validation_layer: ValidationLayer;
  severity: Severity;
  problem: string;
  why_it_matters: string;
  recommended_owner: string;
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
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
    raw_network_requests: NetworkRequest[];
    raw_datalayer_events: DataLayerEvent[];
  };
}

// ─── DB row shapes ────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string;
  user_id: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  status: AuditStatus;
  progress: number;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  browserbase_session_id?: string;
  test_email?: string;
  test_phone?: string;
  client_id?: string | null;
  // Check Register v2 Scan Inputs columns (20260902002_scan_inputs_check_register.sql) — null on rows written before this migration.
  rule_set_version?: RuleSetVersion;
  site_type?: SiteType | null;
  secondary_motion?: SecondaryMotion | null;
  declared_platforms?: DeclaredPlatform[];
  primary_channel?: DeclaredPlatform | null;
  monthly_spend_band?: string | null;
  traffic_regions?: TrafficRegion[];
  cmp?: CMP | null;
  product_domain?: string | null;
  checkout_domain?: string | null;
  additional_properties?: string[];
  declared_conversions?: DeclaredConversion[] | null;
}

/** POST /api/audits/start payload for a Check Register v2 scan. */
export interface StartAuditInputV2 extends ScanInputs {
  url_map: Record<string, string>;
  client_id?: string;
}
