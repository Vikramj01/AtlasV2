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

interface DMACheck {
  key: string;
  label: string;
  description: string;
  status: 'pass' | 'fail' | 'warn' | 'unknown';
  recommendation: string;
}

export interface ReadinessResponse {
  score: number;
  level: 'getting_started' | 'building' | 'strong' | 'best_in_class';
  level_label: string;
  items: ReadinessItem[];
  dma_checks: DMACheck[];
  gtg_recommendation?: {
    headline: string;
    uplift: string;
    cdn_guides: Array<{ cdn: string; instruction: string }>;
  } | null;
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
      gtgResult,
      dmaCredsResult,
      dmaPollResult,
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

      // DA-GTG-001: GTM/sGTM container connection exists
      supabaseAdmin
        .from('gtm_container_connections')
        .select('id')
        .eq('organization_id', userId)
        .limit(1),

      // DA-DMA-001 + DA-DMA-004: DMA credentials row
      supabaseAdmin
        .from('google_dma_credentials')
        .select('linked_connection_id, expires_at, oauth_scope')
        .eq('org_id', userId)
        .maybeSingle(),

      // DA-DMA-002 + DA-DMA-003 (real data): DQM poll state for this org
      supabaseAdmin
        .from('dqm_dma_poll_state')
        .select('upload_success_rate, avg_match_rate, last_successful_at, total_members_30d')
        .eq('org_id', userId)
        .maybeSingle(),
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
    // server_side_enabled: org has set up at least one CAPI provider (any status)
    const serverSideEnabled = capiProviders.length > 0;
    // capi_connected: at least one provider is fully active and delivering events
    const capiConnected = activeProviders.length > 0;

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

    // ── DMA check logic ──────────────────────────────────────────────────────

    const dmaCreds = dmaCredsResult.data as {
      linked_connection_id: string | null;
      expires_at: string | null;
      oauth_scope: string | null;
    } | null;

    // DA-GTG-001: sGTM / GTG configured
    const gtgActive = (gtgResult.data?.length ?? 0) > 0;

    // DA-DMA-001: credentials linked
    const dmaConnected = !!dmaCreds?.linked_connection_id;

    // DA-DMA-004: oauth_scope includes datamanager
    const dmaScopeValid = dmaConnected &&
      (dmaCreds!.oauth_scope ?? '').includes('datamanager');

    // DA-DMA-002 + DA-DMA-003: real data from dqm_dma_poll_state
    const dmaPoll = dmaPollResult.data as {
      upload_success_rate: number;
      avg_match_rate: number | null;
      last_successful_at: string | null;
      total_members_30d: number;
    } | null;

    // DA-DMA-002: DMA events landing (members seen in last 30d)
    let dmaMembersStatus: DMACheck['status'];
    let dmaMembersRecommendation: string;
    if (!dmaPoll) {
      dmaMembersStatus = 'unknown';
      dmaMembersRecommendation = 'No DMA poll data yet. The hourly DQM check will populate this once enricher runs are present.';
    } else if (dmaPoll.total_members_30d > 0) {
      dmaMembersStatus = 'pass';
      dmaMembersRecommendation = `${dmaPoll.total_members_30d.toLocaleString()} audience members processed in the last 30 days.`;
    } else if (dmaConnected) {
      dmaMembersStatus = 'fail';
      dmaMembersRecommendation = 'No audience members have been processed in the last 30 days. Check that your enricher is running and sending data to Google Data Manager.';
    } else {
      dmaMembersStatus = 'unknown';
      dmaMembersRecommendation = 'Connect Google Data Manager first.';
    }

    // DA-DMA-003: match rate above threshold
    let matchRateStatus: DMACheck['status'];
    let matchRateRecommendation: string;
    const avgMatchRate = dmaPoll?.avg_match_rate ?? null;
    if (avgMatchRate === null) {
      matchRateStatus = 'unknown';
      matchRateRecommendation = 'No match rate data available yet. Match rate will appear once completed enricher runs are present.';
    } else if (avgMatchRate >= 40) {
      matchRateStatus = 'pass';
      matchRateRecommendation = `Match rate is ${avgMatchRate.toFixed(0)}% — above the recommended 40% threshold.`;
    } else if (avgMatchRate >= 20) {
      matchRateStatus = 'warn';
      matchRateRecommendation = `Match rate is ${avgMatchRate.toFixed(0)}% — below the 40% target. Improve by enabling Enhanced Conversions (email/phone) on your Google CAPI provider.`;
    } else {
      matchRateStatus = 'fail';
      matchRateRecommendation = `Match rate is ${avgMatchRate.toFixed(0)}% — critically low. Enable Enhanced Conversions with email and phone identifiers to improve audience match quality.`;
    }

    const dma_checks: DMACheck[] = [
      {
        key: 'DA-GTG-001',
        label: 'Server-side GTM configured',
        description: 'A Google Tag Manager server-side container is connected to Atlas',
        status: gtgActive ? 'pass' : 'warn',
        recommendation: gtgActive
          ? 'Server-side GTM is connected.'
          : 'Connect a GTM container in Platform Connections to enable server-side measurement.',
      },
      {
        key: 'DA-DMA-001',
        label: 'Data Manager connected',
        description: 'Google Data Manager OAuth credentials are linked to this workspace',
        status: dmaConnected ? 'pass' : 'fail',
        recommendation: dmaConnected
          ? 'Google Data Manager is connected.'
          : 'Reconnect Google Ads in Platform Connections and grant the Data Manager scope.',
      },
      {
        key: 'DA-DMA-002',
        label: 'DMA events landing',
        description: 'Audience members have been processed by Google Data Manager in the last 30 days',
        status: dmaMembersStatus,
        recommendation: dmaMembersRecommendation,
      },
      {
        key: 'DA-DMA-003',
        label: 'Match rate above threshold',
        description: 'Audience match rate is above the 40% recommended threshold',
        status: matchRateStatus,
        recommendation: matchRateRecommendation,
      },
      {
        key: 'DA-DMA-004',
        label: 'Data Manager scope granted',
        description: 'The OAuth token includes the required Data Manager API scope',
        status: !dmaConnected ? 'unknown' : dmaScopeValid ? 'pass' : 'fail',
        recommendation: !dmaConnected
          ? 'Connect Google Data Manager first.'
          : dmaScopeValid
          ? 'Data Manager scope is granted.'
          : 'Reconnect Google Ads in Platform Connections — ensure the Data Manager scope is approved on the consent screen.',
      },
    ];

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
        label: 'Server-side tracking configured',
        description: 'A Conversion API integration has been set up (may still need activation)',
        points: 20,
        earned: serverSideEnabled,
        link: '/integrations/capi',
      },
      {
        key: 'capi_connected',
        label: 'CAPI active and delivering events',
        description: 'At least one Conversion API provider is active and sending events to an ad platform',
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

    const gtg_recommendation = !gtgActive ? {
      headline: 'Deploy Google Tag Gateway to recover ~11% signal loss',
      uplift: '~11% more measured conversions at no additional cost',
      cdn_guides: [
        { cdn: 'Cloudflare', instruction: 'Add a Worker proxying https://www.googletagmanager.com/gtag/js to /gtag/js on your domain. Enable via the Workers dashboard.' },
        { cdn: 'Akamai', instruction: 'Use EdgeWorkers to proxy the GTG script endpoint. Add a Property Manager rule forwarding /gtag/js to the GTG origin.' },
        { cdn: 'Fastly', instruction: 'Add a VCL snippet routing /gtag/js to the GTG backend. Set bereq.url to the GTG path in vcl_recv.' },
        { cdn: 'GCP (Cloud CDN)', instruction: 'Use Cloud Load Balancing + Cloud CDN. Add a URL map rule forwarding /gtag/js to the GTG origin backend service.' },
      ],
    } : null;

    const response: ReadinessResponse = { score, level, level_label, items, dma_checks, gtg_recommendation };
    res.json(response);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to compute readiness score');
    sendInternalError(res, err);
  }
});
