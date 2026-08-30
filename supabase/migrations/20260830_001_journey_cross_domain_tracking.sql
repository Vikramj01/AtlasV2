-- Journey Builder cross-domain tracking support
-- Mirrors 20260713_001_cross_domain_tracking.sql (planning_sessions / clients) so
-- the Journey Builder's spec generator can also emit GA4 linked_domains guidance
-- and the Meta cross-domain fbclid link decorator snippet.

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS secondary_domains TEXT[] NOT NULL DEFAULT '{}';
