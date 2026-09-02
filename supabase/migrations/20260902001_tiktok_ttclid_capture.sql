-- Add ttclid (TikTok click ID) support to client identity mapping.
--
-- TikTok CAPI delivery (tiktokDelivery.ts) shipped in Phase 2 without a
-- dedicated click-ID field — matching was IP/UA/PII only. This adds the
-- same field-mapping column already present for fbc/fbp/gclid/wbraid/gbraid
-- so ttclid (captured via the GTM click-ID tag and the Shopify storefront
-- capture script) can flow through the enrichment pipeline into TikTok's
-- Events API `user.ttclid`.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_identity_configs') THEN
    ALTER TABLE client_identity_configs
      ADD COLUMN IF NOT EXISTS ttclid_field TEXT NOT NULL DEFAULT 'ttclid';
  END IF;
END $$;
