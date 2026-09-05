-- Add a TikTok platform-enablement flag to signal_enrichment_configs.
--
-- TikTok CAPI delivery (tiktokDelivery.ts) and identity capture (ttclid_field,
-- migration 20260902001) already work end-to-end. What's missing is a flag an
-- operator can toggle for a signal's TikTok delivery, on the same footing as
-- enabled_for_meta/enabled_for_google — consumed by the enrichment validation
-- rules (SIG_04, CROSS_01, CROSS_02) so a TikTok-only deployment is scored
-- honestly instead of reading as "no platforms enabled".
--
-- Defaults to false, unlike enabled_for_meta/enabled_for_google (which default
-- true because they predate any deployments). A true default here would
-- retroactively mark every existing deployment as TikTok-enabled and change
-- its validation score overnight. This column follows the enabled_for_<platform>
-- naming already in use, not the unwired amazon_enabled/microsoft_enabled/
-- openai_enabled columns added in 20260701001/20260828003 — those stay
-- unwired; see the TikTok enrichment PRD for why they aren't a usable precedent.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_enrichment_configs') THEN
    ALTER TABLE signal_enrichment_configs
      ADD COLUMN IF NOT EXISTS enabled_for_tiktok BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
