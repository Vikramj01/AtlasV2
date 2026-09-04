/**
 * Severity weights for the v2 Check Register's overall Conversion Signal
 * Health score (PRD "Signal Health Report" Issue 7). A flat pass-rate
 * scores a CRITICAL failure (zero conversion measurement on a platform)
 * and a LOW warning (an extra undeclared tag) identically — this table is
 * how much each severity actually costs relative to a pass, so the score
 * reflects business risk rather than raw rule count.
 *
 * Configuration, not hardcoded per rule (Issue 7's explicit requirement) —
 * scoring.ts's calculateV2Scores() takes a weight table as a parameter and
 * defaults to this one, so the formula can be tuned by editing this file
 * without touching any rule definition. Setting every weight to the same
 * value reproduces the old flat pass-rate score exactly (see
 * scoring.test.ts).
 */
import type { Severity } from '@/types/audit';

export const DEFAULT_SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.5,
};
