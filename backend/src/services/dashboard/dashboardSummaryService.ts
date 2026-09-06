import { supabaseAdmin as supabase } from '@/services/database/supabase';

const HEALTH_DROP_ALERT_THRESHOLD = 5;
const MAX_SINCE_DAYS = 30;

// Mirrors dataManagerApi's own "low match rate" threshold (dataManager.ts's
// computeNeedsAction) so the two views don't disagree on what "low" means.
const LOW_DMA_MATCH_RATE_THRESHOLD = 20;
// match_quality_score is an EMQ proxy on a 0-10 scale (see
// 20260620001_signal_tracking_dashboard.sql) — below half is a real quality problem.
const LOW_CAPI_MATCH_QUALITY_THRESHOLD = 5;

type DqmSeverity = 'critical' | 'high' | 'medium';
const DQM_SEVERITY_RANK: Record<DqmSeverity, number> = { critical: 3, high: 2, medium: 1 };
const HEALTH_LEVEL_RANK: Record<'healthy' | 'warning' | 'critical', number> = {
  healthy: 0, warning: 1, critical: 2,
};

// dqm_gtg_checks / dqm_sgtm_checks check_status -> severity.
// 'fail' means the endpoint is confirmed down (critical); 'timeout'/'error' are
// usually transient/infra issues rather than a confirmed break (high, not critical);
// 'degraded' (sgtm only) means it's working but slow (medium).
export function checkStatusSeverity(status: string | undefined): DqmSeverity | null {
  if (status === 'fail') return 'critical';
  if (status === 'timeout' || status === 'error') return 'high';
  if (status === 'degraded') return 'medium';
  return null; // 'pass' / 'not-applicable' / unknown
}

export function dmaSeverity(state: { consecutive_failures: number; avg_match_rate: number | null } | undefined): DqmSeverity | null {
  if (!state) return null;
  if (state.consecutive_failures > 0) return 'high';
  if (state.avg_match_rate !== null && state.avg_match_rate !== undefined && state.avg_match_rate < LOW_DMA_MATCH_RATE_THRESHOLD) return 'medium';
  return null;
}

export function worstDqmSeverity(...severities: (DqmSeverity | null)[]): DqmSeverity | null {
  let worst: DqmSeverity | null = null;
  for (const s of severities) {
    if (s && (!worst || DQM_SEVERITY_RANK[s] > DQM_SEVERITY_RANK[worst])) worst = s;
  }
  return worst;
}

export interface DashboardAlert {
  id: string;
  source_table: string;
  client_id: string | null;
  client_name: string | null;
  module: 'ihc' | 'dqm' | 'reconciliation' | 'health';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  created_at: string;
  is_new: boolean;
  is_reviewed: boolean;
  action_url: string;
}

export interface DashboardClientSummary {
  id: string;
  name: string;
  setup_status: 'not_started' | 'in_progress' | 'complete';
  health_level: 'healthy' | 'warning' | 'critical' | 'unknown';
  signals_count: number;
  platforms_connected: string[];
  last_verified_at: string | null;
  open_findings_count: number;
  dqm_alert_count: number;
  dqm_worst_severity: 'critical' | 'high' | 'medium' | null;
  capi_match_quality_7d: number | null;
  capi_dedup_rate_7d: number | null;
}

export interface OrgMetrics {
  total_clients: number;
  total_signals_monitored: number;
  capi_events_24h: number;
  avg_match_quality_7d: number | null;
  clients_with_issues: number;
}

export interface DashboardSummary {
  delta: {
    since_label: string;
    since_timestamp: string;
    new_alerts_count: number;
  };
  alerts: DashboardAlert[];
  clients: DashboardClientSummary[];
  org_metrics: OrgMetrics;
}

function capSince(since: string | null): string {
  const maxDaysAgo = new Date(Date.now() - MAX_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  if (!since) return maxDaysAgo;
  return since < maxDaysAgo ? maxDaysAgo : since;
}

function sinceLabel(since: string, rawSince: string | null): string {
  const cappedAt30 = rawSince !== null && rawSince < new Date(Date.now() - MAX_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const diffMs = Date.now() - new Date(since).getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const dateStr = new Date(since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  if (cappedAt30) return `Since ${dateStr} (30-day max)`;
  if (diffDays === 0) return 'Since earlier today';
  if (diffDays === 1) return 'Since yesterday';
  if (diffDays <= 6) return `Since ${diffDays} days ago`;
  return `Since ${dateStr}`;
}

export async function getAlerts(
  orgId: string,
  userId: string,
  sinceTimestamp: string | null,
): Promise<DashboardAlert[]> {
  const since = capSince(sinceTimestamp);

  const [reviewedRows, ihcRows, reconRows, dqmRows, snapshotRows] = await Promise.all([
    // Already-reviewed items
    supabase
      .from('dashboard_alert_reviews')
      .select('source_table, source_id')
      .eq('organization_id', orgId),

    // IHC findings
    supabase
      .from('audit_findings')
      .select('id, client_id, severity, rule_id, evidence, first_detected_at, created_at')
      .eq('organization_id', orgId)
      .in('status', ['open', 'acknowledged'])
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(50),

    // Reconciliation findings
    supabase
      .from('reconciliation_findings')
      .select('id, client_id, severity, dimension, platform, narrative, run_id, created_at')
      .eq('organization_id', orgId)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(50),

    // DQM failures in last 24h
    supabase
      .from('dqm_gtg_checks')
      .select('id, org_id, check_status, gtag_url, checked_at, response_ms')
      .eq('org_id', orgId)
      .eq('check_status', 'fail')
      .gte('checked_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('checked_at', { ascending: false })
      .limit(5),

    // Health snapshots for drop detection
    supabase
      .from('health_snapshots')
      .select('overall_score, snapshot_at')
      .eq('user_id', userId)
      .order('snapshot_at', { ascending: false })
      .limit(20),
  ]);

  // Build reviewed lookup
  const reviewedSet = new Set(
    (reviewedRows.data ?? []).map(
      (r: { source_table: string; source_id: string }) => `${r.source_table}:${r.source_id}`,
    ),
  );

  // Fetch client names for IHC + reconciliation
  const clientIds = new Set<string>();
  for (const r of ihcRows.data ?? []) {
    const row = r as { client_id: string | null };
    if (row.client_id) clientIds.add(row.client_id);
  }
  for (const r of reconRows.data ?? []) {
    const row = r as { client_id: string | null };
    if (row.client_id) clientIds.add(row.client_id);
  }

  const clientNameMap: Record<string, string> = {};
  if (clientIds.size > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', [...clientIds]);
    for (const c of clients ?? []) {
      clientNameMap[(c as { id: string; name: string }).id] = (c as { id: string; name: string }).name;
    }
  }

  const alerts: DashboardAlert[] = [];

  // IHC alerts
  for (const row of ihcRows.data ?? []) {
    const r = row as {
      id: string; client_id: string | null; severity: string; rule_id: string;
      evidence: Record<string, unknown>; created_at: string;
    };
    const clientName = r.client_id ? (clientNameMap[r.client_id] ?? null) : null;
    alerts.push({
      id: r.id,
      source_table: 'audit_findings',
      client_id: r.client_id,
      client_name: clientName,
      module: 'ihc',
      severity: r.severity as DashboardAlert['severity'],
      title: `Tag rule failed: ${r.rule_id}${clientName ? ` (${clientName})` : ''}`,
      description: `A tag configuration rule "${r.rule_id}" is failing and needs attention.`,
      created_at: r.created_at,
      is_new: r.created_at > since,
      is_reviewed: reviewedSet.has(`audit_findings:${r.id}`),
      action_url: r.client_id
        ? `/implementation-health?client_id=${r.client_id}`
        : '/implementation-health',
    });
  }

  // Reconciliation alerts
  for (const row of reconRows.data ?? []) {
    const r = row as {
      id: string; client_id: string | null; severity: string; dimension: string;
      platform: string; narrative: string; run_id: string; created_at: string;
    };
    const clientName = r.client_id ? (clientNameMap[r.client_id] ?? null) : null;
    // Map reconciliation severity to alert severity
    const severityMap: Record<string, DashboardAlert['severity']> = {
      critical: 'critical', error: 'high', warning: 'medium', info: 'info',
    };
    alerts.push({
      id: r.id,
      source_table: 'reconciliation_findings',
      client_id: r.client_id,
      client_name: clientName,
      module: 'reconciliation',
      severity: severityMap[r.severity] ?? 'medium',
      title: `${r.dimension} gap — ${r.platform}${clientName ? ` (${clientName})` : ''}`,
      description: r.narrative,
      created_at: r.created_at,
      is_new: r.created_at > since,
      is_reviewed: reviewedSet.has(`reconciliation_findings:${r.id}`),
      action_url: `/reconciliation/runs/${r.run_id}`,
    });
  }

  // DQM alerts
  for (const row of dqmRows.data ?? []) {
    const r = row as {
      id: string; gtag_url: string; checked_at: string; response_ms: number | null;
    };
    alerts.push({
      id: r.id,
      source_table: 'dqm_gtg_checks',
      client_id: null,
      client_name: null,
      module: 'dqm',
      severity: 'high',
      title: 'GTG endpoint failing',
      description: `The Google Tag endpoint at ${r.gtag_url} is returning errors.${r.response_ms ? ` Response time: ${r.response_ms}ms.` : ''}`,
      created_at: r.checked_at,
      is_new: r.checked_at > since,
      is_reviewed: reviewedSet.has(`dqm_gtg_checks:${r.id}`),
      action_url: '/health',
    });
  }

  // Health drop alerts
  const snapshots = (snapshotRows.data ?? []) as Array<{ overall_score: number; snapshot_at: string }>;
  if (snapshots.length >= 2) {
    const latest = snapshots[0];
    // Find the snapshot closest to (but not before) sinceTimestamp
    const baselines = snapshots.filter((s) => s.snapshot_at <= since);
    const baseline = baselines.length > 0 ? baselines[0] : snapshots[snapshots.length - 1];
    if (baseline && latest && baseline.snapshot_at !== latest.snapshot_at) {
      const drop = baseline.overall_score - latest.overall_score;
      if (drop >= HEALTH_DROP_ALERT_THRESHOLD) {
        const dropId = `health-drop-${userId}-${latest.snapshot_at}`;
        alerts.push({
          id: dropId,
          source_table: 'health_drop',
          client_id: null,
          client_name: null,
          module: 'health',
          severity: drop >= 15 ? 'critical' : 'high',
          title: `Health score dropped from ${Math.round(baseline.overall_score)} to ${Math.round(latest.overall_score)}`,
          description: `Your overall health score has dropped by ${Math.round(drop)} points since your last visit.`,
          created_at: latest.snapshot_at,
          is_new: latest.snapshot_at > since,
          is_reviewed: reviewedSet.has(`health_drop:${dropId}`),
          action_url: '/health',
        });
      }
    }
  }

  return alerts;
}

export async function getClientSummaries(orgId: string): Promise<DashboardClientSummary[]> {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('organisation_id', orgId)
    .eq('status', 'active')
    .order('name');

  if (!clients || clients.length === 0) return [];

  const clientIds = clients.map((c: { id: string }) => c.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [platformRows, deploymentRows, ihcCountRows, reconCountRows, sgtmRows, gtgRows, dmaRows, identityConfigRows] = await Promise.all([
    supabase
      .from('client_platforms')
      .select('client_id, platform')
      .in('client_id', clientIds)
      .eq('is_active', true),

    supabase
      .from('deployments')
      .select('client_id, last_generated_at')
      .in('client_id', clientIds),

    supabase
      .from('audit_findings')
      .select('client_id')
      .eq('organization_id', orgId)
      .in('status', ['open', 'acknowledged'])
      .is('resolved_at', null)
      .in('client_id', clientIds),

    supabase
      .from('reconciliation_findings')
      .select('client_id')
      .eq('organization_id', orgId)
      .is('resolved_at', null)
      .in('client_id', clientIds),

    // dqm_sgtm_checks is genuinely per-client (client_id column). Ordered desc
    // so the first row seen per client below is its latest check.
    supabase
      .from('dqm_sgtm_checks')
      .select('client_id, check_status, checked_at')
      .in('client_id', clientIds)
      .order('checked_at', { ascending: false }),

    // dqm_gtg_checks/dqm_dma_poll_state use a loose org_id column (no FK) that
    // agency flows already populate with client.id — same convention the
    // Data Manager Console (dataManager.ts) relies on for these two tables.
    supabase
      .from('dqm_gtg_checks')
      .select('org_id, check_status, checked_at')
      .in('org_id', clientIds)
      .order('checked_at', { ascending: false }),

    supabase
      .from('dqm_dma_poll_state')
      .select('org_id, consecutive_failures, avg_match_rate')
      .in('org_id', clientIds),

    // Only path from a client to its CAPI providers: capi_providers.identity_config_id
    // is nullable (only set once Signal Enrichment has been configured for the
    // client), so clients without it simply get null match-quality/dedup below.
    supabase
      .from('client_identity_configs')
      .select('id, client_id')
      .in('client_id', clientIds),
  ]);

  // ── Per-client DQM alert severity ────────────────────────────────────────────

  const sgtmLatestByClient: Record<string, string> = {};
  for (const row of sgtmRows.data ?? []) {
    const r = row as { client_id: string; check_status: string };
    if (!sgtmLatestByClient[r.client_id]) sgtmLatestByClient[r.client_id] = r.check_status;
  }

  const gtgLatestByClient: Record<string, string> = {};
  for (const row of gtgRows.data ?? []) {
    const r = row as { org_id: string; check_status: string };
    if (!gtgLatestByClient[r.org_id]) gtgLatestByClient[r.org_id] = r.check_status;
  }

  const dmaByClient: Record<string, { consecutive_failures: number; avg_match_rate: number | null }> = {};
  for (const row of dmaRows.data ?? []) {
    const r = row as { org_id: string; consecutive_failures: number; avg_match_rate: number | null };
    dmaByClient[r.org_id] = { consecutive_failures: r.consecutive_failures, avg_match_rate: r.avg_match_rate };
  }

  // ── Per-client CAPI match quality / dedup rate ───────────────────────────────

  const configIdToClientId: Record<string, string> = {};
  for (const row of identityConfigRows.data ?? []) {
    const r = row as { id: string; client_id: string };
    configIdToClientId[r.id] = r.client_id;
  }
  const configIds = Object.keys(configIdToClientId);

  const providerIdToClientId: Record<string, string> = {};
  if (configIds.length > 0) {
    const { data: providerRows } = await supabase
      .from('capi_providers')
      .select('id, identity_config_id')
      .in('identity_config_id', configIds);
    for (const row of providerRows ?? []) {
      const r = row as { id: string; identity_config_id: string };
      const clientId = configIdToClientId[r.identity_config_id];
      if (clientId) providerIdToClientId[r.id] = clientId;
    }
  }

  const capiAggByClient: Record<string, { qualitySum: number; qualityCount: number; dedupHit: number; dedupTotal: number }> = {};
  const providerIds = Object.keys(providerIdToClientId);
  if (providerIds.length > 0) {
    const { data: eventRows } = await supabase
      .from('capi_events')
      .select('provider_config_id, match_quality_score, dedup_status')
      .in('provider_config_id', providerIds)
      .gte('processed_at', sevenDaysAgo);

    for (const row of eventRows ?? []) {
      const r = row as { provider_config_id: string; match_quality_score: number | null; dedup_status: string | null };
      const clientId = providerIdToClientId[r.provider_config_id];
      if (!clientId) continue;
      const bucket = (capiAggByClient[clientId] ??= { qualitySum: 0, qualityCount: 0, dedupHit: 0, dedupTotal: 0 });
      if (r.match_quality_score !== null && r.match_quality_score !== undefined) {
        bucket.qualitySum += r.match_quality_score;
        bucket.qualityCount += 1;
      }
      if (r.dedup_status === 'hit' || r.dedup_status === 'miss') {
        bucket.dedupTotal += 1;
        if (r.dedup_status === 'hit') bucket.dedupHit += 1;
      }
    }
  }

  // Build lookup maps
  const platformMap: Record<string, string[]> = {};
  for (const row of platformRows.data ?? []) {
    const r = row as { client_id: string; platform: string };
    if (!platformMap[r.client_id]) platformMap[r.client_id] = [];
    platformMap[r.client_id].push(r.platform);
  }

  const deploymentMap: Record<string, { count: number; lastGenAt: string | null }> = {};
  for (const row of deploymentRows.data ?? []) {
    const r = row as { client_id: string; last_generated_at: string | null };
    if (!deploymentMap[r.client_id]) deploymentMap[r.client_id] = { count: 0, lastGenAt: null };
    deploymentMap[r.client_id].count++;
    if (r.last_generated_at &&
      (!deploymentMap[r.client_id].lastGenAt || r.last_generated_at > deploymentMap[r.client_id].lastGenAt!)) {
      deploymentMap[r.client_id].lastGenAt = r.last_generated_at;
    }
  }

  const findingsCountMap: Record<string, number> = {};
  for (const row of [...(ihcCountRows.data ?? []), ...(reconCountRows.data ?? [])]) {
    const r = row as { client_id: string | null };
    if (!r.client_id) continue;
    findingsCountMap[r.client_id] = (findingsCountMap[r.client_id] ?? 0) + 1;
  }

  const summaries: DashboardClientSummary[] = clients.map((c: { id: string; name: string }) => {
    const deployInfo = deploymentMap[c.id];
    const openCount = findingsCountMap[c.id] ?? 0;
    const setupStatus = deployInfo?.count ? 'complete' : 'in_progress';

    const dqmWorstSeverity = worstDqmSeverity(
      checkStatusSeverity(sgtmLatestByClient[c.id]),
      checkStatusSeverity(gtgLatestByClient[c.id]),
      dmaSeverity(dmaByClient[c.id]),
    );
    const dqmAlertCount = [sgtmLatestByClient[c.id], gtgLatestByClient[c.id]].filter((s) => checkStatusSeverity(s) !== null).length
      + (dmaSeverity(dmaByClient[c.id]) !== null ? 1 : 0);

    const capiAgg = capiAggByClient[c.id];
    const capiMatchQuality = capiAgg && capiAgg.qualityCount > 0
      ? Math.round((capiAgg.qualitySum / capiAgg.qualityCount) * 10) / 10
      : null;
    const capiDedupRate = capiAgg && capiAgg.dedupTotal > 0
      ? Math.round((capiAgg.dedupHit / capiAgg.dedupTotal) * 1000) / 10
      : null;

    // Base health level from findings alone (unchanged from before this sprint),
    // then DQM/CAPI signals can only escalate it, never de-escalate — an
    // already-critical/warning client never silently reads as healthier because
    // of new signals we didn't track before (the PRD explicitly calls out
    // avoiding a surprise status change for existing agency clients).
    let healthLevel: 'healthy' | 'warning' | 'critical' =
      openCount === 0 ? 'healthy' : openCount <= 2 ? 'warning' : 'critical';

    if (deployInfo) {
      if (dqmWorstSeverity === 'critical' || dqmWorstSeverity === 'high') {
        healthLevel = HEALTH_LEVEL_RANK['critical'] > HEALTH_LEVEL_RANK[healthLevel] ? 'critical' : healthLevel;
      } else if (dqmWorstSeverity === 'medium') {
        healthLevel = HEALTH_LEVEL_RANK['warning'] > HEALTH_LEVEL_RANK[healthLevel] ? 'warning' : healthLevel;
      }
      if (capiMatchQuality !== null && capiMatchQuality < LOW_CAPI_MATCH_QUALITY_THRESHOLD) {
        healthLevel = HEALTH_LEVEL_RANK['warning'] > HEALTH_LEVEL_RANK[healthLevel] ? 'warning' : healthLevel;
      }
    }

    return {
      id: c.id,
      name: c.name,
      setup_status: setupStatus as DashboardClientSummary['setup_status'],
      health_level: deployInfo ? healthLevel : 'unknown',
      signals_count: deployInfo?.count ?? 0,
      platforms_connected: platformMap[c.id] ?? [],
      last_verified_at: deployInfo?.lastGenAt ?? null,
      open_findings_count: openCount,
      dqm_alert_count: dqmAlertCount,
      dqm_worst_severity: dqmWorstSeverity,
      capi_match_quality_7d: capiMatchQuality,
      capi_dedup_rate_7d: capiDedupRate,
    };
  });

  // Worst first: health_level (which now folds in DQM/CAPI signals, not just
  // findings) ranks highest, then most open findings, alphabetical among ties —
  // so a principal sees which client needs attention without sorting manually.
  const HEALTH_SORT_RANK: Record<DashboardClientSummary['health_level'], number> = {
    critical: 3, warning: 2, unknown: 1, healthy: 0,
  };
  return summaries.sort((a, b) =>
    HEALTH_SORT_RANK[b.health_level] - HEALTH_SORT_RANK[a.health_level]
    || b.open_findings_count - a.open_findings_count
    || a.name.localeCompare(b.name));
}

export async function getOrgMetrics(orgId: string): Promise<OrgMetrics> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [clientCount, signalCount, capiCount, matchQualityRows, issueCount] = await Promise.all([
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('status', 'active'),

    supabase.rpc('count_org_signals', { p_org_id: orgId }).single().then((r) => r, () => ({ data: null })),

    supabase
      .from('capi_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', oneDayAgo),

    supabase
      .from('mv_signal_aggregates_daily')
      .select('match_quality_score')
      .eq('organization_id', orgId)
      .gte('event_date', sevenDaysAgo.slice(0, 10))
      .not('match_quality_score', 'is', null),

    supabase.rpc('count_clients_with_open_findings', { p_org_id: orgId }).single().then((r) => r, () => ({ data: null })),
  ]);

  // Compute avg match quality from the rows (RPC may not exist; fall back gracefully)
  let avgMatchQuality: number | null = null;
  const mqRows = matchQualityRows.data as Array<{ match_quality_score: number }> | null;
  if (mqRows && mqRows.length > 0) {
    avgMatchQuality = mqRows.reduce((sum, r) => sum + r.match_quality_score, 0) / mqRows.length;
  }

  // Total signals: derive from deployments if RPC not available
  let signalsMonitored = 0;
  if (signalCount.data !== null && typeof signalCount.data === 'number') {
    signalsMonitored = signalCount.data as number;
  } else {
    // Fallback: count deployed signals via signal_pack_signals
    const { data: clientIds } = await supabase
      .from('clients')
      .select('id')
      .eq('organisation_id', orgId)
      .eq('status', 'active');
    if (clientIds && clientIds.length > 0) {
      const ids = (clientIds as { id: string }[]).map((c) => c.id);
      const { data: packIds } = await supabase
        .from('deployments')
        .select('pack_id')
        .in('client_id', ids);
      const uniquePacks = [...new Set((packIds ?? []).map((p: { pack_id: string }) => p.pack_id))];
      if (uniquePacks.length > 0) {
        const { count } = await supabase
          .from('signal_pack_signals')
          .select('signal_id', { count: 'exact', head: true })
          .in('pack_id', uniquePacks);
        signalsMonitored = count ?? 0;
      }
    }
  }

  return {
    total_clients: clientCount.count ?? 0,
    total_signals_monitored: signalsMonitored,
    capi_events_24h: capiCount.count ?? 0,
    avg_match_quality_7d: avgMatchQuality !== null ? Math.round(avgMatchQuality * 10) / 10 : null,
    clients_with_issues: (issueCount.data as number | null) ?? 0,
  };
}

export async function getDashboardSummary(
  orgId: string,
  userId: string,
  sinceTimestampRaw: string | null,
): Promise<DashboardSummary> {
  const since = capSince(sinceTimestampRaw);

  const [alerts, clients, metrics] = await Promise.all([
    getAlerts(orgId, userId, sinceTimestampRaw),
    getClientSummaries(orgId),
    getOrgMetrics(orgId),
  ]);

  const newAlertsCount = alerts.filter((a) => a.is_new).length;

  return {
    delta: {
      since_label: sinceLabel(since, sinceTimestampRaw),
      since_timestamp: since,
      new_alerts_count: newAlertsCount,
    },
    alerts,
    clients,
    org_metrics: metrics,
  };
}
