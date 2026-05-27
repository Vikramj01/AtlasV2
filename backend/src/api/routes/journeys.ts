import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { strategyGate } from '../middleware/strategyGate';
import { sendInternalError } from '../../utils/apiError';
import { fetchProxyEvents } from '../../services/database/proxyEventQueries';
import type { ProxyEventRow } from '../../services/database/proxyEventQueries';
import {
  createJourney,
  listJourneys,
  getJourney,
  getJourneyWithDetails,
  updateJourney,
  deleteJourney,
  getJourneyStages,
  upsertStage,
  updateStage,
  deleteStage,
  reorderStages,
  upsertPlatforms,
  listSpecs,
  getLatestSpec,
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
} from '../../services/database/journeyQueries';
import { supabaseAdmin } from '../../services/database/supabase';
import {
  listSignals,
  createSignal,
  createSignalPack,
  addSignalToPack,
} from '../../services/database/signalQueries';
import logger from '../../utils/logger';
import { generateAndSaveSpecs } from '../../services/journey/specOrchestrator';
import { ACTION_PRIMITIVES, getActionPrimitive } from '../../services/journey/actionPrimitives';
import type { SpecFormat } from '../../types/journey';

const router = Router();
router.use(authMiddleware);

// ── Templates (must be before /:id to avoid being swallowed by the wildcard) ──

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const templates = await listTemplates(req.user!.id);
    res.json(templates);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { name, description, business_type, template_data } = req.body;
    if (!name || !business_type || !template_data) {
      return res.status(400).json({ error: 'name, business_type, and template_data are required' });
    }
    const template = await saveTemplate(
      req.user!.id,
      name,
      description ?? null,
      business_type,
      template_data,
    );
    res.status(201).json(template);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await deleteTemplate(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.post('/from-template/:templateId', async (req: Request, res: Response) => {
  try {
    const template = await getTemplate(req.params.templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const userId = req.user!.id;
    const journey = await createJourney(userId, {
      name: req.body.name || template.name,
      business_type: template.business_type as any,
      implementation_format: req.body.implementation_format || 'gtm',
    });

    for (const stageTemplate of template.template_data.stages) {
      await upsertStage(journey.id, {
        stage_order: stageTemplate.order,
        label: stageTemplate.label,
        page_type: stageTemplate.page_type,
        sample_url: null,
        actions: stageTemplate.actions,
      });
    }

    const details = await getJourneyWithDetails(journey.id, userId);
    res.status(201).json(details);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── Action Primitives (must be before /:id) ───────────────────────────────────

router.get('/action-primitives', (_req: Request, res: Response) => {
  res.json(ACTION_PRIMITIVES);
});

router.get('/action-primitives/:key', (req: Request, res: Response) => {
  const primitive = getActionPrimitive(req.params.key);
  if (!primitive) return res.status(404).json({ error: 'Action primitive not found' });
  res.json(primitive);
});

// ── Journeys CRUD ─────────────────────────────────────────────────────────────

router.post('/', strategyGate, async (req: Request, res: Response) => {
  const { name, business_type } = req.body as { name?: string; business_type?: string };
  if (!name || !business_type) {
    return res.status(400).json({ error: 'name and business_type are required' });
  }
  try {
    const userId = req.user!.id;
    const journey = await createJourney(userId, req.body);

    // If stages were provided inline, seed them
    if (req.body.stages?.length) {
      for (const stage of req.body.stages) {
        await upsertStage(journey.id, stage);
      }
    }

    // If platforms were provided inline, seed them
    if (req.body.platforms?.length) {
      await upsertPlatforms(journey.id, { platforms: req.body.platforms });
    }

    const details = await getJourneyWithDetails(journey.id, userId);
    res.status(201).json(details);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const journeys = await listJourneys(req.user!.id);
    res.json(journeys);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const details = await getJourneyWithDetails(req.params.id, req.user!.id);
    if (!details) return res.status(404).json({ error: 'Journey not found' });
    res.json(details);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const journey = await updateJourney(req.params.id, req.user!.id, req.body);
    res.json(journey);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteJourney(req.params.id, req.user!.id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/journeys/:id/client-link ──────────────────────────────────────

router.delete('/:id/client-link', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ data: null, error: 'Journey not found', message: null });

    const { error } = await supabaseAdmin
      .from('journeys')
      .update({ client_id: null })
      .eq('id', req.params.id);

    if (error) throw new Error(error.message);
    res.json({ data: { unlinked: true }, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Unlink journey from client failed');
    sendInternalError(res, err);
  }
});

// ── Stages ────────────────────────────────────────────────────────────────────

router.post('/:id/stages', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const stage = await upsertStage(req.params.id, req.body);
    res.status(201).json(stage);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.put('/:id/stages/reorder', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const { stage_ids } = req.body as { stage_ids: string[] };
    if (!Array.isArray(stage_ids)) return res.status(400).json({ error: 'stage_ids must be an array' });

    await reorderStages(req.params.id, stage_ids);
    const stages = await getJourneyStages(req.params.id);
    res.json(stages);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.put('/:id/stages/:stageId', async (req: Request, res: Response) => {
  const { buyer_intent_level } = req.body as { buyer_intent_level?: string };
  const validIntentLevels = ['problem_aware', 'solution_aware', 'vendor_aware'];
  if (buyer_intent_level && !validIntentLevels.includes(buyer_intent_level)) {
    return res.status(400).json({ error: 'buyer_intent_level must be one of: problem_aware, solution_aware, vendor_aware' });
  }
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const stage = await updateStage(req.params.stageId, req.params.id, req.body);
    res.json(stage);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.delete('/:id/stages/:stageId', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    await deleteStage(req.params.stageId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── Platforms ─────────────────────────────────────────────────────────────────

router.put('/:id/platforms', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const platforms = await upsertPlatforms(req.params.id, req.body);
    res.json(platforms);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── Spec Generation ───────────────────────────────────────────────────────────

router.post('/:id/generate', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const formats = req.body.formats as SpecFormat[] | undefined;
    const specs = await generateAndSaveSpecs(req.params.id, req.user!.id, formats);
    res.json({ generated: Object.keys(specs), specs });
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.get('/:id/specs', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const specs = await listSpecs(req.params.id);
    res.json(specs);
  } catch (err) {
    sendInternalError(res, err);
  }
});

router.get('/:id/specs/:format', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const format = req.params.format as SpecFormat;
    const spec = await getLatestSpec(req.params.id, format);
    if (!spec) return res.status(404).json({ error: 'Spec not found. Run /generate first.' });
    res.json(spec);
  } catch (err) {
    sendInternalError(res, err);
  }
});


// ── Save to Signal Library ────────────────────────────────────────────────────
// POST /api/journeys/:id/save-to-library
// Mirrors the planning session save-to-library bridge.
// Each stage becomes an org-scoped custom signal; all stages are bundled in a pack.

router.post('/:id/save-to-library', async (req: Request, res: Response) => {
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    // Resolve org from the journey's client or the user's profile
    let orgId = '';

    const journeyAny = journey as unknown as Record<string, unknown>;
    if (journeyAny.client_id) {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('organisation_id')
        .eq('id', journeyAny.client_id as string)
        .single();
      orgId = (clientRow as { organisation_id: string } | null)?.organisation_id ?? '';
    }

    if (!orgId) {
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('organization_id')
        .eq('id', req.user!.id)
        .single();
      orgId = (profileRow as { organisation_id: string } | null)?.organization_id ?? '';
    }

    if (!orgId) {
      return res.status(403).json({ error: 'No organisation found. Link this journey to a client first.' });
    }

    const [stages, existingSignals] = await Promise.all([
      getJourneyStages(req.params.id),
      listSignals(orgId),
    ]);

    if (stages.length === 0) return res.json({ data: { signals_created: 0, pack_id: null }, error: null, message: null });

    const existingKeys = new Set(existingSignals.map((s) => s.key));
    const toCreate = stages.filter((s) => {
      const key = s.label.toLowerCase().replace(/\s+/g, '_');
      return !existingKeys.has(key);
    });

    const createdSignals = await Promise.all(
      toCreate.map((stage) => {
        const key = stage.label.toLowerCase().replace(/\s+/g, '_');
        return createSignal({
          organisation_id: orgId,
          key,
          name: stage.label,
          description: stage.page_type ? `Stage: ${stage.page_type}` : '',
          category: 'conversion',
          required_params: [],
          optional_params: [],
          platform_mappings: {},
        });
      }),
    );

    // Create a pack named after the journey
    const pack = await createSignalPack({
      organisation_id: orgId,
      name: `Journey: ${journeyAny.name ?? 'Untitled Journey'}`,
      description: `Auto-generated from Journey Builder`,
      business_type: (journeyAny.business_type as string) ?? 'ecommerce',
    });

    // Add all signals (new + existing that match stages) to the pack
    const allSignalIds: string[] = createdSignals.map((s) => s.id);
    for (const stage of stages) {
      const key = stage.label.toLowerCase().replace(/\s+/g, '_');
      const existing = existingSignals.find((s) => s.key === key);
      if (existing && !allSignalIds.includes(existing.id)) {
        allSignalIds.push(existing.id);
      }
    }

    await Promise.all(allSignalIds.map((signalId) => addSignalToPack(pack.id, signalId)));

    // Stamp sync timestamp on stages
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('journey_stages')
      .update({ signal_library_synced_at: now })
      .eq('journey_id', req.params.id);

    logger.info({ journeyId: req.params.id, signalsCreated: createdSignals.length, packId: pack.id }, 'Journey saved to library');
    res.json({ data: { signals_created: createdSignals.length, pack_id: pack.id }, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Journey save-to-library failed');
    sendInternalError(res, err);
  }
});

// ── Proxy Event Library ────────────────────────────────────────────────────────
// GET /api/journeys/proxy-events?lag_class=long_lag&business_type=saas
// Returns proxy event recommendations filtered by lag class and optional vertical.

const VALID_LAG_CLASSES: ProxyEventRow['lag_class'][] = [
  'immediate',
  'short_lag',
  'long_lag',
  'deep_lag',
];

router.get('/proxy-events', async (req: Request, res: Response) => {
  try {
    const lagClass = req.query.lag_class as string | undefined;
    const businessType = req.query.business_type as string | undefined;

    if (!lagClass || !VALID_LAG_CLASSES.includes(lagClass as ProxyEventRow['lag_class'])) {
      return res.status(400).json({
        error: `lag_class is required and must be one of: ${VALID_LAG_CLASSES.join(', ')}`,
      });
    }

    const events = await fetchProxyEvents(
      lagClass as ProxyEventRow['lag_class'],
      businessType ?? null,
    );

    res.json({ data: events });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as journeysRouter };
