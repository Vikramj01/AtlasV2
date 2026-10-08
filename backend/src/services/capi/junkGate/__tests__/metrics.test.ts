import { describe, it, expect } from 'vitest';
import { computeJunkMetrics, OVERTURN_FLAG_MIN_REVIEWED, type MetricRow } from '../metrics';

const row = (verdict: MetricRow['verdict'], status: MetricRow['status'], rules: string[] = []): MetricRow =>
  ({ verdict, status, rule_hits: rules.map((rule_id) => ({ rule_id })) });
const many = (n: number, r: MetricRow): MetricRow[] => Array.from({ length: n }, () => r);

describe('computeJunkMetrics', () => {
  it('an empty window yields zeros and null rates — never NaN', () => {
    const m = computeJunkMetrics([], 30);
    expect(m).toMatchObject({ evaluated: 0, flagged: 0, held: 0, flagged_rate: null, hold_rate: null, overturn_rate: null, rules: [], truncated: false });
  });

  it('flagged counts junk+suspect; held counts only conversions actually held (observe rows are never held)', () => {
    const rows = [
      row('clean', 'observed'), row('clean', 'observed'),
      row('junk', 'observed', ['JC_NON_HUMAN_UA']),
      row('junk', 'held', ['JC_NON_HUMAN_UA']),
      row('suspect', 'auto_released', ['JC_TEST_VALUES']),
    ];
    const m = computeJunkMetrics(rows, 7);
    expect(m).toMatchObject({ evaluated: 5, flagged: 3, held: 2, open_held: 1, auto_released: 1, auto_dropped: 0, window_days: 7 });
    expect(m.flagged_rate).toBeCloseTo(0.6);
    expect(m.hold_rate).toBeCloseTo(0.4);
  });

  it('counts auto-released and auto-dropped separately from reviewer decisions', () => {
    const m = computeJunkMetrics([row('junk', 'auto_released'), row('junk', 'auto_dropped'), row('junk', 'released'), row('junk', 'rejected')], 30);
    expect(m).toMatchObject({ auto_released: 1, auto_dropped: 1, reviewed_released: 1, reviewed_rejected: 1 });
    expect(m.overturn_rate).toBe(0.5);
  });

  it('per-rule hit rate is hits ÷ evaluated, counting a rule once per record', () => {
    const rows = [row('junk', 'held', ['JC_A', 'JC_A']), ...many(3, row('clean', 'observed'))];
    const a = computeJunkMetrics(rows, 30).rules.find((r) => r.rule_id === 'JC_A')!;
    expect(a.hits).toBe(1);
    expect(a.hit_rate).toBeCloseTo(0.25);
  });

  describe('overturn rate (released by a reviewer ÷ reviewed) and the "holding good leads" flag', () => {
    it('is computed over REVIEWED holds only — open and auto-resolved ones neither dilute nor inflate it', () => {
      const rows = [
        ...many(3, row('junk', 'released', ['JC_R'])), ...many(1, row('junk', 'rejected', ['JC_R'])),
        ...many(10, row('junk', 'held', ['JC_R'])), ...many(10, row('junk', 'auto_released', ['JC_R'])),
      ];
      const r = computeJunkMetrics(rows, 30).rules[0];
      expect(r).toMatchObject({ reviewed: 4, overturned: 3, overturn_rate: 0.75 });
    });

    it(`flags a rule at ≥50% overturn only once ≥${OVERTURN_FLAG_MIN_REVIEWED} holds were reviewed`, () => {
      const few = computeJunkMetrics(many(OVERTURN_FLAG_MIN_REVIEWED - 1, row('junk', 'released', ['JC_X'])), 30).rules[0];
      expect(few.overturn_rate).toBe(1);
      expect(few.likely_holding_good_leads).toBe(false);
      const enough = computeJunkMetrics(many(OVERTURN_FLAG_MIN_REVIEWED, row('junk', 'released', ['JC_X'])), 30).rules[0];
      expect(enough.likely_holding_good_leads).toBe(true);
    });

    it('does not flag a rule reviewers mostly agree with', () => {
      const rows = [...many(2, row('junk', 'released', ['JC_OK'])), ...many(8, row('junk', 'rejected', ['JC_OK']))];
      const r = computeJunkMetrics(rows, 30).rules[0];
      expect(r.overturn_rate).toBeCloseTo(0.2);
      expect(r.likely_holding_good_leads).toBe(false);
    });

    it('is per-rule: a good rule and a bad rule on different records are judged separately', () => {
      const rows = [...many(6, row('junk', 'released', ['JC_BAD'])), ...many(6, row('junk', 'rejected', ['JC_GOOD']))];
      const byId = Object.fromEntries(computeJunkMetrics(rows, 30).rules.map((r) => [r.rule_id, r]));
      expect(byId.JC_BAD.likely_holding_good_leads).toBe(true);
      expect(byId.JC_GOOD.likely_holding_good_leads).toBe(false);
    });
  });

  it('sorts rules by hits then id, and passes the truncated flag through', () => {
    const rows = [row('junk', 'held', ['JC_B']), row('junk', 'held', ['JC_B']), row('junk', 'held', ['JC_A'])];
    const m = computeJunkMetrics(rows, 30, true);
    expect(m.rules.map((r) => r.rule_id)).toEqual(['JC_B', 'JC_A']);
    expect(m.truncated).toBe(true);
  });

  it('tolerates a null rule_hits column', () => {
    expect(computeJunkMetrics([{ verdict: 'clean', status: 'observed', rule_hits: null }], 30).rules).toEqual([]);
  });
});
