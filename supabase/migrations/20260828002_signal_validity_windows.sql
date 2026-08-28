-- Signal Library validity windows and deprecation (B3)
--
-- A signal library entry that only describes current state rots invisibly as
-- platforms change: TikTok's ClickButton/PlaceAnOrder events sunset in 2027,
-- LinkedIn sunsets API versions annually, Google closed three Ads API
-- endpoints in six months (per ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md).
-- This adds a validity window + optional supersession pointer to `signals`,
-- and a lighter valid_from/deprecated_at pair to `signal_packs`.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signals') THEN
    ALTER TABLE signals
      ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS superseded_by_signal_id UUID REFERENCES signals(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_signals_deprecated_at
      ON signals (deprecated_at) WHERE deprecated_at IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_packs') THEN
    ALTER TABLE signal_packs
      ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_signal_packs_deprecated_at
      ON signal_packs (deprecated_at) WHERE deprecated_at IS NOT NULL;
  END IF;
END $$;
