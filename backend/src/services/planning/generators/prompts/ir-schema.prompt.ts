/**
 * IR Schema Prompt Constants — Sprint 2.5-C
 *
 * Exports the output schema section and guardrails that are injected into the
 * AI analysis prompt. The LLM is asked to output a trigger object (trigger_type
 * + selector / click_text) and a parameters array that maps to IRParameter[]
 * rather than the legacy parameters_to_capture[] format.
 */

// ── Action type vocabulary ────────────────────────────────────────────────────
// Shared with the generator downstream — never include generate_lead here; that
// is a standard_event_alias produced by the renderer, not an action_type.

export const UNIVERSAL_ACTION_TYPES = [
  'page_view',
  'cta_click',
  'form_submit',
  'content_engagement',
  'content_navigation',
  'ui_interaction',
] as const;

export const ECOMMERCE_ACTION_TYPES = [
  'view_item',
  'view_item_list',
  'add_to_cart',
  'purchase',
  'begin_checkout',
] as const;

// ── Guardrails text injected into every prompt ────────────────────────────────

export const IR_PROMPT_GUARDRAILS = `
CRITICAL GUARDRAILS — these rules prevent data quality failures in the generated GTM container:

1. NEVER include ":contains()" in any selector string. If you need to fire a tag when a user clicks an element by its visible text, use trigger_type: "click_text" and put the exact visible text in the click_text field.
2. Do NOT use ecommerce action_types (view_item, view_item_list, add_to_cart, purchase, begin_checkout) for lead_gen or SaaS businesses. Use form_submit or cta_click instead.
3. Do NOT add attribution parameters (gclid, fbclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign) to the parameters array. These are captured automatically by the GTM container.
4. Mark required: false for all parameters that vary at runtime (value, currency, transaction_id, form_id, etc.). Only set required: true for parameters whose absence would make the event completely meaningless.
5. For form submission events use trigger_type: "form_submit" with the form's CSS selector — never "click_css" on a submit button.
6. For page-level events (page_view) use element_reference: "page_level" and trigger_type: "page_load".
`.trim();

// ── Output schema section ─────────────────────────────────────────────────────

/**
 * Returns the "Required Output Schema" section of the prompt, tailored to the
 * business type so only valid action_types are listed.
 */
export function buildIROutputSchemaSection(businessType: string): string {
  const isEcommerce = businessType === 'ecommerce' || businessType === 'marketplace';

  const actionTypeList = isEcommerce
    ? [...UNIVERSAL_ACTION_TYPES, ...ECOMMERCE_ACTION_TYPES].join(' | ')
    : UNIVERSAL_ACTION_TYPES.join(' | ');

  const parameterValueSourceValues =
    'element_text | element_attribute | page_url | parent_context | developer_provided | runtime_computed';

  return `## Required Output Schema

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
    "has_existing_tracking": true,
    "quality": "none | minimal | partial | comprehensive",
    "summary": "What tracking exists and what gaps remain",
    "conflicts": ["List any potential issues with existing setup"]
  },
  "recommended_elements": [
    {
      "element_reference": "element_id from the list above, or 'page_level' for page-level events",
      "action_type": "${actionTypeList}",
      "is_conversion": false,
      "suggested_event_name": "snake_case GA4 event name",
      "business_justification": "Plain English: why tracking this element matters for the business",
      "priority": "must_have | should_have | nice_to_have",
      "confidence": 0.0,
      "trigger": {
        "trigger_type": "page_load | click_css | click_text | click_url | form_submit | scroll_depth | custom_event",
        "selector": "Valid CSS3 selector — required for click_css and form_submit; omit for other types",
        "click_text": "Exact visible text the user clicks — required for click_text; omit for other types",
        "click_url_pattern": "URL substring to match — required for click_url; omit for other types"
      },
      "parameters": [
        {
          "key": "param_key",
          "label": "Human-readable label",
          "type": "string | number | boolean | array | object",
          "required": false,
          "value_source": {
            "strategy": "${parameterValueSourceValues}"
          },
          "example": "example value — must be contextually appropriate for this business type"
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
- screenshot_annotation coordinates in pixels, relative to 1280×800 viewport; use bounding_box values from the element list
- For page-level events: element_reference: "page_level", trigger.trigger_type: "page_load", screenshot_annotation x:0 y:0 width:1280 height:800
- NEVER return an empty recommended_elements array`;
}
