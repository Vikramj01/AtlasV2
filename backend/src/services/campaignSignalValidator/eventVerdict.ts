/**
 * Campaign Signal Validator — Event Verdict Logic
 *
 * Pure, no-I/O scoring of whether a site's primary conversion signal is
 * strong enough to hand to automated bidding. Google's AI Max defaults on
 * for Search campaigns from 1 Sept 2026 and scales whatever the primary
 * conversion action rewards — a weak or proxy signal gets bought harder,
 * efficiently, while reported conversions rise and revenue does not.
 *
 * v1 scope is deliberately heuristic and does not require a live Google Ads
 * connection: it reasons from the site scan (siteDetectionService) and,
 * when available, the client's Journey Builder stage data (proxy_value_gbp,
 * buyer_intent_level). A live-Ads-API-informed verdict (reading actual
 * configured conversion actions) and the Strategy Gate "event verdict logic"
 * overlap noted in STRATEGY_GATE_PRD.md's backlog are both future extensions
 * of this module, not v1 requirements.
 */

import type { SiteDetection } from '@/services/planning/siteDetectionService';

export type VerdictRating = 'strong' | 'moderate' | 'weak';
export type AIMaxRisk = 'low' | 'medium' | 'high';

export interface VerdictReasonCode {
  code: string;
  severity: 'high' | 'medium' | 'low';
  headline: string;
  detail: string;
}

export interface EventVerdict {
  rating: VerdictRating;
  score: number; // 0-100, higher = stronger signal
  ai_max_risk: AIMaxRisk;
  reasons: VerdictReasonCode[];
  remediation: string[];
  summary: string;
}

export interface PrimaryStageInput {
  label: string;
  proxy_value_gbp: number | null;
  buyer_intent_level: string | null;
}

export interface VerdictInput {
  siteDetection: SiteDetection;
  primaryStage?: PrimaryStageInput | null;
}

const RATING_THRESHOLDS = { strong: 70, moderate: 40 };

export function evaluateEventVerdict(input: VerdictInput): EventVerdict {
  const { siteDetection, primaryStage } = input;
  const reasons: VerdictReasonCode[] = [];
  let score = 100;

  const { existing_tracking, inferred_business_type } = siteDetection;

  // ── Rule 1: no tag management layer at all ──────────────────────────────────
  // Without GTM, there's no single place to verify what's actually configured
  // as the "primary conversion" — the biggest blind spot for a pre-flight check.
  if (!existing_tracking.gtm_detected) {
    score -= 25;
    reasons.push({
      code: 'NO_GTM_DETECTED',
      severity: 'high',
      headline: 'No tag manager detected',
      detail:
        'No Google Tag Manager container was found on the site. Without GTM, conversion ' +
        'tracking is likely hardcoded per-page, making it hard to verify — or change — what ' +
        'AI Max will actually treat as the primary conversion signal.',
    });
  }

  // ── Rule 2: primary conversion carries no monetary value ────────────────────
  if (primaryStage && !primaryStage.proxy_value_gbp) {
    score -= 25;
    reasons.push({
      code: 'NO_CONVERSION_VALUE',
      severity: 'high',
      headline: 'Primary conversion has no assigned value',
      detail:
        `"${primaryStage.label}" has no proxy value configured. Value-based bidding treats ` +
        'every conversion as equally worth pursuing when there is no value signal — AI Max ' +
        'will scale volume, not revenue.',
    });
  }

  // ── Rule 3: primary conversion is early-funnel / low buyer intent ───────────
  if (primaryStage?.buyer_intent_level === 'problem_aware') {
    score -= 20;
    reasons.push({
      code: 'LOW_INTENT_PRIMARY_STAGE',
      severity: 'medium',
      headline: 'Primary conversion is an early-funnel signal',
      detail:
        `"${primaryStage.label}" is tagged as a problem-aware (early-funnel) stage. Using it ` +
        'as the primary bidding signal rewards traffic that is far from a buying decision.',
    });
  }

  // ── Rule 4: ecommerce site with no purchase/value signal detected ───────────
  if (inferred_business_type === 'ecommerce' && !siteDetection.detected_currency) {
    score -= 15;
    reasons.push({
      code: 'ECOMMERCE_NO_VALUE_SIGNAL',
      severity: 'medium',
      headline: 'No purchase value signal detected on an ecommerce site',
      detail:
        'The site looks like ecommerce, but no currency/price signal was found in the scan. ' +
        'Confirm the primary conversion carries an actual transaction value, not just a ' +
        '"purchase completed" boolean.',
    });
  }

  // ── Rule 5: lead-gen site with no funnel beyond the primary stage ───────────
  if (inferred_business_type === 'lead_gen' && !primaryStage) {
    score -= 15;
    reasons.push({
      code: 'LEAD_GEN_NO_STAGE_DATA',
      severity: 'medium',
      headline: 'No journey stage data for this lead-gen site',
      detail:
        'This looks like a lead-gen site but no Journey Builder stage was supplied for the ' +
        'scan, so there is no visibility into whether the primary conversion is a form-fill ' +
        '(proxy) or a qualified/CRM-verified stage further down funnel.',
    });
  }

  // ── Rule 6: no dedicated ad-platform pixel detected at all ──────────────────
  if (!existing_tracking.google_ads_detected && !existing_tracking.meta_pixel_detected) {
    score -= 10;
    reasons.push({
      code: 'NO_AD_PLATFORM_SIGNAL',
      severity: 'low',
      headline: 'No Google Ads or Meta conversion signal detected',
      detail:
        'Neither a Google Ads conversion tag nor a Meta Pixel was detected. If ads are running, ' +
        'conversions may be tracked exclusively through GA4 import or a third-party bridge — ' +
        'verify the primary conversion action Google Ads is actually reading from.',
    });
  }

  score = Math.max(0, Math.min(100, score));

  const rating: VerdictRating =
    score >= RATING_THRESHOLDS.strong ? 'strong' : score >= RATING_THRESHOLDS.moderate ? 'moderate' : 'weak';
  const ai_max_risk: AIMaxRisk = rating === 'strong' ? 'low' : rating === 'moderate' ? 'medium' : 'high';

  return {
    rating,
    score,
    ai_max_risk,
    reasons: reasons.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    remediation: buildRemediation(reasons),
    summary: buildSummary(rating, ai_max_risk, reasons.length),
  };
}

function severityRank(s: 'high' | 'medium' | 'low'): number {
  return s === 'high' ? 2 : s === 'medium' ? 1 : 0;
}

function buildRemediation(reasons: VerdictReasonCode[]): string[] {
  const byCode: Record<string, string> = {
    NO_GTM_DETECTED:
      'Install Google Tag Manager and route all conversion tags through it so the primary ' +
      'conversion action is auditable in one place.',
    NO_CONVERSION_VALUE:
      'Attach a proxy or actual monetary value to the primary conversion event before enabling ' +
      'automated bidding — even a modeled estimate is better than none.',
    LOW_INTENT_PRIMARY_STAGE:
      'Move the primary conversion action to a later-funnel, higher-intent stage, or add an ' +
      'Enhanced Conversions for Leads / offline conversion import so revenue-relevant signal ' +
      'reaches the bidding algorithm.',
    ECOMMERCE_NO_VALUE_SIGNAL:
      'Confirm the purchase event fires with transaction value and currency, not just a ' +
      'completion flag.',
    LEAD_GEN_NO_STAGE_DATA:
      'Map this client’s funnel in Journey Builder so future scans can confirm whether the ' +
      'primary conversion is a qualified stage rather than a raw form-fill.',
    NO_AD_PLATFORM_SIGNAL:
      'Confirm which conversion action Google Ads/Meta is actually configured to optimise ' +
      'against, and verify it matches a signal this scan can see.',
  };
  return reasons.map((r) => byCode[r.code]).filter((s): s is string => !!s);
}

function buildSummary(rating: VerdictRating, risk: AIMaxRisk, reasonCount: number): string {
  if (rating === 'strong') {
    return 'This site’s primary conversion signal looks solid — no major changes needed before ' +
      'turning on automated bidding.';
  }
  if (rating === 'moderate') {
    return `Found ${reasonCount} issue${reasonCount === 1 ? '' : 's'} that weaken the primary ` +
      'conversion signal. Address these before AI Max or similar automated bidding scales spend ' +
      'against it.';
  }
  return `This primary conversion signal is weak — automated bidding will scale a proxy metric, ` +
    `not revenue. ${reasonCount} issue${reasonCount === 1 ? '' : 's'} found; risk is ${risk}.`;
}
