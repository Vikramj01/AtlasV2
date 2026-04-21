-- Sprint 3: CAPI provider credentials v2
-- Adds Data Processing Options (DPO) columns for Meta CCPA/LDU compliance.
-- These are top-level columns (not inside the encrypted credentials blob) so
-- they can be read by the pipeline without decrypting credentials.
--
-- DPO reference:
--   https://developers.facebook.com/docs/marketing-api/data-processing-options

ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS data_processing_options       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS data_processing_options_country INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_processing_options_state   INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN capi_providers.data_processing_options
  IS 'Meta Data Processing Options array, e.g. [''LDU''] for Limited Data Use (CCPA). Empty array = no restriction.';

COMMENT ON COLUMN capi_providers.data_processing_options_country
  IS 'Meta DPO country code. 0 = use geolocation. 1 = US.';

COMMENT ON COLUMN capi_providers.data_processing_options_state
  IS 'Meta DPO state code. 0 = use geolocation. 1000 = California.';
