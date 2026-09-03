/**
 * Whether two scheduled-audit runs' scores are safe to compare for
 * regression detection — Site Evaluation Coverage & Honesty PRD §6.7/§9.
 *
 * Different rule_set_versions mean the denominator itself changed between
 * runs, so a score drop reflects the engine change, not a real tracking
 * regression; either version being unset (the pre-this-field baseline, or
 * a v1-legacy run that never populated it) is treated the same way — never
 * assume comparability on missing data.
 *
 * Kept in its own zero-dependency module rather than inline in worker.ts:
 * worker.ts registers Bull queue processors (real Redis connections) as
 * import-time side effects, so importing it from a test would attempt to
 * connect to Redis. This one conditional needs none of that.
 */
import type { RuleSetVersion } from '@/types/audit';

export function isRegressionComparable(
  previous: RuleSetVersion | null | undefined,
  current: RuleSetVersion | null | undefined,
): boolean {
  return !!previous && !!current && previous === current;
}
