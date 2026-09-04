/**
 * Whether two scheduled-audit runs' scores are safe to compare for
 * regression detection — Site Evaluation Coverage & Honesty PRD §6.7/§9.
 *
 * Two conditions both have to hold:
 *  - Same rule_set_version: different versions mean the denominator itself
 *    changed between runs, so a score drop reflects the engine change, not
 *    a real tracking regression.
 *  - Same coverage_fingerprint: a different set of pages examined means
 *    the comparison isn't apples-to-apples either — most importantly, once
 *    Phase 2 page discovery starts finding real checkout/confirmation
 *    pages that used to be scored as the homepage, coverage rising would
 *    otherwise read as a false regression across the whole estate.
 *
 * Either value being unset on either run (the pre-this-field baseline, a
 * run whose step_coverage was never captured, or a v1-legacy run that
 * never populated one) is treated as "not comparable," same as a real
 * mismatch — never assume comparability on missing data.
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
}

function bothSet<T>(a: T | null | undefined, b: T | null | undefined): boolean {
  return !!a && !!b && a === b;
}

export function isRegressionComparable(previous: ComparabilityFields, current: ComparabilityFields): boolean {
  return (
    bothSet(previous.rule_set_version, current.rule_set_version) &&
    bothSet(previous.coverage_fingerprint, current.coverage_fingerprint)
  );
}
