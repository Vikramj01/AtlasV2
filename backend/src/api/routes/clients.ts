/**
 * Client routes — /api/organisations/:orgId/clients
 *
 * Covers: client CRUD, platform config, pages, pack deployment,
 * output generation, and auditing from deployed signals.
 */

import { Router } from 'express';
import { z } from 'zod';
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
  getClientPlatform,
  markClientPlatformVerified,
  upsertClientPages,
  listDeployments,
  deployPack,
  removeDeployment,
  listClientOutputs,
  getClientOutput,
  getClientsByPack,
} from '@/services/database/clientQueries';
import { probeUrl } from '@/services/dqm/httpProbe';
import {
  getSignalPackWithSignals,
  resolveDeploymentsForClient,
  saveClientAsAgencyTemplatePack,
} from '@/services/database/signalQueries';
import { getOrgClientSummary } from '@/services/clients/clientSummaryService';
import { generateComposableOutputs } from '@/services/signals/composableOutputGenerator';
import { createAudit } from '@/services/database/queries';
import { auditQueue } from '@/services/queue/jobQueue';
import { getCurrentTopologyRows, getTopologyHistory, writeTopologySnapshot } from '@/services/database/googleTagTopologyQueries';
import { computeTopologyVerdict } from '@/services/google/googleTagTopology';
import { kindFromGoogleId } from '@/services/google/googleTagClassifier';
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
    const {
      name, website_url, business_type, notes, auto_detect,
      primary_conversion_objective, apply_pack_id, copy_signals_from_client_id,
      secondary_domains,
    } = req.body as {
      name?: string;
      website_url?: string;
      business_type?: BusinessType;
      notes?: string;
      auto_detect?: boolean;
      primary_conversion_objective?: string;
      apply_pack_id?: string;
      copy_signals_from_client_id?: string;
      secondary_domains?: string[];
    };

    if (!name || !website_url || !business_type) {
      return res.status(400).json({ error: 'name, website_url, and business_type are required' });
    }
    const urlResult = validateUrl(website_url);
    if (!urlResult.valid) {
      return res.status(400).json({ error: `Invalid website_url: ${urlResult.error}` });
    }
    if (primary_conversion_objective && primary_conversion_objective.length > 500) {
      return res.status(400).json({ error: 'primary_conversion_objective must be 500 characters or fewer' });
    }

    // Optionally run site detection to prefill detected_platform
    let detectedPlatform: string | undefined;
    if (auto_detect) {
      const detection = await detectSite(website_url).catch(() => null);
      detectedPlatform = detection?.detected_platform?.name ?? undefined;
    }

    // If copying from another client, collect their pack IDs first
    let sourcePackIds: string[] = [];
    if (copy_signals_from_client_id) {
      const sourceDeployments = await listDeployments(copy_signals_from_client_id);
      sourcePackIds = sourceDeployments.map((d) => d.pack_id);
    }

    const orgId = req.params['orgId'];
    const client = await createClient(orgId, {
      name,
      website_url,
      business_type,
      notes,
      detected_platform: detectedPlatform,
      primary_conversion_objective,
      template_source_client_id: copy_signals_from_client_id,
      template_source_pack_id: apply_pack_id,
      secondary_domains: Array.isArray(secondary_domains) ? secondary_domains : [],
    });

    // Deploy packs from the starting point choice
    const packIdsToDeploy = apply_pack_id ? [apply_pack_id] : sourcePackIds;
    for (const packId of packIdsToDeploy) {
      await deployPack(client.id, packId).catch(() => null);
    }

    logger.info({ orgId, clientId: client.id }, 'Client created');
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

// ── GET /api/organisations/:orgId/clients/summary ─────────────────────────────
// Must be registered before /:clientId to avoid Express matching "summary" as an ID

router.get('/:orgId/clients/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getOrgClientSummary(req.params['orgId']);
    res.json(summary);
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

// ── POST /api/organisations/:orgId/clients/:clientId/save-as-pack ────────────

router.post('/:orgId/clients/:clientId/save-as-pack', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const pack = await saveClientAsAgencyTemplatePack(
      req.params['orgId'],
      req.params['clientId'],
      name.trim(),
      description?.trim(),
    );

    logger.info({ orgId: req.params['orgId'], clientId: req.params['clientId'], packId: pack.id }, 'Agency template pack saved');
    res.status(201).json(pack);
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

// ── POST /api/organisations/:orgId/clients/:clientId/platforms/sgtm/verify ────
// HEAD-checks the client's claimed sGTM transport URL and marks it verified
// on success. Prerequisite for DQM sGTM monitoring (dqmOrchestrator only
// probes endpoints with is_verified = true) and for future tag-generation.

router.post('/:orgId/clients/:clientId/platforms/sgtm/verify', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const sgtmPlatform = await getClientPlatform(req.params['clientId'], 'sgtm');
    if (!sgtmPlatform?.measurement_id) {
      return res.status(400).json({ error: 'No server-side GTM endpoint URL is configured for this client' });
    }

    const result = await probeUrl(sgtmPlatform.measurement_id);
    if (result.checkStatus !== 'pass' && result.checkStatus !== 'degraded') {
      return res.status(422).json({
        error: `Endpoint did not respond successfully (${result.errorMessage ?? result.checkStatus})`,
        verified: false,
      });
    }

    const updated = await markClientPlatformVerified(req.params['clientId'], 'sgtm', true);
    res.json({ verified: true, verified_at: updated.verified_at, platform: updated });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── Google Tag Topology (PRD §6, §11) ─────────────────────────────────────────
// Mounted under /api/organisations like every other client route (the PRD's
// literal /api/clients/:id/... path doesn't exist in this codebase).

// GET /api/organisations/:orgId/clients/:clientId/google-tag-topology
router.get('/:orgId/clients/:clientId/google-tag-topology', async (req: Request, res: Response) => {
  try {
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const [current, history] = await Promise.all([
      getCurrentTopologyRows(req.params['clientId']),
      getTopologyHistory(req.params['clientId']),
    ]);
    res.json({ data: { ...computeTopologyVerdict(current), current, history }, error: null, message: 'ok' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

const googleDestinationId = z
  .string()
  .trim()
  .refine((id) => kindFromGoogleId(id) !== 'unknown', { message: 'Must be a G-, AW-, DC- or GT- ID' });

const declareTopologySchema = z
  .object({
    google_tag_id: googleDestinationId,
    primary_destination_id: googleDestinationId.optional(),
    destination_ids: z.array(googleDestinationId).min(1).max(20),
    declaration_source: z.enum(['CLIENT_CONFIRMED', 'OPERATOR_ASSUMED']),
  })
  .refine((b) => !b.primary_destination_id || b.destination_ids.includes(b.primary_destination_id), {
    message: 'primary_destination_id must be one of destination_ids',
    path: ['primary_destination_id'],
  });

// POST /api/organisations/:orgId/clients/:clientId/google-tag-topology/declare
router.post('/:orgId/clients/:clientId/google-tag-topology/declare', async (req: Request, res: Response) => {
  try {
    const parsed = declareTopologySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ data: null, error: 'Invalid request', message: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    const client = await getClient(req.params['clientId'], req.params['orgId']);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const b = parsed.data;
    await writeTopologySnapshot({
      organizationId: req.params['orgId'],
      clientId: req.params['clientId'],
      rows: [{
        google_tag_id: b.google_tag_id,
        primary_destination_id: b.primary_destination_id ?? null,
        destination_ids: [...new Set(b.destination_ids)],
        source: 'operator_declared',
        declaration_source: b.declaration_source,
      }],
    });
    const verdict = computeTopologyVerdict(await getCurrentTopologyRows(req.params['clientId']));
    res.status(201).json({ data: verdict, error: null, message: 'Declaration recorded' });
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
