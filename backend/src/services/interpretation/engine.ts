/**
 * Interpretation Engine (Sprint 4)
 * Maps technical validation failures to marketer-friendly business impact.
 * Ported from rule-interpretations.ts (root).
 */
import type { ValidationResult, ReportIssue, Severity } from '@/types/audit';

interface RuleInterpretation {
  rule_id: string;
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
    business_impact: 'Google Analytics is not tracking your conversions. Your entire analytics dashboard is blind to purchases. This breaks all conversion reporting, funnel analysis, and revenue attribution.',
    affected_platforms: ['GA4'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Add gtag("event", "purchase", {...}) to your confirmation page, triggered immediately when the order is completed.',
    estimated_effort: 'low',
  },
  META_PIXEL_PURCHASE_EVENT_FIRED: {
    rule_id: 'META_PIXEL_PURCHASE_EVENT_FIRED',
    business_impact: "Meta Ads cannot track purchases from your campaigns. You're flying completely blind on campaign performance. Meta cannot optimize or report ROI.",
    affected_platforms: ['Meta Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Add fbq("track", "Purchase", {...}) to your confirmation page with transaction details.',
    estimated_effort: 'low',
  },
  GOOGLE_ADS_CONVERSION_EVENT_FIRED: {
    rule_id: 'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
    business_impact: 'Google Ads cannot count conversions from your ad clicks. Smart bidding cannot optimize. Your ROAS data is completely broken.',
    affected_platforms: ['Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Configure Google Ads conversion tracking in GTM or implement gtag conversion event on confirmation page.',
    estimated_effort: 'medium',
  },
  SGTM_SERVER_EVENT_FIRED: {
    rule_id: 'SGTM_SERVER_EVENT_FIRED',
    business_impact: "Server-side tracking is not active. You're missing automated deduplication and conversions are likely being counted twice.",
    affected_platforms: ['sGTM', 'GA4 Measurement Protocol'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Configure your dataLayer to POST conversion events to your sGTM endpoint.',
    estimated_effort: 'medium',
  },
  DATALAYER_POPULATED: {
    rule_id: 'DATALAYER_POPULATED',
    business_impact: 'Your GTM has no data to work with. All conversion tracking will fail. This is the foundation — without it, nothing else works.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Implement dataLayer initialization and push events at key points: page_view, add_to_cart, begin_checkout, purchase.',
    estimated_effort: 'medium',
  },
  GTM_CONTAINER_LOADED: {
    rule_id: 'GTM_CONTAINER_LOADED',
    business_impact: 'Google Tag Manager is not loading. GTM is the backbone of all your tracking — without it, nothing tracks at all.',
    affected_platforms: ['GTM', 'GA4', 'Meta', 'Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure GTM script is in the <head> before other scripts. Check for CSP violations or ad blocker conflicts.',
    estimated_effort: 'low',
  },
  PAGE_VIEW_EVENT_FIRED: {
    rule_id: 'PAGE_VIEW_EVENT_FIRED',
    business_impact: 'GA4 is not tracking page views. Your funnel analysis is broken.',
    affected_platforms: ['GA4', 'GTM'],
    severity: 'high',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Configure GTM to send page_view event on each page load. For SPAs, trigger on route changes.',
    estimated_effort: 'low',
  },
  ADD_TO_CART_EVENT_FIRED: {
    rule_id: 'ADD_TO_CART_EVENT_FIRED',
    business_impact: "You cannot optimize for add-to-cart behavior. Meta and Google cannot build lookalike audiences from cart abandoners.",
    affected_platforms: ['GA4', 'Meta', 'Google Ads'],
    severity: 'medium',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Push add_to_cart event to dataLayer when user adds a product, including product details.',
    estimated_effort: 'low',
  },
  TRANSACTION_ID_PRESENT: {
    rule_id: 'TRANSACTION_ID_PRESENT',
    business_impact: "Conversions cannot be deduplicated. You'll see inflated conversion counts (likely 2–3x too high) and artificial double-billing across platforms.",
    affected_platforms: ['GA4', 'Google Ads', 'Meta', 'sGTM'],
    severity: 'critical',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Attach a unique transaction_id from your order system to the purchase event.',
    estimated_effort: 'low',
  },
  VALUE_PARAMETER_PRESENT: {
    rule_id: 'VALUE_PARAMETER_PRESENT',
    business_impact: 'Cannot track ROAS or revenue impact. Smart bidding has no value to optimize for.',
    affected_platforms: ['GA4', 'Google Ads', 'Meta', 'sGTM'],
    severity: 'critical',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Include transaction value in purchase event: {value: order.total}',
    estimated_effort: 'low',
  },
  CURRENCY_PARAMETER_PRESENT: {
    rule_id: 'CURRENCY_PARAMETER_PRESENT',
    business_impact: 'Multi-currency revenue reports will be wrong.',
    affected_platforms: ['GA4', 'Google Ads'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Add currency code to purchase event: {currency: "USD"}',
    estimated_effort: 'low',
  },
  GCLID_CAPTURED_AT_LANDING: {
    rule_id: 'GCLID_CAPTURED_AT_LANDING',
    business_impact: 'Google Ads cannot attribute conversions to ad clicks. Attribution is completely broken.',
    affected_platforms: ['Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure Google Ads auto-tagging is enabled and gclid is captured on landing.',
    estimated_effort: 'low',
  },
  FBCLID_CAPTURED_AT_LANDING: {
    rule_id: 'FBCLID_CAPTURED_AT_LANDING',
    business_impact: 'Meta cannot attribute conversions to ad clicks. Campaign performance data is wrong.',
    affected_platforms: ['Meta Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure Meta Pixel is properly installed on your landing page.',
    estimated_effort: 'low',
  },
  EVENT_ID_GENERATED: {
    rule_id: 'EVENT_ID_GENERATED',
    business_impact: 'Client and server events cannot be deduplicated. Conversion counts will be doubled.',
    affected_platforms: ['GA4', 'Meta', 'sGTM'],
    severity: 'high',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Generate a unique event_id (UUID or timestamp) for each event.',
    estimated_effort: 'low',
  },
  EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS: {
    rule_id: 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
    business_impact: 'Enhanced Conversions cannot match users. Your match rate drops below 30%.',
    affected_platforms: ['Google Ads', 'Meta CAPI'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Capture customer email at checkout: {user_data: {email: customer.email}}',
    estimated_effort: 'low',
  },
  PHONE_CAPTURED_FOR_CAPI: {
    rule_id: 'PHONE_CAPTURED_FOR_CAPI',
    business_impact: 'Meta Conversions API match rate drops 20–30%.',
    affected_platforms: ['Meta CAPI'],
    severity: 'medium',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Capture phone at checkout, normalized to digits only.',
    estimated_effort: 'low',
  },
  ITEMS_ARRAY_POPULATED: {
    rule_id: 'ITEMS_ARRAY_POPULATED',
    business_impact: 'Cannot do product-level analysis. ROI by SKU is blind.',
    affected_platforms: ['GA4', 'Meta'],
    severity: 'medium',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Include all products in purchase: {items: [{id, price, quantity}]}',
    estimated_effort: 'low',
  },
  USER_ID_PRESENT: {
    rule_id: 'USER_ID_PRESENT',
    business_impact: 'Cannot track repeat customers. Repeat purchase rate and LTV are wrong.',
    affected_platforms: ['GA4', 'sGTM'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Set GA4 user_id when user logs in or has an account.',
    estimated_effort: 'medium',
  },
  COUPON_CAPTURED_IF_USED: {
    rule_id: 'COUPON_CAPTURED_IF_USED',
    business_impact: 'Cannot measure coupon effectiveness or optimize discount strategy.',
    affected_platforms: ['GA4', 'Meta'],
    severity: 'low',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Include coupon code when used: {coupon: "SUMMER20"}',
    estimated_effort: 'low',
  },
  SHIPPING_CAPTURED: {
    rule_id: 'SHIPPING_CAPTURED',
    business_impact: 'Cannot analyze margin impact of shipping costs.',
    affected_platforms: ['GA4', 'Meta'],
    severity: 'low',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Track shipping separately: {shipping: order.shipping_cost}',
    estimated_effort: 'low',
  },
  GCLID_PERSISTS_TO_CONVERSION: {
    rule_id: 'GCLID_PERSISTS_TO_CONVERSION',
    business_impact: 'Google Ads loses attribution data for this conversion. Each lost gclid = one more unattributed sale.',
    affected_platforms: ['Google Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Store gclid in sessionStorage on landing, retrieve and attach to purchase event.',
    estimated_effort: 'medium',
  },
  FBCLID_PERSISTS_TO_CONVERSION: {
    rule_id: 'FBCLID_PERSISTS_TO_CONVERSION',
    business_impact: 'Meta loses user matching. Conversion tracking fails or has 0% match rate.',
    affected_platforms: ['Meta Ads'],
    severity: 'critical',
    recommended_owner: 'Frontend Developer',
    fix_summary: 'Ensure Meta Pixel fires on all pages. Check browser cookie policy allows fbp/fbc cookies.',
    estimated_effort: 'medium',
  },
  TRANSACTION_ID_MATCHES_ORDER_SYSTEM: {
    rule_id: 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
    business_impact: "Cannot reconcile conversion data with actual revenue. Your reports and real business metrics don't match.",
    affected_platforms: ['All'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Use the exact order ID from your order management system.',
    estimated_effort: 'low',
  },
  EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER: {
    rule_id: 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
    business_impact: 'Deduplication fails. Conversion counts double. Your ROAS is inflated by 2–3x.',
    affected_platforms: ['sGTM', 'GA4', 'Meta CAPI'],
    severity: 'high',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Pass the same event_id from client event to server request. Both must match exactly.',
    estimated_effort: 'medium',
  },
  USER_DATA_NORMALIZED_CONSISTENTLY: {
    rule_id: 'USER_DATA_NORMALIZED_CONSISTENTLY',
    business_impact: 'Match rates drop 30–50%. Enhanced Conversions fail to match the same user across events.',
    affected_platforms: ['Meta CAPI', 'Google Ads Enhanced Conversions'],
    severity: 'medium',
    recommended_owner: 'Backend Developer',
    fix_summary: 'Normalize email (lowercase + trim), phone (digits only) consistently before hashing.',
    estimated_effort: 'low',
  },
  PII_PROPERLY_HASHED: {
    rule_id: 'PII_PROPERLY_HASHED',
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
    business_impact: 'Custom HTML tags bypass GTM template safety, cannot be governed centrally, and frequently contain copy-pasted legacy code. Each one is a future maintenance and audit liability — they break silently, resist version control, and make consent enforcement harder.',
    affected_platforms: ['All'],
    severity: 'medium',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Replace with a built-in tag template wherever possible. If no template exists, document the reason in the tag note.',
    estimated_effort: 'medium',
  },

  CUSTOM_HTML_TAG_BYPASSES_CONSENT: {
    rule_id: 'CUSTOM_HTML_TAG_BYPASSES_CONSENT',
    business_impact: 'A custom HTML tag is sending tracking events without consent gating. This is a compliance violation under GDPR, ePrivacy, UAE PDPL, and similar regulations. Your ad accounts and customer trust are at direct risk. Regulators treat ungated marketing pixels as evidence of willful non-compliance.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Add consentSettings to the tag requiring ad_storage and ad_user_data for marketing pixels, analytics_storage for analytics tags.',
    estimated_effort: 'low',
  },

  CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA: {
    rule_id: 'CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA',
    business_impact: 'A custom HTML tag contains hardcoded conversion IDs, pixel IDs, or value/currency literals. These never adapt to runtime context — every conversion gets the same hardcoded value, distorting Smart Bidding and ROAS reporting. Hardcoded IDs also create maintenance debt when account structures change.',
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],
    severity: 'high',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Move conversion IDs and pixel IDs to GTM variables. Move value, currency, and transaction_id to dataLayer-sourced variables.',
    estimated_effort: 'medium',
  },

  HARDCODED_VALUE_IN_TAG_CONFIG: {
    rule_id: 'HARDCODED_VALUE_IN_TAG_CONFIG',
    business_impact: 'A conversion tag has the value parameter set as a literal number rather than a dataLayer variable. Smart Bidding and tROAS will train on this flat value, distorting bids and ROAS reporting across every campaign. Most common cause: a test value left in production after development.',
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4', 'sGTM'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Replace the literal value with {{ecommerce.value}} or the equivalent dataLayer variable reference.',
    estimated_effort: 'low',
  },

  HARDCODED_CURRENCY_IN_TAG_CONFIG: {
    rule_id: 'HARDCODED_CURRENCY_IN_TAG_CONFIG',
    business_impact: "A conversion tag has currency set as a literal string. If this doesn't match the site's actual transaction currency, ad platforms will misvalue conversions (e.g. 100 SGD treated as 100 AED). Even if currently correct, this is fragile to future expansion or currency changes.",
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],
    severity: 'high',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Use a dataLayer variable for currency. If the site is genuinely single-currency, document that decision in the tag note.',
    estimated_effort: 'low',
  },

  HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG: {
    rule_id: 'HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG',
    business_impact: 'Transaction ID is hardcoded. This collapses deduplication completely — every purchase carries the same ID, causing all but one to be discarded by GA4 and ad platforms with dedup logic. Conversions silently drop to approximately one per day regardless of real purchase volume.',
    affected_platforms: ['All'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Replace with {{ecommerce.transaction_id}} dataLayer variable.',
    estimated_effort: 'low',
  },

  DUPLICATE_TAG_CONFIGURATION: {
    rule_id: 'DUPLICATE_TAG_CONFIGURATION',
    business_impact: 'Multiple tags are firing the same conversion event for the same destination. Conversions are being counted multiple times. ROAS appears inflated, and algorithms are training on phantom volume. This is one of the most common causes of over-reporting in Google Ads and Meta Ads.',
    affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],
    severity: 'critical',
    recommended_owner: 'GTM implementer',
    fix_summary: 'Identify the canonical tag and pause or delete duplicates. If sGTM and client-side both legitimately fire for the same event, set event_id on both for deduplication.',
    estimated_effort: 'medium',
  },
};

export function interpretResults(results: ValidationResult[]): ReportIssue[] {
  return results
    .filter((r) => r.status === 'fail' || r.status === 'warning')  // 'skipped' excluded
    .map((r) => {
      const interp = RULE_INTERPRETATIONS[r.rule_id];
      if (!interp) {
        return {
          rule_id: r.rule_id,
          validation_layer: r.validation_layer,
          severity: r.severity,
          problem: `Validation failed: ${r.rule_id}`,
          why_it_matters: r.technical_details.found,
          recommended_owner: 'Frontend Developer',
          fix_summary: 'Contact support for details on this rule.',
          estimated_effort: 'medium' as const,
        };
      }
      return {
        rule_id: r.rule_id,
        validation_layer: r.validation_layer,
        severity: r.severity,
        problem: interp.business_impact.split('.')[0] + '.',  // First sentence as problem
        why_it_matters: interp.business_impact,
        recommended_owner: interp.recommended_owner,
        fix_summary: interp.fix_summary,
        estimated_effort: interp.estimated_effort,
      };
    });
}

export function generateBusinessSummary(failedRuleIds: string[]): string {
  const rules = failedRuleIds.map((id) => RULE_INTERPRETATIONS[id]).filter(Boolean);
  if (rules.length === 0) return 'All conversion signals are operating normally.';

  const criticalCount = rules.filter((r) => r.severity === 'critical').length;
  const highCount = rules.filter((r) => r.severity === 'high').length;
  let summary = '';

  if (criticalCount > 0) {
    summary += `${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} detected: `;
    const impacts = rules
      .filter((r) => r.severity === 'critical')
      .map((r) => r.business_impact.split('.')[0])
      .slice(0, 2);
    summary += impacts.join('. ') + '. ';
  }

  if (highCount > 0) {
    summary += `${highCount} high-priority issue${highCount > 1 ? 's' : ''} also present that reduce optimization effectiveness.`;
  }

  if (criticalCount === 0 && highCount === 0) {
    summary += `${rules.length} minor issue${rules.length > 1 ? 's' : ''} detected that may slightly reduce reporting accuracy.`;
  }

  return summary.trim();
}

export function determineOverallStatus(
  failedRuleIds: string[],
): 'healthy' | 'partially_broken' | 'critical' {
  const rules = failedRuleIds.map((id) => RULE_INTERPRETATIONS[id]).filter(Boolean);
  if (rules.some((r) => r.severity === 'critical')) return 'critical';
  if (rules.some((r) => r.severity === 'high')) return 'partially_broken';
  return 'healthy';
}
