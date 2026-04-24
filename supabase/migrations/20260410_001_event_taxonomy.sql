-- ============================================================
-- Atlas: Event Taxonomy & Naming Governance
-- Migration: 20260410_001_event_taxonomy.sql
--
-- Creates:
--   1. event_taxonomy      — hierarchical event registry (system + org-custom)
--   2. naming_conventions  — org-level naming rules (one row per org)
--
-- Modifies:
--   3. signals             — adds taxonomy_event_id + taxonomy_path columns
--
-- RLS pattern: organization_id = auth.uid() (matching existing migrations)
-- System rows have organization_id IS NULL and are readable by all.
-- ============================================================


-- ============================================================
-- TABLE 1: event_taxonomy
-- Hierarchical tree of event categories and specific events.
-- Supports arbitrary nesting via parent_id self-reference.
-- Materialised `path` column enables fast subtree queries.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_taxonomy (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL organization_id = system taxonomy (Atlas-maintained, read-only for users)
  organization_id   UUID        REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Tree structure
  parent_id         UUID        REFERENCES event_taxonomy(id) ON DELETE CASCADE,
  path              TEXT        NOT NULL,           -- Materialised: 'ecommerce/cart/add_to_cart'
  depth             INTEGER     NOT NULL DEFAULT 0, -- 0 = root category, 1 = subcategory, 2 = event

  -- Identity
  slug              TEXT        NOT NULL,           -- URL-safe id: 'add_to_cart'
  name              TEXT        NOT NULL,           -- Display name: 'Add to Cart'
  description       TEXT,
  node_type         TEXT        NOT NULL CHECK (node_type IN ('category', 'event')),
  -- 'category' = grouping node (ecommerce, lead_generation)
  -- 'event'    = leaf node mapping to an actual trackable action

  -- Event-specific fields (only populated when node_type = 'event')
  -- Parameter schema for this event
  -- {
  --   "required": [{ "key": "transaction_id", "label": "Order ID", "type": "string",
  --                  "description": "Unique order identifier", "format": null }],
  --   "optional": [{ "key": "items", "label": "Products", "type": "array",
  --                  "description": "Purchased items", "format": "ga4_items",
  --                  "item_schema": [{ "key": "item_id", "type": "string" }] }]
  -- }
  parameter_schema  JSONB       DEFAULT NULL,

  -- Platform mappings (only for event nodes)
  -- {
  --   "ga4":        { "event_name": "purchase", "param_mapping": {...}, "required_params": [...] },
  --   "meta":       { "event_name": "Purchase", "param_mapping": {...}, "additional_params": {...} },
  --   "google_ads": { "event_name": "conversion", "param_mapping": {...}, "requires_conversion_label": true },
  --   "tiktok":     { "event_name": "CompletePayment", "param_mapping": {...} },
  --   "linkedin":   { "event_name": "conversion", "param_mapping": {...} },
  --   "snapchat":   { "event_name": "PURCHASE", "param_mapping": {...} }
  -- }
  platform_mappings JSONB       DEFAULT NULL,

  -- Funnel metadata
  funnel_stage      TEXT        CHECK (funnel_stage IN (
                                  'awareness', 'consideration', 'conversion', 'retention', 'advocacy'
                                )),

  -- Display
  icon              TEXT,                           -- Lucide icon name for UI display
  display_order     INTEGER     NOT NULL DEFAULT 0, -- Sort order within parent

  -- Governance
  is_system         BOOLEAN     NOT NULL DEFAULT false, -- true = Atlas-maintained, users cannot delete/modify
  is_custom         BOOLEAN     NOT NULL DEFAULT false, -- true = user-created extension
  deprecated        BOOLEAN     NOT NULL DEFAULT false, -- Soft-delete: hidden from new selections

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique path per org (NULL org = system events, unique globally)
  UNIQUE NULLS NOT DISTINCT (organization_id, path),

  -- Event nodes must have a parameter schema
  CONSTRAINT valid_event_has_schema CHECK (
    node_type != 'event' OR parameter_schema IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_org    ON event_taxonomy(organization_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_parent ON event_taxonomy(parent_id);
CREATE INDEX IF NOT EXISTS idx_taxonomy_path   ON event_taxonomy(path);
CREATE INDEX IF NOT EXISTS idx_taxonomy_type   ON event_taxonomy(node_type);
CREATE INDEX IF NOT EXISTS idx_taxonomy_stage  ON event_taxonomy(funnel_stage)
  WHERE funnel_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taxonomy_system ON event_taxonomy(is_system)
  WHERE is_system = true;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_taxonomy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_taxonomy_updated ON event_taxonomy;
CREATE TRIGGER trg_taxonomy_updated
  BEFORE UPDATE ON event_taxonomy
  FOR EACH ROW EXECUTE FUNCTION update_taxonomy_timestamp();


-- ============================================================
-- TABLE 2: naming_conventions
-- Org-level naming rules. One row per organisation.
-- If no row exists for an org, the application uses DEFAULT_CONVENTION.
-- ============================================================

CREATE TABLE IF NOT EXISTS naming_conventions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Case format
  event_case              TEXT        NOT NULL DEFAULT 'snake_case'
                                        CHECK (event_case IN ('snake_case', 'camelCase', 'kebab-case', 'PascalCase')),
  param_case              TEXT        NOT NULL DEFAULT 'snake_case'
                                        CHECK (param_case IN ('snake_case', 'camelCase', 'kebab-case', 'PascalCase')),

  -- Prefix rules (null = no prefix)
  event_prefix            TEXT        DEFAULT NULL, -- e.g., 'atlas_' or 'acme_'
  param_prefix            TEXT        DEFAULT NULL, -- e.g., 'dl_'

  -- Separator (used within snake_case / kebab-case words)
  word_separator          TEXT        NOT NULL DEFAULT '_',

  -- Validation rules
  max_event_name_length   INTEGER     NOT NULL DEFAULT 40,
  max_param_key_length    INTEGER     NOT NULL DEFAULT 40,
  allowed_characters      TEXT        NOT NULL DEFAULT 'a-z0-9_', -- Regex character class (without brackets)

  -- Reserved words — event names that should never be used (overrides GA4 auto-collected events)
  reserved_words          JSONB       NOT NULL DEFAULT '["event","page_view","session_start","first_visit","user_engagement"]'::jsonb,

  -- Auto-generated display examples (updated by application on save)
  example_event           TEXT,       -- e.g., 'acme_add_to_cart'
  example_param           TEXT,       -- e.g., 'dl_transaction_id'

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_naming_convention_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_naming_convention_updated ON naming_conventions;
CREATE TRIGGER trg_naming_convention_updated
  BEFORE UPDATE ON naming_conventions
  FOR EACH ROW EXECUTE FUNCTION update_naming_convention_timestamp();


-- ============================================================
-- MODIFY TABLE 3: signals
-- Add taxonomy reference columns (nullable — fully backwards-compatible).
-- Existing signals without taxonomy links continue to work unchanged.
-- ============================================================

-- Guarded: signals is not created by a migration; skip if it doesn't exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signals') THEN
    EXECUTE $q$
      ALTER TABLE signals
        ADD COLUMN IF NOT EXISTS taxonomy_event_id UUID REFERENCES event_taxonomy(id) ON DELETE SET NULL
    $q$;
    EXECUTE 'ALTER TABLE signals ADD COLUMN IF NOT EXISTS taxonomy_path TEXT';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signals_taxonomy ON signals(taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_signals_taxonomy_path ON signals(taxonomy_path) WHERE taxonomy_path IS NOT NULL';
  END IF;
END $$;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE event_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE naming_conventions ENABLE ROW LEVEL SECURITY;

-- Taxonomy READ: system events (org IS NULL) visible to all authenticated users;
--               org-specific events visible only to the owning org.
CREATE POLICY "taxonomy_select" ON event_taxonomy
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = auth.uid()
  );

-- Taxonomy WRITE: users can only insert/update/delete rows belonging to their own org.
--                System rows (organization_id IS NULL) are protected by this policy —
--                they cannot be written by any user (only via service role migrations).
CREATE POLICY "taxonomy_insert" ON event_taxonomy
  FOR INSERT WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = auth.uid()
  );

CREATE POLICY "taxonomy_update" ON event_taxonomy
  FOR UPDATE USING (
    organization_id IS NOT NULL
    AND organization_id = auth.uid()
    AND is_system = false
  );

CREATE POLICY "taxonomy_delete" ON event_taxonomy
  FOR DELETE USING (
    organization_id IS NOT NULL
    AND organization_id = auth.uid()
    AND is_system = false
  );

-- Naming conventions: strict org isolation
CREATE POLICY "naming_conv_select" ON naming_conventions
  FOR SELECT USING (organization_id = auth.uid());

CREATE POLICY "naming_conv_insert" ON naming_conventions
  FOR INSERT WITH CHECK (organization_id = auth.uid());

CREATE POLICY "naming_conv_update" ON naming_conventions
  FOR UPDATE USING (organization_id = auth.uid());

CREATE POLICY "naming_conv_delete" ON naming_conventions
  FOR DELETE USING (organization_id = auth.uid());
