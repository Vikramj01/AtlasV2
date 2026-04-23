import { Router } from 'express';
import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { env } from '@/config/env';
import logger from '@/utils/logger';
import { supabaseAdmin } from '@/services/database/supabase';
import {
  createBrief,
  getBriefById,
  updateBrief,
  lockBrief,
  listBriefs,
  addObjective,
  updateObjective,
  deleteObjective,
  persistObjectiveVerdict,
  lockObjective,
  getObjectiveById,
  addCampaign,
  deleteCampaign,
  getCampaignOrgId,
} from '@/services/database/strategyObjectivesQueries';
import { evaluateObjectiveWithClaude } from '@/services/strategy/evaluationPrompt';
import type { EvaluationInput } from '@/services/strategy/evaluationPrompt';

const router = Router();
router.use(authMiddleware);

// Strategy Gate is available on all plans — authMiddleware only, no planGuard.

let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: POST /api/strategy/evaluate
// Kept for one release. Thin compatibility wrapper — does not persist.
// ─────────────────────────────────────────────────────────────────────────────

interface LegacyEvaluateBody {
  businessType: string;
  outcomeDescription: string;
  outcomeTimingDays: number;
  currentEventName: string;
  eventSource: string;
  valueDataPresent: boolean;
}

router.post('/evaluate', async (req: Request, res: Response): Promise<void> => {
  const {
    businessType,
    outcomeDescription,
    outcomeTimingDays,
    currentEventName,
    eventSource,
    valueDataPresent,
  } = req.body as LegacyEvaluateBody;

  if (!businessType || !outcomeDescription || outcomeTimingDays === undefined || !currentEventName || !eventSource) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  if (typeof outcomeDescription !== 'string' || outcomeDescription.trim().length < 30) {
    res.status(400).json({ error: 'outcomeDescription must be at least 30 characters' });
    return;
  }

  try {
    const client = getAnthropicClient();

    const userPrompt = `Business type: ${businessType}
Business outcome: ${outcomeDescription}
Typical days from ad click to outcome: ${outcomeTimingDays}
Current optimisation event: ${currentEventName}
Event source: ${eventSource}
Value data present: ${valueDataPresent}

Evaluate whether the current event is well-matched to the stated business outcome.

Respond with this exact JSON structure:
{
  "outcomeCategory": "purchase | qualified_lead | activation_milestone | retention_event | donation",
  "eventVerdict": "CONFIRM | AUGMENT | REPLACE",
  "verdictRationale": "Plain-language explanation of the verdict in 2-3 sentences.",
  "recommendedEventName": "Name of recommended event, or null if verdict is CONFIRM",
  "recommendedEventRationale": "Why this event is a better fit, or null if verdict is CONFIRM",
  "proxyEventRequired": true | false,
  "proxyEventName": "Recommended proxy event name if timing > 1 day, or null",
  "proxyEventRationale": "Why this proxy is a good predictor of the downstream outcome, or null",
  "summaryMarkdown": "A full strategy brief in markdown (3-5 short paragraphs) covering: the outcome, the verdict, the recommended event, and the proxy event if applicable. Written for a marketing practitioner."
}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a conversion strategy analyst for digital advertising campaigns. Your job is to evaluate whether a client's current conversion event is well-matched to their stated business outcome, and to recommend improvements where needed.

Always respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON object.`,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const brief = JSON.parse(cleaned) as Record<string, unknown>;

    if (outcomeTimingDays > 1) {
      brief.proxyEventRequired = true;
    }

    res.json({ data: brief });
  } catch (err) {
    logger.error({ err }, 'Strategy evaluation failed');
    sendInternalError(res, err, 'strategy/evaluate');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: POST /api/strategy/save-brief
// ─────────────────────────────────────────────────────────────────────────────

const saveBriefSchema = z.object({
  business_outcome: z.string().min(1),
  outcome_timing_days: z.number().int().positive(),
  current_event: z.string().optional(),
  verdict: z.enum(['keep', 'add_proxy', 'switch']),
  proxy_event: z.string().optional(),
  rationale: z.string().optional(),
  client_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});

router.post('/save-brief', async (req: Request, res: Response): Promise<void> => {
  const parse = saveBriefSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const userId = req.user.id;
  const { business_outcome, outcome_timing_days, current_event, verdict, proxy_event, rationale, client_id, project_id } = parse.data;

  try {
    const { data, error } = await supabaseAdmin
      .from('strategy_briefs')
      .insert({
        organization_id: userId,
        business_outcome,
        outcome_timing_days,
        current_event: current_event ?? null,
        verdict,
        proxy_event: proxy_event ?? null,
        rationale: rationale ?? null,
        client_id: client_id ?? null,
        project_id: project_id ?? null,
      })
      .select('id')
      .single();

    if (error) throw error;
    res.status(201).json({ data, error: null, message: 'Strategy brief saved.' });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save strategy brief');
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: GET /api/strategy/briefs (list)
// Now returns briefs without objectives for backward compat.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/briefs', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  try {
    const briefs = await listBriefs(userId);
    res.json({ data: briefs, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: POST /api/strategy/briefs/create
// Creates an empty brief (mode = single|multiple).
// ─────────────────────────────────────────────────────────────────────────────

const createBriefSchema = z.object({
  mode: z.enum(['single', 'multiple']),
  brief_name: z.string().max(120).optional(),
  client_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});

router.post('/briefs/create', async (req: Request, res: Response): Promise<void> => {
  const parse = createBriefSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const orgId = req.user.id;
  const { mode, brief_name, client_id, project_id } = parse.data;

  try {
    const brief = await createBrief(orgId, mode, brief_name, client_id, project_id);
    res.status(201).json({ data: brief, error: null, message: 'Strategy brief created.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: GET /api/strategy/briefs/:id
// Fetch brief + all objectives + campaigns.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/briefs/:id', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user.id;
  const { id } = req.params;

  try {
    const brief = await getBriefById(id);
    if (!brief) {
      res.status(404).json({ error: 'Strategy brief not found.', data: null, message: null });
      return;
    }
    if (brief.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }
    res.json({ data: brief, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: PATCH /api/strategy/briefs/:id
// Update brief-level fields (name, mode).
// ─────────────────────────────────────────────────────────────────────────────

const patchBriefSchema = z.object({
  brief_name: z.string().max(120).optional(),
  mode: z.enum(['single', 'multiple']).optional(),
});

router.patch('/briefs/:id', async (req: Request, res: Response): Promise<void> => {
  const parse = patchBriefSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const orgId = req.user.id;
  const { id } = req.params;

  try {
    const brief = await getBriefById(id);
    if (!brief) {
      res.status(404).json({ error: 'Strategy brief not found.', data: null, message: null });
      return;
    }
    if (brief.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }
    if (brief.locked_at) {
      res.status(400).json({ error: 'Locked briefs cannot be edited. Create a new version instead.', data: null, message: null });
      return;
    }

    await updateBrief(id, parse.data);
    res.json({ data: null, error: null, message: 'Brief updated.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: POST /api/strategy/briefs/:id/objectives
// Add an objective to a brief.
// ─────────────────────────────────────────────────────────────────────────────

const addObjectiveSchema = z.object({
  name: z.string().min(3).max(50),
  business_outcome: z.string().min(30),
  outcome_timing_days: z.number().int().min(1),
  current_event: z.string().optional(),
  platforms: z.array(z.enum(['meta', 'google', 'linkedin', 'tiktok', 'other'])),
  priority: z.number().int().positive().optional(),
});

router.post('/briefs/:id/objectives', async (req: Request, res: Response): Promise<void> => {
  const parse = addObjectiveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const orgId = req.user.id;
  const { id: briefId } = req.params;

  try {
    const brief = await getBriefById(briefId);
    if (!brief) {
      res.status(404).json({ error: 'Strategy brief not found.', data: null, message: null });
      return;
    }
    if (brief.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }

    const result = await addObjective(briefId, orgId, parse.data);

    const message = result.soft_cap_warning
      ? 'Most projects need 3 or fewer distinct objectives. Consider whether some of these overlap, or whether you need multiple Atlas projects.'
      : 'Objective added.';

    res.status(201).json({ data: result.objective, error: null, message, soft_cap_warning: result.soft_cap_warning });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      res.status(400).json({ error: e.message ?? 'Bad request', data: null, message: null });
      return;
    }
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: PATCH /api/strategy/objectives/:id
// Update objective inputs (not verdict fields).
// ─────────────────────────────────────────────────────────────────────────────

const patchObjectiveSchema = z.object({
  name: z.string().min(3).max(50).optional(),
  business_outcome: z.string().min(30).optional(),
  outcome_timing_days: z.number().int().min(1).optional(),
  current_event: z.string().optional(),
  platforms: z.array(z.enum(['meta', 'google', 'linkedin', 'tiktok', 'other'])).optional(),
  priority: z.number().int().positive().optional(),
});

router.patch('/objectives/:id', async (req: Request, res: Response): Promise<void> => {
  const parse = patchObjectiveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const orgId = req.user.id;
  const { id: objectiveId } = req.params;

  try {
    const objective = await getObjectiveById(objectiveId);
    if (!objective) {
      res.status(404).json({ error: 'Objective not found.', data: null, message: null });
      return;
    }
    if (objective.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }
    if (objective.locked) {
      res.status(400).json({ error: 'Locked objectives cannot be edited.', data: null, message: null });
      return;
    }

    await updateObjective(objectiveId, parse.data);
    res.json({ data: null, error: null, message: 'Objective updated.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: DELETE /api/strategy/objectives/:id
// Remove an objective (only if brief not fully locked).
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/objectives/:id', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user.id;
  const { id: objectiveId } = req.params;

  try {
    const objective = await getObjectiveById(objectiveId);
    if (!objective) {
      res.status(404).json({ error: 'Objective not found.', data: null, message: null });
      return;
    }
    if (objective.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }

    const brief = await getBriefById(objective.brief_id);
    if (brief?.locked_at) {
      res.status(400).json({ error: 'Objectives cannot be removed from a locked brief.', data: null, message: null });
      return;
    }

    await deleteObjective(objectiveId);
    res.json({ data: null, error: null, message: 'Objective removed.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: POST /api/strategy/objectives/:id/evaluate
// Calls Claude to evaluate one objective. Persists verdict to the DB.
// heavyLimiter is applied in app.ts for this path.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/objectives/:id/evaluate', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user.id;
  const { id: objectiveId } = req.params;

  try {
    const objective = await getObjectiveById(objectiveId);
    if (!objective) {
      res.status(404).json({ error: 'Objective not found.', data: null, message: null });
      return;
    }
    if (objective.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }
    if (objective.locked) {
      res.status(400).json({ error: 'Locked objectives cannot be re-evaluated.', data: null, message: null });
      return;
    }

    const input: EvaluationInput = {
      objectiveName: objective.name,
      businessType: req.body.businessType ?? 'other',
      businessOutcome: objective.business_outcome,
      outcomeTimingDays: objective.outcome_timing_days,
      currentEvent: objective.current_event,
      platforms: objective.platforms,
    };

    const verdictData = await evaluateObjectiveWithClaude(getAnthropicClient(), input);
    await persistObjectiveVerdict(objectiveId, verdictData);

    res.json({ data: verdictData, error: null, message: 'Objective evaluated.' });
  } catch (err) {
    logger.error({ err }, 'Objective evaluation failed');
    sendInternalError(res, err, 'strategy/objectives/evaluate');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: POST /api/strategy/objectives/:id/lock
// Mark one objective as locked. Requires a verdict to be present.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/objectives/:id/lock', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user.id;
  const { id: objectiveId } = req.params;

  try {
    const objective = await getObjectiveById(objectiveId);
    if (!objective) {
      res.status(404).json({ error: 'Objective not found.', data: null, message: null });
      return;
    }
    if (objective.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }

    await lockObjective(objectiveId);
    res.json({ data: null, error: null, message: 'Objective locked.' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400 || e.status === 404) {
      res.status(e.status).json({ error: e.message ?? 'Bad request', data: null, message: null });
      return;
    }
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: POST /api/strategy/briefs/:id/lock
// Lock the whole brief. All objectives must be individually locked first.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/briefs/:id/lock', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user.id;
  const { id: briefId } = req.params;

  try {
    const brief = await getBriefById(briefId);
    if (!brief) {
      res.status(404).json({ error: 'Strategy brief not found.', data: null, message: null });
      return;
    }
    if (brief.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }

    await lockBrief(briefId);
    res.json({ data: null, error: null, message: 'Strategy brief locked.' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      res.status(400).json({ error: e.message ?? 'Bad request', data: null, message: null });
      return;
    }
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: POST /api/strategy/objectives/:id/campaigns
// Add a campaign assignment to an objective.
// ─────────────────────────────────────────────────────────────────────────────

const addCampaignSchema = z.object({
  platform: z.enum(['meta', 'google', 'linkedin', 'tiktok', 'other']),
  campaign_identifier: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

router.post('/objectives/:id/campaigns', async (req: Request, res: Response): Promise<void> => {
  const parse = addCampaignSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const orgId = req.user.id;
  const { id: objectiveId } = req.params;

  try {
    const objective = await getObjectiveById(objectiveId);
    if (!objective) {
      res.status(404).json({ error: 'Objective not found.', data: null, message: null });
      return;
    }
    if (objective.organization_id !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }

    const campaign = await addCampaign(objectiveId, orgId, parse.data);
    res.status(201).json({ data: campaign, error: null, message: 'Campaign added.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: DELETE /api/strategy/campaigns/:id
// Remove a campaign assignment.
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/campaigns/:id', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user.id;
  const { id: campaignId } = req.params;

  try {
    const campaignOrgId = await getCampaignOrgId(campaignId);
    if (!campaignOrgId) {
      res.status(404).json({ error: 'Campaign not found.', data: null, message: null });
      return;
    }
    if (campaignOrgId !== orgId && !req.user.isSuperAdmin) {
      res.status(403).json({ error: 'Access denied.', data: null, message: null });
      return;
    }

    await deleteCampaign(campaignId);
    res.json({ data: null, error: null, message: 'Campaign removed.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as strategyRouter };
