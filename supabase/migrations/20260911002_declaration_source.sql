-- audits.declaration_source (Pre-Connection Scan Confidence Tiering PRD §8,
-- Sprint 2 of docs/atlas-sprint-plan-pre-connection-confidence-tiering.md).
--
-- Provenance of the audit's declared_platforms list — capping the severity
-- DECLARED_PLATFORM_HAS_TAG (L0.1) can assert for a missing tag, since that
-- severity currently rests entirely on an operator-entered declaration that
-- may simply be wrong.
--
-- 'CLIENT_CONFIRMED'   — the prospect answered the scope questions themselves.
-- 'OPERATOR_ASSUMED'   — an operator entered it on the prospect's behalf.
-- 'INFERRED_FROM_SITE' — guessed from what the crawl itself observed.
--
-- Nullable — read as 'OPERATOR_ASSUMED' (the pre-connection default per the
-- PRD) by L0.ts's DECLARED_PLATFORM_HAS_TAG when absent, including for
-- every row written before this migration.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
      ADD COLUMN IF NOT EXISTS declaration_source TEXT
        CHECK (declaration_source IS NULL OR declaration_source IN ('CLIENT_CONFIRMED', 'OPERATOR_ASSUMED', 'INFERRED_FROM_SITE'));
  END IF;
END $$;
