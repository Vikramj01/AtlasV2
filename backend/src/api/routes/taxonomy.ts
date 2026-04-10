/**
 * Taxonomy API routes
 *
 * GET  /api/taxonomy/tree              — Full nested tree (system + org events)
 * GET  /api/taxonomy/events            — Flat list of event nodes, filterable
 * GET  /api/taxonomy/search            — Full-text search across name/slug/desc
 * GET  /api/taxonomy/platform-mapping/:eventId/:platform
 * GET  /api/taxonomy/:id               — Single node
 * POST /api/taxonomy/event             — Create custom event
 * POST /api/taxonomy/category          — Create custom category
 * PUT  /api/taxonomy/:id               — Update custom node (system → 403)
 * DELETE /api/taxonomy/:id             — Soft-delete custom node (system → 403)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import {
  fetchTaxonomyFlat,
  fetchTaxonomyEvents,
  fetchTaxonomyNode,
  searchTaxonomy,
  fetchPlatformMapping,
  createCustomTaxonomyEvent,
  createCustomTaxonomyCategory,
  updateTaxonomyNode,
  deprecateTaxonomyNode,
  countSignalsForTaxonomyEvent,
} from '@/services/database/taxonomyQueries';
import { getNamingConvention } from '@/services/database/namingConventionQueries';
import { buildTree } from '@/services/signals/taxonomyTreeBuilder';
import { validateEventName } from '@/services/signals/namingConvention';

const router = Router();
router.use(authMiddleware);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const ParamSpecSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array']),
  description: z.string(),
  format: z.string().nullable(),
  item_schema: z.array(z.lazy((): z.ZodTypeAny => ParamSpecSchema)).optional(),
});

const ParameterSchemaSchema = z.object({
  required: z.array(ParamSpecSchema),
  optional: z.array(ParamSpecSchema),
});

const PlatformMappingSchema = z.object({
  event_name: z.string(),
  param_mapping: z.record(z.string()),
  additional_params: z.record(z.string()).optional(),
  required_params: z.array(z.string()).optional(),
  custom_event_name: z.string().optional(),
  requires_conversion_label: z.boolean().optional(),
});

const PlatformMappingsSchema = z.object({
  ga4: PlatformMappingSchema.optional(),
  meta: PlatformMappingSchema.optional(),
  google_ads: PlatformMappingSchema.optional(),
  tiktok: PlatformMappingSchema.optional(),
  linkedin: PlatformMappingSchema.optional(),
  snapchat: PlatformMappingSchema.optional(),
});

const CreateEventSchema = z.object({
  organization_id: z.string().uuid(),
  parent_path: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'slug must be lowercase alphanumeric with _ or -'),
  name: z.string().min(1),
  description: z.string().optional(),
  funnel_stage: z.enum(['awareness', 'consideration', 'conversion', 'retention', 'advocacy']).optional(),
  parameter_schema: ParameterSchemaSchema,
  platform_mappings: PlatformMappingsSchema.optional(),
  icon: z.string().optional(),
});

const CreateCategorySchema = z.object({
  organization_id: z.string().uuid(),
  parent_path: z.string().optional(),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'slug must be lowercase alphanumeric with _ or -'),
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
});

const UpdateNodeSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  funnel_stage: z.enum(['awareness', 'consideration', 'conversion', 'retention', 'advocacy']).optional(),
  parameter_schema: ParameterSchemaSchema.optional(),
  platform_mappings: PlatformMappingsSchema.optional(),
  icon: z.string().optional(),
  display_order: z.number().int().optional(),
});

// ─── GET /api/taxonomy/tree ───────────────────────────────────────────────────

router.get('/tree', async (req: Request, res: Response) => {
  try {
    const orgId = req.query['org_id'] as string ?? req.user!.id;
    const flat = await fetchTaxonomyFlat(orgId);
    const tree = buildTree(flat);
    res.json({ tree });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── GET /api/taxonomy/events ─────────────────────────────────────────────────

router.get('/events', async (req: Request, res: Response) => {
  try {
    const orgId = req.query['org_id'] as string ?? req.user!.id;
    const filters = {
      category: req.query['category'] as string | undefined,
      funnel_stage: req.query['funnel_stage'] as string | undefined,
    };
    const events = await fetchTaxonomyEvents(orgId, filters);
    res.json({ events });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── GET /api/taxonomy/search ─────────────────────────────────────────────────
// Must be before /:id to avoid being caught by it

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = req.query['q'] as string;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }
    const orgId = req.query['org_id'] as string ?? req.user!.id;
    const results = await searchTaxonomy(orgId, q.trim());
    res.json({ results });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── GET /api/taxonomy/platform-mapping/:eventId/:platform ───────────────────

router.get('/platform-mapping/:eventId/:platform', async (req: Request, res: Response) => {
  try {
    const { eventId, platform } = req.params as { eventId: string; platform: string };
    const mapping = await fetchPlatformMapping(eventId, platform);
    if (!mapping) return res.status(404).json({ error: 'No mapping found for this event/platform combination' });
    res.json({ mapping });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── POST /api/taxonomy/event ─────────────────────────────────────────────────

router.post('/event', async (req: Request, res: Response) => {
  try {
    const parsed = CreateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // Validate slug against org's naming convention
    const convention = await getNamingConvention(data.organization_id);
    const validation = validateEventName(data.slug, convention);
    if (!validation.valid) {
      return res.status(422).json({
        error: 'Slug does not match your naming convention',
        validation_errors: validation.errors,
        suggestions: validation.suggestions,
      });
    }

    const node = await createCustomTaxonomyEvent(data);
    res.status(201).json({ node });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not found')) return res.status(404).json({ error: msg });
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'An event with that path already exists' });
    }
    sendInternalError(res, err);
  }
});

// ─── POST /api/taxonomy/category ──────────────────────────────────────────────

router.post('/category', async (req: Request, res: Response) => {
  try {
    const parsed = CreateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const node = await createCustomTaxonomyCategory(parsed.data);
    res.status(201).json({ node });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not found')) return res.status(404).json({ error: msg });
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'A category with that path already exists' });
    }
    sendInternalError(res, err);
  }
});

// ─── GET /api/taxonomy/:id ────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const node = await fetchTaxonomyNode(req.params['id']);
    if (!node) return res.status(404).json({ error: 'Taxonomy node not found' });
    res.json({ node });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── PUT /api/taxonomy/:id ────────────────────────────────────────────────────

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const node = await fetchTaxonomyNode(req.params['id']);
    if (!node) return res.status(404).json({ error: 'Taxonomy node not found' });
    if (node.is_system) return res.status(403).json({ error: 'System taxonomy entries cannot be modified' });

    const parsed = UpdateNodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const updated = await updateTaxonomyNode(req.params['id'], req.user!.id, parsed.data);
    res.json({ node: updated });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── DELETE /api/taxonomy/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const node = await fetchTaxonomyNode(req.params['id']);
    if (!node) return res.status(404).json({ error: 'Taxonomy node not found' });
    if (node.is_system) return res.status(403).json({ error: 'System taxonomy entries cannot be deleted' });

    // Warn if signals are linked
    const signalCount = await countSignalsForTaxonomyEvent(req.params['id']);
    if (signalCount > 0 && req.query['force'] !== 'true') {
      return res.status(409).json({
        error: `${signalCount} signal(s) are linked to this event. Pass ?force=true to deprecate anyway.`,
        signal_count: signalCount,
      });
    }

    await deprecateTaxonomyNode(req.params['id'], req.user!.id);
    res.json({ success: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as taxonomyRouter };
