-- ──────────────────────────────────────────────────────────────────────────────
-- Sprint 3: Quick-Check + Planning-to-Audit Feedback Loop
--
-- Changes:
--   journeys: add source_planning_session_id column
--     - Set by the handoff endpoint when a journey is created from Planning Mode
--     - Used by the gaps API to surface planning context in the Gap Report
--
-- Run in Supabase SQL Editor (or via supabase CLI).
-- All changes are additive — no existing tables modified destructively.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS source_planning_session_id UUID
    REFERENCES planning_sessions(id) ON DELETE SET NULL;

-- Index for quick lookup (gaps API needs to find planning context by journey)
CREATE INDEX IF NOT EXISTS idx_journeys_source_session
  ON journeys(source_planning_session_id)
  WHERE source_planning_session_id IS NOT NULL;
