-- ──────────────────────────────────────────────────────────────────────────────
-- Sprint 4: Re-Scan & Change Detection
--
-- Changes:
--   planning_sessions: add last_rescan_at + rescan_results columns
--     - last_rescan_at: when the most recent re-scan completed (or started)
--     - rescan_results: JSONB blob storing the full ChangeDetectionResult
--       including status ('scanning' | 'complete' | 'failed') + per-page diffs
--
-- Run in Supabase SQL Editor (or via supabase CLI).
-- All changes are additive — no existing tables modified destructively.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE planning_sessions
  ADD COLUMN IF NOT EXISTS last_rescan_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rescan_results JSONB;
