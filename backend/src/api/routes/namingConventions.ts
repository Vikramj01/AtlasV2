/**
 * Naming Convention API routes
 *
 * GET  /api/naming-convention          — Org's convention (or defaults)
 * PUT  /api/naming-convention          — Create or update org's convention
 * POST /api/naming-convention/validate — Validate a name in real time
 * POST /api/naming-convention/preview  — Preview how existing signals rename
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { getNamingConvention, upsertNamingConvention } from '@/services/database/namingConventionQueries';
import { listSignals } from '@/services/database/signalQueries';
import {
  validateEventName,
  validateParamKey,
  generateEventName,
  buildExamples,
} from '@/services/signals/namingConvention';
import type { NamingConvention } from '@/types/taxonomy';

const router = Router();
router.use(authMiddleware);

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const ConventionSchema = z.object({
  event_case: z.enum(['snake_case', 'camelCase', 'kebab-case', 'PascalCase']).optional(),
  param_case: z.enum(['snake_case', 'camelCase', 'kebab-case', 'PascalCase']).optional(),
  event_prefix: z.string().max(20).nullable().optional(),
  param_prefix: z.string().max(20).nullable().optional(),
  word_separator: z.string().max(1).optional(),
  max_event_name_length: z.number().int().min(10).max(100).optional(),
  max_param_key_length: z.number().int().min(10).max(100).optional(),
  allowed_characters: z.string().optional(),
  reserved_words: z.array(z.string()).optional(),
});

const ValidateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['event', 'param']),
  org_id: z.string().uuid().optional(),
});

const PreviewSchema = z.object({
  org_id: z.string().uuid().optional(),
  convention: ConventionSchema,
});

// ─── GET /api/naming-convention ───────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const orgId = req.query['org_id'] as string ?? req.user!.id;
    const convention = await getNamingConvention(orgId);
    res.json({ convention });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── PUT /api/naming-convention ───────────────────────────────────────────────

router.put('/', async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.id;
    const parsed = ConventionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    // Build examples before saving so they're stored and returned
    const current = await getNamingConvention(orgId);
    const merged: NamingConvention = { ...current, ...parsed.data, organization_id: orgId };
    const examples = buildExamples(merged);

    const convention = await upsertNamingConvention(orgId, { ...parsed.data, ...examples });
    res.json({ convention });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── POST /api/naming-convention/validate ─────────────────────────────────────

router.post('/validate', async (req: Request, res: Response) => {
  try {
    const parsed = ValidateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { name, type, org_id } = parsed.data;
    const orgId = org_id ?? req.user!.id;

    const convention = await getNamingConvention(orgId);
    const result = type === 'event'
      ? validateEventName(name, convention)
      : validateParamKey(name, convention);

    res.json(result);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─── POST /api/naming-convention/preview ──────────────────────────────────────
// Shows how existing signals would be renamed under a proposed convention.

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { org_id, convention: partial } = parsed.data;
    const orgId = org_id ?? req.user!.id;

    // Merge proposed convention over current
    const current = await getNamingConvention(orgId);
    const proposed: NamingConvention = { ...current, ...partial, organization_id: orgId };

    // Get org's signals (excluding system signals)
    const signals = await listSignals(orgId);
    const orgSignals = signals.filter(s => !s.is_system);

    const renames = orgSignals.map(signal => {
      const suggested = generateEventName(signal.key as string, proposed);
      return {
        signal_id: signal.id,
        current: signal.key,
        suggested,
        changed: signal.key !== suggested,
      };
    }).filter(r => r.changed);

    const examples = buildExamples(proposed);

    res.json({ renames, examples, total_signals: orgSignals.length });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as namingConventionsRouter };
