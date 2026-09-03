-- Scan Inputs data model for the rebuilt Audit Engine (Check Register v2).
--
-- Adds the four Scan Inputs the new 134-rule Check Register requires:
-- site type (+ secondary motion), declared ad platforms (+ primary channel
-- and spend band), traffic regions (+ CMP), and domains (product/checkout,
-- beyond the existing website_url marketing domain) — plus rule_set_version,
-- since scores are not comparable across rule-set versions (a live audit
-- surfaced exactly this: a re-run after a rule-count fix moved the score for
-- reasons that had nothing to do with the site).
--
-- Additive only — funnel_type and region (the old 3-value/3-region model)
-- are kept untouched so every existing audit row and stored report_json
-- stays valid exactly as it is. New audits populate both the legacy columns
-- (via a compatibility mapping in application code) and the new ones;
-- rule_set_version is how a report says which model produced it.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audits') THEN
    ALTER TABLE public.audits
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
      ADD COLUMN IF NOT EXISTS rule_set_version TEXT NOT NULL DEFAULT 'v1-legacy';
  END IF;
END $$;

-- Optional unlocks (Scan Inputs sheet, "Optional" row) — test credentials for
-- authenticated crawl (L4/L5 post-auth) land in Phase 2 alongside the
-- second-pass/credentials/connector detection mechanisms; test_email/
-- test_phone already exist on this table from the original schema and cover
-- the form-fill use case. platform_connectors reuses the existing
-- platform_connections table (OAuth already built for Reconciliation) rather
-- than a new column — no schema change needed for that unlock.
