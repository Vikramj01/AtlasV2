import Bull from 'bull';
import { env } from '@/config/env';
import logger from '@/utils/logger';

export interface AuditJobData {
  audit_id: string;
  website_url: string;
  funnel_type: string;
  region: string;
  url_map: Record<string, string>;
  // test_email / test_phone are intentionally excluded — they are PII and are
  // stored in the audits table (DB) instead of in the Redis queue payload.
  // The orchestrator loads them via getAudit(audit_id).
  // Journey Builder fields (present when audit is driven by a saved journey)
  journey_id?: string;
  validation_spec?: unknown;
  // Scheduled audit: set when the audit was triggered by a schedule
  scheduled_audit_id?: string;
}

// Parse REDIS_URL into explicit options so ioredis handles TLS correctly
// (passing a rediss:// URL string to Bull doesn't reliably enable TLS)
function buildRedisOpts(url: string): object {
  const parsed = new URL(url);
  const opts: Record<string, unknown> = {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username && parsed.username !== 'default' ? parsed.username : undefined,
  };
  if (parsed.protocol === 'rediss:') {
    opts['tls'] = { rejectUnauthorized: false };
  }
  return opts;
}

export const auditQueue = new Bull<AuditJobData>('audit', {
  redis: buildRedisOpts(env.REDIS_URL),
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

// ── Planning Queue ────────────────────────────────────────────────────────────

export interface PlanningJobData {
  session_id: string;
}

export const planningQueue = new Bull<PlanningJobData>('planning', {
  redis: buildRedisOpts(env.REDIS_URL),
  defaultJobOptions: {
    attempts: 1,                              // No retry — failed sessions must be restarted by user
    timeout: 10 * 60 * 1000,                 // 10-minute timeout (vs 5 min for audits)
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

planningQueue.on('error', (err) => {
  logger.error({ err }, 'Planning queue error');
});

planningQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, sessionId: job.data.session_id }, 'Planning job completed');
});

planningQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, sessionId: job?.data?.session_id, err: err.message }, 'Planning job failed');
});

planningQueue.on('stalled', (job) => {
  logger.warn({ jobId: job.id, sessionId: job.data.session_id }, 'Planning job stalled');
});

// ── Health Queue ──────────────────────────────────────────────────────────────
// Runs the health score computation for all active users every 15 minutes.
// Uses Bull's repeat/cron feature — only one worker should process this.

export interface HealthJobData {
  trigger: 'scheduled' | 'manual';
  user_id?: string; // present for manual single-user runs
}

export const healthQueue = new Bull<HealthJobData>('health', {
  redis: buildRedisOpts(env.REDIS_URL),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 10,
    removeOnFail: 10,
  },
});

healthQueue.on('error', (err) => {
  logger.error({ err }, 'Health queue error');
});

healthQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, trigger: job.data.trigger }, 'Health job completed');
});

healthQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Health job failed');
});

// ── Schedule Runner Queue ─────────────────────────────────────────────────────
// Fires every 5 minutes and dispatches any due scheduled audits.

export interface ScheduleRunnerJobData {
  trigger: 'scheduled';
}

export const scheduleRunnerQueue = new Bull<ScheduleRunnerJobData>('schedule-runner', {
  redis: buildRedisOpts(env.REDIS_URL),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 10,
    removeOnFail: 10,
  },
});

scheduleRunnerQueue.on('error', (err) => {
  logger.error({ err }, 'Schedule runner queue error');
});

scheduleRunnerQueue.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Schedule runner job completed');
});

scheduleRunnerQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Schedule runner job failed');
});

