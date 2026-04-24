import { z } from 'zod';

export const EvalResponseSchema = z.object({
  outcomeCategory: z.enum([
    'purchase',
    'qualified_lead',
    'activation_milestone',
    'retention_event',
    'donation',
  ]),
  verdict: z.enum(['CONFIRM', 'AUGMENT', 'REPLACE']),
  verdictRationale: z.string(),
  recommendedPrimaryEvent: z.string().nullable(),
  recommendedPrimaryRationale: z.string().nullable(),
  proxyEventRequired: z.boolean(),
  recommendedProxyEvent: z.string().nullable(),
  proxyEventRationale: z.string().nullable(),
  platformRationale: z.record(z.string()).nullable(),
  summaryMarkdown: z.string(),
});

export type EvalResponse = z.infer<typeof EvalResponseSchema>;

export interface EvalInput {
  objectiveName: string;
  currentEvent: string;
  outcomeTimingDays: number;
  platforms: string[];
}

export const SYSTEM_PROMPT = `You are a conversion strategy analyst for digital advertising campaigns. Your job is to evaluate whether a client's current conversion event is well-matched to their stated business objective, and to recommend improvements where needed.

Always respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON object.`;

export function buildUserPrompt(input: EvalInput): string {
  const platformList = input.platforms.length > 0 ? input.platforms.join(', ') : 'unspecified';

  return `Objective: ${input.objectiveName}
Current optimisation event: ${input.currentEvent}
Typical days from ad click to outcome: ${input.outcomeTimingDays}
Ad platforms: ${platformList}

Evaluate whether the current event is well-matched to the stated objective.

Respond with this exact JSON structure:
{
  "outcomeCategory": "purchase | qualified_lead | activation_milestone | retention_event | donation",
  "verdict": "CONFIRM | AUGMENT | REPLACE",
  "verdictRationale": "Plain-language explanation in 2-3 sentences.",
  "recommendedPrimaryEvent": "Better primary event name, or null if verdict is CONFIRM",
  "recommendedPrimaryRationale": "Why this event is a better fit, or null if verdict is CONFIRM",
  "proxyEventRequired": true | false,
  "recommendedProxyEvent": "Recommended proxy event name if timing > 1 day, or null",
  "proxyEventRationale": "Why this proxy is a good upstream predictor, or null",
  "platformRationale": ${input.platforms.length > 0 ? `{ ${input.platforms.map(p => `"${p}": "Platform-specific implementation note"`).join(', ')} }` : 'null'},
  "summaryMarkdown": "A full strategy brief in markdown (3-5 short paragraphs) covering: the objective, the verdict, the recommended event, platform-specific notes, and the proxy event if applicable. Written for a marketing practitioner."
}`;
}

export function enforceProxyRule(result: EvalResponse, outcomeTimingDays: number): EvalResponse {
  if (outcomeTimingDays > 1) {
    return { ...result, proxyEventRequired: true };
  }
  return result;
}

export function parseEvalResponse(rawText: string): EvalResponse {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;
  return EvalResponseSchema.parse(parsed);
}
