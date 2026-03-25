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

export interface SessionEvent {
  event_name: string;
  event_category: EventCategory;
  page_url?: string;
  event_params?: Record<string, unknown>;
  fired_at: string;
}

export interface ChannelHints {
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
}

export interface IngestSessionPayload {
  session_id: string;
  website_url: string;
  channel_hints: ChannelHints;
  device_type?: string;
  browser?: string;
  landing_page: string;
  events: SessionEvent[];
}

export interface ChannelOverview {
  channel: ChannelType;
  total_sessions: number;
  conversion_rate: number;
  signal_completion_score: number;
  avg_pages_per_session: number;
  avg_events_per_session: number;
  health_status: 'healthy' | 'warning' | 'critical';
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
  is_resolved: boolean;
  created_at: string;
}

export interface ChannelJobData {
  trigger: 'scheduled' | 'manual';
  user_id?: string;
  website_url?: string;
}
