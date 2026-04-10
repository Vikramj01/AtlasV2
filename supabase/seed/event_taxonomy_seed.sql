-- ============================================================
-- Atlas: System Event Taxonomy Seed Data
-- File: supabase/seed/event_taxonomy_seed.sql
--
-- Seeds the default Atlas taxonomy (organization_id = NULL, is_system = true).
-- Users can read these but cannot modify or delete them (RLS policy).
-- Run after applying migration 20260410_001_event_taxonomy.sql:
--   psql $DATABASE_URL -f supabase/seed/event_taxonomy_seed.sql
-- ============================================================

-- ─── ROOT CATEGORIES ──────────────────────────────────────────────────────────

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, icon, display_order, is_system) VALUES
  ('11111111-0000-0000-0000-000000000001', NULL, NULL, 'ecommerce',       0, 'ecommerce',       'Ecommerce',       'Online shopping and transaction events',   'category', NULL, 'ShoppingCart',      1, true),
  ('11111111-0000-0000-0000-000000000002', NULL, NULL, 'lead_generation', 0, 'lead_generation', 'Lead Generation', 'Lead capture and qualification events',    'category', NULL, 'UserPlus',          2, true),
  ('11111111-0000-0000-0000-000000000003', NULL, NULL, 'engagement',      0, 'engagement',      'Engagement',      'Content interaction and engagement events','category', NULL, 'MousePointerClick', 3, true),
  ('11111111-0000-0000-0000-000000000004', NULL, NULL, 'account',         0, 'account',         'Account',         'User registration and authentication events','category', NULL, 'User',             4, true),
  ('11111111-0000-0000-0000-000000000005', NULL, NULL, 'content',         0, 'content',         'Content',         'Content consumption and media events',     'category', NULL, 'FileText',          5, true)
ON CONFLICT DO NOTHING;

-- ─── SUBCATEGORIES ────────────────────────────────────────────────────────────

INSERT INTO event_taxonomy (id, organization_id, parent_id, path, depth, slug, name, description, node_type, display_order, is_system) VALUES
  -- Ecommerce
  ('22222222-0000-0000-0000-000000000001', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/product',   1, 'product',   'Product',   'Product browsing events',             'category', 1, true),
  ('22222222-0000-0000-0000-000000000002', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/cart',      1, 'cart',      'Cart',      'Shopping cart events',                'category', 2, true),
  ('22222222-0000-0000-0000-000000000003', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/checkout',  1, 'checkout',  'Checkout',  'Checkout funnel events',              'category', 3, true),
  ('22222222-0000-0000-0000-000000000004', NULL, '11111111-0000-0000-0000-000000000001', 'ecommerce/promotion', 1, 'promotion', 'Promotion', 'Promotional interaction events',      'category', 4, true),
  -- Lead Generation
  ('22222222-0000-0000-0000-000000000005', NULL, '11111111-0000-0000-0000-000000000002', 'lead_generation/form',     1, 'form',     'Forms',    'Form interaction events',   'category', 1, true),
  ('22222222-0000-0000-0000-000000000006', NULL, '11111111-0000-0000-0000-000000000002', 'lead_generation/contact',  1, 'contact',  'Contact',  'Direct contact events',     'category', 2, true),
  ('22222222-0000-0000-0000-000000000007', NULL, '11111111-0000-0000-0000-000000000002', 'lead_generation/download', 1, 'download', 'Download', 'Content download events',   'category', 3, true),
  -- Engagement
  ('22222222-0000-0000-0000-000000000008', NULL, '11111111-0000-0000-0000-000000000003', 'engagement/interaction', 1, 'interaction', 'Interaction', 'User interaction events', 'category', 1, true),
  ('22222222-0000-0000-0000-000000000009', NULL, '11111111-0000-0000-0000-000000000003', 'engagement/navigation',  1, 'navigation',  'Navigation',  'Site navigation events',  'category', 2, true),
  -- Content
  ('22222222-0000-0000-0000-000000000010', NULL, '11111111-0000-0000-0000-000000000005', 'content/media',   1, 'media',   'Media',   'Video and audio events',       'category', 1, true),
  ('22222222-0000-0000-0000-000000000011', NULL, '11111111-0000-0000-0000-000000000005', 'content/article', 1, 'article', 'Article', 'Article and blog events',      'category', 2, true)
ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: ECOMMERCE / PRODUCT ─────────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000001', 'ecommerce/product/view_item', 2, 'view_item', 'View Item',
 'User views a product detail page', 'event', 'consideration', 1, true,
 '{"required":[{"key":"item_id","label":"Product ID","type":"string","description":"Unique product identifier (SKU or internal ID)","format":null},{"key":"item_name","label":"Product Name","type":"string","description":"Product display name","format":null}],"optional":[{"key":"value","label":"Price","type":"number","description":"Product price","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217 currency code","format":"iso_4217"},{"key":"item_brand","label":"Brand","type":"string","description":"Product brand","format":null},{"key":"item_category","label":"Category","type":"string","description":"Product category","format":null},{"key":"item_variant","label":"Variant","type":"string","description":"Product variant (e.g., colour, size)","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"view_item","param_mapping":{"item_id":"items[0].item_id","item_name":"items[0].item_name","value":"value","currency":"currency"},"required_params":["items"]},"meta":{"event_name":"ViewContent","param_mapping":{"item_id":"content_ids[0]","item_name":"content_name","value":"value","currency":"currency"},"additional_params":{"content_type":"product"}},"google_ads":{"event_name":"view_item","param_mapping":{"value":"value","currency":"currency"}},"tiktok":{"event_name":"ViewContent","param_mapping":{"item_id":"content_id","value":"value","currency":"currency"}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"VIEW_CONTENT","param_mapping":{"item_id":"item_ids[0]","value":"price","currency":"currency"}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000001', 'ecommerce/product/view_item_list', 2, 'view_item_list', 'View Item List',
 'User views a product listing or category page', 'event', 'awareness', 2, true,
 '{"required":[{"key":"item_list_id","label":"List ID","type":"string","description":"Unique identifier for the product list","format":null},{"key":"item_list_name","label":"List Name","type":"string","description":"Name of the product list (e.g., Search Results, Category: Shoes)","format":null}],"optional":[{"key":"items","label":"Products","type":"array","description":"Array of products displayed","format":"ga4_items"}]}'::jsonb,
 '{"ga4":{"event_name":"view_item_list","param_mapping":{"item_list_id":"item_list_id","item_list_name":"item_list_name","items":"items"}},"meta":{"event_name":"ViewContent","param_mapping":{"item_list_name":"content_name"},"additional_params":{"content_type":"product_group"}},"google_ads":{"event_name":"view_item_list","param_mapping":{}},"tiktok":{"event_name":"ViewContent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"VIEW_CONTENT","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000001', 'ecommerce/product/select_item', 2, 'select_item', 'Select Item',
 'User clicks on a product from a list', 'event', 'consideration', 3, true,
 '{"required":[{"key":"item_id","label":"Product ID","type":"string","description":"Selected product identifier","format":null}],"optional":[{"key":"item_list_name","label":"Source List","type":"string","description":"Which list the product was selected from","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"select_item","param_mapping":{"item_id":"items[0].item_id"}},"meta":{"event_name":"ViewContent","param_mapping":{"item_id":"content_ids[0]"}},"google_ads":{"event_name":"select_item","param_mapping":{}},"tiktok":{"event_name":"ClickButton","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"VIEW_CONTENT","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: ECOMMERCE / CART ────────────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000002', 'ecommerce/cart/add_to_cart', 2, 'add_to_cart', 'Add to Cart',
 'User adds a product to their shopping cart', 'event', 'consideration', 1, true,
 '{"required":[{"key":"item_id","label":"Product ID","type":"string","description":"Product being added","format":null},{"key":"value","label":"Cart Value","type":"number","description":"Value of items added","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217 currency code","format":"iso_4217"}],"optional":[{"key":"item_name","label":"Product Name","type":"string","description":"Product display name","format":null},{"key":"quantity","label":"Quantity","type":"integer","description":"Number of items added","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"add_to_cart","param_mapping":{"item_id":"items[0].item_id","value":"value","currency":"currency"},"required_params":["items","value","currency"]},"meta":{"event_name":"AddToCart","param_mapping":{"item_id":"content_ids[0]","value":"value","currency":"currency"},"additional_params":{"content_type":"product"},"required_params":["value","currency"]},"google_ads":{"event_name":"add_to_cart","param_mapping":{"value":"value","currency":"currency"}},"tiktok":{"event_name":"AddToCart","param_mapping":{"item_id":"content_id","value":"value","currency":"currency"}},"linkedin":{"event_name":"conversion","param_mapping":{"value":"conversionValue"}},"snapchat":{"event_name":"ADD_CART","param_mapping":{"item_id":"item_ids[0]","value":"price","currency":"currency"}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000002', 'ecommerce/cart/remove_from_cart', 2, 'remove_from_cart', 'Remove from Cart',
 'User removes a product from their cart', 'event', 'consideration', 2, true,
 '{"required":[{"key":"item_id","label":"Product ID","type":"string","description":"Product being removed","format":null}],"optional":[{"key":"value","label":"Value","type":"number","description":"Value of removed items","format":"currency"}]}'::jsonb,
 '{"ga4":{"event_name":"remove_from_cart","param_mapping":{"item_id":"items[0].item_id"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"RemoveFromCart"},"google_ads":{"event_name":"remove_from_cart","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000002', 'ecommerce/cart/view_cart', 2, 'view_cart', 'View Cart',
 'User views their shopping cart', 'event', 'consideration', 3, true,
 '{"required":[{"key":"value","label":"Cart Value","type":"number","description":"Total cart value","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217","format":"iso_4217"}],"optional":[{"key":"items","label":"Products","type":"array","description":"Cart contents","format":"ga4_items"}]}'::jsonb,
 '{"ga4":{"event_name":"view_cart","param_mapping":{"value":"value","currency":"currency","items":"items"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"ViewCart"},"google_ads":{"event_name":"view_cart","param_mapping":{}},"tiktok":{"event_name":"ViewContent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"VIEW_CONTENT","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: ECOMMERCE / CHECKOUT ────────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/begin_checkout', 2, 'begin_checkout', 'Begin Checkout',
 'User initiates the checkout process', 'event', 'conversion', 1, true,
 '{"required":[{"key":"value","label":"Checkout Value","type":"number","description":"Total checkout value","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217","format":"iso_4217"}],"optional":[{"key":"items","label":"Products","type":"array","description":"Products in checkout","format":"ga4_items"},{"key":"coupon","label":"Coupon","type":"string","description":"Applied coupon code","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"begin_checkout","param_mapping":{"value":"value","currency":"currency"}},"meta":{"event_name":"InitiateCheckout","param_mapping":{"value":"value","currency":"currency"},"additional_params":{"content_type":"product"}},"google_ads":{"event_name":"begin_checkout","param_mapping":{"value":"value","currency":"currency"}},"tiktok":{"event_name":"InitiateCheckout","param_mapping":{"value":"value","currency":"currency"}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"START_CHECKOUT","param_mapping":{"value":"price","currency":"currency"}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/add_shipping_info', 2, 'add_shipping_info', 'Add Shipping Info',
 'User submits their shipping address', 'event', 'conversion', 2, true,
 '{"required":[{"key":"shipping_tier","label":"Shipping Tier","type":"string","description":"e.g., standard, express, next_day","format":null}],"optional":[{"key":"value","label":"Value","type":"number","description":"Order value","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217","format":"iso_4217"}]}'::jsonb,
 '{"ga4":{"event_name":"add_shipping_info","param_mapping":{"shipping_tier":"shipping_tier","value":"value"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"AddShippingInfo"},"google_ads":{"event_name":"add_shipping_info","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/add_payment_info', 2, 'add_payment_info', 'Add Payment Info',
 'User submits payment information', 'event', 'conversion', 3, true,
 '{"required":[{"key":"payment_type","label":"Payment Method","type":"string","description":"e.g., credit_card, paypal, apple_pay","format":null}],"optional":[{"key":"value","label":"Value","type":"number","description":"Order value","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217","format":"iso_4217"}]}'::jsonb,
 '{"ga4":{"event_name":"add_payment_info","param_mapping":{"payment_type":"payment_type","value":"value"}},"meta":{"event_name":"AddPaymentInfo","param_mapping":{"value":"value","currency":"currency"}},"google_ads":{"event_name":"add_payment_info","param_mapping":{}},"tiktok":{"event_name":"AddPaymentInfo","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"ADD_BILLING","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/purchase', 2, 'purchase', 'Purchase',
 'A transaction is completed', 'event', 'conversion', 4, true,
 '{"required":[{"key":"transaction_id","label":"Order ID","type":"string","description":"Unique order/transaction identifier","format":null},{"key":"value","label":"Order Total","type":"number","description":"Total transaction value","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217 currency code","format":"iso_4217"}],"optional":[{"key":"items","label":"Products","type":"array","description":"Array of purchased items","format":"ga4_items"},{"key":"tax","label":"Tax","type":"number","description":"Tax amount","format":"currency"},{"key":"shipping","label":"Shipping","type":"number","description":"Shipping cost","format":"currency"},{"key":"coupon","label":"Coupon","type":"string","description":"Applied coupon code","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"purchase","param_mapping":{"transaction_id":"transaction_id","value":"value","currency":"currency","items":"items","tax":"tax","shipping":"shipping","coupon":"coupon"},"required_params":["transaction_id","value","currency"]},"meta":{"event_name":"Purchase","param_mapping":{"transaction_id":"order_id","value":"value","currency":"currency","items":"content_ids"},"additional_params":{"content_type":"product"},"required_params":["value","currency"]},"google_ads":{"event_name":"conversion","param_mapping":{"transaction_id":"transaction_id","value":"value","currency":"currency"},"requires_conversion_label":true},"tiktok":{"event_name":"CompletePayment","param_mapping":{"transaction_id":"order_id","value":"value","currency":"currency","items":"contents"}},"linkedin":{"event_name":"conversion","param_mapping":{"value":"conversionValue","currency":"currency"}},"snapchat":{"event_name":"PURCHASE","param_mapping":{"transaction_id":"transaction_id","value":"price","currency":"currency"}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000003', 'ecommerce/checkout/refund', 2, 'refund', 'Refund',
 'A transaction is fully or partially refunded', 'event', 'retention', 5, true,
 '{"required":[{"key":"transaction_id","label":"Order ID","type":"string","description":"Original order identifier","format":null}],"optional":[{"key":"value","label":"Refund Amount","type":"number","description":"Amount being refunded","format":"currency"},{"key":"currency","label":"Currency","type":"string","description":"ISO 4217","format":"iso_4217"},{"key":"items","label":"Refunded Items","type":"array","description":"Items being refunded","format":"ga4_items"}]}'::jsonb,
 '{"ga4":{"event_name":"refund","param_mapping":{"transaction_id":"transaction_id","value":"value","currency":"currency"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"Refund"},"google_ads":{"event_name":"refund","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: ECOMMERCE / PROMOTION ───────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000004', 'ecommerce/promotion/view_promotion', 2, 'view_promotion', 'View Promotion',
 'User sees a promotional banner or offer', 'event', 'awareness', 1, true,
 '{"required":[{"key":"promotion_id","label":"Promotion ID","type":"string","description":"Unique identifier for the promotion","format":null},{"key":"promotion_name","label":"Promotion Name","type":"string","description":"Name of the promotion","format":null}],"optional":[{"key":"creative_name","label":"Creative Name","type":"string","description":"Name of the creative variant","format":null},{"key":"creative_slot","label":"Creative Slot","type":"string","description":"Position of the creative (e.g., hero_banner)","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"view_promotion","param_mapping":{"promotion_id":"promotion_id","promotion_name":"promotion_name","creative_name":"creative_name","creative_slot":"creative_slot"}},"meta":{"event_name":"ViewContent","param_mapping":{"promotion_name":"content_name"}},"google_ads":{"event_name":"view_promotion","param_mapping":{}},"tiktok":{"event_name":"ViewContent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"VIEW_CONTENT","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000004', 'ecommerce/promotion/select_promotion', 2, 'select_promotion', 'Select Promotion',
 'User clicks on a promotional banner or offer', 'event', 'consideration', 2, true,
 '{"required":[{"key":"promotion_id","label":"Promotion ID","type":"string","description":"Unique identifier for the promotion","format":null},{"key":"promotion_name","label":"Promotion Name","type":"string","description":"Name of the promotion","format":null}],"optional":[{"key":"creative_slot","label":"Creative Slot","type":"string","description":"Position of the creative","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"select_promotion","param_mapping":{"promotion_id":"promotion_id","promotion_name":"promotion_name"}},"meta":{"event_name":"ViewContent","param_mapping":{"promotion_name":"content_name"}},"google_ads":{"event_name":"select_promotion","param_mapping":{}},"tiktok":{"event_name":"ClickButton","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: LEAD GENERATION / FORM ──────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000005', 'lead_generation/form/form_start', 2, 'form_start', 'Form Start',
 'User begins interacting with a form (first field focus)', 'event', 'consideration', 1, true,
 '{"required":[{"key":"form_id","label":"Form ID","type":"string","description":"Unique form identifier","format":null}],"optional":[{"key":"form_name","label":"Form Name","type":"string","description":"Form display name","format":null},{"key":"form_type","label":"Form Type","type":"string","description":"e.g., contact, quote, demo_request","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"form_start","param_mapping":{"form_id":"form_id","form_name":"form_name"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"FormStart"},"google_ads":{"event_name":"form_start","param_mapping":{}},"tiktok":{"event_name":"ClickButton","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000005', 'lead_generation/form/form_submit', 2, 'form_submit', 'Form Submit',
 'User successfully submits a form (lead captured)', 'event', 'conversion', 2, true,
 '{"required":[{"key":"form_id","label":"Form ID","type":"string","description":"Unique form identifier","format":null}],"optional":[{"key":"form_name","label":"Form Name","type":"string","description":"Form display name","format":null},{"key":"form_type","label":"Form Type","type":"string","description":"e.g., contact, quote, demo_request","format":null},{"key":"value","label":"Lead Value","type":"number","description":"Estimated lead value","format":"currency"}]}'::jsonb,
 '{"ga4":{"event_name":"generate_lead","param_mapping":{"value":"value","currency":"currency"}},"meta":{"event_name":"Lead","param_mapping":{"value":"value","currency":"currency"}},"google_ads":{"event_name":"conversion","param_mapping":{"value":"value"},"requires_conversion_label":true},"tiktok":{"event_name":"SubmitForm","param_mapping":{"value":"value"}},"linkedin":{"event_name":"conversion","param_mapping":{"value":"conversionValue"}},"snapchat":{"event_name":"SIGN_UP","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: LEAD GENERATION / CONTACT ───────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000006', 'lead_generation/contact/phone_click', 2, 'phone_click', 'Phone Click',
 'User clicks a phone number link', 'event', 'conversion', 1, true,
 '{"required":[{"key":"link_url","label":"Phone URL","type":"string","description":"The tel: link clicked","format":null}],"optional":[{"key":"page_location","label":"Page","type":"string","description":"Page where the click occurred","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"click","param_mapping":{"link_url":"link_url"},"additional_params":{"link_type":"phone"}},"meta":{"event_name":"Contact","param_mapping":{}},"google_ads":{"event_name":"conversion","param_mapping":{}},"tiktok":{"event_name":"Contact","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000006', 'lead_generation/contact/email_click', 2, 'email_click', 'Email Click',
 'User clicks an email link', 'event', 'conversion', 2, true,
 '{"required":[{"key":"link_url","label":"Email URL","type":"string","description":"The mailto: link clicked","format":null}],"optional":[]}'::jsonb,
 '{"ga4":{"event_name":"click","param_mapping":{"link_url":"link_url"},"additional_params":{"link_type":"email"}},"meta":{"event_name":"Contact","param_mapping":{}},"google_ads":{"event_name":"conversion","param_mapping":{}},"tiktok":{"event_name":"Contact","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000006', 'lead_generation/contact/chat_start', 2, 'chat_start', 'Chat Start',
 'User initiates a live chat session', 'event', 'consideration', 3, true,
 '{"required":[],"optional":[{"key":"chat_provider","label":"Chat Provider","type":"string","description":"e.g., Intercom, Drift, LiveChat","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"click","param_mapping":{},"additional_params":{"link_type":"chat"}},"meta":{"event_name":"Contact","param_mapping":{}},"google_ads":{"event_name":"conversion","param_mapping":{}},"tiktok":{"event_name":"Contact","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: LEAD GENERATION / DOWNLOAD ──────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000007', 'lead_generation/download/content_download', 2, 'content_download', 'Content Download',
 'User downloads gated or ungated content', 'event', 'consideration', 1, true,
 '{"required":[{"key":"file_name","label":"File Name","type":"string","description":"Name of downloaded file","format":null}],"optional":[{"key":"file_type","label":"File Type","type":"string","description":"e.g., pdf, ebook, whitepaper","format":null},{"key":"content_category","label":"Content Category","type":"string","description":"Topic or category of the content","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"file_download","param_mapping":{"file_name":"file_name"}},"meta":{"event_name":"Lead","param_mapping":{}},"google_ads":{"event_name":"conversion","param_mapping":{}},"tiktok":{"event_name":"Download","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: ENGAGEMENT / INTERACTION ────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/search', 2, 'search', 'Site Search',
 'User performs a search on the website', 'event', 'consideration', 1, true,
 '{"required":[{"key":"search_term","label":"Search Term","type":"string","description":"What the user searched for","format":null}],"optional":[{"key":"results_count","label":"Results Count","type":"integer","description":"Number of results returned","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"search","param_mapping":{"search_term":"search_term"}},"meta":{"event_name":"Search","param_mapping":{"search_term":"search_string"}},"google_ads":{"event_name":"search","param_mapping":{}},"tiktok":{"event_name":"Search","param_mapping":{"search_term":"query"}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"SEARCH","param_mapping":{"search_term":"search_string"}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/share', 2, 'share', 'Share',
 'User shares content via social or native share', 'event', 'advocacy', 2, true,
 '{"required":[{"key":"method","label":"Share Method","type":"string","description":"How content was shared (e.g., email, twitter, copy_link)","format":null}],"optional":[{"key":"content_type","label":"Content Type","type":"string","description":"Type of content shared","format":null},{"key":"item_id","label":"Item ID","type":"string","description":"Identifier of shared item","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"share","param_mapping":{"method":"method","content_type":"content_type","item_id":"item_id"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"Share"},"google_ads":{"event_name":"share","param_mapping":{}},"tiktok":{"event_name":"ClickButton","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"SHARE","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/scroll_depth', 2, 'scroll_depth', 'Scroll Depth',
 'User reaches a scroll depth threshold', 'event', 'awareness', 3, true,
 '{"required":[{"key":"percent_scrolled","label":"Scroll Percentage","type":"integer","description":"Percentage of page scrolled (25, 50, 75, 90, 100)","format":null}],"optional":[{"key":"page_location","label":"Page URL","type":"string","description":"Page where scroll occurred","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"scroll","param_mapping":{"percent_scrolled":"percent_scrolled"}},"meta":{"event_name":"CustomEvent","param_mapping":{"percent_scrolled":"value"},"custom_event_name":"ScrollDepth"},"google_ads":{"event_name":"scroll","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000008', 'engagement/interaction/click', 2, 'click', 'Link Click',
 'User clicks an outbound or tracked internal link', 'event', 'consideration', 4, true,
 '{"required":[{"key":"link_url","label":"Link URL","type":"string","description":"Destination URL","format":"url"}],"optional":[{"key":"link_text","label":"Link Text","type":"string","description":"Visible text of the link","format":null},{"key":"outbound","label":"Outbound","type":"boolean","description":"True if navigating away from the site","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"click","param_mapping":{"link_url":"link_url","link_text":"link_text","outbound":"outbound"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"LinkClick"},"google_ads":{"event_name":"click","param_mapping":{}},"tiktok":{"event_name":"ClickButton","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: CONTENT / MEDIA ─────────────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '22222222-0000-0000-0000-000000000010', 'content/media/video_start', 2, 'video_start', 'Video Start',
 'User starts playing a video', 'event', 'awareness', 1, true,
 '{"required":[{"key":"video_title","label":"Video Title","type":"string","description":"Title of the video","format":null}],"optional":[{"key":"video_url","label":"Video URL","type":"string","description":"URL of the video","format":null},{"key":"video_provider","label":"Provider","type":"string","description":"e.g., youtube, vimeo, self_hosted","format":null},{"key":"video_duration","label":"Duration (s)","type":"integer","description":"Video duration in seconds","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"video_start","param_mapping":{"video_title":"video_title","video_url":"video_url","video_provider":"video_provider"}},"meta":{"event_name":"ViewContent","param_mapping":{"video_title":"content_name"},"additional_params":{"content_type":"video"}},"google_ads":{"event_name":"video_start","param_mapping":{}},"tiktok":{"event_name":"ViewContent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"VIEW_CONTENT","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000010', 'content/media/video_progress', 2, 'video_progress', 'Video Progress',
 'User reaches a video playback milestone (25%, 50%, 75%)', 'event', 'consideration', 2, true,
 '{"required":[{"key":"video_title","label":"Video Title","type":"string","description":"Title of the video","format":null},{"key":"video_percent","label":"Progress %","type":"integer","description":"Percentage of video watched (25, 50, 75)","format":null}],"optional":[{"key":"video_duration","label":"Duration (s)","type":"integer","description":"Total video duration","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"video_progress","param_mapping":{"video_title":"video_title","video_percent":"video_percent"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"VideoProgress"},"google_ads":{"event_name":"video_progress","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
),

(NULL, '22222222-0000-0000-0000-000000000010', 'content/media/video_complete', 2, 'video_complete', 'Video Complete',
 'User watches a video to completion', 'event', 'consideration', 3, true,
 '{"required":[{"key":"video_title","label":"Video Title","type":"string","description":"Title of the video","format":null}],"optional":[{"key":"video_url","label":"Video URL","type":"string","description":"URL of the video","format":null},{"key":"video_duration","label":"Duration (s)","type":"integer","description":"Video duration in seconds","format":null}]}'::jsonb,
 '{"ga4":{"event_name":"video_complete","param_mapping":{"video_title":"video_title"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"VideoComplete"},"google_ads":{"event_name":"video_complete","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"CUSTOM_EVENT_1","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;

-- ─── EVENT NODES: ACCOUNT ─────────────────────────────────────────────────────

INSERT INTO event_taxonomy (organization_id, parent_id, path, depth, slug, name, description, node_type, funnel_stage, display_order, is_system, parameter_schema, platform_mappings) VALUES

(NULL, '11111111-0000-0000-0000-000000000004', 'account/sign_up', 1, 'sign_up', 'Sign Up',
 'User creates a new account', 'event', 'conversion', 1, true,
 '{"required":[{"key":"method","label":"Sign-up Method","type":"string","description":"e.g., email, google, facebook, apple","format":null}],"optional":[{"key":"value","label":"User Value","type":"number","description":"Estimated lifetime value of new user","format":"currency"}]}'::jsonb,
 '{"ga4":{"event_name":"sign_up","param_mapping":{"method":"method"}},"meta":{"event_name":"CompleteRegistration","param_mapping":{"value":"value","currency":"currency"}},"google_ads":{"event_name":"conversion","param_mapping":{"value":"value"},"requires_conversion_label":true},"tiktok":{"event_name":"CompleteRegistration","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"SIGN_UP","param_mapping":{}}}'::jsonb
),

(NULL, '11111111-0000-0000-0000-000000000004', 'account/login', 1, 'login', 'Login',
 'User logs into their account', 'event', 'retention', 2, true,
 '{"required":[{"key":"method","label":"Login Method","type":"string","description":"e.g., email, google, SSO","format":null}],"optional":[]}'::jsonb,
 '{"ga4":{"event_name":"login","param_mapping":{"method":"method"}},"meta":{"event_name":"CustomEvent","param_mapping":{},"custom_event_name":"Login"},"google_ads":{"event_name":"login","param_mapping":{}},"tiktok":{"event_name":"CustomEvent","param_mapping":{}},"linkedin":{"event_name":"conversion","param_mapping":{}},"snapchat":{"event_name":"LOGIN","param_mapping":{}}}'::jsonb
)

ON CONFLICT DO NOTHING;
