import { auditQueue, planningQueue, healthQueue, channelQueue, scheduleRunnerQueue, offlineConversionQueue, googleOAuthRefreshQueue } from './jobQueue';
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
