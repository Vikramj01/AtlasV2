-- ============================================================
-- Client Identity Configs
-- Client-level dataLayer field path mapping for identity
-- enrichment (email, phone, click IDs, address fields).
-- One row per client, shared across all CAPI providers.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_identity_configs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,

  -- Identity field paths (dataLayer variable names / cookie names)
  -- null  = field not configured
  -- 'auto' = read from HTTP request headers (ip, ua only)
  email_field       TEXT,
  phone_field       TEXT,
  first_name_field  TEXT,
  last_name_field   TEXT,
  postal_code_field TEXT,
  country_field     TEXT,
  external_id_field TEXT,

  -- Click IDs — default to standard cookie/param names
  fbc_field    TEXT NOT NULL DEFAULT '_fbc',
  fbp_field    TEXT NOT NULL DEFAULT '_fbp',
  gclid_field  TEXT NOT NULL DEFAULT 'gclid',
  wbraid_field TEXT NOT NULL DEFAULT 'wbraid',
  gbraid_field TEXT NOT NULL DEFAULT 'gbraid',

  -- Auto-capture from request context
  auto_capture_ip BOOLEAN NOT NULL DEFAULT true,
  auto_capture_ua BOOLEAN NOT NULL DEFAULT true,

  -- Which identifiers are sent even when mapped
  enabled_identifiers TEXT[] NOT NULL DEFAULT
    ARRAY['email', 'phone', 'fbp', 'fbc', 'gclid', 'client_ip_address', 'client_user_agent'],

  -- Validation
  validated_at   TIMESTAMPTZ,
  identity_score INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_identity_client ON client_identity_configs(client_id);

ALTER TABLE client_identity_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members access identity configs"
  ON client_identity_configs
  FOR ALL
  USING (
    client_id IN (
      SELECT c.id FROM clients c
      JOIN organisation_members om ON om.organisation_id = c.organisation_id
      WHERE om.user_id = auth.uid()
    )
  );
