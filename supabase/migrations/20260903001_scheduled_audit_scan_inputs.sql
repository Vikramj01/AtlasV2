-- Scheduled audits: v2 Scan Inputs + last-run rule_set_version
-- (Site Evaluation Coverage & Honesty PRD §6.7).
--
-- POST /api/schedules and the schedule runner (queue/worker.ts) never
-- threaded Check Register v2's Scan Inputs (site_type, declared_platforms,
-- ...) through to the audits they create — a scheduled re-run was always
-- scored by the v1 legacy engine, even for a schedule whose config a future
-- caller populates as v2, and the regression comparator (worker.ts's
-- auditQueue.on('completed', ...)) had no way to tell a v1-scored run apart
-- from a v2-scored one when comparing scores across runs.
--
-- Same column shapes as audits' own Scan Inputs columns
-- (20260902002_scan_inputs_check_register.sql) — additive only, existing
-- schedules keep working with rule_set_version defaulting to 'v1-legacy'.
-- last_audit_rule_set_version is new: it lets the regression comparator
-- compare like with like without an extra DB round-trip to reload the
-- previous run's full report.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scheduled_audits') THEN
    ALTER TABLE public.scheduled_audits
      ADD COLUMN IF NOT EXISTS rule_set_version TEXT NOT NULL DEFAULT 'v1-legacy',
      ADD COLUMN IF NOT EXISTS site_type TEXT
        CHECK (site_type IN ('plg_saas', 'ecommerce', 'lead_gen_b2b', 'marketplace', 'app_install', 'subscription_media')),
      ADD COLUMN IF NOT EXISTS secondary_motion TEXT
        CHECK (secondary_motion IN ('none', 'sales_assisted', 'hybrid')),
      ADD COLUMN IF NOT EXISTS declared_platforms TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS primary_channel TEXT,
      ADD COLUMN IF NOT EXISTS monthly_spend_band TEXT,
      ADD COLUMN IF NOT EXISTS traffic_regions TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS cmp TEXT
        CHECK (cmp IN ('onetrust', 'cookiebot', 'usercentrics', 'custom', 'none')),
      ADD COLUMN IF NOT EXISTS product_domain TEXT,
      ADD COLUMN IF NOT EXISTS checkout_domain TEXT,
      ADD COLUMN IF NOT EXISTS additional_properties TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS declared_conversions JSONB,
      -- Set by updateScheduleScore() alongside last_audit_score, read by the
      -- regression comparator to suppress a false regression alert when the
      -- previous and current runs used different rule libraries.
      ADD COLUMN IF NOT EXISTS last_audit_rule_set_version TEXT;
  END IF;
END $$;
