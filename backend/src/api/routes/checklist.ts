/**
 * Setup Checklist API — GET /api/setup-checklist
 *
 * Computes a per-user setup checklist by querying existing tables.
 * No new data is stored — this is a read-only aggregation of existing state.
 *
 * Checklist steps:
 *   1. site_scanned       — user has a completed planning session
 *   2. consent_configured — user has a consent config record
 *   3. tracking_generated — planning session has GTM + dataLayer outputs
 *   4. shared_with_dev    — developer share token has been created
 *   5. capi_connected     — at least one active CAPI provider
 *   6. audit_passed       — at least one completed audit
 *   7. channel_tracking_enabled — at least one channel session ingested
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { supabaseAdmin } from '@/services/database/supabase';
import { sendInternalError } from '@/utils/apiError';
import logger from '@/utils/logger';

export const checklistRouter = Router();

checklistRouter.use(authMiddleware);

// ── GET /api/setup-checklist ──────────────────────────────────────────────────

checklistRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;

  try {
    // Run all queries in parallel
    // Step 1: fetch user's planning session IDs (needed for output + share queries)
    const { data: userSessions } = await supabaseAdmin
      .from('planning_sessions')
      .select('id, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const sessionIds = (userSessions ?? []).map((s: { id: string }) => s.id);
    const completedSessionIds = (userSessions ?? [])
      .filter((s: { status: string }) => ['review_ready', 'generating', 'outputs_ready'].includes(s.status))
      .map((s: { id: string }) => s.id);

    const [
      consentResult,
      outputsResult,
      sharesResult,
      capiResult,
      auditsResult,
      channelSessionsResult,
    ] = await Promise.all([
      // 2. Has the user configured consent?
      supabaseAdmin
        .from('consent_configs')
        .select('id, project_id')
        .eq('organization_id', userId)
        .limit(1),

      // 3. Has any planning session generated GTM + dataLayer outputs?
      sessionIds.length > 0
        ? supabaseAdmin
            .from('planning_outputs')
            .select('output_type')
            .in('session_id', sessionIds)
            .in('output_type', ['gtm_container', 'datalayer_spec'])
        : Promise.resolve({ data: [] }),

      // 4. Has the user created a developer share?
      sessionIds.length > 0
        ? supabaseAdmin
            .from('developer_shares')
            .select('id, is_active')
            .in('session_id', sessionIds)
            .eq('is_active', true)
            .limit(1)
        : Promise.resolve({ data: [] }),

      // 5. Has the user connected any CAPI providers?
      supabaseAdmin
        .from('capi_providers')
        .select('id, provider, status')
        .eq('organization_id', userId)
        .limit(10),

      // 6. Has the user completed an audit?
      supabaseAdmin
        .from('audits')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1),

      // 7. Has the user ingested any channel sessions?
      supabaseAdmin
        .from('channel_sessions')
        .select('id')
        .eq('user_id', userId)
        .limit(1),
    ]);

    // ── Compute checklist state ───────────────────────────────────────────────

    const latestSession = completedSessionIds.length > 0 ? (userSessions ?? [])[0] : null;

    const outputTypes = new Set(
      (outputsResult.data ?? []).map((o: { output_type: string }) => o.output_type)
    );
    const hasGtmOutput = outputTypes.has('gtm_container');
    const hasDlOutput  = outputTypes.has('datalayer_spec');

    const capiProviders = capiResult.data ?? [];
    const activeProviders = capiProviders
      .filter((p: { status: string }) => p.status === 'active')
      .map((p: { provider: string }) => p.provider as string);
    const allProviders = capiProviders.map((p: { provider: string }) => p.provider as string);

    const latestAudit = auditsResult.data?.[0] ?? null;

    const steps = {
      site_scanned: {
        complete: completedSessionIds.length > 0,
        planning_session_id: latestSession?.id ?? null,
      },
      consent_configured: {
        complete: (consentResult.data?.length ?? 0) > 0,
        consent_config_id: consentResult.data?.[0]?.id ?? null,
      },
      tracking_generated: {
        complete: hasGtmOutput && hasDlOutput,
        has_gtm_output: hasGtmOutput,
        has_datalayer_output: hasDlOutput,
      },
      shared_with_developer: {
        complete: (sharesResult.data?.length ?? 0) > 0,
        share_count: sharesResult.data?.length ?? 0,
      },
      capi_connected: {
        complete: activeProviders.length > 0,
        providers: allProviders,
        active_providers: activeProviders,
      },
      audit_passed: {
        complete: latestAudit !== null,
        last_audit_id: latestAudit?.id ?? null,
        last_audit_date: latestAudit?.created_at ?? null,
      },
      channel_tracking_enabled: {
        complete: (channelSessionsResult.data?.length ?? 0) > 0,
      },
    };

    const completedCount = Object.values(steps).filter((s) => s.complete).length;
    const totalSteps = Object.keys(steps).length;
    const overallPct = Math.round((completedCount / totalSteps) * 100);

    let readinessLevel: 'getting_started' | 'building' | 'strong' | 'best_in_class';
    if (overallPct <= 30)       readinessLevel = 'getting_started';
    else if (overallPct <= 60)  readinessLevel = 'building';
    else if (overallPct <= 85)  readinessLevel = 'strong';
    else                        readinessLevel = 'best_in_class';

    res.json({
      steps,
      overall_progress_pct: overallPct,
      readiness_level: readinessLevel,
    });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to compute setup checklist');
    sendInternalError(res, err);
  }
});
