/**
 * Automatic re-scan confirmation (Pre-Connection Scan Confidence Tiering
 * PRD §15) — one of the two write paths into rule_confirmations. When a
 * rule failed on the immediately-previous scan for the same site and
 * passes on this one, that's the automatic, defensible signal PRD §15
 * describes: "a re-scan after remediation... marking the original finding
 * CONFIRMED" — the original absence claim correctly identified a real gap
 * that's since been fixed.
 *
 * Deliberately one-directional. A rule that failed before and still fails
 * now confirms/refutes nothing new (no action was taken to test the
 * claim). A rule that passed before and fails now is a regression, not a
 * confirmation of a *prior* finding — Sprint 1/5's own regression-alert
 * mechanism already covers that separately. And REFUTED is deliberately
 * never auto-written here: telling a real site change (remediation) apart
 * from "the site never changed and the original rule was simply wrong"
 * needs a human to say nothing changed, which only the client_answer/
 * operator write path (an explicit person saying so) can establish —
 * inferring it from two scan results alone would be guessing.
 */
import type { SaveRuleConfirmationInput } from '@/services/database/ruleConfirmationQueries';
import type { ValidationResult, Verdict } from '@/types/audit';

/**
 * A result's pass/fail direction for this comparison, preferring `verdict`
 * (coverage-aware — NOT_OBSERVED/INCONCLUSIVE/CONFLICT correctly don't
 * count as either) over raw `status` when present, falling back to status
 * for a v1-legacy or pre-Sprint-2 result — same fallback pattern
 * scoring.ts's isScorable() uses.
 */
function ruleDirection(r: ValidationResult): 'FAIL' | 'PASS' | 'OTHER' {
  if (r.verdict !== undefined) {
    const verdict: Verdict = r.verdict;
    if (verdict === 'FAIL') return 'FAIL';
    if (verdict === 'PASS') return 'PASS';
    return 'OTHER';
  }
  if (r.status === 'fail') return 'FAIL';
  if (r.status === 'pass') return 'PASS';
  return 'OTHER';
}

export interface PreviousAuditResults {
  audit_id: string;
  created_at: string;
  results: ValidationResult[];
}

export function detectRescanConfirmations(
  currentAuditId: string,
  currentResults: ValidationResult[],
  previous: PreviousAuditResults,
): SaveRuleConfirmationInput[] {
  const previousByRule = new Map(previous.results.map((r) => [r.rule_id, r]));
  const confirmations: SaveRuleConfirmationInput[] = [];
  const priorDate = new Date(previous.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  for (const current of currentResults) {
    const prior = previousByRule.get(current.rule_id);
    if (!prior) continue;
    if (ruleDirection(prior) !== 'FAIL') continue;
    if (ruleDirection(current) !== 'PASS') continue;

    confirmations.push({
      audit_id: currentAuditId,
      rule_id: current.rule_id,
      outcome: 'CONFIRMED',
      source: 'rescan',
      note: `Failed on the previous scan for this site (${priorDate}, audit ${previous.audit_id}) and passed on this one — the original finding correctly identified a real gap that's since been addressed.`,
    });
  }

  return confirmations;
}
