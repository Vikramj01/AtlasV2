/**
 * Claude API wrapper — centralises all Anthropic SDK calls and automatically
 * logs token usage after every successful response.
 *
 * All anthropic.messages.create() calls across the codebase should go through
 * callClaude() so that cost attribution is captured in usage_events.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config/env';
import { logUsage, type UsageEventType } from './usageLogger';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export interface ClaudeCallOptions {
  org_id: string;
  event_type: UsageEventType;
  system: string;
  messages: Anthropic.MessageParam[];
  model?: string;
  max_tokens?: number;
  job_id?: string;
}

export async function callClaude(options: ClaudeCallOptions): Promise<Anthropic.Message> {
  const model = options.model ?? 'claude-sonnet-4-6';

  const response = await getClient().messages.create({
    model,
    max_tokens: options.max_tokens ?? 4096,
    system:     options.system,
    messages:   options.messages,
  });

  // Non-blocking — logging failure must never fail the primary operation
  void logUsage({
    org_id:        options.org_id,
    event_type:    options.event_type,
    input_tokens:  response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model:         response.model,
    job_id:        options.job_id,
  });

  return response;
}
