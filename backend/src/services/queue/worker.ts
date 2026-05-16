import { auditQueue, planningQueue, healthQueue, channelQueue, scheduleRunnerQueue, offlineConversionQueue, googleOAuthRefreshQueue, usageSummaryQueue, crawlQueue, reconciliationSyncQueue, reconciliationRunQueue, reconciliationStatsQueue, reconciliationStaleResyncQueue, gtmContainerSyncQueue, ihcRulesQueue } from './jobQueue';
import type { GtmContainerSyncJobData, IhcRulesJobData } from './jobQueue';
import { runConfigSyncForConnection, getConnectionsDueForSync, runStatsSyncForConnection, getConnectionsDueForStatsSync, runStaleResyncForConnection, getConnectionsForStaleResync } from '@/services/reconciliation/sync/syncOrchestrator';
import { executeRun } from '@/services/reconciliation/reconciliationRunner';
import type { SyncJobData, StatsSyncJobData, StaleResyncJobData, ReconciliationJobData } from './jobQueue';
// Side-effect import: registers the crawl queue processor
import '@/services/crawl/crawlJob';
import { env } from '@/config/env';
import { runAuditOrchestrator } from '@/services/audit/orchestrator';
import { runPlanningOrchestrator, runRescanOrchestrator } from '@/services/planning/sessionOrchestrator';
import { runHealthPipeline, runHealthPipelineForActiveUsers } from '@/services/health/healthOrchestrator';
import { computeJourneysForUser } from '@/services/channels/journeyComputation';
import { runDiagnosticsForUser } from '@/services/channels/diagnosticEngine';
import { getPagesBySession } from '@/services/database/planningQueries';
import { supabaseAdmin } from '@/services/database/supabase';
import {
  getDueSchedules,
  markScheduleRan,
  getScheduleByAuditId,
  updateScheduleScore,
} from '@/services/database/scheduleQueries';
import { createAudit, getReport } from '@/services/database/queries';
import type { FunnelType, Region } from '@/types/audit';
import type { PlanningSession, PlanningPage } from '@/types/planning';
import logger from '@/utils/logger';

// ── Audit worker ──────────────────────────────────────────────────────────────

auditQueue.process(env.AUDIT_WORKER_CONCURRENCY, async (job) => {
  logger.info({ audit_id: job.data.audit_id, jobId: job.id, concurrency: env.AUDIT_WORKER_CONCURRENCY }, 'Audit job received');
  await runAuditOrchestrator(job.data);
});

logger.info('Audit queue worker registered');

// ── Regression detection after scheduled audit completes ──────────────────────
// When an audit triggered by a schedule finishes, compare the score to the
// previous stored score. If it drops by ≥5 points, create a health alert.

auditQueue.on('completed', async (job) => {
  const { scheduled_audit_id, audit_id } = job.data;
  if (!scheduled_audit_id) return; // Not a scheduled audit

  try {
    const report = await getReport(audit_id);
    if (!report) return;

    const currentScore = report.executive_summary.scores.conversion_signal_health;
    const schedule = await getScheduleByAuditId(audit_id);
    if (!schedule) return;

    const previousScore = schedule.last_audit_score;

    // Update the stored score
    await updateScheduleScore(scheduled_audit_id, currentScore);

    // Fire regression alert if score dropped ≥5 points
    if (previousScore !== null && currentScore < previousScore - 5) {
      const delta = Math.round(previousScore - currentScore);
      await supabaseAdmin.from('health_alerts').insert({
        user_id: schedule.user_id,
        alert_type: 'scheduled_audit_regression',
        severity: delta >= 15 ? 'critical' : 'warning',
        title: `Tracking regression detected — ${schedule.name}`,
        message: `Scheduled audit "${schedule.name}" detected a tracking regression. Score dropped ${delta} points (${previousScore} → ${currentScore}).`,
        is_active: true,
        details: {
          schedule_id: scheduled_audit_id,
          schedule_name: schedule.name,
          audit_id,
          previous_score: previousScore,
          current_score: currentScore,
          delta: -delta,
          website_url: schedule.website_url,
        },
      });
      logger.warn(
        { scheduleId: scheduled_audit_id, delta, currentScore, previousScore },
        'Scheduled audit regression detected — alert created',
      );
    }
  } catch (err) {
    // Non-fatal — don't fail the job over post-processing
    logger.error({ err, audit_id }, 'Failed to process scheduled audit completion');
  }
});

// ── Planning worker ───────────────────────────────────────────────────────────

planningQueue.process(env.PLANNING_WORKER_CONCURRENCY, async (job) => {
  const { session_id, job_type } = job.data as { session_id: string; job_type?: string };
  logger.info({ session_id, job_type: job_type ?? 'scan', jobId: job.id }, 'Planning job received');

  // Load session from DB
  const { data: sessionRow, error } = await supabaseAdmin
    .from('planning_sessions')
    .select('*')
    .eq('id', session_id)
    .single();

  if (error || !sessionRow) {
    throw new Error(`Planning session not found: ${session_id}`);
  }

  if (job_type === 'rescan') {
    await runRescanOrchestrator({ session: sessionRow as PlanningSession });
    return;
  }

  // Default: full scan
  const pages: PlanningPage[] = await getPagesBySession(session_id);
  if (pages.length === 0) {
    throw new Error(`Planning session has no pages: ${session_id}`);
  }

  await runPlanningOrchestrator({ session: sessionRow as PlanningSession, pages });
});

logger.info('Planning queue worker registered');

// ── Health worker ─────────────────────────────────────────────────────────────

healthQueue.process(async (job) => {
  logger.info({ trigger: job.data.trigger, userId: job.data.user_id }, 'Health job received');

  if (job.data.trigger === 'manual' && job.data.user_id) {
    await runHealthPipeline(job.data.user_id, job.data.website_url ?? undefined);
  } else {
    await runHealthPipelineForActiveUsers();
  }
});

logger.info('Health queue worker registered');

// Schedule recurring health computation every 15 minutes
// Bull deduplicates repeat jobs, so it's safe to call this on every startup.
healthQueue.add(
  { trigger: 'scheduled' },
  { repeat: { cron: '*/15 * * * *' }, jobId: 'health-scheduled' },
).catch((err) => logger.error({ err }, 'Failed to schedule health job'));

// ── Channel worker ────────────────────────────────────────────────────────────

channelQueue.process(async (job) => {
  logger.info({ trigger: job.data.trigger, userId: job.data.user_id }, 'Channel job received');

  if (job.data.trigger === 'manual' && job.data.user_id) {
    await computeJourneysForUser(job.data.user_id, job.data.website_url ?? undefined);
    await runDiagnosticsForUser(job.data.user_id, job.data.website_url ?? undefined);
  }
  // Scheduled full-run handled once active user enumeration is added (Phase 2)
});

logger.info('Channel queue worker registered');

// ── Schedule runner worker ────────────────────────────────────────────────────
// Runs every 5 minutes. Finds all due schedules, creates audits, and enqueues them.

scheduleRunnerQueue.process(async (_job) => {
  const due = await getDueSchedules();
  if (due.length === 0) return;

  logger.info({ count: due.length }, 'Schedule runner: dispatching due schedules');

  for (const schedule of due) {
    try {
      // Create the audit record (bypass rate limiter — this is a scheduled run)
      const audit = await createAudit({
        user_id: schedule.user_id,
        website_url: schedule.website_url,
        funnel_type: schedule.funnel_type as FunnelType,
        region: schedule.region as Region,
        test_email: (schedule as unknown as Record<string, unknown>)['test_email'] as string | undefined,
        test_phone: (schedule as unknown as Record<string, unknown>)['test_phone'] as string | undefined,
      });

      // Enqueue the audit job (include scheduled_audit_id for regression detection)
      await auditQueue.add({
        audit_id: audit.id,
        website_url: schedule.website_url,
        funnel_type: schedule.funnel_type,
        region: schedule.region,
        url_map: schedule.url_map,
        scheduled_audit_id: schedule.id,
      });

      // Mark the schedule as having run + compute next_run_at
      await markScheduleRan(
        schedule.id,
        audit.id,
        schedule.frequency,
        schedule.hour_utc,
        schedule.day_of_week,
      );

      logger.info(
        { scheduleId: schedule.id, auditId: audit.id, name: schedule.name },
        'Scheduled audit dispatched',
      );
    } catch (err) {
      logger.error({ err, scheduleId: schedule.id }, 'Failed to dispatch scheduled audit');
    }
  }
});

logger.info('Schedule runner worker registered');

// Schedule the runner to fire every 5 minutes
scheduleRunnerQueue.add(
  { trigger: 'scheduled' },
  { repeat: { cron: '*/5 * * * *' }, jobId: 'schedule-runner-tick' },
).catch((err) => logger.error({ err }, 'Failed to schedule the schedule runner'));

// ── Offline Conversion Upload worker ─────────────────────────────────────────
// Processes a confirmed CSV batch end-to-end:
//   1. Load config + valid rows from DB
//   2. Decrypt provider credentials from capi_providers
//   3. Route to Google or Meta upload service based on config.provider_type
//   4. Persist per-row results
//   5. Purge raw PII
//   6. Mark upload completed/partial/failed
//
// PII is never stored in the job payload — only upload_id + org_id.

offlineConversionQueue.process(1, async (job) => {
  const { upload_id, organization_id } = job.data;
  logger.info({ upload_id, jobId: job.id }, 'Offline conversion upload job received');

  // Import here to avoid circular dependency issues at startup
  const {
    getUpload,
    getConfig,
    getRowsForUpload,
    setUploadStatus,
    setUploadCompleted,
    bulkUpdateRowStatuses,
    purgeRawPii,
  } = await import('@/services/database/offlineConversionQueries');
  const { supabaseAdmin } = await import('@/services/database/supabase');
  const { safeDecryptCredentials } = await import('@/services/capi/credentials');

  // ── Load upload record ─────────────────────────────────────────────────────

  const upload = await getUpload(upload_id, organization_id);
  if (!upload) throw new Error(`Upload ${upload_id} not found`);
  if (upload.status !== 'confirmed') {
    logger.warn({ upload_id, status: upload.status }, 'Upload not in confirmed state — skipping');
    return;
  }

  await setUploadStatus(upload_id, 'uploading', {
    processing_started_at: new Date().toISOString(),
  });

  // ── Load config + credentials ──────────────────────────────────────────────

  const config = await getConfig(organization_id);
  if (!config) throw new Error(`No offline conversion config for org ${organization_id}`);
  if (!config.capi_provider_id) throw new Error('No CAPI provider linked to offline conversion config');

  const { data: providerRow, error: providerErr } = await supabaseAdmin
    .from('capi_providers')
    .select('credentials')
    .eq('id', config.capi_provider_id)
    .eq('organization_id', organization_id)
    .single();

  if (providerErr || !providerRow) {
    throw new Error(`Failed to load CAPI provider credentials: ${providerErr?.message ?? 'not found'}`);
  }

  const creds = safeDecryptCredentials(providerRow.credentials);

  // ── Load valid rows (skip invalid/duplicate) ───────────────────────────────

  const validRows = await getRowsForUpload(upload_id, ['valid']);
  if (validRows.length === 0) {
    logger.info({ upload_id }, 'No valid rows to upload');
    await setUploadStatus(upload_id, 'completed', { completed_at: new Date().toISOString() });
    await purgeRawPii(upload_id);
    return;
  }

  // ── Route to provider-specific upload service ──────────────────────────────

  let uploadResult: import('@/types/offline-conversions').UploadResult;
  let hashedData: Array<{ row_id: string; hashed_email: string | null; hashed_phone: string | null }>;

  if (config.provider_type === 'meta') {
    const { uploadMetaOfflineConversions, hashMetaRowIdentifiers } = await import(
      '@/services/offline-conversions/metaOfflineUpload'
    );

    // Meta uses long-lived access tokens — no refresh needed
    hashedData = hashMetaRowIdentifiers(validRows);
    uploadResult = await uploadMetaOfflineConversions(
      validRows,
      config,
      creds as import('@/types/capi').MetaCredentials,
    );
  } else {
    // Default: Google
    const { uploadOfflineConversions, hashRowIdentifiers } = await import(
      '@/services/offline-conversions/googleOfflineUpload'
    );
    const { refreshGoogleToken } = await import('@/services/capi/googleDelivery');

    const googleCreds = creds as import('@/types/capi').GoogleCredentials;
    let accessToken = googleCreds.oauth_access_token;
    try {
      accessToken = await refreshGoogleToken(googleCreds);
    } catch (refreshErr) {
      logger.warn(
        { err: refreshErr instanceof Error ? refreshErr.message : String(refreshErr) },
        'Google token refresh failed — using stored access token',
      );
    }

    hashedData = hashRowIdentifiers(validRows);
    uploadResult = await uploadOfflineConversions(validRows, config, googleCreds, accessToken);
  }

  // ── Persist hashed identifiers (before purging raw PII) ───────────────────

  for (const h of hashedData) {
    await supabaseAdmin
      .from('offline_conversion_rows')
      .update({ hashed_email: h.hashed_email, hashed_phone: h.hashed_phone })
      .eq('id', h.row_id);
  }

  // ── Persist per-row results ────────────────────────────────────────────────

  await bulkUpdateRowStatuses(upload_id, uploadResult.row_results);

  const uploadedCount = uploadResult.row_results.filter((r) => r.status === 'uploaded').length;
  const rejectedCount = uploadResult.row_results.filter((r) => r.status === 'rejected').length;

  // ── Complete upload record ─────────────────────────────────────────────────

  await setUploadCompleted(upload_id, uploadResult, uploadedCount, rejectedCount);

  // ── Purge raw PII ──────────────────────────────────────────────────────────

  const purgedCount = await purgeRawPii(upload_id);
  logger.info({ upload_id, purgedCount }, 'Raw PII purged after upload');

  logger.info(
    { upload_id, uploadedCount, rejectedCount, partialFailure: uploadResult.partial_failure, provider_type: config.provider_type },
    'Offline conversion upload job complete',
  );
});

logger.info('Offline conversion upload worker registered');

// ── Google OAuth Refresh worker ───────────────────────────────────────────────
// Runs every 30 minutes. For each active Google provider whose access token
// expires within 5 minutes (or has never been refreshed), attempts a refresh.
// On failure, sets provider status → reconnect_required.

googleOAuthRefreshQueue.process(async (_job) => {
  logger.info('Google OAuth refresh job received');

  const { supabaseAdmin } = await import('@/services/database/supabase');
  const { safeDecryptCredentials } = await import('@/services/capi/credentials');
  const { refreshGoogleTokenWithExpiry } = await import('@/services/capi/googleDelivery');
  const { updateGoogleToken, updateProviderStatus } = await import('@/services/database/capiQueries');

  // Find Google providers that are active/testing and whose token expires soon
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: providers, error } = await supabaseAdmin
    .from('capi_providers')
    .select('id, credentials, access_token_expires_at')
    .eq('provider', 'google')
    .in('status', ['active', 'testing'])
    .or(`access_token_expires_at.is.null,access_token_expires_at.lte.${fiveMinFromNow}`);

  if (error) {
    // Migration 20260518_001_google_oauth_fields.sql adds access_token_expires_at.
    // If it hasn't been applied yet, skip silently rather than spam error logs.
    if (error.message.includes('access_token_expires_at does not exist')) {
      logger.warn('Google OAuth refresh: access_token_expires_at column missing — apply migration 20260518_001_google_oauth_fields.sql');
      return;
    }
    logger.error({ err: error.message }, 'Google OAuth refresh: failed to query providers');
    return;
  }

  if (!providers || providers.length === 0) {
    logger.info('Google OAuth refresh: no providers need refreshing');
    return;
  }

  logger.info({ count: providers.length }, 'Google OAuth refresh: refreshing tokens');

  for (const row of providers) {
    try {
      const creds = safeDecryptCredentials(row.credentials);
      const googleCreds = creds as import('@/types/capi').GoogleCredentials;

      if (!googleCreds.oauth_refresh_token) {
        logger.warn({ providerId: row.id }, 'Google OAuth refresh: no refresh token — marking reconnect_required');
        await updateProviderStatus(row.id, 'reconnect_required', 'No OAuth refresh token stored. Please reconnect your Google account.');
        continue;
      }

      const { access_token, expires_at } = await refreshGoogleTokenWithExpiry(googleCreds);
      await updateGoogleToken(row.id, access_token, expires_at, creds);
      logger.info({ providerId: row.id, expiresAt: expires_at }, 'Google OAuth refresh: token refreshed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ providerId: row.id, err: msg }, 'Google OAuth refresh: refresh failed — marking reconnect_required');
      await updateProviderStatus(row.id, 'reconnect_required', `OAuth token refresh failed: ${msg}`).catch(() => {/* non-fatal */});
    }
  }
});

logger.info('Google OAuth refresh worker registered');

// Schedule the OAuth refresh to run every 30 minutes
googleOAuthRefreshQueue.add(
  { trigger: 'scheduled' },
  { repeat: { cron: '*/30 * * * *' }, jobId: 'google-oauth-refresh-tick' },
).catch((err) => logger.error({ err }, 'Failed to schedule Google OAuth refresh job'));

// ── Usage Summary worker ──────────────────────────────────────────────────────
// Refreshes the usage_monthly_summary materialized view nightly at 02:00 UTC.

usageSummaryQueue.process(async (_job) => {
  logger.info('Usage summary refresh job received');
  const { supabaseAdmin } = await import('@/services/database/supabase');
  const { error } = await supabaseAdmin.rpc('refresh_usage_monthly_summary');
  if (error) {
    logger.error({ err: error.message }, 'Usage summary refresh failed');
    throw new Error(error.message);
  }
  logger.info('Usage monthly summary refreshed');

  // Run Browserbase reconciliation after the summary is fresh so atlas_logged_minutes
  // reflects all events inserted today before the snapshot is taken.
  try {
    const { runBrowserbaseReconciliation } = await import('@/jobs/browserbaseReconciliation');
    await runBrowserbaseReconciliation();
  } catch (reconErr) {
    logger.error({ err: reconErr instanceof Error ? reconErr.message : String(reconErr) }, 'Browserbase reconciliation failed');
  }

  // Run fair-use cap check after summary is fresh
  try {
    const { runFairUseCapCheck } = await import('@/jobs/fairUseCap');
    await runFairUseCapCheck();
  } catch (capErr) {
    logger.error({ err: capErr instanceof Error ? capErr.message : String(capErr) }, 'Fair-use cap check failed');
  }

  // Run margin alert check after summary is fresh
  try {
    const { checkAndLogMarginAlerts } = await import('@/services/database/usageQueries');
    await checkAndLogMarginAlerts();
  } catch (alertErr) {
    // Non-fatal — don't fail the job over alert processing
    logger.error({ err: alertErr instanceof Error ? alertErr.message : String(alertErr) }, 'Margin alert check failed');
  }

  // Trigger scheduled crawls for orgs whose cadence is due today
  try {
    await triggerScheduledCrawls();
  } catch (crawlErr) {
    logger.error({ err: crawlErr instanceof Error ? crawlErr.message : String(crawlErr) }, 'Scheduled crawl trigger failed');
  }
});

logger.info('Usage summary worker registered');

usageSummaryQueue.add(
  { trigger: 'scheduled' },
  { repeat: { cron: '0 2 * * *' }, jobId: 'usage-summary-nightly' },
).catch((err) => logger.error({ err }, 'Failed to schedule usage summary refresh'));

// ── Scheduled crawl trigger ───────────────────────────────────────────────────
// Called nightly from usageSummaryQueue after fair-use and margin checks.
// For each org whose crawl cadence is due, creates a crawl_run + crawl_pages
// and enqueues a job into crawlQueue.

async function triggerScheduledCrawls(): Promise<void> {
  const { listActiveSubscriptions } = await import('@/services/database/subscriptionQueries');
  const { discoverPages } = await import('@/services/crawl/pageDiscovery');
  const { ATLAS_PRICING } = await import('@/config/pricing');
  type AtlasTierKey = keyof typeof ATLAS_PRICING;

  const orgs = await listActiveSubscriptions();
  if (!orgs.length) return;

  logger.info({ count: orgs.length }, 'Scheduled crawl trigger: checking orgs');

  for (const org of orgs) {
    try {
      const tierConfig = ATLAS_PRICING[org.tier as AtlasTierKey];
      if (!tierConfig) continue;

      const due = await isCrawlDue(org.org_id, tierConfig.scans_per_month);
      if (!due) continue;

      const pages = await discoverPages(org.org_id, org.tier);
      if (!pages.length) continue;

      const { data: crawlRun, error: runError } = await supabaseAdmin
        .from('crawl_runs')
        .insert({
          org_id:       org.org_id,
          mode:         'scheduled',
          status:       'queued',
          triggered_by: 'system',
          total_pages:  pages.length,
        })
        .select('id')
        .single();

      if (runError || !crawlRun) {
        logger.error({ org_id: org.org_id, err: runError?.message }, 'Failed to create scheduled crawl run');
        continue;
      }

      const { data: pageRows, error: pageError } = await supabaseAdmin
        .from('crawl_pages')
        .insert(
          pages.map(p => ({
            crawl_run_id: crawlRun.id,
            org_id:       org.org_id,
            url:          p.url,
            url_type:     p.url_type,
            domain:       p.domain,
            status:       'pending',
          })),
        )
        .select('id, url');

      if (pageError || !pageRows) {
        logger.error({ org_id: org.org_id, err: pageError?.message }, 'Failed to create scheduled crawl pages');
        continue;
      }

      const urlToPageId = new Map(pageRows.map(r => [r.url as string, r.id as string]));
      const pagesWithIds = pages.map(p => ({
        ...p,
        crawl_page_id: urlToPageId.get(p.url) ?? '',
      }));

      await crawlQueue.add({
        org_id:       org.org_id,
        crawl_run_id: crawlRun.id,
        mode:         'scheduled',
        pages:        pagesWithIds,
        tier:         org.tier,
      });

      logger.info({ org_id: org.org_id, crawl_run_id: crawlRun.id, pages: pages.length }, 'Scheduled crawl queued');
    } catch (orgErr) {
      logger.error(
        { org_id: org.org_id, err: orgErr instanceof Error ? orgErr.message : String(orgErr) },
        'Failed to trigger scheduled crawl for org',
      );
    }
  }
}

async function isCrawlDue(org_id: string, scans_per_month: number): Promise<boolean> {
  const daysBetweenScans = Math.floor(30 / scans_per_month);

  const { data: lastRun } = await supabaseAdmin
    .from('crawl_runs')
    .select('created_at')
    .eq('org_id', org_id)
    .eq('triggered_by', 'system')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastRun) return true; // Never run — run now

  const daysSinceLastRun = Math.floor(
    (Date.now() - new Date(lastRun.created_at).getTime()) / (1000 * 60 * 60 * 24),
  );

  return daysSinceLastRun >= daysBetweenScans;
}

// ── Reconciliation Sync Worker ────────────────────────────────────────────────

reconciliationSyncQueue.process(3, async (job) => {
  await runConfigSyncForConnection(job.data as SyncJobData);
});

logger.info('Reconciliation sync queue worker registered');

// 6-hourly repeatable job: find connections due for sync and enqueue them
reconciliationSyncQueue.add(
  { connectionId: '__scheduler__', orgId: '__scheduler__', platform: 'google_ads' } as SyncJobData,
  {
    repeat: { cron: '0 */6 * * *' },
    jobId: 'recon-sync-scheduler',
  },
);

// Override: when the scheduler job runs, find and enqueue real connection jobs
reconciliationSyncQueue.process('__scheduler__', async () => {
  const due = await getConnectionsDueForSync();
  for (const job of due) {
    await reconciliationSyncQueue.add(job, {
      jobId: `recon-sync-${job.connectionId}`,
      removeOnComplete: true,
    });
  }
  logger.info({ count: due.length }, 'Reconciliation sync jobs enqueued');
});

// ── Reconciliation Run Worker ─────────────────────────────────────────────────

reconciliationRunQueue.process(2, async (job) => {
  await executeRun(job.data as ReconciliationJobData);
});

logger.info('Reconciliation run queue worker registered');

// ── Reconciliation Stats Worker ───────────────────────────────────────────────
// 24-hour cron: pull daily event counts from platform APIs for all active connections.

reconciliationStatsQueue.process(3, async (job) => {
  await runStatsSyncForConnection(job.data as StatsSyncJobData);
});

logger.info('Reconciliation stats queue worker registered');

// 24-hourly scheduler: find connections due for stats sync and enqueue them
reconciliationStatsQueue.add(
  { connectionId: '__stats_scheduler__', orgId: '__stats_scheduler__', clientId: '__stats_scheduler__', platform: 'google_ads' } as StatsSyncJobData,
  {
    repeat: { cron: '30 1 * * *' },  // 01:30 UTC daily
    jobId: 'recon-stats-scheduler',
  },
);

reconciliationStatsQueue.process('__stats_scheduler__', async () => {
  const due = await getConnectionsDueForStatsSync();
  for (const job of due) {
    await reconciliationStatsQueue.add(job, {
      jobId: `recon-stats-${job.connectionId}`,
      removeOnComplete: true,
    });
  }
  logger.info({ count: due.length }, 'Reconciliation stats jobs enqueued');
});

// ── Reconciliation Stale Resync Worker ───────────────────────────────────────
// Re-pulls last 30 days of event stats daily at 03:00 UTC.
// Overwrites existing rows via UPSERT to capture retroactive platform corrections.

reconciliationStaleResyncQueue.process(2, async (job) => {
  await runStaleResyncForConnection(job.data as StaleResyncJobData);
});

logger.info('Reconciliation stale resync queue worker registered');

reconciliationStaleResyncQueue.add(
  { connectionId: '__stale_scheduler__', orgId: '__stale_scheduler__', clientId: '__stale_scheduler__', platform: 'google_ads', daysBack: 30 } as StaleResyncJobData,
  {
    repeat: { cron: '0 3 * * *' },  // 03:00 UTC daily
    jobId: 'recon-stale-resync-scheduler',
  },
);

reconciliationStaleResyncQueue.process('__stale_scheduler__', async () => {
  const connections = await getConnectionsForStaleResync();
  for (const job of connections) {
    await reconciliationStaleResyncQueue.add(job, {
      jobId: `recon-stale-${job.connectionId}`,
      removeOnComplete: true,
    });
  }
  logger.info({ count: connections.length }, 'Reconciliation stale resync jobs enqueued');
});

// ── GTM Container Sync Worker ─────────────────────────────────────────────────
// For OAuth connections: fetches the live container from the GTM API, writes
// a new snapshot row if the version changed, then enqueues ihcRulesQueue.
// For manual uploads: skip_fetch=true so only the IHC rules enqueue step runs.
// Credentials are loaded from DB — never stored in the job payload.

gtmContainerSyncQueue.process(2, async (job) => {
  const data = job.data as GtmContainerSyncJobData;
  logger.info({ connectionId: data.connection_id, jobId: job.id }, 'GTM container sync job received');

  const { supabaseAdmin } = await import('@/services/database/supabase');
  const { parseContainerJson } = await import('@/services/gtm/containerParser');
  const { refreshGtmToken } = await import('@/api/routes/gtm');

  const { data: connection, error: connErr } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('id, organization_id, property_id, container_id, account_id, auth_method, last_container_json_snapshot_id')
    .eq('id', data.connection_id)
    .single();

  if (connErr || !connection) {
    throw new Error(`GTM connection not found: ${data.connection_id}`);
  }

  let snapshotId = data.snapshot_id;

  if (!data.skip_fetch && connection.auth_method === 'oauth') {
    const accessToken = await refreshGtmToken(connection.id);

    // Fetch the live container version from GTM API
    const accountId = connection.account_id ?? '';
    const containerId = connection.container_id;
    const apiUrl = `https://www.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/versions:live`;

    const apiResponse = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!apiResponse.ok) {
      const body = await apiResponse.text();
      throw new Error(`GTM API fetch failed (${apiResponse.status}): ${body}`);
    }

    const containerJson = await apiResponse.json() as Record<string, unknown>;
    const snapshot = parseContainerJson(containerJson, 'gtm_api');

    // Check if version actually changed before writing a new snapshot row
    const { data: lastSnap } = await supabaseAdmin
      .from('gtm_container_snapshots')
      .select('container_version')
      .eq('id', connection.last_container_json_snapshot_id ?? '')
      .maybeSingle();

    if (lastSnap?.container_version === snapshot.container_id) {
      logger.info({ connectionId: connection.id }, 'GTM container version unchanged — skipping snapshot');
      return;
    }

    // Deactivate previous snapshot
    await supabaseAdmin
      .from('gtm_container_snapshots')
      .update({ is_active: false })
      .eq('connection_id', connection.id)
      .eq('is_active', true);

    const { data: newSnap, error: snapErr } = await supabaseAdmin
      .from('gtm_container_snapshots')
      .insert({
        connection_id: connection.id,
        organization_id: data.organization_id,
        container_json: containerJson,
        container_version: snapshot.container_id,
        is_active: true,
      })
      .select('id')
      .single();

    if (snapErr || !newSnap) {
      throw new Error(`Failed to store container snapshot: ${snapErr?.message}`);
    }

    snapshotId = newSnap.id;

    await supabaseAdmin
      .from('gtm_container_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_container_json_snapshot_id: snapshotId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);
  }

  if (!snapshotId) {
    logger.warn({ connectionId: connection.id }, 'No snapshot_id after sync — skipping IHC rules');
    return;
  }

  // Enqueue IHC rules run (Sprint A2 worker will process this)
  await ihcRulesQueue.add({
    connection_id: connection.id,
    snapshot_id: snapshotId,
    organization_id: data.organization_id,
    property_id: connection.property_id,
  });

  logger.info({ connectionId: connection.id, snapshotId }, 'IHC rules job enqueued after container sync');
});

logger.info('GTM container sync worker registered');

// Hourly cron: re-sync all OAuth-connected containers
gtmContainerSyncQueue.add(
  { connection_id: '__scheduler__', organization_id: '__scheduler__' },
  { repeat: { cron: '0 * * * *' }, jobId: 'gtm-sync-hourly' },
).catch((err) => logger.error({ err }, 'Failed to schedule GTM container sync'));

gtmContainerSyncQueue.process('__scheduler__', async () => {
  const { supabaseAdmin } = await import('@/services/database/supabase');

  const { data: connections, error } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('id, organization_id')
    .eq('auth_method', 'oauth');

  if (error) {
    logger.error({ err: error.message }, 'GTM sync scheduler: failed to list connections');
    return;
  }

  if (!connections?.length) return;

  for (const conn of connections) {
    await gtmContainerSyncQueue.add(
      { connection_id: conn.id, organization_id: conn.organization_id },
      { jobId: `gtm-sync-${conn.id}`, removeOnComplete: true },
    );
  }

  logger.info({ count: connections.length }, 'GTM container sync jobs enqueued');
});

// ── IHC Rules Worker ──────────────────────────────────────────────────────────
// Loads the container snapshot, runs all tag_configuration rules, upserts
// findings into audit_findings.
// Sprint A2 will register the actual rule functions — this worker is the
// harness that loads them dynamically so Sprint A1 can ship standalone.

ihcRulesQueue.process(2, async (job) => {
  const data = job.data as IhcRulesJobData;
  logger.info({ snapshotId: data.snapshot_id, connectionId: data.connection_id, jobId: job.id }, 'IHC rules job received');

  const { supabaseAdmin } = await import('@/services/database/supabase');
  const { parseContainerJson } = await import('@/services/gtm/containerParser');
  const { upsertFindings } = await import('@/services/ihc/findingsWriter');

  // Load snapshot
  const { data: snap, error: snapErr } = await supabaseAdmin
    .from('gtm_container_snapshots')
    .select('container_json, connection_id')
    .eq('id', data.snapshot_id)
    .single();

  if (snapErr || !snap) {
    throw new Error(`Snapshot not found: ${data.snapshot_id}`);
  }

  const containerSnapshot = parseContainerJson(snap.container_json as Record<string, unknown>, 'gtm_api');

  // Dynamically import tag_configuration rules (registered in Sprint A2)
  let tagConfigRules: Array<{
    rule_id: string;
    validation_layer: string;
    severity: string;
    test: (auditData: { gtmContainer: typeof containerSnapshot }) => { rule_id: string; status: string; technical_details: { evidence: string[] } };
  }>;

  try {
    const rulesModule = await import('@/services/ihc/tagConfigurationRules');
    tagConfigRules = rulesModule.TAG_CONFIGURATION_RULES ?? [];
  } catch {
    // Sprint A2 not yet deployed — skip gracefully
    logger.info({ snapshotId: data.snapshot_id }, 'IHC rules worker: tagConfigurationRules not yet available');
    return;
  }

  const auditInput = { gtmContainer: containerSnapshot };
  const passingRuleIds: string[] = [];
  const failingFindings: import('@/services/ihc/findingsWriter').FindingInput[] = [];

  for (const rule of tagConfigRules) {
    const result = rule.test(auditInput);
    if (result.status === 'skipped') continue;

    if (result.status === 'pass') {
      passingRuleIds.push(rule.rule_id);
    } else {
      failingFindings.push({
        organization_id: data.organization_id,
        property_id: data.property_id,
        rule_id: rule.rule_id,
        validation_layer: rule.validation_layer as import('@/types/audit').ValidationLayer,
        severity: rule.severity as import('@/types/audit').Severity,
        evidence: {
          snapshot_id: data.snapshot_id,
          connection_id: data.connection_id,
          details: result.technical_details.evidence,
          status: result.status,
        },
      });
    }
  }

  await upsertFindings(passingRuleIds, failingFindings);

  logger.info(
    { snapshotId: data.snapshot_id, passing: passingRuleIds.length, failing: failingFindings.length },
    'IHC rules run complete',
  );
});

logger.info('IHC rules worker registered');
