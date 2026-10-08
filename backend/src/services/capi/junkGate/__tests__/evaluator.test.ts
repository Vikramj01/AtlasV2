import { describe, it, expect } from 'vitest';
import { evaluateJunkRules, deriveVerdict } from '../evaluator';
import { DEFAULT_THRESHOLDS, type JunkGateConfig, type RuleHit } from '../types';

const cfg = (over: Partial<Pick<JunkGateConfig, 'rule_flags' | 'thresholds'>> = {}): Pick<JunkGateConfig, 'rule_flags' | 'thresholds'> => ({
  rule_flags: {}, thresholds: DEFAULT_THRESHOLDS, ...over,
});
const hit = (rule_id: RuleHit['rule_id'], cls: RuleHit['class']): RuleHit => ({ rule_id, class: cls, evidence: 'e' });

describe('deriveVerdict (PRD §C.5: any hard = junk; ≥2 soft = suspect; else clean)', () => {
  it('any hard hit is junk, regardless of soft count', () => {
    expect(deriveVerdict([hit('JC_NON_HUMAN_UA', 'hard')], DEFAULT_THRESHOLDS)).toBe('junk');
    expect(deriveVerdict([hit('JC_EMAIL_MALFORMED', 'hard'), hit('JC_TEST_VALUES', 'soft')], DEFAULT_THRESHOLDS)).toBe('junk');
  });
  it('two soft hits are suspect; one is clean', () => {
    expect(deriveVerdict([hit('JC_TEST_VALUES', 'soft'), hit('JC_EMAIL_DISPOSABLE', 'soft')], DEFAULT_THRESHOLDS)).toBe('suspect');
    expect(deriveVerdict([hit('JC_TEST_VALUES', 'soft')], DEFAULT_THRESHOLDS)).toBe('clean');
  });
  it('no hits are clean', () => {
    expect(deriveVerdict([], DEFAULT_THRESHOLDS)).toBe('clean');
  });
  it('the soft-hit threshold is per-client configurable', () => {
    const one = [hit('JC_TEST_VALUES', 'soft')];
    expect(deriveVerdict(one, { suspect_soft_hits: 1 })).toBe('suspect');
    expect(deriveVerdict([...one, hit('JC_EMAIL_DISPOSABLE', 'soft')], { suspect_soft_hits: 3 })).toBe('clean');
  });
});

describe('evaluateJunkRules', () => {
  const junkInput = { email: 'test@mailinator.com', firstName: 'test', userAgent: 'HeadlessChrome/1' };

  it('collects every rule that fires and derives the verdict', () => {
    const r = evaluateJunkRules(junkInput, cfg());
    expect(r.hits.map((h) => h.rule_id).sort()).toEqual(['JC_EMAIL_DISPOSABLE', 'JC_NON_HUMAN_UA', 'JC_TEST_VALUES']);
    expect(r.verdict).toBe('junk');
  });

  it('a clean contact evaluates clean with no hits', () => {
    const r = evaluateJunkRules({ email: 'jane@acme.co.uk', phone: '+44 20 7946 0958', firstName: 'Jane', lastName: 'Visitor', userAgent: 'Mozilla/5.0 Chrome/120 Safari/537' }, cfg());
    expect(r).toEqual({ verdict: 'clean', hits: [] });
  });

  it('a rule disabled for the client never fires', () => {
    const r = evaluateJunkRules(junkInput, cfg({ rule_flags: { JC_NON_HUMAN_UA: false } }));
    expect(r.hits.map((h) => h.rule_id)).not.toContain('JC_NON_HUMAN_UA');
    expect(r.verdict).toBe('suspect'); // the two soft hits remain
  });

  it('passes the client thresholds through to the stateful rules', () => {
    const base = { submissionsFromIp: 3 };
    expect(evaluateJunkRules(base, cfg()).hits).toEqual([]);
    expect(evaluateJunkRules(base, cfg({ thresholds: { ...DEFAULT_THRESHOLDS, velocity_max: 2 } })).hits.map((h) => h.rule_id)).toEqual(['JC_SUBMIT_VELOCITY']);
  });

  it('is deterministic for the same input', () => {
    expect(evaluateJunkRules(junkInput, cfg())).toEqual(evaluateJunkRules(junkInput, cfg()));
  });
});

describe('C3 capture rules in the evaluator', () => {
  const clean = { email: 'jane@acme.co.uk', firstName: 'Jane', lastName: 'Visitor' };
  it('a too-fast submit alone is a hard hit → junk', () => {
    const r = evaluateJunkRules({ ...clean, msToSubmit: 600 }, cfg());
    expect(r.verdict).toBe('junk');
    expect(r.hits.map((h) => h.rule_id)).toEqual(['JC_SUBMIT_TOO_FAST']);
  });
  it('a filled honeypot alone is a hard hit → junk', () => {
    expect(evaluateJunkRules({ ...clean, honeypotFilled: true }, cfg()).hits.map((h) => h.rule_id)).toEqual(['JC_HONEYPOT_FILLED']);
  });
  it('no capture data → both rules stay silent and a clean lead stays clean', () => {
    expect(evaluateJunkRules(clean, cfg()).verdict).toBe('clean');
  });
  it('the per-rule flag switches each off, and min_submit_ms is read from the client thresholds', () => {
    expect(evaluateJunkRules({ ...clean, msToSubmit: 600 }, cfg({ rule_flags: { JC_SUBMIT_TOO_FAST: false } })).verdict).toBe('clean');
    expect(evaluateJunkRules({ ...clean, honeypotFilled: true }, cfg({ rule_flags: { JC_HONEYPOT_FILLED: false } })).verdict).toBe('clean');
    expect(evaluateJunkRules({ ...clean, msToSubmit: 3000 }, cfg({ thresholds: { ...DEFAULT_THRESHOLDS, min_submit_ms: 5000 } })).verdict).toBe('junk');
  });
});

