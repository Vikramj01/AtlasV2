import { auditQueue, planningQueue } from './jobQueue';
import { runAuditOrchestrator } from '@/services/audit/orchestrator';
import { runPlanningOrchestrator } from '@/services/planning/sessionOrchestrator';
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
  const { session_id } = job.data;
  logger.info({ session_id, jobId: job.id }, 'Planning job received');

  // Load session + pages from DB (job is internal — no userId ownership check needed)
  const { data: sessionRow, error } = await supabaseAdmin
    .from('planning_sessions')
    .select('*')
    .eq('id', session_id)
    .single();

  if (error || !sessionRow) {
    throw new Error(`Planning session not found: ${session_id}`);
  }

  const pages: PlanningPage[] = await getPagesBySession(session_id);
  if (pages.length === 0) {
    throw new Error(`Planning session has no pages: ${session_id}`);
  }

  await runPlanningOrchestrator({ session: sessionRow as PlanningSession, pages });
});

logger.info('Planning queue worker registered');
