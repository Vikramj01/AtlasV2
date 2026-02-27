// ─── Audit inputs ────────────────────────────────────────────────────────────

export type FunnelType = 'ecommerce' | 'saas' | 'lead_gen';
export type Region = 'us' | 'eu' | 'global';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ValidationLayer = 'signal_initiation' | 'parameter_completeness' | 'persistence';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RuleStatus = 'pass' | 'fail' | 'warning';

// ─── Captured data (from Browserbase) ────────────────────────────────────────

export interface DataLayerEvent {
  event: string;
  timestamp: number;
  step: string;
  payload: Record<string, unknown>;
}

export interface NetworkRequest {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  timestamp: number;
  step: string;
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
}
