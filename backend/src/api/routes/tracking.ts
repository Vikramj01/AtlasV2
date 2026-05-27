/**
 * Tracking Hub routes — /api/tracking
 * Provides hub status, deliverable generation, export logging, and share link creation.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { buildDeliverables } from '@/services/tracking/deliverableBuilder';
import { generateShareLink } from '@/services/tracking/shareableLinkService';
import { env } from '@/config/env';
import logger from '@/utils/logger';

const router = Router();
router.use(authMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return (data as { organization_id: string } | null)?.organization_id ?? null;
}

async function verifyClientAccess(clientId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('organisation_id', orgId)
    .single();
  return !!data;
}

// ── GET /api/tracking/clients/:clientId/status ────────────────────────────────

router.get('/clients/:clientId/status', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    const hasAccess = await verifyClientAccess(clientId, orgId);
    if (!hasAccess) return res.status(404).json({ data: null, error: 'Client not found', message: null });

    const [
      clientRow,
      platformConnections,
      planningSession,
      journeyDraft,
      recentCrawl,
      deploymentCount,
      latestSignalUpdate,
      latestExports,
      crawlBaseline,
      driftCount,
    ] = await Promise.all([
      supabaseAdmin
        .from('clients')
        .select('id, name, website_url, business_type, primary_conversion_objective')
        .eq('id', clientId)
        .single(),

      supabaseAdmin
        .from('platform_connections')
        .select('platform')
        .eq('client_id', clientId)
        .eq('status', 'active'),

      supabaseAdmin
        .from('planning_sessions')
        .select('id, created_at, status')
        .eq('client_id', clientId)
        .not('status', 'in', '("completed","outputs_ready","discarded")')
        .order('created_at', { ascending: false })
        .limit(1),

      supabaseAdmin
        .from('journeys')
        .select('id, updated_at, status')
        .eq('client_id', clientId)
        .eq('status', 'draft')
        .order('updated_at', { ascending: false })
        .limit(1),

      supabaseAdmin
        .from('crawl_runs')
        .select('id, completed_at, pages_completed, is_baseline')
        .eq('org_id', req.user!.id)
        .eq('status', 'completed')
        .gte('completed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('completed_at', { ascending: false })
        .limit(1),

      supabaseAdmin
        .from('deployments')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId),

      supabaseAdmin
        .from('deployments')
        .select('deployed_at')
        .eq('client_id', clientId)
        .order('deployed_at', { ascending: false })
        .limit(1),

      supabaseAdmin
        .from('client_deliverable_exports')
        .select('export_type, created_at, shareable_url, expires_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10),

      supabaseAdmin
        .from('crawl_runs')
        .select('id, completed_at')
        .eq('org_id', req.user!.id)
        .eq('is_baseline', true)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1),

      supabaseAdmin
        .from('audit_findings')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('resolved_at', null),
    ]);

    const client = clientRow.data as {
      id: string; name: string; website_url: string | null;
      business_type: string | null; primary_conversion_objective: string | null;
    } | null;

    if (!client) return res.status(404).json({ data: null, error: 'Client not found', message: null });

    const platforms = (platformConnections.data ?? []) as { platform: string }[];
    const session = (planningSession.data ?? [])[0] as { id: string; created_at: string; status: string } | undefined;
    const journey = (journeyDraft.data ?? [])[0] as { id: string; updated_at: string; status: string } | undefined;
    const crawl = (recentCrawl.data ?? [])[0] as {
      id: string; completed_at: string; pages_completed: number; is_baseline: boolean;
    } | undefined;

    const pageCount = session
      ? await supabaseAdmin
          .from('planning_pages')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', session.id)
          .then((r) => r.count ?? 0)
      : 0;
    const approvedCount = session
      ? await supabaseAdmin
          .from('planning_recommendations')
          .select('*, planning_pages!inner(session_id)', { count: 'exact', head: true })
          .eq('planning_pages.session_id', session.id)
          .in('user_decision', ['approved', 'modified'])
          .then((r) => r.count ?? 0)
      : 0;

    const deploymentsCount = deploymentCount.count ?? 0;
    const lastUpdate = ((latestSignalUpdate.data ?? [])[0] as { deployed_at: string } | undefined)?.deployed_at ?? null;

    // Build deliverables state from latest exports
    const exports = (latestExports.data ?? []) as Array<{
      export_type: string; created_at: string; shareable_url: string | null; expires_at: string | null;
    }>;
    const dlExport = exports.find((e) => e.export_type === 'datalayer_spec');
    const gtmExport = exports.find((e) => e.export_type === 'gtm_container');

    // Determine designed_via
    const hasPlanning = !!(await supabaseAdmin
      .from('planning_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['completed', 'outputs_ready'])
      .then((r) => r.count));
    const hasJourney = !!(await supabaseAdmin
      .from('journeys')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .not('status', 'eq', 'draft')
      .then((r) => r.count));

    let designedVia: 'planning_mode' | 'journey_builder' | 'mixed' | null = null;
    if (hasPlanning && hasJourney) designedVia = 'mixed';
    else if (hasPlanning) designedVia = 'planning_mode';
    else if (hasJourney) designedVia = 'journey_builder';

    const baselineRow = ((crawlBaseline.data ?? [])[0]) as { id: string; completed_at: string } | undefined;
    const latestVerifyCrawl = crawl;

    const data = {
      client: {
        id: client.id,
        name: client.name,
        website_url: client.website_url,
        business_type: client.business_type,
        primary_conversion_objective: client.primary_conversion_objective,
      },
      preconditions: {
        website_url: !!client.website_url,
        business_type: !!client.business_type,
        platforms_connected: platforms.map((p) => p.platform),
      },
      in_progress: {
        planning_session: session
          ? {
              id: session.id,
              started_at: session.created_at,
              page_count: pageCount as number,
              approved_count: approvedCount as number,
            }
          : null,
        journey_draft: journey
          ? {
              id: journey.id,
              saved_at: journey.updated_at,
              current_step: 1,
              total_steps: 4,
            }
          : null,
        recent_crawl: crawl
          ? {
              run_id: crawl.id,
              completed_at: crawl.completed_at,
              signals_found: crawl.pages_completed,
              is_baseline: crawl.is_baseline ?? false,
            }
          : null,
      },
      deployment: {
        signals_count: deploymentsCount,
        stages_count: deploymentsCount,
        last_updated_at: lastUpdate,
        designed_via: designedVia,
        deliverables: {
          datalayer_spec: dlExport
            ? {
                last_generated_at: dlExport.created_at,
                shareable_url: dlExport.shareable_url,
                expires_at: dlExport.expires_at,
              }
            : null,
          gtm_container: gtmExport
            ? { last_generated_at: gtmExport.created_at }
            : null,
        },
      },
      verification: {
        latest_crawl_run: latestVerifyCrawl
          ? {
              run_id: latestVerifyCrawl.id,
              completed_at: latestVerifyCrawl.completed_at,
              signals_found: latestVerifyCrawl.pages_completed,
            }
          : null,
        baseline: {
          set: !!baselineRow,
          set_at: baselineRow?.completed_at ?? null,
        },
        ihc: {
          drift_count: driftCount.count ?? 0,
          last_checked_at: null,
        },
      },
    };

    res.json({ data, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'GET tracking status failed');
    sendInternalError(res, err);
  }
});

// ── GET /api/tracking/clients/:clientId/deliverables/build ────────────────────

router.get('/clients/:clientId/deliverables/build', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    const hasAccess = await verifyClientAccess(clientId, orgId);
    if (!hasAccess) return res.status(404).json({ data: null, error: 'Client not found', message: null });

    const result = await buildDeliverables(clientId);
    res.json({ data: result, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Build deliverables failed');
    sendInternalError(res, err);
  }
});

// ── POST /api/tracking/clients/:clientId/deliverables/export ──────────────────

const exportBodySchema = z.object({
  export_type: z.enum(['gtm_container', 'datalayer_spec', 'combined']),
});

router.post('/clients/:clientId/deliverables/export', async (req: Request, res: Response) => {
  try {
    const parsed = exportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ data: null, error: parsed.error.errors[0]?.message ?? 'Invalid request', message: null });
    }

    const { clientId } = req.params;
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    const hasAccess = await verifyClientAccess(clientId, orgId);
    if (!hasAccess) return res.status(404).json({ data: null, error: 'Client not found', message: null });

    const { data, error } = await supabaseAdmin
      .from('client_deliverable_exports')
      .insert({
        organization_id: orgId,
        client_id: clientId,
        export_type: parsed.data.export_type,
        exported_by: req.user!.id,
      })
      .select('id, created_at')
      .single();

    if (error) throw new Error(error.message);

    res.json({ data, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Export deliverable failed');
    sendInternalError(res, err);
  }
});

// ── POST /api/tracking/clients/:clientId/deliverables/share ───────────────────

const shareBodySchema = z.object({
  expires_in_days: z.number().int().min(1).max(90).default(30),
});

router.post('/clients/:clientId/deliverables/share', async (req: Request, res: Response) => {
  try {
    const parsed = shareBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ data: null, error: parsed.error.errors[0]?.message ?? 'Invalid request', message: null });
    }

    const { clientId } = req.params;
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    const hasAccess = await verifyClientAccess(clientId, orgId);
    if (!hasAccess) return res.status(404).json({ data: null, error: 'Client not found', message: null });

    const result = await generateShareLink(
      clientId,
      orgId,
      req.user!.id,
      parsed.data.expires_in_days,
      env.FRONTEND_URL,
    );

    // Log the export
    await supabaseAdmin.from('client_deliverable_exports').insert({
      organization_id: orgId,
      client_id: clientId,
      export_type: 'datalayer_spec',
      exported_by: req.user!.id,
      shareable_url: result.share_url,
      expires_at: result.expires_at,
    });

    res.json({ data: result, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Generate share link failed');
    sendInternalError(res, err);
  }
});

export { router as trackingRouter };
