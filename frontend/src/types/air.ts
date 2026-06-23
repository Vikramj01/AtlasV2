export type AirSeverity = 'low' | 'medium' | 'high';
export type AirSource   = 'google_ads' | 'meta_ads' | 'ga4';
export type InsightStatus = 'unread' | 'read' | 'dismissed';

export interface AirAnomaly {
  source: AirSource;
  metric_name: string;
  dimension: string | null;
  detected_date: string;
  deviation_pct: number;
  severity: AirSeverity;
  observed_value: number;
  baseline_value: number;
}

export interface AirInsight {
  id: string;
  narrative: string;
  status: InsightStatus;
  model_version: string;
  anomaly_id: string;
  created_at: string;
  air_anomalies: AirAnomaly | null;
}
