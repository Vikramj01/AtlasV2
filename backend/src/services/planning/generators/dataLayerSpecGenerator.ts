/**
 * DataLayer Specification Generator
 *
 * Produces a structured, versioned dataLayer specification (atlas_spec_version 1.0)
 * from approved planning recommendations.
 *
 * Output is split into:
 *   machine_spec   — structured data for developers and automation tools
 *   human_documentation — explanatory content for marketing/analytics teams
 */
import type { PlanningRecommendation, PlanningPage, PlanningSession, SuggestedParam } from '@/types/planning';
import type { IREvent, IRParameter, IRTrigger, ActionType, Platform } from './ir.types';
import { renderCodeSnippet as renderIRCodeSnippet } from './renderer/spec.renderer';
import { sanitizeSelector } from './selectorUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EventSchemaParam {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required: boolean;
}

export interface EventSchema {
  event_id: string;
  event_name: string;
  description: string;
  parameters: EventSchemaParam[];
}

export interface UIInstrumentationEntry {
  element_label: string;
  selector: string | null;
  action: string;
  event_name: string;
  page_url: string;
}

export interface TrackingCoverage {
  implemented_events: string[];
  missing_recommended_events: string[];
}

export interface DataLayerParam {
  key: string;
  label: string;
  source: string;
  example: string;
  required: boolean;
}

export interface DataLayerEvent {
  event_name: string;
  action_type: string;
  element_selector?: string;
  element_text?: string;
  trigger_type: string;
  business_justification: string;
  priority: string;
  parameters: DataLayerParam[];
  code_snippet: string;
  platforms: string[];
}

export interface DataLayerPageSpec {
  page_url: string;
  page_title?: string;
  page_type?: string;
  events: DataLayerEvent[];
}

export interface HumanEventDoc {
  event_name: string;
  business_justification: string;
}

export interface TrafficSourceParam {
  key: string;
  label: string;
  source: string;
  example: string;
  storage: string;
}

export interface TrafficSourceSpec {
  utm_parameters: TrafficSourceParam[];
  referrer_classification: string;
  session_cookie: string;
  code_snippet: string;
}

export interface DataLayerSpecOutput {
  atlas_spec_version: '1.0';
  metadata: {
    generated_at: string;
    business_type: string;
    platforms: string[];
    atlas_spec_version: '1.0';
  };
  machine_spec: {
    event_schemas: EventSchema[];
    ui_instrumentation_map: UIInstrumentationEntry[];
    tracking_coverage: TrackingCoverage;
    pages: DataLayerPageSpec[];
    traffic_source: TrafficSourceSpec;
  };
  human_documentation: {
    overview: string;
    implementation_notes: string;
    installation_snippet: string;
    variable_naming_guide: string;
    qa_checklist: string[];
    events: HumanEventDoc[];
  };
}

// ── Baseline events per business type ─────────────────────────────────────────

const BASELINE_EVENTS: Record<string, string[]> = {
  ecommerce:   ['page_view', 'view_item_list', 'view_item', 'add_to_cart', 'view_cart', 'begin_checkout', 'purchase'],
  saas:        ['page_view', 'sign_up', 'login', 'trial_start', 'subscription_start'],
  lead_gen:    ['page_view', 'generate_lead', 'form_submit'],
  content:     ['page_view', 'scroll', 'video_start', 'video_complete'],
  marketplace: ['page_view', 'view_item', 'add_to_cart', 'purchase', 'generate_lead'],
  custom:      ['page_view'],
};

// ── Installation snippet ───────────────────────────────────────────────────────

const INSTALLATION_SNIPPET = `<!-- ============================================================
     GOOGLE TAG MANAGER — Installation
     Place this snippet in the <head> of EVERY page, as high as possible.
     Replace GTM-XXXXXXX with your actual GTM Container ID.
     ============================================================ -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>

<!-- Google Tag Manager (noscript) — place immediately after opening <body> tag -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

// ── Variable naming guide ─────────────────────────────────────────────────────

const VARIABLE_NAMING_GUIDE = `// ============================================================
// VARIABLE NAMING CONVENTIONS
// ============================================================
//
// Replace all {{PLACEHOLDER}} values in the snippets with
// real values from your application:
//
// {{ORDER_ID}}          → Your system's unique order/transaction ID
// {{ORDER_TOTAL}}       → Total order value as a number (not a string)
// {{CURRENCY_CODE}}     → 3-letter ISO currency code: 'USD', 'EUR', 'GBP', etc.
// {{PRODUCT_SKU}}       → Your product's unique identifier (SKU or ID)
// {{PRODUCT_NAME}}      → Human-readable product name
// {{UNIT_PRICE}}        → Price per unit as a number
// {{QUANTITY}}          → Quantity as a number
// {{CUSTOMER_EMAIL_RAW}}→ Customer's email — GTM/ad platforms will hash this
// {{CUSTOMER_PHONE_RAW}}→ Customer's phone in E.164 format (+15551234567)
// {{FORM_ID}}           → A slug identifying which form was submitted
// {{USER_ID}}           → Your application's user ID for the logged-in user
// {{SIGNUP_METHOD}}     → How the user signed up: 'email', 'google', 'facebook'
// {{SEARCH_QUERY}}      → The search term the user entered
//
// Campaign attribution — read dynamically from the URL, never hardcode:
// utm_source            → new URLSearchParams(location.search).get('utm_source')
// utm_medium            → new URLSearchParams(location.search).get('utm_medium')
// gclid                 → new URLSearchParams(location.search).get('gclid')
// fbclid                → new URLSearchParams(location.search).get('fbclid')
//
// ============================================================`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Infer the JS type for a dataLayer parameter from its key and example value. */
function inferParamType(key: string, exampleValue: string): 'string' | 'number' | 'boolean' | 'array' {
  if (key === 'items' || key === 'products' || key.endsWith('_list')) return 'array';
  if (exampleValue !== '' && !isNaN(Number(exampleValue))) return 'number';
  const numericKeys = ['value', 'price', 'quantity', 'amount', 'count', 'tax', 'shipping', 'revenue', 'total', 'subtotal'];
  if (numericKeys.some(k => key === k || key.endsWith(`_${k}`))) return 'number';
  if (exampleValue === 'true' || exampleValue === 'false') return 'boolean';
  return 'string';
}

// ── Rec → IR adapter (for spec renderer) ────────────────────────────────────

const SPEC_CONVERSION_ACTIONS = new Set([
  'purchase', 'generate_lead', 'sign_up', 'begin_checkout',
]);

export function recToIREventForSpec(rec: PlanningRecommendation): IREvent {
  const sanitized = sanitizeSelector(rec.element_selector);
  let trigger: IRTrigger;
  if (!sanitized) {
    trigger = { trigger_type: 'page_load' };
  } else if (sanitized.textFallback !== undefined) {
    trigger = {
      trigger_type: 'click_text',
      click_text: sanitized.textFallback ?? rec.element_text ?? rec.element_selector ?? '',
    };
  } else if (rec.action_type === 'form_submit') {
    trigger = { trigger_type: 'form_submit', selector: sanitized.selector };
  } else {
    trigger = { trigger_type: 'click_css', selector: sanitized.selector };
  }

  const parameters: IRParameter[] = (rec.required_params ?? []).map(p => ({
    key: p.param_key,
    label: p.param_label,
    type: inferParamType(p.param_key, p.example_value ?? '') as IRParameter['type'],
    required: true,
    value_source: { strategy: 'developer_provided' as const },
    example: p.example_value ?? '',
  }));

  return {
    event_id: '',
    event_name: rec.event_name,
    business_justification: rec.business_justification,
    action_type: rec.action_type as ActionType,
    priority: 'required',
    platforms: (rec.affected_platforms ?? []) as Platform[],
    parameters,
    trigger,
    is_conversion: SPEC_CONVERSION_ACTIONS.has(rec.action_type),
  };
}

// ── Event Schema Catalog builder ──────────────────────────────────────────────

function buildEventSchemas(recommendations: PlanningRecommendation[]): EventSchema[] {
  // Group all recs by event_name
  const byEvent = new Map<string, { desc: string; required: Map<string, SuggestedParam>; optional: Map<string, SuggestedParam> }>();

  for (const rec of recommendations) {
    const existing = byEvent.get(rec.event_name) ?? {
      desc: rec.business_justification,
      required: new Map<string, SuggestedParam>(),
      optional: new Map<string, SuggestedParam>(),
    };

    for (const p of (rec.required_params ?? [])) {
      if (!existing.required.has(p.param_key)) {
        existing.required.set(p.param_key, p);
      }
    }
    for (const p of (rec.optional_params ?? [])) {
      if (!existing.optional.has(p.param_key) && !existing.required.has(p.param_key)) {
        existing.optional.set(p.param_key, p);
      }
    }

    byEvent.set(rec.event_name, existing);
  }

  // Sort event names deterministically for stable IDs
  const sortedNames = Array.from(byEvent.keys()).sort();

  return sortedNames.map((eventName, idx): EventSchema => {
    const entry = byEvent.get(eventName)!;
    const eventId = `atlas_evt_${String(idx + 1).padStart(3, '0')}`;

    const requiredParams: EventSchemaParam[] = Array.from(entry.required.values()).map(p => ({
      key: p.param_key,
      type: inferParamType(p.param_key, p.example_value ?? ''),
      required: true,
    }));

    const optionalParams: EventSchemaParam[] = Array.from(entry.optional.values()).map(p => ({
      key: p.param_key,
      type: inferParamType(p.param_key, p.example_value ?? ''),
      required: false,
    }));

    return {
      event_id: eventId,
      event_name: eventName,
      description: entry.desc,
      parameters: [...requiredParams, ...optionalParams],
    };
  });
}

// ── UI Instrumentation Map builder ───────────────────────────────────────────

function buildUIInstrumentationMap(
  recommendations: PlanningRecommendation[],
  pages: PlanningPage[],
): UIInstrumentationEntry[] {
  const pageById = new Map(pages.map(p => [p.id, p]));

  return recommendations.map((rec): UIInstrumentationEntry => {
    const page = pageById.get(rec.page_id);
    const action = rec.element_selector
      ? rec.action_type === 'generate_lead' ? 'submit' : 'click'
      : 'page_load';

    return {
      element_label: rec.element_text ?? rec.element_selector ?? rec.event_name,
      selector:      rec.element_selector ?? null,
      action,
      event_name:    rec.event_name,
      page_url:      page?.url ?? 'unknown',
    };
  });
}

// ── Tracking Coverage builder ─────────────────────────────────────────────────

function buildTrackingCoverage(
  recommendations: PlanningRecommendation[],
  businessType: string,
): TrackingCoverage {
  const implementedEvents = Array.from(new Set(recommendations.map(r => r.event_name))).sort();
  const baseline = BASELINE_EVENTS[businessType] ?? BASELINE_EVENTS.custom;
  const implementedSet = new Set(implementedEvents);
  const missingRecommendedEvents = baseline.filter(e => !implementedSet.has(e));

  return { implemented_events: implementedEvents, missing_recommended_events: missingRecommendedEvents };
}

// ── Traffic Source Spec ───────────────────────────────────────────────────────

function buildTrafficSourceSpec(): TrafficSourceSpec {
  return {
    utm_parameters: [
      { key: 'utm_source',   label: 'Traffic Source',   source: 'URL query parameter', example: 'google',          storage: '_atlas_traffic_source cookie (JSON)' },
      { key: 'utm_medium',   label: 'Traffic Medium',   source: 'URL query parameter', example: 'cpc',             storage: '_atlas_traffic_source cookie (JSON)' },
      { key: 'utm_campaign', label: 'Campaign Name',    source: 'URL query parameter', example: 'spring_sale',     storage: '_atlas_traffic_source cookie (JSON)' },
      { key: 'utm_content',  label: 'Ad Content',       source: 'URL query parameter', example: 'banner_v2',       storage: '_atlas_traffic_source cookie (JSON)' },
      { key: 'utm_term',     label: 'Search Term',      source: 'URL query parameter', example: 'running shoes',   storage: '_atlas_traffic_source cookie (JSON)' },
    ],
    referrer_classification: [
      'organic_search  — referrer matches google/bing/yahoo/duckduckgo/baidu',
      'paid_search     — utm_medium = cpc/ppc/paid',
      'paid_social     — utm_medium = paid_social/social_paid',
      'social          — referrer matches facebook/instagram/twitter/linkedin/tiktok/pinterest',
      'email           — utm_medium = email',
      'affiliate       — utm_medium = affiliate',
      'display         — utm_medium = display',
      'referral        — other known referrer domain',
      'direct          — no referrer and no UTM params',
    ].join('\n'),
    session_cookie: '_atlas_traffic_source — 30-day root-domain cookie storing source, medium, campaign, content, term, channel, and timestamp as JSON. Used to attribute conversion events back to the originating session.',
    code_snippet: `// Read Atlas traffic source from session cookie (for use in conversion dataLayer pushes)
function getAtlasTrafficSource() {
  try {
    var match = document.cookie.match(/(^| )_atlas_traffic_source=([^;]+)/);
    return match ? JSON.parse(decodeURIComponent(match[2])) : null;
  } catch (e) { return null; }
}

// Include in purchase event:
var trafficSource = getAtlasTrafficSource();
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'purchase',
  ecommerce: { /* ... */ },
  traffic_source: trafficSource  // Attach session attribution to conversion
});`,
  };
}

// ── Human Documentation builder ───────────────────────────────────────────────

function buildHumanDocumentation(
  recommendations: PlanningRecommendation[],
  businessType: string,
  platforms: string[],
): {
  overview: string;
  implementation_notes: string;
  qa_checklist: string[];
  events: HumanEventDoc[];
} {
  const uniqueEventCount = new Set(recommendations.map(r => r.event_name)).size;
  const platformList = platforms.length > 0 ? platforms.join(', ') : 'your analytics platforms';

  const overview = `This specification defines ${uniqueEventCount} analytics event${uniqueEventCount !== 1 ? 's' : ''} for a ${businessType} site across ${platformList}. It is generated by Atlas and intended to be handed to a developer for implementation via Google Tag Manager. Each event in machine_spec.pages includes a ready-to-use dataLayer.push() snippet. The machine_spec.event_schemas section provides canonical definitions that can be imported by automation tools or AI agents.`;

  const implementation_notes = `Implementation checklist:

1. Install GTM on every page using the installation_snippet in this document
2. For each page, add the dataLayer.push() calls BEFORE the GTM script tag,
   or trigger them from your framework's event system
3. For SPA frameworks (React, Next.js, Vue), wrap push() calls in the
   appropriate lifecycle hook (useEffect, onMounted, router.afterEach)
4. For ecommerce events, fire AFTER the transaction is confirmed — not at
   the "place order" button click
5. For campaign attribution (utm_source, gclid, fbclid): read these
   dynamically from the URL using URLSearchParams — never hardcode values
6. Test using GTM Preview Mode (Tag Assistant) before publishing
7. Verify GA4 DebugView shows events with the correct parameters

IMPORTANT: Never push sensitive data (full card numbers, passwords, SSNs)
into the dataLayer. Email and phone are fine — GTM hashes them automatically.`;

  const qa_checklist = [
    'GTM container snippet installed in <head> on all pages',
    'GTM noscript iframe added immediately after <body> tag',
    'GTM container ID placeholder replaced with real container ID',
    ...(businessType === 'ecommerce' ? [
      'purchase event fires only once per order on the confirmation page',
      'transaction_id is unique per order (no duplicate conversion risk)',
      'ecommerce.items array is populated for all product events',
      'ecommerce.currency is a 3-letter ISO code (USD, EUR, etc.)',
    ] : []),
    'All {{PLACEHOLDER}} values replaced with real application variables',
    'Campaign attribution reads utm_source/utm_medium/gclid/fbclid from URL — not hardcoded',
    'No PII (raw emails/phone) logged to the console or stored server-side',
    'Events verified in GA4 DebugView before publishing GTM container',
    'GTM Preview Mode shows correct tags firing on each trigger',
    ...recommendations
      .filter(r => r.element_selector)
      .slice(0, 5)
      .map(r => `"${r.event_name}" fires on interaction with: ${r.element_selector}`),
  ];

  // Deduplicate events for human docs
  const seen = new Set<string>();
  const events: HumanEventDoc[] = [];
  for (const rec of recommendations) {
    if (!seen.has(rec.event_name)) {
      seen.add(rec.event_name);
      events.push({ event_name: rec.event_name, business_justification: rec.business_justification });
    }
  }

  return { overview, implementation_notes, qa_checklist, events };
}

// ── Main generator ────────────────────────────────────────────────────────────

export function generateDataLayerSpec(
  recommendations: PlanningRecommendation[],
  pages: PlanningPage[],
  session: Pick<PlanningSession, 'business_type' | 'selected_platforms'>,
): DataLayerSpecOutput {
  // Group recommendations by page_id
  const byPage = new Map<string, PlanningRecommendation[]>();
  for (const rec of recommendations) {
    const list = byPage.get(rec.page_id) ?? [];
    list.push(rec);
    byPage.set(rec.page_id, list);
  }

  // Build per-page event specs
  const pageSpecs: DataLayerPageSpec[] = [];
  for (const page of pages) {
    const pageRecs = byPage.get(page.id) ?? [];
    if (pageRecs.length === 0) continue;

    const events: DataLayerEvent[] = pageRecs.map((rec): DataLayerEvent => {
      const reqParams = (rec.required_params as unknown as Array<{ param_key: string; param_label: string; source: string; example_value: string }>) ?? [];
      const optParams = (rec.optional_params as unknown as Array<{ param_key: string; param_label: string; source: string; example_value: string }>) ?? [];
      const allParams = [
        ...reqParams.map(p => ({ ...p, required: true })),
        ...optParams.map(p => ({ ...p, required: false })),
      ];
      return {
        event_name:           rec.event_name,
        action_type:          rec.action_type,
        element_selector:     (() => {
          const s = sanitizeSelector(rec.element_selector);
          if (!s || 'textFallback' in s) return undefined;
          return s.selector;
        })(),
        element_text:         rec.element_text ?? undefined,
        trigger_type:         recToIREventForSpec(rec).trigger.trigger_type,
        business_justification: rec.business_justification,
        priority:             'required',
        parameters:           allParams.map(p => ({
          key:      p.param_key,
          label:    p.param_label,
          source:   p.source ?? '',
          example:  p.example_value ?? '',
          required: p.required,
        })),
        code_snippet: renderIRCodeSnippet(recToIREventForSpec(rec)),
        platforms:    rec.affected_platforms,
      };
    });

    pageSpecs.push({
      page_url:   page.url,
      page_title: page.page_title ?? undefined,
      page_type:  page.page_type,
      events,
    });
  }

  const humanDocs = buildHumanDocumentation(
    recommendations,
    session.business_type,
    session.selected_platforms,
  );

  return {
    atlas_spec_version: '1.0',
    metadata: {
      generated_at:       new Date().toISOString(),
      business_type:      session.business_type,
      platforms:          session.selected_platforms,
      atlas_spec_version: '1.0',
    },
    machine_spec: {
      event_schemas:          buildEventSchemas(recommendations),
      ui_instrumentation_map: buildUIInstrumentationMap(recommendations, pages),
      tracking_coverage:      buildTrackingCoverage(recommendations, session.business_type),
      pages:                  pageSpecs,
      traffic_source:         buildTrafficSourceSpec(),
    },
    human_documentation: {
      overview:              humanDocs.overview,
      implementation_notes:  humanDocs.implementation_notes,
      installation_snippet:  INSTALLATION_SNIPPET,
      variable_naming_guide: VARIABLE_NAMING_GUIDE,
      qa_checklist:          humanDocs.qa_checklist,
      events:                humanDocs.events,
    },
  };
}
