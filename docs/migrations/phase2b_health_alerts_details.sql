-- Phase 2b — Add details column to health_alerts
-- Required for scheduled audit regression alerts to store structured context.
-- Run in Supabase SQL Editor before deploying the backend.

ALTER TABLE public.health_alerts
  ADD COLUMN IF NOT EXISTS details JSONB;
