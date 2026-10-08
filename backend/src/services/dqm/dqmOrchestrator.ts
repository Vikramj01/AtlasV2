// DQM Orchestrator — runs all DQM checks for a single org

import { probeGTGPath, saveGTGCheck } from './gtgProbe';
import { probeSgtmHealth, saveSgtmCheck } from './sgtmProbe';
import { pollDMADiagnostics, upsertDMAPollState, updateDMABackoff, getDMAPollState } from './dmaPolling';
import { pollMetaEmqForOrg, saveMetaEmqOutcome } from './metaEmqPolling';
import { evaluateGTGAlert, evaluateDMAAlert, evaluateSgtmAlert, evaluateOutcomeSyncAlert, evaluateGoogleTagTopologyAlert, evaluateGa4ConfigChangeAlert, evaluateJunkGateAlert } from './dqmAlertEvaluator';
import { computeGoogleTagTopologySignals } from './googleTagTopologyMonitor';
import { computeGa4ConfigChangeSignals } from './ga4ConfigChangeMonitor';
import { computeJunkGateAlertSignals } from './junkGateMonitor';
import type { GTGStatus } from './dqmAlertEvaluator';
import { sendDQMAlertNotification } from './dqmAlertDelivery';
import { computeOutcomeSyncHealthSignals } from '@/services/outcomes/syncHealthCheck';
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
  checkType: 'gtg' | 'dma' | 'sgtm' | 'meta_emq' | 'outcome_sync' | 'google_tag_topology' | 'ga4_config' | 'junk_gate',
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
  checkType: 'gtg' | 'dma' | 'sgtm' | 'outcome_sync' | 'google_tag_topology' | 'ga4_config' | 'junk_gate',
  decision: import('./dqmAlertEvaluator').AlertEvalResult,
): Promise<string> {
  const alertType =
    checkType === 'gtg' ? 'dqm_gtg' :
    checkType === 'dma' ? 'dqm_dma' :
    checkType === 'sgtm' ? 'dqm_sgtm' :
    checkType === 'google_tag_topology' ? 'dqm_google_tag_topology' :
    checkType === 'ga4_config' ? 'ga4_config_changed' :
    checkType === 'junk_gate' ? 'dqm_junk_gate' :
    'dqm_outcome_sync';

  if (decision.decision === 'open') {
    await createAlert(orgId, alertType, decision.severity!, decision.title, decision.message, null, null);
    // Fire-and-forget: sendDQMAlertNotification never throws, so this never
    // blocks or fails the orchestrator run — the alert is already durably
    // recorded in health_alerts above regardless of delivery outcome.
    void sendDQMAlertNotification(orgId, alertType, decision.severity!, decision.title, decision.message);
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

  // ── sGTM probe — one HEAD check per client with a verified endpoint ──────────
  const sgtmChecks = await probeSgtmHealth(orgId, config.degradedLatencyThresholdMs).catch((err) => {
    logger.error({ err, orgId }, 'DQM: sGTM probe failed');
    return [];
  });

  await Promise.all(sgtmChecks.map((c) => saveSgtmCheck(orgId, c)));

  const sgtmStatusRank: Record<GTGStatus, number> = {
    pass: 0,
    error: 0,
    'skipped-backoff': 0,
    degraded: 1,
    fail: 2,
    timeout: 2,
  };
  let sgtmWorstStatus: GTGStatus = 'pass';
  let sgtmFailingCount = 0;
  for (const c of sgtmChecks) {
    if (sgtmStatusRank[c.checkStatus] > sgtmStatusRank[sgtmWorstStatus]) sgtmWorstStatus = c.checkStatus;
    if (c.checkStatus === 'fail' || c.checkStatus === 'timeout' || c.checkStatus === 'degraded') sgtmFailingCount++;
  }

  const existingSgtmAlert = await getAlertByType(orgId, 'dqm_sgtm');
  const sgtmDecision = evaluateSgtmAlert({
    worstStatus: sgtmWorstStatus,
    failingCount: sgtmFailingCount,
    totalCount: sgtmChecks.length,
    existingAlertActive: !!existingSgtmAlert,
  });

  if (sgtmDecision.decision !== 'none') {
    const sgtmAction = await applyAlertDecision(orgId, 'sgtm', sgtmDecision);
    const sgtmWorstResponseMs = sgtmChecks.length > 0
      ? sgtmChecks.reduce((worst, c) => (sgtmStatusRank[c.checkStatus] > sgtmStatusRank[worst.checkStatus] ? c : worst), sgtmChecks[0]).responseMs
      : null;
    await writeDQMRunLog(orgId, 'sgtm', sgtmChecks.length === 0 ? 'not-applicable' : sgtmWorstStatus, sgtmWorstResponseMs, triggeredBy, sgtmAction);
  }

  // ── Outcome sync health — one rolled-up alert across all enabled outcome_source_configs ─
  // (CRM Outcome Integration PRD Sprint 8, §10). computeOutcomeSyncHealthSignals()
  // returns null when the org has no enabled config at all — same "nothing
  // to monitor" early-out sGTM uses above, so a stale alert from a since-
  // disabled/deleted config still resolves via the evaluator's existingAlertActive
  // branch rather than being left dangling.
  const existingOutcomeSyncAlert = await getAlertByType(orgId, 'dqm_outcome_sync');
  const outcomeSyncSignals = await computeOutcomeSyncHealthSignals(orgId, !!existingOutcomeSyncAlert).catch((err) => {
    logger.error({ err, orgId }, 'DQM: outcome sync health check failed');
    return null;
  });

  if (outcomeSyncSignals) {
    const outcomeSyncDecision = evaluateOutcomeSyncAlert(outcomeSyncSignals);
    if (outcomeSyncDecision.decision !== 'none') {
      const outcomeSyncAction = await applyAlertDecision(orgId, 'outcome_sync', outcomeSyncDecision);
      await writeDQMRunLog(orgId, 'outcome_sync', outcomeSyncDecision.title || 'ok', null, triggeredBy, outcomeSyncAction);
    }
  } else if (existingOutcomeSyncAlert) {
    // No enabled config left to evaluate, but a stale alert is still open —
    // resolve it the same way a healthy run would (2 consecutive "ok"s),
    // consistent with every other check's resolve path in this file.
    const outcomeSyncAction = await applyAlertDecision(orgId, 'outcome_sync', { decision: 'resolve', severity: null, title: '', message: '' });
    await writeDQMRunLog(orgId, 'outcome_sync', 'not-applicable', null, triggeredBy, outcomeSyncAction);
  }

  // ── Google tag topology — one rolled-up alert across clients with a verified split ──
  // (Google Tag Topology PRD §8.3). Gated to once per 24h per client inside
  // computeGoogleTagTopologySignals() — topology changes rarely, so the 15-minute
  // loop reuses each client's stored check. Null = no verified split to monitor;
  // a stale alert still resolves via the evaluator/applyAlertDecision path.
  const existingTopologyAlert = await getAlertByType(orgId, 'dqm_google_tag_topology');
  const topologySignals = await computeGoogleTagTopologySignals(orgId, !!existingTopologyAlert).catch((err) => {
    logger.error({ err, orgId }, 'DQM: Google tag topology check failed');
    return null;
  });

  if (topologySignals) {
    const topologyDecision = evaluateGoogleTagTopologyAlert(topologySignals);
    if (topologyDecision.decision !== 'none') {
      const topologyAction = await applyAlertDecision(orgId, 'google_tag_topology', topologyDecision);
      await writeDQMRunLog(orgId, 'google_tag_topology', topologyDecision.title || 'ok', null, triggeredBy, topologyAction);
    }
  } else if (existingTopologyAlert) {
    const topologyAction = await applyAlertDecision(orgId, 'google_tag_topology', { decision: 'resolve', severity: null, title: '', message: '' });
    await writeDQMRunLog(orgId, 'google_tag_topology', 'not-applicable', null, triggeredBy, topologyAction);
  }

  // ── GA4 config change — one rolled-up alert across the org's GA4 properties ──
  // (GA4 Admin / L11 / Junk Gate PRD §A.5). Stateless over ga4_config_snapshots;
  // a failed check never blocks the rest of the run.
  const existingGa4ConfigAlert = await getAlertByType(orgId, 'ga4_config_changed');
  const ga4ConfigSignals = await computeGa4ConfigChangeSignals(orgId, !!existingGa4ConfigAlert).catch((err) => {
    logger.error({ err, orgId }, 'DQM: GA4 config change check failed');
    return null;
  });
  if (ga4ConfigSignals) {
    const ga4ConfigDecision = evaluateGa4ConfigChangeAlert(ga4ConfigSignals);
    if (ga4ConfigDecision.decision !== 'none') {
      const ga4ConfigAction = await applyAlertDecision(orgId, 'ga4_config', ga4ConfigDecision);
      await writeDQMRunLog(orgId, 'ga4_config', ga4ConfigDecision.title || 'ok', null, triggeredBy, ga4ConfigAction);
    }
  }

  // ── Junk conversion gate — one rolled-up alert across the org's gate-enabled clients ──
  // (GA4 Admin / L11 / Junk Gate PRD §C.10). Holds near timeout + flagged-rate spike. Stateless
  // over conversion_holds; a failed check never blocks the rest of the run. No active gate config
  // resolves any open alert.
  const existingJunkGateAlert = await getAlertByType(orgId, 'dqm_junk_gate');
  const junkGateSignals = await computeJunkGateAlertSignals(orgId, !!existingJunkGateAlert).catch((err) => {
    logger.error({ err, orgId }, 'DQM: junk gate check failed');
    return undefined;
  });
  if (junkGateSignals) {
    const junkDecision = evaluateJunkGateAlert(junkGateSignals);
    if (junkDecision.decision !== 'none') {
      const junkAction = await applyAlertDecision(orgId, 'junk_gate', junkDecision);
      await writeDQMRunLog(orgId, 'junk_gate', junkDecision.title || 'ok', null, triggeredBy, junkAction);
    }
  } else if (junkGateSignals === null && existingJunkGateAlert) {
    const junkAction = await applyAlertDecision(orgId, 'junk_gate', { decision: 'resolve', severity: null, title: '', message: '' });
    await writeDQMRunLog(orgId, 'junk_gate', 'not-applicable', null, triggeredBy, junkAction);
  }

  // ── Meta EMQ poll — one Dataset Quality API call per connected Meta provider ─
  // No alert evaluation here (unlike GTG/sGTM/DMA) — this surfaces a live
  // score for display alongside Atlas's pre-flight estimate, not a health
  // signal Atlas alerts on.
  const metaEmqOutcomes = await pollMetaEmqForOrg(orgId).catch((err) => {
    logger.error({ err, orgId }, 'DQM: Meta EMQ poll failed');
    return [];
  });

  await Promise.all(metaEmqOutcomes.map((o) => saveMetaEmqOutcome(o)));

  for (const outcome of metaEmqOutcomes) {
    const scores = outcome.results.map((r) => r.emq_score).filter((s): s is number => s !== null);
    const avgEmq = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    await writeDQMRunLog(
      orgId,
      'meta_emq',
      outcome.status,
      null,
      triggeredBy,
      avgEmq !== null ? `avg_emq:${avgEmq.toFixed(1)}` : 'none',
    );
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
