# Atlas: Event Taxonomy & Naming Governance — Signal Library Enhancement PRD

> **Status**: Ready for build | **Priority**: HIGH | **Date**: April 2026
> **Repo**: `github.com/Vikramj01/AtlasV2` (private)
> **Parent module**: Signal Library (existing)
> **Estimated effort**: 3–4 weeks

---

## 0. Read This First

### What This Enhancement Does

Adds three connected governance layers to the existing Signal Library:

1. **Event Taxonomy** — A hierarchical classification system that organises all signals into categories, subcategories, and specific actions. Ships with a comprehensive default taxonomy based on GA4 recommended events. Agencies can customise it per org.

2. **Naming Convention Engine** — Enforces consistent naming rules (case format, prefixes, separators) across every place in Atlas where an event name is created or referenced. Validates in real time and auto-suggests corrections.

3. **Parameter Schemas** — Each event in the taxonomy has a defined set of required and optional parameters with types, formats, and validation rules. Every output Atlas generates (GTM containers, dataLayer specs, CAPI mappings) uses these schemas as the source of truth.

Together, these turn the Signal Library from a flat catalogue of signals into a **governed, hierarchical, platform-aware event registry** that enforces consistency from planning through implementation through platform delivery.

### Why This Matters for Campaign Performance

Meta's Andromeda 2 and Google's PMax build audience models from the events they receive. If the same business action (e.g., adding an item to a cart) arrives as three different event names (`add_to_cart`, `addToCart`, `cart_add`), the platform treats them as three separate, low-volume events instead of one high-volume event with strong signal. This fragments the learning data and degrades optimisation.

Consistent naming also eliminates the manual event mapping step in the CAPI module. If every event follows the taxonomy and carries platform mappings, the CAPI setup wizard's "Map Events" step becomes a confirmation rather than a configuration.

### How It Fits Into Existing Architecture

This is NOT a new module. It enhances the existing Signal Library and propagates rules into Planning Mode, Journey Builder, CAPI Module, and output generators. The key changes:

- **`signals` table**: Add `taxonomy_path`, `parameter_schema`, and enhanced `platform_mappings`
- **New table**: `event_taxonomy` — the hierarchical tree of categories/events
- **New table**: `naming_conventions` — org-level naming rules
- **Modified service**: Signal creation/validation across all entry points
- **Modified UI**: Signal Library page gains a tree view, search, and naming validation

### Actual Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | **Vite + React 19 + React Router v6** |
| Backend | **Express.js** in `backend/src/` |
| State | **Zustand** in `frontend/src/store/` |
| UI | **shadcn/ui** components |
| Database | **Supabase** (PostgreSQL) |
| Auth | **Supabase Auth** — JWT Bearer token |

### Key Existing Files

```
# Signal Library — files you WILL modify
backend/src/services/database/signalQueries.ts    — Signal CRUD queries (or equivalent)
frontend/src/pages/SignalLibraryPage.tsx           — Signal Library page (or equivalent)
frontend/src/components/signals/                   — Signal-related components

# Existing schema to extend
# Table: signals (has key, name, description, category, required_params, optional_params, platform_mappings)
# Table: signal_packs, signal_pack_signals, deployments, client_outputs

# Planning Mode — files that consume signals
backend/src/services/planning/                     — AI recommendation engine
# The Planning Mode AI prompt that recommends trackable elements — update to use taxonomy

# Journey Builder — files that reference signals
backend/src/services/journeys/                     — Journey definition and audit
frontend/src/components/journey/                   — Journey builder UI

# CAPI Module — files that map signals to platforms
backend/src/services/capi/                         — Event mapping logic
frontend/src/components/capi/                      — CAPI setup wizard

# Output generators
backend/src/services/generators/                   — GTM container, dataLayer spec, WalkerOS generators
```

### Build Order

```
Task 1: Database migration (taxonomy + naming tables, signals table changes) ... ~2 days
Task 2: Default taxonomy seed data .......................................... ~2 days
Task 3: Naming convention engine (backend validation service) ............... ~3 days
Task 4: Taxonomy API endpoints .............................................. ~2 days
Task 5: Signal Library UI — tree view + hierarchy ........................... ~4 days
Task 6: Naming validation integration (all signal creation points) .......... ~3 days
Task 7: Parameter schema enforcement in output generators ................... ~3 days
Task 8: Planning Mode integration (AI uses taxonomy for recommendations) .... ~2 days
Task 9: CAPI auto-mapping from taxonomy ..................................... ~2 days
```

---

## 1. Database Schema

### 1.1 New Table: `event_taxonomy`

The hierarchical tree of event categories and specific events. Supports arbitrary nesting depth using a `parent_id` self-reference and a materialised `path` for fast queries.

Create migration file: `supabase/migrations/20260410_001_event_taxonomy.sql`

```sql
-- ============================================================
-- EVENT TAXONOMY
-- ============================================================

CREATE TABLE event_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL organization_id = system taxonomy (ships with Atlas, read-only for users)

  -- Tree structure
  parent_id UUID REFERENCES event_taxonomy(id) ON DELETE CASCADE,
  path TEXT NOT NULL,                              -- Materialised path: 'ecommerce/cart/add_to_cart'
  depth INTEGER NOT NULL DEFAULT 0,                -- 0 = root category, 1 = subcategory, 2 = event, etc.

  -- Identity
  slug TEXT NOT NULL,                              -- URL-safe identifier: 'add_to_cart'
  name TEXT NOT NULL,                              -- Display name: 'Add to Cart'
  description TEXT,                                -- Business description
  node_type TEXT NOT NULL CHECK (node_type IN ('category', 'event')),
  -- 'category' = grouping node (ecommerce, lead_generation)
  -- 'event' = leaf node that maps to an actual trackable action

  -- Event-specific fields (only populated when node_type = 'event')
  -- Parameter schema for this event
  parameter_schema JSONB DEFAULT NULL,
  -- Structure:
  -- {
  --   "required": [
  --     { "key": "transaction_id", "label": "Order ID", "type": "string", "description": "Unique order identifier", "format": null },
  --     { "key": "value", "label": "Order Total", "type": "number", "description": "Total transaction value", "format": "currency" },
  --     { "key": "currency", "label": "Currency", "type": "string", "description": "ISO 4217 currency code", "format": "iso_4217" }
  --   ],
  --   "optional": [
  --     { "key": "items", "label": "Products", "type": "array", "description": "Array of purchased items", "format": "ga4_items",
  --       "item_schema": [
  --         { "key": "item_id", "type": "string" },
  --         { "key": "item_name", "type": "string" },
  --         { "key": "quantity", "type": "integer" },
  --         { "key": "price", "type": "number" }
  --       ]
  --     },
  --     { "key": "tax", "label": "Tax", "type": "number", "description": "Tax amount", "format": "currency" },
  --     { "key": "shipping", "label": "Shipping", "type": "number", "description": "Shipping cost", "format": "currency" },
  --     { "key": "coupon", "label": "Coupon Code", "type": "string", "description": "Applied coupon code", "format": null }
  --   ]
  -- }

  -- Platform mappings (only for event nodes)
  platform_mappings JSONB DEFAULT NULL,
  -- Structure:
  -- {
  --   "ga4": {
  --     "event_name": "purchase",
  --     "param_mapping": { "transaction_id": "transaction_id", "value": "value", "currency": "currency", "items": "items" },
  --     "required_params": ["transaction_id", "value", "currency"]
  --   },
  --   "meta": {
  --     "event_name": "Purchase",
  --     "param_mapping": { "transaction_id": "order_id", "value": "value", "currency": "currency", "items": "content_ids" },
  --     "additional_params": { "content_type": "product" },
  --     "required_params": ["value", "currency"]
  --   },
  --   "google_ads": {
  --     "event_name": "conversion",
  --     "param_mapping": { "transaction_id": "transaction_id", "value": "value", "currency": "currency" },
  --     "requires_conversion_label": true
  --   },
  --   "tiktok": {
  --     "event_name": "CompletePayment",
  --     "param_mapping": { "transaction_id": "order_id", "value": "value", "currency": "currency", "items": "contents" }
  --   },
  --   "linkedin": {
  --     "event_name": "conversion",
  --     "param_mapping": { "value": "conversionValue", "currency": "currency" }
  --   },
  --   "snapchat": {
  --     "event_name": "PURCHASE",
  --     "param_mapping": { "transaction_id": "transaction_id", "value": "price", "currency": "currency" }
  --   }
  -- }

  -- Funnel metadata
  funnel_stage TEXT CHECK (funnel_stage IN (
    'awareness', 'consideration', 'conversion', 'retention', 'advocacy'
  )),

  -- Display
  icon TEXT,                                       -- Lucide icon name for UI display
  display_order INTEGER NOT NULL DEFAULT 0,        -- Sort order within parent

  -- Governance
  is_system BOOLEAN NOT NULL DEFAULT false,        -- true = Atlas-maintained, users cannot delete
  is_custom BOOLEAN NOT NULL DEFAULT false,        -- true = user-created extension
  deprecated BOOLEAN NOT NULL DEFAULT false,       -- Soft-delete: hidden from new selections but preserved for existing usage

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  UNIQUE(organization_id, path),                   -- Unique path per org (or globally for system events)
  CONSTRAINT valid_event_has_schema CHECK (
    node_type != 'event' OR parameter_schema IS NOT NULL
  )
);

CREATE INDEX idx_taxonomy_org ON event_taxonomy(organization_id);
CREATE INDEX idx_taxonomy_parent ON event_taxonomy(parent_id);
CREATE INDEX idx_taxonomy_path ON event_taxonomy(path);
CREATE INDEX idx_taxonomy_type ON event_taxonomy(node_type);
CREATE INDEX idx_taxonomy_stage ON event_taxonomy(funnel_stage) WHERE funnel_stage IS NOT NULL;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_taxonomy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_taxonomy_updated
  BEFORE UPDATE ON event_taxonomy
  FOR EACH ROW EXECUTE FUNCTION update_taxonomy_timestamp();
```

### 1.2 New Table: `naming_conventions`

Org-level naming rules. One row per organisation.

```sql
CREATE TABLE naming_conventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- Case format
  event_case TEXT NOT NULL DEFAULT 'snake_case'
    CHECK (event_case IN ('snake_case', 'camelCase', 'kebab-case', 'PascalCase')),
  param_case TEXT NOT NULL DEFAULT 'snake_case'
    CHECK (param_case IN ('snake_case', 'camelCase', 'kebab-case', 'PascalCase')),

  -- Prefix rules
  event_prefix TEXT DEFAULT NULL,                  -- e.g., 'atlas_' or 'acme_' — prepended to all event names
  param_prefix TEXT DEFAULT NULL,                  -- e.g., 'dl_' — prepended to all dataLayer parameter keys

  -- Separator (for compound words within snake_case/kebab-case)
  word_separator TEXT NOT NULL DEFAULT '_',

  -- Validation rules
  max_event_name_length INTEGER NOT NULL DEFAULT 40,
  max_param_key_length INTEGER NOT NULL DEFAULT 40,
  allowed_characters TEXT NOT NULL DEFAULT 'a-z0-9_',  -- Regex character class (without brackets)

  -- Reserved words (event names that should never be used)
  reserved_words JSONB NOT NULL DEFAULT '["event", "page_view", "session_start", "first_visit", "user_engagement"]'::jsonb,
  -- GA4 auto-collected events that shouldn't be overridden

  -- Display
  example_event TEXT,                              -- Auto-generated example: 'acme_add_to_cart'
  example_param TEXT,                              -- Auto-generated example: 'dl_transaction_id'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 1.3 Modify Existing `signals` Table

Add columns to link signals to the taxonomy:

```sql
-- Add taxonomy reference to existing signals table
ALTER TABLE signals ADD COLUMN taxonomy_event_id UUID REFERENCES event_taxonomy(id) ON DELETE SET NULL;
ALTER TABLE signals ADD COLUMN taxonomy_path TEXT;  -- Denormalised for display: 'ecommerce/cart/add_to_cart'

-- Index for taxonomy lookups
CREATE INDEX idx_signals_taxonomy ON signals(taxonomy_event_id) WHERE taxonomy_event_id IS NOT NULL;
CREATE INDEX idx_signals_taxonomy_path ON signals(taxonomy_path) WHERE taxonomy_path IS NOT NULL;
```

The existing `key`, `name`, `category`, `required_params`, `optional_params`, and `platform_mappings` columns remain for backwards compatibility. The taxonomy provides the authoritative definitions; these existing columns are either populated from the taxonomy on creation or left as overrides for custom signals.

### 1.4 RLS Policies

```sql
ALTER TABLE event_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE naming_conventions ENABLE ROW LEVEL SECURITY;

-- Taxonomy: users can see system events (org_id IS NULL) + their own org's events
CREATE POLICY "taxonomy_read" ON event_taxonomy
  FOR SELECT USING (
    organization_id IS NULL  -- system events visible to all
    OR organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Taxonomy: users can only insert/update/delete their own org's events
CREATE POLICY "taxonomy_write" ON event_taxonomy
  FOR ALL USING (
    organization_id IS NOT NULL
    AND organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Naming conventions: org-level isolation
CREATE POLICY "naming_conv_isolation" ON naming_conventions
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );
```

---

## 2. Default Taxonomy Seed Data

### 2.1 Seed File

Create: `supabase/seed/event_taxonomy_seed.sql`

This seeds the system taxonomy (`organization_id = NULL`, `is_system = true`). Users cannot modify or delete these entries — they can only extend the taxonomy with custom entries under their own org.

```sql
-- ============================================================
-- SYSTEM EVENT TAXONOMY
-- Based on GA4 recommended events + Meta standard events
-- ============================================================

-- ─── ROOT CATEGORIES ───

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, icon, display_order, is_system)
VALUES
  ('11111111-0000-0000-0000-000000000001', NULL, NULL, 'ecommerce', 0, 'ecommerce', 'Ecommerce', 'Online shopping and transaction events', 'category', NULL, 'ShoppingCart', 1, true),
  ('11111111-0000-0000-0000-000000000002', NULL, NULL, 'lead_generation', 0, 'lead_generation', 'Lead Generation', 'Lead capture and qualification events', 'category', NULL, 'UserPlus', 2, true),
  ('11111111-0000-0000-0000-000000000003', NULL, NULL, 'engagement', 0, 'engagement', 'Engagement', 'Content interaction and engagement events', 'category', NULL, 'MousePointerClick', 3, true),
  ('11111111-0000-0000-0000-000000000004', NULL, NULL, 'account', 0, 'account', 'Account', 'User registration and authentication events', 'category', NULL, 'User', 4, true),
  ('11111111-0000-0000-0000-000000000005', NULL, NULL, 'content', 0, 'content', 'Content', 'Content consumption and media events', 'category', NULL, 'FileText', 5, true);

-- ─── ECOMMERCE SUBCATEGORIES ───

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, display_order, is_system)
VALUES
  ('22222222-0000-0000-0000-000000000001', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/product', 1, 'product', 'Product', 'Product browsing events', 'category', 1, true),
  ('22222222-0000-0000-0000-000000000002', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/cart', 1, 'cart', 'Cart', 'Shopping cart events', 'category', 2, true),
  ('22222222-0000-0000-0000-000000000003', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/checkout', 1, 'checkout', 'Checkout', 'Checkout funnel events', 'category', 3, true),
  ('22222222-0000-0000-0000-000000000004', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/promotion', 1, 'promotion', 'Promotion', 'Promotional interaction events', 'category', 4, true);

-- ─── LEAD GENERATION SUBCATEGORIES ───

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, display_order, is_system)
VALUES
  ('22222222-0000-0000-0000-000000000005', NULL, '11111111-0000-0000-0000-000000000002', 'lead_generation/form', 1, 'form', 'Forms', 'Form interaction events', 'category', 1, true),
  ('22222222-0000-0000-0000-000000000006', NULL, '11111111-0000-0000-0000-000000000002', 'lead_generation/contact', 1, 'contact', 'Contact', 'Direct contact events', 'category', 2, true),
  ('22222222-0000-0000-0000-000000000007', NULL, '11111111-0000-0000-0000-000000000002', 'lead_generation/download', 1, 'download', 'Download', 'Content download events', 'category', 3, true);

-- ─── ENGAGEMENT SUBCATEGORIES ───

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, display_order, is_system)
VALUES
  ('22222222-0000-0000-0000-000000000008', NULL, '11111111-0000-0000-0000-000000000003', 'engagement/interaction', 1, 'interaction', 'Interaction', 'User interaction events', 'category', 1, true),
  ('22222222-0000-0000-0000-000000000009', NULL, '11111111-0000-0000-0000-000000000003', 'engagement/navigation', 1, 'navigation', 'Navigation', 'Site navigation events', 'category', 2, true);

-- ─── CONTENT SUBCATEGORIES ───

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, display_order, is_system)
VALUES
  ('22222222-0000-0000-0000-000000000010', NULL, '11111111-0000-0000-0000-000000000005', 'content/media', 1, 'media', 'Media', 'Video and audio events', 'category', 1, true),
  ('22222222-0000-0000-0000-000000000011', NULL, '11111111-0000-0000-0000-000000000005', 'content/article', 1, 'article', 'Article', 'Article and blog events', 'category', 2, true);


-- ═══════════════════════════════════════════════════════════
-- EVENT NODES (leaf nodes with parameter schemas + platform mappings)
-- ═══════════════════════════════════════════════════════════

-- ─── ECOMMERCE / PRODUCT ───

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings)
VALUES

(NULL, '22222222-0000-0000-0000-000000000001', 'ecommerce/product/view_item', 2, 'view_item', 'View Item', 'User views a product detail page', 'event', 'consideration', 1, true,
  '{
    "required": [
      { "key": "item_id", "label": "Product ID", "type": "string", "description": "Unique product identifier (SKU or internal ID)", "format": null },
      { "key": "item_name", "label": "Product Name", "type": "string", "description": "Product display name", "format": null }
    ],
    "optional": [
      { "key": "value", "label": "Price", "type": "number", "description": "Product price", "format": "currency" },
      { "key": "currency", "label": "Currency", "type": "string", "description": "ISO 4217 currency code", "format": "iso_4217" },
      { "key": "item_brand", "label": "Brand", "type": "string", "description": "Product brand", "format": null },
      { "key": "item_category", "label": "Category", "type": "string", "description": "Product category", "format": null },
      { "key": "item_variant", "label": "Variant", "type": "string", "description": "Product variant (e.g., colour, size)", "format": null }
    ]
  }'::jsonb,
  '{
    "ga4": { "event_name": "view_item", "param_mapping": { "item_id": "items[0].item_id", "item_name": "items[0].item_name", "value": "value", "currency": "currency" }, "required_params": ["items"] },
    "meta": { "event_name": "ViewContent", "param_mapping": { "item_id": "content_ids[0]", "item_name": "content_name", "value": "value", "currency": "currency" }, "additional_params": { "content_type": "product" } },
    "google_ads": { "event_name": "view_item", "param_mapping": { "value": "value", "currency": "currency" } },
    "tiktok": { "event_name": "ViewContent", "param_mapping": { "item_id": "content_id", "value": "value", "currency": "currency" } },
    "linkedin": { "event_name": "conversion", "param_mapping": {} },
    "snapchat": { "event_name": "VIEW_CONTENT", "param_mapping": { "item_id": "item_ids[0]", "value": "price", "currency": "currency" } }
  }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000001', 'ecommerce/product/view_item_list', 2, 'view_item_list', 'View Item List', 'User views a product listing or category page', 'event', 'awareness', 2, true,
  '{
    "required": [
      { "key": "item_list_id", "label": "List ID", "type": "string", "description": "Unique identifier for the product list", "format": null },
      { "key": "item_list_name", "label": "List Name", "type": "string", "description": "Name of the product list (e.g., Search Results, Category: Shoes)", "format": null }
    ],
    "optional": [
      { "key": "items", "label": "Products", "type": "array", "description": "Array of products displayed", "format": "ga4_items" }
    ]
  }'::jsonb,
  '{
    "ga4": { "event_name": "view_item_list", "param_mapping": { "item_list_id": "item_list_id", "item_list_name": "item_list_name", "items": "items" } },
    "meta": { "event_name": "ViewContent", "param_mapping": { "item_list_name": "content_name" }, "additional_params": { "content_type": "product_group" } },
    "google_ads": { "event_name": "view_item_list", "param_mapping": {} },
    "tiktok": { "event_name": "ViewContent", "param_mapping": {} },
    "linkedin": { "event_name": "conversion", "param_mapping": {} },
    "snapchat": { "event_name": "VIEW_CONTENT", "param_mapping": {} }
  }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000001', 'ecommerce/product/select_item', 2, 'select_item', 'Select Item', 'User clicks on a product from a list', 'event', 'consideration', 3, true,
  '{ "required": [{ "key": "item_id", "label": "Product ID", "type": "string", "description": "Selected product identifier", "format": null }], "optional": [{ "key": "item_list_name", "label": "Source List", "type": "string", "description": "Which list the product was selected from", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "select_item", "param_mapping": { "item_id": "items[0].item_id" } }, "meta": { "event_name": "ViewContent", "param_mapping": { "item_id": "content_ids[0]" } }, "google_ads": { "event_name": "select_item", "param_mapping": {} }, "tiktok": { "event_name": "ClickButton", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "VIEW_CONTENT", "param_mapping": {} } }'::jsonb
),

-- ─── ECOMMERCE / CART ───

(NULL, '22222222-0000-0000-0000-000000000002', 'ecommerce/cart/add_to_cart', 2, 'add_to_cart', 'Add to Cart', 'User adds a product to their shopping cart', 'event', 'consideration', 1, true,
  '{
    "required": [
      { "key": "item_id", "label": "Product ID", "type": "string", "description": "Product being added", "format": null },
      { "key": "value", "label": "Cart Value", "type": "number", "description": "Value of items added", "format": "currency" },
      { "key": "currency", "label": "Currency", "type": "string", "description": "ISO 4217 currency code", "format": "iso_4217" }
    ],
    "optional": [
      { "key": "item_name", "label": "Product Name", "type": "string", "description": "Product display name", "format": null },
      { "key": "quantity", "label": "Quantity", "type": "integer", "description": "Number of items added", "format": null }
    ]
  }'::jsonb,
  '{
    "ga4": { "event_name": "add_to_cart", "param_mapping": { "item_id": "items[0].item_id", "value": "value", "currency": "currency" }, "required_params": ["items", "value", "currency"] },
    "meta": { "event_name": "AddToCart", "param_mapping": { "item_id": "content_ids[0]", "value": "value", "currency": "currency" }, "additional_params": { "content_type": "product" }, "required_params": ["value", "currency"] },
    "google_ads": { "event_name": "add_to_cart", "param_mapping": { "value": "value", "currency": "currency" } },
    "tiktok": { "event_name": "AddToCart", "param_mapping": { "item_id": "content_id", "value": "value", "currency": "currency" } },
    "linkedin": { "event_name": "conversion", "param_mapping": { "value": "conversionValue" } },
    "snapchat": { "event_name": "ADD_CART", "param_mapping": { "item_id": "item_ids[0]", "value": "price", "currency": "currency" } }
  }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000002', 'ecommerce/cart/remove_from_cart', 2, 'remove_from_cart', 'Remove from Cart', 'User removes a product from their cart', 'event', 'consideration', 2, true,
  '{ "required": [{ "key": "item_id", "label": "Product ID", "type": "string", "description": "Product being removed", "format": null }], "optional": [{ "key": "value", "label": "Value", "type": "number", "description": "Value of removed items", "format": "currency" }] }'::jsonb,
  '{ "ga4": { "event_name": "remove_from_cart", "param_mapping": { "item_id": "items[0].item_id" } }, "meta": { "event_name": "CustomEvent", "param_mapping": {}, "custom_event_name": "RemoveFromCart" }, "google_ads": { "event_name": "remove_from_cart", "param_mapping": {} }, "tiktok": { "event_name": "CustomEvent", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000002', 'ecommerce/cart/view_cart', 2, 'view_cart', 'View Cart', 'User views their shopping cart', 'event', 'consideration', 3, true,
  '{ "required": [{ "key": "value", "label": "Cart Value", "type": "number", "description": "Total cart value", "format": "currency" }, { "key": "currency", "label": "Currency", "type": "string", "description": "ISO 4217", "format": "iso_4217" }], "optional": [{ "key": "items", "label": "Products", "type": "array", "description": "Cart contents", "format": "ga4_items" }] }'::jsonb,
  '{ "ga4": { "event_name": "view_cart", "param_mapping": { "value": "value", "currency": "currency", "items": "items" } }, "meta": { "event_name": "CustomEvent", "param_mapping": {}, "custom_event_name": "ViewCart" }, "google_ads": { "event_name": "view_cart", "param_mapping": {} }, "tiktok": { "event_name": "ViewContent", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "VIEW_CONTENT", "param_mapping": {} } }'::jsonb
),

-- ─── ECOMMERCE / CHECKOUT ───

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/begin_checkout', 2, 'begin_checkout', 'Begin Checkout', 'User initiates the checkout process', 'event', 'conversion', 1, true,
  '{ "required": [{ "key": "value", "label": "Checkout Value", "type": "number", "description": "Total checkout value", "format": "currency" }, { "key": "currency", "label": "Currency", "type": "string", "description": "ISO 4217", "format": "iso_4217" }], "optional": [{ "key": "items", "label": "Products", "type": "array", "description": "Products in checkout", "format": "ga4_items" }, { "key": "coupon", "label": "Coupon", "type": "string", "description": "Applied coupon code", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "begin_checkout", "param_mapping": { "value": "value", "currency": "currency" } }, "meta": { "event_name": "InitiateCheckout", "param_mapping": { "value": "value", "currency": "currency" }, "additional_params": { "content_type": "product" } }, "google_ads": { "event_name": "begin_checkout", "param_mapping": { "value": "value", "currency": "currency" } }, "tiktok": { "event_name": "InitiateCheckout", "param_mapping": { "value": "value", "currency": "currency" } }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "START_CHECKOUT", "param_mapping": { "value": "price", "currency": "currency" } } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/add_payment_info', 2, 'add_payment_info', 'Add Payment Info', 'User submits payment information', 'event', 'conversion', 2, true,
  '{ "required": [{ "key": "payment_type", "label": "Payment Method", "type": "string", "description": "e.g., credit_card, paypal, apple_pay", "format": null }], "optional": [{ "key": "value", "label": "Value", "type": "number", "description": "Order value", "format": "currency" }] }'::jsonb,
  '{ "ga4": { "event_name": "add_payment_info", "param_mapping": { "payment_type": "payment_type", "value": "value" } }, "meta": { "event_name": "AddPaymentInfo", "param_mapping": { "value": "value", "currency": "currency" } }, "google_ads": { "event_name": "add_payment_info", "param_mapping": {} }, "tiktok": { "event_name": "AddPaymentInfo", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "ADD_BILLING", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/purchase', 2, 'purchase', 'Purchase', 'A transaction is completed', 'event', 'conversion', 3, true,
  '{
    "required": [
      { "key": "transaction_id", "label": "Order ID", "type": "string", "description": "Unique order/transaction identifier", "format": null },
      { "key": "value", "label": "Order Total", "type": "number", "description": "Total transaction value (excluding tax and shipping if tracked separately)", "format": "currency" },
      { "key": "currency", "label": "Currency", "type": "string", "description": "ISO 4217 currency code", "format": "iso_4217" }
    ],
    "optional": [
      { "key": "items", "label": "Products", "type": "array", "description": "Array of purchased items", "format": "ga4_items" },
      { "key": "tax", "label": "Tax", "type": "number", "description": "Tax amount", "format": "currency" },
      { "key": "shipping", "label": "Shipping", "type": "number", "description": "Shipping cost", "format": "currency" },
      { "key": "coupon", "label": "Coupon", "type": "string", "description": "Applied coupon code", "format": null }
    ]
  }'::jsonb,
  '{
    "ga4": { "event_name": "purchase", "param_mapping": { "transaction_id": "transaction_id", "value": "value", "currency": "currency", "items": "items", "tax": "tax", "shipping": "shipping", "coupon": "coupon" }, "required_params": ["transaction_id", "value", "currency"] },
    "meta": { "event_name": "Purchase", "param_mapping": { "transaction_id": "order_id", "value": "value", "currency": "currency", "items": "content_ids" }, "additional_params": { "content_type": "product" }, "required_params": ["value", "currency"] },
    "google_ads": { "event_name": "conversion", "param_mapping": { "transaction_id": "transaction_id", "value": "value", "currency": "currency" }, "requires_conversion_label": true },
    "tiktok": { "event_name": "CompletePayment", "param_mapping": { "transaction_id": "order_id", "value": "value", "currency": "currency", "items": "contents" } },
    "linkedin": { "event_name": "conversion", "param_mapping": { "value": "conversionValue", "currency": "currency" } },
    "snapchat": { "event_name": "PURCHASE", "param_mapping": { "transaction_id": "transaction_id", "value": "price", "currency": "currency" } }
  }'::jsonb
),

-- ─── LEAD GENERATION / FORM ───

(NULL, '22222222-0000-0000-0000-000000000005', 'lead_generation/form/form_start', 2, 'form_start', 'Form Start', 'User begins interacting with a form (first field focus)', 'event', 'consideration', 1, true,
  '{ "required": [{ "key": "form_id", "label": "Form ID", "type": "string", "description": "Unique form identifier", "format": null }], "optional": [{ "key": "form_name", "label": "Form Name", "type": "string", "description": "Form display name", "format": null }, { "key": "form_type", "label": "Form Type", "type": "string", "description": "e.g., contact, quote, demo_request", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "form_start", "param_mapping": { "form_id": "form_id", "form_name": "form_name" } }, "meta": { "event_name": "CustomEvent", "param_mapping": {}, "custom_event_name": "FormStart" }, "google_ads": { "event_name": "form_start", "param_mapping": {} }, "tiktok": { "event_name": "ClickButton", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000005', 'lead_generation/form/form_submit', 2, 'form_submit', 'Form Submit', 'User successfully submits a form (lead captured)', 'event', 'conversion', 2, true,
  '{ "required": [{ "key": "form_id", "label": "Form ID", "type": "string", "description": "Unique form identifier", "format": null }], "optional": [{ "key": "form_name", "label": "Form Name", "type": "string", "description": "Form display name", "format": null }, { "key": "form_type", "label": "Form Type", "type": "string", "description": "e.g., contact, quote, demo_request", "format": null }, { "key": "value", "label": "Lead Value", "type": "number", "description": "Estimated lead value", "format": "currency" }] }'::jsonb,
  '{ "ga4": { "event_name": "generate_lead", "param_mapping": { "value": "value", "currency": "currency" }, "required_params": [] }, "meta": { "event_name": "Lead", "param_mapping": { "value": "value", "currency": "currency" } }, "google_ads": { "event_name": "conversion", "param_mapping": { "value": "value" }, "requires_conversion_label": true }, "tiktok": { "event_name": "SubmitForm", "param_mapping": { "value": "value" } }, "linkedin": { "event_name": "conversion", "param_mapping": { "value": "conversionValue" } }, "snapchat": { "event_name": "SIGN_UP", "param_mapping": {} } }'::jsonb
),

-- ─── LEAD GENERATION / CONTACT ───

(NULL, '22222222-0000-0000-0000-000000000006', 'lead_generation/contact/phone_click', 2, 'phone_click', 'Phone Click', 'User clicks a phone number link', 'event', 'conversion', 1, true,
  '{ "required": [{ "key": "link_url", "label": "Phone URL", "type": "string", "description": "The tel: link clicked", "format": null }], "optional": [{ "key": "page_location", "label": "Page", "type": "string", "description": "Page where the click occurred", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "click", "param_mapping": { "link_url": "link_url" }, "additional_params": { "link_type": "phone" } }, "meta": { "event_name": "Contact", "param_mapping": {} }, "google_ads": { "event_name": "conversion", "param_mapping": {} }, "tiktok": { "event_name": "Contact", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000006', 'lead_generation/contact/email_click', 2, 'email_click', 'Email Click', 'User clicks an email link', 'event', 'conversion', 2, true,
  '{ "required": [{ "key": "link_url", "label": "Email URL", "type": "string", "description": "The mailto: link clicked", "format": null }], "optional": [] }'::jsonb,
  '{ "ga4": { "event_name": "click", "param_mapping": { "link_url": "link_url" }, "additional_params": { "link_type": "email" } }, "meta": { "event_name": "Contact", "param_mapping": {} }, "google_ads": { "event_name": "conversion", "param_mapping": {} }, "tiktok": { "event_name": "Contact", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000006', 'lead_generation/contact/chat_start', 2, 'chat_start', 'Chat Start', 'User initiates a live chat session', 'event', 'consideration', 3, true,
  '{ "required": [], "optional": [{ "key": "chat_provider", "label": "Chat Provider", "type": "string", "description": "e.g., Intercom, Drift, LiveChat", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "click", "param_mapping": {}, "additional_params": { "link_type": "chat" } }, "meta": { "event_name": "Contact", "param_mapping": {} }, "google_ads": { "event_name": "conversion", "param_mapping": {} }, "tiktok": { "event_name": "Contact", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

-- ─── LEAD GENERATION / DOWNLOAD ───

(NULL, '22222222-0000-0000-0000-000000000007', 'lead_generation/download/content_download', 2, 'content_download', 'Content Download', 'User downloads gated or ungated content', 'event', 'consideration', 1, true,
  '{ "required": [{ "key": "file_name", "label": "File Name", "type": "string", "description": "Name of downloaded file", "format": null }], "optional": [{ "key": "file_type", "label": "File Type", "type": "string", "description": "e.g., pdf, ebook, whitepaper", "format": null }, { "key": "content_category", "label": "Content Category", "type": "string", "description": "Topic or category of the content", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "file_download", "param_mapping": { "file_name": "file_name" } }, "meta": { "event_name": "Lead", "param_mapping": {} }, "google_ads": { "event_name": "conversion", "param_mapping": {} }, "tiktok": { "event_name": "Download", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

-- ─── ENGAGEMENT / INTERACTION ───

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/search', 2, 'search', 'Site Search', 'User performs a search on the website', 'event', 'consideration', 1, true,
  '{ "required": [{ "key": "search_term", "label": "Search Term", "type": "string", "description": "What the user searched for", "format": null }], "optional": [{ "key": "results_count", "label": "Results Count", "type": "integer", "description": "Number of results returned", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "search", "param_mapping": { "search_term": "search_term" } }, "meta": { "event_name": "Search", "param_mapping": { "search_term": "search_string" } }, "google_ads": { "event_name": "search", "param_mapping": {} }, "tiktok": { "event_name": "Search", "param_mapping": { "search_term": "query" } }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "SEARCH", "param_mapping": { "search_term": "search_string" } } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/share', 2, 'share', 'Share', 'User shares content via social or native share', 'event', 'advocacy', 2, true,
  '{ "required": [{ "key": "method", "label": "Share Method", "type": "string", "description": "How content was shared (e.g., email, twitter, copy_link)", "format": null }], "optional": [{ "key": "content_type", "label": "Content Type", "type": "string", "description": "Type of content shared", "format": null }, { "key": "item_id", "label": "Item ID", "type": "string", "description": "Identifier of shared item", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "share", "param_mapping": { "method": "method", "content_type": "content_type", "item_id": "item_id" } }, "meta": { "event_name": "CustomEvent", "param_mapping": {}, "custom_event_name": "Share" }, "google_ads": { "event_name": "share", "param_mapping": {} }, "tiktok": { "event_name": "ClickButton", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "SHARE", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/scroll_depth', 2, 'scroll_depth', 'Scroll Depth', 'User reaches a scroll depth threshold', 'event', 'awareness', 3, true,
  '{ "required": [{ "key": "percent_scrolled", "label": "Scroll Percentage", "type": "integer", "description": "Percentage of page scrolled (25, 50, 75, 90, 100)", "format": null }], "optional": [{ "key": "page_location", "label": "Page URL", "type": "string", "description": "Page where scroll occurred", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "scroll", "param_mapping": { "percent_scrolled": "percent_scrolled" } }, "meta": { "event_name": "CustomEvent", "param_mapping": { "percent_scrolled": "value" }, "custom_event_name": "ScrollDepth" }, "google_ads": { "event_name": "scroll", "param_mapping": {} }, "tiktok": { "event_name": "CustomEvent", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

-- ─── CONTENT / MEDIA ───

(NULL, '22222222-0000-0000-0000-000000000010', 'content/media/video_start', 2, 'video_start', 'Video Start', 'User starts playing a video', 'event', 'awareness', 1, true,
  '{ "required": [{ "key": "video_title", "label": "Video Title", "type": "string", "description": "Title of the video", "format": null }], "optional": [{ "key": "video_url", "label": "Video URL", "type": "string", "description": "URL of the video", "format": null }, { "key": "video_provider", "label": "Provider", "type": "string", "description": "e.g., youtube, vimeo, self_hosted", "format": null }, { "key": "video_duration", "label": "Duration (s)", "type": "integer", "description": "Video duration in seconds", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "video_start", "param_mapping": { "video_title": "video_title", "video_url": "video_url", "video_provider": "video_provider" } }, "meta": { "event_name": "ViewContent", "param_mapping": { "video_title": "content_name" }, "additional_params": { "content_type": "video" } }, "google_ads": { "event_name": "video_start", "param_mapping": {} }, "tiktok": { "event_name": "ViewContent", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "VIEW_CONTENT", "param_mapping": {} } }'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000010', 'content/media/video_complete', 2, 'video_complete', 'Video Complete', 'User watches a video to completion', 'event', 'consideration', 2, true,
  '{ "required": [{ "key": "video_title", "label": "Video Title", "type": "string", "description": "Title of the video", "format": null }], "optional": [{ "key": "video_url", "label": "Video URL", "type": "string", "description": "URL of the video", "format": null }, { "key": "video_duration", "label": "Duration (s)", "type": "integer", "description": "Video duration in seconds", "format": null }] }'::jsonb,
  '{ "ga4": { "event_name": "video_complete", "param_mapping": { "video_title": "video_title" } }, "meta": { "event_name": "CustomEvent", "param_mapping": {}, "custom_event_name": "VideoComplete" }, "google_ads": { "event_name": "video_complete", "param_mapping": {} }, "tiktok": { "event_name": "CustomEvent", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "CUSTOM_EVENT_1", "param_mapping": {} } }'::jsonb
),

-- ─── ACCOUNT ───

(NULL, '11111111-0000-0000-0000-000000000004', 'account/sign_up', 1, 'sign_up', 'Sign Up', 'User creates a new account', 'event', 'conversion', 1, true,
  '{ "required": [{ "key": "method", "label": "Sign-up Method", "type": "string", "description": "e.g., email, google, facebook, apple", "format": null }], "optional": [{ "key": "value", "label": "User Value", "type": "number", "description": "Estimated lifetime value of new user", "format": "currency" }] }'::jsonb,
  '{ "ga4": { "event_name": "sign_up", "param_mapping": { "method": "method" } }, "meta": { "event_name": "CompleteRegistration", "param_mapping": { "value": "value", "currency": "currency" } }, "google_ads": { "event_name": "conversion", "param_mapping": { "value": "value" }, "requires_conversion_label": true }, "tiktok": { "event_name": "CompleteRegistration", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "SIGN_UP", "param_mapping": {} } }'::jsonb
),

(NULL, '11111111-0000-0000-0000-000000000004', 'account/login', 1, 'login', 'Login', 'User logs into their account', 'event', 'retention', 2, true,
  '{ "required": [{ "key": "method", "label": "Login Method", "type": "string", "description": "e.g., email, google, SSO", "format": null }], "optional": [] }'::jsonb,
  '{ "ga4": { "event_name": "login", "param_mapping": { "method": "method" } }, "meta": { "event_name": "CustomEvent", "param_mapping": {}, "custom_event_name": "Login" }, "google_ads": { "event_name": "login", "param_mapping": {} }, "tiktok": { "event_name": "CustomEvent", "param_mapping": {} }, "linkedin": { "event_name": "conversion", "param_mapping": {} }, "snapchat": { "event_name": "LOGIN", "param_mapping": {} } }'::jsonb
);
```

### 2.2 Running the Seed

After applying the migration, run the seed file:

```bash
psql $DATABASE_URL -f supabase/seed/event_taxonomy_seed.sql
```

Or include as part of the migration file if preferred (append after the CREATE TABLE statements).

---

## 3. Naming Convention Engine

### 3.1 Backend Validation Service

**File to create**: `backend/src/services/signals/namingConvention.ts`

```typescript
export interface NamingConvention {
  event_case: 'snake_case' | 'camelCase' | 'kebab-case' | 'PascalCase';
  param_case: 'snake_case' | 'camelCase' | 'kebab-case' | 'PascalCase';
  event_prefix: string | null;
  param_prefix: string | null;
  word_separator: string;
  max_event_name_length: number;
  max_param_key_length: number;
  allowed_characters: string;
  reserved_words: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  suggestions: string[];  // auto-corrected versions
}

// Default convention (used when org hasn't configured one)
export const DEFAULT_CONVENTION: NamingConvention = {
  event_case: 'snake_case',
  param_case: 'snake_case',
  event_prefix: null,
  param_prefix: null,
  word_separator: '_',
  max_event_name_length: 40,
  max_param_key_length: 40,
  allowed_characters: 'a-z0-9_',
  reserved_words: ['event', 'page_view', 'session_start', 'first_visit', 'user_engagement'],
};

export function validateEventName(
  name: string,
  convention: NamingConvention
): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  // 1. Check length
  const maxLen = convention.max_event_name_length;
  if (name.length > maxLen) {
    errors.push(`Event name exceeds ${maxLen} characters (${name.length})`);
  }

  // 2. Check allowed characters
  const charRegex = new RegExp(`^[${convention.allowed_characters}]+$`);
  if (!charRegex.test(name)) {
    errors.push(`Contains characters not in allowed set: ${convention.allowed_characters}`);
    // Generate suggestion by stripping disallowed chars
    const cleaned = name.replace(new RegExp(`[^${convention.allowed_characters}]`, 'g'), convention.word_separator);
    suggestions.push(cleaned);
  }

  // 3. Check case format
  if (!matchesCase(name, convention.event_case)) {
    errors.push(`Event name should be ${convention.event_case}`);
    suggestions.push(convertCase(name, convention.event_case, convention.word_separator));
  }

  // 4. Check prefix
  if (convention.event_prefix && !name.startsWith(convention.event_prefix)) {
    errors.push(`Event name should start with prefix "${convention.event_prefix}"`);
    suggestions.push(`${convention.event_prefix}${name}`);
  }

  // 5. Check reserved words
  const nameWithoutPrefix = convention.event_prefix
    ? name.replace(new RegExp(`^${escapeRegex(convention.event_prefix)}`), '')
    : name;
  if (convention.reserved_words.includes(nameWithoutPrefix)) {
    errors.push(`"${nameWithoutPrefix}" is a reserved event name (auto-collected by GA4)`);
  }

  // 6. Check for common mistakes
  if (name.includes(' ')) {
    errors.push('Event names cannot contain spaces');
    suggestions.push(name.replace(/\s+/g, convention.word_separator));
  }
  if (name !== name.trim()) {
    errors.push('Event name has leading or trailing whitespace');
  }
  if (/^\d/.test(name)) {
    errors.push('Event name cannot start with a number');
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions: [...new Set(suggestions)],  // deduplicate
  };
}

export function validateParamKey(
  key: string,
  convention: NamingConvention
): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (key.length > convention.max_param_key_length) {
    errors.push(`Parameter key exceeds ${convention.max_param_key_length} characters`);
  }

  if (!matchesCase(key, convention.param_case)) {
    errors.push(`Parameter key should be ${convention.param_case}`);
    suggestions.push(convertCase(key, convention.param_case, convention.word_separator));
  }

  if (convention.param_prefix && !key.startsWith(convention.param_prefix)) {
    errors.push(`Parameter key should start with prefix "${convention.param_prefix}"`);
    suggestions.push(`${convention.param_prefix}${key}`);
  }

  const charRegex = new RegExp(`^[${convention.allowed_characters}]+$`);
  if (!charRegex.test(key)) {
    errors.push(`Contains characters not in allowed set`);
  }

  return { valid: errors.length === 0, errors, suggestions };
}

// Generate the "correct" event name from a taxonomy event, applying the org's convention
export function generateEventName(
  taxonomySlug: string,
  convention: NamingConvention
): string {
  let name = convertCase(taxonomySlug, convention.event_case, convention.word_separator);
  if (convention.event_prefix) {
    name = convention.event_prefix + name;
  }
  return name;
}

// ─── Helper functions ───

function matchesCase(str: string, caseFormat: string): boolean {
  switch (caseFormat) {
    case 'snake_case': return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(str);
    case 'camelCase': return /^[a-z][a-zA-Z0-9]*$/.test(str);
    case 'kebab-case': return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str);
    case 'PascalCase': return /^[A-Z][a-zA-Z0-9]*$/.test(str);
    default: return true;
  }
}

function convertCase(str: string, targetCase: string, separator: string): string {
  // Split on common boundaries: underscores, hyphens, camelCase transitions, spaces
  const words = str
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // camelCase → camel Case
    .replace(/[_\-\s]+/g, ' ')             // separators → spaces
    .toLowerCase()
    .trim()
    .split(/\s+/);

  switch (targetCase) {
    case 'snake_case': return words.join('_');
    case 'camelCase': return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('');
    case 'kebab-case': return words.join('-');
    case 'PascalCase': return words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
    default: return words.join(separator);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

### 3.2 Naming Convention API

**Add to an existing or new route file**: `backend/src/api/routes/namingConventions.ts`

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// GET /api/naming-convention?org_id=xxx
// Returns the org's naming convention (or defaults)
router.get('/', authMiddleware, async (req, res) => { /* ... */ });

// PUT /api/naming-convention
// Creates or updates the org's naming convention
router.put('/', authMiddleware, async (req, res) => { /* ... */ });

// POST /api/naming-convention/validate
// Validates a name against the org's convention (for real-time UI feedback)
// Body: { org_id, name, type: 'event' | 'param' }
// Response: { valid, errors, suggestions }
router.post('/validate', authMiddleware, async (req, res) => { /* ... */ });

// POST /api/naming-convention/preview
// Given a convention config, previews how existing signals would be renamed
// Body: { org_id, convention: NamingConvention }
// Response: { renames: [{ current: 'addToCart', suggested: 'add_to_cart' }] }
router.post('/preview', authMiddleware, async (req, res) => { /* ... */ });

export default router;
```

Mount: `app.use('/api/naming-convention', namingConventionRoutes);`

---

## 4. Taxonomy API Endpoints

**File to create**: `backend/src/api/routes/taxonomy.ts`

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// GET /api/taxonomy/tree?org_id=xxx
// Returns the full taxonomy tree (system + org custom events) as a nested structure
// Response: TaxonomyNode[] (see types below)
router.get('/tree', authMiddleware, async (req, res) => {
  // 1. Fetch all taxonomy entries where organization_id IS NULL (system)
  //    OR organization_id = req.query.org_id (org custom)
  // 2. Build nested tree from flat list using parent_id relationships
  // 3. Return the tree
});

// GET /api/taxonomy/events?org_id=xxx&category=ecommerce&funnel_stage=conversion
// Returns flat list of event nodes (leaf nodes only), with optional filters
router.get('/events', authMiddleware, async (req, res) => { /* ... */ });

// GET /api/taxonomy/:id
// Returns a single taxonomy node with full parameter schema + platform mappings
router.get('/:id', authMiddleware, async (req, res) => { /* ... */ });

// POST /api/taxonomy/event
// Creates a custom event under an existing category
// Body: { org_id, parent_path, slug, name, description, parameter_schema, platform_mappings, funnel_stage }
// Validates: naming convention, unique path, parent exists
router.post('/event', authMiddleware, async (req, res) => {
  // 1. Validate the slug against the org's naming convention
  // 2. Validate parent_path exists in taxonomy
  // 3. Build full path: parent_path + '/' + slug
  // 4. Check uniqueness
  // 5. Insert with is_custom = true, organization_id = org_id
});

// POST /api/taxonomy/category
// Creates a custom category (for org-specific groupings)
// Body: { org_id, parent_path (nullable for root), slug, name, description }
router.post('/category', authMiddleware, async (req, res) => { /* ... */ });

// PUT /api/taxonomy/:id
// Updates a custom event or category (system entries cannot be modified)
router.put('/:id', authMiddleware, async (req, res) => {
  // Check is_system — reject if true
  // Validate naming convention on update
});

// DELETE /api/taxonomy/:id
// Soft-deletes a custom event (sets deprecated = true)
// System entries cannot be deleted
router.delete('/:id', authMiddleware, async (req, res) => {
  // Check is_system — reject if true
  // Check if any signals reference this event — warn if so
  // Set deprecated = true (soft delete)
});

// GET /api/taxonomy/search?q=purchase&org_id=xxx
// Full-text search across event names and descriptions
router.get('/search', authMiddleware, async (req, res) => {
  // Search slug, name, description using ILIKE or full-text search
  // Return matching events with their full path
});

// GET /api/taxonomy/platform-mapping/:eventId/:platform
// Returns the platform-specific mapping for an event
// Useful for CAPI module to auto-populate event mapping
router.get('/platform-mapping/:eventId/:platform', authMiddleware, async (req, res) => { /* ... */ });

export default router;
```

Mount: `app.use('/api/taxonomy', taxonomyRoutes);`

### 4.1 TypeScript Types

**File to create**: `backend/src/types/taxonomy.ts`

```typescript
export interface TaxonomyNode {
  id: string;
  parent_id: string | null;
  path: string;
  depth: number;
  slug: string;
  name: string;
  description: string | null;
  node_type: 'category' | 'event';
  funnel_stage: FunnelStage | null;
  icon: string | null;
  display_order: number;
  is_system: boolean;
  is_custom: boolean;
  deprecated: boolean;
  // Only on event nodes:
  parameter_schema: ParameterSchema | null;
  platform_mappings: PlatformMappings | null;
  // Tree structure (populated by tree builder):
  children?: TaxonomyNode[];
}

export type FunnelStage = 'awareness' | 'consideration' | 'conversion' | 'retention' | 'advocacy';

export interface ParameterSchema {
  required: ParamSpec[];
  optional: ParamSpec[];
}

export interface ParamSpec {
  key: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description: string;
  format: string | null;  // 'currency', 'iso_4217', 'ga4_items', 'url', 'email', etc.
  item_schema?: ParamSpec[];  // For array types
}

export interface PlatformMappings {
  ga4?: PlatformEventMapping;
  meta?: PlatformEventMapping;
  google_ads?: PlatformEventMapping;
  tiktok?: PlatformEventMapping;
  linkedin?: PlatformEventMapping;
  snapchat?: PlatformEventMapping;
}

export interface PlatformEventMapping {
  event_name: string;
  param_mapping: Record<string, string>;
  additional_params?: Record<string, string>;
  required_params?: string[];
  custom_event_name?: string;       // For meta/tiktok when using CustomEvent
  requires_conversion_label?: boolean;  // For google_ads
}
```

Copy these to `frontend/src/types/taxonomy.ts` for frontend use.

---

## 5. Signal Library UI Enhancement

### 5.1 Tree View Component

**File to create**: `frontend/src/components/signals/TaxonomyTree.tsx`

A collapsible tree view that displays the taxonomy hierarchy. Uses indentation and expand/collapse icons (ChevronRight/ChevronDown from lucide-react).

```
├── 🛒 Ecommerce                              [12 events]
│   ├── Product                                [3 events]
│   │   ├── view_item                          ✅ Verified    GA4 · Meta · GAds
│   │   ├── view_item_list                     🟡 Pending     GA4 · Meta
│   │   └── select_item                        ⬜ Not started GA4
│   ├── Cart                                   [3 events]
│   │   ├── add_to_cart                        ✅ Verified    GA4 · Meta · GAds
│   │   ├── remove_from_cart                   ⬜ Not started GA4
│   │   └── view_cart                          ⬜ Not started GA4
│   ├── Checkout                               [3 events]
│   │   └── ...
│   └── Promotion                              [2 events]
│       └── ...
├── 👤 Lead Generation                         [6 events]
│   └── ...
├── 🖱️ Engagement                              [3 events]
│   └── ...
└── + Add custom category
```

Each event row shows:
- Event name (using the org's naming convention formatting)
- Implementation status (from the `signals` table if this event has been added to the Signal Library)
- Platform badges (small icons for each platform that has a mapping)
- Click to expand: shows parameter schema, platform mappings, and description

### 5.2 View Toggle

The Signal Library page should support two views:
- **Tree View** (new, default): Organised by taxonomy hierarchy
- **List View** (existing): Flat list, same as current implementation

Add a toggle in the page header using a segmented control or icon buttons (List/TreePine from lucide-react).

### 5.3 Signal Creation from Taxonomy

When the user wants to add a signal to their tracking plan, they browse the taxonomy tree and click "Add to Tracking Map" on an event node. This creates an entry in the `signals` table with `taxonomy_event_id` set, and pre-populates `key`, `name`, `required_params`, `optional_params`, and `platform_mappings` from the taxonomy event.

The user can override parameter values (e.g., set `currency` default to `AED`) but cannot change the event name unless they detach from the taxonomy (which shows a warning: "Detaching from the taxonomy means this signal will no longer auto-update when Atlas updates the event schema").

### 5.4 Custom Event Creation

When the user clicks "+ Add custom event" under a category in the tree:
1. A modal opens with fields: slug, display name, description, funnel stage
2. The slug is validated in real time against the org's naming convention (call `POST /api/naming-convention/validate`)
3. If validation fails, show errors + suggestions inline
4. Parameter schema builder: add required/optional parameters with key, label, type, description
5. Platform mapping builder: for each enabled platform, enter the platform event name and parameter mapping (pre-fill GA4 with the slug, Meta with a PascalCase version)
6. Save → creates a custom taxonomy event + optionally adds it to the tracking map

### 5.5 Naming Convention Settings

Add a settings section accessible from the Signal Library page (gear icon in header) or from the org Settings page:

- Case format selector (snake_case / camelCase / kebab-case / PascalCase) with live preview
- Optional prefix input with live preview
- Parameter case format (independent of event case)
- Preview panel: shows how existing signals would look under the new convention
- "Apply to existing signals" button (batch rename with confirmation modal)

### 5.6 Naming Validation Integration Points

Add real-time naming validation to every place in Atlas where a user types an event name:

| Location | File (approximate) | Integration |
|----------|-------------------|-------------|
| Signal Library — create custom signal | Signal creation form component | Validate slug on blur / debounced input |
| Planning Mode — AI recommendation review | Planning recommendation review component | Validate recommended event names; auto-correct if convention mismatches |
| Journey Builder — stage event selection | Journey stage configuration component | Show event picker from taxonomy tree instead of free-text input |
| CAPI Module — event mapping | CAPI setup wizard step 2 | Auto-populate from taxonomy platform_mappings |

For each integration, add a small validation indicator next to the input field:
- ✅ Green check: name matches convention
- ⚠️ Amber warning: name doesn't match, with "Fix" button that applies the suggested correction
- ❌ Red error: name uses reserved words or invalid characters

---

## 6. Parameter Schema Enforcement in Output Generators

### 6.1 GTM Container Generator

**File to modify**: Find the GTM container JSON generator in `backend/src/services/generators/` (likely `gtmContainerGenerator.ts` or similar).

When generating tags for an event that has a `taxonomy_event_id`:
1. Look up the taxonomy event's `parameter_schema`
2. For each **required** parameter, generate a corresponding dataLayer Variable in the GTM container
3. For each platform tag (GA4, Google Ads, Meta), use the `platform_mappings` from the taxonomy to set the correct event name and parameter mappings
4. Add a comment in the generated container noting which taxonomy event this tag is based on

### 6.2 DataLayer Spec Generator

**File to modify**: Find the dataLayer specification generator (likely `dataLayerSpecGenerator.ts` or similar).

When generating the `dataLayer.push()` code for an event:
1. Use the taxonomy event's `parameter_schema` to include ALL required parameters with code comments
2. Include optional parameters as commented-out examples
3. Add JSDoc-style type annotations based on the parameter `type` field
4. Include format hints (e.g., "// ISO 4217 currency code" for currency fields)

Example output:

```javascript
// Event: Purchase (ecommerce/checkout/purchase)
// Required by: GA4, Meta, Google Ads
dataLayer.push({
  event: 'purchase',                    // Do not rename — matches Atlas taxonomy
  ecommerce: {
    transaction_id: 'ORD-12345',        // Required (string) — Unique order identifier
    value: 99.99,                        // Required (number) — Total transaction value
    currency: 'AED',                     // Required (string) — ISO 4217 currency code
    // items: [],                        // Optional (array) — Array of purchased items
    // tax: 0.00,                        // Optional (number) — Tax amount
    // shipping: 0.00,                   // Optional (number) — Shipping cost
    // coupon: '',                       // Optional (string) — Applied coupon code
  }
});
```

### 6.3 CAPI Event Mapping Auto-Population

**File to modify**: The CAPI setup wizard's event mapping step (frontend component).

When the user reaches the "Map Events" step:
1. For each signal in the client's tracking map that has a `taxonomy_event_id`:
   - Look up the taxonomy event's `platform_mappings` for the CAPI provider being configured
   - Pre-populate the mapping row with the correct platform event name and parameter mapping
2. Show a "✅ Auto-mapped from taxonomy" badge on pre-populated rows
3. Allow the user to override (but show a warning: "This overrides the taxonomy mapping for this client")
4. For signals without a taxonomy reference, show the manual mapping interface (existing behaviour)

---

## 7. Planning Mode Integration

### 7.1 AI Prompt Enhancement

**File to modify**: The Claude API prompt used in Planning Mode's AI scanner (find in `backend/src/services/planning/` — likely the prompt template that analyses page DOM and recommends trackable elements).

Add to the system prompt:

```
When recommending trackable elements, always assign them an event from the Atlas taxonomy.
Use the following taxonomy structure and select the most appropriate event for each element:

[Insert taxonomy tree here — generate dynamically from the database at request time]

For each recommendation, include:
- taxonomy_path: The full path (e.g., "ecommerce/cart/add_to_cart")
- event_name: The slug (e.g., "add_to_cart")
- parameters: List the required parameters from the schema and indicate which ones can be extracted from the page

If no existing taxonomy event fits, suggest a custom event path following the convention:
{category}/{subcategory}/{event_slug}

Always use snake_case for event names and parameter keys unless the user's naming convention specifies otherwise.
```

### 7.2 Recommendation Output Enhancement

When Planning Mode generates recommendations, each recommendation should include:
- `taxonomy_event_id` (if matched to an existing taxonomy event)
- `taxonomy_path` (for display and linking)
- `parameters` populated from the taxonomy schema, with values filled in where extractable from the page DOM

This means when the user approves a recommendation and it flows into the Signal Library, it arrives pre-linked to the taxonomy with correct naming and parameters.

---

## 8. Testing Checklist

- [ ] Taxonomy seed data loads correctly (all categories and events created)
- [ ] System taxonomy entries are visible to all users (RLS policy)
- [ ] Custom taxonomy entries are org-isolated (RLS policy)
- [ ] System entries cannot be modified or deleted via API
- [ ] Tree API returns correctly nested structure
- [ ] Naming convention validation correctly identifies snake_case, camelCase, kebab-case, PascalCase
- [ ] Naming convention validation catches reserved words
- [ ] Naming convention suggestions produce valid corrections
- [ ] Custom event creation enforces naming convention
- [ ] Custom event creation enforces unique paths
- [ ] Signal creation from taxonomy pre-populates all fields correctly
- [ ] GTM container generator uses taxonomy parameter schemas
- [ ] DataLayer spec generator includes all required parameters with correct types
- [ ] CAPI event mapping auto-populates from taxonomy platform_mappings
- [ ] Planning Mode AI recommendations include taxonomy references
- [ ] Tree view UI renders correctly with expand/collapse
- [ ] Tree view shows implementation status from signals table
- [ ] Search finds events by name and description
- [ ] Naming convention settings preview shows correct transformations
- [ ] Batch rename produces correct results and doesn't break existing references

---

## 9. Deployment Checklist

- [ ] Migration applied: `20260410_001_event_taxonomy.sql`
- [ ] Seed data loaded: `event_taxonomy_seed.sql`
- [ ] ALTER TABLE on `signals` applied (new columns)
- [ ] New API routes mounted: `/api/taxonomy`, `/api/naming-convention`
- [ ] Frontend tree view component renders correctly
- [ ] Signal Library page defaults to tree view
- [ ] Naming validation appears on all signal creation forms
- [ ] Existing signals still work (backwards compatibility — `taxonomy_event_id` is nullable)
- [ ] Output generators produce correct code with taxonomy-aware parameter schemas
- [ ] No regressions in Planning Mode, Journey Builder, or CAPI Module
