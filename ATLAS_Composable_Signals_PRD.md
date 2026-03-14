# ATLAS Composable Signals & Agency Workspaces — Product Requirements Document

## Document Purpose

This PRD defines the Composable Signals system and Agency Workspace architecture for Atlas. It addresses the core promise of "build once, reuse everywhere" — enabling agencies to create signal definitions once and deploy them across multiple client sites, with both GTM and WalkerOS output support.

This document is intended to be consumed directly by Claude Code as the implementation specification. All file paths, component names, and conventions reference the existing AtlasV2 codebase as documented in CLAUDE.md.

### Strategic Context

Atlas's current signal definitions are embedded inside individual planning sessions and journeys. Each client gets a fresh planning session, fresh GTM container, fresh dataLayer spec. For an agency managing 20 ecommerce clients, this means rebuilding nearly identical tracking 20 times.

Composable Signals solves this by extracting signal definitions into a **shared library** that sits above individual client projects. An agency builds a "Shopify Ecommerce" signal pack once, then deploys it to every Shopify client by changing only URLs and measurement IDs.

The strategic goal beyond immediate usability is to **create natural migration pressure from GTM to WalkerOS**. Both output formats are always available, but the WalkerOS output is visibly superior — cleaner, more modular, version-controlled, and natively composable. Over time, agencies see that WalkerOS is the better path and migrate their clients.

---

## 1. Architecture Overview

### 1.1 The Three Layers

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: SIGNAL LIBRARY (shared across clients)            │
│                                                             │
│  Signal Packs: "Shopify Ecommerce", "SaaS Trial Flow",     │
│                "Lead Gen Contact Form"                      │
│  Each pack contains: signal definitions, platform mappings, │
│  parameter specs — platform-agnostic                        │
│                                                             │
│  Owned by: Organisation (agency)                            │
│  Visibility: All members of the organisation                │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: CLIENT PROJECTS (per-client configuration)        │
│                                                             │
│  Client: "Acme Furniture"                                   │
│  Uses signal packs: Shopify Ecommerce + Lead Gen            │
│  Client-specific: URLs, measurement IDs, custom events      │
│                                                             │
│  Owned by: Organisation, scoped to client                   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3: OUTPUTS (generated per client)                    │
│                                                             │
│  GTM container JSON — importable today                      │
│  WalkerOS flow.json — config-as-code (recommended path)     │
│  dataLayer spec — developer implementation guide            │
│                                                             │
│  Generated from: signal pack definitions + client config    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Key Concepts

| Concept | Definition |
|---------|-----------|
| **Organisation** | An agency or team account. Has members (users) and clients. |
| **Signal** | A single trackable event definition: event name, parameters, platform mappings, business justification. Platform-agnostic at its core. |
| **Signal Pack** | A reusable collection of signals grouped by use case (e.g., "Ecommerce Standard" contains purchase, add_to_cart, begin_checkout, view_item, view_item_list). |
| **Client** | A customer website/project within an organisation. Has its own URLs, measurement IDs, planning sessions, audits. |
| **Deployment** | The act of applying a signal pack to a client, generating client-specific outputs (GTM container, WalkerOS flow, dataLayer spec). |

### 1.3 How Composability Works

An agency user's workflow:

1. **Build once:** Create a signal pack "Shopify Ecommerce" containing 6 signals (purchase, add_to_cart, begin_checkout, view_item, view_item_list, search). Define parameters, platform mappings, and business justifications once.
2. **Deploy to Client A:** Assign the pack to "Acme Furniture" client. Enter Acme's URLs and GA4/Meta/Google Ads IDs. Atlas generates Acme's GTM container and dataLayer spec.
3. **Deploy to Client B:** Assign the same pack to "Oak & Pine" client. Enter their URLs and IDs. Atlas generates Oak & Pine's outputs. Total time: 2 minutes.
4. **Update the pack:** Later, Google changes the GA4 purchase schema. The agency updates the signal pack once. Re-deploy to all clients — every client gets updated outputs automatically.
5. **Compose packs:** Client C has both an ecommerce store AND a contact form. Assign both "Shopify Ecommerce" and "Lead Gen Contact Form" packs. Atlas merges them into one combined output.

### 1.4 WalkerOS Migration Incentive

Both GTM and WalkerOS outputs are always generated. But the UI consistently shows WalkerOS as the better option:

| Aspect | GTM Output | WalkerOS Output |
|--------|-----------|----------------|
| Reuse across clients | Must import separate container per client | One flow.json referenced by all clients (change config only) |
| Version control | No native versioning (GTM has its own workspace system) | flow.json is a file — commit to Git, diff changes, roll back |
| Modularity | Monolithic container per client | Composable destinations — add/remove platforms without touching events |
| Update propagation | Re-generate and re-import per client | Update flow.json, all clients using it get the update |
| Ongoing validation | Requires Atlas audit to verify | WalkerOS + Atlas destination = real-time monitoring (Phase 3 roadmap) |

The UI shows a comparison card on every output screen: "Why agencies are switching to WalkerOS" with these points. Subtle but persistent.

---

## 2. Organisations & Clients

### 2.1 Organisation Model

An organisation is the top-level entity for agency accounts. Individual (non-agency) users don't need organisations — their existing `user_id`-scoped data continues to work as before. Organisations are opt-in for Pro and Agency plan users.

### 2.2 Database Schema — Organisations & Clients

```sql
-- ============================================================
-- ORGANISATION & CLIENT TABLES
-- ============================================================

-- Organisations (agencies/teams)
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,                    -- URL-safe identifier (e.g., 'acme-agency')
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  plan TEXT NOT NULL DEFAULT 'agency' CHECK (plan IN ('pro', 'agency')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organisation members
CREATE TABLE organisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  UNIQUE(organisation_id, user_id)
);

-- Client projects within an organisation
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                           -- e.g., "Acme Furniture"
  website_url TEXT NOT NULL,                    -- Root URL
  business_type TEXT NOT NULL DEFAULT 'custom' CHECK (business_type IN (
    'ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'
  )),
  detected_platform TEXT,                       -- shopify, woocommerce, etc. (from site detection)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client platform configurations (measurement IDs per client per platform)
CREATE TABLE client_platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN (
    'ga4', 'google_ads', 'meta', 'sgtm', 'tiktok', 'linkedin'
  )),
  is_active BOOLEAN NOT NULL DEFAULT true,
  measurement_id TEXT,                          -- Platform-specific ID
  config JSONB DEFAULT '{}',
  UNIQUE(client_id, platform)
);

-- Client page URLs (the specific pages for this client's site)
CREATE TABLE client_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                          -- e.g., "Product Page"
  url TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'custom',
  stage_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_organisations_owner ON organisations(owner_id);
CREATE INDEX idx_organisations_slug ON organisations(slug);
CREATE INDEX idx_org_members_org ON organisation_members(organisation_id);
CREATE INDEX idx_org_members_user ON organisation_members(user_id);
CREATE INDEX idx_clients_org ON clients(organisation_id);
CREATE INDEX idx_client_platforms_client ON client_platforms(client_id);
CREATE INDEX idx_client_pages_client ON client_pages(client_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pages ENABLE ROW LEVEL SECURITY;

-- Users can access orgs they belong to
CREATE POLICY "Members access own org" ON organisations
  FOR SELECT USING (id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()));

CREATE POLICY "Owners manage org" ON organisations
  FOR ALL USING (owner_id = auth.uid());

-- Members can see other members in their org
CREATE POLICY "Members see org members" ON organisation_members
  FOR SELECT USING (organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()));

-- Admins/owners can manage members
CREATE POLICY "Admins manage members" ON organisation_members
  FOR ALL USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Clients visible to org members
CREATE POLICY "Org members access clients" ON clients
  FOR ALL USING (organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()));

CREATE POLICY "Org members access client platforms" ON client_platforms
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN organisation_members om ON om.organisation_id = c.organisation_id
    WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Org members access client pages" ON client_pages
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN organisation_members om ON om.organisation_id = c.organisation_id
    WHERE om.user_id = auth.uid()
  ));
```

### 2.3 Linking Existing Features to Clients

Planning sessions, journeys, and audits should optionally belong to a client. Add foreign keys:

```sql
-- Add optional client_id to existing tables
ALTER TABLE planning_sessions ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE journeys ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE audits ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX idx_planning_sessions_client ON planning_sessions(client_id);
CREATE INDEX idx_journeys_client ON journeys(client_id);
CREATE INDEX idx_audits_client ON audits(client_id);
```

These are nullable — existing sessions/journeys/audits for non-agency users continue to work with `client_id = NULL`. Agency users can assign them to a client.

---

## 3. Signal Library

### 3.1 Signal Definition Model

A signal is the platform-agnostic core of a trackable event. It defines WHAT to track and WHAT data to capture, but not HOW (the "how" is determined at output generation time, based on the target format — GTM or WalkerOS).

```sql
-- ============================================================
-- SIGNAL LIBRARY TABLES
-- ============================================================

-- Individual signal definitions
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,  -- NULL = system signal
  
  -- Identity
  key TEXT NOT NULL,                            -- Internal key: 'purchase', 'add_to_cart', 'custom_request_quote'
  name TEXT NOT NULL,                           -- Display name: 'Purchase', 'Add to Cart', 'Request a Quote'
  description TEXT NOT NULL,                    -- Business description for non-technical users
  category TEXT NOT NULL CHECK (category IN ('conversion', 'engagement', 'navigation', 'custom')),
  
  -- Source
  is_system BOOLEAN NOT NULL DEFAULT false,     -- true = Atlas-maintained (the 8 core action primitives)
  is_custom BOOLEAN NOT NULL DEFAULT false,     -- true = agency-created custom signal
  source_action_primitive TEXT,                 -- If based on an action primitive, reference its key
  
  -- Parameters
  required_params JSONB NOT NULL DEFAULT '[]',  -- Array of ParamSpec objects
  optional_params JSONB NOT NULL DEFAULT '[]',  -- Array of ParamSpec objects
  
  -- Platform mappings (how this signal maps to each ad platform's event schema)
  platform_mappings JSONB NOT NULL DEFAULT '{}',
  -- Structure:
  -- {
  --   "ga4": { "event_name": "purchase", "param_mapping": { "transaction_id": "transaction_id", ... } },
  --   "meta": { "event_name": "Purchase", "param_mapping": { "transaction_id": "order_id", ... } },
  --   "google_ads": { ... },
  --   "tiktok": { ... },
  --   "linkedin": { ... }
  -- }
  
  -- WalkerOS-specific mapping
  walkeros_mapping JSONB DEFAULT '{}',
  -- Structure:
  -- {
  --   "entity": "product",
  --   "action": "purchase",
  --   "trigger": { "type": "load" | "click" | "submit", "selector": optional },
  --   "data_mapping": { "value": "data.value", "id": "data.transaction_id" }
  -- }
  
  -- Metadata
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(organisation_id, key)                  -- Unique key per org (or globally for system signals)
);

-- Signal packs (reusable collections of signals)
CREATE TABLE signal_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,  -- NULL = system pack
  
  name TEXT NOT NULL,                           -- e.g., "Shopify Ecommerce Standard"
  description TEXT,
  business_type TEXT NOT NULL DEFAULT 'custom', -- Primary use case
  is_system BOOLEAN NOT NULL DEFAULT false,     -- true = Atlas-maintained template pack
  
  -- Pack metadata
  version INTEGER NOT NULL DEFAULT 1,
  signals_count INTEGER NOT NULL DEFAULT 0,     -- Denormalised count for display
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: which signals belong to which packs
CREATE TABLE signal_pack_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  stage_hint TEXT,                              -- Suggested stage/page type where this signal should fire
                                                -- e.g., 'confirmation', 'product', 'cart'
  is_required BOOLEAN NOT NULL DEFAULT true,    -- Can this signal be omitted when deploying the pack?
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(pack_id, signal_id)
);

-- Deployments: which packs are deployed to which clients
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  
  -- Deployment-specific overrides
  signal_overrides JSONB DEFAULT '{}',          -- Per-signal parameter overrides for this client
  -- Structure:
  -- {
  --   "signal_key": {
  --     "enabled": true/false,
  --     "param_overrides": { "currency": "SGD" },
  --     "stage_assignment": "confirmation_page_id"
  --   }
  -- }
  
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_generated_at TIMESTAMPTZ,                -- When outputs were last generated from this deployment
  UNIQUE(client_id, pack_id)
);

-- Generated outputs per client (replaces per-session outputs for agency workflow)
CREATE TABLE client_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  output_type TEXT NOT NULL CHECK (output_type IN (
    'gtm_container', 'walkeros_flow', 'datalayer_spec', 'implementation_guide'
  )),
  output_data JSONB,
  file_path TEXT,                               -- Path in Supabase Storage if applicable
  version INTEGER NOT NULL DEFAULT 1,
  
  -- Track which pack versions were used to generate this output
  source_deployments JSONB NOT NULL DEFAULT '[]', -- Array of { deployment_id, pack_id, pack_version }
  
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_signals_org ON signals(organisation_id);
CREATE INDEX idx_signals_system ON signals(is_system) WHERE is_system = true;
CREATE INDEX idx_signals_key ON signals(key);
CREATE INDEX idx_signal_packs_org ON signal_packs(organisation_id);
CREATE INDEX idx_signal_packs_system ON signal_packs(is_system) WHERE is_system = true;
CREATE INDEX idx_signal_pack_signals_pack ON signal_pack_signals(pack_id);
CREATE INDEX idx_signal_pack_signals_signal ON signal_pack_signals(signal_id);
CREATE INDEX idx_deployments_client ON deployments(client_id);
CREATE INDEX idx_deployments_pack ON deployments(pack_id);
CREATE INDEX idx_client_outputs_client ON client_outputs(client_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_pack_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_outputs ENABLE ROW LEVEL SECURITY;

-- System signals readable by all, org signals by org members
CREATE POLICY "Read system signals" ON signals
  FOR SELECT USING (is_system = true);

CREATE POLICY "Org members access org signals" ON signals
  FOR ALL USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
  ));

-- Same pattern for signal packs
CREATE POLICY "Read system packs" ON signal_packs
  FOR SELECT USING (is_system = true);

CREATE POLICY "Org members access org packs" ON signal_packs
  FOR ALL USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
  ));

-- Pack signals follow the pack's visibility
CREATE POLICY "Access pack signals via pack" ON signal_pack_signals
  FOR ALL USING (pack_id IN (
    SELECT id FROM signal_packs WHERE is_system = true
    UNION
    SELECT sp.id FROM signal_packs sp
    JOIN organisation_members om ON om.organisation_id = sp.organisation_id
    WHERE om.user_id = auth.uid()
  ));

-- Deployments accessible by org members (via client)
CREATE POLICY "Org members access deployments" ON deployments
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN organisation_members om ON om.organisation_id = c.organisation_id
    WHERE om.user_id = auth.uid()
  ));

-- Client outputs same pattern
CREATE POLICY "Org members access client outputs" ON client_outputs
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN organisation_members om ON om.organisation_id = c.organisation_id
    WHERE om.user_id = auth.uid()
  ));
```

### 3.2 System Signals (Seed Data)

The 8 existing Action Primitives from `backend/src/services/journey/actionPrimitives.ts` become system signals. These are seeded on first deploy and maintained by Atlas.

```sql
INSERT INTO signals (key, name, description, category, is_system, source_action_primitive, required_params, optional_params, platform_mappings, walkeros_mapping) VALUES
('purchase', 'Purchase', 'A transaction is completed', 'conversion', true, 'purchase',
  '[{"key":"transaction_id","label":"Order ID","type":"string"},{"key":"value","label":"Order Total","type":"number"},{"key":"currency","label":"Currency","type":"string"}]'::jsonb,
  '[{"key":"items","label":"Products","type":"array"},{"key":"tax","label":"Tax","type":"number"},{"key":"shipping","label":"Shipping","type":"number"},{"key":"coupon","label":"Coupon","type":"string"},{"key":"user_email","label":"Email","type":"string"},{"key":"user_phone","label":"Phone","type":"string"}]'::jsonb,
  '{"ga4":{"event_name":"purchase","param_mapping":{"transaction_id":"transaction_id","value":"value","currency":"currency","items":"items","tax":"tax","shipping":"shipping","coupon":"coupon"}},"meta":{"event_name":"Purchase","param_mapping":{"transaction_id":"order_id","value":"value","currency":"currency","items":"content_ids"},"additional":{"content_type":"product"}},"google_ads":{"event_name":"conversion","param_mapping":{"transaction_id":"transaction_id","value":"value","currency":"currency"},"additional":{"send_to":"{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"}},"tiktok":{"event_name":"CompletePayment","param_mapping":{"transaction_id":"order_id","value":"value","currency":"currency","items":"contents"}},"linkedin":{"event_name":"conversion","param_mapping":{"value":"value","currency":"currency"}}}'::jsonb,
  '{"entity":"product","action":"purchase","trigger":{"type":"load"},"data_mapping":{"id":"data.transaction_id","revenue":"data.value","currency":"data.currency"}}'::jsonb
),
('add_to_cart', 'Add to Cart', 'User adds a product to their cart', 'engagement', true, 'add_to_cart',
  '[{"key":"value","label":"Cart Value","type":"number"},{"key":"currency","label":"Currency","type":"string"}]'::jsonb,
  '[{"key":"items","label":"Products Added","type":"array"}]'::jsonb,
  '{"ga4":{"event_name":"add_to_cart","param_mapping":{"value":"value","currency":"currency","items":"items"}},"meta":{"event_name":"AddToCart","param_mapping":{"value":"value","currency":"currency","items":"content_ids"},"additional":{"content_type":"product"}},"google_ads":{"event_name":"add_to_cart","param_mapping":{"value":"value","currency":"currency","items":"items"}},"tiktok":{"event_name":"AddToCart","param_mapping":{"value":"value","currency":"currency","items":"contents"}}}'::jsonb,
  '{"entity":"product","action":"add","trigger":{"type":"click","selector":".add-to-cart"},"data_mapping":{"value":"data.value","currency":"data.currency"}}'::jsonb
),
('begin_checkout', 'Begin Checkout', 'User starts the checkout process', 'engagement', true, 'begin_checkout',
  '[{"key":"value","label":"Cart Value","type":"number"},{"key":"currency","label":"Currency","type":"string"}]'::jsonb,
  '[{"key":"items","label":"Products in Cart","type":"array"},{"key":"coupon","label":"Coupon","type":"string"}]'::jsonb,
  '{"ga4":{"event_name":"begin_checkout","param_mapping":{"value":"value","currency":"currency","items":"items","coupon":"coupon"}},"meta":{"event_name":"InitiateCheckout","param_mapping":{"value":"value","currency":"currency","items":"content_ids"},"additional":{"content_type":"product"}},"tiktok":{"event_name":"InitiateCheckout","param_mapping":{"value":"value","currency":"currency","items":"contents"}}}'::jsonb,
  '{"entity":"order","action":"start","trigger":{"type":"load"},"data_mapping":{"value":"data.value","currency":"data.currency"}}'::jsonb
),
('generate_lead', 'Form Submission', 'User submits a contact or lead form', 'conversion', true, 'generate_lead',
  '[{"key":"form_id","label":"Form Name","type":"string"}]'::jsonb,
  '[{"key":"value","label":"Lead Value","type":"number"},{"key":"currency","label":"Currency","type":"string"},{"key":"user_email","label":"Email","type":"string"},{"key":"user_phone","label":"Phone","type":"string"}]'::jsonb,
  '{"ga4":{"event_name":"generate_lead","param_mapping":{"form_id":"form_id","value":"value","currency":"currency"}},"meta":{"event_name":"Lead","param_mapping":{"value":"value","currency":"currency","user_email":"em","user_phone":"ph"}},"google_ads":{"event_name":"conversion","param_mapping":{"value":"value","currency":"currency"},"additional":{"send_to":"{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"}},"tiktok":{"event_name":"SubmitForm","param_mapping":{"value":"value","currency":"currency"}},"linkedin":{"event_name":"conversion","param_mapping":{"value":"value","currency":"currency"}}}'::jsonb,
  '{"entity":"form","action":"submit","trigger":{"type":"submit"},"data_mapping":{"id":"data.form_id","value":"data.value"}}'::jsonb
),
('sign_up', 'Sign Up', 'User creates an account or registers', 'conversion', true, 'sign_up',
  '[{"key":"method","label":"Sign Up Method","type":"string"}]'::jsonb,
  '[{"key":"user_id","label":"User ID","type":"string"},{"key":"user_email","label":"Email","type":"string"}]'::jsonb,
  '{"ga4":{"event_name":"sign_up","param_mapping":{"method":"method"}},"meta":{"event_name":"CompleteRegistration","param_mapping":{"method":"content_name","user_email":"em"},"additional":{"status":"true"}},"tiktok":{"event_name":"CompleteRegistration","param_mapping":{"method":"content_name"}}}'::jsonb,
  '{"entity":"user","action":"register","trigger":{"type":"submit"},"data_mapping":{"method":"data.method"}}'::jsonb
),
('view_item', 'View Product/Listing', 'User views a product detail page', 'engagement', true, 'view_item',
  '[{"key":"items","label":"Product Viewed","type":"array"}]'::jsonb,
  '[{"key":"value","label":"Product Value","type":"number"},{"key":"currency","label":"Currency","type":"string"}]'::jsonb,
  '{"ga4":{"event_name":"view_item","param_mapping":{"items":"items","value":"value","currency":"currency"}},"meta":{"event_name":"ViewContent","param_mapping":{"items":"content_ids","value":"value","currency":"currency"},"additional":{"content_type":"product"}},"tiktok":{"event_name":"ViewContent","param_mapping":{"items":"contents","value":"value","currency":"currency"}}}'::jsonb,
  '{"entity":"product","action":"view","trigger":{"type":"load"},"data_mapping":{"name":"data.items[0].item_name","id":"data.items[0].item_id"}}'::jsonb
),
('view_item_list', 'View Category/List', 'User views a category or product listing page', 'engagement', true, 'view_item_list',
  '[{"key":"item_list_name","label":"List/Category Name","type":"string"}]'::jsonb,
  '[{"key":"items","label":"Products in List","type":"array"}]'::jsonb,
  '{"ga4":{"event_name":"view_item_list","param_mapping":{"item_list_name":"item_list_name","items":"items"}}}'::jsonb,
  '{"entity":"product","action":"list","trigger":{"type":"load"},"data_mapping":{"list":"data.item_list_name"}}'::jsonb
),
('search', 'Site Search', 'User performs a search', 'engagement', true, 'search',
  '[{"key":"search_term","label":"Search Term","type":"string"}]'::jsonb,
  '[]'::jsonb,
  '{"ga4":{"event_name":"search","param_mapping":{"search_term":"search_term"}},"meta":{"event_name":"Search","param_mapping":{"search_term":"search_string"}},"tiktok":{"event_name":"Search","param_mapping":{"search_term":"query"}}}'::jsonb,
  '{"entity":"search","action":"query","trigger":{"type":"submit"},"data_mapping":{"term":"data.search_term"}}'::jsonb
);
```

### 3.3 System Signal Packs (Seed Data)

```sql
INSERT INTO signal_packs (name, description, business_type, is_system) VALUES
('Ecommerce Standard', 'Complete ecommerce tracking: product views, cart, checkout, purchase', 'ecommerce', true),
('SaaS Standard', 'SaaS trial and subscription tracking: sign-up, onboarding, conversion', 'saas', true),
('Lead Generation Standard', 'Lead capture tracking: form submissions, phone clicks, downloads', 'lead_gen', true),
('Content & Media', 'Content engagement tracking: article views, newsletter sign-ups, shares', 'content', true);

-- Link signals to packs (using subqueries for IDs)
-- Ecommerce Standard: all commerce signals
INSERT INTO signal_pack_signals (pack_id, signal_id, stage_hint, is_required, display_order)
SELECT sp.id, s.id, 
  CASE s.key 
    WHEN 'purchase' THEN 'confirmation'
    WHEN 'add_to_cart' THEN 'product'
    WHEN 'begin_checkout' THEN 'checkout'
    WHEN 'view_item' THEN 'product'
    WHEN 'view_item_list' THEN 'category'
    WHEN 'search' THEN 'search_results'
  END,
  CASE WHEN s.key IN ('purchase', 'add_to_cart', 'view_item') THEN true ELSE false END,
  CASE s.key
    WHEN 'view_item_list' THEN 1
    WHEN 'view_item' THEN 2
    WHEN 'search' THEN 3
    WHEN 'add_to_cart' THEN 4
    WHEN 'begin_checkout' THEN 5
    WHEN 'purchase' THEN 6
  END
FROM signal_packs sp, signals s
WHERE sp.name = 'Ecommerce Standard' AND sp.is_system = true
  AND s.key IN ('purchase', 'add_to_cart', 'begin_checkout', 'view_item', 'view_item_list', 'search')
  AND s.is_system = true;

-- Lead Gen Standard
INSERT INTO signal_pack_signals (pack_id, signal_id, stage_hint, is_required, display_order)
SELECT sp.id, s.id,
  CASE s.key
    WHEN 'generate_lead' THEN 'form'
    WHEN 'view_item' THEN 'service_page'
  END,
  true, 
  CASE s.key WHEN 'view_item' THEN 1 WHEN 'generate_lead' THEN 2 END
FROM signal_packs sp, signals s
WHERE sp.name = 'Lead Generation Standard' AND sp.is_system = true
  AND s.key IN ('generate_lead', 'view_item')
  AND s.is_system = true;

-- SaaS Standard
INSERT INTO signal_pack_signals (pack_id, signal_id, stage_hint, is_required, display_order)
SELECT sp.id, s.id,
  CASE s.key
    WHEN 'sign_up' THEN 'sign_up'
    WHEN 'view_item' THEN 'pricing'
    WHEN 'purchase' THEN 'confirmation'
  END,
  true,
  CASE s.key WHEN 'view_item' THEN 1 WHEN 'sign_up' THEN 2 WHEN 'purchase' THEN 3 END
FROM signal_packs sp, signals s
WHERE sp.name = 'SaaS Standard' AND sp.is_system = true
  AND s.key IN ('sign_up', 'view_item', 'purchase')
  AND s.is_system = true;
```

---

## 4. API Endpoints

### 4.1 Organisations

New route file: `backend/src/api/routes/organisations.ts`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/organisations` | Create an organisation |
| `GET` | `/api/organisations` | List user's organisations |
| `GET` | `/api/organisations/:orgId` | Get org details + member count + client count |
| `PUT` | `/api/organisations/:orgId` | Update org name/settings |
| `DELETE` | `/api/organisations/:orgId` | Delete org (owner only) |
| `POST` | `/api/organisations/:orgId/members` | Invite a member (by email) |
| `DELETE` | `/api/organisations/:orgId/members/:memberId` | Remove a member |
| `PATCH` | `/api/organisations/:orgId/members/:memberId` | Change member role |

### 4.2 Clients

New route file: `backend/src/api/routes/clients.ts`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/organisations/:orgId/clients` | Create a client |
| `GET` | `/api/organisations/:orgId/clients` | List clients (with signal health scores if audited) |
| `GET` | `/api/organisations/:orgId/clients/:clientId` | Get client detail + deployments + outputs |
| `PUT` | `/api/organisations/:orgId/clients/:clientId` | Update client |
| `DELETE` | `/api/organisations/:orgId/clients/:clientId` | Archive client |
| `PUT` | `/api/organisations/:orgId/clients/:clientId/platforms` | Set platform configs (measurement IDs) |
| `POST` | `/api/organisations/:orgId/clients/:clientId/pages` | Add/update pages |
| `GET` | `/api/organisations/:orgId/clients/:clientId/pages` | List pages |

### 4.3 Signal Library

New route file: `backend/src/api/routes/signals.ts`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/signals` | List all accessible signals (system + org's custom). Query param: `?org_id=` |
| `POST` | `/api/signals` | Create a custom signal in an organisation |
| `GET` | `/api/signals/:signalId` | Get signal detail with all platform mappings |
| `PUT` | `/api/signals/:signalId` | Update a custom signal (org-owned only, not system) |
| `DELETE` | `/api/signals/:signalId` | Delete a custom signal |
| `GET` | `/api/signal-packs` | List all accessible packs (system + org's custom) |
| `POST` | `/api/signal-packs` | Create a custom pack |
| `GET` | `/api/signal-packs/:packId` | Get pack with all signals |
| `PUT` | `/api/signal-packs/:packId` | Update pack (add/remove signals, rename) |
| `DELETE` | `/api/signal-packs/:packId` | Delete a custom pack |
| `POST` | `/api/signal-packs/:packId/signals` | Add a signal to a pack |
| `DELETE` | `/api/signal-packs/:packId/signals/:signalId` | Remove a signal from a pack |

### 4.4 Deployments & Output Generation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/organisations/:orgId/clients/:clientId/deploy` | Deploy a signal pack to a client. Body: `{ pack_id, signal_overrides? }` |
| `DELETE` | `/api/organisations/:orgId/clients/:clientId/deploy/:deploymentId` | Remove a pack from a client |
| `POST` | `/api/organisations/:orgId/clients/:clientId/generate` | Generate all outputs (GTM + WalkerOS + dataLayer) from deployed packs |
| `GET` | `/api/organisations/:orgId/clients/:clientId/outputs` | List generated outputs |
| `GET` | `/api/organisations/:orgId/clients/:clientId/outputs/:outputId/download` | Download a specific output |
| `POST` | `/api/organisations/:orgId/clients/:clientId/generate-all` | Bulk regenerate: re-generate outputs for ALL clients using a specific pack (after pack update) |

---

## 5. Output Generation from Signal Packs

### 5.1 Composable Output Generator

New file: `backend/src/services/signals/composableOutputGenerator.ts`

This generator replaces (or wraps) the existing per-session generators when operating in agency/composable mode. It takes signal pack deployments + client configuration and produces outputs.

```typescript
export interface ComposableGenerationInput {
  client: ClientWithConfig;                     // Client details + platforms + pages
  deployments: DeploymentWithSignals[];         // All packs deployed to this client, with signal definitions
}

export interface ClientWithConfig {
  id: string;
  name: string;
  website_url: string;
  business_type: string;
  platforms: ClientPlatform[];                  // With measurement IDs filled in
  pages: ClientPage[];                         // URLs + labels + page types
}

export interface DeploymentWithSignals {
  deployment_id: string;
  pack_id: string;
  pack_name: string;
  signals: SignalWithOverrides[];               // Signal definitions + any client-specific overrides
}

export interface SignalWithOverrides {
  signal: Signal;                               // Full signal definition from the library
  stage_assignment: string | null;              // Which client page this signal is assigned to
  param_overrides: Record<string, any>;         // Client-specific parameter values
  enabled: boolean;                             // Can be disabled per-client without removing from pack
}
```

**Generation flow:**

1. Collect all signals from all deployed packs for this client
2. Deduplicate: if two packs both include the `purchase` signal, include it only once
3. For each signal, resolve the platform mapping based on the client's active platforms
4. For each signal, apply any client-specific parameter overrides (e.g., `currency: "SGD"`)
5. Assign signals to pages based on `stage_hint` + client page types
6. Generate GTM container JSON (reuse existing `gtmContainerGenerator.ts` logic, but with signal-pack-resolved inputs instead of planning-recommendation inputs)
7. Generate WalkerOS flow.json (reuse existing patterns from `walkerosFlow.ts`)
8. Generate dataLayer specification (reuse existing `dataLayerSpecGenerator.ts`)
9. Store outputs in `client_outputs` table

### 5.2 WalkerOS Output — The Better Path

The WalkerOS output should be visibly superior. Here's how:

**GTM output produces:** One monolithic JSON file per client. If the agency updates a signal, they regenerate and re-import for every client.

**WalkerOS output produces:** A modular structure:

```
client-acme-furniture/
├── flow.json                    ← Main config (sources + destinations)
├── signals/
│   ├── ecommerce.json           ← From "Ecommerce Standard" pack
│   └── lead-gen.json            ← From "Lead Gen" pack (if deployed)
└── README.md                    ← Setup instructions
```

The `flow.json` references signal packs by import, not by inlining them:

```json
{
  "version": "1.0",
  "sources": { "web": { "default": true } },
  "imports": [
    "./signals/ecommerce.json",
    "./signals/lead-gen.json"
  ],
  "destinations": {
    "ga4": {
      "package": "@walkeros/destination-ga4",
      "config": { "measurement_id": "G-ABC123" }
    },
    "meta": {
      "package": "@walkeros/destination-meta",
      "config": { "pixel_id": "1234567890" }
    }
  }
}
```

The signal pack files (`ecommerce.json`, `lead-gen.json`) are identical across all clients using that pack. Only `flow.json` is client-specific (it has the measurement IDs and destination config).

**This means:** When the agency updates the "Ecommerce Standard" pack, they regenerate the signal pack files. Every client's `flow.json` still references them. One update propagates everywhere. With GTM, they'd need to re-import a container for every client.

The UI makes this advantage explicit on every output screen.

### 5.3 Integration with Existing Generators

The composable output generator wraps the existing generators rather than replacing them:

- `gtmContainerGenerator.ts` — receives resolved signals + client platforms + pages. Same output format (`exportFormatVersion: 2`). The input source changes (signal pack deployments instead of planning recommendations), but the output is identical.
- `dataLayerSpecGenerator.ts` — same approach. Receives resolved signals, produces per-page code snippets.
- `walkerosFlow.ts` — enhanced to support the modular import structure described above.

For non-agency users (no organisation), the existing generators continue to work as-is with planning sessions and journeys.

---

## 6. User Flow — Agency Workflow

### 6.1 First-Time Agency Setup

1. Agency PM creates an organisation: Settings → "Create Organisation" → name + invite team members
2. Organisation appears in the sidebar as a workspace switcher

### 6.2 Creating a Signal Pack

1. Navigate to Signal Library (new sidebar nav item)
2. Choose: "Start from a template" (loads a system pack as a starting point) or "Create from scratch"
3. If from template: system pack signals are pre-loaded, user can add/remove/customise
4. If from scratch: empty pack, user adds signals from the system signal catalogue or creates custom signals
5. Save the pack with a name: "Shopify Ecommerce — Our Agency Standard"

### 6.3 Adding a Custom Signal

From the Signal Library, click "Create Custom Signal":

1. **Name & Description:** "Request a Quote" / "User submits a quote request form"
2. **Category:** Conversion
3. **Parameters:**
   - Required: `form_id` (string), `service_type` (string)
   - Optional: `estimated_value` (number), `user_email` (string)
4. **Platform Mappings:** (pre-filled based on parameter types, user can adjust)
   - GA4: event `generate_lead`, param mapping shown
   - Meta: event `Lead`, param mapping shown
   - Google Ads: event `conversion`, mapping shown
5. **WalkerOS Mapping:**
   - Entity: `quote`
   - Action: `request`
   - Trigger: form submit
6. Save → signal is available to add to any pack

### 6.4 Onboarding a Client

1. Navigate to Clients → "Add Client"
2. Enter client name + website URL
3. Atlas runs site detection (from CX Improvements PRD) → pre-fills business type + existing tracking
4. Configure platforms: paste GA4 ID, Meta Pixel ID, Google Ads conversion ID
5. Add page URLs (or run auto-discovery)
6. Deploy signal packs: select "Shopify Ecommerce" → assign signals to pages
7. Generate outputs → download GTM container + dataLayer spec + WalkerOS config
8. Share with developer (Developer Portal from CX Improvements PRD)

**Total time for second client onwards:** 2-3 minutes (pack is already built, just enter URLs and IDs).

### 6.5 Updating a Signal Pack

1. Navigate to Signal Library → select pack
2. Modify a signal (e.g., Google updates GA4 purchase schema → update the GA4 mapping)
3. Save → pack version increments
4. Atlas shows: "3 clients use this pack. Their outputs are now outdated."
5. Click "Regenerate All" → Atlas regenerates outputs for all 3 clients
6. For each client: share updated outputs with their developer or download

---

## 7. Frontend — New Pages & Components

### 7.1 New Routes

| Route | Page | Description |
|-------|------|-------------|
| `/org/:orgId` | `OrgDashboardPage` | Organisation overview: clients, signal health summary |
| `/org/:orgId/clients` | `ClientListPage` | Client list with health scores |
| `/org/:orgId/clients/:clientId` | `ClientDetailPage` | Client detail: deployments, outputs, audits |
| `/org/:orgId/clients/:clientId/deploy` | `DeployPackPage` | Deploy signal packs to client |
| `/org/:orgId/signals` | `SignalLibraryPage` | Signal library: browse signals, create custom |
| `/org/:orgId/signals/new` | `CreateSignalPage` | Custom signal creation form |
| `/org/:orgId/packs` | `SignalPacksPage` | Signal packs: browse, create, edit |
| `/org/:orgId/packs/:packId` | `PackDetailPage` | Pack contents: signals, deployments, version history |
| `/org/:orgId/packs/new` | `CreatePackPage` | Create new pack (from template or scratch) |
| `/org/:orgId/settings` | `OrgSettingsPage` | Org name, members, billing |

### 7.2 Sidebar Changes

For users who belong to an organisation, the sidebar adds:

```
[Org Name ▾]            ← Workspace switcher (personal / org)
──────────────
Clients                 ← Client list
Signal Library          ← Signals + packs
──────────────
Home                    ← Existing
Plan Tracking           ← Existing (now scoped to selected client)
New Audit               ← Existing (now scoped to selected client)
History                 ← Existing (now scoped to selected client)
Settings                ← Existing + org settings
```

The workspace switcher at the top lets users toggle between their personal workspace (existing behaviour, no org context) and their organisation workspace. When in org mode, Planning Mode and Audits are scoped to a selected client.

### 7.3 Key New Components

```
frontend/src/components/
├── organisation/
│   ├── OrgSwitcher.tsx              ← Workspace switcher in sidebar
│   ├── ClientCard.tsx               ← Client card for list view
│   ├── ClientSetupWizard.tsx        ← Client onboarding wizard
│   └── MemberManagement.tsx         ← Invite/remove/role management
├── signals/
│   ├── SignalCard.tsx               ← Display a signal with its mappings
│   ├── SignalEditor.tsx             ← Create/edit signal form
│   ├── PackCard.tsx                 ← Display a signal pack
│   ├── PackEditor.tsx               ← Create/edit pack (add/remove signals)
│   ├── PackDeploymentView.tsx       ← Show which clients use this pack
│   ├── DeploymentWizard.tsx         ← Assign pack to client + map signals to pages
│   ├── SignalToPlatformPreview.tsx   ← Show how a signal maps to each platform
│   └── WalkerOSAdvantageCard.tsx    ← The "why WalkerOS is better" comparison card
```

### 7.4 New Zustand Stores

```
frontend/src/store/
├── organisationStore.ts    ← Current org, clients list, members
├── signalStore.ts          ← Signals, packs, deployments
```

---

## 8. Relationship to Existing Features

### 8.1 Planning Mode

Planning Mode continues to work as-is for non-agency users (no organisation). For agency users, Planning Mode gains an additional flow:

- When starting a new planning session within an org context, the user selects a client first
- The session is stored with `client_id` set
- At the output generation step, if the client has signal packs deployed, Planning Mode compares its AI recommendations against the deployed pack signals and highlights: "These 4 recommended events are already in your Ecommerce Standard pack. These 2 are new."
- The user can add the new signals to their pack or create a one-off custom signal for just this client

This means Planning Mode becomes a **discovery tool that feeds the signal library**, not just a standalone workflow.

### 8.2 Audit Mode

Audits for agency clients use the deployed signal packs as the validation spec. Instead of building a journey from scratch, the audit engine resolves the client's deployed signals into expected events per page and validates against them.

New endpoint addition:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/organisations/:orgId/clients/:clientId/audit` | Run an audit against this client's deployed signal packs. Auto-generates a validation spec from deployments. |

### 8.3 Developer Portal

The Developer Portal (from CX Improvements PRD) works identically for agency clients. The share link gives the developer access to the client-specific outputs generated from the signal packs.

### 8.4 Existing Action Primitives

The existing `actionPrimitives.ts` file becomes a **read-only reference** that seeds the `signals` table on first deploy. After seeding, the signals table is the source of truth. The existing generators (`gtmDataLayer.ts`, `walkerosFlow.ts`, `validationSpec.ts`) should be refactored to read from resolved signal definitions rather than hardcoded action primitives.

This refactoring can be done incrementally — the existing generators continue to work with the hardcoded primitives for non-agency users, while the composable generator uses the database-backed signals for agency users.

---

## 9. Implementation Sequence

### Sprint 1 (Week 1–2): Organisation & Client Foundation

| Task | Files | Estimate |
|------|-------|----------|
| DB migration: organisations, org_members, clients, client_platforms, client_pages | SQL migration | 3h |
| DB migration: Add client_id to planning_sessions, journeys, audits | SQL migration | 1h |
| Backend: organisation CRUD routes + queries | `routes/organisations.ts`, `database/orgQueries.ts` | 8h |
| Backend: client CRUD routes + queries | `routes/clients.ts`, `database/clientQueries.ts` | 6h |
| Backend: org middleware (validate org membership on org-scoped routes) | `middleware/orgMiddleware.ts` | 3h |
| Frontend: `OrgSwitcher.tsx` in sidebar | `components/organisation/OrgSwitcher.tsx` | 4h |
| Frontend: `OrgDashboardPage.tsx` | `pages/OrgDashboardPage.tsx` | 4h |
| Frontend: `ClientListPage.tsx` + `ClientCard.tsx` | `pages/ClientListPage.tsx`, `components/organisation/ClientCard.tsx` | 4h |
| Frontend: `ClientDetailPage.tsx` | `pages/ClientDetailPage.tsx` | 6h |
| Frontend: `ClientSetupWizard.tsx` (name, URL, detection, platforms, pages) | `components/organisation/ClientSetupWizard.tsx` | 6h |
| Frontend: `organisationStore.ts` | `store/organisationStore.ts` | 3h |
| Frontend: New routes + sidebar modifications | Router + `Sidebar.tsx` | 2h |

### Sprint 2 (Week 3–4): Signal Library

| Task | Files | Estimate |
|------|-------|----------|
| DB migration: signals, signal_packs, signal_pack_signals | SQL migration | 2h |
| Seed system signals from action primitives | SQL seed script | 3h |
| Seed system signal packs | SQL seed script | 2h |
| Backend: signal CRUD routes + queries | `routes/signals.ts`, `database/signalQueries.ts` | 6h |
| Backend: signal pack CRUD routes + queries | Same files | 6h |
| Frontend: `SignalLibraryPage.tsx` | `pages/SignalLibraryPage.tsx` | 6h |
| Frontend: `SignalCard.tsx` + `SignalToPlatformPreview.tsx` | `components/signals/` | 4h |
| Frontend: `SignalEditor.tsx` (create/edit custom signal) | `components/signals/SignalEditor.tsx` | 8h |
| Frontend: `SignalPacksPage.tsx` + `PackCard.tsx` | `pages/SignalPacksPage.tsx`, `components/signals/PackCard.tsx` | 4h |
| Frontend: `PackEditor.tsx` (create from template or scratch) | `components/signals/PackEditor.tsx` | 6h |
| Frontend: `PackDetailPage.tsx` (view pack contents + deployments) | `pages/PackDetailPage.tsx` | 4h |
| Frontend: `signalStore.ts` | `store/signalStore.ts` | 3h |

### Sprint 3 (Week 5–6): Deployments & Output Generation

| Task | Files | Estimate |
|------|-------|----------|
| DB migration: deployments, client_outputs | SQL migration | 2h |
| Backend: deployment routes (deploy pack to client, remove, list) | `routes/clients.ts` additions | 4h |
| Backend: `composableOutputGenerator.ts` | `services/signals/composableOutputGenerator.ts` | 10h |
| Backend: GTM output from signal pack (adapt `gtmContainerGenerator.ts`) | `services/signals/` or adapter in existing generator | 6h |
| Backend: WalkerOS modular output (flow.json + signal pack files) | `services/signals/walkerosComposableGenerator.ts` | 8h |
| Backend: dataLayer spec from signal pack | Adapter for `dataLayerSpecGenerator.ts` | 4h |
| Backend: Generate endpoint + bulk regenerate endpoint | `routes/clients.ts` additions | 3h |
| Frontend: `DeploymentWizard.tsx` (select pack, assign signals to pages) | `components/signals/DeploymentWizard.tsx` | 8h |
| Frontend: Output download + preview on `ClientDetailPage.tsx` | `pages/ClientDetailPage.tsx` additions | 4h |
| Frontend: `WalkerOSAdvantageCard.tsx` (comparison card on output screen) | `components/signals/WalkerOSAdvantageCard.tsx` | 2h |
| Testing: deploy pack → generate outputs → verify GTM + WalkerOS correctness | Various | 6h |

### Sprint 4 (Week 7–8): Integration, Polish, WalkerOS Migration Path

| Task | Files | Estimate |
|------|-------|----------|
| Backend: Audit from client deployments (resolve signals → validation spec → audit) | `routes/clients.ts`, `services/audit/` adaptations | 8h |
| Backend: Planning Mode integration (compare AI recs against deployed packs) | `services/planning/aiAnalysisService.ts` modifications | 4h |
| Frontend: Planning Mode client selector (when in org context) | `Step1PlanningSetup.tsx` modifications | 3h |
| Frontend: Planning Mode pack comparison ("4 events already in your pack") | `Step4ReviewRecommendations.tsx` modifications | 4h |
| Frontend: Member management (`MemberManagement.tsx`) | `components/organisation/MemberManagement.tsx` | 4h |
| Frontend: Pack version tracking + "X clients outdated" indicator | `PackDetailPage.tsx` additions | 3h |
| Frontend: Bulk regenerate UI ("Regenerate for all 5 clients using this pack") | `PackDetailPage.tsx` additions | 3h |
| WalkerOS migration prompt: show side-by-side comparison on every output page | `WalkerOSAdvantageCard.tsx` refinement | 2h |
| Polish: loading states, error handling, empty states, responsive design | Various | 8h |
| End-to-end testing: create org → add client → build pack → deploy → generate → audit | Various | 6h |
| Documentation: Update CLAUDE.md with composable signals architecture | `CLAUDE.md` | 2h |

---

## 10. WalkerOS Migration Strategy

The composability layer is designed to make WalkerOS the obviously better choice over time. Here's how each touchpoint reinforces this:

### 10.1 Every Output Screen

Show a comparison card:

```
┌─────────────────────────────────────────────────────────┐
│  ⚡ You're generating GTM output.                       │
│     Switch to WalkerOS for composable, version-          │
│     controlled tracking that updates across              │
│     all clients from one place.                          │
│                                                          │
│  GTM: 1 container per client, re-import on every change │
│  WalkerOS: 1 signal pack shared by all clients          │
│                                                          │
│  [Learn more about WalkerOS]  [Try WalkerOS output]     │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Pack Update Moment

When a user updates a signal pack and clicks "Regenerate All":

- **GTM path:** "Regenerating GTM containers for 5 clients. Each developer will need to re-import their container."
- **WalkerOS path:** "Updating signal pack file. All 5 clients reference this file — no re-import needed."

Show both messages, highlight the WalkerOS advantage.

### 10.3 Client Count Growth

When an agency adds their 5th client using the same pack:

"You now have 5 clients using 'Shopify Ecommerce'. With GTM, that's 5 separate containers to maintain. With WalkerOS, it's 1 shared config. [Switch to WalkerOS]"

### 10.4 Audit Findings

When an audit finds a signal issue that exists across multiple clients:

"This issue appears on 3 of your clients using the same pack. With WalkerOS, you'd fix the signal pack once and all clients are updated. With GTM, you'll need to regenerate and re-import for each client."

---

## 11. Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Organisation creation rate | >30% of Agency plan users create an org within 7 days | Track `POST /api/organisations` |
| Clients per org | >3 average after 30 days | Count clients per org |
| Signal pack reuse | >60% of clients use at least one shared pack (not just per-client setup) | Track deployments referencing shared packs |
| Time to onboard 2nd client | <3 minutes (vs. ~15 minutes for 1st) | Timestamp from client creation to output generation |
| Custom signal creation | >1 custom signal per org within 30 days | Track custom signal creation |
| WalkerOS output downloads | >20% of output downloads are WalkerOS (vs. GTM) at 6 months | Track download type |
| WalkerOS migration conversations | >10% of agencies request WalkerOS migration support within 6 months | Track "Learn more about WalkerOS" clicks + support requests |

---

## 12. Out of Scope (for this version)

- WalkerOS destination for Atlas (real-time monitoring via WalkerOS event stream) — this is Phase 3 of the WalkerOS Integration Strategy, separate from composable signals
- Signal pack marketplace (agencies selling packs to each other)
- Git integration (automatically commit WalkerOS configs to client repos)
- Custom GTM tag templates (user-defined tag types beyond standard platforms)
- Role-based permissions beyond owner/admin/member (e.g., read-only client access)
- White-labeling of organisation workspace
- Billing per organisation (currently billing is per-user)
