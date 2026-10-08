/** Junk conversion gate (GA4 Admin / L11 / Junk Gate PRD Part C) — mirrors backend/src/api/routes/junkGate.ts. */
export type JunkGateMode = 'off' | 'observe' | 'enforce';
export type JunkAction = 'hold' | 'drop' | 'send';
export type JunkTimeoutAction = 'release' | 'drop';
export type JunkVerdict = 'junk' | 'suspect';
export type HoldStatus = 'observed' | 'held' | 'released' | 'rejected' | 'auto_released' | 'auto_dropped';
export type DeliveryClass = 'server_only' | 'hybrid';

export interface JunkGateThresholds {
  duplicate_window_minutes: number;
  velocity_max: number;
  velocity_window_minutes: number;
  suspect_soft_hits: number;
  /** JC_SUBMIT_TOO_FAST: first interaction → submit shorter than this (ms) is flagged. */
  min_submit_ms: number;
}

export interface JunkGateConfig {
  mode: JunkGateMode;
  thresholds: JunkGateThresholds;
  event_names: string[];
  action_junk: JunkAction;
  action_suspect: JunkAction;
  hold_timeout_hours: number;
  timeout_action: JunkTimeoutAction;
  /** DQM alert when the flagged share of the last 24h exceeds this percent. */
  hold_rate_alert_pct: number;
}

export interface JunkGateConfigView {
  config: JunkGateConfig;
  saved: boolean;
  /** Shortest destination ingest window minus the safety margin; null when the client has no providers. */
  hold_ceiling_hours: number | null;
  timeout_will_clamp: boolean;
}

export interface JunkRuleHit {
  rule_id: string;
  class: 'hard' | 'soft';
  evidence: string;
}

export interface HeldConversion {
  id: string;
  client_id: string | null;
  event_name: string;
  event_time: string;
  verdict: JunkVerdict;
  status: HoldStatus;
  rule_hits: JunkRuleHit[];
  delivery_class: DeliveryClass | null;
  expires_at: string | null;
  seconds_remaining: number | null;
  timeout_hours_applied: number | null;
  timeout_clamped: boolean;
  decided_at: string | null;
  created_at: string;
  would_have_held: boolean;
}

export interface HeldConversionList {
  holds: HeldConversion[];
  total: number;
}

export interface BulkHoldResult {
  done: number;
  results: Array<{ id: string; outcome: 'done' | 'not_held' | 'not_found' }>;
}

export interface RuleMetric {
  rule_id: string;
  hits: number;
  hit_rate: number | null;
  reviewed: number;
  overturned: number;
  overturn_rate: number | null;
  likely_holding_good_leads: boolean;
}

export interface JunkGateMetrics {
  window_days: number;
  evaluated: number;
  flagged: number;
  flagged_rate: number | null;
  held: number;
  hold_rate: number | null;
  open_held: number;
  auto_released: number;
  auto_dropped: number;
  reviewed_released: number;
  reviewed_rejected: number;
  overturn_rate: number | null;
  rules: RuleMetric[];
  truncated: boolean;
}
