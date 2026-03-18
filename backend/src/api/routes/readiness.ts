/**
 * First-Party Data Readiness Score — GET /api/readiness-score
 *
 * Composite score (0–100) showing how mature the user's tracking setup is.
 *
 * Scoring:
 *   +20 — Consent configured
 *   +20 — Server-side tracking (CAPI) enabled
 *   +20 — CAPI connected to at least 1 platform
 *   +15 — Click ID capture (GTM container generated with click ID tags)
 *   +15 — Enhanced conversions enabled (email/phone identifiers on a CAPI provider)
 *   +10 — Data Health Score > 80
 *
 * Levels: getting_started (0–30), building (31–60), strong (61–85), best_in_class (86–100)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { supabaseAdmin } from '@/services/database/supabase';
import { sendInternalError } from '@/utils/apiError';
import logger from '@/utils/logger';

export const readinessRouter = Router();

readinessRouter.use(authMiddleware);

interface ReadinessItem {
  key: string;
  label: string;
  description: string;
  points: number;
  earned: boolean;
  link: string;
}

export interface ReadinessResponse {
  score: number;
  level: 'getting_started' | 'building' | 'strong' | 'best_in_class';
  level_label: string;
  items: ReadinessItem[];
}

// ── GET /api/readiness-score ──────────────────────────────────────────────────

readinessRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;

  try {
    // Fetch all the data we need in parallel
    const [
      consentResult,
      capiResult,
      sessionIdsResult,
      healthResult,
    ] = await Promise.all([
      supabaseAdmin
        .from('consent_configs')
        .select('id')
        .eq('organization_id', userId)
        .limit(1),

      supabaseAdmin
        .from('capi_providers')
        .select('id, provider, status, identifier_config')
        .eq('organization_id', userId),

      supabaseAdmin
        .from('planning_sessions')
        .select('id')
        .eq('user_id', userId)
        .in('status', ['outputs_ready', 'review_ready', 'generating']),

      supabaseAdmin
        .from('health_scores')
        .select('overall_score')
        .eq('user_id', userId)
        .single(),
    ]);

    const sessionIds = (sessionIdsResult.data ?? []).map((s: { id: string }) => s.id);

    // Check if any planning session has a GTM container output (confirms click ID tags)
    const outputsResult = sessionIds.length > 0
      ? await supabaseAdmin
          .from('planning_outputs')
          .select('output_type')
          .in('session_id', sessionIds)
          .eq('output_type', 'gtm_container')
          .limit(1)
      : { data: [] };

    // ── Evaluate each criterion ──────────────────────────────────────────────

    const consentConfigured = (consentResult.data?.length ?? 0) > 0;

    const capiProviders = capiResult.data ?? [];
    const activeProviders = capiProviders.filter(
      (p: { status: string }) => p.status === 'active'
    );
    const capiConnected = activeProviders.length > 0;

    // Server-side tracking: any active CAPI provider counts, OR a server-side GTM
    const serverSideEnabled = capiConnected;

    // Click ID capture: user has generated a GTM container (which includes our click ID tags)
    const clickIdCapture = (outputsResult.data?.length ?? 0) > 0;

    // Enhanced conversions: any active provider has email or phone in identifier_config
    const enhancedConversions = activeProviders.some((p: { identifier_config?: unknown }) => {
      const cfg = p.identifier_config as Record<string, unknown> | null;
      if (!cfg) return false;
      const enabled = cfg.enabled_identifiers as string[] | undefined;
      return Array.isArray(enabled) && (enabled.includes('email') || enabled.includes('phone'));
    });

    const healthScore = (healthResult.data as { overall_score?: number } | null)?.overall_score ?? 0;
    const healthGood = healthScore > 80;

    // ── Build items array ────────────────────────────────────────────────────

    const items: ReadinessItem[] = [
      {
        key: 'consent_configured',
        label: 'Consent management set up',
        description: 'A consent banner or CMP is configured to gate tracking correctly',
        points: 20,
        earned: consentConfigured,
        link: '/consent',
      },
      {
        key: 'server_side_enabled',
        label: 'Server-side tracking enabled',
        description: 'Events are sent via a server-side connection, bypassing ad blockers',
        points: 20,
        earned: serverSideEnabled,
        link: '/integrations/capi',
      },
      {
        key: 'capi_connected',
        label: 'Ad platform connected via CAPI',
        description: 'At least one active Conversion API provider is delivering events',
        points: 20,
        earned: capiConnected,
        link: '/integrations/capi',
      },
      {
        key: 'click_id_capture',
        label: 'Click ID capture active',
        description: 'GCLID and FBCLID are captured in first-party cookies for attribution',
        points: 15,
        earned: clickIdCapture,
        link: '/planning',
      },
      {
        key: 'enhanced_conversions',
        label: 'Enhanced conversions enabled',
        description: 'Email or phone is being sent to ad platforms for better match rates',
        points: 15,
        earned: enhancedConversions,
        link: '/integrations/capi',
      },
      {
        key: 'health_score_strong',
        label: 'Data Health Score above 80',
        description: 'Your overall tracking health is strong with minimal signal loss',
        points: 10,
        earned: healthGood,
        link: '/health',
      },
    ];

    const score = items.reduce((sum, item) => sum + (item.earned ? item.points : 0), 0);

    let level: ReadinessResponse['level'];
    let level_label: string;
    if (score <= 30)      { level = 'getting_started'; level_label = 'Getting started'; }
    else if (score <= 60) { level = 'building';         level_label = 'Building';        }
    else if (score <= 85) { level = 'strong';           level_label = 'Strong';          }
    else                  { level = 'best_in_class';    level_label = 'Best in class';   }

    const response: ReadinessResponse = { score, level, level_label, items };
    res.json(response);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to compute readiness score');
    sendInternalError(res, err);
  }
});
