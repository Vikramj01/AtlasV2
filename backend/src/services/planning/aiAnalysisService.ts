/**
 * AI Analysis Service — sends a PageCapture to Claude API and receives
 * structured tracking recommendations.
 *
 * Model: claude-haiku-4-5-20251001 (fast, cost-efficient for per-page analysis)
 * Target cost: ~$0.13 per full planning session (multiple pages).
 *
 * Retry logic: up to 3 attempts with 2s backoff on API/parse failures.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/config/env';
import { ACTION_PRIMITIVES } from '@/services/journey/actionPrimitives';
import type {
  AIAnalysisRequest,
  AIAnalysisResponse,
  RecommendedElement,
  PageClassification,
  TrackingAssessment,
  SuggestedParam,
} from '@/types/planning';
import logger from '@/utils/logger';

// ── Client singleton ─────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert conversion tracking consultant with deep knowledge of Google Analytics 4, Google Tag Manager, Meta Ads, and other ad platforms.

Your job is to analyse a web page and identify which interactive elements should be tracked with analytics events. You think like a senior analytics engineer who understands both the technical implementation AND the business impact.

You always output valid JSON matching the specified schema exactly — no prose, no markdown fences, just the raw JSON object.

Key principles:
- ALWAYS include at least one recommendation — even a page_view event if the page has no interactive elements
- Prioritise conversion events (purchases, sign-ups, lead forms, add to cart, checkout steps) over engagement events
- Every recommendation must have a clear business justification
- Use GA4-standard event names where they apply (purchase, add_to_cart, begin_checkout, generate_lead, sign_up, view_item, search)
- Confidence scores reflect how certain you are this element is worth tracking (not how certain it exists on the page)
- Be INCLUSIVE rather than exclusive — if an element could plausibly be worth tracking, recommend it
- Include page_view tracking for EVERY page — it is always valuable for funnel analysis
- If an element is already tracked by existing infrastructure, still include it but note this in the justification
- On checkout/cart/product pages always recommend the relevant ecommerce events (add_to_cart, begin_checkout, purchase, view_item)
- Do NOT return an empty recommended_elements array — the minimum is always a page_view recommendation`;

function buildUserPrompt(req: AIAnalysisRequest): string {
  const actionPrimitiveList = ACTION_PRIMITIVES.map((a) => `  - "${a.key}": ${a.description}`).join('\n');

  const domSummary = JSON.stringify(req.simplified_dom, null, 0).slice(0, 8000);
  const elementSummary = req.interactive_elements
    .slice(0, 30) // Cap at 30 elements to control token usage
    .map(
      (el) =>
        `  [${el.element_id}] <${el.tag}> "${el.text.slice(0, 60)}" (${el.element_type}${el.is_above_fold ? ', above-fold' : ''})`,
    )
    .join('\n');

  const formSummary = req.forms
    .map(
      (f) =>
        `  Form "${f.form_id}": ${f.fields.length} fields (${f.fields.map((fi) => fi.type).join(', ')}), submit: "${f.submit_button?.text ?? 'none'}"`,
    )
    .join('\n');

  const trackingStatus = req.existing_tracking.gtm_detected
    ? `GTM detected (${req.existing_tracking.gtm_container_id ?? 'no container ID found'}). ` +
      `GA4: ${req.existing_tracking.ga4_detected ? 'yes' : 'no'}. ` +
      `Meta: ${req.existing_tracking.meta_pixel_detected ? 'yes' : 'no'}. ` +
      `Existing dataLayer events: ${req.existing_tracking.datalayer_events_found.join(', ') || 'none'}.`
    : 'No tracking detected on this page.';

  const taxonomySection = req.taxonomy_context
    ? `\n## Organisation Event Taxonomy\nThis org uses a standardised event taxonomy. When naming events, prefer these taxonomy slugs over ad-hoc names.\nIf a page interaction clearly maps to a taxonomy event, use that exact slug as suggested_event_name.\n\n${req.taxonomy_context.slice(0, 3000)}\n`
    : '';

  return `Analyse this web page and recommend which elements to track.

## Page Details
- URL: ${req.page_url}
- Title: ${req.page_title}
- Business type: ${req.business_type}
- Business context: ${req.business_context || '(not provided)'}
- Ad platforms to support: ${req.platforms_selected.join(', ') || 'GA4 (default)'}
- Existing tracking: ${trackingStatus}

## Interactive Elements Found
${elementSummary || '  (none detected)'}

## Forms Found
${formSummary || '  (none detected)'}

## Simplified DOM (abbreviated)
${domSummary}
${taxonomySection}
## Available Action Primitive Keys
Use one of these for action_primitive_key (or "custom" if none fit):
${actionPrimitiveList}

## Required Output Schema
Return ONLY a JSON object with this exact structure:

{
  "page_classification": {
    "page_type": "string (e.g. checkout, product_page, homepage, lead_form, pricing, sign_up, category)",
    "funnel_position": "top | middle | bottom | post_conversion",
    "business_importance": "critical | high | medium | low",
    "reasoning": "1-2 sentences explaining why"
  },
  "page_summary": "2-3 sentence plain-English summary of what this page does and why it matters",
  "existing_tracking_assessment": {
    "has_existing_tracking": true | false,
    "quality": "none | minimal | partial | comprehensive",
    "summary": "What tracking exists and what gaps remain",
    "conflicts": ["List any potential issues with existing setup"]
  },
  "recommended_elements": [
    {
      "element_reference": "element_id from the list above, or 'page_level' for page-level events",
      "selector": "CSS selector",
      "recommendation_type": "track_click | track_form_submit | track_page_view | track_scroll | track_video | track_custom",
      "action_primitive_key": "purchase | add_to_cart | begin_checkout | generate_lead | sign_up | view_item | view_item_list | search | ad_landing | custom",
      "suggested_event_name": "ga4_event_name",
      "suggested_event_category": "ecommerce | lead_generation | engagement | navigation",
      "business_justification": "Plain English: why tracking this element matters for the business",
      "priority": "must_have | should_have | nice_to_have",
      "confidence": 0.0,
      "parameters_to_capture": [
        {
          "param_key": "value",
          "param_label": "Order Total",
          "source": "element_text | element_attribute | parent_context | page_url | developer_provided",
          "source_detail": "Where this data comes from on the page",
          "example_value": "99.99"
        }
      ],
      "screenshot_annotation": {
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 40,
        "label": "Short label for annotation"
      }
    }
  ]
}

Rules:
- ALWAYS include at least 1 recommendation — a page_view event at minimum
- Include 1–8 recommendations total
- confidence between 0.0 and 1.0
- screenshot_annotation coordinates must be in pixels, relative to the 1280×800 viewport; use the bounding_box values from the element list above
- For page-level events (page_view), use element_reference: "page_level" and selector: "document", screenshot_annotation x:0 y:0 width:1280 height:800
- NEVER return an empty recommended_elements array — if the page has no specific interactive elements, add a page_view recommendation`;
}

// ── Main analysis function ───────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export async function analysePageWithAI(
  req: AIAnalysisRequest,
): Promise<AIAnalysisResponse> {
  const client = getClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const userContent: Anthropic.ContentBlockParam[] = [];
      if (req.screenshot_base64) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: req.screenshot_base64,
          },
        });
      }
      userContent.push({ type: 'text', text: buildUserPrompt(req) });

      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: userContent },
      ];

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
      });

      // Log token usage for cost monitoring
      logger.info(
        {
          url: req.page_url,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          attempt,
        },
        'AI analysis complete',
      );

      const rawText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');

      const result = parseAndValidateResponse(rawText, req);

      // Safety net: if AI returned 0 recommendations despite our instructions,
      // inject a page_view event so the user always sees something actionable.
      if (result.recommended_elements.length === 0) {
        logger.warn(
          { url: req.page_url, rawPreview: rawText.slice(0, 300) },
          'AI returned 0 recommendations — injecting fallback page_view',
        );
        result.recommended_elements = [buildFallbackPageView(req)];
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ url: req.page_url, attempt, err: lastError.message }, 'AI analysis attempt failed');

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  throw new Error(`AI analysis failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

// ── Fallback recommendation ──────────────────────────────────────────────────

function buildFallbackPageView(req: AIAnalysisRequest): RecommendedElement {
  return {
    element_reference: 'page_level',
    selector: 'document',
    recommendation_type: 'track_page_view',
    action_primitive_key: 'view_item',
    suggested_event_name: 'page_view',
    suggested_event_category: 'engagement',
    business_justification: `Track page views on ${req.page_title || req.page_url} to measure traffic and support funnel analysis.`,
    priority: 'must_have',
    parameters_to_capture: [
      {
        param_key: 'page_title',
        param_label: 'Page Title',
        source: 'page_url',
        source_detail: 'document.title',
        example_value: req.page_title || req.page_url,
      },
      {
        param_key: 'page_location',
        param_label: 'Page URL',
        source: 'page_url',
        source_detail: 'window.location.href',
        example_value: req.page_url,
      },
    ],
    confidence: 1.0,
    screenshot_annotation: { x: 0, y: 0, width: 1280, height: 800, label: 'Page View' },
  };
}

// ── Response parsing ─────────────────────────────────────────────────────────

function parseAndValidateResponse(rawText: string, req: AIAnalysisRequest): AIAnalysisResponse {
  // Strip markdown fences if Claude wrapped the JSON
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from the response if there's surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not parse JSON from AI response. Raw: ${rawText.slice(0, 200)}`);
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('AI response is not a JSON object');
  }

  const raw = parsed as Record<string, unknown>;

  // Validate and coerce the response into our typed shape
  const page_classification = validatePageClassification(raw['page_classification']);
  const recommended_elements = validateRecommendedElements(raw['recommended_elements']);
  const existing_tracking_assessment = validateTrackingAssessment(raw['existing_tracking_assessment']);
  const page_summary = typeof raw['page_summary'] === 'string' ? raw['page_summary'] : '';

  // Enrich recommendations with platform info from ACTION_PRIMITIVES
  const enriched = recommended_elements.map((rec) => enrichRecommendation(rec, req.platforms_selected));

  return {
    page_classification,
    recommended_elements: enriched,
    existing_tracking_assessment,
    page_summary,
  };
}

function validatePageClassification(raw: unknown): PageClassification {
  if (typeof raw !== 'object' || raw === null) {
    return { page_type: 'unknown', funnel_position: 'middle', business_importance: 'medium', reasoning: '' };
  }
  const r = raw as Record<string, unknown>;
  return {
    page_type: String(r['page_type'] ?? 'unknown'),
    funnel_position: (['top', 'middle', 'bottom', 'post_conversion'] as const).includes(r['funnel_position'] as 'top')
      ? (r['funnel_position'] as PageClassification['funnel_position'])
      : 'middle',
    business_importance: (['critical', 'high', 'medium', 'low'] as const).includes(r['business_importance'] as 'low')
      ? (r['business_importance'] as PageClassification['business_importance'])
      : 'medium',
    reasoning: String(r['reasoning'] ?? ''),
  };
}

function validateRecommendedElements(raw: unknown): RecommendedElement[] {
  if (!Array.isArray(raw)) return [];

  const validTypes = ['track_click', 'track_form_submit', 'track_page_view', 'track_scroll', 'track_video', 'track_custom'] as const;
  const validPriorities = ['must_have', 'should_have', 'nice_to_have'] as const;
  const validActionKeys = new Set(ACTION_PRIMITIVES.map((a) => a.key).concat(['custom']));

  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .slice(0, 8) // Cap at 8 recommendations
    .map((item): RecommendedElement => {
      const recType = validTypes.includes(item['recommendation_type'] as 'track_click')
        ? (item['recommendation_type'] as RecommendedElement['recommendation_type'])
        : 'track_click';

      const actionKey = validActionKeys.has(String(item['action_primitive_key'] ?? ''))
        ? String(item['action_primitive_key'])
        : 'custom';

      const priority = validPriorities.includes(item['priority'] as 'must_have')
        ? (item['priority'] as RecommendedElement['priority'])
        : 'should_have';

      const confidence = typeof item['confidence'] === 'number'
        ? Math.max(0, Math.min(1, item['confidence']))
        : 0.5;

      const annotation = validateAnnotation(item['screenshot_annotation']);
      const params = validateParams(item['parameters_to_capture']);

      return {
        element_reference: String(item['element_reference'] ?? 'page_level'),
        selector: String(item['selector'] ?? 'document'),
        recommendation_type: recType,
        action_primitive_key: actionKey,
        suggested_event_name: String(item['suggested_event_name'] ?? actionKey),
        suggested_event_category: String(item['suggested_event_category'] ?? 'engagement'),
        business_justification: String(item['business_justification'] ?? ''),
        priority,
        parameters_to_capture: params,
        confidence,
        screenshot_annotation: annotation,
      };
    });
}

function validateAnnotation(raw: unknown): RecommendedElement['screenshot_annotation'] {
  if (typeof raw !== 'object' || raw === null) {
    return { x: 0, y: 0, width: 100, height: 40, label: 'Element' };
  }
  const r = raw as Record<string, unknown>;
  return {
    x: Math.max(0, Number(r['x'] ?? 0)),
    y: Math.max(0, Number(r['y'] ?? 0)),
    width: Math.max(10, Number(r['width'] ?? 100)),
    height: Math.max(10, Number(r['height'] ?? 40)),
    label: String(r['label'] ?? 'Element').slice(0, 40),
  };
}

function validateParams(raw: unknown): SuggestedParam[] {
  if (!Array.isArray(raw)) return [];
  const validSources = ['element_text', 'element_attribute', 'parent_context', 'page_url', 'developer_provided'] as const;

  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .slice(0, 10)
    .map((item): SuggestedParam => ({
      param_key: String(item['param_key'] ?? ''),
      param_label: String(item['param_label'] ?? ''),
      source: validSources.includes(item['source'] as 'element_text')
        ? (item['source'] as SuggestedParam['source'])
        : 'developer_provided',
      source_detail: String(item['source_detail'] ?? ''),
      example_value: String(item['example_value'] ?? ''),
    }));
}

function validateTrackingAssessment(raw: unknown): TrackingAssessment {
  if (typeof raw !== 'object' || raw === null) {
    return { has_existing_tracking: false, quality: 'none', summary: '', conflicts: [] };
  }
  const r = raw as Record<string, unknown>;
  const validQualities = ['none', 'minimal', 'partial', 'comprehensive'] as const;
  return {
    has_existing_tracking: Boolean(r['has_existing_tracking']),
    quality: validQualities.includes(r['quality'] as 'none')
      ? (r['quality'] as TrackingAssessment['quality'])
      : 'none',
    summary: String(r['summary'] ?? ''),
    conflicts: Array.isArray(r['conflicts']) ? r['conflicts'].map(String) : [],
  };
}

/**
 * Enrich a recommendation with the standard parameters from the matching
 * ACTION_PRIMITIVE, merging AI-suggested params with known required/optional params.
 */
function enrichRecommendation(
  rec: RecommendedElement,
  platforms: string[],
): RecommendedElement {
  const primitive = ACTION_PRIMITIVES.find((a) => a.key === rec.action_primitive_key);
  if (!primitive) return rec;

  // Merge: start with AI-suggested params, then add required params the AI missed
  const existingKeys = new Set(rec.parameters_to_capture.map((p) => p.param_key));

  const missingRequired: SuggestedParam[] = primitive.required_params
    .filter((p) => !existingKeys.has(p.key))
    .map((p) => ({
      param_key: p.key,
      param_label: p.label,
      source: 'developer_provided' as const,
      source_detail: p.description,
      example_value: p.example,
    }));

  return {
    ...rec,
    parameters_to_capture: [...rec.parameters_to_capture, ...missingRequired],
  };
}
