-- Shopify App — standalone acquisition channel (Sprint 4)
--
-- A public/custom-distribution Shopify app: a merchant installs it directly
-- from Shopify with no prior Atlas account. Install auto-provisions a shadow
-- Supabase Auth user (owning an auto-created organisation + client via the
-- existing handle_new_user() trigger) so every existing FK
-- (platform_connections/capi_providers/refund_events -> auth.users(id))
-- is satisfied natively — no schema loosening needed there. See the plan
-- for the full architecture.
--
-- This migration covers:
--   A. Widening platform_connections.platform to accept 'shopify', plus a
--      lookup index for resolving an inbound webhook's shop domain to a
--      connection (webhooks carry no Atlas auth, only a shop domain).
--   B. profiles gains provisioning_source/claimed_at so the frontend can
--      show a "claim your account" prompt and support/analytics can see
--      channel-attributed accounts.
--   C. shopify_webhook_events — staging table for order/refund webhook
--      payloads, so Bull job payloads carry only an id (no PII), matching
--      the "no PII in job payloads" convention already followed elsewhere.
--   D. shopify_compliance_requests — audit log for the three mandatory
--      GDPR webhooks (customers/data_request, customers/redact,
--      shop/redact) required of any Partner-Dashboard-registered app with
--      customer data access. v1 acknowledges + logs for manual follow-up
--      rather than automated cross-table erasure.

-- ── A. platform_connections: accept 'shopify' ─────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_connections') THEN
    ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
    ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
      CHECK (platform IN ('google_ads', 'meta', 'ga4', 'gtm_destinations', 'linkedin', 'shopify'));
  END IF;
END $$;

-- Webhooks arrive with only X-Shopify-Shop-Domain, no Atlas auth — this is
-- the lookup path from shop domain -> connection -> org/client.
CREATE INDEX IF NOT EXISTS idx_platform_connections_platform_account
  ON platform_connections (platform, account_id);

-- ── B. profiles: provisioning source + claim tracking ─────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS provisioning_source TEXT DEFAULT NULL;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

-- ── C. shopify_webhook_events (staging, service-role only) ────────────────────

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain    TEXT        NOT NULL,
  topic          TEXT        NOT NULL,
  payload        JSONB       NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ DEFAULT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processed', 'failed')),
  error_message  TEXT        DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_status
  ON shopify_webhook_events(status, received_at);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_shop
  ON shopify_webhook_events(shop_domain, received_at DESC);

ALTER TABLE shopify_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON shopify_webhook_events;
CREATE POLICY "service_role_only" ON shopify_webhook_events
  USING (auth.role() = 'service_role');

-- ── D. shopify_compliance_requests (GDPR mandatory webhooks, audit log) ───────

CREATE TABLE IF NOT EXISTS shopify_compliance_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain TEXT        NOT NULL,
  topic       TEXT        NOT NULL
                           CHECK (topic IN ('customers_data_request', 'customers_redact', 'shop_redact')),
  payload     JSONB       NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at  TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_compliance_requests_pending
  ON shopify_compliance_requests(received_at)
  WHERE handled_at IS NULL;

ALTER TABLE shopify_compliance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON shopify_compliance_requests;
CREATE POLICY "service_role_only" ON shopify_compliance_requests
  USING (auth.role() = 'service_role');
