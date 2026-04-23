import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ObjectivePlatform, ObjectiveVerdictData } from '@/services/database/strategyObjectivesQueries';

// ── Zod schema for Claude's structured response ────────────────────────────────

export const claudeVerdictSchema = z.object({
  verdict: z.enum(['keep', 'add_proxy', 'switch']),
  recommended_primary_event: z.string().min(1),
  recommended_proxy_event: z.string().nullable(),
  rationale: z.string().min(1),
  warnings: z.array(z.string()),
});

// ── Input shape for an objective evaluation ────────────────────────────────────

export interface EvaluationInput {
  businessType: string;
  businessOutcome: string;
  outcomeTimingDays: number;
  currentEvent: string | null;
  platforms: ObjectivePlatform[];
  objectiveName: string;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a conversion strategy analyst for digital advertising. Your job is to evaluate whether a client's current conversion event matches their stated business outcome, then recommend the right event strategy.

## The three verdict types

**keep** — The current event fires close enough to the real business outcome that ad platforms can optimise on it directly. No change needed.

**add_proxy** — The current event fires too far from the real outcome (timing gap is too wide for ad platforms to learn from). The client should keep tracking the current event but add a proxy event that fires sooner AND reliably predicts the downstream outcome. Proxy events give platforms a fast feedback loop while keeping the real outcome visible.

**switch** — The current event is poorly correlated with the real outcome and should be replaced entirely. This happens when the event captures the wrong behaviour or the wrong audience segment.

## When to require a proxy event

Always recommend add_proxy (or at minimum note the proxy in your rationale) when outcome_timing_days > 1 AND the current event fires earlier than the outcome. The ad platform attribution window is typically 1–7 days. A 60-day outcome gap means zero useful optimisation signal.

## Platform-specific constraints to mention when relevant

- **Meta**: Each ad set optimises toward one primary conversion event. Changing the primary event resets learning phase.
- **Google Ads**: Allows one primary + multiple secondary conversion actions. Smart Bidding uses only primary events.
- **LinkedIn**: Conversion tracking is less granular. Proxy events may not work as effectively — recommend offline conversion import for B2B.
- **TikTok**: 7-day click attribution window. For outcomes > 7 days, a proxy is mandatory.

## Output format

Respond with valid JSON only. No markdown, no preamble, no text outside the JSON object.

{
  "verdict": "keep | add_proxy | switch",
  "recommended_primary_event": "The event the client should optimise their ads toward (can be the same as current for keep or add_proxy verdicts)",
  "recommended_proxy_event": "A proxy event name if verdict is add_proxy, otherwise null",
  "rationale": "Plain-English explanation in 2–4 sentences. Explain why, not what. Mention the outcome timing gap if relevant. Do not use engineer jargon.",
  "warnings": ["Short warning strings, one per concern. Example: 'Changing your primary event in Meta will reset the learning phase.' Maximum 4 warnings."]
}

Never return engineer jargon in any user-visible field. Write as you would to a marketing practitioner.`;

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildUserPrompt(input: EvaluationInput): string {
  const platformList = input.platforms.length > 0 ? input.platforms.join(', ') : 'not specified';
  const currentEventLine = input.currentEvent
    ? `Current conversion event: ${input.currentEvent}`
    : 'Current conversion event: None — client is not tracking any event yet';

  return `Objective name: ${input.objectiveName}
Business type: ${input.businessType}
Business outcome (what a genuinely successful customer looks like): ${input.businessOutcome}
Days from ad click to this outcome typically occurring: ${input.outcomeTimingDays}
${currentEventLine}
Ad platforms in use: ${platformList}

Evaluate whether the current event (if any) is well-matched to this business outcome. Recommend the right conversion event strategy for this objective.`;
}

// ── Claude caller ──────────────────────────────────────────────────────────────

export async function evaluateObjectiveWithClaude(
  client: Anthropic,
  input: EvaluationInput,
): Promise<ObjectiveVerdictData> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  });

  const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as unknown;

  const result = claudeVerdictSchema.parse(parsed);

  // Hard-enforce proxy requirement when outcome timing is long
  if (input.outcomeTimingDays > 1 && result.verdict === 'keep' && !result.recommended_proxy_event) {
    result.recommended_proxy_event = null;
    if (!result.warnings.some((w) => w.toLowerCase().includes('proxy'))) {
      result.warnings.push(
        `Consider a proxy event — your outcome takes ${input.outcomeTimingDays} days, which is too long for ad platforms to optimise on directly.`,
      );
    }
  }

  return {
    verdict: result.verdict,
    recommended_primary_event: result.recommended_primary_event,
    recommended_proxy_event: result.recommended_proxy_event,
    rationale: result.rationale,
    warnings: result.warnings,
  };
}
