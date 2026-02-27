import { auditQueue } from './jobQueue';
import { runAuditOrchestrator } from '@/services/audit/orchestrator';
import logger from '@/utils/logger';

auditQueue.process(async (job) => {
  logger.info({ audit_id: job.data.audit_id, jobId: job.id }, 'Audit job received');
  await runAuditOrchestrator(job.data);
});

logger.info('Audit queue worker registered');
