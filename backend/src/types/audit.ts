// ─── Audit inputs ────────────────────────────────────────────────────────────

export type FunnelType = 'ecommerce' | 'saas' | 'lead_gen';
export type Region = 'us' | 'eu' | 'global';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ValidationLayer = 'signal_initiation' | 'parameter_completeness' | 'persistence';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RuleStatus = 'pass' | 'fail' | 'warning';

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

// ─── AuditData passed to validation engine ───────────────────────────────────

export interface AuditData {
  audit_id: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
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
  severity: Severity;
  problem: string;
  why_it_matters: string;
  recommended_owner: string;
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
}

export interface JourneyStage {
  stage: string;
  status: RuleStatus;
  issues: string[];
}

export interface PlatformBreakdown {
  platform: string;
  status: 'healthy' | 'at_risk' | 'broken';
  risk_explanation: string;
  failed_rules: string[];
}

export interface ReportJSON {
  audit_id: string;
  generated_at: string;
  executive_summary: {
    overall_status: 'healthy' | 'partially_broken' | 'critical';
    business_summary: string;
    scores: AuditScores;
  };
  journey_stages: JourneyStage[];
  platform_breakdown: PlatformBreakdown[];
  issues: ReportIssue[];
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
}
