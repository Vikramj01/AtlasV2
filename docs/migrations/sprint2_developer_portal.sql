-- ──────────────────────────────────────────────────────────────────────────────
-- Sprint 2: Developer Portal — Migration 1
--
-- Creates:
--   developer_shares        — share tokens for the developer portal
--   implementation_progress — per-page implementation status per share
--
-- Run in Supabase SQL Editor (or via supabase CLI).
-- All changes are additive — no existing tables modified.
-- ──────────────────────────────────────────────────────────────────────────────

-- Share tokens for developer portal access
CREATE TABLE IF NOT EXISTS developer_shares (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_token    TEXT        NOT NULL UNIQUE,
  developer_name TEXT,
  developer_email TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Implementation progress per page
CREATE TABLE IF NOT EXISTS implementation_progress (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id         UUID        NOT NULL REFERENCES developer_shares(id) ON DELETE CASCADE,
  page_id          UUID        NOT NULL REFERENCES planning_pages(id) ON DELETE CASCADE,
  status           TEXT        NOT NULL DEFAULT 'not_started'
                               CHECK (status IN ('not_started', 'in_progress', 'implemented', 'verified')),
  developer_notes  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(share_id, page_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_developer_shares_token   ON developer_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_developer_shares_session ON developer_shares(session_id);
CREATE INDEX IF NOT EXISTS idx_implementation_progress_share ON implementation_progress(share_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE developer_shares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE implementation_progress ENABLE ROW LEVEL SECURITY;

-- Owners can manage their own shares
CREATE POLICY "Users manage own shares"
  ON developer_shares FOR ALL
  USING (auth.uid() = user_id);

-- Implementation progress is managed at the application layer (via supabaseAdmin)
-- because the developer is unauthenticated. We allow all operations via the
-- service role key; no user-facing RLS policy needed.
-- The route handler validates the share_token and checks is_active + expires_at.
CREATE POLICY "Service role manages progress"
  ON implementation_progress FOR ALL
  USING (true);
