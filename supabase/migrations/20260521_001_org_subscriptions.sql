-- Sprint 2.2 — org_subscriptions, cap_violations, and supporting view
-- Manually-managed commercial subscription record per org (no Stripe integration in this phase).
-- Both tables are service-role only: no customer-facing access.

-- ── 1. update_updated_at helper ───────────────────────────────────────────────
-- Safe to re-run — already defined in 20260317_001_consent_and_capi_tables.sql.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── 2. org_subscriptions ──────────────────────────────────────────────────────

CREATE TABLE org_subscriptions (
  id                      uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                  uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Tier and pricing
  tier                    text          NOT NULL,   -- must match AtlasTier keys in config/pricing.ts
  currency                text          NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'AED', 'SGD')),
  contracted_price        numeric(10,2) NOT NULL,   -- actual agreed price in the currency above
  mrr_usd                 numeric(10,2) NOT NULL,   -- always USD for margin calculations
  billing_cadence         text          NOT NULL DEFAULT 'monthly'
                            CHECK (billing_cadence IN ('one_time', 'monthly', 'quarterly', 'annual')),

  -- Discounts
  cadence_discount_pct    numeric(5,2)  NOT NULL DEFAULT 0,
  accelerator_partner     boolean       NOT NULL DEFAULT false,
  custom_discount_pct     numeric(5,2)  NOT NULL DEFAULT 0,
  custom_discount_reason  text          NULL,

  -- Add-ons: { "extra_domains": 2, "white_label": true, "signal_operator": true }
  addons                  jsonb         NOT NULL DEFAULT '{}',

  -- Subscription window
  started_at              timestamptz   NOT NULL,
  ends_at                 timestamptz   NULL,       -- null = open-ended
  trial_ends_at           timestamptz   NULL,       -- null = not on trial

  -- Status
  status                  text          NOT NULL DEFAULT 'active'
                            CHECK (status IN ('trial', 'active', 'paused', 'cancelled', 'expired')),
  cancellation_reason     text          NULL,

  -- Operator notes (not customer-visible)
  notes                   text          NULL,

  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_subscriptions_org_id  ON org_subscriptions (org_id);
CREATE INDEX idx_org_subscriptions_status  ON org_subscriptions (status);
CREATE INDEX idx_org_subscriptions_tier    ON org_subscriptions (tier);

ALTER TABLE org_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON org_subscriptions
  USING (auth.role() = 'service_role');

CREATE TRIGGER org_subscriptions_updated_at
  BEFORE UPDATE ON org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. org_active_subscriptions view ─────────────────────────────────────────
-- Always returns the most recent active or trial subscription per org.
-- Used by the fair-use job and admin dashboard margin query.

CREATE OR REPLACE VIEW org_active_subscriptions AS
SELECT DISTINCT ON (org_id) *
FROM org_subscriptions
WHERE status IN ('trial', 'active')
ORDER BY org_id, started_at DESC;

-- ── 4. cap_violations ────────────────────────────────────────────────────────

CREATE TABLE cap_violations (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cap_type      text          NOT NULL CHECK (cap_type IN (
                  'page_scan', 'domain_count', 'client_count', 'query_count'
                )),
  domain        text          NULL,       -- populated for page_scan violations
  cap_value     numeric       NOT NULL,   -- the entitlement
  actual        numeric       NOT NULL,   -- what was consumed
  usage_pct     numeric       NOT NULL,   -- actual / cap_value
  severity      text          NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  resolved      boolean       NOT NULL DEFAULT false,
  resolved_at   timestamptz   NULL,
  resolution    text          NULL,       -- 'upgraded', 'warned', 'overage_charged', 'ignored'
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_cap_violations_org_id   ON cap_violations (org_id);
CREATE INDEX idx_cap_violations_resolved ON cap_violations (resolved) WHERE resolved = false;

ALTER TABLE cap_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON cap_violations
  USING (auth.role() = 'service_role');
