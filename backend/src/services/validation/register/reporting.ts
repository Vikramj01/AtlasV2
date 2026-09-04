/**
 * Check Register v2 reporting — builds the journey_stages and
 * platform_breakdown sections of ReportJSON from the register's own
 * structure (13 layers, each rule's platform_scope) instead of the v1
 * engine's hardcoded per-rule_id lookup tables (reporting/generator.ts's
 * STAGE_RULES/PLATFORM_RULES), which don't generalize to a rule set this
 * size and don't apply to v2's mostly-different rule_ids at all.
 *
 * Reuses the existing JourneyStage/PlatformBreakdown types as-is — no
 * frontend changes needed. "journey_stages" is repurposed to mean
 * "layers" for a v2 report, which is a more faithful breakdown of the
 * register's own structure than forcing 90 rules across 12 layers back
 * into the v1 funnel-step model (Landing/Product/Checkout/Confirmation)
 * that stopped matching once site_type stopped being ecommerce-only.
 */
import type { DeclaredPlatform, JourneyStage, PlatformBreakdown, RuleStatus, ValidationLayerV2, ValidationResult, ValidationRule } from '@/types/audit';
import { REGISTER } from './engine';
import { PLATFORM_LABELS } from './platformDetection';

const LAYER_LABELS: Record<ValidationLayerV2, string> = {
  scope_configuration: 'L0 · Scope & Configuration',
  foundation_tags: 'L1 · Foundation & Tags',
  click_id_capture: 'L2 · Click ID Capture',
  storage_durability: 'L3 · Storage Durability',
  cross_domain_continuity: 'L4 · Cross-Domain Continuity',
  event_firing: 'L5 · Event Firing',
  parameter_completeness: 'L6 · Parameter Completeness',
  identity_match_quality: 'L7 · Identity & Match Quality',
  consent: 'L8 · Consent',
  server_side_delivery: 'L9 · Server-Side Delivery',
  deduplication: 'L10 · Deduplication',
  reconciliation: 'L11 · Reconciliation',
  hygiene_integrity: 'L12 · Hygiene & Integrity',
};

const LAYER_ORDER: ValidationLayerV2[] = [
  'scope_configuration', 'foundation_tags', 'click_id_capture', 'storage_durability',
  'cross_domain_continuity', 'event_firing', 'parameter_completeness', 'identity_match_quality',
  'consent', 'server_side_delivery', 'deduplication', 'reconciliation', 'hygiene_integrity',
];

function worstStatus(statuses: RuleStatus[]): RuleStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.every((s) => s === 'skipped')) return 'not_run';
  return 'pass';
}

/**
 * One row per layer that actually produced results this run — only
 * layers with shipped rules (L0-L7, L12 today) ever appear, rather than
 * padding the report with "not_run" rows for layers that don't exist yet
 * (L8-L11).
 */
export function buildV2LayerStages(results: ValidationResult[]): JourneyStage[] {
  const byLayer = new Map<ValidationLayerV2, ValidationResult[]>();
  for (const r of results) {
    const layer = r.validation_layer as ValidationLayerV2;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(r);
    byLayer.set(layer, bucket);
  }

  return LAYER_ORDER
    .filter((layer) => byLayer.has(layer))
    .map((layer) => {
      const layerResults = byLayer.get(layer) as ValidationResult[];
      const status = worstStatus(layerResults.map((r) => r.status));
      const issues = layerResults
        .filter((r) => r.status === 'fail' || r.status === 'warning')
        .map((r) => ({ rule_id: r.rule_id, label: r.technical_details.found }));
      return { stage: LAYER_LABELS[layer], status, issues };
    });
}

const PLATFORM_RISK_MESSAGES: Record<DeclaredPlatform, string> = {
  google_ads: 'Google Ads attribution depends on click IDs, conversion events, and Enhanced Conversions data being properly captured.',
  meta: 'Meta attribution depends on Pixel, CAPI, and click ID persistence across pages.',
  tiktok: 'TikTok attribution depends on Pixel events and click ID persistence across pages.',
  linkedin: 'LinkedIn attribution depends on the Insight Tag and click ID persistence.',
  microsoft: 'Microsoft Advertising attribution depends on the UET tag and click ID persistence.',
  reddit: 'Reddit Ads attribution depends on the Pixel and click ID persistence.',
  pinterest: 'Pinterest Ads attribution depends on the Tag and click ID persistence.',
};

/** Register rules scoped to this platform — 'declared' (L0.1's internal fan-out) counts too, since it evaluates every declared platform. */
function rulesForPlatform(platform: DeclaredPlatform, register: ValidationRule[]): ValidationRule[] {
  return register.filter((rule) => {
    const scope = rule.platform_scope;
    if (scope === 'declared') return true;
    if (scope === 'any' || scope === 'n/a') return false;
    return scope.includes(platform);
  });
}

/**
 * One row per platform the register can score (the 7 DeclaredPlatform
 * values), built from the register's own platform_scope metadata rather
 * than a separate hardcoded rule_id list. A platform the advertiser didn't
 * declare gets 'not_included' (Out of Scope) even if some of its rules
 * happened to run (e.g. L0.2's undeclared-platform-tag check) — those
 * aren't checks OF that platform's setup, so they don't count toward it.
 */
export function buildV2PlatformBreakdown(
  results: ValidationResult[],
  declaredPlatforms: DeclaredPlatform[] | undefined,
  register: ValidationRule[] = REGISTER,
): PlatformBreakdown[] {
  const resultMap = new Map(results.map((r) => [r.rule_id, r]));
  const declared = new Set(declaredPlatforms ?? []);

  return (Object.keys(PLATFORM_LABELS) as DeclaredPlatform[]).map((platform) => {
    if (!declared.has(platform)) {
      return {
        platform: PLATFORM_LABELS[platform],
        status: 'not_included' as const,
        risk_explanation: 'Not included in this scan — no checks were run for this platform.',
        failed_rules: [],
        failed_rule_details: [],
      };
    }

    const platformRules = rulesForPlatform(platform, register);
    const platformResults = platformRules
      .map((rule) => resultMap.get(rule.rule_id))
      .filter((r): r is ValidationResult => !!r && r.status !== 'skipped');
    const totalCount = platformResults.length;

    if (totalCount === 0) {
      return {
        platform: PLATFORM_LABELS[platform],
        status: 'not_included' as const,
        risk_explanation: 'Declared, but no applicable checks produced a result for this platform in this scan.',
        failed_rules: [],
        failed_rule_details: [],
      };
    }

    const failedRules = platformResults.filter((r) => r.status === 'fail').map((r) => r.rule_id);
    const failCount = failedRules.length;
    const platformStatus = failCount === 0 ? 'healthy' : failCount <= totalCount / 2 ? 'at_risk' : 'broken';
    const riskExplanation = failCount === 0
      ? `All ${totalCount} checks passed.`
      : `${failCount} of ${totalCount} checks failed. ${PLATFORM_RISK_MESSAGES[platform]}`;
    const failedRuleDetails = failedRules.map((ruleId) => ({
      rule_id: ruleId,
      impact: resultMap.get(ruleId)?.technical_details.expected ?? ruleId,
    }));

    return {
      platform: PLATFORM_LABELS[platform],
      status: platformStatus,
      risk_explanation: riskExplanation,
      failed_rules: failedRules,
      failed_rule_details: failedRuleDetails,
    };
  });
}
