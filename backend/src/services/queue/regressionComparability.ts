/**
 * Whether two scheduled-audit runs' scores are safe to compare for
 * regression detection — Site Evaluation Coverage & Honesty PRD §6.7/§9.
 *
 * Three conditions all have to hold:
 *  - Same rule_set_version: different versions mean the denominator itself
 *    changed between runs, so a score drop reflects the engine change, not
 *    a real tracking regression.
 *  - Same coverage_fingerprint: a different set of pages examined means
 *    the comparison isn't apples-to-apples either — most importantly, once
 *    Phase 2 page discovery starts finding real checkout/confirmation
 *    pages that used to be scored as the homepage, coverage rising would
 *    otherwise read as a false regression across the whole estate.
 *  - Compatible register_version (Report Correctness Programme PRD Part
 *    D4) — even within 'v2', a rule addition, removal, or severity-weight
 *    change moves the denominator the same way a rule_set_version bump
 *    would; a schedule that flags every client as "regressed" the day a
 *    register release ships would be exactly the false-alarm-across-the-
 *    estate failure coverage_fingerprint already exists to prevent.
 *    Unlike rule_set_version/coverage_fingerprint — always populated by any
 *    real run — register_version is a newer field, so a run predating it
 *    (the entire estate's history before this shipped) has it unset; that
 *    absence is compatible with anything rather than blocking, so rolling
 *    this field out doesn't retroactively silence every existing schedule's
 *    regression detection. Only a run-to-run difference where BOTH sides
 *    actually recorded a version, and they disagree, blocks comparison.
 *
 * rule_set_version/coverage_fingerprint being unset on either run (a run
 * whose step_coverage was never captured, or a v1-legacy run) is treated
 * as "not comparable," same as a real mismatch — never assume
 * comparability on missing data for those two foundational fields.
 *
 * Kept in its own zero-dependency module rather than inline in worker.ts:
 * worker.ts registers Bull queue processors (real Redis connections) as
 * import-time side effects, so importing it from a test would attempt to
 * connect to Redis. This one conditional needs none of that.
 */
import type { RuleSetVersion } from '@/types/audit';

export interface ComparabilityFields {
  rule_set_version?: RuleSetVersion | null;
  coverage_fingerprint?: string | null;
  register_version?: string | null;
}

function bothSet<T>(a: T | null | undefined, b: T | null | undefined): boolean {
  return !!a && !!b && a === b;
}

/** Compatible when either side never recorded one (no signal to block on), or both recorded the identical version. Blocks only on a positive, recorded difference. */
function registerVersionCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return a === b;
}

export function isRegressionComparable(previous: ComparabilityFields, current: ComparabilityFields): boolean {
  return (
    bothSet(previous.rule_set_version, current.rule_set_version) &&
    bothSet(previous.coverage_fingerprint, current.coverage_fingerprint) &&
    registerVersionCompatible(previous.register_version, current.register_version)
  );
}
