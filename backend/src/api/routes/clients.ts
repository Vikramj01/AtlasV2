/**
 * Client routes — /api/organisations/:orgId/clients
 *
 * Covers: client CRUD, platform config, pages, pack deployment,
 * output generation, and auditing from deployed signals.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { orgMiddleware } from '@/api/middleware/orgMiddleware';
import { strategyGate } from '@/api/middleware/strategyGate';
import { sendInternalError } from '@/utils/apiError';
import { validateUrl, validateUrls } from '@/utils/urlValidator';
import { detectSite } from '@/services/planning/siteDetectionService';
import {
  createClient,
  listClients,
  getClient,
  updateClient,
  archiveClient,
  upsertClientPlatforms,
  upsertClientPages,
  listDeployments,
  deployPack,
  removeDeployment,
  listClientOutputs,
  getClientOutput,
  getClientsByPack,
} from '@/services/database/clientQueries';
import { getSignalPackWithSignals, resolveDeploymentsForClient } from '@/services/database/signalQueries';
import { generateComposableOutputs } from '@/services/signals/composableOutputGenerator';
import { createAudit } from '@/services/database/queries';
import { auditQueue } from '@/services/queue/jobQueue';
import logger from '@/utils/logger';
import type { BusinessType, UpsertPlatformsRequest, UpsertPagesRequest } from '@/types/organisation';
import type { DeployPackRequest } from '@/types/signal';
import type { FunnelType, Region } from '@/types/audit';

// This router is mounted at /api/organisations, so all routes include :orgId
const router = Router({ mergeParams: true });
router.use(authMiddleware);
// orgMiddleware validates membership on all routes below
router.use('/:orgId/clients', orgMiddleware);

// ── POST /api/organisations/:orgId/clients ────────────────────────────────────

router.post('/:orgId/clients', async (req: Request, res: Response) => {
  try {
    const { name, website_url, business_type, notes, auto_detect } = req.body as {
      name?: string;
      website_url?: string;
      business_type?: BusinessType;
      notes?: string;
      auto_detect?: boolean;
    };

    if (!name || !website_url || !business_type) {
      return res.status(400).json({ error: 'name, website_url, and business_type are required' });
    }
    const urlResult = validateUrl(website_url);
    if (!urlResult.valid) {
      return res.status(400).json({ error: `Invalid website_url: ${urlResult.error}` });
    }

    // Optionally run site detection to prefill detected_platform
    let detectedPlatform: string | undefined;
    if (auto_detect) {
      const detection = await detectSite(website_url).catch(() => null);
      detectedPlatform = detection?.detected_platform?.name ?? undefined;
    }

    const client = await createClient(req.params['orgId'], {
      name,
      website_url,
      business_type,
      notes,
      detected_platform: detectedPlatform,
    });

    logger.info({ orgId: req.params['orgId'], clientId: client.id }, 'Client created');
    res.status(201).json(client);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId/clients ─────────────────────────────────────

router.get('/:orgId/clients', async (req: Request, res: Response) => {
  try {
    const clients = await listClients(req.params['orgId']);
    res.json({ clients });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId/clients/:clientId ───────────────────────────

router.get('/:orgId/clients/:clientId', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const [deployments, outputs] = await Promise.all([
      listDeployments(req.params['clientId']),
      listClientOutputs(req.params['clientId']),
    ]);

    res.json({ ...client, deployments, outputs });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PUT /api/organisations/:orgId/clients/:clientId ───────────────────────────

router.put('/:orgId/clients/:clientId', async (req: Request, res: Response) => {
  try {
    const client = await updateClient(req.params['clientId'], req.params['orgId'], req.body);
    res.json(client);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/organisations/:orgId/clients/:clientId ────────────────────────

router.delete('/:orgId/clients/:clientId', async (req: Request, res: Response) => {
  try {
    await archiveClient(req.params['clientId'], req.params['orgId']);
    res.json({ archived: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PUT /api/organisations/:orgId/clients/:clientId/platforms ─────────────────

router.put('/:orgId/clients/:clientId/platforms', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const platforms = await upsertClientPlatforms(
      req.params['clientId'],
      req.body as UpsertPlatformsRequest,
    );
    res.json({ platforms });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/organisations/:orgId/clients/:clientId/pages ────────────────────

router.post('/:orgId/clients/:clientId/pages', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const body = req.body as UpsertPagesRequest;
    const urls = body.pages.map((p) => p.url);
    const urlError = validateUrls(urls);
    if (urlError) return res.status(400).json({ error: `Invalid page URL: ${urlError}` });

    const pages = await upsertClientPages(req.params['clientId'], body);
    res.json({ pages });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId/clients/:clientId/pages ─────────────────────

router.get('/:orgId/clients/:clientId/pages', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ pages: client.pages });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/organisations/:orgId/clients/:clientId/deploy ───────────────────

router.post('/:orgId/clients/:clientId/deploy', strategyGate, async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { pack_id, signal_overrides } = req.body as DeployPackRequest;
    if (!pack_id) return res.status(400).json({ error: 'pack_id is required' });

    const pack = await getSignalPackWithSignals(pack_id);
    if (!pack) return res.status(404).json({ error: 'Signal pack not found' });

    const deployment = await deployPack(req.params['clientId'], pack_id, signal_overrides);
    logger.info({ clientId: req.params['clientId'], packId: pack_id }, 'Pack deployed');
    res.status(201).json(deployment);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/organisations/:orgId/clients/:clientId/deploy/:deploymentId ───

router.delete('/:orgId/clients/:clientId/deploy/:deploymentId', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    await removeDeployment(req.params['deploymentId'], req.params['clientId']);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/organisations/:orgId/clients/:clientId/generate ─────────────────

router.post('/:orgId/clients/:clientId/generate', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const deployments = await listDeployments(req.params['clientId']);
    if (deployments.length === 0) {
      return res.status(409).json({ error: 'No signal packs deployed to this client. Deploy a pack first.' });
    }

    const outputs = await generateComposableOutputs(client, req.params['clientId']);
    logger.info({ clientId: req.params['clientId'], outputCount: outputs.length }, 'Outputs generated');
    res.json({ outputs });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/organisations/:orgId/clients/:clientId/generate-all ─────────────
// Bulk regenerate: re-generate for ALL clients using a specific pack.

router.post('/:orgId/clients/:clientId/generate-all', async (req: Request, res: Response) => {
  try {
    const { pack_id } = req.body as { pack_id?: string };
    if (!pack_id) return res.status(400).json({ error: 'pack_id is required' });

    const rawClients = await getClientsByPack(pack_id, req.params['orgId']);
    const clientDetails = await Promise.all(
      rawClients.map((c) => getClient(c.id, req.params['orgId'])),
    );
    const clients = clientDetails.filter((c) => c !== null);
    const results = await Promise.allSettled(
      clients.map((c) => generateComposableOutputs(c, c.id)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    res.json({ regenerated: succeeded, failed, total: clients.length });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId/clients/:clientId/outputs ───────────────────

router.get('/:orgId/clients/:clientId/outputs', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const outputs = await listClientOutputs(req.params['clientId']);
    res.json({ outputs });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/organisations/:orgId/clients/:clientId/outputs/:outputId/download ─

router.get('/:orgId/clients/:clientId/outputs/:outputId/download', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const output = await getClientOutput(req.params['outputId'], req.params['clientId']);
    if (!output) return res.status(404).json({ error: 'Output not found' });

    const isHtml = output.output_type === 'implementation_guide';
    const ext = isHtml ? 'html' : 'json';
    const contentType = isHtml ? 'text/html' : 'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="atlas-${output.output_type}-v${output.version}.${ext}"`);
    res.send(isHtml ? output.output_data?.['html'] ?? '' : JSON.stringify(output.output_data, null, 2));
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/organisations/:orgId/clients/:clientId/audit ────────────────────
// Run an audit against this client's deployed signal packs.

router.post('/:orgId/clients/:clientId/audit', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const deployments = await listDeployments(req.params['clientId']);
    if (deployments.length === 0) {
      return res.status(409).json({ error: 'No signal packs deployed. Deploy a pack before running an audit.' });
    }

    const { test_email, test_phone } = req.body as { test_email?: string; test_phone?: string };

    // Map client business_type to a FunnelType
    const funnelTypeMap: Record<string, FunnelType> = {
      ecommerce: 'ecommerce',
      saas: 'saas',
      lead_gen: 'lead_gen',
    };
    const funnelType: FunnelType = funnelTypeMap[client.business_type] ?? 'ecommerce';

    // Build url_map from client pages
    const urlMap: Record<string, string> = {};
    for (const page of client.pages ?? []) {
      urlMap[page.page_type] = page.url;
    }

    const audit = await createAudit({
      user_id: req.user!.id,
      website_url: client.website_url,
      funnel_type: funnelType,
      region: 'us' as Region,
      test_email,
      test_phone,
    });

    // Build a simple validation spec from deployed signals
    const resolvedDeployments = await resolveDeploymentsForClient(req.params['clientId']);
    const allSignalKeys = resolvedDeployments.flatMap((d) =>
      d.signals.map((s) => s.signal.key),
    ).filter(Boolean);

    await auditQueue.add({
      audit_id: audit.id,
      website_url: client.website_url,
      funnel_type: funnelType,
      region: 'us',
      url_map: urlMap,
      validation_spec: { expected_signal_keys: allSignalKeys },
    });

    logger.info({ auditId: audit.id, clientId: req.params['clientId'] }, 'Client audit queued');
    res.status(202).json({ audit_id: audit.id, status: 'queued', created_at: audit.created_at });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as clientsRouter };
