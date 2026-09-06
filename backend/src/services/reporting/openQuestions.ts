/**
 * Builds ReportJSON.open_questions (Report Honesty PRD Part B) — the
 * configurations whose intent only the client can answer, printed as
 * questions rather than caveated as findings: a second GTM container could
 * be a live migration, an undeclared tag could be a channel ViMi wasn't
 * told about. Two sources feed the list:
 *
 *  1. Every fail/warning result whose rule carries `client_question` (the
 *     8 rules named in the PRD) — collected by
 *     interpretation/engine.ts's collectClientQuestions(), which already
 *     has the REGISTER lookup + v2-result disambiguation this needs.
 *  2. The bespoke unverified-conversion-surface question (PRD §B2/W5) —
 *     "that one is the upsell disguised as a caveat" — emitted whenever the
 *     step CONVERSION_SURFACE_IDENTIFIED (L0.3) credits as the conversion
 *     surface was only found via a path guess (StepUrlSource 'heuristic'),
 *     not a user-supplied URL or a link the crawl actually discovered. This
 *     needs auditData directly (step_coverage), not just results, so it's
 *     built here rather than folded into collectClientQuestions().
 *
 * Returns undefined (not an empty array) when there's nothing to ask — the
 * report section is omitted entirely rather than rendering an empty
 * heading, per PRD §B3.
 */
import type { AuditData, ValidationResult } from '@/types/audit';
import { collectClientQuestions } from '@/services/interpretation/engine';

const UNVERIFIED_CONVERSION_SURFACE_QUESTION =
  'We could not confirm your order confirmation page, so checks that depend on it are inconclusive. Can you supply its URL, or a test-order route we can use?';

/** Whether the conversion surface this run reached was only found via a path guess — see the module docstring's W5. */
function conversionSurfaceIsUnverified(auditData: AuditData): boolean {
  const stepCoverage = auditData.step_coverage;
  if (!stepCoverage || stepCoverage.length === 0) return false;

  const qualifying = stepCoverage.filter((s) => s.distinct_from_landing && s.navigation_success);
  return qualifying.some((s) => s.source === 'heuristic');
}

export function buildOpenQuestions(auditData: AuditData, results: ValidationResult[]): string[] | undefined {
  const questions = collectClientQuestions(results);

  if (conversionSurfaceIsUnverified(auditData)) {
    questions.push(UNVERIFIED_CONVERSION_SURFACE_QUESTION);
  }

  return questions.length > 0 ? questions : undefined;
}
