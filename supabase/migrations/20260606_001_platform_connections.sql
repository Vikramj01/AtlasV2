-- Platform Reconciliation Phase 1: Connection Plumbing
-- Creates the platform_connections table with three connection types
-- (manager, child, standalone) and full RLS.
--
-- FK pattern follows existing Atlas migrations:
--   organization_id → auth.users(id)   (Supabase auth user = org owner)
--   client_id       → plain UUID, no FK (clients table may not exist in preview envs)
--   parent_connection_id → self-referential FK on this table
--
-- oauth_tokens stores an AES-256-GCM encrypted JSON envelope.
-- Child rows carry NULL oauth_tokens — tokens always live on the parent manager row.

CREATE TABLE IF NOT EXISTS platform_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id             UUID,              -- soft ref to clients; no FK (preview env safety)
  platform              TEXT NOT NULL CHECK (platform IN ('google_ads', 'meta', 'ga4', 'gtm_destinations')),
  connection_type       TEXT NOT NULL CHECK (connection_type IN ('manager', 'child', 'standalone')),
  parent_connection_id  UUID REFERENCES platform_connections(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL,
  account_label         TEXT,
  oauth_tokens          TEXT,              -- AES-256-GCM encrypted JSON envelope; NULL for child rows
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'expired', 'revoked', 'error', 'available')),
  last_synced_at        TIMESTAMPTZ,
  last_error            TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, platform, account_id),

  -- Enforce the three-type invariant:
  --   manager:    org-level row, no client, no parent (tokens live here)
  --   child:      per-client row under a manager, no tokens of its own
  --   standalone: per-client row with no parent (tokens live here)
  CONSTRAINT connection_type_invariant CHECK (
    (connection_type = 'manager'    AND parent_connection_id IS NULL     AND client_id IS NULL) OR
    (connection_type = 'child'      AND parent_connection_id IS NOT NULL AND client_id IS NOT NULL) OR
    (connection_type = 'standalone' AND parent_connection_id IS NULL     AND client_id IS NOT NULL)
  )
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_platform_connections_client
  ON platform_connections (client_id, platform)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_connections_parent
  ON platform_connections (parent_connection_id)
  WHERE parent_connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_connections_manager
  ON platform_connections (organization_id, platform)
  WHERE connection_type = 'manager';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own org connections"
  ON platform_connections
  FOR ALL
  USING (organization_id = auth.uid());
