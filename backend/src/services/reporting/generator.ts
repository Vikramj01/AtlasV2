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
  SiteSetupSummary,
  UnassessableFinding,
} from '@/types/audit';
import { generateBusinessSummary, determineOverallStatus, getIssueHeadline, getIssueImpact } from '@/services/interpretation/engine';
import { buildCoverageSummary } from './coverage';
import { buildOpenQuestions } from './openQuestions';
import { scanReportForPlaceholders } from './placeholderGuard';
import { assertReportOutputClean } from './outputLint';
import { REGISTER_VERSION } from '@/services/validation/register/layers';

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
    if (stageResults.length === 0) {
      return { stage, status: 'not_run' as RuleStatus, issues: [] };
    }
    const allSkipped = stageResults.every((r) => r.status === 'skipped');
    if (allSkipped) {
      return { stage, status: 'not_run' as RuleStatus, issues: [] };
    }
    const failedRules = stageResults.filter((r) => r.status === 'fail' || r.status === 'warning');
    const status = worstStatus(stageResults.map((r) => r.status));
    const issues = failedRules.map((r) => ({
      rule_id: r.rule_id,
      label: getIssueHeadline(r.rule_id),
    }));
    return { stage, status, issues };
  });
}

function buildPlatformBreakdown(resultMap: Map<string, ValidationResult>): PlatformBreakdown[] {
  return Object.entries(PLATFORM_RULES).map(([platform, ruleIds]) => {
    const platformResults = ruleIds.map((id) => resultMap.get(id)).filter((r): r is ValidationResult => !!r);
    const totalCount = platformResults.length;

    if (totalCount === 0) {
      return {
        platform,
        status: 'not_included' as const,
        risk_explanation: 'Not included in this scan — no checks were run for this platform.',
        failed_rules: [],
        failed_rule_details: [],
      };
    }

    const failedRules = platformResults
      .filter((r) => r.status === 'fail')
      .map((r) => r.rule_id);
    const failCount = failedRules.length;
    const platformStatus =
      failCount === 0 ? 'healthy' : failCount <= totalCount / 2 ? 'at_risk' : 'broken';
    const riskExplanation =
      failCount === 0
        ? `All ${totalCount} checks passed.`
        : `${failCount} of ${totalCount} checks failed. ${PLATFORM_RISK_MESSAGES[platform] ?? ''}`;
    const failedRuleDetails = failedRules.map((ruleId) => ({
      rule_id: ruleId,
      impact: getIssueImpact(ruleId),
    }));
    return {
      platform,
      status: platformStatus,
      risk_explanation: riskExplanation,
      failed_rules: failedRules,
      failed_rule_details: failedRuleDetails,
    };
  });
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Audit-time assertion (Click-ID Contention, Contradiction Guard & Settle
 * Enforcement PRD W2.2) — a fired contradiction guard must suppress the
 * finding, never render inside it as evidence against itself. Now that
 * contradictionGuard.ts routes a fired result to could_not_be_assessed
 * instead of annotating it in place, this string should never appear in
 * any result reaching the renderer again; this throws rather than
 * silently shipping a self-contradicting finding if that guarantee is
 * ever broken by a future change.
 */
function assertNoUnsuppressedContradictions(results: ValidationResult[]): void {
  const leaked = results.find((r) => r.technical_details.evidence.some((e) => e.includes('CONTRADICTION')));
  if (leaked) {
    throw new Error(
      `Contradiction guard leak: ${leaked.rule_id}'s evidence reached the report renderer un-suppressed. `
      + 'A fired contradiction must be routed to could_not_be_assessed, never left standing as a finding.',
    );
  }
}

export function generateReport(
  auditData: AuditData,
  scores: AuditScores,
  issues: ReportIssue[],
  results: ValidationResult[],
  siteSetup: SiteSetupSummary,
  customJourneyStages?: JourneyStage[],
  customPlatformBreakdown?: PlatformBreakdown[],
  unassessable?: UnassessableFinding[],
): ReportJSON {
  assertNoUnsuppressedContradictions(results);
  const resultMap = new Map(results.map((r) => [r.rule_id, r]));
  const overallStatus = determineOverallStatus(results);
  const businessSummary = generateBusinessSummary(results);

  const report: ReportJSON = {
    audit_id: auditData.audit_id,
    website_url: auditData.website_url,
    generated_at: new Date().toISOString(),
    rule_set_version: auditData.rule_set_version,
    // Report Correctness Programme PRD Part D4 — only a v2 report actually
    // ran against the Check Register; a v1-legacy report has no register
    // version to stamp.
    ...(auditData.rule_set_version === 'v2' ? { register_version: REGISTER_VERSION } : {}),
    executive_summary: {
      overall_status: overallStatus,
      business_summary: businessSummary,
      scores,
      coverage: buildCoverageSummary(auditData, results),
    },
    journey_stages: customJourneyStages ?? buildJourneyStages(auditData.funnel_type, resultMap),
    platform_breakdown: customPlatformBreakdown ?? buildPlatformBreakdown(resultMap),
    issues,
    site_setup: siteSetup,
    technical_appendix: {
      validation_results: results,
      raw_network_requests: auditData.networkRequests,
      raw_datalayer_events: auditData.dataLayer,
    },
  };

  if (unassessable && unassessable.length > 0) {
    report.could_not_be_assessed = unassessable;
  }

  const openQuestions = buildOpenQuestions(auditData, results);
  if (openQuestions) {
    report.open_questions = openQuestions;
  }

  // Pre-render placeholder guard (PRD "Signal Health Report" Issue 4) —
  // flags, never blocks (see placeholderGuard.ts's docstring for why).
  const flags = scanReportForPlaceholders(report);
  if (flags.length > 0) {
    report.content_quality_warning = { flagged_fields: flags.map((f) => `${f.field}: ${f.matches.join(', ')}`) };
  }

  // Output vocabulary lint (Pre-Connection Scan Confidence Tiering PRD §5) —
  // hard gate, v2 only. v1-legacy rule copy (parameterCompleteness.ts,
  // tagConfiguration.ts, implementationDrift.ts) was never swept for PRD
  // §5's banned vocabulary and is out of this PRD's scope entirely (no
  // evidence_class/verdict concept there either) — gating it here would
  // hard-fail every v1-legacy audit over language nobody has reviewed
  // against this rule.
  if (report.rule_set_version === 'v2') {
    assertReportOutputClean(report);
  }

  return report;
}
