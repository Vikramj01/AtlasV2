-- Signal Tracking Dashboard — database foundation
-- Adds missing columns to capi_events, creates performance indexes,
-- creates mv_signal_aggregates_daily, and registers its refresh RPC.

-- ── capi_events: add missing columns ─────────────────────────────────────────
-- match_quality_score: EMQ proxy (0–10), populated by CAPI pipeline (future).
-- latency_ms: event-to-delivery latency, computed on delivery and stored here.
-- payload: full outbound request payload sent to the destination platform.

ALTER TABLE capi_events
  ADD COLUMN IF NOT EXISTS match_quality_score NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS latency_ms          INTEGER,
  ADD COLUMN IF NOT EXISTS payload             JSONB;

-- ── Performance indexes ───────────────────────────────────────────────────────
-- All scoped to organization_id first so RLS-filtered queries hit the index.
-- Partial unique index on event_id allows NULLs (rows pre-dating dedup sprint).

CREATE INDEX IF NOT EXISTS idx_capi_events_org_sent
  ON capi_events (organization_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_capi_events_org_provider_sent
  ON capi_events (organization_id, provider_config_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_capi_events_org_dedup_sent
  ON capi_events (organization_id, dedup_status, processed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capi_events_org_event_id
  ON capi_events (organization_id, event_id)
  WHERE event_id IS NOT NULL;

-- ── Materialized view: daily signal aggregates ────────────────────────────────
-- Joins capi_providers to surface provider name as 'destination'.
-- Covers the rolling 30-day window; refreshed every 5 min by a Bull job.
-- RLS is bypassed at the MV layer (service role); the API enforces org-scoping
-- by filtering on organization_id when querying this view.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_signal_aggregates_daily AS
SELECT
  date_trunc('day', ce.processed_at)                          AS day,
  ce.organization_id,
  cp.provider                                                  AS destination,
  ce.provider_event_name                                       AS event_name,
  count(*)                                                     AS signal_count,
  count(*) FILTER (WHERE ce.status = 'delivered')             AS success_count,
  count(*) FILTER (WHERE ce.status = 'delivery_failed'
                      OR ce.status = 'dead_letter')           AS failure_count,
  count(*) FILTER (WHERE ce.dedup_status = 'hit')             AS dedup_hit_count,
  count(*) FILTER (WHERE ce.dedup_status = 'miss')            AS dedup_miss_count,
  avg(ce.match_quality_score)                                  AS avg_match_quality,
  avg(ce.latency_ms)                                           AS avg_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ce.latency_ms) AS p95_latency_ms
FROM capi_events ce
JOIN capi_providers cp ON cp.id = ce.provider_config_id
WHERE ce.processed_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_signal_aggregates_pk
  ON mv_signal_aggregates_daily (day, organization_id, destination, event_name);

-- Supporting indexes for the aggregate card queries (filter by org + time range).
CREATE INDEX IF NOT EXISTS idx_mv_signal_aggregates_org_day
  ON mv_signal_aggregates_daily (organization_id, day DESC);

-- ── RPC: CONCURRENT refresh (called by Bull job via supabaseAdmin.rpc()) ─────
-- SECURITY DEFINER so the service-role caller can run REFRESH without owning
-- the view under the restricted anon/authenticated role.

CREATE OR REPLACE FUNCTION refresh_signal_aggregates_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_signal_aggregates_daily;
END;
$$;
