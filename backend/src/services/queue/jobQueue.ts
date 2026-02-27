import Bull from 'bull';
import { env } from '@/config/env';
import logger from '@/utils/logger';

export interface AuditJobData {
  audit_id: string;
  website_url: string;
  funnel_type: string;
  region: string;
  url_map: Record<string, string>;
  test_email?: string;
  test_phone?: string;
}

export const auditQueue = new Bull<AuditJobData>('audit', {
  redis: env.REDIS_URL,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

auditQueue.on('error', (err) => {
  logger.error({ err }, 'Audit queue error');
});

auditQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, auditId: job.data.audit_id }, 'Audit job completed');
});

auditQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, auditId: job?.data?.audit_id, err: err.message }, 'Audit job failed');
});

auditQueue.on('stalled', (job) => {
  logger.warn({ jobId: job.id, auditId: job.data.audit_id }, 'Audit job stalled');
});
