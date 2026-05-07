/**
 * GTM Renderer — deterministically produces GTM tag and variable definitions from IR.
 *
 * Key rules:
 *   renderGA4EventParameters  — maps ALL IR parameters, no events exempted
 *   renderGoogleAdsConversionTag — per-event CONST - GAds Conversion Label - {event_name}
 *                                  variable, enhancedConversionsEnabled: true,
 *                                  DLV - user_data.* variables
 *   renderConsentSettings     — never notSet (delegated to consent.renderer)
 *   renderInfrastructureTags  — conditional on ir.platforms (Meta only if 'meta', etc.)
 */

import type { IREvent, AtlasIR } from '../ir.types';
import { ECOMMERCE_SNIPPET_ACTIONS } from '../ir.types';
import type {
  GTMTagDef,
  GTMVariableDef,
  GTMTriggerDef,
  GTMParameter,
  GTMPlatformIds,
} from '../gtmContainerGenerator';
import { consentSettingsForTag } from './consent.renderer';

// ── Primitive helpers (mirrors gtmContainerGenerator.ts style) ────────────────

function tmpl(key: string, value: string): GTMParameter {
  return { type: 'TEMPLATE', key, value };
}
function bool(key: string, value: string): GTMParameter {
  return { type: 'BOOLEAN', key, value };
}
function int(key: string, value: string): GTMParameter {
  return { type: 'INTEGER', key, value };
}

function stub(accountId = '0', containerId = '0') {
  return { accountId, containerId, fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/' };
}

function dlvRef(path: string): string { return `{{DLV - ${path}}}`; }
function dlvName(path: string): string { return `DLV - ${path}`; }
function constRef(name: string): string { return `{{${name}}}`; }
function gadsLabelVarName(eventName: string): string {
  return `CONST - GAds Conversion Label - ${eventName}`;
}

// ── Meta event name mapping ───────────────────────────────────────────────────

const META_EVENT_NAME: Record<string, string> = {
  purchase:        'Purchase',
  add_to_cart:     'AddToCart',
  begin_checkout:  'InitiateCheckout',
  generate_lead:   'Lead',
  sign_up:         'CompleteRegistration',
  view_item:       'ViewContent',
  view_item_list:  'ViewContent',
  search:          'Search',
};

// ── TikTok event name mapping ─────────────────────────────────────────────────

const TIKTOK_EVENT_NAME: Record<string, string> = {
  purchase:        'CompletePayment',
  add_to_cart:     'AddToCart',
  begin_checkout:  'InitiateCheckout',
  generate_lead:   'SubmitForm',
  sign_up:         'CompleteRegistration',
  view_item:       'ViewContent',
  search:          'Search',
};

// ── GA4 Event Parameters ──────────────────────────────────────────────────────

/** Ecommerce param keys that live under the nested ecommerce: object. */
const ECOMMERCE_DLV_KEYS = new Set([
  'transaction_id', 'value', 'currency', 'items',
  'tax', 'shipping', 'coupon', 'item_list_name', 'item_list_id',
]);

/**
 * Map a parameter key to its dataLayer path, taking ecommerce context into account.
 * Exported so that the outer generator can create matching DLV variables.
 */
export function dlvPathForParam(key: string, isEcommerceEvent: boolean): string {
  // User data always nested, regardless of business type
  if (key === 'email' || key === 'user_email') return 'user_data.email';
  if (key === 'phone' || key === 'phone_number' || key === 'user_phone') return 'user_data.phone_number';
  // Ecommerce params only get the nested path in ecommerce context
  if (isEcommerceEvent && ECOMMERCE_DLV_KEYS.has(key)) return `ecommerce.${key}`;
  return key;
}

/**
 * Render the eventParameters LIST for a GA4 event tag.
 * Maps ALL IR parameters — no events are exempted. Each parameter becomes
 * a MAP entry: key = param.key, value = {{DLV - dlvPath}}.
 */
export function renderGA4EventParameters(event: IREvent): GTMParameter[] {
  if (event.parameters.length === 0) return [];

  const isEcommerce = ECOMMERCE_SNIPPET_ACTIONS.has(event.action_type);
  const mapItems: GTMParameter[] = event.parameters.map(param => ({
    type: 'MAP' as const,
    map: [
      tmpl('key', param.key),
      tmpl('value', dlvRef(dlvPathForParam(param.key, isEcommerce))),
    ],
  }));

  return [{ type: 'LIST', key: 'eventParameters', list: mapItems }];
}

// ── DLV variable builder ──────────────────────────────────────────────────────

/**
 * Build a DLV GTMVariableDef for a given dataLayer path.
 */
export function buildDlvVariable(
  path: string,
  variableId: string,
  folderId: string,
  label?: string,
): GTMVariableDef {
  return {
    ...stub(),
    variableId,
    name: dlvName(path),
    type: 'v',
    parameter: [
      int('dataLayerVersion', '2'),
      bool('setDefaultValue', 'false'),
      tmpl('name', path),
    ],
    folderId,
    ...(label ? { notes: `${label} — reads from dataLayer path: ${path}` } : {}),
  };
}

// ── Google Ads Conversion Tag ─────────────────────────────────────────────────

export interface GoogleAdsConversionResult {
  tag: GTMTagDef;
  labelVar: GTMVariableDef;
  userDataEmailVar?: GTMVariableDef;
  userDataPhoneVar?: GTMVariableDef;
}

/**
 * Render a Google Ads conversion tag and its per-event CONST label variable.
 *
 * - Every conversion event gets its own `CONST - GAds Conversion Label - {event_name}` variable
 * - Tags reference that variable — never the shared {{CONVERSION_LABEL}}
 * - enhancedConversionsEnabled: true always present
 * - DLV - user_data.email and DLV - user_data.phone_number added when not yet in the container
 */
export function renderGoogleAdsConversionTag(
  event: IREvent,
  trigId: string,
  tagId: string,
  labelVarId: string,
  folderId: string,
  conversionIdVarName: string,
  platformIds?: GTMPlatformIds,
): GoogleAdsConversionResult {
  const labelVarName = gadsLabelVarName(event.event_name);

  // Per-event CONST variable for the conversion label
  const labelVar: GTMVariableDef = {
    ...stub(),
    variableId: labelVarId,
    name: labelVarName,
    type: 'c',
    parameter: [tmpl('value', platformIds?.google_ads_conversion_label ?? '')],
    folderId,
    notes: `Google Ads conversion label for "${event.event_name}". Find it in Google Ads → Goals → Conversions → select conversion → Tag setup.`,
  };

  const isEcommercePurchase = event.action_type === 'purchase';

  const tagParams: GTMParameter[] = [
    tmpl('conversionId', constRef(conversionIdVarName)),
    tmpl('conversionLabel', constRef(labelVarName)),
    // Enhanced conversions
    bool('enhancedConversionsEnabled', 'true'),
    tmpl('userDataEmail', dlvRef('user_data.email')),
    tmpl('userDataPhoneNumber', dlvRef('user_data.phone_number')),
  ];

  if (isEcommercePurchase) {
    tagParams.push(tmpl('conversionValue', dlvRef('ecommerce.value')));
    tagParams.push(tmpl('currencyCode', dlvRef('ecommerce.currency')));
    tagParams.push(tmpl('orderId', dlvRef('ecommerce.transaction_id')));
  } else {
    // Lead gen: value from flat dataLayer
    tagParams.push(tmpl('conversionValue', dlvRef('value')));
    tagParams.push(tmpl('currencyCode', dlvRef('currency')));
  }

  const tag: GTMTagDef = {
    ...stub(),
    tagId,
    name: `Google Ads - ${event.event_name} Conversion`,
    type: 'awct',
    parameter: tagParams,
    firingTriggerId: [trigId],
    tagFiringOption: 'oncePerEvent',
    folderId,
    consentSettings: consentSettingsForTag('awct', ''),
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };

  return { tag, labelVar };
}

// ── Meta Event Tag ────────────────────────────────────────────────────────────

/**
 * Render a Meta Pixel event tag from an IR event.
 * Conversion events include the 4th fbq() argument for server-side CAPI deduplication.
 */
export function renderMetaEventTag(
  event: IREvent,
  trigId: string,
  tagId: string,
  folderId: string,
): GTMTagDef {
  const metaEvent = META_EVENT_NAME[event.event_name] ?? META_EVENT_NAME[event.action_type] ?? 'CustomEvent';
  const isEcommercePurchase = event.action_type === 'purchase';
  const isAddToCart = event.action_type === 'add_to_cart';
  const isLead = event.action_type === 'generate_lead';

  let fbqParams = '{}';
  if (isEcommercePurchase || isAddToCart) {
    fbqParams = `{value: ${dlvRef('ecommerce.value')}, currency: ${dlvRef('ecommerce.currency')}, content_type: 'product'}`;
  } else if (isLead) {
    fbqParams = `{value: ${dlvRef('value')}, currency: ${dlvRef('currency')}}`;
  }

  const fbqCall = event.is_conversion
    ? `fbq('track', '${metaEvent}', ${fbqParams}, {eventID: '{{Atlas - Event ID}}'})`
    : `fbq('track', '${metaEvent}', ${fbqParams})`;

  return {
    ...stub(),
    tagId,
    name: `Meta - ${event.event_name}`,
    type: 'html',
    parameter: [
      tmpl('html', `<script>${fbqCall};</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [trigId],
    tagFiringOption: 'oncePerEvent',
    folderId,
    consentSettings: consentSettingsForTag('html', `Meta - ${event.event_name}`),
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };
}

// ── TikTok Event Tag ──────────────────────────────────────────────────────────

export function renderTikTokEventTag(
  event: IREvent,
  trigId: string,
  tagId: string,
  folderId: string,
): GTMTagDef {
  const ttEvent = TIKTOK_EVENT_NAME[event.event_name] ?? TIKTOK_EVENT_NAME[event.action_type] ?? 'CustomEvent';
  let ttParams = '{}';
  if (event.action_type === 'purchase') {
    ttParams = `{value: ${dlvRef('ecommerce.value')}, currency: ${dlvRef('ecommerce.currency')}, content_type: 'product'}`;
  }
  return {
    ...stub(),
    tagId,
    name: `TikTok - ${event.event_name}`,
    type: 'html',
    parameter: [
      tmpl('html', `<script>ttq.track('${ttEvent}', ${ttParams});</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [trigId],
    tagFiringOption: 'oncePerEvent',
    folderId,
    consentSettings: consentSettingsForTag('html', `TikTok - ${event.event_name}`),
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };
}

// ── LinkedIn Conversion Tag ───────────────────────────────────────────────────

export function renderLinkedInConversionTag(
  event: IREvent,
  trigId: string,
  tagId: string,
  folderId: string,
  conversionId?: string,
): GTMTagDef {
  const lid = conversionId ?? '{{LINKEDIN_CONVERSION_ID}}';
  return {
    ...stub(),
    tagId,
    name: `LinkedIn - ${event.event_name}`,
    type: 'html',
    parameter: [
      tmpl('html', `<script>lintrk('track', {conversion_id: '${lid}'});</script>`),
      bool('supportDocumentWrite', 'false'),
    ],
    firingTriggerId: [trigId],
    tagFiringOption: 'oncePerEvent',
    folderId,
    consentSettings: consentSettingsForTag('html', `LinkedIn - ${event.event_name}`),
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };
}

// ── Standard Event Alias Tag ──────────────────────────────────────────────────

/**
 * Render a second GA4 event tag for the standard_event_alias (e.g. 'generate_lead').
 * This allows Smart Bidding to recognise the event without renaming the primary event.
 */
export function renderStandardEventAliasTag(
  event: IREvent,
  trigId: string,
  tagId: string,
  folderId: string,
): GTMTagDef | null {
  if (!event.standard_event_alias) return null;

  const aliasParams = renderGA4EventParameters(event);

  return {
    ...stub(),
    tagId,
    name: `GA4 - ${event.event_name} (${event.standard_event_alias} alias)`,
    type: 'gaawe',
    parameter: [
      tmpl('eventName', event.standard_event_alias),
      ...aliasParams,
    ],
    firingTriggerId: [trigId],
    tagFiringOption: 'oncePerEvent',
    folderId,
    consentSettings: consentSettingsForTag('gaawe', ''),
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };
}

// ── Infrastructure tag type exports ───────────────────────────────────────────

// Re-export for consumers that build the full container
export type { GTMTagDef, GTMVariableDef, GTMTriggerDef, GTMParameter };
export { bool, tmpl, int, stub, dlvRef, dlvName, constRef, gadsLabelVarName };
