-- Seed platform_discontinuities with Google Ads' Sept 2026 attribution-model
-- removal (Google Stack Alignment sprint plan, Sprint 1 Correction 7).
--
-- Google finished removing the first-click, linear, time-decay and
-- position-based attribution models in September 2026; every conversion
-- action still on one of those models was force-migrated to data-driven.
-- Only data-driven and last-click remain. configDiff.ts diffs stored
-- expected attribution_model against observed and raises a config-drift
-- finding on mismatch, so restoring live Google Ads API connectivity in this
-- same sprint (see the version-fix migrations above) will surface a wave of
-- attribution_model mismatches that are this forced migration, not client
-- misconfiguration, unless annotated here.
--
-- No exact rollout date is confirmed against a primary Google source from
-- this environment (developers.google.com is egress-blocked in the sandbox;
-- facts were triangulated across independent secondary sources per the
-- sprint plan's verification caveat) — effective_date is left NULL per the
-- register's existing precedent (see GA4's row in 20260828004) rather than
-- asserting false precision.
--
-- No discontinuityDiff.ts code change needed — it already reads all rows for
-- a platform generically.

INSERT INTO platform_discontinuities (id, platform, title, effective_date, description)
VALUES
(
  'c1000004-0000-4000-8000-000000000004',
  'google_ads',
  'Google Ads first-click/linear/time-decay/position-based attribution models removed',
  NULL,
  'Google Ads removed the first-click, linear, time-decay and position-based attribution models in September 2026, force-migrating every conversion action still on one of them to data-driven attribution. Only data-driven and last-click models remain. A conversion action''s attribution_model changing around this period, or a config-drift finding comparing a stored expected model against this new observed one, reflects this platform-wide forced migration rather than a client-side misconfiguration. Confirm the exact rollout date against Google''s official changelog before ruling out other causes for a given account.'
)
ON CONFLICT (id) DO NOTHING;
