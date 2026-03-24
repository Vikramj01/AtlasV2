-- Atlas Channel Signal Behaviour
-- Migration 005: Channel session and journey tables

-- ─── channel_sessions ────────────────────────────────────────────────────────
-- One row per user session, tagged with acquisition channel.

CREATE TABLE IF NOT EXISTS public.channel_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  session_ext_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN (
    'google_ads', 'meta_ads', 'tiktok_ads', 'linkedin_ads',
    'organic_search', 'paid_search_other', 'organic_social', 'paid_social_other',
    'email', 'referral', 'direct', 'other'
  )),
  source TEXT,
  medium TEXT,
  campaign TEXT,
  device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'other')),
  browser TEXT,
  landing_page TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  event_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  conversion_reached BOOLEAN NOT NULL DEFAULT false,
  signal_completion_score NUMERIC(4,3) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_channel_sessions_user ON public.channel_sessions(user_id);
CREATE INDEX idx_channel_sessions_site ON public.channel_sessions(user_id, website_url);
CREATE INDEX idx_channel_sessions_channel ON public.channel_sessions(channel);
CREATE INDEX idx_channel_sessions_started ON public.channel_sessions(started_at DESC);
CREATE UNIQUE INDEX idx_channel_sessions_ext ON public.channel_sessions(user_id, website_url, session_ext_id);

-- ─── channel_session_events ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.channel_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.channel_sessions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL CHECK (event_category IN (
    'page_view', 'micro_conversion', 'macro_conversion', 'engagement'
  )),
  page_url TEXT,
  event_params JSONB DEFAULT '{}',
  signal_health_status TEXT CHECK (signal_health_status IN (
    'healthy', 'degraded', 'missing', 'unknown'
  )) DEFAULT 'unknown',
  seq INTEGER NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cse_session ON public.channel_session_events(session_id);
CREATE INDEX idx_cse_event ON public.channel_session_events(event_name);

-- ─── channel_journey_maps ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.channel_journey_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  channel TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  conversion_rate NUMERIC(5,4) DEFAULT 0,
  avg_pages_per_session NUMERIC(5,2) DEFAULT 0,
  avg_events_per_session NUMERIC(5,2) DEFAULT 0,
  signal_completion_score NUMERIC(4,3) DEFAULT 0,
  journey_steps JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cjm_user_site ON public.channel_journey_maps(user_id, website_url);
CREATE UNIQUE INDEX idx_cjm_unique ON public.channel_journey_maps(user_id, website_url, channel, period_start, period_end);

-- ─── channel_diagnostics ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.channel_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  channel TEXT NOT NULL,
  diagnostic_type TEXT NOT NULL CHECK (diagnostic_type IN (
    'signal_gap', 'journey_divergence', 'engagement_anomaly', 'consent_impact'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_pages TEXT[] DEFAULT '{}',
  estimated_impact TEXT,
  recommended_action TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_cd_user_site ON public.channel_diagnostics(user_id, website_url);
CREATE INDEX idx_cd_severity ON public.channel_diagnostics(severity);
CREATE INDEX idx_cd_unresolved ON public.channel_diagnostics(user_id, website_url) WHERE NOT is_resolved;

-- ─── RLS policies ────────────────────────────────────────────────────────────

ALTER TABLE public.channel_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_journey_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own channel_sessions"
  ON public.channel_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own channel_session_events"
  ON public.channel_session_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.channel_sessions cs
    WHERE cs.id = channel_session_events.session_id AND cs.user_id = auth.uid()
  ));

CREATE POLICY "Users read own channel_journey_maps"
  ON public.channel_journey_maps FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own channel_diagnostics"
  ON public.channel_diagnostics FOR SELECT USING (auth.uid() = user_id);
