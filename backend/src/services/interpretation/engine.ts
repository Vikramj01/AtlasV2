/**
 * Interpretation Engine (Sprint 4)
 * Maps technical validation failures to marketer-friendly business impact.
 * Ported from rule-interpretations.ts (root).
 */
import type { ValidationResult, ReportIssue, Severity } from '@/types/audit';
import { REGISTER } from '@/services/validation/register/engine';

// A handful of rule_ids exist in both the v1 RULE_INTERPRETATIONS dict below
// and the v2 Check Register (GCLID_CAPTURED_AT_LANDING, GTM_CONTAINER_LOADED,
// ...) — same name, different implementation, different evidence. A plain
// rule_id lookup can't tell which engine actually produced a given result,
// so it silently overlays v1's static, generic business_impact text onto a
// v2 result's real run-specific evidence — evidence that then disagrees
// with the same rule_id's entry in the journey_stages/layer breakdown
// (which always reads the live result, never this dict).
//
// validation_layer alone can't disambiguate — v1 and v2 both use the
// literal layer name 'parameter_completeness', so a rule_id+layer pair is
// the only combination that's actually unique to one engine. A result only
// counts as v2-originated when its rule_id AND its validation_layer match a
// real register entry; a v1 result that happens to reuse a colliding
// rule_id carries its own (different) v1 layer, so it never matches here.
const REGISTER_RULE_BY_RULE_ID = new Map(REGISTER.map((rule) => [rule.rule_id, rule]));

function isV2Result(result: ValidationResult): boolean {
  return REGISTER_RULE_BY_RULE_ID.get(result.rule_id)?.layer === result.validation_layer;
}

/**
 * The "How to fix it" text for a v2-originated result — its own rule's
 * authored remediation (PRD "Signal Health Report" Issue 1; every v2 rule
 * has one, see register.integrity.test.ts's coverage assertion), evaluated
 * against this specific result so a rule whose remediation interpolates an
 * evidence value (a platform name, a cookie name) gets the real one. Only
 * falls through to the placeholder if a result's rule_id somehow isn't in
 * the register at all — shouldn't happen for a genuine v2 result, but
 * guards against a future rule shipping without one slipping past review.
 */
function v2Remediation(result: ValidationResult): string {
  const rule = REGISTER_RULE_BY_RULE_ID.get(result.rule_id);
  if (!rule) return 'Contact support for details on this rule.';
  return typeof rule.remediation === 'function' ? rule.remediation(result) : rule.remediation;
}

interface RuleInterpretation {
  rule_id: string;
  /** Purpose-written, one-sentence hook for the marketer-facing issue card — picks the most business-relevant clause from business_impact rather than mechanically using its first sentence. */
  headline: string;
  business_impact: string;
  affected_platforms: string[];
  severity: Severity;
  recommended_owner: string;
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
}

const RULE_INTERPRETATIONS: Record<string, RuleInterpretation> = {
  GA4_PURCHASE_EVENT_FIRED: {
    rule_id: 'GA4_PURCHASE_EVENT_FIRED',
    headline: "Google Analytics can't see your purchases — your entire dashboard is blind to conversions.",
    business_impact: 'Google Analytics is not tracking your conversions. Your entire analytics dashboard is blind to purchases. This breaks all conversion reporting, funnel analysis, and revenue attribution.',
    affected_platforms: ['GA4'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Add gtag("event", "purchase", {...}) to your confirmation page, triggered immediately when the order is completed.',
    estimated_effort: 'low',
  },
  META_PIXEL_PURCHASE_EVENT_FIRED: {
    rule_id: 'META_PIXEL_PURCHASE_EVENT_FIRED',
    headline: "Meta Ads can't track purchases from your campaigns — you're flying blind on ROI.",
    business_impact: "Meta Ads cannot track purchases from your campaigns. You're flying completely blind on campaign performance. Meta cannot optimize or report ROI.",
    affected_platforms: ['Meta Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Add fbq("track", "Purchase", {...}) to your confirmation page with transaction details.',
    estimated_effort: 'low',
  },
  GOOGLE_ADS_CONVERSION_EVENT_FIRED: {
    rule_id: 'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
    headline: "Google Ads can't count conversions from your ad clicks, so Smart Bidding can't optimize and your ROAS data is broken.",
    business_impact: 'Google Ads cannot count conversions from your ad clicks. Smart bidding cannot optimize. Your ROAS data is completely broken.',
    affected_platforms: ['Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Configure Google Ads conversion tracking in GTM or implement gtag conversion event on confirmation page.',
    estimated_effort: 'medium',
  },
  SGTM_SERVER_EVENT_FIRED: {
    rule_id: 'SGTM_SERVER_EVENT_FIRED',
    headline: "Server-side tracking isn't active — conversions are likely being counted twice.",
    business_impact: "Server-side tracking is not active. You're missing automated deduplication and conversions are likely being counted twice.",
    affected_platforms: ['sGTM', 'GA4 Measurement Protocol'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Configure your dataLayer to POST conversion events to your sGTM endpoint.',
    estimated_effort: 'medium',
  },
  DATALAYER_POPULATED: {
    rule_id: 'DATALAYER_POPULATED',
    headline: "Your GTM has no data to work with — this is the foundation, and nothing else can track without it.",
    business_impact: 'Your GTM has no data to work with. All conversion tracking will fail. This is the foundation — without it, nothing else works.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Implement dataLayer initialization and push events at key points: page_view plus your funnel\'s key actions (e.g. add_to_cart/purchase for ecommerce, sign_up for SaaS, generate_lead for lead gen).',
    estimated_effort: 'medium',
  },
  GTM_CONTAINER_LOADED: {
    rule_id: 'GTM_CONTAINER_LOADED',
    headline: "Google Tag Manager isn't loading — nothing tracks at all without it.",
    business_impact: 'Google Tag Manager is not loading. GTM is the backbone of all your tracking — without it, nothing tracks at all.',
    affected_platforms: ['GTM', 'GA4', 'Meta', 'Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure GTM script is in the <head> before other scripts. Check for CSP violations or ad blocker conflicts.',
    estimated_effort: 'low',
  },
  PAGE_VIEW_EVENT_FIRED: {
    rule_id: 'PAGE_VIEW_EVENT_FIRED',
    headline: "GA4 isn't tracking page views, so your funnel analysis is broken.",
    business_impact: 'GA4 is not tracking page views. Your funnel analysis is broken.',
    affected_platforms: ['GA4', 'GTM'],
    severity: 'high',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Configure GTM to send page_view event on each page load. For SPAs, trigger on route changes.',
    estimated_effort: 'low',
  },
  ADD_TO_CART_EVENT_FIRED: {
    rule_id: 'ADD_TO_CART_EVENT_FIRED',
    headline: "Meta and Google can't build lookalike audiences from cart abandoners without this signal.",
    business_impact: "You cannot optimize for add-to-cart behavior. Meta and Google cannot build lookalike audiences from cart abandoners.",
    affected_platforms: ['GA4', 'Meta', 'Google Ads'],
    severity: 'medium',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Push add_to_cart event to dataLayer when user adds a product, including product details.',
    estimated_effort: 'low',
  },
  TRANSACTION_ID_PRESENT: {
    rule_id: 'TRANSACTION_ID_PRESENT',
    headline: 'Without a transaction ID, conversions can\'t be deduplicated — expect conversion counts inflated 2–3x.',
    business_impact: "Conversions cannot be deduplicated. You'll see inflated conversion counts (likely 2–3x too high) and artificial double-billing across platforms.",
    affected_platforms: ['GA4', 'Google Ads', 'Meta', 'sGTM'],
    severity: 'critical',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Attach a unique transaction_id from your order system to the purchase event.',
    estimated_effort: 'low',
  },
  VALUE_PARAMETER_PRESENT: {
    rule_id: 'VALUE_PARAMETER_PRESENT',
    headline: "No conversion value is being sent, so ROAS can't be tracked and Smart Bidding has nothing to optimize for.",
    business_impact: 'Cannot track ROAS or value-based bidding impact. Smart bidding has no value to optimize for.',
    affected_platforms: ['GA4', 'Google Ads', 'Meta', 'sGTM'],
    severity: 'critical',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Include a value on your conversion event (order total for ecommerce, an estimated lead/plan value for SaaS or lead gen): {value: ...}',
    estimated_effort: 'low',
  },
  CURRENCY_PARAMETER_PRESENT: {
    rule_id: 'CURRENCY_PARAMETER_PRESENT',
    headline: 'Multi-currency revenue reports will be wrong.',
    business_impact: 'Multi-currency revenue reports will be wrong.',
    affected_platforms: ['GA4', 'Google Ads'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Add currency code to purchase event: {currency: "USD"}',
    estimated_effort: 'low',
  },
  GCLID_CAPTURED_AT_LANDING: {
    rule_id: 'GCLID_CAPTURED_AT_LANDING',
    headline: "Google Ads can't attribute conversions to ad clicks — attribution is broken.",
    business_impact: 'Google Ads cannot attribute conversions to ad clicks. Attribution is completely broken.',
    affected_platforms: ['Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure Google Ads auto-tagging is enabled and gclid is captured on landing.',
    estimated_effort: 'low',
  },
  FBCLID_CAPTURED_AT_LANDING: {
    rule_id: 'FBCLID_CAPTURED_AT_LANDING',
    headline: "Meta can't attribute conversions to ad clicks. Campaign performance data is wrong.",
    business_impact: 'Meta cannot attribute conversions to ad clicks. Campaign performance data is wrong.',
    affected_platforms: ['Meta Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure Meta Pixel is properly installed on your landing page.',
    estimated_effort: 'low',
  },
  EVENT_ID_GENERATED: {
    rule_id: 'EVENT_ID_GENERATED',
    headline: "Client and server events can't be deduplicated — conversion counts will be doubled.",
    business_impact: 'Client and server events cannot be deduplicated. Conversion counts will be doubled.',
    affected_platforms: ['GA4', 'Meta', 'sGTM'],
    severity: 'high',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Generate a unique event_id (UUID or timestamp) for each event.',
    estimated_effort: 'low',
  },
  EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS: {
    rule_id: 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
    headline: "Enhanced Conversions can't match users here — expect match rate to drop below 30%.",
    business_impact: 'Enhanced Conversions cannot match users. Your match rate drops below 30%.',
    affected_platforms: ['Google Ads', 'Meta CAPI'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Capture customer email on your conversion event: {user_data: {email: customer.email}}',
    estimated_effort: 'low',
  },
  PHONE_CAPTURED_FOR_CAPI: {
    rule_id: 'PHONE_CAPTURED_FOR_CAPI',
    headline: 'Meta Conversions API match rate drops 20–30%.',
    business_impact: 'Meta Conversions API match rate drops 20–30%.',
    affected_platforms: ['Meta CAPI'],
    severity: 'medium',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Capture phone on your conversion event, normalized to digits only.',
    estimated_effort: 'low',
  },
  ITEMS_ARRAY_POPULATED: {
    rule_id: 'ITEMS_ARRAY_POPULATED',
    headline: "You can't do product-level analysis — ROI by SKU is blind.",
    business_impact: 'Cannot do product-level analysis. ROI by SKU is blind.',
    affected_platforms: ['GA4', 'Meta'],
    severity: 'medium',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Include all products in purchase: {items: [{id, price, quantity}]}',
    estimated_effort: 'low',
  },
  USER_ID_PRESENT: {
    rule_id: 'USER_ID_PRESENT',
    headline: "You can't track repeat/returning users — repeat conversion rate and LTV are wrong.",
    business_impact: 'Cannot track repeat or returning users across sessions. Repeat conversion rate and LTV are wrong.',
    affected_platforms: ['GA4', 'sGTM'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Set GA4 user_id when user logs in or has an account.',
    estimated_effort: 'medium',
  },
  COUPON_CAPTURED_IF_USED: {
    rule_id: 'COUPON_CAPTURED_IF_USED',
    headline: 'Cannot measure coupon effectiveness or optimize discount strategy.',
    business_impact: 'Cannot measure coupon effectiveness or optimize discount strategy.',
    affected_platforms: ['GA4', 'Meta'],
    severity: 'low',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Include coupon code when used: {coupon: "SUMMER20"}',
    estimated_effort: 'low',
  },
  SHIPPING_CAPTURED: {
    rule_id: 'SHIPPING_CAPTURED',
    headline: 'Cannot analyze margin impact of shipping costs.',
    business_impact: 'Cannot analyze margin impact of shipping costs.',
    affected_platforms: ['GA4', 'Meta'],
    severity: 'low',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Track shipping separately: {shipping: order.shipping_cost}',
    estimated_effort: 'low',
  },
  GCLID_PERSISTS_TO_CONVERSION: {
    rule_id: 'GCLID_PERSISTS_TO_CONVERSION',
    headline: 'Google Ads loses attribution for this conversion — each lost click ID is one more unattributed conversion.',
    business_impact: 'Google Ads loses attribution data for this conversion. Each lost gclid = one more unattributed conversion.',
    affected_platforms: ['Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Store gclid in sessionStorage on landing, retrieve and attach to your conversion event.',
    estimated_effort: 'medium',
  },
  FBCLID_PERSISTS_TO_CONVERSION: {
    rule_id: 'FBCLID_PERSISTS_TO_CONVERSION',
    headline: 'Meta loses user matching here — conversion tracking can drop to a 0% match rate.',
    business_impact: 'Meta loses user matching. Conversion tracking fails or has 0% match rate.',
    affected_platforms: ['Meta Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure Meta Pixel fires on all pages. Check browser cookie policy allows fbp/fbc cookies.',
    estimated_effort: 'medium',
  },
  TRANSACTION_ID_MATCHES_ORDER_SYSTEM: {
    rule_id: 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
    headline: "Conversion data can't be reconciled with actual revenue — your reports and real business metrics don't match.",
    business_impact: "Cannot reconcile conversion data with actual revenue. Your reports and real business metrics don't match.",
    affected_platforms: ['All'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Use the exact order ID from your order management system.',
    estimated_effort: 'low',
  },
  EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER: {
    rule_id: 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
    headline: 'Deduplication fails between client and server — your ROAS is inflated by 2–3x.',
    business_impact: 'Deduplication fails. Conversion counts double. Your ROAS is inflated by 2–3x.',
    affected_platforms: ['sGTM', 'GA4', 'Meta CAPI'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Pass the same event_id from client event to server request. Both must match exactly.',
    estimated_effort: 'medium',
  },
  USER_DATA_NORMALIZED_CONSISTENTLY: {
    rule_id: 'USER_DATA_NORMALIZED_CONSISTENTLY',
    headline: 'Match rates drop 30–50% — Enhanced Conversions fail to match the same user across events.',
    business_impact: 'Match rates drop 30–50%. Enhanced Conversions fail to match the same user across events.',
    affected_platforms: ['Meta CAPI', 'Google Ads Enhanced Conversions'],
    severity: 'medium',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Normalize email (lowercase + trim), phone (digits only) consistently before hashing.',
    estimated_effort: 'low',
  },
  PII_PROPERLY_HASHED: {
    rule_id: 'PII_PROPERLY_HASHED',
    headline: 'Plaintext PII is being sent — this may violate GDPR and CCPA.',
    business_impact: 'Privacy and compliance risk. Sending plaintext PII may violate GDPR and CCPA.',
    affected_platforms: ['Meta CAPI', 'Google Ads Enhanced Conversions'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Hash PII with SHA256: crypto.createHash("sha256").update(email).digest("hex")',
    estimated_effort: 'low',
  },

  // ============================================================================
  // LAYER 4: TAG CONFIGURATION (Phase A — 7 rules)
  // ============================================================================

  CUSTOM_HTML_TAG_DETECTED: {
    rule_id: 'CUSTOM_HTML_TAG_DETECTED',
    headline: "This custom HTML tag bypasses GTM's safety checks and is a future maintenance liability.",
    business_impact: 'Custom HTML tags bypass GTM template safety, cannot be governed centrally, and frequently contain copy-pasted legacy code. Each one is a future maintenance and audit liability — they break silently, resist version control, and make consent enforcement harder.',
    affected_platforms: ['All'],
    severity: 'medium',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Replace with a built-in tag template wherever possible. If no template exists, document the reason in the tag note.',
    estimated_effort: 'medium',
  },

  CUSTOM_HTML_TAG_BYPASSES_CONSENT: {
    rule_id: 'CUSTOM_HTML_TAG_BYPASSES_CONSENT',
    headline: 'A custom HTML tag is firing without consent gating — a direct GDPR/ePrivacy compliance violation.',
    business_impact: 'A custom HTML tag is sending tracking events without consent gating. This is a compliance violation under GDPR, ePrivacy, UAE PDPL, and similar regulations. Your ad accounts and customer trust are at direct risk. Regulators treat ungated marketing pixels as evidence of willful non-compliance.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Add consentSettings to the tag requiring ad_storage and ad_user_data for marketing pixels, analytics_storage for analytics tags.',
    estimated_effort: 'low',
  },

  CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA: {
    rule_id: 'CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA',
    headline: 'A custom HTML tag has hardcoded conversion values — every conversion gets the same number, distorting Smart Bidding and ROAS.',
    business_impact: 'A custom HTML tag contains hardcoded conversion IDs, pixel IDs, or value/currency literals. These never adapt to runtime context — every conversion gets the same hardcoded value, distorting Smart Bidding and ROAS reporting. Hardcoded IDs also create maintenance debt when account structures change.',
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],
    severity: 'high',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Move conversion IDs and pixel IDs to GTM variables. Move value, currency, and transaction_id to dataLayer-sourced variables.',
    estimated_effort: 'medium',
  },

  HARDCODED_VALUE_IN_TAG_CONFIG: {
    rule_id: 'HARDCODED_VALUE_IN_TAG_CONFIG',
    headline: "A conversion tag's value is hardcoded — Smart Bidding is training on a flat number instead of real revenue.",
    business_impact: 'A conversion tag has the value parameter set as a literal number rather than a dataLayer variable. Smart Bidding and tROAS will train on this flat value, distorting bids and ROAS reporting across every campaign. Most common cause: a test value left in production after development.',
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4', 'sGTM'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Replace the literal value with {{ecommerce.value}} or the equivalent dataLayer variable reference.',
    estimated_effort: 'low',
  },

  HARDCODED_CURRENCY_IN_TAG_CONFIG: {
    rule_id: 'HARDCODED_CURRENCY_IN_TAG_CONFIG',
    headline: "A conversion tag's currency is hardcoded — if it ever stops matching the real transaction currency, conversions will be misvalued.",
    business_impact: "A conversion tag has currency set as a literal string. If this doesn't match the site's actual transaction currency, ad platforms will misvalue conversions (e.g. 100 SGD treated as 100 AED). Even if currently correct, this is fragile to future expansion or currency changes.",
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],
    severity: 'high',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Use a dataLayer variable for currency. If the site is genuinely single-currency, document that decision in the tag note.',
    estimated_effort: 'low',
  },

  HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG: {
    rule_id: 'HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG',
    headline: 'Transaction ID is hardcoded — deduplication collapses and conversions silently drop to about one per day.',
    business_impact: 'Transaction ID is hardcoded. This collapses deduplication completely — every purchase carries the same ID, causing all but one to be discarded by GA4 and ad platforms with dedup logic. Conversions silently drop to approximately one per day regardless of real purchase volume.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Replace with {{ecommerce.transaction_id}} dataLayer variable.',
    estimated_effort: 'low',
  },

  DUPLICATE_TAG_CONFIGURATION: {
    rule_id: 'DUPLICATE_TAG_CONFIGURATION',
    headline: "Multiple tags are firing the same conversion — you're double-counting and ROAS appears inflated.",
    business_impact: 'Multiple tags are firing the same conversion event for the same destination. Conversions are being counted multiple times. ROAS appears inflated, and algorithms are training on phantom volume. This is one of the most common causes of over-reporting in Google Ads and Meta Ads.',
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Identify the canonical tag and pause or delete duplicates. If sGTM and client-side both legitimately fire for the same event, set event_id on both for deduplication.',
    estimated_effort: 'medium',
  },

  // LAYER 4: TAG CONFIGURATION (Phase B — 4 rules)
  // ============================================================================

  CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG: {
    rule_id: 'CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG',
    headline: 'A marketing tag has no consent requirements configured — it fires regardless of what the user consented to.',
    business_impact: 'One or more marketing tags have no consent requirements configured in GTM. These tags will fire regardless of what the user consented to, breaching GDPR, ePrivacy, and equivalent regulations. Ad platforms can suspend accounts for consent violations detected during audits.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Open each tag in GTM, navigate to Consent Settings, select "Require additional consent for tag to fire", and add the appropriate consent types (ad_storage + ad_user_data for ad platforms, analytics_storage for GA4).',
    estimated_effort: 'low',
  },

  CONSENT_TYPE_MISMATCH: {
    rule_id: 'CONSENT_TYPE_MISMATCH',
    headline: "A marketing tag's consent settings are incomplete — it can still fire after a user opts out.",
    business_impact: 'A marketing tag has consent settings configured, but the listed consent types are incomplete. Missing consent type requirements means the tag can fire even when the user has denied the relevant consent signal — for example, a Google Ads tag without ad_user_data will send unhashed user data after the user opted out of personalised ads.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'For Google Ads and Meta tags add both ad_storage and ad_user_data. For GA4 tags add analytics_storage. For LinkedIn/TikTok/Microsoft tags add ad_storage.',
    estimated_effort: 'low',
  },

  DEFAULT_CONSENT_GRANTED_GLOBALLY: {
    rule_id: 'DEFAULT_CONSENT_GRANTED_GLOBALLY',
    headline: 'Consent defaults to "granted" before the user interacts with the banner — a textbook GDPR opt-in violation.',
    business_impact: 'Either no Consent Mode initialisation tag was found, or the consent tag defaults a sensitive consent type (ad_storage, ad_user_data, analytics_storage) to "granted" before the user has interacted with the consent banner. This is a textbook GDPR opt-in violation. Regulators across the EU and UK have issued substantial fines for exactly this configuration.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Add or update the Consent Initialization tag to set all sensitive consent types to "denied" by default. The CMP/consent banner should then update the consent state to "granted" only when the user explicitly accepts.',
    estimated_effort: 'medium',
  },

  FRAGILE_CSS_SELECTOR_TRIGGER: {
    rule_id: 'FRAGILE_CSS_SELECTOR_TRIGGER',
    headline: 'This conversion tag fires on a CSS selector — any front-end redesign can silently break it with no alert.',
    business_impact: 'One or more conversion tags fire based on CSS selector or element visibility triggers. These triggers bind conversion tracking to the visual implementation of the page — any front-end refactor, A/B test, or framework upgrade can silently break conversion tracking with no error or alert. CSS selectors are the leading cause of tracking loss during site redesigns.',
    affected_platforms: ['All'],
    severity: 'medium',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Migrate conversion tags to fire on dataLayer events pushed by the application code (e.g. push({ event: "purchase", ... })). This decouples tracking from UI implementation and is resilient to front-end changes.',
    estimated_effort: 'high',
  },

  // LAYER 5: IMPLEMENTATION DRIFT (Sprint C — 3 rules)
  // ============================================================================

  SELECTOR_NOT_FOUND_ON_LIVE_SITE: {
    rule_id: 'SELECTOR_NOT_FOUND_ON_LIVE_SITE',
    headline: "This tag's CSS selector no longer matches anything on the live site — the trigger is dead and conversions have stopped firing.",
    business_impact: 'A CSS selector trigger that controls a conversion tag is no longer matching elements on the live site. The trigger is dead — conversions dependent on it have stopped firing. This is the most common failure mode after a front-end redesign, framework upgrade, or A/B test that renames classes. Loss is usually silent and discovered only through revenue decline.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Inspect the page for the expected element — it likely changed class name or was removed. Either update the CSS selector in GTM, or migrate the conversion tag to fire from a dataLayer event pushed by the application instead of a DOM click.',
    estimated_effort: 'medium',
  },

  TAG_FIRING_REGRESSION_VS_BASELINE: {
    rule_id: 'TAG_FIRING_REGRESSION_VS_BASELINE',
    headline: 'A signal that used to fire is now missing — Smart Bidding is training on incomplete data as a result.',
    business_impact: 'A signal that fired successfully in the baseline crawl is now missing or degraded. This indicates a tracking regression — the tag may have been paused, its trigger broke, or a page change prevented it from firing. Missed conversions mean Smart Bidding trains on incomplete data, platform algorithms underallocate budget, and attribution shows a false drop.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Compare the current GTM container and page implementation against the baseline. Check whether the tag is paused, the trigger was removed, or the page structure changed. Restore the firing condition and validate with a new crawl.',
    estimated_effort: 'medium',
  },

  TAG_PAYLOAD_REGRESSION_VS_BASELINE: {
    rule_id: 'TAG_PAYLOAD_REGRESSION_VS_BASELINE',
    headline: 'This signal is still firing, but key fields (value, currency, IDs) have gone missing from the payload — bidding is now working off bad data.',
    business_impact: "A signal is still firing but key payload fields — conversion value, currency, transaction ID, event ID, or user data — have changed from populated to missing. The tag is technically live but the data reaching the platform is degraded. Value-based bidding will receive incorrect signals, deduplication may break, and Enhanced Conversions will lose the user data needed to improve match rates.",
    affected_platforms: ['All'],
    severity: 'high',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Identify which dataLayer variables stopped being populated and trace back to the source code change. Check ecommerce push implementations, CRM field mappings, and user_data collection. Restore the fields and validate with a new crawl vs baseline.',
    estimated_effort: 'medium',
  },
};

/**
 * Plain-language one-liner for a rule_id, for surfaces (e.g. journey stage
 * issue lists) that need marketer-facing text without pulling in the full
 * interpretation dict. Falls back to a title-cased version of the rule_id
 * for anything not in RULE_INTERPRETATIONS.
 */
export function getIssueHeadline(ruleId: string): string {
  return RULE_INTERPRETATIONS[ruleId]?.headline ?? ruleId.replace(/_/g, ' ');
}

/**
 * Full business-impact sentence(s) for a rule_id, for surfaces (e.g. the
 * Platform Impact "so what" line) that need the fuller explanation rather
 * than just the headline. Falls back to the headline for anything not in
 * RULE_INTERPRETATIONS.
 */
export function getIssueImpact(ruleId: string): string {
  return RULE_INTERPRETATIONS[ruleId]?.business_impact ?? getIssueHeadline(ruleId);
}

export function interpretResults(results: ValidationResult[]): ReportIssue[] {
  return results
    .filter((r) => r.status === 'fail' || r.status === 'warning')  // 'skipped' excluded
    .map((r) => {
      const interp = RULE_INTERPRETATIONS[r.rule_id];
      const v2 = isV2Result(r);
      // A v2-register result never uses the v1 dict's business_impact/headline
      // (or its generic fix_summary) — even when a same-named v1 entry
      // exists — because that text is static/generic while journey_stages
      // always shows this same result's real technical_details.found, and
      // the register itself now carries authored, evidence-aware
      // remediation for every rule (PRD Issue 1). Using v1's text here
      // would make report sections disagree for that rule_id (Issue 2's
      // defect shape) and lose the more specific v2 fix copy. recommended_owner/
      // estimated_effort still borrow the v1 entry when one exists — the
      // register doesn't carry those fields, and they're not evidence.
      if (!interp || v2) {
        return {
          rule_id: r.rule_id,
          validation_layer: r.validation_layer,
          severity: r.severity,
          problem: interp?.headline ?? `Validation failed: ${r.rule_id}`,
          why_it_matters: r.technical_details.found,
          recommended_owner: interp?.recommended_owner ?? 'Frontend Developer',
          fix_summary: v2 ? v2Remediation(r) : (interp?.fix_summary ?? 'Contact support for details on this rule.'),
          estimated_effort: interp?.estimated_effort ?? ('medium' as const),
        };
      }
      return {
        rule_id: r.rule_id,
        validation_layer: r.validation_layer,
        severity: r.severity,
        problem: interp.headline ?? interp.business_impact.split('.')[0] + '.',
        why_it_matters: interp.business_impact,
        recommended_owner: interp.recommended_owner,
        fix_summary: interp.fix_summary,
        estimated_effort: interp.estimated_effort,
      };
    });
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The subset of RuleInterpretation that ranking/rendering actually needs —
 * lets a v2 register result (no RULE_INTERPRETATIONS entry) synthesize one
 * from its own severity + technical_details.expected instead of being
 * silently dropped from the summary the way a bare rule_id lookup would.
 */
interface SummaryInput {
  severity: Severity;
  business_impact: string;
  affected_platforms: string[];
}

/**
 * RULE_INTERPRETATIONS entry when one exists for a provably v1-originated
 * result (same rule_id + validation_layer match as interpretResults()
 * above); otherwise built straight from the result itself.
 *
 * business_impact reads result.technical_details.found — never .expected.
 * .expected is written throughout the v2 register as the rule's
 * ideal/passing-state description (e.g. GA4_CONFIG_TAG_PRESENT.expected is
 * literally "GA4 config fires and a measurement ID (G-XXXXXXXXXX)
 * resolves"), so using it here for a FAIL result put the narrator in the
 * position of describing what *should* happen instead of what did — PRD
 * "Signal Health Report" Issue 4. .found is written as the actual observed
 * state either way, so it's the only field safe to read unconditionally.
 */
function toSummaryInput(result: ValidationResult): SummaryInput {
  const interp = RULE_INTERPRETATIONS[result.rule_id];
  if (interp && !isV2Result(result)) return interp;
  return {
    severity: result.severity,
    business_impact: result.technical_details.found,
    affected_platforms: [],
  };
}

/**
 * Ranks failed-rule interpretations for the executive summary: worst
 * severity first, then broadest platform impact as a tiebreaker within a
 * severity band. Capped at the top 3 — enough to name specifics without
 * turning the summary into a list.
 */
function rankIssuesForSummary(rules: SummaryInput[]): SummaryInput[] {
  return [...rules]
    .sort((a, b) => {
      const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.affected_platforms.length - a.affected_platforms.length;
    })
    .slice(0, 3);
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/**
 * Renders a coherent narrative from the ranked, highest-priority issues —
 * deliberately template-based rather than an LLM call, so the wording is
 * deterministic and reviewable like the rest of this engine.
 */
function renderSummary(rankedRules: SummaryInput[], counts: SeverityCounts): string {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  if (total === 0) return 'All conversion signals are operating normally.';

  const [top, second] = rankedRules;

  if (counts.critical > 0) {
    const criticalPlural = counts.critical > 1 ? 's' : '';
    let summary = `Your tracking has ${counts.critical} critical issue${criticalPlural}. The most urgent: ${top.business_impact}`;
    if (second && second.severity === 'critical') {
      summary += ` Also affecting results: ${second.business_impact}`;
    }
    summary += ' Fix this first — it has the biggest impact on ad spend efficiency and reporting accuracy.';
    if (counts.high > 0) {
      summary += ` ${counts.high} additional high-priority issue${counts.high > 1 ? 's' : ''} should be addressed next.`;
    }
    return summary;
  }

  if (counts.high > 0) {
    const highPlural = counts.high > 1 ? 's' : '';
    const verb = counts.high > 1 ? 'are' : 'is';
    return `Your tracking is mostly working, but ${counts.high} high-priority issue${highPlural} ${verb} reducing optimization effectiveness. Most significant: ${top.business_impact}`;
  }

  // Only medium/low severity issues remain.
  const minorPlural = total > 1 ? 's' : '';
  return `${total} minor issue${minorPlural} detected: ${top.business_impact} This has limited impact but is worth fixing when convenient.`;
}

/**
 * Builds the executive-summary narrative directly from the failed/warning
 * results — works for any rule set. A rule_id with a hand-authored
 * RULE_INTERPRETATIONS entry for a provably v1-originated result gets that
 * richer copy; anything else (including every v2 Check Register result)
 * synthesizes its summary input from the result's own severity and
 * technical_details.found — the actual observed state, not the rule's
 * ideal/passing-state .expected text (see toSummaryInput's docstring).
 */
export function generateBusinessSummary(results: ValidationResult[]): string {
  const rules = results.filter((r) => r.status === 'fail').map(toSummaryInput);
  const counts: SeverityCounts = {
    critical: rules.filter((r) => r.severity === 'critical').length,
    high: rules.filter((r) => r.severity === 'high').length,
    medium: rules.filter((r) => r.severity === 'medium').length,
    low: rules.filter((r) => r.severity === 'low').length,
  };
  return renderSummary(rankIssuesForSummary(rules), counts);
}

/**
 * Reads severity straight off each failed ValidationResult rather than
 * through the RULE_INTERPRETATIONS lookup, so this reflects every failure
 * regardless of rule set — a v2-only audit with critical failures no
 * longer reports 'healthy' just because none of its rule_ids have a v1
 * interpretation entry.
 */
export function determineOverallStatus(
  results: ValidationResult[],
): 'healthy' | 'partially_broken' | 'critical' {
  const failed = results.filter((r) => r.status === 'fail');
  if (failed.some((r) => r.severity === 'critical')) return 'critical';
  if (failed.some((r) => r.severity === 'high')) return 'partially_broken';
  return 'healthy';
}
