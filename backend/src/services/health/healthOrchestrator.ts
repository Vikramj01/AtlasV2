/**
 * Health Orchestrator
 *
 * Runs the full health computation pipeline for a single user:
 *   1. computeHealthMetrics() → metrics + overallScore
 *   2. upsertHealthScore()    → update health_scores
 *   3. insertSnapshot()       → append to health_snapshots
 *   4. evaluateAlerts()       → create / resolve alerts
 *
 * Called by:
 *   - The health Bull queue worker (every 15 minutes, all active users)
 *   - POST /api/health/compute (manual trigger, single user)
 */

import { computeHealthMetrics } from './scoreEngine';
import { evaluateAlerts } from './alertEngine';
import { upsertHealthScore, insertSnapshot } from '@/services/database/healthQueries';
import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

export async function runHealthPipeline(userId: string, websiteUrl?: string): Promise<void> {
  logger.info({ userId, websiteUrl }, 'Running health pipeline');

  // 1. Compute metrics
  const { metrics, overallScore } = await computeHealthMetrics(userId, websiteUrl);

  // 2. Persist latest score (upsert) + append snapshot
  await Promise.all([
    upsertHealthScore(userId, metrics, overallScore),
    insertSnapshot(userId, metrics, overallScore),
  ]);

  // 3. Evaluate alert rules
  const capiConfigured = metrics.capi_delivery_rate > 0 || await checkCAPIConfigured(userId);
  const daysSinceAudit = metrics.last_audit_at
    ? Math.floor((Date.now() - new Date(metrics.last_audit_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  await evaluateAlerts(userId, metrics, {
    capi_configured: capiConfigured,
    days_since_audit: daysSinceAudit,
  });

  logger.info({ userId, overallScore }, 'Health pipeline complete');
}

async function checkCAPIConfigured(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('capi_providers')
    .select('id')
    .eq('organization_id', userId)
    .eq('status', 'active')
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Run health pipeline for all users who have had activity in the last 30 days.
 * Called by the scheduled Bull job.
 */
export async function runHealthPipelineForActiveUsers(): Promise<void> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Gather distinct user IDs that have recent audits or planning sessions
  const [auditUsers, planningUsers] = await Promise.all([
    supabaseAdmin
      .from('audits')
      .select('user_id')
      .gte('created_at', since),
    supabaseAdmin
      .from('planning_sessions')
      .select('user_id')
      .gte('created_at', since),
  ]);

  const userIds = new Set<string>();
  for (const row of auditUsers.data ?? []) userIds.add((row as { user_id: string }).user_id);
  for (const row of planningUsers.data ?? []) userIds.add((row as { user_id: string }).user_id);

  logger.info({ count: userIds.size }, 'Running health pipeline for active users');

  for (const userId of userIds) {
    try {
      await runHealthPipeline(userId);
    } catch (err) {
      logger.error({ err, userId }, 'Health pipeline failed for user');
    }
  }
}
