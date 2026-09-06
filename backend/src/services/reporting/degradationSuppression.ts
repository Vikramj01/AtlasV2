/**
 * Degradation suppression (Platform Attribution & Determinism PRD Part B,
 * B-W4 — "separate absence from failure").
 *
 * Three scans of the same unchanged site produced correlated failures
 * traced to one upstream cause: the TikTok pixel script failed to load, so
 * (a) TIKTOK_CONVERSION_EVENT_FIRES correctly found no conversion event —
 * but for the wrong reason, "the pixel never loaded" rather than "the site
 * doesn't fire one" — and (b) STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW
 * *passed*, because with the pixel never loading it never set its ttclid
 * cookie, so the lifetime rule had nothing to fail on. A "pass" that is
 * really "we never observed it" is the worst class of result this tool can
 * produce.
 *
 * The fix mirrors coverageSuppression.ts's existing "suppress, do not
 * annotate" pattern: for a fixed set of rules whose verdict is really an
 * assertion about whether a request/cookie was observed at all, a run
 * where any step degraded (StepCoverage.degraded — settle hit its cap,
 * navigation failed outright, or a declared waitFor timed out) has its
 * result pulled into could_not_be_assessed rather than left standing as a
 * confident pass or fail. Adding a genuine 'inconclusive' RuleStatus would
 * touch scoring.ts's scored()/layerCoverage(), reporting.ts's worstStatus,
 * and the frontend's separate RuleStatus mirror — exactly the "disturbing
 * scoring" the PRD says to avoid; routing through the existing
 * could_not_be_assessed section (already has the right semantics) does not.
 */
import type { AuditData, StepCoverage, UnassessableFinding, ValidationResult } from '@/types/audit';
import { degradedStepNames } from './coverage';

/**
 * Rules whose pass verdict is really "we observed nothing happen" and
 * whose fail verdict is really "we can't be sure it didn't fire" — i.e.
 * rules that assert a network request or cookie was or wasn't observed,
 * rather than reading declarative config off the page. Named explicitly in
 * Platform Attribution & Determinism PRD B-W4, plus GA4_CONFIG_TAG_PRESENT
 * (same "was this script tag ever seen loading" shape as the others).
 */
const ABSENCE_SENSITIVE_RULE_IDS = new Set([
  'GOOGLE_ADS_CONVERSION_EVENT_FIRES',
  'META_CONVERSION_EVENT_FIRES',
  'TIKTOK_CONVERSION_EVENT_FIRES',
  'GA4_CONVERSION_EVENT_FIRES',
  'GA4_CONFIG_TAG_PRESENT',
  'STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW',
  'REFERRER_PRESERVED_THROUGH_ENTRY',
]);

export function anyStepDegraded(stepCoverage: StepCoverage[] | undefined): boolean {
  return (stepCoverage ?? []).some((s) => s.degraded === true);
}

export interface DegradationPartition {
  assessable: ValidationResult[];
  unassessable: UnassessableFinding[];
}

/**
 * When any step in the run degraded, an absence-sensitive rule's result
 * can't distinguish "genuinely absent" from "the scan didn't wait long
 * enough to see it" — its pass or fail is moved out of every score/count
 * and into could_not_be_assessed. A 'skipped' result is left alone (already
 * opted out through the normal path); this only ever touches results that
 * would otherwise stand as a confident verdict.
 */
export function partitionDegradedRuns(
  results: ValidationResult[],
  stepCoverage: AuditData['step_coverage'],
): DegradationPartition {
  const degradedSteps = degradedStepNames(stepCoverage ?? []);
  if (degradedSteps.length === 0) return { assessable: results, unassessable: [] };

  const assessable: ValidationResult[] = [];
  const unassessable: UnassessableFinding[] = [];
  const stepList = degradedSteps.join(', ');
  const stepNoun = degradedSteps.length === 1 ? 'step' : 'steps';

  for (const r of results) {
    if (r.status !== 'skipped' && ABSENCE_SENSITIVE_RULE_IDS.has(r.rule_id)) {
      unassessable.push({
        rule_id: r.rule_id,
        step: stepList,
        reason: `This scan's navigation didn't fully settle on ${stepNoun} ${stepList}, so a request or cookie this check depends on may not have had time to appear — its ${r.status} verdict isn't reliable.`,
      });
    } else {
      assessable.push(r);
    }
  }

  return { assessable, unassessable };
}
