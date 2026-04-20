import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { strategyGate } from '../middleware/strategyGate';
import { sendInternalError } from '../../utils/apiError';
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
  try {
    const journey = await getJourney(req.params.id, req.user!.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found' });

    const stage = await updateStage(req.params.stageId, req.body);
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


export { router as journeysRouter };
