/**
 * Report Generator (Sprint 4)
 * Assembles the final ReportJSON from validation results, scores, and interpreted issues.
 */
import type {
  AuditData,
  AuditScores,
  ReportIssue,
  ReportJSON,
  ValidationResult,
  JourneyStage,
  PlatformBreakdown,
  RuleStatus,
} from '@/types/audit';
import { generateBusinessSummary, determineOverallStatus } from '@/services/interpretation/engine';

// ─── Journey stage mapping ─────────────────────────────────────────────────────

const FUNNEL_STAGES: Record<string, string[]> = {
  ecommerce: ['Landing', 'Product', 'Checkout', 'Confirmation', 'Platforms'],
  saas:      ['Landing', 'Features', 'Signup', 'Onboarding', 'Platforms'],
  lead_gen:  ['Landing', 'Form', 'Thank You', 'Platforms'],
};

// Rules that are primarily associated with each journey stage
const STAGE_RULES: Record<string, string[]> = {
  Landing:      ['GTM_CONTAINER_LOADED', 'PAGE_VIEW_EVENT_FIRED', 'GCLID_CAPTURED_AT_LANDING', 'FBCLID_CAPTURED_AT_LANDING', 'DATALAYER_POPULATED'],
  Product:      ['ADD_TO_CART_EVENT_FIRED', 'ITEMS_ARRAY_POPULATED'],
  Checkout:     ['GCLID_PERSISTS_TO_CONVERSION', 'FBCLID_PERSISTS_TO_CONVERSION', 'USER_DATA_NORMALIZED_CONSISTENTLY', 'PII_PROPERLY_HASHED', 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'PHONE_CAPTURED_FOR_CAPI'],
  Confirmation: ['GA4_PURCHASE_EVENT_FIRED', 'META_PIXEL_PURCHASE_EVENT_FIRED', 'GOOGLE_ADS_CONVERSION_EVENT_FIRED', 'TRANSACTION_ID_PRESENT', 'VALUE_PARAMETER_PRESENT', 'CURRENCY_PARAMETER_PRESENT', 'EVENT_ID_GENERATED', 'COUPON_CAPTURED_IF_USED', 'SHIPPING_CAPTURED', 'USER_ID_PRESENT', 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM'],
  Platforms:    ['SGTM_SERVER_EVENT_FIRED', 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER'],
  // saas/lead_gen stages map to the same rule sets
  Features:     ['PAGE_VIEW_EVENT_FIRED', 'DATALAYER_POPULATED'],
  Signup:       ['EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'USER_ID_PRESENT'],
  Onboarding:   ['USER_ID_PRESENT', 'PAGE_VIEW_EVENT_FIRED'],
  Form:         ['EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'PHONE_CAPTURED_FOR_CAPI'],
  'Thank You':  ['GA4_PURCHASE_EVENT_FIRED', 'META_PIXEL_PURCHASE_EVENT_FIRED', 'GOOGLE_ADS_CONVERSION_EVENT_FIRED', 'EVENT_ID_GENERATED'],
};

// Platform → rules mapping
const PLATFORM_RULES: Record<string, string[]> = {
  google_ads: ['GOOGLE_ADS_CONVERSION_EVENT_FIRED', 'GCLID_CAPTURED_AT_LANDING', 'GCLID_PERSISTS_TO_CONVERSION', 'VALUE_PARAMETER_PRESENT', 'CURRENCY_PARAMETER_PRESENT', 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS'],
  meta_ads:   ['META_PIXEL_PURCHASE_EVENT_FIRED', 'FBCLID_CAPTURED_AT_LANDING', 'FBCLID_PERSISTS_TO_CONVERSION', 'SGTM_SERVER_EVENT_FIRED', 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER', 'PHONE_CAPTURED_FOR_CAPI', 'PII_PROPERLY_HASHED'],
  ga4:        ['GA4_PURCHASE_EVENT_FIRED', 'DATALAYER_POPULATED', 'GTM_CONTAINER_LOADED', 'PAGE_VIEW_EVENT_FIRED', 'TRANSACTION_ID_PRESENT', 'ITEMS_ARRAY_POPULATED'],
  gtm:        ['GTM_CONTAINER_LOADED', 'DATALAYER_POPULATED'],
  sgtm:       ['SGTM_SERVER_EVENT_FIRED', 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER'],
};

const PLATFORM_RISK_MESSAGES: Record<string, string> = {
  google_ads: 'Google Ads attribution depends on click IDs and conversion events being properly captured.',
  meta_ads:   'Meta Ads attribution depends on Pixel, CAPI, and click ID persistence across pages.',
  ga4:        'GA4 data quality depends on dataLayer events and network calls to analytics.google.com.',
  gtm:        'GTM is the foundation. Without it, no other tags fire correctly.',
  sgtm:       'Server-side GTM provides deduplication and improved signal quality.',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function worstStatus(statuses: RuleStatus[]): RuleStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warning')) return 'warning';
  return 'pass';
}

function buildJourneyStages(funnelType: string, resultMap: Map<string, ValidationResult>): JourneyStage[] {
  const stages = FUNNEL_STAGES[funnelType] ?? FUNNEL_STAGES['ecommerce'];
  return stages.map((stage) => {
    const ruleIds = STAGE_RULES[stage] ?? [];
    const stageResults = ruleIds
      .map((id) => resultMap.get(id))
      .filter((r): r is ValidationResult => !!r);
    const failedRules = stageResults.filter((r) => r.status === 'fail' || r.status === 'warning');
    const status = worstStatus(stageResults.map((r) => r.status));
    const issues = failedRules.map(
      (r) => `${r.rule_id.replace(/_/g, ' ').toLowerCase()} — ${r.technical_details.found}`,
    );
    return { stage, status, issues };
  });
}

function buildPlatformBreakdown(resultMap: Map<string, ValidationResult>): PlatformBreakdown[] {
  return Object.entries(PLATFORM_RULES).map(([platform, ruleIds]) => {
    const platformResults = ruleIds.map((id) => resultMap.get(id)).filter((r): r is ValidationResult => !!r);
    const failedRules = platformResults
      .filter((r) => r.status === 'fail')
      .map((r) => r.rule_id);
    const failCount = failedRules.length;
    const totalCount = platformResults.length;
    const platformStatus =
      failCount === 0 ? 'healthy' : failCount <= totalCount / 2 ? 'at_risk' : 'broken';
    const riskExplanation =
      failCount === 0
        ? `All ${totalCount} ${platform.replace('_', ' ')} checks passed.`
        : `${failCount} of ${totalCount} checks failed. ${PLATFORM_RISK_MESSAGES[platform] ?? ''}`;
    return { platform, status: platformStatus, risk_explanation: riskExplanation, failed_rules: failedRules };
  });
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateReport(
  auditData: AuditData,
  scores: AuditScores,
  issues: ReportIssue[],
  results: ValidationResult[],
): ReportJSON {
  const resultMap = new Map(results.map((r) => [r.rule_id, r]));
  const failedRuleIds = results.filter((r) => r.status === 'fail').map((r) => r.rule_id);
  const overallStatus = determineOverallStatus(failedRuleIds);
  const businessSummary = generateBusinessSummary(failedRuleIds);

  return {
    audit_id: auditData.audit_id,
    generated_at: new Date().toISOString(),
    executive_summary: {
      overall_status: overallStatus,
      business_summary: businessSummary,
      scores,
    },
    journey_stages: buildJourneyStages(auditData.funnel_type, resultMap),
    platform_breakdown: buildPlatformBreakdown(resultMap),
    issues,
    technical_appendix: {
      validation_results: results,
      raw_network_requests: auditData.networkRequests,
      raw_datalayer_events: auditData.dataLayer,
    },
  };
}
