import { Router } from 'express';
import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { env } from '@/config/env';
import logger from '@/utils/logger';

const router = Router();
router.use(authMiddleware);

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

interface EvaluateRequestBody {
  businessType: string;
  outcomeDescription: string;
  outcomeTimingDays: number;
  currentEventName: string;
  eventSource: string;
  valueDataPresent: boolean;
}

// POST /api/strategy/evaluate
// Proxies the conversion strategy evaluation to Claude. Keeps ANTHROPIC_API_KEY server-side.
router.post('/evaluate', async (req: Request, res: Response): Promise<void> => {
  const {
    businessType,
    outcomeDescription,
    outcomeTimingDays,
    currentEventName,
    eventSource,
    valueDataPresent,
  } = req.body as EvaluateRequestBody;

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

    // Hard-enforce proxy event flag based on timing. Claude is instructed to set
    // this correctly, but we guarantee it server-side so the frontend never
    // renders an incorrect false when outcome_timing_days > 1.
    if (outcomeTimingDays > 1) {
      brief.proxyEventRequired = true;
    }

    res.json({ data: brief });
  } catch (err) {
    logger.error({ err }, 'Strategy evaluation failed');
    sendInternalError(res, err, 'strategy/evaluate');
  }
});

export { router as strategyRouter };
