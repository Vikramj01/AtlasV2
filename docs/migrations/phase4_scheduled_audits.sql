-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 4.2 — Scheduled Audits
-- Run this migration in Supabase SQL Editor before deploying the backend.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── scheduled_audits table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scheduled_audits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  website_url     TEXT NOT NULL,
  funnel_type     TEXT NOT NULL CHECK (funnel_type IN ('ecommerce', 'saas', 'lead_gen')),
  region          TEXT NOT NULL DEFAULT 'us' CHECK (region IN ('us', 'eu', 'global')),
  url_map         JSONB NOT NULL DEFAULT '{}',
  frequency       TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  -- 0 = Sunday … 6 = Saturday; NULL for daily schedules
  day_of_week     SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  hour_utc        SMALLINT NOT NULL DEFAULT 2 CHECK (hour_utc BETWEEN 0 AND 23),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ,
  last_audit_id   UUID REFERENCES public.audits(id) ON DELETE SET NULL,
  last_audit_score SMALLINT,
  -- Stored hashed / encrypted — not plain text
  test_email      TEXT,
  test_phone      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Schedule runner uses this index to find due schedules efficiently
CREATE INDEX IF NOT EXISTS idx_scheduled_audits_due
  ON public.scheduled_audits (next_run_at)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_scheduled_audits_user
  ON public.scheduled_audits (user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_audits_last_audit
  ON public.scheduled_audits (last_audit_id)
  WHERE last_audit_id IS NOT NULL;

-- ── updated_at auto-update trigger ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_audits_updated_at ON public.scheduled_audits;
CREATE TRIGGER trg_scheduled_audits_updated_at
  BEFORE UPDATE ON public.scheduled_audits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.scheduled_audits ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own schedules.
-- The backend uses the service role key (supabaseAdmin) which bypasses RLS,
-- so these policies protect direct client access only.

CREATE POLICY "Users can read own schedules"
  ON public.scheduled_audits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own schedules"
  ON public.scheduled_audits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own schedules"
  ON public.scheduled_audits FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own schedules"
  ON public.scheduled_audits FOR DELETE
  USING (auth.uid() = user_id);
