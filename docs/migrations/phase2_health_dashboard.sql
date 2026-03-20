-- Phase 2: Data Health Dashboard
-- Creates three new tables for persistent health monitoring.
--
-- Run in Supabase SQL editor: Dashboard → SQL Editor → New Query → paste → Run

-- ── health_scores ─────────────────────────────────────────────────────────────
-- Stores the latest computed health score per user.
-- Upserted on each computation run (one row per user).

CREATE TABLE IF NOT EXISTS health_scores (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  overall_score        INTEGER       NOT NULL DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 100),
  signal_health        INTEGER       NOT NULL DEFAULT 0 CHECK (signal_health BETWEEN 0 AND 100),
  capi_delivery_rate   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  consent_coverage     INTEGER       NOT NULL DEFAULT 0 CHECK (consent_coverage BETWEEN 0 AND 100),
  tag_firing_rate      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  last_audit_id        UUID,
  last_audit_at        TIMESTAMPTZ,
  computed_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- ── health_snapshots ──────────────────────────────────────────────────────────
-- Time-series history for trending / charting.
-- One row inserted per computation run.

CREATE TABLE IF NOT EXISTS health_snapshots (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  overall_score        INTEGER       NOT NULL DEFAULT 0,
  signal_health        INTEGER,
  capi_delivery_rate   NUMERIC(5,2),
  consent_coverage     INTEGER,
  tag_firing_rate      NUMERIC(5,2),
  snapshot_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS health_snapshots_user_at
  ON health_snapshots (user_id, snapshot_at DESC);

-- ── health_alerts ─────────────────────────────────────────────────────────────
-- Persistent alert records. New row created when metric breaches threshold;
-- auto-resolved after 2 consecutive healthy intervals.

CREATE TABLE IF NOT EXISTS health_alerts (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type           TEXT          NOT NULL,
  severity             TEXT          NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title                TEXT          NOT NULL,
  message              TEXT          NOT NULL,
  metric_value         NUMERIC,
  threshold_value      NUMERIC,
  is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
  consecutive_ok_count INTEGER       NOT NULL DEFAULT 0,
  triggered_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at          TIMESTAMPTZ,
  acknowledged_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS health_alerts_user_active
  ON health_alerts (user_id, is_active, triggered_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE health_scores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_alerts    ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (backend uses supabaseAdmin)
-- These policies allow authenticated users to read their own data via the
-- anon/user key if ever needed from the frontend directly.

DO $$ BEGIN
  CREATE POLICY "Users can read own health scores"
    ON health_scores FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read own health snapshots"
    ON health_snapshots FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read own health alerts"
    ON health_alerts FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
