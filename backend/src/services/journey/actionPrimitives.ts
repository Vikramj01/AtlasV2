import type { ActionPrimitive } from '../../types/journey';

export const ACTION_PRIMITIVES: ActionPrimitive[] = [
  {
    key: 'purchase',
    label: 'People buy something here',
    description: 'A transaction is completed on this page',
    category: 'conversion',
    required_params: [
      { key: 'transaction_id', label: 'Order ID', type: 'string', description: 'Unique identifier for this order from your system', example: 'ORDER-12345' },
      { key: 'value', label: 'Order Total', type: 'number', description: 'Total value of the order', example: '99.99' },
      { key: 'currency', label: 'Currency', type: 'string', description: 'Currency code (e.g., USD, SGD, EUR)', example: 'USD' },
    ],
    optional_params: [
      { key: 'items', label: 'Products Purchased', type: 'array', description: 'Array of product objects', example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99, quantity: 2}]' },
      { key: 'tax', label: 'Tax Amount', type: 'number', description: 'Tax amount for the order', example: '8.50' },
      { key: 'shipping', label: 'Shipping Cost', type: 'number', description: 'Shipping cost for the order', example: '5.99' },
      { key: 'coupon', label: 'Coupon Code', type: 'string', description: 'Coupon or discount code used', example: 'SAVE10' },
      { key: 'user_email', label: 'Customer Email', type: 'string', description: 'Customer email (will be hashed for ad platforms)', example: 'customer@example.com' },
      { key: 'user_phone', label: 'Customer Phone', type: 'string', description: 'Customer phone (will be hashed for ad platforms)', example: '+6591234567' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'purchase', param_mapping: { transaction_id: 'transaction_id', value: 'value', currency: 'currency', items: 'items', tax: 'tax', shipping: 'shipping', coupon: 'coupon' }, payload_template: 'ga4_purchase', additional_params: {} },
      { platform: 'meta', event_name: 'Purchase', param_mapping: { transaction_id: 'order_id', value: 'value', currency: 'currency', items: 'content_ids', user_email: 'em', user_phone: 'ph' }, payload_template: 'meta_purchase', additional_params: { content_type: 'product' } },
      { platform: 'google_ads', event_name: 'conversion', param_mapping: { transaction_id: 'transaction_id', value: 'value', currency: 'currency' }, payload_template: 'gads_conversion', additional_params: { send_to: '{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}' } },
      { platform: 'tiktok', event_name: 'CompletePayment', param_mapping: { transaction_id: 'order_id', value: 'value', currency: 'currency', items: 'contents' }, payload_template: 'tiktok_purchase', additional_params: {} },
      { platform: 'linkedin', event_name: 'conversion', param_mapping: { value: 'value', currency: 'currency' }, payload_template: 'linkedin_conversion', additional_params: { conversion_id: '{{LINKEDIN_CONVERSION_ID}}' } },
    ],
  },
  {
    key: 'add_to_cart',
    label: 'People add items to a cart here',
    description: 'Users add a product or item to their shopping cart',
    category: 'engagement',
    required_params: [
      { key: 'value', label: 'Cart Value', type: 'number', description: 'Value of the item(s) added', example: '29.99' },
      { key: 'currency', label: 'Currency', type: 'string', description: 'Currency code', example: 'USD' },
    ],
    optional_params: [
      { key: 'items', label: 'Products Added', type: 'array', description: 'Array of product objects', example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99, quantity: 1}]' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'add_to_cart', param_mapping: { value: 'value', currency: 'currency', items: 'items' }, payload_template: 'ga4_add_to_cart', additional_params: {} },
      { platform: 'meta', event_name: 'AddToCart', param_mapping: { value: 'value', currency: 'currency', items: 'content_ids' }, payload_template: 'meta_add_to_cart', additional_params: { content_type: 'product' } },
      { platform: 'google_ads', event_name: 'add_to_cart', param_mapping: { value: 'value', currency: 'currency', items: 'items' }, payload_template: 'gads_add_to_cart', additional_params: {} },
      { platform: 'tiktok', event_name: 'AddToCart', param_mapping: { value: 'value', currency: 'currency', items: 'contents' }, payload_template: 'tiktok_add_to_cart', additional_params: {} },
    ],
  },
  {
    key: 'begin_checkout',
    label: 'People start the checkout process here',
    description: 'Users initiate the checkout flow',
    category: 'engagement',
    required_params: [
      { key: 'value', label: 'Cart Value', type: 'number', description: 'Total value of items in cart', example: '149.97' },
      { key: 'currency', label: 'Currency', type: 'string', description: 'Currency code', example: 'USD' },
    ],
    optional_params: [
      { key: 'items', label: 'Products in Cart', type: 'array', description: 'Array of product objects in the cart', example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99, quantity: 2}]' },
      { key: 'coupon', label: 'Coupon Code', type: 'string', description: 'Applied coupon or discount code', example: 'SAVE10' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'begin_checkout', param_mapping: { value: 'value', currency: 'currency', items: 'items', coupon: 'coupon' }, payload_template: 'ga4_begin_checkout', additional_params: {} },
      { platform: 'meta', event_name: 'InitiateCheckout', param_mapping: { value: 'value', currency: 'currency', items: 'content_ids' }, payload_template: 'meta_initiate_checkout', additional_params: { content_type: 'product' } },
      { platform: 'tiktok', event_name: 'InitiateCheckout', param_mapping: { value: 'value', currency: 'currency', items: 'contents' }, payload_template: 'tiktok_initiate_checkout', additional_params: {} },
    ],
  },
  {
    key: 'generate_lead',
    label: 'People fill out a form here',
    description: 'Users submit a contact form, enquiry, or lead capture form',
    category: 'conversion',
    required_params: [
      { key: 'form_id', label: 'Form Name', type: 'string', description: 'Identifier for which form was submitted', example: 'contact_form_main' },
    ],
    optional_params: [
      { key: 'value', label: 'Lead Value', type: 'number', description: 'Estimated value of this lead (if known)', example: '50.00' },
      { key: 'currency', label: 'Currency', type: 'string', description: 'Currency code for lead value', example: 'USD' },
      { key: 'user_email', label: 'Email Address', type: 'string', description: 'Lead email (will be hashed for ad platforms)', example: 'lead@example.com' },
      { key: 'user_phone', label: 'Phone Number', type: 'string', description: 'Lead phone (will be hashed for ad platforms)', example: '+6591234567' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'generate_lead', param_mapping: { form_id: 'form_id', value: 'value', currency: 'currency' }, payload_template: 'ga4_generate_lead', additional_params: {} },
      { platform: 'meta', event_name: 'Lead', param_mapping: { value: 'value', currency: 'currency', user_email: 'em', user_phone: 'ph' }, payload_template: 'meta_lead', additional_params: {} },
      { platform: 'google_ads', event_name: 'conversion', param_mapping: { value: 'value', currency: 'currency' }, payload_template: 'gads_lead_conversion', additional_params: { send_to: '{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}' } },
      { platform: 'tiktok', event_name: 'SubmitForm', param_mapping: { value: 'value', currency: 'currency' }, payload_template: 'tiktok_submit_form', additional_params: {} },
      { platform: 'linkedin', event_name: 'conversion', param_mapping: { value: 'value', currency: 'currency' }, payload_template: 'linkedin_lead_conversion', additional_params: { conversion_id: '{{LINKEDIN_CONVERSION_ID}}' } },
    ],
  },
  {
    key: 'sign_up',
    label: 'People sign up or create an account here',
    description: 'Users register for an account, trial, or newsletter',
    category: 'conversion',
    required_params: [
      { key: 'method', label: 'Sign Up Method', type: 'string', description: 'How the user signed up (email, Google, Facebook, etc.)', example: 'email' },
    ],
    optional_params: [
      { key: 'user_id', label: 'User ID', type: 'string', description: 'Your system user ID for the new account', example: 'USR-78901' },
      { key: 'user_email', label: 'Email Address', type: 'string', description: 'User email (will be hashed for ad platforms)', example: 'user@example.com' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'sign_up', param_mapping: { method: 'method' }, payload_template: 'ga4_sign_up', additional_params: {} },
      { platform: 'meta', event_name: 'CompleteRegistration', param_mapping: { method: 'content_name', user_email: 'em' }, payload_template: 'meta_complete_registration', additional_params: { status: 'true' } },
      { platform: 'tiktok', event_name: 'CompleteRegistration', param_mapping: { method: 'content_name' }, payload_template: 'tiktok_complete_registration', additional_params: {} },
    ],
  },
  {
    key: 'view_item',
    label: 'People view a specific product or listing here',
    description: 'Users view a product detail page or individual listing',
    category: 'engagement',
    required_params: [
      { key: 'items', label: 'Product Viewed', type: 'array', description: 'Product details (at minimum: name and ID)', example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99}]' },
    ],
    optional_params: [
      { key: 'value', label: 'Product Value', type: 'number', description: 'Price of the viewed product', example: '29.99' },
      { key: 'currency', label: 'Currency', type: 'string', description: 'Currency code', example: 'USD' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'view_item', param_mapping: { items: 'items', value: 'value', currency: 'currency' }, payload_template: 'ga4_view_item', additional_params: {} },
      { platform: 'meta', event_name: 'ViewContent', param_mapping: { items: 'content_ids', value: 'value', currency: 'currency' }, payload_template: 'meta_view_content', additional_params: { content_type: 'product' } },
      { platform: 'tiktok', event_name: 'ViewContent', param_mapping: { items: 'contents', value: 'value', currency: 'currency' }, payload_template: 'tiktok_view_content', additional_params: {} },
    ],
  },
  {
    key: 'view_item_list',
    label: 'People browse a list or category here',
    description: 'Users view a category page, search results, or product listing',
    category: 'engagement',
    required_params: [
      { key: 'item_list_name', label: 'List/Category Name', type: 'string', description: 'Name of the category or list being viewed', example: 'Summer Collection' },
    ],
    optional_params: [
      { key: 'items', label: 'Products in List', type: 'array', description: 'Array of products shown on the page', example: '[{item_id: "SKU-1", item_name: "Widget", price: 29.99}]' },
    ],
    platform_mappings: [
      { platform: 'ga4', event_name: 'view_item_list', param_mapping: { item_list_name: 'item_list_name', items: 'items' }, payload_template: 'ga4_view_item_list', additional_params: {} },
    ],
  },
  {
    key: 'search',
    label: 'People search for something here',
    description: 'Users perform a site search',
    category: 'engagement',
    required_params: [
      { key: 'search_term', label: 'Search Term', type: 'string', description: 'What the user searched for', example: 'blue widget' },
    ],
    optional_params: [],
    platform_mappings: [
      { platform: 'ga4', event_name: 'search', param_mapping: { search_term: 'search_term' }, payload_template: 'ga4_search', additional_params: {} },
      { platform: 'meta', event_name: 'Search', param_mapping: { search_term: 'search_string' }, payload_template: 'meta_search', additional_params: {} },
      { platform: 'tiktok', event_name: 'Search', param_mapping: { search_term: 'query' }, payload_template: 'tiktok_search', additional_params: {} },
    ],
  },
  {
    key: 'ad_landing',
    label: 'This page is important for ad tracking',
    description: 'Landing page where click IDs (gclid, fbclid) must be captured',
    category: 'navigation',
    required_params: [],
    optional_params: [],
    platform_mappings: [
      { platform: 'ga4', event_name: 'page_view', param_mapping: {}, payload_template: 'ga4_page_view', additional_params: {} },
      { platform: 'google_ads', event_name: 'page_view', param_mapping: {}, payload_template: 'gads_page_view', additional_params: {} },
      { platform: 'meta', event_name: 'PageView', param_mapping: {}, payload_template: 'meta_page_view', additional_params: {} },
    ],
  },
];

export function getActionPrimitive(key: string): ActionPrimitive | undefined {
  return ACTION_PRIMITIVES.find((a) => a.key === key);
}

export function getActionPrimitivesByKeys(keys: string[]): ActionPrimitive[] {
  return keys.map((k) => getActionPrimitive(k)).filter((a): a is ActionPrimitive => a !== undefined);
}
