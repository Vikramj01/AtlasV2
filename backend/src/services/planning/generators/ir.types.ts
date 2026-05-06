/**
 * Intermediate Representation (IR) for Atlas output generation.
 *
 * The LLM produces an IR object; the DeterministicRenderer consumes it to
 * produce all three artefacts (GTM container, dataLayer spec, guide).
 * The LLM never writes raw artefact JSON — all tag/variable/trigger structure
 * is derived deterministically from this schema.
 */

export type Platform = 'ga4' | 'google_ads' | 'meta' | 'tiktok' | 'linkedin';

export type BusinessType =
  | 'lead_gen'
  | 'ecommerce'
  | 'saas'
  | 'content'
  | 'marketplace'
  | 'custom';

export type ActionType =
  // Universally allowed
  | 'page_view'
  | 'cta_click'
  | 'form_submit'
  | 'content_engagement'
  | 'content_navigation'
  | 'ui_interaction'
  // Ecommerce-only — renderer throws if these appear on lead_gen
  | 'view_item'
  | 'view_item_list'
  | 'add_to_cart'
  | 'purchase'
  | 'begin_checkout';

export type TriggerType =
  | 'page_load'
  | 'click_css'    // selector-based — uses CSS3 selector in GTM Click trigger
  | 'click_text'   // text-based — uses {{Click Text}} built-in; replaces :contains()
  | 'click_url'    // href-based — uses {{Click URL}} built-in
  | 'form_submit'
  | 'custom_event'
  | 'scroll_depth';

export type ValueSourceStrategy =
  | 'element_text'
  | 'element_attribute'
  | 'page_url'
  | 'parent_context'
  | 'developer_provided'
  | 'runtime_computed';

export interface IRValueSource {
  strategy: ValueSourceStrategy;
  /** e.g. 'id', 'href', 'data-form-id' — only for element_attribute */
  attribute?: string;
  /** Valid CSS3 only — for DOM lookups, never for trigger selector matching */
  selector?: string;
}

export interface IRParameter {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  value_source: IRValueSource;
  /** Must be contextually appropriate — never an ecommerce example on a lead_gen site */
  example: string;
}

export interface IRAttribution {
  // Attribution params live here, NOT in IRParameter[]. Always optional by definition.
  capture_gclid: boolean;
  capture_fbclid: boolean;
  capture_gbraid: boolean;
  capture_wbraid: boolean;
}

export interface IRTrigger {
  trigger_type: TriggerType;
  /** Valid CSS3 selector — required for click_css and form_submit */
  selector?: string;
  /** Exact visible text string — required for click_text; replaces :contains() */
  click_text?: string;
  /** URL substring or regex — required for click_url */
  click_url_pattern?: string;
}

export interface IREvent {
  /** Auto-assigned by the renderer: 'atlas_evt_001', 'atlas_evt_002', … */
  event_id: string;
  /** snake_case event name */
  event_name: string;
  business_justification: string;
  action_type: ActionType;
  priority: 'required' | 'recommended' | 'optional';
  platforms: Platform[];
  parameters: IRParameter[];
  /** Attribution click-ID capture config — kept separate from parameters[] */
  attribution?: IRAttribution;
  /** e.g. 'generate_lead' — renderer generates a second GA4 tag for Smart Bidding */
  standard_event_alias?: string;
  trigger: IRTrigger;
  is_conversion: boolean;
}

export interface IRMetadata {
  /** ISO 8601 */
  generated_at: string;
  atlas_spec_version: string;
  site_url: string;
}

export interface IRSiteMetadata {
  name?: string;
  industry?: string;
  description?: string;
}

export interface IRTrafficSource {
  utm_params: string[];
  click_id_params: string[];
}

export interface AtlasIR {
  metadata: IRMetadata;
  events: IREvent[];
  platforms: Platform[];
  business_type: BusinessType;
  site: IRSiteMetadata;
  traffic_source: IRTrafficSource;
}

// ── Business-type action type allowlist ───────────────────────────────────────
// The renderer throws a validation error if an event's action_type is not in
// the allowlist for the current business_type.

export const ACTION_TYPE_ALLOWLIST: Record<BusinessType, Set<ActionType>> = {
  lead_gen: new Set<ActionType>([
    'page_view', 'cta_click', 'form_submit',
    'content_engagement', 'content_navigation', 'ui_interaction',
  ]),
  ecommerce: new Set<ActionType>([
    'page_view', 'cta_click', 'form_submit',
    'content_engagement', 'content_navigation', 'ui_interaction',
    'view_item', 'view_item_list', 'add_to_cart', 'purchase', 'begin_checkout',
  ]),
  saas: new Set<ActionType>([
    'page_view', 'cta_click', 'form_submit',
    'content_engagement', 'content_navigation', 'ui_interaction',
  ]),
  content: new Set<ActionType>([
    'page_view', 'cta_click', 'form_submit',
    'content_engagement', 'content_navigation', 'ui_interaction',
  ]),
  marketplace: new Set<ActionType>([
    'page_view', 'cta_click', 'form_submit',
    'content_engagement', 'content_navigation', 'ui_interaction',
    'view_item', 'view_item_list', 'add_to_cart', 'purchase', 'begin_checkout',
  ]),
  custom: new Set<ActionType>([
    'page_view', 'cta_click', 'form_submit',
    'content_engagement', 'content_navigation', 'ui_interaction',
    'view_item', 'view_item_list', 'add_to_cart', 'purchase', 'begin_checkout',
  ]),
};

// ── Isolation constants ───────────────────────────────────────────────────────

/** Ecommerce-only action types — must never appear on lead_gen events. */
export const ECOMMERCE_ACTION_TYPES = new Set<string>([
  'view_item', 'view_item_list', 'add_to_cart', 'purchase', 'begin_checkout',
]);

/** Ecommerce-only parameter keys — must never appear on lead_gen event params. */
export const ECOMMERCE_PARAM_KEYS = new Set<string>([
  'item_id', 'item_name', 'item_category', 'item_brand',
  'price', 'quantity', 'items', 'transaction_id',
  'affiliation', 'coupon', 'discount', 'shipping', 'tax',
]);

/** Attribution parameters — must never be marked required in IRParameter[]. */
export const ATTRIBUTION_PARAMS = new Set<string>([
  'gclid', 'fbclid', 'gbraid', 'wbraid',
]);

/** Price indicator pattern — must not appear in lead_gen event parameter examples. */
export const PRICE_INDICATOR_REGEX = /[\$£€]\d/;

/** Ecommerce action types where the snippet uses a nested ecommerce object. */
export const ECOMMERCE_SNIPPET_ACTIONS = new Set<string>([
  'purchase', 'add_to_cart', 'begin_checkout', 'view_item', 'view_item_list',
]);
