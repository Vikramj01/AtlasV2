// DQM Orchestrator — runs all DQM checks for a single org

import { probeGTGPath, saveGTGCheck } from './gtgProbe';
import { pollDMADiagnostics, upsertDMAPollState, updateDMABackoff, getDMAPollState } from './dmaPolling';
import { evaluateGTGAlert, evaluateDMAAlert } from './dqmAlertEvaluator';
import {
  getAlertByType,
  createAlert,
  incrementAlertOk,
  resolveAlert,
} from '@/services/database/healthQueries';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

// GTG runs every 15 min (the cron cadence); DMA is heavier so only runs once per hour.
const DMA_MIN_INTERVAL_MS = 55 * 60 * 1000;

interface OrgConfig {
  degradedLatencyThresholdMs: number;
  dmaMatchRateWarningThreshold: number;
  dmaMatchRateDropPctWarning: number;
}

async function loadOrgConfig(orgId: string): Promise<OrgConfig> {
  const defaults: OrgConfig = {
    degradedLatencyThresholdMs: 2000,
    dmaMatchRateWarningThreshold: 0.50,
    dmaMatchRateDropPctWarning: 0.10,
  };

  const { data } = await supabaseAdmin
    .from('dqm_org_config')
    .select('degraded_latency_threshold_ms, dma_match_rate_warning_threshold, dma_match_rate_drop_pct_warning')
    .eq('org_id', orgId)
    .single();

  if (!data) return defaults;

  const row = data as {
    degraded_latency_threshold_ms: number;
    dma_match_rate_warning_threshold: number;
    dma_match_rate_drop_pct_warning: number;
  };

  return {
    degradedLatencyThresholdMs:    row.degraded_latency_threshold_ms    ?? defaults.degradedLatencyThresholdMs,
    dmaMatchRateWarningThreshold:  row.dma_match_rate_warning_threshold  ?? defaults.dmaMatchRateWarningThreshold,
    dmaMatchRateDropPctWarning:    row.dma_match_rate_drop_pct_warning    ?? defaults.dmaMatchRateDropPctWarning,
  };
}

async function writeDQMRunLog(
  orgId: string,
  checkType: 'gtg' | 'dma',
  status: string,
  latencyMs: number | null,
  triggeredBy: 'scheduled' | 'manual',
  alertAction: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.from('dqm_run_log').insert({
    org_id: orgId,
    check_type: checkType,
    status,
    latency_ms: latencyMs,
    triggered_by: triggeredBy,
    alert_action: alertAction,
  });

  if (error) logger.error({ error, orgId, checkType }, 'DQM: failed to write run log');
}

async function applyAlertDecision(
  orgId: string,
  checkType: 'gtg' | 'dma',
  decision: import('./dqmAlertEvaluator').AlertEvalResult,
): Promise<string> {
  const alertType = checkType === 'gtg' ? 'dqm_gtg' : 'dqm_dma';

  if (decision.decision === 'open') {
    await createAlert(orgId, alertType, decision.severity!, decision.title, decision.message, null, null);
    return 'open';
  }

  if (decision.decision === 'update') {
    // Alert already active — no new row, just log the update for the run log.
    return 'update';
  }

  if (decision.decision === 'resolve') {
    const existing = await getAlertByType(orgId, alertType);
    if (existing) {
      const okCount = await incrementAlertOk(existing.id);
      if (okCount >= 2) {
        await resolveAlert(existing.id);
        return 'resolve';
      }
    }
    return 'none';
  }

  return 'none';
}

export async function runDQMForOrg(
  orgId: string,
  triggeredBy: 'scheduled' | 'manual' = 'scheduled',
): Promise<void> {
  logger.info({ orgId }, 'DQM: starting checks');

  const [config, dmaState] = await Promise.all([
    loadOrgConfig(orgId),
    getDMAPollState(orgId),
  ]);

  // ── GTG probe ────────────────────────────────────────────────────────────────
  const gtgResult = await probeGTGPath(orgId, config.degradedLatencyThresholdMs)
    .then(async (r) => {
      if (r.gtagUrl) await saveGTGCheck(orgId, r.gtagUrl, r);
      return r;
    })
    .catch((err) => {
      logger.error({ err, orgId }, 'DQM: GTG probe failed');
      return null;
    });

  if (gtgResult) {
    const existingGTGAlert = await getAlertByType(orgId, 'dqm_gtg');
    const gtgDecision = evaluateGTGAlert({
      status: gtgResult.checkStatus,
      existingAlertActive: !!existingGTGAlert,
    });
    const gtgAction = await applyAlertDecision(orgId, 'gtg', gtgDecision);
    await writeDQMRunLog(orgId, 'gtg', gtgResult.checkStatus, gtgResult.responseMs, triggeredBy, gtgAction);
  }

  // ── DMA poll — skip if polled recently (cadence gate) ────────────────────────
  const msSinceLastPoll = dmaState?.backoffUntil === null && dmaState
    ? Infinity  // state exists but no backoff — check last_polled_at separately
    : Infinity;

  const { data: dmaPollRow } = await supabaseAdmin
    .from('dqm_dma_poll_state')
    .select('last_polled_at, avg_match_rate')
    .eq('org_id', orgId)
    .single();

  const lastPolledAt = (dmaPollRow as { last_polled_at: string | null; avg_match_rate: number | null } | null)?.last_polled_at;
  const prevMatchRate = (dmaPollRow as { last_polled_at: string | null; avg_match_rate: number | null } | null)?.avg_match_rate ?? null;
  const msSinceDMAPoll = lastPolledAt ? Date.now() - new Date(lastPolledAt).getTime() : Infinity;

  if (msSinceDMAPoll < DMA_MIN_INTERVAL_MS && triggeredBy === 'scheduled') {
    logger.info({ orgId, msSinceDMAPoll }, 'DQM: DMA poll skipped — within cadence window');
  } else {
    const dmaResult = await pollDMADiagnostics(orgId).catch((err) => {
      logger.error({ err, orgId }, 'DQM: DMA poll failed');
      return null;
    });

    if (dmaResult === 'skipped-backoff') {
      await writeDQMRunLog(orgId, 'dma', 'skipped-backoff', null, triggeredBy, 'none');
    } else if (dmaResult) {
      await Promise.all([
        upsertDMAPollState(orgId, dmaResult),
        updateDMABackoff(orgId, false, dmaState?.consecutiveFailures ?? 0),
      ]);

      // Check if this org ever had DMA activity before this run
      const { count } = await supabaseAdmin
        .from('enricher_runs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId);

      const existingDMAAlert = await getAlertByType(orgId, 'dqm_dma');
      const dmaDecision = evaluateDMAAlert({
        uploadSuccessRate: dmaResult.uploadSuccessRate,
        avgMatchRate: dmaResult.avgMatchRate,
        prevAvgMatchRate: prevMatchRate,
        totalMembers30d: dmaResult.totalMembers30d,
        hadActivityBefore: (count ?? 0) > 0,
        matchRateWarningThreshold: config.dmaMatchRateWarningThreshold,
        matchRateDropThreshold: config.dmaMatchRateDropPctWarning,
        existingAlertActive: !!existingDMAAlert,
      });
      const dmaAction = await applyAlertDecision(orgId, 'dma', dmaDecision);
      await writeDQMRunLog(orgId, 'dma', 'ok', null, triggeredBy, dmaAction);
    } else {
      // Poll threw — backoff was already set inside pollDMADiagnostics
      await writeDQMRunLog(orgId, 'dma', 'error', null, triggeredBy, 'none');
    }
  }

  logger.info({ orgId }, 'DQM: checks complete');
}

export async function runDQMForAllActiveOrgs(): Promise<void> {
  // Orgs that have enricher_runs OR gtm_container_connections in the last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [enricherOrgs, gtmOrgs] = await Promise.all([
    supabaseAdmin.from('enricher_runs').select('org_id').gte('created_at', since),
    supabaseAdmin.from('gtm_container_connections').select('organization_id'),
  ]);

  const orgIds = new Set<string>();
  for (const r of enricherOrgs.data ?? []) orgIds.add((r as { org_id: string }).org_id);
  for (const r of gtmOrgs.data ?? []) orgIds.add((r as { organization_id: string }).organization_id);

  logger.info({ count: orgIds.size }, 'DQM: running for active orgs');

  for (const orgId of orgIds) {
    try {
      await runDQMForOrg(orgId);
    } catch (err) {
      logger.error({ err, orgId }, 'DQM: orchestrator error for org');
    }
  }
}

export async function getActiveOrgIds(): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [enricherOrgs, gtmOrgs] = await Promise.all([
    supabaseAdmin.from('enricher_runs').select('org_id').gte('created_at', since),
    supabaseAdmin.from('gtm_container_connections').select('organization_id'),
  ]);

  const orgIds = new Set<string>();
  for (const r of enricherOrgs.data ?? []) orgIds.add((r as { org_id: string }).org_id);
  for (const r of gtmOrgs.data ?? []) orgIds.add((r as { organization_id: string }).organization_id);

  return Array.from(orgIds);
}
