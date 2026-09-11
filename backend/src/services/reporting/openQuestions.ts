/**
 * Builds ReportJSON.open_questions (Report Honesty PRD Part B; extended by
 * Pre-Connection Scan Confidence Tiering PRD §11.3) — the configurations
 * whose intent only the client can answer, printed as questions rather
 * than caveated as findings: a second GTM container could be a live
 * migration, an undeclared tag could be a channel ViMi wasn't told about.
 * Three sources feed the list:
 *
 *  1. Every fail/warning result whose rule carries `client_question` —
 *     collected by interpretation/engine.ts's collectClientQuestions(),
 *     which already has the REGISTER lookup + v2-result disambiguation
 *     this needs. This is also how a non-CLIENT_CONFIRMED DERIVED finding
 *     (PRD §11.3, PRD §8 — DECLARED_PLATFORM_HAS_TAG capped by
 *     declaration_source) surfaces: its status is already 'fail', so it
 *     reaches this path; its own client_question opts out (`''`) unless
 *     `severity_capped_from` is actually set.
 *  2. The bespoke unverified-conversion-surface question (PRD §B2/W5) —
 *     "that one is the upsell disguised as a caveat" — emitted whenever the
 *     step CONVERSION_SURFACE_IDENTIFIED (L0.3) credits as the conversion
 *     surface was only found via a path guess (StepUrlSource 'heuristic'),
 *     not a user-supplied URL or a link the crawl actually discovered. This
 *     needs auditData directly (step_coverage), not just results, so it's
 *     built here rather than folded into collectClientQuestions().
 *  3. One question per CONFLICT-kind could_not_be_assessed entry (PRD
 *     §11.3's "CONFLICT verdicts") — two independent detectors disagreeing
 *     about the same entity is, by construction, something only the
 *     client can resolve. Built directly from the finding's own `reason`
 *     text (already written as client-facing prose by
 *     signalConsistency.ts/clickIdContention.ts).
 *
 * PRD §11.3 also names `NOT_OBSERVED`/`INCONCLUSIVE` verdicts generally.
 * Deliberately **not** wired as a blanket "every such result asks a
 * question" rule:
 *  - A `NOT_OBSERVED`-kind could_not_be_assessed entry (from
 *    coverageSuppression.ts/degradationSuppression.ts) is a crawl
 *    limitation — the client can't tell Atlas why *our* scan didn't settle
 *    a step, so asking them isn't the right shape of question, and it's
 *    already disclosed once, generically, via the report's own "Limited
 *    scan coverage"/"Insufficient run quality" banners. Asking one
 *    per-rule question for every coverage-suppressed result (there can be
 *    dozens on a degraded run) would bury the genuinely client-answerable
 *    questions in noise.
 *  - A rule's own `INCONCLUSIVE` (precondition-skip) result stays in
 *    `results`/`technical_appendix`, never `could_not_be_assessed` — and
 *    as of this register, every rule that both declares `requires:
 *    ['conversion_surface']` and a `client_question`
 *    (`EVENT_NAMES_MATCH_DECLARED_TAXONOMY`) writes that question assuming
 *    it actually ran and found evidence; invoking it on a skip's
 *    placeholder evidence would render nonsense ("Some observed event
 *    names don't match..." when nothing was observed at all). The root
 *    cause — conversion surface not reached — is already covered once by
 *    `CONVERSION_SURFACE_IDENTIFIED`'s own `client_question` and the
 *    unverified-conversion-surface question below, without a
 *    per-downstream-rule repeat. Revisit if a future rule needs this and
 *    can supply a skip-safe question.
 *
 * Returns undefined (not an empty array) when there's nothing to ask — the
 * report section is omitted entirely rather than rendering an empty
 * heading, per PRD §B3.
 */
import type { AuditData, UnassessableFinding, ValidationResult } from '@/types/audit';
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

/** One question per CONFLICT-kind finding — see the module docstring's item 3. */
function conflictQuestions(unassessable: UnassessableFinding[]): string[] {
  return unassessable
    .filter((f) => f.kind === 'CONFLICT')
    .map((f) => `Our signals disagree on something we can't resolve on our own: ${f.reason} Can you tell us which reading is accurate?`);
}

export function buildOpenQuestions(
  auditData: AuditData,
  results: ValidationResult[],
  unassessable: UnassessableFinding[] = [],
): string[] | undefined {
  const questions = collectClientQuestions(results);

  if (conversionSurfaceIsUnverified(auditData)) {
    questions.push(UNVERIFIED_CONVERSION_SURFACE_QUESTION);
  }

  questions.push(...conflictQuestions(unassessable));

  return questions.length > 0 ? questions : undefined;
}
