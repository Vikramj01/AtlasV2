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
  buildUserPrompt,
  enforceProxyRule,
  parseEvalResponse,
  SYSTEM_PROMPT,
} from '@/services/strategy/evaluationPrompt';
import {
  createBrief,
  patchBrief,
  lockBrief,
  getBriefWithObjectives,
  listBriefs,
  deleteBrief,
  createObjective,
  getObjective,
  updateObjective,
  deleteObjective,
  setObjectiveEvaluation,
  lockObjective,
  addCampaign,
} from '@/services/database/strategyObjectivesQueries';

const router = Router();
router.use(authMiddleware);

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

function handleKnownError(res: Response, err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'HARD_CAP') { res.status(422).json({ error: err.message }); return true; }
    if (code === 'DUPLICATE_NAME') { res.status(409).json({ error: err.message }); return true; }
    if (code === 'LOCKED') { res.status(403).json({ error: err.message }); return true; }
    if (code === 'NOT_FOUND') { res.status(404).json({ error: err.message }); return true; }
    if (code === 'OBJECTIVES_NOT_LOCKED') { res.status(400).json({ error: err.message }); return true; }
  }
  return false;
}

// ── Legacy endpoints (preserved for compatibility) ────────────────────────────

// POST /api/strategy/evaluate
router.post('/evaluate', async (req: Request, res: Response): Promise<void> => {
  const {
    businessType,
    outcomeDescription,
    outcomeTimingDays,
    currentEventName,
    eventSource,
    valueDataPresent,
  } = req.body as {
    businessType: string;
    outcomeDescription: string;
    outcomeTimingDays: number;
    currentEventName: string;
    eventSource: string;
    valueDataPresent: boolean;
  };

  if (!businessType || !outcomeDescription || outcomeTimingDays === undefined || !currentEventName || !eventSource) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  if (typeof outcomeDescription !== 'string' || outcomeDescription.trim().length < 30) {
    res.status(400).json({ error: 'outcomeDescription must be at least 30 characters' });
    return;
  }

  try {
    const client = getClient();
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
    if (outcomeTimingDays > 1) brief.proxyEventRequired = true;

    res.json({ data: brief });
  } catch (err) {
    logger.error({ err }, 'Strategy evaluation failed');
    sendInternalError(res, err, 'strategy/evaluate');
  }
});

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

// POST /api/strategy/save-brief
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

// ── Brief endpoints ───────────────────────────────────────────────────────────

const createBriefSchema = z.object({
  mode: z.enum(['single', 'multi']).optional(),
  brief_name: z.string().max(120).optional(),
  client_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});

const patchBriefSchema = z.object({
  brief_name: z.string().max(120).optional(),
  mode: z.enum(['single', 'multi']).optional(),
});

// POST /api/strategy/briefs
router.post('/briefs', async (req: Request, res: Response): Promise<void> => {
  const parse = createBriefSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }
  try {
    const brief = await createBrief(req.user.id, parse.data);
    res.status(201).json({ data: brief, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// GET /api/strategy/briefs
router.get('/briefs', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await listBriefs(req.user.id);
    res.json({ data, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// GET /api/strategy/briefs/:id
router.get('/briefs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getBriefWithObjectives(req.params.id, req.user.id);
    if (!data) { res.status(404).json({ error: 'Brief not found' }); return; }
    res.json({ data, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// PATCH /api/strategy/briefs/:id
router.patch('/briefs/:id', async (req: Request, res: Response): Promise<void> => {
  const parse = patchBriefSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }
  try {
    const data = await patchBrief(req.params.id, req.user.id, parse.data);
    res.json({ data, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// DELETE /api/strategy/briefs/:id
router.delete('/briefs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteBrief(req.params.id, req.user.id);
    res.json({ data: null, error: null, message: 'Brief deleted.' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// POST /api/strategy/briefs/:id/lock
router.post('/briefs/:id/lock', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await lockBrief(req.params.id, req.user.id);
    res.json({ data, error: null, message: 'Brief locked.' });
  } catch (err) {
    if (handleKnownError(res, err)) return;
    sendInternalError(res, err);
  }
});

// ── Objective endpoints ───────────────────────────────────────────────────────

const createObjectiveSchema = z.object({
  brief_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  platforms: z.array(z.string()).max(10).optional(),
  current_event: z.string().max(120).optional(),
  outcome_timing_days: z.number().int().positive().optional(),
});

// POST /api/strategy/objectives
router.post('/objectives', async (req: Request, res: Response): Promise<void> => {
  const parse = createObjectiveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }
  try {
    const { objective, atSoftCap } = await createObjective(req.user.id, parse.data);
    res.status(201).json({
      data: objective,
      error: null,
      message: atSoftCap ? `You have reached ${5} objectives — consider splitting into separate briefs for clarity.` : null,
    });
  } catch (err) {
    if (handleKnownError(res, err)) return;
    sendInternalError(res, err);
  }
});

// GET /api/strategy/objectives/:id
router.get('/objectives/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await getObjective(req.params.id, req.user.id);
    if (!data) { res.status(404).json({ error: 'Objective not found' }); return; }
    res.json({ data, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

const updateObjectiveSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  platforms: z.array(z.string()).max(10).optional(),
  current_event: z.string().max(120).optional(),
  outcome_timing_days: z.number().int().positive().optional(),
});

// PUT /api/strategy/objectives/:id
router.put('/objectives/:id', async (req: Request, res: Response): Promise<void> => {
  const parse = updateObjectiveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }
  try {
    const data = await updateObjective(req.params.id, req.user.id, parse.data);
    res.json({ data, error: null, message: null });
  } catch (err) {
    if (handleKnownError(res, err)) return;
    sendInternalError(res, err);
  }
});

// DELETE /api/strategy/objectives/:id
router.delete('/objectives/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteObjective(req.params.id, req.user.id);
    res.json({ data: null, error: null, message: 'Objective deleted.' });
  } catch (err) {
    if (handleKnownError(res, err)) return;
    sendInternalError(res, err);
  }
});

// POST /api/strategy/objectives/:id/evaluate
router.post('/objectives/:id/evaluate', async (req: Request, res: Response): Promise<void> => {
  const objective = await getObjective(req.params.id, req.user.id).catch(() => null);
  if (!objective) { res.status(404).json({ error: 'Objective not found' }); return; }
  if (!objective.current_event || objective.outcome_timing_days == null) {
    res.status(422).json({ error: 'Objective must have current_event and outcome_timing_days before evaluation.' });
    return;
  }

  try {
    const client = getClient();
    const userPrompt = buildUserPrompt({
      objectiveName: objective.name,
      description: objective.description ?? undefined,
      currentEvent: objective.current_event,
      outcomeTimingDays: objective.outcome_timing_days,
      platforms: objective.platforms,
    });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    const evalResult = enforceProxyRule(parseEvalResponse(rawText), objective.outcome_timing_days);

    const updated = await setObjectiveEvaluation(req.params.id, req.user.id, {
      verdict: evalResult.verdict,
      outcome_category: evalResult.outcomeCategory,
      recommended_primary_event: evalResult.recommendedPrimaryEvent,
      recommended_proxy_event: evalResult.recommendedProxyEvent,
      proxy_event_required: evalResult.proxyEventRequired,
      rationale: evalResult.verdictRationale,
      summary_markdown: evalResult.summaryMarkdown,
    });

    res.json({ data: { objective: updated, platformRationale: evalResult.platformRationale }, error: null, message: null });
  } catch (err) {
    logger.error({ err, objectiveId: req.params.id }, 'Objective evaluation failed');
    sendInternalError(res, err, 'strategy/objectives/evaluate');
  }
});

// POST /api/strategy/objectives/:id/lock
router.post('/objectives/:id/lock', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await lockObjective(req.params.id, req.user.id);
    res.json({ data, error: null, message: 'Objective locked.' });
  } catch (err) {
    if (handleKnownError(res, err)) return;
    sendInternalError(res, err);
  }
});

const addCampaignSchema = z.object({
  platform: z.string().min(1).max(60),
  campaign_name: z.string().max(200).optional(),
  budget: z.number().positive().optional(),
});

// POST /api/strategy/objectives/:id/campaigns
router.post('/objectives/:id/campaigns', async (req: Request, res: Response): Promise<void> => {
  const parse = addCampaignSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }
  try {
    const data = await addCampaign(req.params.id, req.user.id, parse.data);
    res.status(201).json({ data, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err);
  }
});

export { router as strategyRouter };
