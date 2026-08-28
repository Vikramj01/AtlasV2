-- Reconciliation "known platform discontinuity" annotations (B10)
--
-- Platform-side redefinitions move reported numbers for reasons unrelated to
-- performance (e.g. Meta's click-through attribution redefinition on 3 Mar
-- 2026). Without a register, every diff the reconciliation engine finds
-- around one of these dates gets surfaced as an unexplained anomaly.

CREATE TABLE IF NOT EXISTS platform_discontinuities (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform       TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  effective_date DATE,
  description    TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_discontinuities_platform ON platform_discontinuities (platform);

ALTER TABLE platform_discontinuities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_discontinuities: read all" ON platform_discontinuities;
CREATE POLICY "platform_discontinuities: read all"
  ON platform_discontinuities FOR SELECT
  USING (true);

-- Widen reconciliation_findings.dimension to accept the new 'discontinuity' dimension
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'reconciliation_findings') THEN
    ALTER TABLE reconciliation_findings DROP CONSTRAINT IF EXISTS reconciliation_findings_dimension_check;
    ALTER TABLE reconciliation_findings ADD CONSTRAINT reconciliation_findings_dimension_check
      CHECK (dimension IN ('delivery', 'config', 'alignment', 'volume', 'discontinuity'));
  END IF;
END $$;

-- Seed the register with the two discontinuities named in the PRD.
-- GA4's attribution-window narrowing has no single confirmed rollout date in
-- source material — effective_date is left NULL and the description flags
-- it as approximate rather than asserting false precision.
INSERT INTO platform_discontinuities (id, platform, title, effective_date, description)
VALUES
(
  'c1000001-0000-4000-8000-000000000001',
  'meta',
  'Meta click-through attribution redefinition',
  '2026-03-03',
  'Meta redefined how click-through conversions are attributed starting 3 Mar 2026, shifting reported conversion counts for reasons unrelated to campaign performance. Volume or alignment drift observed around this date on Meta connections may reflect this redefinition rather than a delivery or tagging problem.'
),
(
  'c1000002-0000-4000-8000-000000000002',
  'ga4',
  'GA4 attribution-model narrowing',
  NULL,
  'GA4 narrowed its default attribution model window, moving reported conversion counts independent of underlying performance. No single confirmed rollout date is on record — confirm the effective date against Google''s official changelog before ruling out other causes for GA4 volume divergence.'
)
ON CONFLICT (id) DO NOTHING;
