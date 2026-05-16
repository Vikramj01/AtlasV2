export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'suppressed';
export type ValidationLayer =
  | 'signal_initiation'
  | 'parameter_completeness'
  | 'persistence'
  | 'tag_configuration'
  | 'implementation_drift';

export interface AuditFinding {
  id: string;
  property_id: string;
  rule_id: string;
  validation_layer: ValidationLayer;
  severity: FindingSeverity;
  status: FindingStatus;
  evidence: Record<string, unknown>;
  first_detected_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface FindingsSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface GTMContainer {
  id: string;
  client_id: string | null;
  property_id: string;
  container_id: string;
  account_id: string | null;
  auth_method: 'oauth' | 'manual_upload';
  last_synced_at: string | null;
  created_at: string;
}

export interface BaselineInfo {
  crawl_run_id: string;
  promoted_at: string;
}

export interface IHCPreferences {
  email_critical_enabled: boolean;
  email_high_digest_enabled: boolean;
  email_medium_digest_enabled: boolean;
  email_low_enabled: boolean;
  digest_timezone: string;
  daily_digest_hour: number;
  weekly_digest_day: number;
  critical_alert_batch_minutes: number;
  recipient_user_ids: string[];
}
