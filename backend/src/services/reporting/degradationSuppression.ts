/**
 * Degradation suppression (Platform Attribution & Determinism PRD Part B,
 * B-W4 — "separate absence from failure"; widened by the Report Correctness
 * Programme PRD Part C3 — "unsettled steps are all-or-nothing").
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
 * annotate" pattern: a run where any step degraded (StepCoverage.degraded
 * — settle hit its cap, navigation failed outright, or a declared waitFor
 * timed out) has affected results pulled into could_not_be_assessed rather
 * than left standing as a confident pass or fail. Adding a genuine
 * 'inconclusive' RuleStatus would touch scoring.ts's scored()/
 * layerCoverage(), reporting.ts's worstStatus, and the frontend's separate
 * RuleStatus mirror — exactly the "disturbing scoring" the PRD says to
 * avoid; routing through the existing could_not_be_assessed section
 * (already has the right semantics) does not.
 *
 * Three independent ways a result is judged "affected" by a degraded step,
 * per PRD C3's "a step that did not settle contributes no findings — route
 * every rule depending on it" (widened by the Click-ID Contention,
 * Contradiction Guard & Settle Enforcement PRD W3 — see point 2 below):
 *  1. It cites a degraded step by name, using the same double-quoted
 *     convention coverageSuppression.ts already matches on
 *     (`("${completion}")`) — this is what generalizes the fix to any rule
 *     naming a specific step, present or future, rather than requiring
 *     each one added to a hand-maintained list (the exact "deciding
 *     rule-by-rule... will be wrong repeatedly" failure mode C3 rejects —
 *     this is how CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS (L12.8)
 *     gets caught here without ever being named below).
 *  2. Its own ValidationRule declares `requires: ['conversion_surface']`
 *     (engine.ts's precondition tag — L4-L7's ~30 rules whose evidence is
 *     read off network requests/dataLayer/cookies gathered while reaching
 *     the conversion surface). W3 investigated the reference audit
 *     (7d64f5e9, birkenstock.com/sg, all four steps degraded) and found
 *     this was the actual gap: these rules were never in
 *     ABSENCE_SENSITIVE_RULE_IDS and mostly don't quote a step name
 *     verbatim in evidence, so they ran through unaffected while a
 *     hand-picked set of seven absence-sensitive rules got excluded —
 *     "the symptom suggests [exclusion is keyed to] a per-rule dependency
 *     list that most rules are not registered against." Deriving this
 *     from the rule's own `requires` tag — the same precondition metadata
 *     engine.ts already reads to decide 'skipped' vs. ran — means a rule
 *     added later with `requires: ['conversion_surface']` is covered
 *     automatically, with nothing here to drift.
 *  3. Its rule_id is in ABSENCE_SENSITIVE_RULE_IDS — a small, still-explicit
 *     set kept for rules whose absence-sensitivity is run-wide rather than
 *     tied to a step-level precondition or a named step (e.g. "was this
 *     cookie ever set, anywhere in the run" — nothing in their evidence
 *     names a step, and they don't declare `requires`).
 */
import type { AuditData, StepCoverage, UnassessableFinding, ValidationResult } from '@/types/audit';
import { degradedStepNames } from './coverage';
import { quotedTokens } from './coverageSuppression';
import { REGISTER } from '@/services/validation/register/engine';

const RULE_BY_ID = new Map(REGISTER.map((r) => [r.rule_id, r]));

/**
 * Rules whose pass verdict is really "we observed nothing happen" and
 * whose fail verdict is really "we can't be sure it didn't fire" — i.e.
 * rules that assert a network request or cookie was or wasn't observed,
 * rather than reading declarative config off the page, and whose evidence
 * doesn't name a specific step for the quoted-token check above to catch.
 * Named explicitly in Platform Attribution & Determinism PRD B-W4, plus
 * GA4_CONFIG_TAG_PRESENT (same "was this script tag ever seen loading"
 * shape as the others).
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
  const degradedStepSet = new Set(degradedSteps);
  const stepList = degradedSteps.join(', ');
  const stepNoun = degradedSteps.length === 1 ? 'step' : 'steps';

  for (const r of results) {
    if (r.status === 'skipped') {
      // Already opted out of scoring/counts through the normal 'skipped'
      // path — re-flagging one here would double-label it.
      assessable.push(r);
      continue;
    }

    const citedDegradedStep = quotedTokens(r).find((t) => degradedStepSet.has(t));
    const requiresConversionSurface = RULE_BY_ID.get(r.rule_id)?.requires?.includes('conversion_surface') === true;

    // Pre-Connection Scan Confidence Tiering PRD §4.3 — every path below is
    // "the crawl didn't settle what this result's evidence depends on," a
    // coverage gap rather than a conflict between two signals.
    if (citedDegradedStep) {
      unassessable.push({
        rule_id: r.rule_id,
        step: citedDegradedStep,
        reason: `This scan's navigation didn't fully settle on "${citedDegradedStep}", so this result — which is evidence about that specific step — isn't reliable; its ${r.status} verdict may reflect the scan not waiting long enough, not the site's real behavior.`,
        kind: 'NOT_OBSERVED',
      });
    } else if (requiresConversionSurface) {
      unassessable.push({
        rule_id: r.rule_id,
        step: stepList,
        reason: `This scan's navigation didn't fully settle on ${stepNoun} ${stepList}, so the conversion-surface evidence this check depends on (network requests, dataLayer events, or cookies gathered while reaching it) may not have had time to appear — its ${r.status} verdict isn't reliable.`,
        kind: 'NOT_OBSERVED',
      });
    } else if (ABSENCE_SENSITIVE_RULE_IDS.has(r.rule_id)) {
      unassessable.push({
        rule_id: r.rule_id,
        step: stepList,
        reason: `This scan's navigation didn't fully settle on ${stepNoun} ${stepList}, so a request or cookie this check depends on may not have had time to appear — its ${r.status} verdict isn't reliable.`,
        kind: 'NOT_OBSERVED',
      });
    } else {
      assessable.push(r);
    }
  }

  return { assessable, unassessable };
}
