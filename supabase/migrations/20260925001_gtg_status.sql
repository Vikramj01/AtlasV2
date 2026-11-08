-- Google Tag Gateway status (docs/prd/google-tag-gateway.md §5, Sprint 1)
--
-- `health_scores.gtg_active` used to mean "a GTM OAuth connection exists".
-- It now derives from a per-client status computed from verified evidence.
-- Existing clients start at 'unknown' (never capped, never flagged) until the
-- Sprint 2 matcher and Sprint 3 probe set a real value.
--
-- gtg_active is kept on health_scores/health_snapshots for compatibility.

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE public.clients
      ADD COLUMN IF NOT EXISTS gtg_status TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE public.clients
      ADD COLUMN IF NOT EXISTS gtg_status_updated_at TIMESTAMPTZ;
    ALTER TABLE public.clients
      ADD COLUMN IF NOT EXISTS gtg_went_live_at TIMESTAMPTZ;
    ALTER TABLE public.clients
      ADD COLUMN IF NOT EXISTS gtg_not_applicable_reason TEXT;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'clients_gtg_status_check'
    ) THEN
      ALTER TABLE public.clients
        ADD CONSTRAINT clients_gtg_status_check CHECK (gtg_status IN (
          'verified', 'verified_no_geo', 'detected_unverified', 'partial',
          'legacy', 'broken', 'not_detected', 'not_applicable', 'unknown'
        ));
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'health_scores') THEN
    ALTER TABLE public.health_scores ADD COLUMN IF NOT EXISTS gtg_status TEXT;
  END IF;
END $$;
