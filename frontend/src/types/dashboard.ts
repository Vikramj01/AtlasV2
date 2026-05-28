/**
 * Dashboard types — mirrors backend/src/types/dashboard.ts
 */

export interface AtlasScore {
  overall: number;
  foundation: number;
  signal_quality: number;
  channel_performance: number;
  updated_at: string;
}

export interface NextAction {
  action_id: string;
  copy: string;
  cta_route: string;
  eta_minutes: number;
  priority: number;
  is_skippable?: boolean;
}

export type DashboardCardType =
  | 'capi_delivery'
  | 'capi_emq'
  | 'audit_score'
  | 'signal_coverage'
  | 'consent_rate'
  | 'implementation_progress'
  | 'journey_gap';

export type CardSeverity = 'critical' | 'warning' | 'info' | 'success';

export type OverallHealth = 'healthy' | 'attention' | 'critical';

export interface DashboardCard {
  id: string;
  type: DashboardCardType;
  severity: CardSeverity;
  title: string;
  message: string;
  metric_value: number | null;
  threshold: number | null;
  action_url: string;
  action_label: string;
  data_at: string | null;
}

export interface DashboardSummary {
  overall_health: OverallHealth;
  signal_coverage_pct: number | null;
  capi_delivery_pct: number | null;
  avg_emq: number | null;
  implementation_progress: number | null;
  last_audit: string | null;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  cards: DashboardCard[];
  generated_at: string;
}

export interface ActivityItem {
  id: string;
  type: 'capi_event' | 'planning_session' | 'consent_config' | 'offline_upload';
  description: string;
  deep_link: string;
  created_at: string;
}

export interface ActivityResponse {
  data: ActivityItem[];
  error: null;
  message: null;
}

// ── PRD-004: Returning User Dashboard ─────────────────────────────────────────

export interface DashboardAlertItem {
  id: string;
  source_table: string;
  client_id: string | null;
  client_name: string | null;
  module: 'ihc' | 'dqm' | 'reconciliation' | 'health';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  created_at: string;
  is_new: boolean;
  is_reviewed: boolean;
  action_url: string;
}

export interface DashboardClientSummaryItem {
  id: string;
  name: string;
  setup_status: 'not_started' | 'in_progress' | 'complete';
  health_level: 'healthy' | 'warning' | 'critical' | 'unknown';
  signals_count: number;
  platforms_connected: string[];
  last_verified_at: string | null;
  open_findings_count: number;
}

export interface OrgMetrics {
  total_clients: number;
  total_signals_monitored: number;
  capi_events_24h: number;
  avg_match_quality_7d: number | null;
  clients_with_issues: number;
}

export interface DashboardDelta {
  since_label: string;
  since_timestamp: string;
  new_alerts_count: number;
}

export interface OrgDashboardSummary {
  delta: DashboardDelta;
  alerts: DashboardAlertItem[];
  clients: DashboardClientSummaryItem[];
  org_metrics: OrgMetrics;
}
