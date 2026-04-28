-- Browserbase nightly reconciliation snapshots.
-- Stores the daily pull from the Browserbase Project Usage API and compares it
-- against Atlas-internal logged minutes to surface unattributed sessions.
--
-- Internal operator data only — no customer-facing access.
-- API response shape (sdk v2.x): { browserMinutes: number, proxyBytes: number }

CREATE TABLE browserbase_usage_snapshots (
  id                       uuid          DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Calendar date this snapshot covers (one row per day, upserted nightly)
  snapshot_date            date          NOT NULL UNIQUE,

  -- Values reported directly by the Browserbase Project Usage API
  total_browser_minutes    numeric(10,4) NOT NULL,
  total_proxy_data_gb      numeric(10,6) NOT NULL,  -- converted from proxyBytes / 1e9

  -- Plan allowance: $20/month plan includes 6,000 minutes.
  -- Update if the plan changes.
  included_minutes         integer       NOT NULL DEFAULT 6000,

  -- Computed: minutes and cost beyond the plan allowance.
  -- Both are $0 until total_browser_minutes > 6,000.
  overage_minutes          numeric(10,4) GENERATED ALWAYS AS
                             (GREATEST(total_browser_minutes - included_minutes, 0)) STORED,
  overage_cost_usd         numeric(10,4) GENERATED ALWAYS AS
                             (GREATEST(total_browser_minutes - included_minutes, 0) * 0.002) STORED,

  -- Atlas-internal total for the same calendar month (summed from usage_events).
  -- Populated by the reconciliation job; NULL means the job hasn't run yet.
  atlas_logged_minutes     numeric(10,4) NULL,

  -- Computed: gap between what Browserbase reports and what Atlas attributed.
  -- A large positive delta means sessions ran without proper org attribution.
  delta_minutes            numeric(10,4) GENERATED ALWAYS AS
                             (total_browser_minutes - COALESCE(atlas_logged_minutes, 0)) STORED,

  created_at               timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_bb_snapshots_date ON browserbase_usage_snapshots (snapshot_date DESC);

ALTER TABLE browserbase_usage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON browserbase_usage_snapshots
  USING (auth.role() = 'service_role');
