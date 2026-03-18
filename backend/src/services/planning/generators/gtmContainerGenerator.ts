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
import { ACTION_PRIMITIVES } from '@/services/journey/actionPrimitives';

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

// ── Meta event name mapping ───────────────────────────────────────────────────

const META_EVENT: Record<string, string> = {
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

const TIKTOK_EVENT: Record<string, string> = {
  purchase:        'CompletePayment',
  add_to_cart:     'AddToCart',
  begin_checkout:  'InitiateCheckout',
  generate_lead:   'SubmitForm',
  sign_up:         'CompleteRegistration',
  view_item:       'ViewContent',
  search:          'Search',
};

// ── Conversion event actions (go into Conversion folder) ────────────────────

const CONVERSION_ACTIONS = new Set(['purchase', 'generate_lead', 'sign_up']);

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

function stub(accountId = '0', containerId = '0') {
  return {
    accountId,
    containerId,
    fingerprint: '0',
    tagManagerUrl: 'https://tagmanager.google.com/',
  };
}

function ecommerceDlvPath(paramKey: string): string {
  // Map param keys to their dataLayer paths
  const ECOMMERCE_PARAMS = new Set(['transaction_id', 'value', 'currency', 'items', 'tax', 'shipping', 'coupon', 'item_list_name']);
  if (ECOMMERCE_PARAMS.has(paramKey)) return `ecommerce.${paramKey}`;
  if (paramKey === 'email' || paramKey === 'user_email') return 'user_data.email';
  if (paramKey === 'phone' || paramKey === 'phone_number' || paramKey === 'user_phone') return 'user_data.phone_number';
  return paramKey;
}

function dlvName(path: string): string { return `DLV - ${path}`; }
function dlvRef(path: string): string { return `{{DLV - ${path}}}`; }

// ── Main generator ────────────────────────────────────────────────────────────

export interface GTMPlatformIds {
  ga4?: string;
  google_ads?: string;
  meta?: string;
  tiktok?: string;
  linkedin?: string;
  linkedin_conversion_id?: string;
  google_ads_conversion_label?: string;
}

export function generateGTMContainer(
  recommendations: PlanningRecommendation[],
  session: Pick<PlanningSession, 'business_type' | 'selected_platforms'>,
  platformIds?: GTMPlatformIds,
): GTMContainerJSON {
  const platforms = session.selected_platforms;
  const hasGA4         = platforms.includes('ga4');
  const hasGoogleAds   = platforms.includes('google_ads');
  const hasMeta        = platforms.includes('meta');
  const hasTikTok      = platforms.includes('tiktok');
  const hasLinkedIn    = platforms.includes('linkedin');

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

  // ── Collect unique DLV paths needed across all recommendations ────────────
  const dlvPathsSeen = new Map<string, string>(); // path → variableId

  function ensureDlv(paramKey: string): string {
    const path = ecommerceDlvPath(paramKey);
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

  // Pre-create common DLVs used by multiple events
  for (const key of ['transaction_id', 'value', 'currency', 'items', 'email', 'phone_number', 'form_id', 'method']) {
    ensureDlv(key);
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

  // ── GA4 Config tag ─────────────────────────────────────────────────────────
  if (hasGA4) {
    const ga4ConfigId = tagIds.next();
    tags.push({
      ...stub(),
      tagId: ga4ConfigId,
      name: 'GA4 - Config',
      type: 'gaawc',
      parameter: [
        tmpl('measurementId', platformIds?.ga4 ?? '{{GA4_MEASUREMENT_ID}}'),
        bool('sendPageView', 'true'),
        bool('enableSendToServerContainer', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: { consentStatus: 'notSet' },
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
        bool('enableCrossDomainLinking', 'false'),
        bool('autoLinkDomains', 'false'),
        bool('decorateFormsOption', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: { consentStatus: 'notSet' },
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
fbq('init', '${platformIds?.meta ?? '{{META_PIXEL_ID}}'}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${platformIds?.meta ?? '{{META_PIXEL_ID}}'}&ev=PageView&noscript=1"/></noscript>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: { consentStatus: 'notSet' },
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
  ttq.load('${platformIds?.tiktok ?? '{{TIKTOK_PIXEL_ID}}'}');ttq.page();
}(window, document, 'ttq');
</script>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: { consentStatus: 'notSet' },
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
_linkedin_partner_id = "${platformIds?.linkedin ?? '{{LINKEDIN_PARTNER_ID}}'}";
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
src="https://px.ads.linkedin.com/collect/?pid=${platformIds?.linkedin ?? '{{LINKEDIN_PARTNER_ID}}'}&fmt=gif" /></noscript>`),
        bool('supportDocumentWrite', 'false'),
      ],
      firingTriggerId: [allPagesTrigId],
      tagFiringOption: 'oncePerEvent',
      folderId: FOLDER.CONFIG,
      consentSettings: { consentStatus: 'notSet' },
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

  // Deduplicate by event_name — one trigger per unique event name
  const eventTriggerMap = new Map<string, string>(); // event_name → triggerId

  function ensureEventTrigger(eventName: string): string {
    if (eventTriggerMap.has(eventName)) return eventTriggerMap.get(eventName)!;
    const tid = trigIds.next();
    triggers.push({
      ...stub(),
      triggerId: tid,
      name: `CE - ${eventName}`,
      type: 'CUSTOM_EVENT',
      customEventFilter: [{
        type: 'EQUALS',
        parameter: [
          tmpl('arg0', '{{Event}}'),
          tmpl('arg1', eventName),
        ],
      }],
      folderId: FOLDER.TRIGGERS,
    });
    eventTriggerMap.set(eventName, tid);
    return tid;
  }

  for (const rec of recommendations) {
    const eventName = rec.event_name;
    const actionKey = rec.action_type;
    const isConversion = CONVERSION_ACTIONS.has(actionKey);
    const folderId = isConversion ? FOLDER.CONVERSION : FOLDER.ENGAGEMENT;
    const trigId = ensureEventTrigger(eventName);

    // Ensure DLVs exist for all required params
    const recParams = (rec.required_params as unknown as Array<{ param_key: string }>) ?? [];
    for (const p of recParams) {
      ensureDlv(p.param_key);
    }

    const primitive = ACTION_PRIMITIVES.find(a => a.key === actionKey);
    const label = primitive?.label ?? eventName;

    // ── GA4 Event Tag ───────────────────────────────────────────────────────
    if (hasGA4) {
      const ga4Params: GTMParameter[] = [];
      const ga4TagParams: GTMParameter[] = [
        { type: 'TEMPLATE', key: 'eventName', value: eventName },
      ];

      // Map standard parameters
      const paramsList: GTMParameter[] = [];

      if (['purchase', 'add_to_cart', 'begin_checkout', 'view_item', 'view_item_list'].includes(actionKey)) {
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'items'), tmpl('value', dlvRef('ecommerce.items'))] });
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'value'), tmpl('value', dlvRef('ecommerce.value'))] });
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'currency'), tmpl('value', dlvRef('ecommerce.currency'))] });
        if (actionKey === 'purchase') {
          paramsList.push({ type: 'MAP', map: [tmpl('key', 'transaction_id'), tmpl('value', dlvRef('ecommerce.transaction_id'))] });
        }
      } else if (actionKey === 'generate_lead') {
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'form_id'), tmpl('value', dlvRef('form_id'))] });
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'value'), tmpl('value', dlvRef('value'))] });
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'currency'), tmpl('value', dlvRef('currency'))] });
      } else if (actionKey === 'sign_up') {
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'method'), tmpl('value', dlvRef('method'))] });
      } else if (actionKey === 'search') {
        paramsList.push({ type: 'MAP', map: [tmpl('key', 'search_term'), tmpl('value', dlvRef('search_term'))] });
      }

      if (paramsList.length > 0) {
        ga4TagParams.push({ type: 'LIST', key: 'eventParameters', list: paramsList });
      }

      void ga4Params; // unused, kept for clarity
      tags.push({
        ...stub(),
        tagId: tagIds.next(),
        name: `GA4 - ${label}`,
        type: 'gaawe',
        parameter: ga4TagParams,
        firingTriggerId: [trigId],
        tagFiringOption: 'oncePerEvent',
        folderId,
        consentSettings: { consentStatus: 'notSet' },
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      });
    }

    // ── Google Ads Conversion Tag ───────────────────────────────────────────
    if (hasGoogleAds && isConversion) {
      const gadsParams: GTMParameter[] = [
        tmpl('conversionId', '{{CONST - Google Ads Conversion ID}}'),
        tmpl('conversionLabel', platformIds?.google_ads_conversion_label ?? '{{CONVERSION_LABEL}}'),
        tmpl('currencyCode', dlvRef('ecommerce.currency')),
      ];
      if (actionKey === 'purchase') {
        gadsParams.push(tmpl('conversionValue', dlvRef('ecommerce.value')));
        gadsParams.push(tmpl('orderId', dlvRef('ecommerce.transaction_id')));
      }
      tags.push({
        ...stub(),
        tagId: tagIds.next(),
        name: `Google Ads - ${label} Conversion`,
        type: 'awct',
        parameter: gadsParams,
        firingTriggerId: [trigId],
        tagFiringOption: 'oncePerEvent',
        folderId,
        consentSettings: { consentStatus: 'notSet' },
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      });
    }

    // ── Meta Event Tag ──────────────────────────────────────────────────────
    if (hasMeta) {
      const metaEvent = META_EVENT[actionKey] ?? 'CustomEvent';
      let fbqParams = '{}';
      if (actionKey === 'purchase') {
        fbqParams = `{value: {{DLV - ecommerce.value}}, currency: {{DLV - ecommerce.currency}}, content_type: 'product'}`;
      } else if (actionKey === 'add_to_cart') {
        fbqParams = `{value: {{DLV - ecommerce.value}}, currency: {{DLV - ecommerce.currency}}, content_type: 'product'}`;
      } else if (actionKey === 'generate_lead') {
        fbqParams = `{value: {{DLV - value}}, currency: {{DLV - currency}}}`;
      }
      tags.push({
        ...stub(),
        tagId: tagIds.next(),
        name: `Meta - ${label}`,
        type: 'html',
        parameter: [
          tmpl('html', `<script>fbq('track', '${metaEvent}', ${fbqParams});</script>`),
          bool('supportDocumentWrite', 'false'),
        ],
        firingTriggerId: [trigId],
        tagFiringOption: 'oncePerEvent',
        folderId,
        consentSettings: { consentStatus: 'notSet' },
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      });
    }

    // ── TikTok Event Tag ────────────────────────────────────────────────────
    if (hasTikTok) {
      const ttEvent = TIKTOK_EVENT[actionKey] ?? 'CustomEvent';
      let ttParams = '{}';
      if (actionKey === 'purchase') {
        ttParams = `{value: {{DLV - ecommerce.value}}, currency: {{DLV - ecommerce.currency}}, content_type: 'product'}`;
      }
      tags.push({
        ...stub(),
        tagId: tagIds.next(),
        name: `TikTok - ${label}`,
        type: 'html',
        parameter: [
          tmpl('html', `<script>ttq.track('${ttEvent}', ${ttParams});</script>`),
          bool('supportDocumentWrite', 'false'),
        ],
        firingTriggerId: [trigId],
        tagFiringOption: 'oncePerEvent',
        folderId,
        consentSettings: { consentStatus: 'notSet' },
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      });
    }

    // ── LinkedIn Conversion Tag ─────────────────────────────────────────────
    if (hasLinkedIn && isConversion) {
      tags.push({
        ...stub(),
        tagId: tagIds.next(),
        name: `LinkedIn - ${label}`,
        type: 'html',
        parameter: [
          tmpl('html', `<script>lintrk('track', {conversion_id: '${platformIds?.linkedin_conversion_id ?? '{{LINKEDIN_CONVERSION_ID}}' }'});</script>`),
          bool('supportDocumentWrite', 'false'),
        ],
        firingTriggerId: [trigId],
        tagFiringOption: 'oncePerEvent',
        folderId,
        consentSettings: { consentStatus: 'notSet' },
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      });
    }
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
