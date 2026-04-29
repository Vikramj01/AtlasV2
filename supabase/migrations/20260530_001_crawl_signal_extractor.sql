-- Sprint CSE-1 — Crawl Signal Extractor tables
-- All org_id columns reference auth.users(id) — consistent with org_subscriptions,
-- cap_violations, strategy_briefs, and all other recent migrations.
-- All four tables are service-role only (no customer-facing RLS read access).

-- ── 1. crawl_runs — one record per scan execution ─────────────────────────────

CREATE TABLE crawl_runs (
  id                      uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                  uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode                    text          NOT NULL CHECK (mode IN ('onboarding', 'scheduled')),
  status                  text          NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  triggered_by            text          NOT NULL CHECK (triggered_by IN ('system', 'manual', 'onboarding')),

  -- Page scope counters
  total_pages             integer       NOT NULL DEFAULT 0,
  pages_completed         integer       NOT NULL DEFAULT 0,
  pages_failed            integer       NOT NULL DEFAULT 0,

  -- Browserbase tracking
  browserbase_session_id  text          NULL,
  browser_minutes_used    numeric(8,4)  NULL,

  -- Timing
  started_at              timestamptz   NULL,
  completed_at            timestamptz   NULL,
  duration_seconds        integer       GENERATED ALWAYS AS (
                            EXTRACT(EPOCH FROM (completed_at - started_at))::integer
                          ) STORED,

  -- Error capture
  error_message           text          NULL,
  error_detail            jsonb         NULL,

  created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_runs_org_id     ON crawl_runs (org_id);
CREATE INDEX idx_crawl_runs_status     ON crawl_runs (status);
CREATE INDEX idx_crawl_runs_created_at ON crawl_runs (created_at DESC);

ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON crawl_runs
  USING (auth.role() = 'service_role');

-- ── 2. crawl_pages — one record per page per crawl run ────────────────────────

CREATE TABLE crawl_pages (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  crawl_run_id        uuid          NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url                 text          NOT NULL,
  url_type            text          NOT NULL CHECK (url_type IN (
                        'ad_destination',
                        'conversion_funnel',
                        'manual'
                      )),
  domain              text          NOT NULL,

  -- Scan result
  status              text          NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'scanning', 'completed', 'failed', 'skipped')),
  http_status         integer       NULL,
  scan_duration_ms    integer       NULL,

  -- Signal summary (denormalised for quick reads)
  signals_found       integer       NOT NULL DEFAULT 0,
  signals_healthy     integer       NOT NULL DEFAULT 0,
  signals_degraded    integer       NOT NULL DEFAULT 0,
  signals_missing     integer       NOT NULL DEFAULT 0,

  error_message       text          NULL,
  scanned_at          timestamptz   NULL,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_pages_crawl_run_id ON crawl_pages (crawl_run_id);
CREATE INDEX idx_crawl_pages_org_id       ON crawl_pages (org_id);
CREATE INDEX idx_crawl_pages_domain       ON crawl_pages (domain);

ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON crawl_pages
  USING (auth.role() = 'service_role');

-- ── 3. detected_signals — one record per signal per page per run ──────────────

CREATE TABLE detected_signals (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  crawl_page_id       uuid          NOT NULL REFERENCES crawl_pages(id) ON DELETE CASCADE,
  crawl_run_id        uuid          NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Signal identity
  signal_type         text          NOT NULL CHECK (signal_type IN (
                        'gtm_container',
                        'ga4_base',
                        'ga4_event',
                        'meta_pixel',
                        'meta_capi',
                        'google_ads_conversion',
                        'google_ads_remarketing',
                        'tiktok_pixel',
                        'linkedin_insight',
                        'snapchat_pixel',
                        'custom_event'
                      )),
  signal_name         text          NULL,
  signal_id           text          NULL,

  -- Health assessment
  health_status       text          NOT NULL CHECK (health_status IN (
                        'healthy',
                        'degraded',
                        'missing',
                        'duplicate',
                        'misconfigured'
                      )),
  health_score        integer       NOT NULL CHECK (health_score BETWEEN 0 AND 100),

  -- Detection detail
  detected_at         text          NULL CHECK (detected_at IN (
                        'page_load', 'dom_ready', 'interaction', 'network'
                      )),
  firing_triggers     jsonb         NULL,
  parameters          jsonb         NULL,
  issues              jsonb         NULL,

  -- Baseline tracking for scheduled mode delta detection
  first_seen_run_id   uuid          NULL REFERENCES crawl_runs(id),
  is_regression       boolean       NOT NULL DEFAULT false,

  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_detected_signals_crawl_run_id  ON detected_signals (crawl_run_id);
CREATE INDEX idx_detected_signals_org_id        ON detected_signals (org_id);
CREATE INDEX idx_detected_signals_signal_type   ON detected_signals (signal_type);
CREATE INDEX idx_detected_signals_health_status ON detected_signals (health_status);

ALTER TABLE detected_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON detected_signals
  USING (auth.role() = 'service_role');

-- ── 4. org_page_scope — the customer's configured page list ───────────────────

CREATE TABLE org_page_scope (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url             text          NOT NULL,
  url_type        text          NOT NULL CHECK (url_type IN (
                    'ad_destination', 'conversion_funnel', 'manual'
                  )),
  domain          text          NOT NULL,
  source          text          NULL,       -- 'google_ads', 'meta_ads', 'auto_detected', 'manual'
  is_active       boolean       NOT NULL DEFAULT true,
  priority        integer       NOT NULL DEFAULT 0,
  added_at        timestamptz   NOT NULL DEFAULT now(),
  last_crawled_at timestamptz   NULL,

  UNIQUE (org_id, url)
);

CREATE INDEX idx_org_page_scope_org_id    ON org_page_scope (org_id);
CREATE INDEX idx_org_page_scope_is_active ON org_page_scope (is_active) WHERE is_active = true;

ALTER TABLE org_page_scope ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON org_page_scope
  USING (auth.role() = 'service_role');
