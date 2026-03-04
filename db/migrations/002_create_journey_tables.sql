-- ============================================================
-- JOURNEY BUILDER TABLES
-- ============================================================

-- Stores user-defined journeys
CREATE TABLE journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Journey',
  business_type TEXT NOT NULL CHECK (business_type IN (
    'ecommerce', 'saas', 'lead_gen', 'content', 'marketplace', 'custom'
  )),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  implementation_format TEXT NOT NULL DEFAULT 'gtm' CHECK (implementation_format IN ('gtm', 'walkeros', 'both')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual stages within a journey
CREATE TABLE journey_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'custom' CHECK (page_type IN (
    'landing', 'category', 'product', 'cart', 'checkout', 'confirmation',
    'search_results', 'form', 'sign_up', 'pricing', 'features',
    'article', 'listing', 'booking', 'custom'
  )),
  sample_url TEXT,
  actions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(journey_id, stage_order)
);

-- Platform configurations for a journey
CREATE TABLE journey_platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN (
    'ga4', 'google_ads', 'meta', 'sgtm', 'tiktok', 'linkedin'
  )),
  is_active BOOLEAN NOT NULL DEFAULT true,
  measurement_id TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(journey_id, platform)
);

-- Generated technical specs
CREATE TABLE generated_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('gtm_datalayer', 'walkeros_flow', 'validation_spec')),
  spec_data JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit results linked to journey stages
CREATE TABLE journey_audit_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES journey_stages(id) ON DELETE CASCADE,
  stage_status TEXT NOT NULL CHECK (stage_status IN ('healthy', 'issues_found', 'signals_missing', 'not_checked')),
  gaps JSONB NOT NULL DEFAULT '[]',
  raw_capture JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reusable journey templates
CREATE TABLE journey_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  business_type TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  template_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System-maintained action primitives
CREATE TABLE action_primitives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('conversion', 'engagement', 'navigation')),
  required_params JSONB NOT NULL DEFAULT '[]',
  optional_params JSONB NOT NULL DEFAULT '[]',
  platform_mappings JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_journeys_user_id ON journeys(user_id);
CREATE INDEX idx_journeys_status ON journeys(status);
CREATE INDEX idx_journey_stages_journey_id ON journey_stages(journey_id);
CREATE INDEX idx_journey_platforms_journey_id ON journey_platforms(journey_id);
CREATE INDEX idx_generated_specs_journey_id ON generated_specs(journey_id);
CREATE INDEX idx_journey_audit_results_audit_id ON journey_audit_results(audit_id);
CREATE INDEX idx_journey_audit_results_journey_id ON journey_audit_results(journey_id);
CREATE INDEX idx_journey_templates_business_type ON journey_templates(business_type);
CREATE INDEX idx_journey_templates_user_id ON journey_templates(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_audit_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_primitives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own journeys" ON journeys
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own journey stages" ON journey_stages
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can CRUD own journey platforms" ON journey_platforms
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can read own generated specs" ON generated_specs
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can read own audit results" ON journey_audit_results
  FOR ALL USING (journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid()));

CREATE POLICY "Users can read available templates" ON journey_templates
  FOR SELECT USING (is_system = true OR user_id = auth.uid() OR is_shared = true);

CREATE POLICY "Users can CRUD own templates" ON journey_templates
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "All users can read action primitives" ON action_primitives
  FOR SELECT USING (true);

-- ============================================================
-- SEED: System Journey Templates
-- ============================================================

INSERT INTO journey_templates (name, description, business_type, is_system, template_data) VALUES
(
  'Ecommerce Standard',
  'Standard online store funnel with product browsing, cart, and checkout',
  'ecommerce',
  true,
  '{"stages": [
    {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
    {"order": 2, "label": "Category Page", "page_type": "category", "actions": ["view_item_list"]},
    {"order": 3, "label": "Product Page", "page_type": "product", "actions": ["view_item", "add_to_cart"]},
    {"order": 4, "label": "Cart", "page_type": "cart", "actions": []},
    {"order": 5, "label": "Checkout", "page_type": "checkout", "actions": ["begin_checkout"]},
    {"order": 6, "label": "Purchase Confirmation", "page_type": "confirmation", "actions": ["purchase"]}
  ]}'
),
(
  'SaaS Standard',
  'Software product funnel from landing to sign-up and onboarding',
  'saas',
  true,
  '{"stages": [
    {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
    {"order": 2, "label": "Features", "page_type": "features", "actions": ["view_item"]},
    {"order": 3, "label": "Pricing", "page_type": "pricing", "actions": ["view_item"]},
    {"order": 4, "label": "Sign Up", "page_type": "sign_up", "actions": ["sign_up"]},
    {"order": 5, "label": "Onboarding Complete", "page_type": "confirmation", "actions": ["purchase"]}
  ]}'
),
(
  'Lead Generation Standard',
  'Service business funnel with form submission',
  'lead_gen',
  true,
  '{"stages": [
    {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
    {"order": 2, "label": "Service Pages", "page_type": "custom", "actions": ["view_item"]},
    {"order": 3, "label": "Contact Form", "page_type": "form", "actions": ["generate_lead"]},
    {"order": 4, "label": "Thank You Page", "page_type": "confirmation", "actions": []}
  ]}'
),
(
  'Content / Media',
  'Content site funnel with newsletter conversion',
  'content',
  true,
  '{"stages": [
    {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
    {"order": 2, "label": "Article Page", "page_type": "article", "actions": ["view_item"]},
    {"order": 3, "label": "Newsletter Signup", "page_type": "sign_up", "actions": ["sign_up"]},
    {"order": 4, "label": "Confirmation", "page_type": "confirmation", "actions": []}
  ]}'
),
(
  'Marketplace Standard',
  'Marketplace funnel from search to booking/purchase',
  'marketplace',
  true,
  '{"stages": [
    {"order": 1, "label": "Landing Page", "page_type": "landing", "actions": ["ad_landing"]},
    {"order": 2, "label": "Search Results", "page_type": "search_results", "actions": ["search", "view_item_list"]},
    {"order": 3, "label": "Listing Page", "page_type": "listing", "actions": ["view_item"]},
    {"order": 4, "label": "Enquiry / Booking", "page_type": "booking", "actions": ["begin_checkout", "generate_lead"]},
    {"order": 5, "label": "Confirmation", "page_type": "confirmation", "actions": ["purchase"]}
  ]}'
);
