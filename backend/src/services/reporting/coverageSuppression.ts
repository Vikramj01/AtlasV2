/**
 * Coverage suppression (Signal Health Report: Evidence Integrity &
 * Presentation PRD §5/§6 W3 — the product decision that resolves the
 * earlier sprint plan's open Sprint 6 question as "suppress, do not
 * annotate").
 *
 * A rule result whose evidence names a journey step that resolved to
 * StepCoverage.source === 'fallback_landing' isn't a real finding about
 * that step — the crawl substituted the landing page, so the result is
 * evidence about the landing page mislabeled with the step's name (e.g.
 * "2 JavaScript error(s) on the conversion surface ("onboarding")" when
 * "onboarding" was never actually reached). Per the PRD, such results are
 * pulled out of the assessable set entirely — excluded from scores, issue
 * counts, and journey/platform breakdowns — and listed separately.
 *
 * Detection reuses the register's own consistent convention for citing a
 * step by name: every rule that does this (L5.ts/L6.ts/L12.ts's
 * completionStep() call sites) wraps the step name in double quotes, e.g.
 * `("${completion}")`. Matching on that convention generically — rather
 * than hardcoding which rule_ids cite steps — means a future rule that
 * follows the same convention is covered without this module changing.
 */
import type { AuditData, StepCoverage, UnassessableFinding, ValidationResult } from '@/types/audit';

function fallbackStepNames(stepCoverage: StepCoverage[] | undefined): Set<string> {
  return new Set((stepCoverage ?? []).filter((s) => s.source === 'fallback_landing').map((s) => s.step));
}

/** Every double-quoted substring in a result's narrative text. */
function quotedTokens(result: ValidationResult): string[] {
  const text = [result.technical_details.found, ...result.technical_details.evidence].join('\n');
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

export interface CoveragePartition {
  assessable: ValidationResult[];
  unassessable: UnassessableFinding[];
}

export function partitionCoverageAffected(
  results: ValidationResult[],
  stepCoverage: AuditData['step_coverage'],
): CoveragePartition {
  const fallbackSteps = fallbackStepNames(stepCoverage);
  if (fallbackSteps.size === 0) return { assessable: results, unassessable: [] };

  const assessable: ValidationResult[] = [];
  const unassessable: UnassessableFinding[] = [];

  for (const r of results) {
    // Skipped results already opted out of scoring/counts through the
    // normal 'skipped' path — re-flagging one here would double-label it.
    const citedStep = r.status === 'skipped' ? undefined : quotedTokens(r).find((t) => fallbackSteps.has(t));
    if (citedStep) {
      unassessable.push({
        rule_id: r.rule_id,
        step: citedStep,
        reason: `The scan could not reach "${citedStep}" and used the landing page instead, so this result isn't evidence about that step.`,
      });
    } else {
      assessable.push(r);
    }
  }

  return { assessable, unassessable };
}
