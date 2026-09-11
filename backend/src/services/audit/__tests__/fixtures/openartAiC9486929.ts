/**
 * Regression fixture — audit `c9486929-4f8b-4179-8e09-97f610815fba`
 * (openart.ai, 9 September 2026), the reference run named throughout the
 * Pre-Connection Scan Confidence Tiering PRD (§1's three contradictions,
 * §14's acceptance criteria). Backs
 * `../acceptanceReplay.c9486929.test.ts` — see that file for what's
 * actually asserted.
 *
 * **Scope decision, documented like every other sprint-scoping call in
 * this plan**: Atlas persists a v2 audit's per-rule `ValidationResult[]`
 * (`audit_results`) and its rendered `ReportJSON` (`audit_reports`), never
 * the raw `AuditData` a rule's `test()` reads (network requests, cookie
 * attribute sets, dataLayer pushes, JS errors) — that lives only in
 * memory for the duration of one orchestrator.ts run and is discarded
 * after scoring/reporting. This is true for every historical audit,
 * `7d64f5e9` (the click-ID PRD's own reference audit) included — its
 * regression fixture (clickIdContention.test.ts) never re-executes
 * `runRegister()` either; it feeds a hand-built `ValidationResult[]`
 * reproducing the real shape straight into the partition function under
 * test. This fixture follows the same precedent, one level up: `RAW_RESULTS`
 * below is the *real* `audit_results` row set for c9486929 (fetched
 * directly from the production database, rule_id/validation_layer/status/
 * severity/technical_details verbatim), not a re-execution of the 80-odd
 * rule `test()` functions against reconstructed network traffic. Two
 * rules that have since been split are adapted by hand from that same
 * real evidence (documented at each site below); everything else is an
 * unmodified copy.
 *
 * `AUDIT_DATA` is a real-derived, but necessarily reconstructed, `AuditData`
 * — sufficient to drive the actual (not reimplemented) downstream
 * mechanisms this fixture replays: `signalConsistency.ts` (needs
 * `dataLayer`/`declared_platforms`/`networkRequests`), `clickIdContention.ts`
 * (needs `urlParams`), `coverageSuppression.ts`/`degradationSuppression.ts`
 * (need `step_coverage`), `scoring.ts` (needs only `results`),
 * `coverage.ts`'s `computeRunQuality` (needs `step_coverage`). Every field
 * on it is either copied verbatim from the real `audits` row / real
 * `audit_reports.report_json.executive_summary.coverage.steps`, or
 * reconstructed from a specific real per-rule evidence string cited inline.
 */
import type { AuditData, DataLayerEvent, SiteSetupSummary, StepCoverage, ValidationResult } from '@/types/audit';

/**
 * A gtag.js-shaped dataLayer push, captured by dataCapture.ts's real
 * instrumentation as `dataLayer.push(arguments)` — numeric-indexed
 * (`{0: verb, 1: target}`), not the named `{event: ...}` shape GTM's own
 * pushes carry. `DataLayerEvent`'s declared shape has no index signature
 * for this (signalConsistency.ts's `gtagPush()` reads it via an explicit
 * cast on the consuming side too), so this fixture builds it the same way.
 */
function gtagCall(verb: string, target: string, step: string, timestamp: number): DataLayerEvent {
  return { event: '', timestamp, step, 0: verb, 1: target } as unknown as DataLayerEvent;
}

const AUDIT_ID = 'c9486929-4f8b-4179-8e09-97f610815fba';

function r(
  rule_id: string,
  validation_layer: string,
  status: ValidationResult['status'],
  severity: ValidationResult['severity'],
  found: string,
  expected: string,
  evidence: string[],
): ValidationResult {
  return {
    rule_id,
    validation_layer: validation_layer as ValidationResult['validation_layer'],
    status,
    severity,
    technical_details: { found, expected, evidence },
  };
}

/**
 * The real `audit_results` rows for c9486929, rule_id/validation_layer/
 * status/severity/technical_details verbatim, EXCEPT two rules retired
 * since this audit ran, each replaced by its two real successors (both
 * already shipped in the register — see L1.ts/L3.ts's own PRD §10.2/§10.4
 * comments, which cite this exact audit):
 *
 *  - `GOOGLE_GLOBAL_SITE_TAG_PRESENT` (real: fail, "No gtag.js loader with
 *    an AW- conversion ID detected") → `GTAG_LOADER_PRESENT` (still fail —
 *    the real evidence only ever checked the AW--scoped host, so there's
 *    no real signal this fixture can honestly repurpose as "a bare loader
 *    was seen"; CONF_02 below is exactly the mechanism that catches this
 *    narrowness) + `GOOGLE_ADS_AW_ID_PRESENT` (fail, same real "no AW-
 *    ID" evidence, now narrowed to only the question it actually answers).
 *  - `FBP_AND_FBC_COOKIES_PRESENT` (real: fail, "_fbp present: false, _fbc
 *    present: false, _fbc inconclusive under synthetic injection... not
 *    counted toward this result") → `FBP_COOKIE_PRESENT` (fail, the real
 *    gated _fbp fact) + `FBC_COOKIE_PRESENT` (skipped — this rule's
 *    current test() always returns 'skipped' in a crawl context
 *    regardless of input, per L3.ts's own PRD §10.4 comment, so this
 *    matches its real behaviour exactly).
 */
export const RAW_RESULTS: ValidationResult[] = [
  r('CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES', 'click_id_capture', 'skipped', 'medium',
    'The full query string survived to the final landing URL — nothing was lost to test capture timing against',
    'Click ID is read on the first response, not only after the final hop',
    ['Rule skipped — see LANDING_REDIRECT_PRESERVES_QUERY_STRING (L2.9)']),
  r('CLICK_ID_WRITTEN_TO_DURABLE_STORAGE', 'storage_durability', 'pass', 'critical',
    'No identifiers found written to sessionStorage only',
    'Identifier is written to a cookie, not only sessionStorage — sessionStorage is destroyed on tab close',
    ['gclid: in a cookie (durable)', 'fbclid: in a cookie (durable)', 'gbraid: in a cookie (durable)', 'wbraid: in a cookie (durable)', 'ttclid: not captured', 'li_fat_id: in a cookie (durable)', 'msclkid: in a cookie (durable)']),
  r('CONSENT_BANNER_PRESENT_WHEN_REQUIRED', 'consent', 'skipped', 'high',
    'No CMP declared and no EEA/UK/Switzerland traffic declared — a consent banner is not expected',
    'A consent banner is present when a CMP is declared or EEA/UK/Switzerland traffic is declared',
    ['Rule skipped — nothing requires a banner here']),
  r('CONTAINER_ID_MATCHES_DECLARED', 'foundation_tags', 'skipped', 'high',
    'No connected GTM container on file for this client',
    'A declared/connected GTM container ID to compare the live site against',
    ['Rule skipped — nothing declared to compare against']),
  r('CONVERSION_LINKER_ENABLED', 'foundation_tags', 'pass', 'critical',
    '_gcl_au cookie present — Conversion Linker is writing click data to first-party storage',
    'Conversion Linker tag (or gtag.js equivalent) sets the _gcl_au first-party cookie',
    ['_gcl_au present: true']),
  r('CONVERSION_SURFACE_IDENTIFIED', 'scope_configuration', 'pass', 'critical',
    'Reached 1 journey step distinct from landing: signup',
    'At least one page or state matching the declared conversion is reachable',
    ['Steps reached: signup']),
  r('CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS', 'hygiene_integrity', 'fail', 'medium',
    '2 JavaScript error(s) on the conversion surface ("onboarding")',
    'An intermittently failing confirmation page is an intermittently failing conversion',
    ['DOMException', 'DOMException']),
  r('CONVERSION_VALUE_PRESENT', 'parameter_completeness', 'skipped', 'critical',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A value parameter is attached to the conversion',
    ['Rule skipped — nothing to check']),
  r('COOKIE_ATTRIBUTES_CORRECT', 'storage_durability', 'pass', 'high',
    'All click-ID cookies have correct SameSite/Secure attributes',
    'SameSite=None requires Secure (or browsers reject the cookie outright); SameSite=Strict drops the cookie on return from a third-party payment host',
    ['gclid: SameSite=Lax, Secure=false', 'fbclid: SameSite=Lax, Secure=false', 'msclkid: SameSite=Lax, Secure=false', 'gbraid: SameSite=Lax, Secure=false', 'wbraid: SameSite=Lax, Secure=false', '_gcl_au: SameSite=Lax, Secure=false', '_gcl_aw: SameSite=Lax, Secure=false', 'li_fat_id: SameSite=Lax, Secure=false', 'ttclid: SameSite=Lax, Secure=false']),
  r('CURRENCY_PRESENT_AND_VALID', 'parameter_completeness', 'skipped', 'high',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A valid ISO 4217 currency code accompanies the value',
    ['Rule skipped — nothing to check']),
  r('DATALAYER_INITIALISED', 'foundation_tags', 'pass', 'critical',
    'dataLayer populated with 4 event(s) by the landing page',
    'dataLayer exists and receives at least one push before the landing page finishes loading',
    ['Total dataLayer events: 18', 'Events at landing/init: 4']),
  r('DECLARED_CMP_MATCHES_DETECTED_VENDOR', 'consent', 'skipped', 'low',
    'No consent banner was detected — nothing to compare against',
    'The declared CMP Scan Input matches the vendor actually detected on the site',
    ['Rule skipped — nothing to check']),
  // DECLARED_PLATFORM_HAS_TAG is computed live (see acceptanceReplay
  // .c9486929.test.ts's LIVE_RULE_IDS) — its found/evidence text is
  // dynamically generated per-run (severity-ceiling logic keys off
  // declaration_source too), so calling the real rule against AUDIT_DATA
  // is more faithful than hand-transcribing it, and avoids drifting from
  // the current output-vocabulary lint (PRD §5) as that text evolves.
  r('EMAIL_CAPTURED_FOR_CAPI', 'identity_match_quality', 'skipped', 'high',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A hashed email accompanies the server event — the largest single driver of Meta and TikTok match quality',
    ['Rule skipped — nothing to check']),
  r('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'identity_match_quality', 'skipped', 'high',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A hashed email accompanies the conversion — the primary recovery mechanism when cookies are unavailable',
    ['Rule skipped — nothing to check']),
  r('EVENT_FIRES_EXACTLY_ONCE', 'event_firing', 'skipped', 'high',
    'No primary conversion declared in Scan Inputs',
    'No duplicate transmission of the same conversion on one page view',
    ['Rule skipped — nothing to check']),
  r('EVENT_ID_CONSISTENT_CLIENT_TO_SERVER', 'deduplication', 'skipped', 'high',
    'No client-side event_id observed for the primary conversion — see EVENT_ID_PRESENT (L6.7)',
    'The client-side event_id also appears in the server-side (sGTM/CAPI) delivery channel',
    ['Rule skipped — nothing to cross-check']),
  r('EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS', 'deduplication', 'skipped', 'high',
    'No client-side event_id observed for the primary conversion — see EVENT_ID_PRESENT (L6.7)',
    "The client-side event_id is forwarded in at least one declared platform's own request",
    ['Rule skipped — nothing to cross-check']),
  r('EVENT_ID_PRESENT', 'parameter_completeness', 'skipped', 'high',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A deduplication ID (event_id) is generated per event',
    ['Rule skipped — nothing to check']),
  r('EVENT_NAMES_MATCH_DECLARED_TAXONOMY', 'event_firing', 'skipped', 'medium',
    "No site-authored dataLayer events observed (vendor-emitted events like gtm.*/web-vitals/OneTrust*/Optanon* are excluded — the site can't rename those)",
    'Observed event names match the naming convention on file',
    ['Rule skipped — nothing to check']),
  r('EVENT_ORDERING_IS_CORRECT', 'event_firing', 'skipped', 'high',
    'No primary conversion declared in Scan Inputs',
    'Config and consent fire before the conversion event',
    ['Rule skipped — nothing to compare']),
  r('EXTERNAL_ID_SET', 'identity_match_quality', 'skipped', 'medium',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A stable internal user identifier (external_id) is sent to Meta',
    ['Rule skipped — nothing to check']),
  r('FBCLID_CAPTURED_AT_LANDING', 'click_id_capture', 'pass', 'critical',
    'fbclid captured (cookie)',
    'fbclid present in the URL is read and stored — the entry point for Meta click attribution',
    ['In landing URL: true', 'Stored in localStorage["fbclid"]: false', 'Stored in a cookie["fbclid"]: true', 'Echoed into a dataLayer event: false']),
  // FBP_AND_FBC_COOKIES_PRESENT split into FBP_COOKIE_PRESENT/
  // FBC_COOKIE_PRESENT — both computed live (see module docstring above
  // and LIVE_RULE_IDS in the replay test): FBP_COOKIE_PRESENT's fail is
  // gated purely on AUDIT_DATA.cookies (real fact: no _fbp), and
  // FBC_COOKIE_PRESENT always returns 'skipped' regardless of input.
  r('FIRES_ON_COMPLETION_NOT_ON_INTENT', 'event_firing', 'skipped', 'critical',
    'No primary conversion declared in Scan Inputs',
    'The trigger is the confirmed outcome, not a button click or form submit attempt',
    ['Rule skipped — nothing to check']),
  // GA4_CONFIG_TAG_PRESENT is computed live — see module docstring.
  r('GA4_CONVERSION_EVENT_FIRES', 'event_firing', 'skipped', 'critical',
    'No primary conversion declared in Scan Inputs',
    'A GA4 event matching the declared conversion is observed',
    ['Rule skipped — nothing to check']),
  r('GBRAID_CAPTURED_AT_LANDING', 'click_id_capture', 'pass', 'critical',
    'gbraid captured (cookie)',
    'gbraid is read and stored — iOS app-to-web clicks arrive as gbraid; not capturing it silently drops iOS traffic',
    ['In landing URL: true', 'Stored in localStorage["gbraid"]: false', 'Stored in a cookie["gbraid"]: true', 'Echoed into a dataLayer event: false']),
  r('GCL_AW_COOKIE_PRESENT', 'storage_durability', 'pass', 'critical',
    '_gcl_aw cookie is present and populated',
    "Google's own linker cookie (_gcl_aw) exists after an ad click — the mechanism Google itself relies on for Enhanced Conversions",
    ['_gcl_aw present: true']),
  r('GCLID_CAPTURED_AT_LANDING', 'click_id_capture', 'pass', 'critical',
    'gclid captured (cookie)',
    'gclid present in the URL is read and stored by the page — the entry point for all Google click attribution',
    ['In landing URL: true', 'Stored in localStorage["gclid"]: false', 'Stored in a cookie["gclid"]: true', 'Echoed into a dataLayer event: false']),
  r('GOOGLE_ADS_CONVERSION_EVENT_FIRES', 'event_firing', 'fail', 'critical',
    'No request to googleadservices.com/pagead/conversion or google.com/pagead/conversion detected',
    'A conversion hit reaches googleadservices.com or google.com/pagead — without it Smart Bidding has no training data',
    ['No request to googleadservices.com/pagead/conversion or google.com/pagead/conversion detected']),
  // GOOGLE_GLOBAL_SITE_TAG_PRESENT split into GTAG_LOADER_PRESENT/
  // GOOGLE_ADS_AW_ID_PRESENT — both computed live, see module docstring.
  r('GTM_CONTAINER_LOADED', 'foundation_tags', 'pass', 'critical',
    'GTM container loaded: GTM-56CMP8K',
    'gtm.js loads and a container ID (GTM-XXXXXXX) resolves',
    ['Container IDs observed: GTM-56CMP8K']),
  r('HASH_FORMAT_VALID', 'identity_match_quality', 'skipped', 'medium',
    'No hash-shaped identity value observed to validate',
    'Hashed values are 64 hexadecimal characters',
    ['Rule skipped — nothing to check']),
  r('HASHED_WITH_SHA256', 'identity_match_quality', 'skipped', 'high',
    'No email/phone observed on the conversion event',
    'Match keys are hashed, not sent in the clear',
    ['Rule skipped — nothing to check']),
  r('IDENTITY_NORMALISED_BEFORE_HASHING', 'identity_match_quality', 'skipped', 'high',
    'No plaintext email/phone observed to check normalisation on (already hashed, or nothing captured)',
    'Lowercase, trimmed email and E.164 phone before hashing',
    ['Rule skipped — nothing to check']),
  r('LANDING_REDIRECT_PRESERVES_QUERY_STRING', 'click_id_capture', 'pass', 'critical',
    'All injected query parameters survived to the final landing URL',
    'Query parameters survive any redirect chain on entry',
    ['Stripped: none']),
  r('META_CONVERSION_EVENT_FIRES', 'event_firing', 'fail', 'critical',
    'No facebook.com/tr request carrying a tracked event (ev != PageView) detected',
    'A Meta conversion event (not just the base PageView pixel call) is observed',
    ['No facebook.com/tr request carrying a tracked event (ev != PageView) detected']),
  r('META_PIXEL_PRESENT', 'foundation_tags', 'fail', 'critical',
    'No requests to facebook.com/tr or connect.facebook.net detected',
    'fbevents.js loads and a pixel ID resolves',
    ['No requests to facebook.com/tr or connect.facebook.net detected']),
  r('MICRO_CONVERSIONS_FIRE', 'event_firing', 'skipped', 'medium',
    'No secondary/micro-conversions declared in Scan Inputs',
    'Declared secondary events are observed on their surfaces',
    ['Rule skipped — nothing to check']),
  r('NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE', 'hygiene_integrity', 'pass', 'medium',
    'No console errors referencing measurement code',
    'A failing tag reports as absent rather than as functioning',
    ['No tracking-related console errors found']),
  r('NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES', 'event_firing', 'skipped', 'high',
    'No primary conversion declared in Scan Inputs',
    'Conversion events are absent on pages that are not conversion surfaces',
    ['Rule skipped — nothing to check']),
  r('NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT', 'consent', 'skipped', 'critical',
    'No consent banner was detected — nothing gates tags here',
    "None of the declared platforms' tags fire before the visitor grants consent",
    ['Rule skipped — nothing to check']),
  r('NO_DUPLICATE_BASE_TAG', 'foundation_tags', 'pass', 'high',
    'No duplicate base tags detected among platforms with an extractable ID',
    'Each platform base tag loads under exactly one account/pixel ID',
    ['Microsoft: 1 ID (187107444)', 'Google Ads, TikTok, and LinkedIn base tags carry no stable per-installation ID in their network requests — not evaluable at the ID level from crawl data alone']),
  r('NO_DUPLICATE_CONTAINER', 'foundation_tags', 'pass', 'high',
    '1 GTM container loading: GTM-56CMP8K',
    'Exactly one GTM container loads across the sampled pages',
    ['Container IDs observed: GTM-56CMP8K']),
  r('NO_PII_IN_GA4_EVENT_PARAMETERS', 'identity_match_quality', 'skipped', 'critical',
    'No GA4 hits observed',
    'No personal data in custom dimensions or event params',
    ['Rule skipped — nothing to check']),
  r('NO_PII_IN_URLS_OR_QUERY_STRINGS', 'identity_match_quality', 'pass', 'critical',
    'No plaintext PII found in URLs or query strings',
    'Personal data in a page URL or referrer leaks to every downstream tag on the page',
    ['No plaintext PII detected']),
  r('NO_PLAINTEXT_PII_IN_NETWORK_REQUEST', 'identity_match_quality', 'pass', 'critical',
    'No plaintext PII found in request bodies',
    'No unhashed email, phone, or name in any outbound payload — legal exposure and grounds for account suspension',
    ['No plaintext PII detected']),
  r('NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION', 'hygiene_integrity', 'pass', 'high',
    'No GTM preview/debug environment detected — the published container is live',
    'A test container in production routes real data to nowhere',
    ['No gtm_preview/gtm_auth params found on the loaded container']),
  r('NO_TAG_LOAD_ERRORS', 'foundation_tags', 'pass', 'high',
    'No tag requests returned an HTTP 4xx/5xx response',
    'Every tracking request completes with an HTTP 2xx/3xx response',
    ['No 4xx/5xx tag responses detected']),
  r('PAGE_VIEW_FIRES_ON_EVERY_ROUTE', 'event_firing', 'fail', 'high',
    '3 of 3 route(s) had no page_view: landing, signup, onboarding',
    'Funnel and path analysis are meaningless without a page_view per route change',
    ['Sampled routes: landing, signup, onboarding', 'Missing page_view: landing, signup, onboarding']),
  r('PHONE_CAPTURED_WHERE_COLLECTED', 'identity_match_quality', 'skipped', 'medium',
    'No phone number was observed being collected anywhere in the journey',
    'A hashed phone is attached when the business collects one',
    ['Rule skipped — nothing suggests phone is collected on this site']),
  r('PRIMARY_CONVERSION_EVENT_FIRES', 'event_firing', 'skipped', 'critical',
    'No primary conversion declared in Scan Inputs',
    'The declared primary conversion event is observed on its surface',
    ['Rule skipped — nothing to check']),
  r('REFERRER_PRESERVED_THROUGH_ENTRY', 'click_id_capture', 'pass', 'low',
    'document.referrer = "https://www.google.com/"',
    'document.referrer survives the landing sequence as a fallback attribution signal when click IDs are absent',
    ['Referrer captured: true']),
  // SERVER_CONTAINER_ENDPOINT_CONFIGURED is computed live — see module
  // docstring; its INFERRED evidence_class is exactly what criterion 4
  // (PRD §14) exercises.
  r('SERVER_CONTAINER_FIRST_PARTY_DOMAIN', 'foundation_tags', 'skipped', 'medium',
    'No server container endpoint detected — see SERVER_CONTAINER_ENDPOINT_CONFIGURED (L1.14)',
    "sGTM endpoint is on the advertiser's own domain",
    ['Rule skipped — nothing to evaluate']),
  r('SERVER_SIDE_GTM_CONNECTION_VERIFIED', 'server_side_delivery', 'skipped', 'high',
    'No server-side GTM endpoint is connected for this client',
    'A connected sGTM endpoint (client_platforms) is verified reachable',
    ['Rule skipped — nothing to verify']),
  r('STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW', 'storage_durability', 'fail', 'critical',
    "1 cookie(s) shorter than their attribution window: ttclid (1d, needs 7d)",
    'Cookie max-age is at least as long as the platform window (90d Google, 7d Meta click)',
    ['gclid: 90d (needs 90d)', 'fbclid: 90d (needs 7d)', 'msclkid: 90d (needs 7d)', 'gbraid: 90d (needs 90d)', 'wbraid: 90d (needs 90d)', '_gcl_au: 90d (needs 90d)', '_gcl_aw: 90d (needs 90d)', 'li_fat_id: 30d (needs 7d)', 'ttclid: 1d (needs 7d)']),
  r('TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE', 'hygiene_integrity', 'pass', 'low',
    'All tracking requests loaded within 2000ms',
    'A tag that times out on slow connections is a tag that does not fire',
    []),
  r('TAGS_PRESENT_ACROSS_SAMPLED_PAGES', 'foundation_tags', 'pass', 'high',
    'Tracking requests present on all 3 sampled pages',
    'At least one tracking request fires on every sampled page, not just the homepage',
    ['Sampled steps: landing, signup, onboarding', 'Steps with no tracking: none']),
  r('TIKTOK_CONVERSION_EVENT_FIRES', 'event_firing', 'pass', 'critical',
    'Conversion hit observed (8 time(s))',
    'A TikTok pixel conversion event (a POST to the tracking endpoint, not just the loader script) is observed',
    ['https://analytics.tiktok.com/api/v2/pixel', 'https://analytics.tiktok.com/api/v2/pixel', 'https://analytics.tiktok.com/api/v2/pixel/act']),
  r('TIKTOK_PIXEL_PRESENT', 'foundation_tags', 'pass', 'critical',
    'Fired 17 time(s)',
    'TikTok pixel script loads and a pixel ID resolves',
    ['https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=D9QOQ5JC77U6RO6J21IG&lib=ttq', 'https://analytics.tiktok.com/api/v2/pixel']),
  r('TRANSACTION_ID_PRESENT', 'parameter_completeness', 'skipped', 'critical',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'A unique identifier for the conversion instance is attached',
    ['Rule skipped — nothing to check']),
  r('TTCLID_CAPTURED_AT_LANDING', 'click_id_capture', 'pass', 'critical',
    'ttclid captured inside localStorage "oa_ad_clids" as a delimited segment',
    'ttclid is read and stored — the entry point for TikTok attribution, observable without any TikTok API access',
    ['In landing URL: true', 'Stored in localStorage["ttclid"]: false', 'Stored in a cookie["ttclid"]: false', 'Echoed into a dataLayer event: false']),
  // UNDECLARED_PLATFORM_TAG_DETECTED is computed live — see module
  // docstring; CONF_03's Reddit divergence depends on this rule's real
  // evidence matching AUDIT_DATA.networkRequests exactly.
  r('UTM_PARAMETERS_CAPTURED', 'click_id_capture', 'fail', 'high',
    '0/5 UTM parameters captured',
    'utm_source, utm_medium, utm_campaign, utm_content, utm_term are all read',
    ['utm_source: in URL but not captured', 'utm_medium: in URL but not captured', 'utm_campaign: in URL but not captured', 'utm_content: in URL but not captured', 'utm_term: in URL but not captured']),
  r('VALUE_NON_ZERO_AND_PLAUSIBLE', 'parameter_completeness', 'skipped', 'critical',
    'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
    'Value is not 0, null, or a constant placeholder',
    ['Rule skipped — nothing to check']),
  r('VERIFIED_SGTM_TRAFFIC_OBSERVED', 'server_side_delivery', 'skipped', 'medium',
    'No verified server-side GTM connection to cross-check — see SERVER_SIDE_GTM_CONNECTION_VERIFIED (L9.1)',
    'sGTM-shaped traffic is observed during a crawl of a verified connection',
    ['Rule skipped — nothing to cross-check']),
  r('WBRAID_CAPTURED_AT_LANDING', 'click_id_capture', 'pass', 'critical',
    'wbraid captured (cookie)',
    'wbraid is read and stored — web-to-app and privacy-restricted Google clicks arrive as wbraid',
    ['In landing URL: true', 'Stored in localStorage["wbraid"]: false', 'Stored in a cookie["wbraid"]: true', 'Echoed into a dataLayer event: false']),
];

/**
 * Real `executive_summary.coverage.steps` for this audit (audit_reports.
 * report_json) — landing's own settle_outcome ('quiet_period_cap_reached')
 * is what makes `degraded: true` real, not reconstructed; onboarding's
 * `source: 'fallback_landing'` is what coverageSuppression.ts keys on.
 */
export const STEP_COVERAGE: StepCoverage[] = [
  {
    step: 'landing',
    requested_url: 'https://openart.ai/?gclid=test_gclid_1788958060751',
    final_url: 'https://openart.ai/?gclid=test_gclid_1788958060751',
    source: 'user_supplied',
    distinct_from_landing: false,
    navigation_success: true,
    settle_outcome: 'quiet_period_cap_reached',
    degraded: true,
  },
  {
    step: 'signup',
    requested_url: 'https://openart.ai/features/demon-filter',
    final_url: 'https://openart.ai/features/demon-filter',
    source: 'sitemap',
    distinct_from_landing: true,
    navigation_success: true,
    settle_outcome: 'settled',
    degraded: false,
  },
  {
    step: 'onboarding',
    requested_url: 'https://openart.ai/',
    final_url: 'https://openart.ai/',
    source: 'fallback_landing',
    distinct_from_landing: false,
    navigation_success: true,
    settle_outcome: 'settled',
    degraded: false,
  },
];

/**
 * A real-derived, reconstructed `AuditData` — see module docstring for
 * exactly what's verbatim-real vs. reconstructed and why.
 *
 * `dataLayer`: the real `site_setup.datalayer_inventory` for this audit
 * (audit_reports.report_json) recorded `config(G-QYRJB9TLG7) [gtag]` (1
 * occurrence, step "signup") and three distinct `set(developer_id.*)
 * [gtag]` calls (dYzg1YT/dZGVlNj/dYWYxNW) — dataCapture.ts's real
 * instrumentation shape for a gtag.js runtime push (arguments captured
 * positionally as numeric keys, per signalConsistency.ts's own
 * `gtagPush()` comment). Reproduced here as the raw pushes that inventory
 * was itself built from — no config(AW-*) call was ever recorded, which
 * is exactly why GOOGLE_ADS_AW_ID_PRESENT stays a clean fail (no CONF_04)
 * while GTAG_LOADER_PRESENT's fail contradicts the (also real)
 * `set(developer_id.*)` evidence that a gtag runtime was in fact active
 * (CONF_02).
 *
 * `networkRequests`: no request matches any of google_ads/meta/ga4/
 * openai/pinterest's `PLATFORM_MATCHER_HOSTS` — real fact, all five
 * showed `detected: false` in the real `site_setup.tags`. One request
 * matches TikTok/LinkedIn/Microsoft each (site_setup.tags real detected:
 * true for all three) — kept consistent both sides so CONF_03 doesn't
 * fire a spurious conflict for platforms that never actually diverged.
 * One request matches Reddit (`alb.reddit.com`, register's own matcher,
 * PLATFORM_MATCHER_HOSTS.reddit) — real fact, UNDECLARED_PLATFORM_TAG_
 * DETECTED's own evidence named Reddit.
 *
 * `cookies`: `_gcl_aw` present (real — GCL_AW_COOKIE_PRESENT passed);
 * `_fbc`/`_fbp` absent (real — FBP_AND_FBC_COOKIES_PRESENT's evidence).
 */
export const AUDIT_DATA: AuditData = {
  audit_id: AUDIT_ID,
  website_url: 'https://openart.ai/',
  funnel_type: 'saas',
  region: 'us',
  rule_set_version: 'v2',
  site_type: 'app_install',
  declared_platforms: ['google_ads', 'tiktok', 'meta', 'pinterest'],
  declaration_source: 'OPERATOR_ASSUMED',
  primary_channel: 'google_ads',
  traffic_regions: ['us'],
  product_domain: 'https://openart.ai/',
  urlParams: {
    gclid: 'test_gclid_1788958060751',
    fbclid: 'test_fbclid_1788958060751',
    gbraid: 'test_gbraid_1788958060751',
    wbraid: 'test_wbraid_1788958060751',
    ttclid: 'test_ttclid_1788958060751',
    li_fat_id: 'test_lifatid_1788958060751',
    msclkid: 'test_msclkid_1788958060751',
    utm_source: 'atlas_audit',
    utm_medium: 'cpc',
    utm_campaign: 'atlas_audit_1788958060751',
  },
  dataLayer: [
    gtagCall('set', 'developer_id.dYzg1YT', 'landing', 1),
    gtagCall('set', 'developer_id.dZGVlNj', 'signup', 2),
    gtagCall('set', 'developer_id.dYWYxNW', 'signup', 3),
    gtagCall('config', 'G-QYRJB9TLG7', 'signup', 4),
  ],
  networkRequests: [
    { url: 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=D9QOQ5JC77U6RO6J21IG&lib=ttq', method: 'GET', headers: {}, timestamp: 1, step: 'landing' },
    { url: 'https://snap.licdn.com/li.lms-analytics/insight.min.js', method: 'GET', headers: {}, timestamp: 1, step: 'landing' },
    { url: 'https://bat.bing.com/p/action/187107444.js', method: 'GET', headers: {}, timestamp: 1, step: 'landing' },
    { url: 'https://alb.reddit.com/rp.gif?pid=t2_atlas_test', method: 'GET', headers: {}, timestamp: 1, step: 'landing' },
  ],
  cookies: { _gcl_aw: 'CjwK_test', _gcl_au: '1.1.test' },
  step_coverage: STEP_COVERAGE,
};

/**
 * The real `site_setup` for this audit (audit_reports.report_json,
 * verbatim `tags`/`gtm_container`/`possible_server_side_gtm`), hand-built
 * here rather than produced by calling the real `buildSiteSetupSummary()`
 * against `AUDIT_DATA` — deliberately, and only for this one field.
 *
 * `buildSiteSetupSummary()` now calls `trackingSignals.detectReddit()`
 * (added in this plan's own Sprint 4, after c9486929 ran), and that
 * detector's matcher (`alb.reddit.com`) is byte-identical to
 * `platformDetection.ts`'s own `PLATFORM_MATCHER_HOSTS.reddit` — so
 * calling it live against `AUDIT_DATA.networkRequests` would make both
 * CONF_03 sides agree (both true) and the conflict this criterion tests
 * would silently vanish. That convergence is real and correct: Sprint 4
 * genuinely closed the specific gap that let Reddit's tag-inventory and
 * register detectors drift apart in the first place. But c9486929's own
 * real `site_setup.tags` (fetched from `audit_reports`) never had a
 * `reddit_pixel` entry at all — `buildSiteSetupSummary()` didn't call any
 * Reddit detector yet on 9 September — which is the actual historical
 * shape PRD §1's third contradiction describes and PRD §14 point 3 asks
 * this replay to reproduce. `reddit_pixel: detected: false` below is that
 * real absence, translated into the current `DetectedTagSignal[]` shape
 * (which now structurally requires an entry to exist) so CONF_03 has
 * something to compare `platformTagDetected('reddit', AUDIT_DATA)`
 * against — exactly the "structurally absent" case
 * `signalConsistency.ts`'s `checkConf03()` itself documents as
 * unactionable until an entry exists. `pinterest_pixel` is the same
 * situation (also added in Sprint 4, also absent from the real inventory);
 * kept `detected: false` here too since nothing in this audit's real
 * evidence ever named Pinterest as present, so no conflict is expected or
 * asserted for it.
 */
export const SITE_SETUP: SiteSetupSummary = {
  generated_at: '2026-09-09T12:48:08.359Z',
  datalayer_inventory: [
    { event_name: 'set(developer_id.dYzg1YT) [gtag]', steps_seen: ['landing'], parameter_keys: ['0', '1'], occurrence_count: 1 },
    { event_name: 'set(developer_id.dZGVlNj) [gtag]', steps_seen: ['signup'], parameter_keys: ['0', '1'], occurrence_count: 1 },
    { event_name: 'set(developer_id.dYWYxNW) [gtag]', steps_seen: ['signup'], parameter_keys: ['0', '1'], occurrence_count: 1 },
    { event_name: 'config(G-QYRJB9TLG7) [gtag]', steps_seen: ['signup'], parameter_keys: ['0', '1'], occurrence_count: 1 },
  ],
  tags: [
    { platform: 'ga4', detected: false, ids: [], hit_count: 0, evidence_urls: [] },
    { platform: 'meta_pixel', detected: false, ids: [], hit_count: 0, evidence_urls: [] },
    { platform: 'google_ads', detected: false, ids: [], hit_count: 0, evidence_urls: [] },
    { platform: 'linkedin_insight', detected: true, ids: [], hit_count: 7, evidence_urls: ['https://snap.licdn.com/li.lms-analytics/insight.min.js'] },
    { platform: 'tiktok_pixel', detected: true, ids: [], hit_count: 17, evidence_urls: ['https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=D9QOQ5JC77U6RO6J21IG&lib=ttq'] },
    { platform: 'microsoft_uet', detected: true, ids: ['187107444'], hit_count: 16, evidence_urls: ['https://bat.bing.com/p/action/187107444.js'] },
    { platform: 'openai_pixel', detected: false, ids: [], hit_count: 0, evidence_urls: [] },
    // Structurally absent from the real historical inventory — see this
    // export's own docstring.
    { platform: 'reddit_pixel', detected: false, ids: [], hit_count: 0, evidence_urls: [] },
    { platform: 'pinterest_pixel', detected: false, ids: [], hit_count: 0, evidence_urls: [] },
  ],
  gtm_container: { detected: true, container_ids: ['GTM-56CMP8K'], connected_container_id: null, ids_match: null },
  possible_server_side_gtm: { detected: false, confidence: 'low', candidate_hosts: [], matched_heuristics: [], evidence_urls: [], caveat: '' },
};
