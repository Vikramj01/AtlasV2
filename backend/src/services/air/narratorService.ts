// AIR narration layer.
// For each anomaly detected on a given date, fetches correlated signals and calls
// Claude to produce a short, actionable insight narrative. Writes one row per
// anomaly to air_insights.
//
// Design decisions:
// - Pure helpers (buildSystemPrompt, buildUserMessage, extractNarrative) exported
//   for unit testing without network or DB calls.
// - Batch DB reads: one query for anomalies, one for all their correlations.
//   Correlations are then grouped in memory before each Claude call.
// - Idempotent re-run: DELETE existing insights for the anomaly set before
//   inserting fresh ones (no UNIQUE constraint, so DELETE+INSERT is cleanest).
// - callClaude() from claudeClient is used so token cost is logged automatically
//   under the 'ai_insight_generated' event type.
// - Claude calls are run concurrently via Promise.allSettled — per-anomaly
//   failures are isolated and logged rather than aborting the batch.

import { supabaseAdmin } from '@/services/database/supabase';
import { getAirEligibleOrgIds } from '@/services/air/ingestion/ingestionOrchestrator';
import { callClaude } from '@/services/usage/claudeClient';
import logger from '@/utils/logger';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 300;

export interface AnomalyInput {
  id: string;
  source: string;
  metric_name: string;
  dimension: string | null;
  detected_date: string;
  baseline_value: number;
  observed_value: number;
  deviation_pct: number;
  severity: 'low' | 'medium' | 'high';
}

export interface CorrelationInput {
  factor_type: string;
  factor_date: string;
  proximity_days: number;
  confidence_score: number;
}

export interface InsightRow {
  org_id: string;
  anomaly_id: string;
  narrative: string;
  input_payload: object;
  model_version: string;
}

export function buildSystemPrompt(): string {
  return `You are Atlas AIR (Auto-insight Reporter), an AI assistant embedded in a marketing analytics platform.
Your role is to narrate metric anomalies detected in ad platform and analytics data in clear, non-technical language.

Rules:
- Write exactly 2–3 sentences.
- State what changed, by how much, and what it might mean.
- If correlated signals are provided, weave in the most relevant one.
- Do not use jargon (no "deviation", "baseline", "anomaly"). Use plain English.
- Do not speculate beyond the data. Do not suggest specific actions unless obvious from context.
- Tone: concise, factual, useful to a marketing manager.`;
}

export function buildUserMessage(anomaly: AnomalyInput, factors: CorrelationInput[]): string {
  const direction = anomaly.deviation_pct < 0 ? 'dropped' : 'increased';
  const absPct    = Math.abs(anomaly.deviation_pct).toFixed(1);
  const dimNote   = anomaly.dimension ? ` (segment: ${anomaly.dimension})` : '';
  const sourceLabel = anomaly.source.replace(/_/g, ' ');

  let message = `Metric: ${anomaly.metric_name}${dimNote} on ${sourceLabel}
Date: ${anomaly.detected_date}
Change: ${direction} ${absPct}% vs 14-day average (was ${anomaly.baseline_value.toLocaleString()}, now ${anomaly.observed_value.toLocaleString()})
Severity: ${anomaly.severity}`;

  if (factors.length > 0) {
    const topFactor = [...factors].sort((a, b) => b.confidence_score - a.confidence_score)[0];
    const factorLabel: Record<string, string> = {
      dqm_alert:            'tracking tag failure detected',
      cse_signal_change:    'crawl run completed (signal change possible)',
      andromeda_score_drop: 'platform health score dropped',
      bse_delivery_failure: 'audience delivery failure',
    };
    const label = factorLabel[topFactor.factor_type] ?? topFactor.factor_type;
    message += `\nTop correlated signal: ${label} on ${topFactor.factor_date} (${topFactor.proximity_days} day(s) away, confidence ${topFactor.confidence_score})`;
  }

  message += '\n\nWrite the insight narrative now:';
  return message;
}

export function extractNarrative(response: { content: Array<{ type: string; text?: string }> }): string {
  for (const block of response.content) {
    if (block.type === 'text' && block.text) return block.text.trim();
  }
  return '';
}

// Calls Claude for a single anomaly and returns the populated InsightRow.
export async function narrateAnomaly(
  orgId: string,
  anomaly: AnomalyInput,
  factors: CorrelationInput[],
  jobId?: string,
): Promise<InsightRow> {
  const system    = buildSystemPrompt();
  const userMsg   = buildUserMessage(anomaly, factors);
  const inputPayload = { anomaly, factors };

  const response = await callClaude({
    org_id:     orgId,
    event_type: 'ai_insight_generated',
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages:   [{ role: 'user', content: userMsg }],
    job_id:     jobId,
  });

  return {
    org_id:        orgId,
    anomaly_id:    anomaly.id,
    narrative:     extractNarrative(response),
    input_payload: inputPayload,
    model_version: response.model,
  };
}

// Runs narration for all anomalies detected for one org on a given date.
export async function runNarrationForOrg(orgId: string, date: string): Promise<void> {
  // 1. Fetch all anomalies for org+date
  const { data: anomalies, error: anomalyErr } = await supabaseAdmin
    .from('air_anomalies')
    .select('id, source, metric_name, dimension, detected_date, baseline_value, observed_value, deviation_pct, severity')
    .eq('org_id', orgId)
    .eq('detected_date', date);

  if (anomalyErr) throw new Error(`AIR narration: failed to fetch anomalies: ${anomalyErr.message}`);
  if (!anomalies || anomalies.length === 0) {
    logger.info({ orgId, date }, 'AIR narration: no anomalies to narrate');
    return;
  }

  const anomalyIds = (anomalies as AnomalyInput[]).map((a) => a.id);

  // 2. Fetch all correlations for these anomalies in one query
  const { data: correlations } = await supabaseAdmin
    .from('air_insight_correlations')
    .select('anomaly_id, factor_type, factor_date, proximity_days, confidence_score')
    .in('anomaly_id', anomalyIds);

  // 3. Group correlations by anomaly_id
  const factorsByAnomaly = new Map<string, CorrelationInput[]>();
  for (const row of (correlations ?? []) as (CorrelationInput & { anomaly_id: string })[]) {
    const list = factorsByAnomaly.get(row.anomaly_id) ?? [];
    list.push({ factor_type: row.factor_type, factor_date: row.factor_date, proximity_days: row.proximity_days, confidence_score: row.confidence_score });
    factorsByAnomaly.set(row.anomaly_id, list);
  }

  // 4. Narrate all anomalies concurrently, isolating per-anomaly failures
  const results = await Promise.allSettled(
    (anomalies as AnomalyInput[]).map((anomaly) =>
      narrateAnomaly(orgId, anomaly, factorsByAnomaly.get(anomaly.id) ?? []),
    ),
  );

  const insights: InsightRow[] = [];
  const successIds: string[]   = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      insights.push(result.value);
      successIds.push((anomalies as AnomalyInput[])[i].id);
    } else {
      logger.error(
        { anomalyId: (anomalies as AnomalyInput[])[i].id, err: result.reason?.message },
        'AIR narration: per-anomaly failure',
      );
    }
  }

  if (insights.length === 0) {
    logger.warn({ orgId, date }, 'AIR narration: all anomalies failed narration');
    return;
  }

  // 5. Delete stale insights for successfully narrated anomalies, then insert fresh ones
  await supabaseAdmin
    .from('air_insights')
    .delete()
    .in('anomaly_id', successIds);

  const { error: insertErr } = await supabaseAdmin
    .from('air_insights')
    .insert(insights);

  if (insertErr) throw new Error(`AIR narration: insert failed: ${insertErr.message}`);

  logger.info({ orgId, date, narrated: insights.length }, 'AIR narration: complete');
}

// Fan-out: runs narration for all eligible orgs on the given date.
export async function runNarrationForAllActiveOrgs(date: string): Promise<void> {
  const orgIds = await getAirEligibleOrgIds();
  logger.info({ count: orgIds.length, date }, 'AIR narration: running for eligible orgs');

  for (const orgId of orgIds) {
    try {
      await runNarrationForOrg(orgId, date);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), orgId },
        'AIR narration: per-org failure',
      );
    }
  }
}
