/**
 * Junk gate DQM inputs (GA4 Admin / L11 / Junk Gate PRD §C.10, C3).
 *
 * Stateless over conversion_holds / junk_gate_configs; one rolled-up org alert (health_alerts has
 * no client dimension — the sGTM / topology / GA4-config precedent). Two conditions:
 *  - holds nearing timeout with no reviewer action (open holds expiring within NEAR_TIMEOUT_MS);
 *  - the flagged share of the last 24h above the client's `hold_rate_alert_pct`, once at least
 *    MIN_EVALUATED events were evaluated (a handful of events cannot make a "rate").
 * The flagged share is mode-agnostic so the spike signal also works in observe mode.
 */
import {
  listActiveGateConfigs, listRecentVerdicts, countHoldsExpiringBefore,
} from '@/services/database/junkGateQueries';
import { DEFAULT_HOLD_RATE_ALERT_PCT } from '@/services/capi/junkGate/config';
import type { JunkGateAlertInput } from './dqmAlertEvaluator';

export const NEAR_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const SPIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MIN_EVALUATED = 20;

export function flaggedPercent(verdicts: Array<'junk' | 'suspect' | 'clean'>): number {
  return verdicts.length === 0 ? 0 : (verdicts.filter((v) => v !== 'clean').length / verdicts.length) * 100;
}

/** null when the org has no active gate config (the caller resolves any open alert). */
export async function computeJunkGateAlertSignals(
  orgId: string, existingAlertActive: boolean, now: Date = new Date(),
): Promise<JunkGateAlertInput | null> {
  const configs = await listActiveGateConfigs(orgId);
  if (configs.length === 0) return null;

  const since = new Date(now.getTime() - SPIKE_WINDOW_MS).toISOString();
  let spikeClients = 0;
  let worstPct = 0;
  let threshold = DEFAULT_HOLD_RATE_ALERT_PCT;
  for (const c of configs) {
    const verdicts = await listRecentVerdicts(orgId, c.client_id, since);
    if (verdicts.length < MIN_EVALUATED) continue;
    const pct = flaggedPercent(verdicts);
    const limit = c.hold_rate_alert_pct ?? DEFAULT_HOLD_RATE_ALERT_PCT;
    if (pct > limit) {
      spikeClients++;
      if (pct > worstPct) { worstPct = pct; threshold = limit; }
    }
  }

  const holdsNearTimeout = await countHoldsExpiringBefore(orgId, new Date(now.getTime() + NEAR_TIMEOUT_MS).toISOString());
  return { holdsNearTimeout, spikeClients, worstFlaggedPct: Math.round(worstPct), thresholdPct: threshold, existingAlertActive };
}
