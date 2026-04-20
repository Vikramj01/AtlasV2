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
