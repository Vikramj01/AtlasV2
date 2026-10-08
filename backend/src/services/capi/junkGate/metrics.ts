/**
 * Junk gate metrics (GA4 Admin / L11 / Junk Gate PRD §C.10, C3). Pure over conversion_holds rows.
 *
 * Definitions (stated so the numbers cannot be misread):
 *  - evaluated  = every in-scope event the gate evaluated in the window, clean included.
 *  - flagged    = verdict junk or suspect. Mode-agnostic: in observe it is "would have held".
 *  - held       = a conversion that was actually held (status held / released / rejected /
 *                 auto_released / auto_dropped). Always 0 in observe mode.
 *  - overturn rate (per rule) = released-by-a-reviewer ÷ (released + rejected by a reviewer) among
 *                 held conversions carrying that rule. DEPARTURE from the PRD's "÷ held": a hold
 *                 nobody has reviewed yet, or one the timeout auto-released, says nothing about
 *                 whether the rule was right, so counting it would drag the rate toward 0 and hide
 *                 exactly the rule that needs attention.
 *  - A rule is flagged "likely holding good leads" at ≥ 50% overturn over ≥ 5 reviewed holds; below
 *    the sample floor no judgement is made (the rate is still shown).
 */
import type { JunkRuleId } from './types';

export const OVERTURN_FLAG_MIN_REVIEWED = 5;
export const OVERTURN_FLAG_RATE = 0.5;

export interface MetricRow {
  verdict: 'junk' | 'suspect' | 'clean';
  status: 'observed' | 'held' | 'released' | 'rejected' | 'auto_released' | 'auto_dropped';
  rule_hits: Array<{ rule_id: string }> | null;
}

export interface RuleMetric {
  rule_id: string;
  hits: number;
  /** hits ÷ evaluated; null when nothing was evaluated. */
  hit_rate: number | null;
  reviewed: number;
  overturned: number;
  overturn_rate: number | null;
  likely_holding_good_leads: boolean;
}

export interface JunkGateMetrics {
  window_days: number;
  evaluated: number;
  flagged: number;
  flagged_rate: number | null;
  held: number;
  hold_rate: number | null;
  open_held: number;
  auto_released: number;
  auto_dropped: number;
  reviewed_released: number;
  reviewed_rejected: number;
  overturn_rate: number | null;
  rules: RuleMetric[];
  /** True when the row cap was reached and the figures cover only the newest rows. */
  truncated: boolean;
}

const HELD_STATUSES = new Set<MetricRow['status']>(['held', 'released', 'rejected', 'auto_released', 'auto_dropped']);
const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function computeJunkMetrics(rows: MetricRow[], windowDays: number, truncated = false): JunkGateMetrics {
  let flagged = 0, held = 0, open = 0, autoReleased = 0, autoDropped = 0, released = 0, rejected = 0;
  const perRule = new Map<string, { hits: number; released: number; rejected: number }>();

  for (const r of rows) {
    if (r.verdict !== 'clean') flagged++;
    const wasHeld = HELD_STATUSES.has(r.status);
    if (wasHeld) held++;
    if (r.status === 'held') open++;
    if (r.status === 'auto_released') autoReleased++;
    if (r.status === 'auto_dropped') autoDropped++;
    if (r.status === 'released') released++;
    if (r.status === 'rejected') rejected++;

    for (const id of new Set((r.rule_hits ?? []).map((h) => h.rule_id))) {
      const m = perRule.get(id) ?? { hits: 0, released: 0, rejected: 0 };
      m.hits++;
      if (r.status === 'released') m.released++;
      if (r.status === 'rejected') m.rejected++;
      perRule.set(id, m);
    }
  }

  const evaluated = rows.length;
  const rules: RuleMetric[] = [...perRule.entries()].map(([rule_id, m]) => {
    const reviewed = m.released + m.rejected;
    const overturn_rate = ratio(m.released, reviewed);
    return {
      rule_id,
      hits: m.hits,
      hit_rate: ratio(m.hits, evaluated),
      reviewed,
      overturned: m.released,
      overturn_rate,
      likely_holding_good_leads: reviewed >= OVERTURN_FLAG_MIN_REVIEWED && (overturn_rate ?? 0) >= OVERTURN_FLAG_RATE,
    };
  }).sort((a, b) => b.hits - a.hits || a.rule_id.localeCompare(b.rule_id));

  return {
    window_days: windowDays,
    evaluated,
    flagged,
    flagged_rate: ratio(flagged, evaluated),
    held,
    hold_rate: ratio(held, evaluated),
    open_held: open,
    auto_released: autoReleased,
    auto_dropped: autoDropped,
    reviewed_released: released,
    reviewed_rejected: rejected,
    overturn_rate: ratio(released, released + rejected),
    rules,
    truncated,
  };
}

export type { JunkRuleId };
