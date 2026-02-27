import { auditQueue } from './jobQueue';
import { updateAuditStatus } from '@/services/database/queries';
import logger from '@/utils/logger';

// Placeholder worker — Sprint 2 wires in the full orchestrator
auditQueue.process(async (job) => {
  const { audit_id } = job.data;
  logger.info({ audit_id }, 'Audit job received — orchestrator not yet implemented (Sprint 2)');

  await updateAuditStatus(audit_id, 'running', { progress: 0 });

  // Sprint 2: replace this with full orchestrator call
  // await runAuditOrchestrator(job.data);

  logger.info({ audit_id }, 'Worker placeholder complete');
});

logger.info('Audit queue worker registered');
