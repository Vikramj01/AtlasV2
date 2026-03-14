/**
 * Change Detection Service
 *
 * Re-scans pages from a completed Planning Mode session and compares
 * the current page state against the previously approved recommendations.
 *
 * Used by the re-scan flow:
 *   POST /api/planning/sessions/:id/rescan → enqueues job on planningQueue
 *   Worker calls runRescanOrchestrator → which calls detectPageChanges per page
 *
 * The result is stored as JSONB in planning_sessions.rescan_results.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config/env';
import type { PlanningPage, PlanningRecommendation } from '@/types/planning';
import type { PageCapture } from '@/types/planning';
import logger from '@/utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RemovedElement {
  recommendation_id: string;
  original_event_name: string;
  reason: string;
}

export interface ModifiedElement {
  recommendation_id: string;
  original_event_name: string;
  change_description: string;
}

export interface NewElement {
  event_name: string;
  element_text: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  business_justification: string;
  selector: string;
}

export type ChangeType = 'unchanged' | 'modified' | 'new_elements' | 'removed_elements' | 'page_not_found';

export interface PageChangeResult {
  page_id: string;
  page_url: string;
  page_label: string;
  change_type: ChangeType;
  new_elements: NewElement[];
  removed_elements: RemovedElement[];
  modified_elements: ModifiedElement[];
  scanned_at: string;
}

export interface ChangeSummary {
  pages_unchanged: number;
  pages_modified: number;
  new_elements_found: number;
  elements_removed: number;
  action_required: boolean;
}

export interface ChangeDetectionResult {
  session_id: string;
  status: 'scanning' | 'complete' | 'failed';
  started_at: string;
  completed_at: string | null;
  error: string | null;
  pages: PageChangeResult[];
  summary: ChangeSummary;
}

// ── AI change detection ───────────────────────────────────────────────────────

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

const CHANGE_DETECTION_SYSTEM = `You are an expert conversion tracking consultant reviewing a web page that has changed since the last analysis.

Your job is to compare the CURRENT page state against PREVIOUSLY APPROVED tracking recommendations, and identify:
1. Which previously recommended elements no longer exist on the page (removed)
2. Which elements have changed (different text, different position, different CTA wording)
3. New trackable elements that weren't in the previous scan

You always output valid JSON matching the specified schema exactly — no prose, no markdown fences.`;

interface ChangeAnalysisInput {
  page_url: string;
  page_title: string;
  simplified_dom_summary: string;
  interactive_elements_summary: string;
  previous_recommendations: Array<{
    id: string;
    event_name: string;
    element_selector: string | null;
    element_text: string | null;
    action_type: string;
  }>;
  screenshot_base64?: string;
}

interface ChangeAnalysisOutput {
  removed_elements: Array<{
    recommendation_id: string;
    original_event_name: string;
    reason: string;
  }>;
  modified_elements: Array<{
    recommendation_id: string;
    original_event_name: string;
    change_description: string;
  }>;
  new_elements: NewElement[];
}

/**
 * Send a page capture + previous recommendations to Claude API and
 * get back a structured change analysis.
 */
export async function detectPageChanges(
  input: ChangeAnalysisInput,
): Promise<ChangeAnalysisOutput> {
  const client = getClient();

  const prevRecsText = input.previous_recommendations
    .map(
      (r, i) =>
        `  ${i + 1}. ID: ${r.id} | Event: "${r.event_name}" | Selector: ${r.element_selector ?? 'n/a'} | Text: "${r.element_text ?? 'n/a'}"`,
    )
    .join('\n');

  const userPrompt = `Re-scan this web page and compare against previously approved tracking recommendations.

## Page Details
- URL: ${input.page_url}
- Title: ${input.page_title}

## Interactive Elements Currently Found
${input.interactive_elements_summary || '  (none detected)'}

## Simplified DOM (abbreviated)
${input.simplified_dom_summary}

## Previously Approved Recommendations (from last scan)
${prevRecsText || '  (none)'}

## Required Output Schema
Return ONLY a JSON object with this exact structure:

{
  "removed_elements": [
    {
      "recommendation_id": "UUID from the list above",
      "original_event_name": "e.g. add_to_cart",
      "reason": "Plain English: why this element no longer exists or is inaccessible"
    }
  ],
  "modified_elements": [
    {
      "recommendation_id": "UUID from the list above",
      "original_event_name": "e.g. add_to_cart",
      "change_description": "Plain English: what changed (text, position, behaviour)"
    }
  ],
  "new_elements": [
    {
      "event_name": "ga4_event_name",
      "element_text": "Button or element text as it appears on page",
      "priority": "must_have | should_have | nice_to_have",
      "business_justification": "Why this should be tracked",
      "selector": "CSS selector"
    }
  ]
}

Rules:
- Only include elements in removed_elements if you are confident the element is gone (not just hidden or off-screen)
- Only include new_elements if they have genuine business tracking value
- Return empty arrays for categories with no changes
- Limit new_elements to the top 3 most important`;

  const userContent: Anthropic.ContentBlockParam[] = [];
  if (input.screenshot_base64) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: input.screenshot_base64 },
    });
  }
  userContent.push({ type: 'text', text: userPrompt });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: CHANGE_DETECTION_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  });

  logger.info(
    {
      url: input.page_url,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    'Change detection AI complete',
  );

  const rawText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');

  return parseChangeOutput(rawText);
}

function parseChangeOutput(rawText: string): ChangeAnalysisOutput {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ rawText: rawText.slice(0, 200) }, 'Failed to parse change detection JSON');
      return { removed_elements: [], modified_elements: [], new_elements: [] };
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { removed_elements: [], modified_elements: [], new_elements: [] };
  }

  const raw = parsed as Record<string, unknown>;
  const validPriorities = new Set(['must_have', 'should_have', 'nice_to_have']);

  return {
    removed_elements: Array.isArray(raw['removed_elements'])
      ? raw['removed_elements']
          .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
          .map((r) => ({
            recommendation_id: String(r['recommendation_id'] ?? ''),
            original_event_name: String(r['original_event_name'] ?? ''),
            reason: String(r['reason'] ?? ''),
          }))
          .filter((r) => r.recommendation_id)
      : [],
    modified_elements: Array.isArray(raw['modified_elements'])
      ? raw['modified_elements']
          .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
          .map((r) => ({
            recommendation_id: String(r['recommendation_id'] ?? ''),
            original_event_name: String(r['original_event_name'] ?? ''),
            change_description: String(r['change_description'] ?? ''),
          }))
          .filter((r) => r.recommendation_id)
      : [],
    new_elements: Array.isArray(raw['new_elements'])
      ? raw['new_elements']
          .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
          .slice(0, 3)
          .map((r): NewElement => {
            const p = String(r['priority'] ?? '');
            const priority: NewElement['priority'] = validPriorities.has(p)
              ? (p as NewElement['priority'])
              : 'should_have';
            return {
              event_name: String(r['event_name'] ?? 'custom_event'),
              element_text: String(r['element_text'] ?? ''),
              priority,
              business_justification: String(r['business_justification'] ?? ''),
              selector: String(r['selector'] ?? ''),
            };
          })
      : [],
  };
}

// ── Summary computation ───────────────────────────────────────────────────────

export function computeChangeSummary(pages: PageChangeResult[]): ChangeSummary {
  return {
    pages_unchanged: pages.filter((p) => p.change_type === 'unchanged').length,
    pages_modified: pages.filter((p) => p.change_type !== 'unchanged' && p.change_type !== 'page_not_found').length,
    new_elements_found: pages.reduce((sum, p) => sum + p.new_elements.length, 0),
    elements_removed: pages.reduce((sum, p) => sum + p.removed_elements.length, 0),
    action_required:
      pages.some((p) => p.new_elements.some((e) => e.priority === 'must_have')) ||
      pages.some((p) => p.removed_elements.length > 0),
  };
}

/**
 * Build a PageChangeResult from a page capture + AI output + existing approvals.
 */
export function buildPageChangeResult(
  page: PlanningPage,
  approvedRecs: PlanningRecommendation[],
  aiOutput: ChangeAnalysisOutput,
): PageChangeResult {
  const scanned_at = new Date().toISOString();

  const hasChanges =
    aiOutput.removed_elements.length > 0 ||
    aiOutput.modified_elements.length > 0 ||
    aiOutput.new_elements.length > 0;

  let change_type: ChangeType;
  if (aiOutput.new_elements.length > 0 && aiOutput.removed_elements.length === 0 && aiOutput.modified_elements.length === 0) {
    change_type = 'new_elements';
  } else if (aiOutput.removed_elements.length > 0 && aiOutput.new_elements.length === 0) {
    change_type = 'removed_elements';
  } else if (hasChanges) {
    change_type = 'modified';
  } else {
    change_type = 'unchanged';
  }

  // Map rec IDs to full recommendation objects for context
  const recMap = new Map(approvedRecs.map((r) => [r.id, r]));

  return {
    page_id: page.id,
    page_url: page.url,
    page_label: page.page_title ?? page.url,
    change_type,
    new_elements: aiOutput.new_elements,
    removed_elements: aiOutput.removed_elements.filter((r) => recMap.has(r.recommendation_id)),
    modified_elements: aiOutput.modified_elements.filter((r) => recMap.has(r.recommendation_id)),
    scanned_at,
  };
}
