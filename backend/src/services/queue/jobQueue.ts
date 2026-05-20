import Bull from 'bull';
import IORedis from 'ioredis';
import type { RedisOptions } from 'ioredis';
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

// Parse REDIS_URL into explicit ioredis options so TLS is handled correctly.
// enableReadyCheck: false + maxRetriesPerRequest: null are required by Bull.
// retryStrategy + keepAlive prevent ECONNRESET/EPIPE on Render-managed Redis.
function buildRedisOpts(url: string): RedisOptions {
  const parsed = new URL(url);
  const opts: RedisOptions = {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username && parsed.username !== 'default' ? parsed.username : undefined,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    keepAlive: 10_000,
    retryStrategy: (times: number) => Math.min(times * 500, 30_000),
    reconnectOnError: (err: Error) => err.message.includes('READONLY'),
  };
  if (parsed.protocol === 'rediss:') {
    opts.tls = { rejectUnauthorized: false };
  }
  return opts;
}

// Bull creates 3 ioredis connections per queue (client, subscriber, bclient).
// With 16 queues that's 48 connections — well above Render's starter Redis limit.
// Sharing a single client + subscriber across all queues drops this to
// 2 + N_queues (one bclient per queue for blocking BRPOPLPUSH).
//
// IMPORTANT: if errors appear for EVERY queue simultaneously, the root cause is
// the shared client or subscriber reconnecting — not 16 independent failures.
// Monitor sharedClient/sharedSubscriber error events, not per-queue events.
const redisOpts = buildRedisOpts(env.REDIS_URL);
const sharedClient = new IORedis(redisOpts);
const sharedSubscriber = new IORedis(redisOpts);

sharedClient.on('error', (err) => logger.error({ err }, 'Redis shared client error'));
sharedClient.on('reconnecting', (delay: number) => logger.warn({ delay }, 'Redis shared client reconnecting'));
sharedSubscriber.on('error', (err) => logger.error({ err }, 'Redis shared subscriber error'));
sharedSubscriber.on('reconnecting', (delay: number) => logger.warn({ delay }, 'Redis shared subscriber reconnecting'));

function createClient(type: 'client' | 'subscriber' | 'bclient'): IORedis {
  if (type === 'client') return sharedClient;
  if (type === 'subscriber') return sharedSubscriber;
  // bclient must be a dedicated connection per queue (used for blocking BRPOPLPUSH).
  // lazyConnect: true defers the TCP connection until the first command, so all
  // 16 bclients don't hammer Redis simultaneously at startup.
  return new IORedis({ ...redisOpts, lazyConnect: true });
}

function makeBullOpts(defaultJobOptions?: Bull.JobOptions): Bull.QueueOptions {
  return { createClient, defaultJobOptions };
}

export const auditQueue = new Bull<AuditJobData>('audit', makeBullOpts({
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 50,
}));

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

export const planningQueue = new Bull<PlanningJobData>('planning', makeBullOpts({
  attempts: 1,                              // No retry — failed sessions must be restarted by user
  timeout: 10 * 60 * 1000,                 // 10-minute timeout (vs 5 min for audits)
  removeOnComplete: 100,
  removeOnFail: 50,
}));

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
  user_id?: string;     // present for manual single-user runs
  website_url?: string; // optional site filter for manual runs
}

export const healthQueue = new Bull<HealthJobData>('health', makeBullOpts({
  attempts: 1,
  removeOnComplete: 10,
  removeOnFail: 10,
}));

healthQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, trigger: job.data.trigger }, 'Health job completed');
});

healthQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Health job failed');
});

// ── Channel Queue ─────────────────────────────────────────────────────────────
// Runs journey computation + diagnostic engine for channel signal behaviour.

export interface ChannelJobData {
  trigger: 'scheduled' | 'manual';
  user_id?: string;     // present for manual single-user runs
  website_url?: string; // optional site filter
}

export const channelQueue = new Bull<ChannelJobData>('channel', makeBullOpts({
  attempts: 1,
  timeout: 5 * 60 * 1000,
  removeOnComplete: 10,
  removeOnFail: 10,
}));

channelQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, trigger: job.data.trigger }, 'Channel job completed');
});

channelQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Channel job failed');
});

// ── Schedule Runner Queue ─────────────────────────────────────────────────────
// Fires every 5 minutes and dispatches any due scheduled audits.

export interface ScheduleRunnerJobData {
  trigger: 'scheduled';
}

export const scheduleRunnerQueue = new Bull<ScheduleRunnerJobData>('schedule-runner', makeBullOpts({
  attempts: 1,
  removeOnComplete: 10,
  removeOnFail: 10,
}));

scheduleRunnerQueue.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Schedule runner job completed');
});

scheduleRunnerQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Schedule runner job failed');
});

// ── Offline Conversion Upload Queue ───────────────────────────────────────────
// Processes a confirmed CSV batch: hashes PII, uploads to Google Ads,
// persists per-row results, and calls purge_raw_pii().
// Retries: 3 attempts with 30s/60s/120s exponential backoff (PRD spec).
// PII is intentionally NOT included in the job payload — the upload_id
// is used to load rows from the DB inside the worker.

export interface OfflineConversionJobData {
  upload_id: string;
  organization_id: string;
}

export const offlineConversionQueue = new Bull<OfflineConversionJobData>('offline-conversion-upload', makeBullOpts({
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 100,
  removeOnFail: 50,
}));

offlineConversionQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, uploadId: job.data.upload_id }, 'Offline conversion upload job completed');
});

offlineConversionQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, uploadId: job?.data?.upload_id, err: err.message }, 'Offline conversion upload job failed');
});

offlineConversionQueue.on('stalled', (job) => {
  logger.warn({ jobId: job.id, uploadId: job.data.upload_id }, 'Offline conversion upload job stalled');
});

// ── Google OAuth Refresh Queue ─────────────────────────────────────────────────
// Runs every 30 minutes. Proactively refreshes Google OAuth access tokens before
// they expire, and sets status → reconnect_required on refresh failure.
// PII (credentials) are loaded from DB inside the worker — NOT in the payload.

export interface GoogleOAuthRefreshJobData {
  trigger: 'scheduled';
}

export const googleOAuthRefreshQueue = new Bull<GoogleOAuthRefreshJobData>('google-oauth-refresh', makeBullOpts({
  attempts: 1,
  removeOnComplete: 10,
  removeOnFail: 10,
}));

googleOAuthRefreshQueue.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Google OAuth refresh job completed');
});

googleOAuthRefreshQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Google OAuth refresh job failed');
});

// ── Usage Summary Queue ────────────────────────────────────────────────────────
// Refreshes usage_monthly_summary materialized view nightly at 02:00 UTC.

export interface UsageSummaryJobData {
  trigger: 'scheduled';
}

export const usageSummaryQueue = new Bull<UsageSummaryJobData>('usage-summary', makeBullOpts({
  attempts: 1,
  removeOnComplete: 10,
  removeOnFail: 10,
}));

usageSummaryQueue.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Usage summary refresh completed');
});

usageSummaryQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Usage summary refresh failed');
});

// ── Crawl Queue ───────────────────────────────────────────────────────────────
// Runs Browserbase/Playwright page batches for the Crawl Signal Extractor.
// Onboarding crawls are triggered by the /api/crawl/trigger endpoint.
// Scheduled crawls are triggered nightly by the usageSummaryQueue worker.

import type { CrawlJobData } from '@/types/crawl';
export type { CrawlJobData };

export const crawlQueue = new Bull<CrawlJobData>('crawl', makeBullOpts({
  attempts:         3,
  backoff:          { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail:     50,
  timeout:          25 * 60 * 1000, // 25-minute hard cap (12 pages × ~2 min each + headroom)
}));

crawlQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, org_id: job.data.org_id, crawl_run_id: job.data.crawl_run_id }, 'Crawl job completed');
});

crawlQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, org_id: job?.data?.org_id, crawl_run_id: job?.data?.crawl_run_id, err: err.message }, 'Crawl job failed');
});

crawlQueue.on('stalled', (job) => {
  logger.warn({ jobId: job.id, org_id: job.data.org_id, crawl_run_id: job.data.crawl_run_id }, 'Crawl job stalled');
});

// ── Reconciliation Queues ─────────────────────────────────────────────────────
// Two queues: one for periodic config syncs (6h cadence), one for full
// reconciliation runs (post-brief-lock, manual, or scheduled).

import type { SyncJobData, StatsSyncJobData, StaleResyncJobData } from '@/services/reconciliation/sync/syncOrchestrator';
import type { ReconciliationJobData } from '@/services/reconciliation/reconciliationRunner';
export type { SyncJobData, StatsSyncJobData, StaleResyncJobData, ReconciliationJobData };

export const reconciliationSyncQueue = new Bull<SyncJobData>('reconciliation-sync', makeBullOpts({
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: 200,
  removeOnFail: 100,
}));

reconciliationSyncQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, connectionId: job?.data?.connectionId, err: err.message }, 'Reconciliation sync job failed');
});

export const reconciliationRunQueue = new Bull<ReconciliationJobData>('reconciliation-run', makeBullOpts({
  attempts: 2,
  backoff: { type: 'fixed', delay: 5000 },
  timeout: 10 * 60 * 1000,   // 10-minute hard cap
  removeOnComplete: 100,
  removeOnFail: 50,
}));

reconciliationRunQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, runId: job.data.runId }, 'Reconciliation run completed');
});

reconciliationRunQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, runId: job?.data?.runId, err: err.message }, 'Reconciliation run failed');
});

// ── Reconciliation Stats Queue ────────────────────────────────────────────────
// Pulls daily event counts from platform APIs (Google Ads, Meta, GA4).
// 24h cadence; processed by a separate worker to avoid blocking config sync.

export const reconciliationStatsQueue = new Bull<StatsSyncJobData>('reconciliation-stats', makeBullOpts({
  attempts: 2,
  backoff: { type: 'exponential', delay: 15000 },
  removeOnComplete: 200,
  removeOnFail: 100,
}));

reconciliationStatsQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, connectionId: job?.data?.connectionId, err: err.message }, 'Reconciliation stats job failed');
});

// ── Reconciliation Stale Resync Queue ─────────────────────────────────────────
// Re-pulls last 30 days of stats daily at 03:00 UTC to backfill any gaps or
// corrections made retroactively by platforms.

export const reconciliationStaleResyncQueue = new Bull<StaleResyncJobData>('reconciliation-stale-resync', makeBullOpts({
  attempts: 2,
  backoff: { type: 'exponential', delay: 30000 },
  removeOnComplete: 100,
  removeOnFail: 50,
}));

reconciliationStaleResyncQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, connectionId: job?.data?.connectionId, err: err.message }, 'Reconciliation stale resync job failed');
});

// ── GTM Container Sync Queue ──────────────────────────────────────────────────
// Fetches the live container from the GTM API (or processes a just-uploaded
// manual snapshot), writes a new gtm_container_snapshots row when the version
// changes, and enqueues ihcRulesQueue to re-run all tag_configuration rules.
// OAuth connections: hourly cron. Manual uploads: triggered on demand.
// No PII in the payload — credentials are loaded from DB inside the worker.

export interface GtmContainerSyncJobData {
  connection_id: string;
  organization_id: string;
  snapshot_id?: string;   // pre-existing snapshot for manual upload path
  skip_fetch?: boolean;   // true for manual uploads (no API fetch needed)
}

export const gtmContainerSyncQueue = new Bull<GtmContainerSyncJobData>('gtm-container-sync', makeBullOpts({
  attempts: 2,
  backoff: { type: 'exponential', delay: 10_000 },
  timeout: 5 * 60 * 1000,
  removeOnComplete: 50,
  removeOnFail: 25,
}));

gtmContainerSyncQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, connectionId: job.data.connection_id }, 'GTM container sync job completed');
});

gtmContainerSyncQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, connectionId: job?.data?.connection_id, err: err.message }, 'GTM container sync job failed');
});

// ── IHC Rules Queue ───────────────────────────────────────────────────────────
// Runs all tag_configuration rules against a GTM container snapshot and
// upserts findings into audit_findings.
// Triggered after every GTM container sync (no delta — always re-run all rules).

export interface IhcRulesJobData {
  connection_id: string;
  snapshot_id: string;
  organization_id: string;
  property_id: string;
}

export const ihcRulesQueue = new Bull<IhcRulesJobData>('ihc-rules', makeBullOpts({
  attempts: 2,
  backoff: { type: 'fixed', delay: 5_000 },
  timeout: 3 * 60 * 1000,
  removeOnComplete: 100,
  removeOnFail: 50,
}));

ihcRulesQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, snapshotId: job.data.snapshot_id }, 'IHC rules job completed');
});

ihcRulesQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, snapshotId: job?.data?.snapshot_id, err: err.message }, 'IHC rules job failed');
});

// ── IHC Drift Queue ───────────────────────────────────────────────────────────
// Runs implementation_drift rules for a completed CSE crawl run.
// Triggered: daily cron at 02:00 UTC (pro) or after each new crawl (if cadence configured).
// Job payload contains only IDs — signals are loaded from DB inside the worker.

export interface IhcDriftJobData {
  organization_id: string;
  crawl_run_id: string;    // the *current* (new) crawl run to compare against baseline
}

export const ihcDriftQueue = new Bull<IhcDriftJobData>('ihc-drift', makeBullOpts({
  attempts: 2,
  backoff: { type: 'fixed', delay: 10_000 },
  timeout: 5 * 60 * 1000,
  removeOnComplete: 100,
  removeOnFail: 50,
}));

ihcDriftQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, crawlRunId: job.data.crawl_run_id }, 'IHC drift job completed');
});

ihcDriftQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, crawlRunId: job?.data?.crawl_run_id, err: err.message }, 'IHC drift job failed');
});

// ── IHC Alert Queue ───────────────────────────────────────────────────────────
// Triggered after ihcRulesQueue/ihcDriftQueue complete to send critical alerts.
// Runs within the 15-minute batch window configured per org.

export interface IhcAlertJobData {
  organization_id: string;
  trigger: 'post_rules' | 'post_drift' | 'manual';
}

export const ihcAlertQueue = new Bull<IhcAlertJobData>('ihc-alert', makeBullOpts({
  attempts: 2,
  backoff: { type: 'fixed', delay: 5_000 },
  timeout: 2 * 60 * 1000,
  removeOnComplete: 100,
  removeOnFail: 50,
}));

ihcAlertQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, orgId: job.data.organization_id }, 'IHC alert job completed');
});

ihcAlertQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, orgId: job?.data?.organization_id, err: err.message }, 'IHC alert job failed');
});

// ── IHC Digest Queue ──────────────────────────────────────────────────────────
// Hourly cron: checks which orgs are due for daily/weekly digest at this hour
// and dispatches digest emails.

export interface IhcDigestJobData {
  trigger: 'scheduled';
}

export const ihcDigestQueue = new Bull<IhcDigestJobData>('ihc-digest', makeBullOpts({
  attempts: 1,
  timeout: 5 * 60 * 1000,
  removeOnComplete: 24,
  removeOnFail: 10,
}));

ihcDigestQueue.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'IHC digest job completed');
});

ihcDigestQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'IHC digest job failed');
});

// ── DMA Ingest Queue ──────────────────────────────────────────────────────────
// Handles events:ingest and audiencemembers:ingest calls to Google Data Manager API.
// payload_ref is a UUID pointing to a pre-staged row in a DB table — no hashed
// PII travels through Redis.
// Retries: 3 attempts with 30s/60s/120s exponential backoff to absorb transient
// DMA rate-limit responses (429) and brief token-refresh races.

export interface DMAIngestJobData {
  org_id: string;
  ingest_type: 'events' | 'audience_members';
  payload_ref: string; // UUID referencing the staged payload row (enricher_runs or equivalent)
}

export const dmaIngestQueue = new Bull<DMAIngestJobData>('dma-ingest', makeBullOpts({
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 200,
  removeOnFail: 100,
}));

dmaIngestQueue.on('completed', (job) => {
  logger.info({ jobId: job.id, orgId: job.data.org_id, ingestType: job.data.ingest_type }, 'DMA ingest job completed');
});

dmaIngestQueue.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, orgId: job?.data?.org_id, ingestType: job?.data?.ingest_type, err: err.message }, 'DMA ingest job failed');
});

dmaIngestQueue.on('stalled', (job) => {
  logger.warn({ jobId: job.id, orgId: job.data.org_id }, 'DMA ingest job stalled');
});

