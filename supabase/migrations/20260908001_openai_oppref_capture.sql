-- Add oppref (OpenAI/ChatGPT Ads click reference) support to client identity mapping.
--
-- ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part A (A-W2) — gives oppref a first-class
-- field on the CAPI event, replacing the user_data.external_id workaround
-- openaiDelivery.ts previously used. Same field-mapping column already
-- present for fbc/fbp/gclid/wbraid/gbraid/ttclid (migration 20260902001's
-- ttclid_field is the direct precedent) so oppref (captured via OpenAI's own
-- pixel into the first-party __oppref cookie, or a GTM/Shopify equivalent)
-- can flow through the enrichment pipeline into OAIQ's Conversions API.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'client_identity_configs') THEN
    ALTER TABLE client_identity_configs
      ADD COLUMN IF NOT EXISTS oppref_field TEXT NOT NULL DEFAULT '__oppref';
  END IF;
END $$;
