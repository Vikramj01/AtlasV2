-- ============================================================
-- Patch system signal platform_mappings to include
-- identity_fields arrays for purchase, begin_checkout,
-- generate_lead, and sign_up.
-- identity_fields controls which client identity config
-- fields are included when processing CAPI events for
-- each signal + platform combination.
-- ============================================================

-- purchase → Meta (full identity set for value-based bidding)
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "meta": {
    "event_name": "Purchase",
    "param_mapping": {
      "transaction_id": "order_id",
      "value": "value",
      "currency": "currency",
      "items": "content_ids"
    },
    "identity_fields": [
      "email", "phone", "fbp", "fbc", "external_id",
      "first_name", "last_name", "postal_code", "country",
      "client_ip_address", "client_user_agent"
    ],
    "additional": { "content_type": "product" }
  }
}'::jsonb
WHERE key = 'purchase' AND is_system = true;

-- purchase → Google (enhanced conversions identity set)
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "google": {
    "event_name": "conversion",
    "param_mapping": {
      "transaction_id": "order_id",
      "value": "value",
      "currency": "currency"
    },
    "identity_fields": [
      "email", "phone", "first_name", "last_name",
      "postal_code", "country", "gclid"
    ],
    "additional": {
      "send_to": "{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"
    }
  }
}'::jsonb
WHERE key = 'purchase' AND is_system = true;

-- generate_lead → Google (add identity fields; Meta already has some)
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "google": {
    "event_name": "conversion",
    "param_mapping": { "value": "value", "currency": "currency" },
    "identity_fields": [
      "email", "phone", "first_name", "last_name",
      "postal_code", "country", "gclid"
    ],
    "additional": {
      "send_to": "{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"
    }
  }
}'::jsonb
WHERE key = 'generate_lead' AND is_system = true;

-- begin_checkout → Meta
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "meta": {
    "event_name": "InitiateCheckout",
    "param_mapping": {
      "value": "value",
      "currency": "currency",
      "items": "content_ids"
    },
    "identity_fields": [
      "email", "phone", "fbp", "fbc",
      "client_ip_address", "client_user_agent"
    ],
    "additional": { "content_type": "product" }
  }
}'::jsonb
WHERE key = 'begin_checkout' AND is_system = true;

-- begin_checkout → Google
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "google": {
    "event_name": "conversion",
    "param_mapping": { "value": "value", "currency": "currency" },
    "identity_fields": [
      "email", "phone", "first_name", "last_name",
      "postal_code", "country", "gclid"
    ],
    "additional": {
      "send_to": "{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"
    }
  }
}'::jsonb
WHERE key = 'begin_checkout' AND is_system = true;

-- sign_up → Meta
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "meta": {
    "event_name": "CompleteRegistration",
    "param_mapping": { "value": "value", "currency": "currency" },
    "identity_fields": [
      "email", "phone", "fbp", "fbc",
      "client_ip_address", "client_user_agent"
    ],
    "additional": {}
  }
}'::jsonb
WHERE key = 'sign_up' AND is_system = true;

-- sign_up → Google
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "google": {
    "event_name": "conversion",
    "param_mapping": { "value": "value", "currency": "currency" },
    "identity_fields": [
      "email", "phone", "first_name", "last_name",
      "postal_code", "country", "gclid"
    ],
    "additional": {
      "send_to": "{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"
    }
  }
}'::jsonb
WHERE key = 'sign_up' AND is_system = true;
