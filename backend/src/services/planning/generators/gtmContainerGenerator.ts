/**
 * GTM Container JSON Generator
 *
 * Produces a valid GTM export JSON (exportFormatVersion: 2) from a set of
 * approved planning recommendations. The file can be imported directly into
 * a Google Tag Manager workspace via Admin → Import Container.
 *
 * Naming conventions (match PRD Section 7.2):
 *   Folders:   "Atlas — Configuration", "Atlas — Conversion Events", etc.
 *   Triggers:  "CE - [event_name]"  (Custom Event)
 *   Variables: "DLV - [path]"       (Data Layer Variable)
 *              "CJS - SHA256 Hash"  (Custom JavaScript)
 *   Tags:      "GA4 - Config", "GA4 - [event_name]", "Meta - Purchase", etc.
 *
 * NOTE: this generator is deliberately distinct from gtmDataLayer.ts which
 * produces human-readable code snippets. This generator produces machine-readable
 * import JSON.
 */
import type { PlanningRecommendation, PlanningSession } from '@/types/planning';
import type { IREvent, IRParameter, IRTrigger, ActionType, BusinessType, Platform } from './ir.types';
import { sanitizeSelector } from './selectorUtils';
import { ECOMMERCE_SNIPPET_ACTIONS } from './ir.types';
import { renderGTMTrigger } from './renderer/trigger.renderer';
import { consentSettingsForTag } from './renderer/consent.renderer';
import {
  renderGA4EventParameters,
  renderGoogleAdsConversionTag,
  renderMetaEventTag,
  renderTikTokEventTag,
  renderLinkedInConversionTag,
  renderStandardEventAliasTag,
  dlvPathForParam,
} from './renderer/gtm.renderer';

// ── GTM type interfaces ──────────────────────────────────────────────────────

export interface GTMParameter {
  type: 'TEMPLATE' | 'BOOLEAN' | 'INTEGER' | 'LIST' | 'MAP';
  key?: string;
  value?: string;
  list?: GTMParameter[];
  map?: GTMParameter[];
}

export interface GTMConsentSettings {
  consentStatus: 'notSet' | 'needed' | 'notNeeded';
}

export interface GTMTagDef {
  accountId: string;
  containerId: string;
  tagId: string;
  name: string;
  type: string;
  parameter: GTMParameter[];
  firingTriggerId: string[];
  tagFiringOption: string;
  folderId?: string;
  consentSettings?: GTMConsentSettings;
  fingerprint: string;
  tagManagerUrl: string;
}

export interface GTMTriggerDef {
  accountId: string;
  containerId: string;
  triggerId: string;
  name: string;
  type: string;
  customEventFilter?: Array<{
    type: string;
    parameter: GTMParameter[];
  }>;
  filter?: Array<{ type: string; parameter: GTMParameter[] }>;
  folderId?: string;
  fingerprint: string;
  tagManagerUrl: string;
}

export interface GTMVariableDef {
  accountId: string;
  containerId: string;
  variableId: string;
  name: string;
  type: string;
  parameter: GTMParameter[];
  folderId?: string;
  fingerprint: string;
  tagManagerUrl: string;
  /** Human-readable notes shown in the GTM UI (visible in variable settings). */
  notes?: string;
}

export interface GTMFolderDef {
  accountId: string;
  containerId: string;
  folderId: string;
  name: string;
  fingerprint: string;
  tagManagerUrl: string;
}

export interface GTMBuiltInVariable {
  accountId: string;
  containerId: string;
  type: string;
  name: string;
}

export interface GTMContainerJSON {
  exportFormatVersion: 2;
  exportTime: string;
  containerVersion: {
    path: string;
    accountId: string;
    containerId: string;
    containerVersionId: string;
    name: string;
    description: string;
    container: {
      path: string;
      accountId: string;
      containerId: string;
      name: string;
      publicId: string;
      usageContext: string[];
      fingerprint: string;
      tagManagerUrl: string;
    };
    tag: GTMTagDef[];
    trigger: GTMTriggerDef[];
    variable: GTMVariableDef[];
    folder: GTMFolderDef[];
    builtInVariable: GTMBuiltInVariable[];
    fingerprint: string;
    tagManagerUrl: string;
  };
}

// ── ID counter ────────────────────────────────────────────────────────────────

class IdCounter {
  private n = 0;
  next(): string { return String(++this.n); }
}

// ── Folder IDs (fixed) ────────────────────────────────────────────────────────

const FOLDER = {
  CONFIG:      '1',
  CONVERSION:  '2',
  ENGAGEMENT:  '3',
  VARIABLES:   '4',
  TRIGGERS:    '5',
} as const;

// (META_EVENT, TIKTOK_EVENT, CONVERSION_ACTIONS moved to renderer modules)

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpl(key: string, value: string): GTMParameter {
  return { type: 'TEMPLATE', key, value };
}
function bool(key: string, value: string): GTMParameter {
  return { type: 'BOOLEAN', key, value };
}
function int(key: string, value: string): GTMParameter {
  return { type: 'INTEGER', key, value };
}
function list(key: string, items: string[]): GTMParameter {
  return { type: 'LIST', key, list: items.map((v) => ({ type: 'TEMPLATE' as const, value: v })) };
}

function stub(accountId = '0', containerId = '0') {
  return {
    accountId,
    containerId,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };
}

function dlvName(path: string): string { return `DLV - ${path}`; }

// ── Rec → IR adapter ─────────────────────────────────────────────────────────
// Converts a PlanningRecommendation to a minimal IREvent so the deterministic
// renderers can drive tag/trigger generation. In Sprint 2.5-C this adapter is
// removed and the LLM outputs IR directly.

/** Infer JS type for a parameter from its key and example value. */
function inferIRParamType(key: string, example: string): IRParameter['type'] {
  if (key === 'items' || key.endsWith('_list')) return 'array';
  if (example !== '' && !Number.isNaN(Number(example))) return 'number';
  const numericKeys = ['value', 'price', 'quantity', 'amount', 'count', 'tax', 'shipping'];
  if (numericKeys.some(k => key === k || key.endsWith(`_${k}`))) return 'number';
  if (example === 'true' || example === 'false') return 'boolean';
  return 'string';
}

const ADAPTER_CONVERSION_ACTIONS = new Set([
  'purchase', 'generate_lead', 'sign_up', 'begin_checkout',
]);

function recToIREvent(
  rec: PlanningRecommendation,
  selectedPlatforms: Platform[],
): IREvent {
  let trigger: IRTrigger;
  const sanitized = sanitizeSelector(rec.element_selector);

  if (!sanitized) {
    // No selector — fall back to click_text (if element_text present) or page_load
    if (rec.element_type === 'track_click' && rec.element_text) {
      trigger = { trigger_type: 'click_text', click_text: rec.element_text };
    } else {
      trigger = { trigger_type: 'page_load' };
    }
  } else if (sanitized.textFallback !== undefined) {
    // Selector contained only invalid pseudo-selectors; use extracted text instead
    trigger = {
      trigger_type: 'click_text',
      click_text: sanitized.textFallback ?? rec.element_text ?? rec.element_selector ?? '',
    };
  } else if (rec.action_type === 'form_submit' || rec.element_type === 'track_form_submit') {
    trigger = { trigger_type: 'form_submit', selector: sanitized.selector };
  } else {
    trigger = { trigger_type: 'click_css', selector: sanitized.selector };
  }

  const parameters: IRParameter[] = (rec.required_params ?? []).map(p => ({
    key: p.param_key,
    label: p.param_label,
    type: inferIRParamType(p.param_key, p.example_value ?? ''),
    required: true,
    value_source: { strategy: 'developer_provided' as const },
    example: p.example_value ?? '',
  }));

  const platforms = (
    rec.affected_platforms?.length > 0 ? rec.affected_platforms : selectedPlatforms
  ) as Platform[];

  // Conversion detection: explicit action_type match OR form_submit with conversion
  // event name patterns (Sprint 2.5-C: LLM now uses form_submit for lead gen forms)
  const isConversionByActionType = ADAPTER_CONVERSION_ACTIONS.has(rec.action_type);
  const isConversionFormSubmit =
    rec.action_type === 'form_submit' &&
    /(?:lead|contact|enqui|signup|sign.up|register|book|demo|quote)/i.test(rec.event_name);

  // Standard event alias: when the custom event name differs from the GA4
  // standard name, add a second GA4 tag firing the standard name for Smart Bidding.
  // e.g. event_name='contact_form_submit', action_type='generate_lead'
  //   → standard_event_alias='generate_lead'
  let standard_event_alias: string | undefined;
  if (rec.action_type === 'generate_lead' && rec.event_name !== 'generate_lead') {
    standard_event_alias = 'generate_lead';
  } else if (rec.action_type === 'sign_up' && rec.event_name !== 'sign_up') {
    standard_event_alias = 'sign_up';
  } else if (isConversionFormSubmit && rec.event_name !== 'generate_lead') {
    // form_submit conversion with a custom event name → alias as generate_lead
    standard_event_alias = 'generate_lead';
  }

  return {
    event_id: '',
    event_name: rec.event_name,
    business_justification: rec.business_justification,
    action_type: rec.action_type as ActionType,
    priority: 'required',
    platforms,
    parameters,
    trigger,
    is_conversion: isConversionByActionType || isConversionFormSubmit,
    standard_event_alias,
  };
}

// ── Main generator ────────────────────────────────────────────────────────────

export interface GTMPlatformIds {
  ga4?: string;
  google_ads?: string;
  meta?: string;
  tiktok?: string;
  linkedin?: string;
  linkedin_conversion_id?: string;
  google_ads_conversion_label?: string;
  /** Atlas CAPI provider_token — used to authenticate the Atlas Signal Tag beacon */
  provider_token?: string;
}

export function generateGTMContainer(
  recommendations: PlanningRecommendation[],
  session: Pick<PlanningSession, 'business_type' | 'selected_platforms' | 'secondary_domains'>,
  platformIds?: GTMPlatformIds,
): GTMContainerJSON {
  const platforms = session.selected_platforms;
  const hasGA4         = platforms.includes('ga4');
  const hasGoogleAds   = platforms.includes('google_ads');
  const hasMeta        = platforms.includes('meta');
  const hasTikTok      = platforms.includes('tiktok');
  const hasLinkedIn    = platforms.includes('linkedin');
  const secondaryDomains = session.secondary_domains ?? [];

  const tagIds   = new IdCounter();
  const trigIds  = new IdCounter();
  const varIds   = new IdCounter();

  const tags:      GTMTagDef[]      = [];
  const triggers:  GTMTriggerDef[]  = [];
  const variables: GTMVariableDef[] = [];

  // ── Built-in variables ────────────────────────────────────────────────────
  const builtInVariables: GTMBuiltInVariable[] = [
    { ...stub(), type: 'EVENT',          name: 'Event' },
    { ...stub(), type: 'PAGE_URL',       name: 'Page URL' },
    { ...stub(), type: 'PAGE_HOSTNAME',  name: 'Page Hostname' },
    { ...stub(), type: 'PAGE_PATH',      name: 'Page Path' },
    { ...stub(), type: 'REFERRER',       name: 'Referrer' },
    { ...stub(), type: 'CLICK_ELEMENT',  name: 'Click Element' },
    { ...stub(), type: 'CLICK_CLASSES',  name: 'Click Classes' },
    { ...stub(), type: 'CLICK_ID',       name: 'Click ID' },
    { ...stub(), type: 'CLICK_TEXT',     name: 'Click Text' },
    { ...stub(), type: 'CLICK_URL',      name: 'Click URL' },
  ];

  // ── Utility variables ─────────────────────────────────────────────────────

  // DLV - event (reads the event key from dataLayer)
  const dlvEventVarId = varIds.next();
  variables.push({
    ...stub(),
    variableId: dlvEventVarId,
    name: 'DLV - event',
    type: 'v',
    parameter: [
      int('dataLayerVersion', '2'),
      bool('setDefaultValue', 'false'),
      tmpl('name', 'event'),
    ],
    folderId: FOLDER.VARIABLES,
  });

  // CJS - SHA256 Hash (for Enhanced Conversions / Meta CAPI)
  const sha256VarId = varIds.next();
  variables.push({
    ...stub(),
    variableId: sha256VarId,
    name: 'CJS - SHA256 Hash',
    type: 'jsm',
    parameter: [
      tmpl('javascript', `function() {
  // Returns a SHA-256 hash of a string value
  // Used by Google Ads Enhanced Conversions and Meta CAPI
  var input = arguments[0];
  if (!input) return '';
  input = input.toLowerCase().trim();
  // Requires a CryptoJS or SubtleCrypto implementation
  // Replace with your preferred hashing library
  return input; // TODO: implement SHA-256 hashing
}`),
    ],
    folderId: FOLDER.VARIABLES,
  });

  // ── Atlas dedup variables (added when Meta is selected) ──────────────────
  // These power the browser-first dedup flow: Event ID is generated per tag
  // fire (not per page load) and passed to Meta Pixel + the Atlas Signal Tag.

  if (hasMeta) {
    variables.push({
      ...stub(),
      variableId: varIds.next(),
      name: 'Atlas - Event ID',
      type: 'jsm',
      parameter: [
        tmpl('javascript', `function() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}`),
      ],
      folderId: FOLDER.VARIABLES,
      notes: 'Generates a unique UUID v4 per tag fire. Used as the eventID in Meta fbq() conversion calls and in the Atlas Signal Tag beacon for server-side CAPI deduplication.',
    });

    variables.push({
      ...stub(),
      variableId: varIds.next(),
      name: 'Atlas - Provider Token',
      type: 'c',
      parameter: [tmpl('value', platformIds?.provider_token ?? 'REPLACE_WITH_ATLAS_PROVIDER_TOKEN')],
      folderId: FOLDER.VARIABLES,
      notes: 'Atlas CAPI provider token. Sent as X-Atlas-Provider-Token header in the Signal Tag beacon. Find this value in Atlas → CAPI → Provider settings.',
    });
  }

  // ── Click ID URL Query variables ──────────────────────────────────────────

  const CLICK_ID_KEYS = ['gclid', 'fbclid', 'wbraid', 'gbraid'] as const;
  for (const key of CLICK_ID_KEYS) {
    variables.push({
      ...stub(),
      variableId: varIds.next(),
      name: `URL Query - ${key}`,
      type: 'u',
      parameter: [
        tmpl('component', 'URL_QUERY'),
        tmpl('queryKey', key),
      ],
      folderId: FOLDER.VARIABLES,
    });
  }

  // First-party cookie variables (read back the stored click IDs)
  const CLICK_ID_COOKIES = ['_gcl_aw', '_fbc', '_fbp'] as const;
  for (const cookieName of CLICK_ID_COOKIES) {
    variables.push({
      ...stub(),
      variableId: varIds.next(),
      name: `1P Cookie - ${cookieName}`,
      type: 'k',
      parameter: [
        tmpl('name', cookieName),
      ],
      folderId: FOLDER.VARIABLES,
    });
  }

  // ── UTM URL Query variables ───────────────────────────────────────────────

  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
  for (const key of UTM_KEYS) {
    variables.push({
      ...stub(),
      variableId: varIds.next(),
      name: `URL Query - ${key}`,
      type: 'u',
      parameter: [
        tmpl('component', 'URL_QUERY'),
        tmpl('queryKey', key),
      ],
      folderId: FOLDER.VARIABLES,
    });
  }

  // First-party cookie for session-level traffic source (stored by the capture tag below)
  variables.push({
    ...stub(),
    variableId: varIds.next(),
    name: '1P Cookie - _atlas_traffic_source',
    type: 'k',
    parameter: [tmpl('name', '_atlas_traffic_source')],
    folderId: FOLDER.VARIABLES,
  });

  // ── Collect unique DLV paths needed across all recommendations ────────────
  const dlvPathsSeen = new Map<string, string>(); // path → variableId

  // ensureDlv takes a pre-computed dataLayer PATH (not a raw key).
  // Call dlvPathForParam(key, isEcommerce) before calling this function.
  function ensureDlv(path: string): string {
    if (dlvPathsSeen.has(path)) return dlvPathsSeen.get(path)!;
    const vid = varIds.next();
    variables.push({
      ...stub(),
      variableId: vid,
      name: dlvName(path),
      type: 'v',
      parameter: [
        int('dataLayerVersion', '2'),
        bool('setDefaultValue', 'false'),
        tmpl('name', path),
      ],
      folderId: FOLDER.VARIABLES,
    });
    dlvPathsSeen.set(path, vid);
    return vid;
  }

  // Pre-create both ecommerce-scoped and flat DLVs for common parameter keys.
  // Ecommerce events reference DLV - ecommerce.*, lead_gen events reference DLV - * (flat).
  const ECOMMERCE_DLV_PATHS = ['ecommerce.transaction_id', 'ecommerce.value', 'ecommerce.currency',
    'ecommerce.items', 'ecommerce.tax', 'ecommerce.shipping', 'ecommerce.coupon'];
  for (const path of ECOMMERCE_DLV_PATHS) { ensureDlv(path); }

  const FLAT_DLV_PATHS = ['value', 'currency', 'form_id', 'method', 'search_term'];
  for (const path of FLAT_DLV_PATHS) { ensureDlv(path); }

  // User data DLVs — only when Google Ads is selected (Enhanced Conversions).
  // For other setups, user_data DLVs are created on-demand via the per-event ensureDlv loop.
  if (hasGoogleAds) {
    ensureDlv('user_data.email');
    ensureDlv('user_data.phone_number');
  }

  // ── All Pages trigger ─────────────────────────────────────────────────────
  const allPagesTrigId = trigIds.next();
  triggers.push({
    ...stub(),
    triggerId: allPagesTrigId,
    name: 'All Pages',
    type: 'PAGEVIEW',
    folderId: FOLDER.TRIGGERS,
  });

  // ── Consent Mode v2 init tag ──────────────────────────────────────────────
  const consentTagId = tagIds.next();
  tags.push({
    ...stub(),
    tagId: consentTagId,
    name: 'Atlas - Consent Mode v2 Default',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}

  // Set default consent state before GTM loads
  // Update these defaults based on your CMP (Consent Management Platform)
  gtag('consent', 'default', {
    'ad_storage':         'denied',
    'analytics_storage':  'denied',
    'ad_user_data':       'denied',
    'ad_personalization': 'denied',
    'wait_for_update':    500
  });

  // Mark this page as using enhanced conversions
  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', true);
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [allPagesTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // ── Click ID cookie capture tag ──────────────────────────────────────────
  // Reads gclid, gbraid, wbraid from URL params on every page load.
  // Stores each in a first-party cookie with a 90-day TTL so the click ID
  // survives across pages and sessions (important for lead gen flows).
  // Also pushes captured IDs to the dataLayer for use by GA4 and EC tags.
  const clickIdTagId = tagIds.next();
  tags.push({
    ...stub(),
    tagId: clickIdTagId,
    name: 'Atlas - Click ID Cookie Capture',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
(function() {
  var CLICK_IDS = ['gclid', 'gbraid', 'wbraid'];
  var TTL_DAYS  = 90;

  var expires = new Date();
  expires.setDate(expires.getDate() + TTL_DAYS);
  var expStr  = '; expires=' + expires.toUTCString() + '; path=/; SameSite=Lax';

  var params = new URLSearchParams(window.location.search);

  CLICK_IDS.forEach(function(key) {
    var val = params.get(key);
    if (val) {
      document.cookie = '_atlas_' + key + '=' + encodeURIComponent(val) + expStr;
    }
  });

  function getCookie(name) {
    var match = document.cookie.match('(^|;)\\\\s*' + name + '=([^;]+)');
    return match ? decodeURIComponent(match[2]) : null;
  }

  var captured = {};
  CLICK_IDS.forEach(function(key) {
    var val = getCookie('_atlas_' + key);
    if (val) { captured[key] = val; }
  });

  if (Object.keys(captured).length > 0) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(captured);
  }
})();
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [allPagesTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // ── Consent Mode v2 update tag ───────────────────────────────────────────
  // Fires whenever the CMP pushes consent_update to the dataLayer.
  // The tag reads analytics_consent and ads_consent from the event and
  // calls gtag('consent', 'update') so downstream tags can proceed.
  const consentUpdateTrigId = trigIds.next();
  triggers.push({
    ...stub(),
    triggerId: consentUpdateTrigId,
    name: 'CE - consent_update',
    type: 'CUSTOM_EVENT',
    customEventFilter: [
      {
        type: 'EQUALS',
        parameter: [
          tmpl('arg0', '{{Event}}'),
          tmpl('arg1', 'consent_update'),
        ],
      },
    ],
    folderId: FOLDER.TRIGGERS,
  });

  tags.push({
    ...stub(),
    tagId: tagIds.next(),
    name: 'Atlas - Consent Mode v2 Update',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
  (function() {
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}

    // Read consent decisions pushed by your CMP via:
    //   dataLayer.push({ event: 'consent_update', analytics: true, ads: true })
    var dl = window.dataLayer;
    var latestEvent = dl[dl.length - 1] || {};
    var analyticsGranted = latestEvent.analytics === true ? 'granted' : 'denied';
    var adsGranted       = latestEvent.ads       === true ? 'granted' : 'denied';

    gtag('consent', 'update', {
      'ad_storage':         adsGranted,
      'analytics_storage':  analyticsGranted,
      'ad_user_data':       adsGranted,
      'ad_personalization': adsGranted
    });
  })();
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [consentUpdateTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // ── Click ID capture tags (fire on All Pages) ─────────────────────────────

  // Atlas — Store GCLID: reads gclid from URL and persists in _gcl_aw cookie
  tags.push({
    ...stub(),
    tagId: tagIds.next(),
    name: 'Atlas — Store GCLID',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
(function() {
  try {
    var params = new URLSearchParams(window.location.search);
    var gclid = params.get('gclid');
    if (gclid) {
      var expiry = new Date();
      expiry.setDate(expiry.getDate() + 90);
      var domain = window.location.hostname.replace(/^www\\./, '');
      document.cookie = '_gcl_aw=GCL.' + Math.floor(Date.now() / 1000) + '.' + gclid
        + '; expires=' + expiry.toUTCString()
        + '; path=/; domain=.' + domain + '; SameSite=Lax';
    }
  } catch (e) {}
})();
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [allPagesTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // Atlas — Store FBCLID: reads fbclid from URL and persists in _fbc cookie
  tags.push({
    ...stub(),
    tagId: tagIds.next(),
    name: 'Atlas — Store FBCLID',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
(function() {
  try {
    var params = new URLSearchParams(window.location.search);
    var fbclid = params.get('fbclid');
    if (fbclid) {
      var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      var expiry = new Date();
      expiry.setDate(expiry.getDate() + 90);
      var domain = window.location.hostname.replace(/^www\\./, '');
      document.cookie = '_fbc=' + fbc
        + '; expires=' + expiry.toUTCString()
        + '; path=/; domain=.' + domain + '; SameSite=Lax';
    }
  } catch (e) {}
})();
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [allPagesTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // Atlas — Generate FBP: creates _fbp browser ID cookie if not already set
  tags.push({
    ...stub(),
    tagId: tagIds.next(),
    name: 'Atlas — Generate FBP',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
(function() {
  try {
    var match = document.cookie.match(/(^| )_fbp=([^;]+)/);
    if (!match) {
      var fbp = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 2147483647);
      var expiry = new Date();
      expiry.setDate(expiry.getDate() + 90);
      var domain = window.location.hostname.replace(/^www\\./, '');
      document.cookie = '_fbp=' + fbp
        + '; expires=' + expiry.toUTCString()
        + '; path=/; domain=.' + domain + '; SameSite=Lax';
    }
  } catch (e) {}
})();
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [allPagesTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // ── UTM & Traffic Source capture tag (fires on All Pages) ─────────────────
  // Reads UTM params from URL and referrer, classifies traffic source,
  // and persists session-level attribution in a first-party cookie.
  tags.push({
    ...stub(),
    tagId: tagIds.next(),
    name: 'Atlas — Capture Traffic Source',
    type: 'html',
    parameter: [
      tmpl('html', `<script>
(function() {
  try {
    var params = new URLSearchParams(window.location.search);
    var utmSource   = params.get('utm_source');
    var utmMedium   = params.get('utm_medium');
    var utmCampaign = params.get('utm_campaign');
    var utmContent  = params.get('utm_content');
    var utmTerm     = params.get('utm_term');

    // Only update the session cookie if UTM params are present on this page
    if (utmSource) {
      var source = {
        source:   utmSource,
        medium:   utmMedium   || '(none)',
        campaign: utmCampaign || '(none)',
        content:  utmContent  || '(none)',
        term:     utmTerm     || '(none)',
        channel:  classifyChannel(utmSource, utmMedium),
        ts:       Date.now()
      };
      var expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
      var domain = window.location.hostname.replace(/^www\\./, '');
      document.cookie = '_atlas_traffic_source=' + encodeURIComponent(JSON.stringify(source))
        + '; expires=' + expiry.toUTCString()
        + '; path=/; domain=.' + domain + '; SameSite=Lax';
    } else if (!document.cookie.match(/(^| )_atlas_traffic_source=/)) {
      // No UTM and no existing session: classify from referrer
      var ref = document.referrer;
      var classified = classifyReferrer(ref);
      var expiry2 = new Date();
      expiry2.setDate(expiry2.getDate() + 30);
      var domain2 = window.location.hostname.replace(/^www\\./, '');
      document.cookie = '_atlas_traffic_source=' + encodeURIComponent(JSON.stringify(classified))
        + '; expires=' + expiry2.toUTCString()
        + '; path=/; domain=.' + domain2 + '; SameSite=Lax';
    }

    function classifyChannel(src, med) {
      if (!src) return 'direct';
      if (med === 'cpc' || med === 'ppc' || med === 'paid') return 'paid_search';
      if (med === 'paid_social' || med === 'social_paid') return 'paid_social';
      if (med === 'email') return 'email';
      if (med === 'affiliate') return 'affiliate';
      if (med === 'display') return 'display';
      if (/google|bing|yahoo|duckduckgo/.test(src)) return 'organic_search';
      if (/facebook|instagram|twitter|linkedin|tiktok|pinterest|snapchat/.test(src)) return 'social';
      return 'referral';
    }

    function classifyReferrer(ref) {
      if (!ref) return { source: '(direct)', medium: '(none)', campaign: '(none)', content: '(none)', term: '(none)', channel: 'direct', ts: Date.now() };
      var url;
      try { url = new URL(ref); } catch(e) { return { source: ref, medium: 'referral', campaign: '(none)', content: '(none)', term: '(none)', channel: 'referral', ts: Date.now() }; }
      var host = url.hostname.replace(/^www\\./, '');
      if (/google\\.|bing\\.com|yahoo\\.com|duckduckgo\\.com|baidu\\.com/.test(host)) {
        return { source: host, medium: 'organic', campaign: '(none)', content: '(none)', term: '(none)', channel: 'organic_search', ts: Date.now() };
      }
      if (/facebook\\.com|instagram\\.com|twitter\\.com|x\\.com|linkedin\\.com|tiktok\\.com|pinterest\\.com/.test(host)) {
        return { source: host, medium: 'social', campaign: '(none)', content: '(none)', term: '(none)', channel: 'social', ts: Date.now() };
      }
      return { source: host, medium: 'referral', campaign: '(none)', content: '(none)', term: '(none)', channel: 'referral', ts: Date.now() };
    }
  } catch (e) {}
})();
</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [allPagesTrigId],
    tagFiringOption: 'oncePerEvent',
    folderId: FOLDER.CONFIG,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  });

  // ── GA4 Config tag ─────────────────────────────────────────────────────────
  if (hasGA4) {
    const ga4ConfigId = tagIds.next();
    tags.push({
      ...stub(),
      tagId: ga4ConfigId,
      name: 'GA4 - Config',
      type: 'gaawc',
      parameter: [
        tmpl('measurementId', '{{CONST - GA4 Measurement ID}}'),
        bool('sendPageView', 'true'),
        bool('enableSendToServerContainer', 'false'),
        ...(secondaryDomains.length > 0
          ? [list('linked_domains', secondaryDomains)]
          : []),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: consentSettingsForTag('gaawc', ''),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    // GA4_MEASUREMENT_ID constant variable
    const ga4VarId = varIds.next();
    variables.push({
      ...stub(),
      variableId: ga4VarId,
      name: 'CONST - GA4 Measurement ID',
      type: 'c',
      parameter: [tmpl('value', platformIds?.ga4 ?? 'G-XXXXXXXXXX')],
      folderId: FOLDER.VARIABLES,
    });
  }

  // ── Google Ads Conversion Linker ──────────────────────────────────────────
  if (hasGoogleAds) {
    const linkerTagId = tagIds.next();
    tags.push({
      ...stub(),
      tagId: linkerTagId,
      name: 'Google Ads - Conversion Linker',
      type: 'gclidw',
      parameter: [
        bool('enableCrossDomainLinking', secondaryDomains.length > 0 ? 'true' : 'false'),
        bool('autoLinkDomains', secondaryDomains.length > 0 ? 'true' : 'false'),
        bool('decorateFormsOption', 'false'),
        ...(secondaryDomains.length > 0
          ? [list('domains', secondaryDomains)]
          : []),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: consentSettingsForTag('gclidw', ''),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    // Google Ads variables
    const gadsVarId = varIds.next();
    variables.push({
      ...stub(),
      variableId: gadsVarId,
      name: 'CONST - Google Ads Conversion ID',
      type: 'c',
      parameter: [tmpl('value', platformIds?.google_ads ?? 'AW-XXXXXXXXX')],
      folderId: FOLDER.VARIABLES,
    });
  }

  // ── Meta Base Pixel ──────────────────────────────────────────────────────
  if (hasMeta) {
    const metaBaseTagId = tagIds.next();
    tags.push({
      ...stub(),
      tagId: metaBaseTagId,
      name: 'Meta - Base Pixel',
      type: 'html',
      parameter: [
        tmpl('html', `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '{{CONST - Meta Pixel ID}}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id={{CONST - Meta Pixel ID}}&ev=PageView&noscript=1"/></noscript>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: consentSettingsForTag('html', 'Meta - Base Pixel'),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    const metaVarId = varIds.next();
    variables.push({
      ...stub(),
      variableId: metaVarId,
      name: 'CONST - Meta Pixel ID',
      type: 'c',
      parameter: [tmpl('value', platformIds?.meta ?? 'XXXXXXXXXXXXXXXX')],
      folderId: FOLDER.VARIABLES,
    });
  }

  // ── TikTok Base Pixel ─────────────────────────────────────────────────────
  if (hasTikTok) {
    const ttBaseId = tagIds.next();
    tags.push({
      ...stub(),
      tagId: ttBaseId,
      name: 'TikTok - Base Pixel',
      type: 'html',
      parameter: [
        tmpl('html', `<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track",
  "identify","instances","debug","on","off","once","ready","alias","group",
  "enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){
  t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
  ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)
  ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i=
  "https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},
  ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,
  ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");
  o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;
  var a=document.getElementsByTagName("script")[0];
  a.parentNode.insertBefore(o,a)};
  ttq.load('{{CONST - TikTok Pixel ID}}');ttq.page();
}(window, document, 'ttq');
</script>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: consentSettingsForTag('html', 'TikTok - Base Pixel'),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    const ttVarId = varIds.next();
    variables.push({
      ...stub(),
      variableId: ttVarId,
      name: 'CONST - TikTok Pixel ID',
      type: 'c',
      parameter: [tmpl('value', platformIds?.tiktok ?? 'XXXXXXXXXXXXXXXXXX')],
      folderId: FOLDER.VARIABLES,
    });
  }

  // ── LinkedIn Insight Tag ──────────────────────────────────────────────────
  if (hasLinkedIn) {
    const liBaseId = tagIds.next();
    tags.push({
      ...stub(),
      tagId: liBaseId,
      name: 'LinkedIn - Insight Tag',
      type: 'html',
      parameter: [
        tmpl('html', `<script type="text/javascript">
_linkedin_partner_id = "{{CONST - LinkedIn Partner ID}}";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);
</script><script type="text/javascript">
(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);
</script>
<noscript><img height="1" width="1" style="display:none;" alt=""
src="https://px.ads.linkedin.com/collect/?pid={{CONST - LinkedIn Partner ID}}&fmt=gif" /></noscript>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: consentSettingsForTag('html', 'LinkedIn - Insight Tag'),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    const liVarId = varIds.next();
    variables.push({
      ...stub(),
      variableId: liVarId,
      name: 'CONST - LinkedIn Partner ID',
      type: 'c',
      parameter: [tmpl('value', platformIds?.linkedin ?? 'XXXXXXX')],
      folderId: FOLDER.VARIABLES,
    });
  }

  // ── Per-recommendation: triggers + event tags ─────────────────────────────

  // Deduplicate by event_name — one trigger and one set of platform tags per unique event name
  const eventTriggerMap = new Map<string, string>(); // event_name → triggerId
  const eventTagsSeen = new Set<string>(); // event_name → tags already emitted

  function ensureEventTrigger(irEvent: IREvent): string {
    if (eventTriggerMap.has(irEvent.event_name)) return eventTriggerMap.get(irEvent.event_name)!;
    const tid = trigIds.next();
    const trigDef = renderGTMTrigger(irEvent.trigger, irEvent.event_name, tid, FOLDER.TRIGGERS);
    triggers.push(trigDef);
    eventTriggerMap.set(irEvent.event_name, tid);
    return tid;
  }

  // Pre-merge parameters across all recommendations with the same event_name.
  // When two recommendations share an event_name (e.g., view_promotion on two pages),
  // the single deduplicated tag must map the union of all their parameters so the
  // EVENT_PARAMETERS_COMPLETENESS validator rule doesn't flag missing keys.
  const mergedParamsByEvent = new Map<string, IREvent['parameters']>();
  for (const rec of recommendations) {
    const irEvent = recToIREvent(rec, session.selected_platforms as Platform[]);
    const existing = mergedParamsByEvent.get(irEvent.event_name) ?? [];
    for (const param of irEvent.parameters) {
      if (!existing.some(p => p.key === param.key)) existing.push(param);
    }
    mergedParamsByEvent.set(irEvent.event_name, existing);
  }

  for (const rec of recommendations) {
    const irEvent = recToIREvent(rec, session.selected_platforms as Platform[]);
    const isConversion = irEvent.is_conversion;
    const folderId = isConversion ? FOLDER.CONVERSION : FOLDER.ENGAGEMENT;
    const trigId = ensureEventTrigger(irEvent);

    // Ensure DLVs for all IR event parameters (all recs, before dedup check)
    const isEcommerce = ECOMMERCE_SNIPPET_ACTIONS.has(irEvent.action_type);
    for (const param of irEvent.parameters) {
      ensureDlv(dlvPathForParam(param.key, isEcommerce));
    }

    // Skip emitting platform tags for duplicate event names — triggers are already
    // deduplicated above; emitting another set of tags would create duplicate tag names.
    if (eventTagsSeen.has(irEvent.event_name)) continue;
    eventTagsSeen.add(irEvent.event_name);

    // Use the merged parameter set so the single tag covers all pages' parameters
    const mergedIREvent: IREvent = { ...irEvent, parameters: mergedParamsByEvent.get(irEvent.event_name) ?? irEvent.parameters };

    // ── GA4 Event Tag ───────────────────────────────────────────────────────
    if (hasGA4) {
      const ga4EventParams = renderGA4EventParameters(mergedIREvent);
      tags.push({
        ...stub(),
        tagId: tagIds.next(),
        name: `GA4 - ${mergedIREvent.event_name}`,
        type: 'gaawe',
        parameter: [tmpl('eventName', mergedIREvent.event_name), ...ga4EventParams],
        firingTriggerId: [trigId],
        tagFiringOption: 'oncePerEvent',
        folderId,
        consentSettings: consentSettingsForTag('gaawe', ''),
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      });

      // ── Standard Event Alias Tag (Smart Bidding) ──────────────────────────
      // Fires a second GA4 tag with the standard event name so Smart Bidding
      // can recognise the conversion without renaming the primary event.
      // e.g. GA4 - contact_form_submit (generate_lead alias)
      const aliasTag = renderStandardEventAliasTag(mergedIREvent, trigId, tagIds.next(), folderId);
      if (aliasTag) tags.push(aliasTag);
    }

    // ── Google Ads Conversion Tag (per-event label variable) ────────────────
    if (hasGoogleAds && isConversion) {
      const { tag: gadsTag, labelVar } = renderGoogleAdsConversionTag(
        mergedIREvent,
        trigId,
        tagIds.next(),
        varIds.next(),
        FOLDER.CONVERSION,
        'CONST - Google Ads Conversion ID',
        platformIds,
      );
      variables.push(labelVar);
      tags.push(gadsTag);
    }

    // ── Meta Event Tag ──────────────────────────────────────────────────────
    if (hasMeta) {
      tags.push(renderMetaEventTag(mergedIREvent, trigId, tagIds.next(), folderId));
    }

    // ── TikTok Event Tag ────────────────────────────────────────────────────
    if (hasTikTok) {
      tags.push(renderTikTokEventTag(mergedIREvent, trigId, tagIds.next(), folderId));
    }

    // ── LinkedIn Conversion Tag ─────────────────────────────────────────────
    if (hasLinkedIn && isConversion) {
      tags.push(renderLinkedInConversionTag(
        mergedIREvent,
        trigId,
        tagIds.next(),
        folderId,
        platformIds?.linkedin_conversion_id,
      ));
    }
  }

  // ── Atlas Signal Tag ──────────────────────────────────────────────────────
  // Beacons the Atlas Event ID to the backend before the server-side CAPI job
  // fires, so metaDelivery can look up the same event_id from Redis and include
  // it in the CAPI payload for deduplication.
  // Uses fetch + keepalive (not sendBeacon) to support the required header.
  if (hasMeta && eventTriggerMap.size > 0) {
    const allEventTrigIds = [...eventTriggerMap.values()];
    tags.push({
      ...stub(),
      tagId: tagIds.next(),
      name: 'Atlas - Signal Tag',
      type: 'html',
      parameter: [
        tmpl('html', `<script>
(function() {
  // Consent gate — only beacon if ad consent is granted
  function adsConsentGranted() {
    var dl = window.dataLayer || [];
    for (var i = dl.length - 1; i >= 0; i--) {
      if (dl[i] && dl[i].event === 'consent_update') {
        return dl[i].ads === true;
      }
    }
    return false;
  }
  if (!adsConsentGranted()) return;

  var payload = {
    event_id:   '{{Atlas - Event ID}}',
    event_name: '{{Event}}',
    fbc:        '{{1P Cookie - _fbc}}' || null,
    gclid:      '{{URL Query - gclid}}' || null,
    session_id: null,
    timestamp:  Date.now(),
    event_data: {
      value:    '{{DLV - ecommerce.value}}',
      currency: '{{DLV - ecommerce.currency}}',
    },
  };

  try {
    fetch('https://api.atlas.vimi.digital/api/capi/browser-event', {
      method:    'POST',
      headers:   {
        'Content-Type':           'application/json',
        'X-Atlas-Provider-Token': '{{Atlas - Provider Token}}',
      },
      body:      JSON.stringify(payload),
      keepalive: true,
    }).catch(function() {});
  } catch (e) {}
})();
</script>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: allEventTrigIds,
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: consentSettingsForTag('html', 'Meta - Signal Tag'),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });
  }

  // ── Folders ───────────────────────────────────────────────────────────────
  const folders: GTMFolderDef[] = [
    { ...stub(), folderId: FOLDER.CONFIG,     name: 'Atlas — Configuration' },
    { ...stub(), folderId: FOLDER.CONVERSION, name: 'Atlas — Conversion Events' },
    { ...stub(), folderId: FOLDER.ENGAGEMENT, name: 'Atlas — Engagement Events' },
    { ...stub(), folderId: FOLDER.VARIABLES,  name: 'Atlas — Variables' },
    { ...stub(), folderId: FOLDER.TRIGGERS,   name: 'Atlas — Triggers' },
  ];

  // ── Assemble container ────────────────────────────────────────────────────
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const platformList = platforms.map(p => p.toUpperCase()).join(', ');
  const recCount = recommendations.length;

  return {
    exportFormatVersion: 2,
    exportTime: now,
    containerVersion: {
      path: 'accounts/0/containers/0/versions/0',
      accountId: '0',
      containerId: '0',
      containerVersionId: '0',
      name: 'Atlas Generated Tracking',
      description: `Generated by Atlas Planning Mode. ${recCount} tracking recommendation(s) for platforms: ${platformList}. ${platformIds ? 'Platform IDs have been pre-filled from your client configuration.' : 'Import this container into your GTM workspace, then fill in the placeholder values (GA4 Measurement ID, Google Ads Conversion ID, Meta Pixel ID, etc.) in the Variables section.'}`,
      container: {
        path: 'accounts/0/containers/0',
        accountId: '0',
        containerId: '0',
        name: 'Atlas Generated Tracking',
        publicId: 'GTM-PLACEHOLDER',
        usageContext: ['WEB'],
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      },
      tag: tags,
      trigger: triggers,
      variable: variables,
      folder: folders,
      builtInVariable: builtInVariables,
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    },
  };
}
