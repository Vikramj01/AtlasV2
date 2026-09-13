-- Seed platform_discontinuities with Meta's Jan 2026 attribution-window removal (B10 follow-up).
--
-- Meta removed the 7-day-view and 28-day-view attribution windows on 12 Jan
-- 2026 (per Meta's Oct 16, 2025 developer announcement) — a separate, earlier
-- change from the click-through attribution redefinition already seeded in
-- 20260828004. A client with historically longer sales cycles that relied on
-- view-through windows would see a sharp, unexplained conversion drop in
-- reconciliation around this date without this annotation.
--
-- No discontinuityDiff.ts code change needed — it already reads all rows for
-- a platform generically.

INSERT INTO platform_discontinuities (id, platform, title, effective_date, description)
VALUES
(
  'c1000003-0000-4000-8000-000000000003',
  'meta',
  'Meta 7-day/28-day view attribution windows removed',
  '2026-01-12',
  'Meta removed the 7-day-view and 28-day-view attribution windows starting 12 Jan 2026, reducing reported conversion counts for clients whose sales cycles previously relied on longer view-through attribution — independent of underlying campaign performance. Volume or alignment drift observed on Meta connections around or after this date may reflect this window removal rather than a delivery or tagging problem.'
)
ON CONFLICT (id) DO NOTHING;
