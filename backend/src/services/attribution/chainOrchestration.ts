/**
 * Attribution Chain Check PRD §8 — derives a pre-connection
 * AttributionChainResult from a completed AuditData produced by a real
 * lead-gen journeySimulator.ts run.
 *
 * This is the "resolve outside, read inside" glue between the raw capture
 * (journeySimulator.ts, the L2 register rules) and chainModel.ts's pure
 * cascade logic — chainModel.ts itself must stay dependency-free, so the
 * decision of "which platform's click id counts, and what NOT_OBSERVED
 * reason applies" lives here instead. Lives in services/attribution/, not
 * campaignSignalValidator/, since nothing here is specific to that product:
 * a future in-app surface reading a full audit's AuditData (which already
 * runs journeySimulator.ts for every lead_gen audit, not just Campaign
 * Signal Validator's) could call this identically.
 *
 * Link derivation:
 *   - Arrival: L2.9 (LANDING_REDIRECT_PRESERVES_QUERY_STRING) directly —
 *     already a single, non-platform-specific "did any injected param
 *     survive the redirect chain" check, which is exactly this link.
 *   - Persistence: worst-case across every ad platform this run's REAL,
 *     unprompted network traffic actually shows running
 *     (platformTagDetected) — not every platform Atlas happened to inject
 *     a synthetic value for, since Atlas injects all eight regardless of
 *     whether the site runs that platform at all. A single detected
 *     platform whose click id never made it into storage/cookie/dataLayer
 *     is a real, reportable break even if every other detected platform's
 *     capture is fine — a prospect running both Google and Meta ads loses
 *     real attributable leads from whichever one is broken.
 *   - Form carriage: journeySimulator.ts's own
 *     AuditData.attribution_form_carriage (services/attribution/
 *     formCarriageDetection.ts), passed through as-is.
 *
 * not_observed_reason (§6) — checked in this order because "not running
 * ads yet" is the more fundamental state: it explains away an arrival/
 * persistence result that would otherwise look like a break, and takes
 * priority even when the lead-gen form also couldn't be reached.
 *   - 'no_paid_traffic': no click-id-capable platform's own tag fired
 *     anywhere during the crawl — real, unprompted evidence, never derived
 *     from Atlas's own synthetic injection (which always runs regardless
 *     of whether the site is really running paid campaigns).
 *   - 'no_conversion_surface': at least one ad platform is genuinely
 *     running, but attribution_form_carriage never resolved past
 *     NOT_OBSERVED (no lead-gen fields found, or the submit control was
 *     unreachable) — a distinct, arguably more urgent problem (PRD §6).
 */
import type { AuditData, DeclaredPlatform, ValidationRule } from '@/types/audit';
import { platformTagDetected, ALL_DECLARED_PLATFORMS } from '@/services/validation/register/platformDetection';
import {
  GCLID_CAPTURED_AT_LANDING,
  GBRAID_CAPTURED_AT_LANDING,
  WBRAID_CAPTURED_AT_LANDING,
  FBCLID_CAPTURED_AT_LANDING,
  TTCLID_CAPTURED_AT_LANDING,
  LI_FAT_ID_CAPTURED_AT_LANDING,
  MSCLKID_CAPTURED_AT_LANDING,
  OPPREF_CAPTURED_AT_LANDING,
  LANDING_REDIRECT_PRESERVES_QUERY_STRING,
} from '@/services/validation/register/L2';
import { computeAttributionChain, type AttributionChainResult, type ChainLinkObservation, type AttributionChainScope } from './chainModel';

/**
 * Only the platforms L2 gives a synthetic click-id capture rule for.
 * Reddit and Pinterest have tag detection (platformTagDetected) but no
 * dedicated click-id param in this register, so they can't contribute a
 * persistence verdict — a prospect running only Reddit/Pinterest ads falls
 * through to whatever other platform(s) are detected, or to
 * 'no_paid_traffic' if none are.
 */
const PLATFORM_CLICK_ID_RULES: Partial<Record<DeclaredPlatform, ValidationRule[]>> = {
  google_ads: [GCLID_CAPTURED_AT_LANDING, GBRAID_CAPTURED_AT_LANDING, WBRAID_CAPTURED_AT_LANDING],
  meta: [FBCLID_CAPTURED_AT_LANDING],
  tiktok: [TTCLID_CAPTURED_AT_LANDING],
  linkedin: [LI_FAT_ID_CAPTURED_AT_LANDING],
  microsoft: [MSCLKID_CAPTURED_AT_LANDING],
  openai: [OPPREF_CAPTURED_AT_LANDING],
};

const CLICK_ID_CAPABLE_PLATFORMS = ALL_DECLARED_PLATFORMS.filter(
  (p): p is keyof typeof PLATFORM_CLICK_ID_RULES => p in PLATFORM_CLICK_ID_RULES,
);

/** Platforms whose own tag genuinely fired during this crawl — real, unprompted evidence, never derived from Atlas's own synthetic click-id injection. */
export function detectRealAdPlatforms(auditData: AuditData): DeclaredPlatform[] {
  return CLICK_ID_CAPABLE_PLATFORMS.filter((p) => platformTagDetected(p, auditData));
}

function derivePersistenceObservation(auditData: AuditData, detectedPlatforms: DeclaredPlatform[]): ChainLinkObservation {
  const failing: string[] = [];
  for (const platform of detectedPlatforms) {
    const rules = PLATFORM_CLICK_ID_RULES[platform] ?? [];
    const results = rules.map((r) => r.test(auditData));
    const anyPassed = results.some((r) => r.status === 'pass');
    const anyTested = results.some((r) => r.status !== 'skipped');
    if (anyTested && !anyPassed) failing.push(platform);
  }
  if (failing.length > 0) {
    return {
      verdict: 'FAIL',
      evidence: `The click id for ${failing.join(', ')} reached the landing page but was never read into storage, a cookie, or the dataLayer.`,
    };
  }
  return {
    verdict: 'PASS',
    evidence: `The click id for ${detectedPlatforms.join(', ')} was read into storage, a cookie, or the dataLayer.`,
  };
}

function deriveArrivalObservation(auditData: AuditData): ChainLinkObservation {
  const result = LANDING_REDIRECT_PRESERVES_QUERY_STRING.test(auditData);
  if (result.status === 'skipped') {
    return { verdict: 'NOT_OBSERVED', evidence: 'No final landing URL was captured for this run.' };
  }
  return {
    verdict: result.status === 'pass' ? 'PASS' : 'FAIL',
    evidence: result.technical_details.evidence.join(' '),
  };
}

export function deriveAttributionChain(
  auditData: AuditData,
  scope: AttributionChainScope = 'pre_connection',
): AttributionChainResult {
  const detectedPlatforms = detectRealAdPlatforms(auditData);

  if (detectedPlatforms.length === 0) {
    return computeAttributionChain({
      scope,
      not_observed_reason: 'no_paid_traffic',
      arrival: { verdict: 'NOT_OBSERVED' },
      persistence: { verdict: 'NOT_OBSERVED' },
      form_carriage: { verdict: 'NOT_OBSERVED' },
    });
  }

  const formObservation = auditData.attribution_form_carriage;
  const formReachable = !!formObservation && formObservation.verdict !== 'NOT_OBSERVED';

  if (!formReachable) {
    return computeAttributionChain({
      scope,
      not_observed_reason: 'no_conversion_surface',
      arrival: { verdict: 'NOT_OBSERVED' },
      persistence: { verdict: 'NOT_OBSERVED' },
      form_carriage: { verdict: 'NOT_OBSERVED' },
    });
  }

  return computeAttributionChain({
    scope,
    arrival: deriveArrivalObservation(auditData),
    persistence: derivePersistenceObservation(auditData, detectedPlatforms),
    form_carriage: { verdict: formObservation.verdict, evidence: formObservation.evidence },
  });
}
