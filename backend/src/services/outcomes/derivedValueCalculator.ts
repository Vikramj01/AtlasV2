/**
 * derivedValueCalculator — historical stage-to-close computation.
 * docs/prd/crm-outcome-integration.md §7.3, Sprint 7.
 *
 * For every non-terminal-won stage in a config's ladder, computes
 *
 *   derived_value(stage) = stage_to_won_rate(stage) × avg_won_amount
 *
 * over a trailing window (default 180 days) and writes one
 * crm_derived_value_snapshots row per stage. Recomputed on a weekly
 * schedule (crmDerivedValueQueue, worker.ts) — never per event.
 *
 * Pure crm_outcome_events read, no CRM API calls. Every mapped stage
 * transition already gets its own crm_outcome_events row (Sprint 4), so
 * this reuses Atlas's own persisted history rather than re-fetching from
 * HubSpot/Salesforce or needing a OutcomeSource/tokens at all — the
 * OutcomeSource interface (frozen since Sprint 1, §4.2) has no stage-history
 * method to give this a data source even if it wanted one.
 *
 * stage_to_won_rate is per-stage; avg_won_amount is NOT (note the formula
 * has no "(stage)" after it) — it is one config-level average across every
 * terminal-won outcome event in the window, reused for every stage's
 * calculation. §7.2 already forbids currency conversion, so avg_won_amount
 * only ever averages won amounts recorded in the config's own
 * default_currency; a won deal recorded in a different currency is
 * excluded from the average rather than converted.
 *
 * reached_won_count counts a record that reached `stage` within the window
 * as a "won" record if it reached ANY terminal-won stage ANYWHERE in that
 * same window-bounded event set — not only if the win itself also falls
 * inside the window on its own. A record can reach `stage` near a window's
 * start and win near its end without falsely dropping out; the accepted
 * approximation (consistent with ingestWindows.ts's documented "B2B sales
 * cycles routinely exceed windows" limitation) is that a cycle spanning
 * more than `windowDays` undercounts, which recomputation weekly overlap
 * naturally self-corrects for over a few runs.
 *
 * Cold-start protection (§7.3's "must degrade to DECLARED cleanly, not show
 * zeros"): if there is no currency-matched won amount to average AT ALL in
 * the window, every stage is forced to `withheld` regardless of its own
 * sample_size — a real stage_to_won_rate multiplied by an undefined/zero
 * avg_won_amount would produce a derived_value that looks authoritative
 * but is actually "we don't know what a win is worth yet."
 */

import {
  getOutcomeSourceConfigByIdInternal,
  listOutcomeStageMappings,
  listOutcomeEventsForDerivedCalc,
  upsertDerivedValueSnapshots,
} from '@/services/database/outcomeQueries';
import type { OutcomeStageMapping, NewDerivedValueSnapshotInput, OutcomeEventForDerivedCalc, OutcomeDerivedConfidence } from '@/types/outcomes';

export const DEFAULT_DERIVED_VALUE_WINDOW_DAYS = 180;

// §7.3's exact sample-size floors.
export const HIGH_CONFIDENCE_MIN_SAMPLE = 50;
export const HIGH_CONFIDENCE_MIN_WON = 10;
export const LOW_CONFIDENCE_MIN_SAMPLE = 20;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function deriveConfidence(sampleSize: number, reachedWonCount: number): OutcomeDerivedConfidence {
  if (sampleSize >= HIGH_CONFIDENCE_MIN_SAMPLE && reachedWonCount >= HIGH_CONFIDENCE_MIN_WON) return 'high';
  if (sampleSize >= LOW_CONFIDENCE_MIN_SAMPLE) return 'low';
  return 'withheld';
}

/**
 * Pure — no I/O. Exported directly so the sample-size gating at each
 * threshold, the cold-start override, and the currency-exclusion rule can
 * be unit-tested without touching Supabase.
 */
export function computeStageSnapshots(
  configId: string,
  events: OutcomeEventForDerivedCalc[],
  stageMappings: Pick<OutcomeStageMapping, 'id' | 'crm_stage_id' | 'is_terminal_won'>[],
  defaultCurrency: string,
  windowStart: Date,
  windowEnd: Date,
): NewDerivedValueSnapshotInput[] {
  const wonMappingIds = new Set(stageMappings.filter((m) => m.is_terminal_won).map((m) => m.id));

  const stagesByRecord = new Map<string, Set<string>>();
  const wonRecordIds = new Set<string>();
  const wonAmounts: number[] = [];

  for (const e of events) {
    if (!stagesByRecord.has(e.source_record_id)) stagesByRecord.set(e.source_record_id, new Set());
    stagesByRecord.get(e.source_record_id)!.add(e.source_stage_id);

    if (e.mapping_id && wonMappingIds.has(e.mapping_id)) {
      wonRecordIds.add(e.source_record_id);
      // §7.2 — never convert currencies. A won amount recorded in a
      // different currency than the config's default is excluded from
      // this average, not converted into it.
      if (e.conversion_value != null && (e.currency ?? defaultCurrency) === defaultCurrency) {
        wonAmounts.push(e.conversion_value);
      }
    }
  }

  const hasWonAmountData = wonAmounts.length > 0;
  const avgWonAmount = hasWonAmountData
    ? wonAmounts.reduce((a, b) => a + b, 0) / wonAmounts.length
    : 0;

  const nonTerminalWonMappings = stageMappings.filter((m) => !m.is_terminal_won);
  const windowStartStr = toDateOnly(windowStart);
  const windowEndStr = toDateOnly(windowEnd);

  return nonTerminalWonMappings.map((mapping) => {
    let sampleSize = 0;
    let reachedWonCount = 0;
    for (const [recordId, stages] of stagesByRecord) {
      if (!stages.has(mapping.crm_stage_id)) continue;
      sampleSize += 1;
      if (wonRecordIds.has(recordId)) reachedWonCount += 1;
    }

    const stageToWonRate = sampleSize > 0 ? reachedWonCount / sampleSize : 0;
    const derivedValue = stageToWonRate * avgWonAmount;
    // Cold start forces withheld regardless of sampleSize — see module header.
    const confidence: OutcomeDerivedConfidence = hasWonAmountData
      ? deriveConfidence(sampleSize, reachedWonCount)
      : 'withheld';

    return {
      config_id: configId,
      crm_stage_id: mapping.crm_stage_id,
      sample_size: sampleSize,
      reached_won_count: reachedWonCount,
      stage_to_won_rate: Number(stageToWonRate.toFixed(5)),
      avg_won_amount: Number(avgWonAmount.toFixed(2)),
      currency: defaultCurrency,
      derived_value: Number(derivedValue.toFixed(2)),
      confidence,
      window_start: windowStartStr,
      window_end: windowEndStr,
    };
  });
}

/**
 * Async wrapper — resolves the config/ladder/events, calls the pure
 * function above, and persists the result. Returns [] (writes nothing) for
 * a missing config or an empty ladder rather than throwing, since a config
 * disappearing between fan-out enqueue and job processing (deleted mid-week)
 * is not a real failure.
 */
export async function computeDerivedValuesForConfig(
  configId: string,
  opts?: { windowDays?: number },
): Promise<NewDerivedValueSnapshotInput[]> {
  const windowDays = opts?.windowDays ?? DEFAULT_DERIVED_VALUE_WINDOW_DAYS;

  const config = await getOutcomeSourceConfigByIdInternal(configId);
  if (!config) return [];

  const stageMappings = await listOutcomeStageMappings(configId);
  if (stageMappings.length === 0) return [];

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const events = await listOutcomeEventsForDerivedCalc(configId, windowStart.toISOString());
  const snapshots = computeStageSnapshots(configId, events, stageMappings, config.default_currency, windowStart, windowEnd);

  if (snapshots.length > 0) {
    await upsertDerivedValueSnapshots(config.organization_id, snapshots);
  }

  return snapshots;
}
