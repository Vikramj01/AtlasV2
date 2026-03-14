// Mirror of backend types — keep in sync with backend/src/types/audit.ts

export type FunnelType = 'ecommerce' | 'saas' | 'lead_gen';
export type Region = 'us' | 'eu' | 'global';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RuleStatus = 'pass' | 'fail' | 'warning';

export interface AuditScores {
  conversion_signal_health: number;
  attribution_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  optimization_strength: 'Weak' | 'Moderate' | 'Strong';
  data_consistency_score: 'Low' | 'Medium' | 'High';
}

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
}
