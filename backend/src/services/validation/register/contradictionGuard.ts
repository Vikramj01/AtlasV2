/**
 * Register-level contradiction guard (Click-ID Contention, Contradiction
 * Guard & Settle Enforcement PRD W2 — rewritten; originally Report
 * Correctness Programme PRD Part A3).
 *
 * A minimum, mechanically-checkable list of result pairs that can never
 * both be true: a platform's own linker cookie can only be populated by
 * capturing the click ID it stores, so a passing linker-cookie rule and a
 * failing capture rule for *that specific identifier* describe the same
 * browser state two contradictory ways.
 *
 * W2 fixed two defects in the original guard:
 *
 *  1. Wrong comparison — it used to pair every click-ID capture rule
 *     against the aggregate CLICK_ID_WRITTEN_TO_DURABLE_STORAGE, whose own
 *     rationale is circular: that rule only evaluates identifiers it saw
 *     captured in the first place, so it trivially "passes" whenever
 *     nothing was captured to begin with (nothing to find written to
 *     sessionStorage-only). It fired on every partial capture — exactly
 *     the reference audit's situation, five times over. Fixed by pairing
 *     each click ID against its *own* platform's linker artefact instead:
 *     gclid/gbraid/wbraid against GCL_AW_COOKIE_PRESENT (_gcl_aw can only
 *     be populated by resolving one of the three), fbclid against the
 *     _fbc component specifically of FBP_AND_FBC_COOKIES_PRESENT (_fbp is
 *     set unconditionally by the Pixel and proves nothing about fbclid
 *     capture — only _fbc, which is only ever populated from a real
 *     fbclid, does). No aggregate pairing exists for ttclid/msclkid/
 *     li_fat_id — omitted rather than inventing one.
 *
 *  2. Wrong destination — a fired guard used to append a visible
 *     "⚠ CONTRADICTION:" evidence line onto the still-failing result,
 *     shipping to the client report as evidence *against* the same
 *     finding it was published under. A pre-publication gate suppresses;
 *     it doesn't annotate. partitionContradictions() below routes a fired
 *     result to could_not_be_assessed instead — the same "suppress, don't
 *     annotate" shape coverageSuppression.ts/degradationSuppression.ts
 *     already use — so callers get an assessable/unassessable split, not
 *     a decorated result.
 */
import type { UnassessableFinding, ValidationResult } from '@/types/audit';
import logger from '@/utils/logger';

export interface CaptureContradiction {
  /** The rule whose FAIL is contradicted by the other rule's evidence. */
  rule_id: string;
  /** The rule that contradicts it. */
  contradicted_by_rule_id: string;
  message: string;
}

interface ContradictionSpec {
  /** One or more rule_ids whose FAIL is contradicted — checked individually, not jointly. */
  failing: string[];
  /** The rule_id whose result is checked for the contradicting fact. */
  passing: string;
  /**
   * Whether `passing`'s result establishes the fact that rules out
   * `failing`'s FAIL. Defaults to "the rule's overall status is 'pass'" —
   * override when the contradicting fact is narrower than the rule's
   * overall verdict (e.g. FBP_AND_FBC_COOKIES_PRESENT's overall status is
   * driven by _fbp alone since W4.1, but the fact that contradicts a
   * failed fbclid capture is specifically "_fbc is present").
   */
  contradictingFact?: (result: ValidationResult) => boolean;
  explain: (failedRuleId: string) => string;
}

const CONTRADICTION_SPECS: ContradictionSpec[] = [
  {
    failing: ['GCLID_CAPTURED_AT_LANDING', 'GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING'],
    passing: 'GCL_AW_COOKIE_PRESENT',
    explain: (failedRuleId) =>
      `${failedRuleId} failed while GCL_AW_COOKIE_PRESENT passed — _gcl_aw can only be populated by resolving one of `
      + 'gclid/gbraid/wbraid (Google\'s own conversion linker writes it); a populated _gcl_aw and a failed capture for '
      + 'one of that same family describe the same browser state two contradictory ways.',
  },
  {
    failing: ['FBCLID_CAPTURED_AT_LANDING'],
    passing: 'FBP_AND_FBC_COOKIES_PRESENT',
    // _fbp is set unconditionally by the Meta Pixel and proves nothing
    // about fbclid capture — only _fbc (populated exclusively from a real
    // fbclid) does, so this checks that specific evidence line rather than
    // the rule's overall status (which, since W4.1, is _fbp-driven and
    // would false-fire here on every run where the Pixel merely loads).
    contradictingFact: (result) => result.technical_details.evidence.includes('_fbc present: true'),
    explain: () =>
      'FBCLID_CAPTURED_AT_LANDING failed while _fbc is present — _fbc stores the fbclid it captured '
      + '(fb.1.<timestamp>.<fbclid>) and is only ever populated from a real click ID, unlike _fbp which the Pixel '
      + 'sets unconditionally; a populated _fbc and a failed fbclid capture describe the same browser state two '
      + 'contradictory ways.',
  },
];

/** Pure detection — every (rule_id, contradicting rule) pair in `results` that is logically impossible together. */
export function detectCaptureContradictions(results: ValidationResult[]): CaptureContradiction[] {
  const byRuleId = new Map(results.map((r) => [r.rule_id, r]));
  const contradictions: CaptureContradiction[] = [];

  for (const spec of CONTRADICTION_SPECS) {
    const passingResult = byRuleId.get(spec.passing);
    if (!passingResult) continue;
    const contradictingFactHolds = spec.contradictingFact
      ? spec.contradictingFact(passingResult)
      : passingResult.status === 'pass';
    if (!contradictingFactHolds) continue;

    for (const failingRuleId of spec.failing) {
      const failingResult = byRuleId.get(failingRuleId);
      if (failingResult?.status !== 'fail') continue;
      contradictions.push({
        rule_id: failingRuleId,
        contradicted_by_rule_id: spec.passing,
        message: spec.explain(failingRuleId),
      });
    }
  }

  return contradictions;
}

export interface ContradictionPartition {
  assessable: ValidationResult[];
  unassessable: UnassessableFinding[];
}

/**
 * Applies detectCaptureContradictions() and routes every fired result to
 * could_not_be_assessed rather than leaving it standing as a confident
 * CRITICAL fail with a contradiction annotated inside it (W2.2 — "must
 * suppress the finding... never render inside the finding as evidence
 * against that finding"). Called once from the audit pipeline
 * (orchestrator.ts), after click-ID contention (clickIdContention.ts) has
 * already removed the contention-explained fails — this guard is the
 * safety net for whatever's left, not a duplicate of it.
 */
export function partitionContradictions(results: ValidationResult[]): ContradictionPartition {
  const contradictions = detectCaptureContradictions(results);
  if (contradictions.length === 0) return { assessable: results, unassessable: [] };

  logger.warn(
    { contradictions },
    'Check Register contradiction guard fired — routing to could_not_be_assessed rather than shipping a self-contradicting finding',
  );

  const byRuleId = new Map(contradictions.map((c) => [c.rule_id, c]));
  const assessable: ValidationResult[] = [];
  const unassessable: UnassessableFinding[] = [];

  for (const r of results) {
    const contradiction = byRuleId.get(r.rule_id);
    if (!contradiction) {
      assessable.push(r);
      continue;
    }
    unassessable.push({
      rule_id: r.rule_id,
      step: 'landing',
      reason: contradiction.message,
    });
  }

  return { assessable, unassessable };
}
