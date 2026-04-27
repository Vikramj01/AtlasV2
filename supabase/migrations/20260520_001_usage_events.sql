-- Usage events: log every Browserbase page scan and Claude API call per org.
-- Internal data only — no customer-facing access. Service role only via RLS.

CREATE TABLE usage_events (
  id               uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type       text          NOT NULL CHECK (event_type IN (
                     'page_scan',
                     'ai_report_scheduled',
                     'ai_report_ondemand',
                     'ai_query_ondemand'
                   )),

  -- Browserbase fields (page_scan only)
  browser_minutes  numeric(8,4)  NULL,
  pages_scanned    integer       NULL,
  domain           text          NULL,

  -- Claude fields (ai_* only)
  input_tokens     integer       NULL,
  output_tokens    integer       NULL,
  model            text          NULL,

  -- Cost computed at write time; update computeCost() when invoices arrive
  cost_usd         numeric(10,6) NOT NULL DEFAULT 0,

  -- Traceability
  job_id           text          NULL,
  scan_run_id      uuid          NULL, -- groups all page_scan rows from one crawl job
  metadata         jsonb         NULL,

  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_org_id     ON usage_events (org_id);
CREATE INDEX idx_usage_events_created_at ON usage_events (created_at DESC);
CREATE INDEX idx_usage_events_scan_run   ON usage_events (scan_run_id) WHERE scan_run_id IS NOT NULL;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON usage_events
  USING (auth.role() = 'service_role');

-- ── Materialized view: pre-aggregated monthly summary per org ─────────────────
-- Refreshed nightly by the usageSummaryQueue Bull job via RPC below.

CREATE MATERIALIZED VIEW usage_monthly_summary AS
SELECT
  org_id,
  date_trunc('month', created_at)                                  AS month,
  COUNT(*) FILTER (WHERE event_type = 'page_scan')                 AS total_page_scans,
  SUM(browser_minutes) FILTER (WHERE event_type = 'page_scan')     AS total_browser_minutes,
  COUNT(*) FILTER (WHERE event_type LIKE 'ai_%')                   AS total_ai_calls,
  SUM(input_tokens)  FILTER (WHERE event_type LIKE 'ai_%')         AS total_input_tokens,
  SUM(output_tokens) FILTER (WHERE event_type LIKE 'ai_%')         AS total_output_tokens,
  SUM(cost_usd)                                                     AS total_variable_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type = 'page_scan')            AS scan_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_%')              AS ai_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_report_%')       AS report_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_%ondemand')      AS ondemand_cost_usd
FROM usage_events
GROUP BY org_id, date_trunc('month', created_at);

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX ON usage_monthly_summary (org_id, month);

-- ── RPC: allows the Bull worker to refresh the view without direct DB access ──

CREATE OR REPLACE FUNCTION refresh_usage_monthly_summary()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY usage_monthly_summary;
END;
$$;
