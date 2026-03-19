import { auditQueue, planningQueue, healthQueue, scheduleRunnerQueue } from './jobQueue';
import { runAuditOrchestrator } from '@/services/audit/orchestrator';
import { runPlanningOrchestrator, runRescanOrchestrator } from '@/services/planning/sessionOrchestrator';
import { runHealthPipeline, runHealthPipelineForActiveUsers } from '@/services/health/healthOrchestrator';
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

auditQueue.process(async (job) => {
  logger.info({ audit_id: job.data.audit_id, jobId: job.id }, 'Audit job received');
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
        message: `Scheduled audit "${schedule.name}" detected a tracking regression.`,
        details: {
          schedule_id: scheduled_audit_id,
          schedule_name: schedule.name,
          audit_id,
          previous_score: previousScore,
          current_score: currentScore,
          delta: -delta,
          website_url: schedule.website_url,
        },
        status: 'active',
        created_at: new Date().toISOString(),
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

planningQueue.process(async (job) => {
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
