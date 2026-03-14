# Composable Signals & Agency Workspaces — Database Migrations

Run these migrations in Supabase SQL Editor in order.

---

## Migration 1: Organisations & Clients

```sql
-- ============================================================
-- ORGANISATIONS & CLIENTS
-- ============================================================

CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  plan TEXT NOT NULL DEFAULT 'agency' CHECK (plan IN ('pro', 'agency')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  UNIQUE(organisation_id, user_id)
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  business_type TEXT NOT NULL DEFAULT 'custom' CHECK (business_type IN (
    'ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'
  )),
  detected_platform TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN (
    'ga4', 'google_ads', 'meta', 'sgtm', 'tiktok', 'linkedin'
  )),
  is_active BOOLEAN NOT NULL DEFAULT true,
  measurement_id TEXT,
  config JSONB DEFAULT '{}',
  UNIQUE(client_id, platform)
);

CREATE TABLE client_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'custom',
  stage_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_organisations_owner ON organisations(owner_id);
CREATE INDEX idx_organisations_slug ON organisations(slug);
CREATE INDEX idx_org_members_org ON organisation_members(organisation_id);
CREATE INDEX idx_org_members_user ON organisation_members(user_id);
CREATE INDEX idx_clients_org ON clients(organisation_id);
CREATE INDEX idx_client_platforms_client ON client_platforms(client_id);
CREATE INDEX idx_client_pages_client ON client_pages(client_id);

-- RLS
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members access own org" ON organisations
  FOR SELECT USING (id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()));
CREATE POLICY "Owners manage org" ON organisations
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "Members see org members" ON organisation_members
  FOR SELECT USING (organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins manage members" ON organisation_members
  FOR ALL USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

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

---

## Migration 2: Link Existing Tables to Clients

```sql
ALTER TABLE planning_sessions ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE journeys ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE audits ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX idx_planning_sessions_client ON planning_sessions(client_id);
CREATE INDEX idx_journeys_client ON journeys(client_id);
CREATE INDEX idx_audits_client ON audits(client_id);
```

---

## Migration 3: Signal Library

```sql
-- ============================================================
-- SIGNAL LIBRARY
-- ============================================================

CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('conversion', 'engagement', 'navigation', 'custom')),
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  source_action_primitive TEXT,
  required_params JSONB NOT NULL DEFAULT '[]',
  optional_params JSONB NOT NULL DEFAULT '[]',
  platform_mappings JSONB NOT NULL DEFAULT '{}',
  walkeros_mapping JSONB DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, key)
);

CREATE TABLE signal_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  business_type TEXT NOT NULL DEFAULT 'custom',
  is_system BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  signals_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signal_pack_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  stage_hint TEXT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(pack_id, signal_id)
);

-- Indexes
CREATE INDEX idx_signals_org ON signals(organisation_id);
CREATE INDEX idx_signals_system ON signals(is_system) WHERE is_system = true;
CREATE INDEX idx_signals_key ON signals(key);
CREATE INDEX idx_signal_packs_org ON signal_packs(organisation_id);
CREATE INDEX idx_signal_packs_system ON signal_packs(is_system) WHERE is_system = true;
CREATE INDEX idx_signal_pack_signals_pack ON signal_pack_signals(pack_id);
CREATE INDEX idx_signal_pack_signals_signal ON signal_pack_signals(signal_id);

-- RLS
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_pack_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read system signals" ON signals FOR SELECT USING (is_system = true);
CREATE POLICY "Org members access org signals" ON signals
  FOR ALL USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Read system packs" ON signal_packs FOR SELECT USING (is_system = true);
CREATE POLICY "Org members access org packs" ON signal_packs
  FOR ALL USING (organisation_id IN (
    SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Access pack signals via pack" ON signal_pack_signals
  FOR ALL USING (pack_id IN (
    SELECT id FROM signal_packs WHERE is_system = true
    UNION
    SELECT sp.id FROM signal_packs sp
    JOIN organisation_members om ON om.organisation_id = sp.organisation_id
    WHERE om.user_id = auth.uid()
  ));
```

---

## Migration 4: Deployments & Client Outputs

```sql
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES signal_packs(id) ON DELETE CASCADE,
  signal_overrides JSONB DEFAULT '{}',
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_generated_at TIMESTAMPTZ,
  UNIQUE(client_id, pack_id)
);

CREATE TABLE client_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  output_type TEXT NOT NULL CHECK (output_type IN (
    'gtm_container', 'walkeros_flow', 'datalayer_spec', 'implementation_guide'
  )),
  output_data JSONB,
  file_path TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  source_deployments JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_client ON deployments(client_id);
CREATE INDEX idx_deployments_pack ON deployments(pack_id);
CREATE INDEX idx_client_outputs_client ON client_outputs(client_id);

ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members access deployments" ON deployments
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN organisation_members om ON om.organisation_id = c.organisation_id
    WHERE om.user_id = auth.uid()
  ));

CREATE POLICY "Org members access client outputs" ON client_outputs
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clients c
    JOIN organisation_members om ON om.organisation_id = c.organisation_id
    WHERE om.user_id = auth.uid()
  ));
```

---

## Migration 5: System Signal Seed Data

Run the full INSERT statements from Section 3.2 and 3.3 of `ATLAS_Composable_Signals_PRD.md`.

This seeds the 8 system signals (purchase, add_to_cart, begin_checkout, generate_lead, sign_up,
view_item, view_item_list, search) and the 4 system packs (Ecommerce Standard, SaaS Standard,
Lead Generation Standard, Content & Media).
