import { auditQueue, planningQueue, healthQueue } from './jobQueue';
import { runAuditOrchestrator } from '@/services/audit/orchestrator';
import { runPlanningOrchestrator, runRescanOrchestrator } from '@/services/planning/sessionOrchestrator';
import { runHealthPipeline, runHealthPipelineForActiveUsers } from '@/services/health/healthOrchestrator';
import { getPagesBySession } from '@/services/database/planningQueries';
import { supabaseAdmin } from '@/services/database/supabase';
import type { PlanningSession, PlanningPage } from '@/types/planning';
import logger from '@/utils/logger';

// ── Audit worker ──────────────────────────────────────────────────────────────

auditQueue.process(async (job) => {
  logger.info({ audit_id: job.data.audit_id, jobId: job.id }, 'Audit job received');
  await runAuditOrchestrator(job.data);
});

logger.info('Audit queue worker registered');

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
    await runHealthPipeline(job.data.user_id);
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
