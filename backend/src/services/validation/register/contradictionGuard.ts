/**
 * Register-level contradiction guard (Report Correctness Programme PRD Part
 * A3) — a minimum, mechanically-checkable list of result pairs that can
 * never both be true. Birkenstock audit 13795830 reported all 5 click-ID
 * rules FAIL/CRITICAL while GCL_AW_COOKIE_PRESENT, FBP_AND_FBC_COOKIES_PRESENT
 * and CLICK_ID_WRITTEN_TO_DURABLE_STORAGE all PASSED on the same run — a
 * _gcl_aw/_fbc cookie can only be populated by capturing the click ID it
 * stores, so a passing durability rule and a failing capture rule for the
 * same identifier describe the same browser state two contradictory ways.
 * Part A2's delimited-match tier (L2.ts's checkParamCapture) fixes this at
 * the source; this guard is the safety net for the next rule that gets it
 * wrong, or for any future contradiction pair added to CONTRADICTION_SPECS.
 *
 * Deliberately narrow: this is not a general "these rules should usually
 * agree" heuristic (many rule pairs correlate without being logically
 * exclusive) — every entry below is a pair that is IMPOSSIBLE together, not
 * just unlikely.
 */
import type { ValidationResult } from '@/types/audit';

export interface CaptureContradiction {
  /** The rule whose FAIL is contradicted by the other rule's PASS. */
  rule_id: string;
  /** The passing rule that contradicts it. */
  contradicted_by_rule_id: string;
  message: string;
}

interface ContradictionSpec {
  /** One or more rule_ids whose FAIL is contradicted — checked individually, not jointly. */
  failing: string[];
  /** The rule_id whose PASS makes each of `failing`'s FAIL impossible. */
  passing: string;
  explain: (failedRuleId: string) => string;
}

/** L2.1-2.7 — every per-platform click ID capture rule (see L2.ts's makeClickIdCaptureRule). */
const CLICK_ID_CAPTURE_RULE_IDS = [
  'GCLID_CAPTURED_AT_LANDING', 'GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING',
  'FBCLID_CAPTURED_AT_LANDING', 'TTCLID_CAPTURED_AT_LANDING', 'LI_FAT_ID_CAPTURED_AT_LANDING',
  'MSCLKID_CAPTURED_AT_LANDING',
];

const CONTRADICTION_SPECS: ContradictionSpec[] = [
  {
    failing: ['GCLID_CAPTURED_AT_LANDING'],
    passing: 'GCL_AW_COOKIE_PRESENT',
    explain: () =>
      'GCLID_CAPTURED_AT_LANDING failed while GCL_AW_COOKIE_PRESENT passed — _gcl_aw stores the gclid it captured '
      + '(GCL.<timestamp>.<gclid>); a populated _gcl_aw and a failed gclid capture describe the same browser state '
      + 'two contradictory ways.',
  },
  {
    failing: ['FBCLID_CAPTURED_AT_LANDING'],
    passing: 'FBP_AND_FBC_COOKIES_PRESENT',
    explain: () =>
      'FBCLID_CAPTURED_AT_LANDING failed while FBP_AND_FBC_COOKIES_PRESENT passed — _fbc stores the fbclid it '
      + 'captured (fb.1.<timestamp>.<fbclid>); a populated _fbc and a failed fbclid capture describe the same '
      + 'browser state two contradictory ways.',
  },
  {
    failing: CLICK_ID_CAPTURE_RULE_IDS,
    passing: 'CLICK_ID_WRITTEN_TO_DURABLE_STORAGE',
    explain: (failedRuleId) =>
      `${failedRuleId} failed while CLICK_ID_WRITTEN_TO_DURABLE_STORAGE passed — that rule only evaluates `
      + 'identifiers it saw captured in the first place, so it cannot pass for a click ID this result says was '
      + 'never captured.',
  },
];

/** Pure detection — every (rule_id, passing rule) pair in `results` that is logically impossible together. */
export function detectCaptureContradictions(results: ValidationResult[]): CaptureContradiction[] {
  const byRuleId = new Map(results.map((r) => [r.rule_id, r]));
  const contradictions: CaptureContradiction[] = [];

  for (const spec of CONTRADICTION_SPECS) {
    const passingResult = byRuleId.get(spec.passing);
    if (passingResult?.status !== 'pass') continue;

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

/**
 * Applies detectCaptureContradictions() to `results`, appending a visible
 * evidence line to each contradicted FAIL result — surfaced anywhere that
 * result's evidence renders (technical appendix, PDF action items), so a
 * reviewer sees the contradiction without separate tooling. Called once
 * from runRegister() (engine.ts); returns a new array — never mutates the
 * input results or their technical_details in place.
 */
export function flagCaptureContradictions(results: ValidationResult[]): ValidationResult[] {
  const contradictions = detectCaptureContradictions(results);
  if (contradictions.length === 0) return results;

  const byRuleId = new Map(contradictions.map((c) => [c.rule_id, c]));
  return results.map((r) => {
    const contradiction = byRuleId.get(r.rule_id);
    if (!contradiction) return r;
    return {
      ...r,
      technical_details: {
        ...r.technical_details,
        evidence: [...r.technical_details.evidence, `⚠ CONTRADICTION: ${contradiction.message}`],
      },
    };
  });
}
