/**
 * Dashboard types — Action Dashboard (Sprint 1)
 *
 * Defines the shape of the GET /api/dashboard response.
 */

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
  /** One-line summary surfaced in the card body. */
  message: string;
  /** Primary metric value (percentage or score, 0–100). Null when no data exists. */
  metric_value: number | null;
  /** The threshold that triggered this card. */
  threshold: number | null;
  /** Navigation target when user clicks the card CTA. */
  action_url: string;
  action_label: string;
  /** ISO timestamp of the underlying data point. */
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
  /** Pre-sorted by severity: critical → warning → info → success */
  cards: DashboardCard[];
  generated_at: string;
}
