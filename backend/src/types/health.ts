// ── Health Dashboard Types ─────────────────────────────────────────────────────

export interface HealthScore {
  id: string;
  user_id: string;
  overall_score: number;         // 0–100
  signal_health: number;         // 0–100 (from latest audit)
  capi_delivery_rate: number;    // 0–100 %
  consent_coverage: number;      // 0 or 100 (configured = 100)
  tag_firing_rate: number;       // 0–100 % (alias of signal_health for display)
  last_audit_id: string | null;
  last_audit_at: string | null;
  computed_at: string;
  created_at: string;
}

export interface HealthSnapshot {
  id: string;
  user_id: string;
  overall_score: number;
  signal_health: number | null;
  capi_delivery_rate: number | null;
  consent_coverage: number | null;
  tag_firing_rate: number | null;
  snapshot_at: string;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertType =
  | 'capi_delivery'
  | 'tag_firing'
  | 'consent_missing'
  | 'no_recent_audit'
  | 'capi_not_configured';

export interface HealthAlert {
  id: string;
  user_id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metric_value: number | null;
  threshold_value: number | null;
  is_active: boolean;
  consecutive_ok_count: number;
  triggered_at: string;
  resolved_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface HealthDashboardResponse {
  score: HealthScore | null;
  alerts: HealthAlert[];
  has_data: boolean;
}

export interface HealthHistoryResponse {
  snapshots: HealthSnapshot[];
}

// ── Computed metrics (internal, not stored) ───────────────────────────────────

export interface ComputedMetrics {
  signal_health: number;
  capi_delivery_rate: number;
  consent_coverage: number;
  tag_firing_rate: number;
  last_audit_id: string | null;
  last_audit_at: string | null;
}
