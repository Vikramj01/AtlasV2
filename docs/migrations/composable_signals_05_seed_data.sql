-- ============================================================
-- COMPOSABLE SIGNALS — MIGRATION 5
-- System Signal & Pack Seed Data
--
-- Run AFTER migration 3. Idempotent — uses ON CONFLICT DO NOTHING.
-- Seeds 8 system signals and 4 system packs with full platform
-- mappings (GA4, Meta, Google Ads) and WalkerOS config.
--
-- Fixed UUIDs let the pack↔signal joins below work reliably.
-- ============================================================

-- ── 1. System Signals ─────────────────────────────────────────────────────────

INSERT INTO signals (
  id, key, name, description, category,
  is_system, is_custom, source_action_primitive,
  required_params, optional_params,
  platform_mappings, walkeros_mapping,
  version
)
VALUES

-- 1. purchase_complete
(
  'a1000001-0000-4000-8000-000000000001',
  'purchase_complete',
  'Purchase Complete',
  'A completed purchase / order confirmation. The most valuable conversion event.',
  'conversion',
  true, false, 'order_complete',
  '[
    {"key":"transaction_id","label":"Transaction ID","type":"string"},
    {"key":"value","label":"Order Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"},
    {"key":"items","label":"Line Items","type":"array"}
  ]'::jsonb,
  '[
    {"key":"coupon","label":"Coupon Code","type":"string"},
    {"key":"shipping","label":"Shipping Cost","type":"number"},
    {"key":"tax","label":"Tax Amount","type":"number"},
    {"key":"affiliation","label":"Store Affiliation","type":"string"}
  ]'::jsonb,
  '{
    "ga4": {
      "event_name": "purchase",
      "param_mapping": {
        "transaction_id": "transaction_id",
        "value": "value",
        "currency": "currency",
        "items": "items",
        "coupon": "coupon",
        "shipping": "shipping",
        "tax": "tax"
      }
    },
    "meta": {
      "event_name": "Purchase",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "additional": {
        "content_type": "product"
      }
    },
    "google_ads": {
      "event_name": "conversion",
      "param_mapping": {
        "value": "value",
        "currency": "currency",
        "transaction_id": "order_id"
      }
    }
  }'::jsonb,
  '{
    "entity": "order",
    "action": "complete",
    "trigger": {"type": "load"},
    "data_mapping": {
      "transaction_id": "order_id",
      "value": "revenue",
      "currency": "currency",
      "items": "products"
    }
  }'::jsonb,
  1
),

-- 2. add_to_cart
(
  'a1000002-0000-4000-8000-000000000002',
  'add_to_cart',
  'Add to Cart',
  'User adds a product to the shopping cart. Key upper-funnel purchase signal.',
  'conversion',
  true, false, 'product_add',
  '[
    {"key":"items","label":"Line Items","type":"array"},
    {"key":"value","label":"Item Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '[]'::jsonb,
  '{
    "ga4": {
      "event_name": "add_to_cart",
      "param_mapping": {
        "items": "items",
        "value": "value",
        "currency": "currency"
      }
    },
    "meta": {
      "event_name": "AddToCart",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "additional": {
        "content_type": "product"
      }
    }
  }'::jsonb,
  '{
    "entity": "product",
    "action": "add",
    "trigger": {"type": "click", "selector": "[data-elbaction=''add'']"},
    "data_mapping": {
      "items": "products",
      "value": "price"
    }
  }'::jsonb,
  1
),

-- 3. begin_checkout
(
  'a1000003-0000-4000-8000-000000000003',
  'begin_checkout',
  'Begin Checkout',
  'User enters the checkout flow. Measures checkout initiation rate.',
  'conversion',
  true, false, 'checkout_start',
  '[
    {"key":"items","label":"Line Items","type":"array"},
    {"key":"value","label":"Cart Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '[
    {"key":"coupon","label":"Coupon Code","type":"string"}
  ]'::jsonb,
  '{
    "ga4": {
      "event_name": "begin_checkout",
      "param_mapping": {
        "items": "items",
        "value": "value",
        "currency": "currency",
        "coupon": "coupon"
      }
    },
    "meta": {
      "event_name": "InitiateCheckout",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "additional": {
        "content_type": "product"
      }
    }
  }'::jsonb,
  '{
    "entity": "checkout",
    "action": "start",
    "trigger": {"type": "load"},
    "data_mapping": {
      "items": "products",
      "value": "revenue",
      "currency": "currency"
    }
  }'::jsonb,
  1
),

-- 4. generate_lead
(
  'a1000004-0000-4000-8000-000000000004',
  'generate_lead',
  'Generate Lead',
  'User submits a lead form (contact, demo request, quote). Primary lead-gen conversion.',
  'conversion',
  true, false, 'form_submit',
  '[
    {"key":"value","label":"Lead Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '[
    {"key":"lead_source","label":"Lead Source","type":"string"},
    {"key":"form_id","label":"Form ID","type":"string"}
  ]'::jsonb,
  '{
    "ga4": {
      "event_name": "generate_lead",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      }
    },
    "meta": {
      "event_name": "Lead",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      }
    },
    "google_ads": {
      "event_name": "conversion",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      }
    }
  }'::jsonb,
  '{
    "entity": "lead",
    "action": "submit",
    "trigger": {"type": "submit", "selector": "form"},
    "data_mapping": {
      "value": "value",
      "lead_source": "source",
      "form_id": "form_id"
    }
  }'::jsonb,
  1
),

-- 5. sign_up
(
  'a1000005-0000-4000-8000-000000000005',
  'sign_up',
  'Sign Up / Registration',
  'User creates an account or completes trial registration. Core SaaS activation event.',
  'conversion',
  true, false, 'user_register',
  '[
    {"key":"method","label":"Signup Method","type":"string"}
  ]'::jsonb,
  '[
    {"key":"plan_type","label":"Plan Type","type":"string"},
    {"key":"value","label":"Trial Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '{
    "ga4": {
      "event_name": "sign_up",
      "param_mapping": {
        "method": "method"
      }
    },
    "meta": {
      "event_name": "CompleteRegistration",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "additional": {
        "status": "true"
      }
    },
    "google_ads": {
      "event_name": "conversion",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      }
    }
  }'::jsonb,
  '{
    "entity": "user",
    "action": "register",
    "trigger": {"type": "load"},
    "data_mapping": {
      "method": "signup_method",
      "plan_type": "plan"
    }
  }'::jsonb,
  1
),

-- 6. view_item
(
  'a1000006-0000-4000-8000-000000000006',
  'view_item',
  'View Item / Product',
  'User views a product detail page. Used for remarketing audiences and product performance.',
  'engagement',
  true, false, 'product_view',
  '[
    {"key":"items","label":"Item Detail","type":"array"},
    {"key":"value","label":"Item Value","type":"number"},
    {"key":"currency","label":"Currency Code","type":"string"}
  ]'::jsonb,
  '[]'::jsonb,
  '{
    "ga4": {
      "event_name": "view_item",
      "param_mapping": {
        "items": "items",
        "value": "value",
        "currency": "currency"
      }
    },
    "meta": {
      "event_name": "ViewContent",
      "param_mapping": {
        "value": "value",
        "currency": "currency"
      },
      "additional": {
        "content_type": "product"
      }
    }
  }'::jsonb,
  '{
    "entity": "product",
    "action": "view",
    "trigger": {"type": "load"},
    "data_mapping": {
      "items": "products",
      "value": "price",
      "currency": "currency"
    }
  }'::jsonb,
  1
),

-- 7. view_item_list
(
  'a1000007-0000-4000-8000-000000000007',
  'view_item_list',
  'View Item List',
  'User views a category, collection, or search results page. Measures listing engagement.',
  'navigation',
  true, false, null,
  '[
    {"key":"items","label":"Items Shown","type":"array"},
    {"key":"item_list_name","label":"List Name","type":"string"}
  ]'::jsonb,
  '[
    {"key":"item_list_id","label":"List ID","type":"string"}
  ]'::jsonb,
  '{
    "ga4": {
      "event_name": "view_item_list",
      "param_mapping": {
        "items": "items",
        "item_list_name": "item_list_name",
        "item_list_id": "item_list_id"
      }
    },
    "meta": {
      "event_name": "ViewContent",
      "param_mapping": {},
      "additional": {
        "content_type": "product_group"
      }
    }
  }'::jsonb,
  '{
    "entity": "product",
    "action": "list",
    "trigger": {"type": "load"},
    "data_mapping": {
      "items": "products",
      "item_list_name": "list_name",
      "item_list_id": "list_id"
    }
  }'::jsonb,
  1
),

-- 8. search
(
  'a1000008-0000-4000-8000-000000000008',
  'search',
  'Site Search',
  'User performs a search query on the site. Indicates intent and content gaps.',
  'engagement',
  true, false, null,
  '[
    {"key":"search_term","label":"Search Query","type":"string"}
  ]'::jsonb,
  '[]'::jsonb,
  '{
    "ga4": {
      "event_name": "search",
      "param_mapping": {
        "search_term": "search_term"
      }
    },
    "meta": {
      "event_name": "Search",
      "param_mapping": {
        "search_string": "search_term"
      }
    }
  }'::jsonb,
  '{
    "entity": "search",
    "action": "query",
    "trigger": {"type": "submit", "selector": "form[role=''search'']"},
    "data_mapping": {
      "search_term": "query"
    }
  }'::jsonb,
  1
)

ON CONFLICT (id) DO NOTHING;

-- ── 2. System Signal Packs ────────────────────────────────────────────────────

INSERT INTO signal_packs (
  id, name, description, business_type,
  is_system, version, signals_count
)
VALUES

(
  'b1000001-0000-4000-8000-000000000001',
  'Ecommerce Standard',
  'Complete tracking for online stores: purchase funnel from listing to order confirmation.',
  'ecommerce',
  true, 1, 6
),

(
  'b1000002-0000-4000-8000-000000000002',
  'SaaS Standard',
  'Core events for software products: signup, trial activation, and lead capture.',
  'saas',
  true, 1, 3
),

(
  'b1000003-0000-4000-8000-000000000003',
  'Lead Generation Standard',
  'Conversion tracking for lead-gen sites: form submissions and content engagement.',
  'lead_gen',
  true, 1, 2
),

(
  'b1000004-0000-4000-8000-000000000004',
  'Content & Media',
  'Engagement tracking for content sites: page views, lists, and search.',
  'content',
  true, 1, 3
)

ON CONFLICT (id) DO NOTHING;

-- ── 3. Pack ↔ Signal Assignments ─────────────────────────────────────────────

INSERT INTO signal_pack_signals (pack_id, signal_id, stage_hint, is_required, display_order)
VALUES

-- Ecommerce Standard (6 signals)
('b1000001-0000-4000-8000-000000000001', 'a1000001-0000-4000-8000-000000000001', 'purchase',  true,  1),  -- purchase_complete
('b1000001-0000-4000-8000-000000000001', 'a1000002-0000-4000-8000-000000000002', 'cart',      true,  2),  -- add_to_cart
('b1000001-0000-4000-8000-000000000001', 'a1000003-0000-4000-8000-000000000003', 'checkout',  true,  3),  -- begin_checkout
('b1000001-0000-4000-8000-000000000001', 'a1000006-0000-4000-8000-000000000006', 'product',   false, 4),  -- view_item
('b1000001-0000-4000-8000-000000000001', 'a1000007-0000-4000-8000-000000000007', 'listing',   false, 5),  -- view_item_list
('b1000001-0000-4000-8000-000000000001', 'a1000008-0000-4000-8000-000000000008', 'search',    false, 6),  -- search

-- SaaS Standard (3 signals)
('b1000002-0000-4000-8000-000000000002', 'a1000005-0000-4000-8000-000000000005', 'signup',    true,  1),  -- sign_up
('b1000002-0000-4000-8000-000000000002', 'a1000004-0000-4000-8000-000000000004', 'lead',      true,  2),  -- generate_lead
('b1000002-0000-4000-8000-000000000002', 'a1000006-0000-4000-8000-000000000006', 'product',   false, 3),  -- view_item

-- Lead Generation Standard (2 signals)
('b1000003-0000-4000-8000-000000000003', 'a1000004-0000-4000-8000-000000000004', 'conversion', true, 1),  -- generate_lead
('b1000003-0000-4000-8000-000000000003', 'a1000006-0000-4000-8000-000000000006', 'content',   false, 2),  -- view_item

-- Content & Media (3 signals)
('b1000004-0000-4000-8000-000000000004', 'a1000006-0000-4000-8000-000000000006', 'content',   true,  1),  -- view_item
('b1000004-0000-4000-8000-000000000004', 'a1000007-0000-4000-8000-000000000007', 'listing',   true,  2),  -- view_item_list
('b1000004-0000-4000-8000-000000000004', 'a1000008-0000-4000-8000-000000000008', 'search',    false, 3)   -- search

ON CONFLICT (pack_id, signal_id) DO NOTHING;
