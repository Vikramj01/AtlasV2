/**
 * Evaluates the C.5a rules over one event's pre-resolved signals and derives the verdict
 * (GA4 Admin / L11 / Junk Gate PRD §C.5): any hard hit = junk; `suspect_soft_hits` or more soft
 * hits = suspect; otherwise clean. Thresholds and per-rule enables come from the client's config.
 * Pure and synchronous.
 */
import {
  ruleEmailMalformed, ruleEmailDisposable, rulePhoneInvalid, ruleDuplicateSubmission,
  ruleSubmitVelocity, ruleNonHumanUa, ruleTestValues,
} from './rules';
import type { JunkRuleId, JunkRuleInput, JunkThresholds, JunkVerdict, RuleHit, RuleResult, JunkGateConfig } from './types';

type RuleFn = (input: JunkRuleInput, thresholds: JunkThresholds) => RuleResult;

const RULES: Array<[JunkRuleId, RuleFn]> = [
  ['JC_EMAIL_MALFORMED', (i) => ruleEmailMalformed(i)],
  ['JC_EMAIL_DISPOSABLE', (i) => ruleEmailDisposable(i)],
  ['JC_PHONE_INVALID', (i) => rulePhoneInvalid(i)],
  ['JC_DUPLICATE_SUBMISSION', (i, t) => ruleDuplicateSubmission(i, t)],
  ['JC_SUBMIT_VELOCITY', (i, t) => ruleSubmitVelocity(i, t)],
  ['JC_NON_HUMAN_UA', (i) => ruleNonHumanUa(i)],
  ['JC_TEST_VALUES', (i) => ruleTestValues(i)],
];

export interface JunkEvaluation {
  verdict: JunkVerdict;
  hits: RuleHit[];
}

export function deriveVerdict(hits: RuleHit[], thresholds: Pick<JunkThresholds, 'suspect_soft_hits'>): JunkVerdict {
  if (hits.some((h) => h.class === 'hard')) return 'junk';
  if (hits.filter((h) => h.class === 'soft').length >= thresholds.suspect_soft_hits) return 'suspect';
  return 'clean';
}

export function evaluateJunkRules(
  input: JunkRuleInput,
  config: Pick<JunkGateConfig, 'rule_flags' | 'thresholds'>,
): JunkEvaluation {
  const hits: RuleHit[] = [];
  for (const [rule_id, fn] of RULES) {
    if (config.rule_flags[rule_id] === false) continue;
    const r = fn(input, config.thresholds);
    if (r.hit) hits.push({ rule_id, class: r.class, evidence: r.evidence });
  }
  return { verdict: deriveVerdict(hits, config.thresholds), hits };
}
