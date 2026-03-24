export type ChannelType =
  | 'google_ads'
  | 'meta_ads'
  | 'tiktok_ads'
  | 'linkedin_ads'
  | 'organic_search'
  | 'paid_search_other'
  | 'organic_social'
  | 'paid_social_other'
  | 'email'
  | 'referral'
  | 'direct'
  | 'other';

export type EventCategory = 'page_view' | 'micro_conversion' | 'macro_conversion' | 'engagement';
export type SignalHealthStatus = 'healthy' | 'degraded' | 'missing' | 'unknown';
export type DiagnosticType = 'signal_gap' | 'journey_divergence' | 'engagement_anomaly' | 'consent_impact';
export type Severity = 'critical' | 'warning' | 'info';

export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface ChannelOverview {
  channel: ChannelType;
  total_sessions: number;
  conversion_rate: number;
  signal_completion_score: number;
  avg_pages_per_session: number;
  avg_events_per_session: number;
  health_status: HealthStatus;
}

export interface JourneyStep {
  step_number: number;
  type: 'page_view' | 'event';
  identifier: string;
  session_count: number;
  percentage: number;
  drop_off_rate: number;
  signal_health: 'healthy' | 'degraded' | 'missing' | 'mixed';
  signal_health_detail?: string;
}

export interface ChannelJourneyMap {
  id: string;
  channel: ChannelType;
  period_start: string;
  period_end: string;
  total_sessions: number;
  conversion_rate: number;
  avg_pages_per_session: number;
  avg_events_per_session: number;
  signal_completion_score: number;
  journey_steps: JourneyStep[];
  computed_at: string;
}

export interface ChannelDiagnostic {
  id: string;
  channel: ChannelType;
  diagnostic_type: DiagnosticType;
  severity: Severity;
  title: string;
  description: string;
  affected_pages: string[];
  estimated_impact: string | null;
  recommended_action: string | null;
  created_at: string;
}

// API response shapes

export interface ChannelOverviewResponse {
  overviews: ChannelOverview[];
  has_data: boolean;
  sites: string[];
}

export interface ChannelJourneysResponse {
  journeys: ChannelJourneyMap[];
}

export interface ChannelDiagnosticsResponse {
  diagnostics: ChannelDiagnostic[];
}
