-- ──────────────────────────────────────────────────────────────────────────────
-- Sprint 2: Developer Portal — Migration 2 (Email Notifications)
--
-- Adds two columns to developer_shares:
--   invite_sent_at        — timestamp when the developer invite email was sent
--   marketer_notified_at  — timestamp when the all-implemented notification was
--                           sent to the marketer; NULL = not yet sent.
--                           Guards against duplicate notifications on repeated
--                           status updates that happen to keep all_implemented = true.
--
-- Run in Supabase SQL Editor after sprint2_developer_portal.sql.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE developer_shares
  ADD COLUMN IF NOT EXISTS invite_sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketer_notified_at TIMESTAMPTZ;
