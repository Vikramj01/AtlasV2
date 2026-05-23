export interface SignalEventRow {
  id: string;
  event_id: string | null;
  atlas_event_id: string;
  event_name: string;
  destination: string;
  status: string;
  dedup_status: string | null;
  dedup_key: string | null;
  dedup_matched_at: string | null;
  match_quality_score: number | null;
  latency_ms: number | null;
  processed_at: string;
  delivered_at: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_config_id: string;
}

export interface SignalEventDetail extends SignalEventRow {
  payload: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  consent_state: Record<string, unknown>;
  related_signals: SignalEventRow[];
}

export interface SignalAggregates {
  total_signals: number;
  avg_match_quality: number | null;
  dedup_hit_rate: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  prev_avg_match_quality: number | null;
  prev_dedup_hit_rate: number | null;
  prev_avg_latency_ms: number | null;
  sparkline: Array<{ day: string; signal_count: number }>;
}

export interface SignalFilters {
  range: '1h' | '24h' | '7d' | '30d' | 'custom';
  from: string;
  to: string;
  destinations: string[];
  event_names: string[];
  statuses: string[];
  dedup_statuses: string[];
}

export interface ExportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  download_url: string | null;
  expires_at: string | null;
  error_message: string | null;
  created_at: string;
}
