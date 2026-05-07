/**
 * Spec Renderer — produces dataLayer code snippets from IR events.
 *
 * Rules:
 *   - Parameters come from IREvent.parameters only — never from element_selector
 *   - All values are {{PARAM_KEY}} placeholders (never hardcoded / selector-as-value)
 *   - Ecommerce events use nested ecommerce: object only on ecommerce action types
 *   - Attribution params (gclid, fbclid, etc.) read from URL, never hardcoded
 *   - Trigger comment derived from IRTrigger — never outputs :contains()
 */

import type { IREvent, IRParameter, IRTrigger } from '../ir.types';
import { ECOMMERCE_SNIPPET_ACTIONS, ATTRIBUTION_PARAMS } from '../ir.types';
import { renderTriggerComment } from './trigger.renderer';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a parameter to a valid JS literal.
 * Always produces {{PARAM_KEY}} placeholders for string values — never uses
 * element_selector or other DOM values directly.
 */
function toPlaceholder(param: IRParameter): string {
  switch (param.type) {
    case 'number':
      return `{{${param.key.toUpperCase()}}}`;    // number — no quotes
    case 'boolean':
      return `{{${param.key.toUpperCase()}}}`;    // boolean — no quotes
    case 'array':
      return `[/* {{${param.key.toUpperCase()}}} */]`;
    case 'object':
      return `{/* {{${param.key.toUpperCase()}}} */}`;
    default:
      return `'{{${param.key.toUpperCase()}}}'`;  // string — single-quoted
  }
}

/** True if the param is an attribution click ID — must be read from URL, not hardcoded. */
function isAttribution(param: IRParameter): boolean {
  return ATTRIBUTION_PARAMS.has(param.key);
}

// ── Code snippet builders ─────────────────────────────────────────────────────

function renderEcommerceSnippet(event: IREvent): string {
  const lines: string[] = [];
  const a = event.action_type;

  lines.push('window.dataLayer = window.dataLayer || [];');
  lines.push('window.dataLayer.push({');
  lines.push(`  event: '${event.event_name}',`);

  if (a === 'purchase') {
    lines.push('  ecommerce: {');
    lines.push(`    transaction_id: '{{ORDER_ID}}',         // REQUIRED: unique order ID`);
    lines.push(`    value: {{ORDER_TOTAL}},                  // REQUIRED: total value (number)`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',           // REQUIRED: ISO 4217, e.g. 'USD'`);
    lines.push(`    tax: {{TAX_AMOUNT}},                     // Optional`);
    lines.push(`    shipping: {{SHIPPING_COST}},             // Optional`);
    lines.push(`    coupon: '{{COUPON_CODE}}',               // Optional`);
    lines.push(`    items: [`);
    lines.push(`      {`);
    lines.push(`        item_id: '{{PRODUCT_SKU}}',`);
    lines.push(`        item_name: '{{PRODUCT_NAME}}',`);
    lines.push(`        price: {{UNIT_PRICE}},`);
    lines.push(`        quantity: {{QUANTITY}}`);
    lines.push(`      }`);
    lines.push(`    ]`);
    lines.push(`  },`);
    lines.push(`  user_data: {`);
    lines.push(`    email: '{{CUSTOMER_EMAIL_RAW}}',         // Optional but recommended`);
    lines.push(`    phone_number: '{{CUSTOMER_PHONE_RAW}}'   // Optional`);
    lines.push(`  }`);
  } else if (a === 'add_to_cart') {
    lines.push('  ecommerce: {');
    lines.push(`    value: {{ITEM_PRICE}},                   // REQUIRED`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',           // REQUIRED`);
    lines.push(`    items: [{ item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}}, quantity: 1 }]`);
    lines.push('  }');
  } else if (a === 'begin_checkout') {
    lines.push('  ecommerce: {');
    lines.push(`    value: {{CART_TOTAL}},                   // REQUIRED`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',           // REQUIRED`);
    lines.push(`    items: [/* ...products in cart... */]`);
    lines.push('  }');
  } else if (a === 'view_item') {
    lines.push('  ecommerce: {');
    lines.push(`    value: {{PRODUCT_PRICE}},`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',`);
    lines.push(`    items: [{ item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}} }]`);
    lines.push('  }');
  } else if (a === 'view_item_list') {
    lines.push('  ecommerce: {');
    lines.push(`    item_list_id: '{{LIST_ID}}',             // REQUIRED: e.g. 'related_products'`);
    lines.push(`    item_list_name: '{{LIST_NAME}}',         // REQUIRED: e.g. 'Related Products'`);
    lines.push(`    items: [`);
    lines.push(`      { item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}}, index: 0 }`);
    lines.push(`    ]`);
    lines.push('  }');
  }

  lines.push('});');
  return lines.join('\n');
}

function renderGenericSnippet(event: IREvent): string {
  const lines: string[] = [];
  const required = event.parameters.filter(p => p.required && !isAttribution(p));
  const attribution = event.parameters.filter(p => isAttribution(p));
  const optional = event.parameters.filter(p => !p.required && !isAttribution(p));

  lines.push('window.dataLayer = window.dataLayer || [];');
  lines.push('window.dataLayer.push({');
  lines.push(`  event: '${event.event_name}',`);

  for (const p of required) {
    const comment = `  // ${p.label}`;
    lines.push(`  ${p.key}: ${toPlaceholder(p)},${comment}`);
  }

  if (attribution.length > 0) {
    lines.push(`  // Attribution — read from URL, never hardcode:`);
    for (const p of attribution) {
      lines.push(`  ${p.key}: new URLSearchParams(location.search).get('${p.key}'),`);
    }
  }

  if (optional.length > 0) {
    lines.push(`  // Optional:`);
    for (const p of optional) {
      lines.push(`  // ${p.key}: ${toPlaceholder(p)},  // ${p.label}`);
    }
  }

  if (required.length === 0 && attribution.length === 0) {
    lines.push(`  // No parameters declared — add application-specific fields here`);
  }

  lines.push('});');
  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render a dataLayer.push() code snippet from an IR event.
 *
 * - Ecommerce events (purchase, add_to_cart, etc.) use nested ecommerce: object
 * - All other events use flat key-value pairs from IREvent.parameters only
 * - Values are always {{PARAM_KEY}} placeholders — never selector-as-value
 * - Trigger comment derived from IRTrigger, never outputs :contains()
 */
export function renderCodeSnippet(event: IREvent): string {
  const triggerComment = renderTriggerComment(event.trigger);
  const header = `// ${triggerComment}`;

  const body = ECOMMERCE_SNIPPET_ACTIONS.has(event.action_type)
    ? renderEcommerceSnippet(event)
    : renderGenericSnippet(event);

  return [header, body].join('\n');
}

/**
 * Re-export renderTriggerComment for callers that only need the comment string.
 */
export { renderTriggerComment } from './trigger.renderer';

// Expose IRTrigger for callers
export type { IRTrigger };
