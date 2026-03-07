/**
 * DataLayer Specification Generator
 *
 * Produces developer-ready dataLayer.push() code snippets from approved
 * planning recommendations. Unlike the existing gtmDataLayer.ts which works
 * from generic action primitives, this generator uses the actual element
 * selectors and parameters found on the real pages by the AI.
 *
 * Output structure: JSON with embedded code strings, grouped by page URL.
 */
import type { PlanningRecommendation, PlanningPage, PlanningSession } from '@/types/planning';

// ── Output types ──────────────────────────────────────────────────────────────

export interface DataLayerParam {
  key: string;
  label: string;
  source: string;
  example: string;
  required: boolean;
}

export interface DataLayerEvent {
  event_name: string;
  action_type: string;
  element_selector?: string;
  element_text?: string;
  trigger_type: string;
  business_justification: string;
  priority: string;
  parameters: DataLayerParam[];
  code_snippet: string;
  platforms: string[];
}

export interface DataLayerPageSpec {
  page_url: string;
  page_title?: string;
  page_type?: string;
  events: DataLayerEvent[];
}

export interface DataLayerSpecOutput {
  generated_at: string;
  business_type: string;
  platforms: string[];
  installation_snippet: string;
  pages: DataLayerPageSpec[];
  variable_naming_guide: string;
  developer_notes: string;
}

// ── Installation snippet (GTM container tag) ──────────────────────────────────

const INSTALLATION_SNIPPET = `<!-- ============================================================
     GOOGLE TAG MANAGER — Installation
     Place this snippet in the <head> of EVERY page, as high as possible.
     Replace GTM-XXXXXXX with your actual GTM Container ID.
     ============================================================ -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>

<!-- Google Tag Manager (noscript) — place immediately after opening <body> tag -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

// ── Code snippet builders ────────────────────────────────────────────────────

function buildCodeSnippet(rec: PlanningRecommendation): string {
  const params = (rec.required_params as unknown as Array<{ param_key: string; param_label: string; example_value: string }>) ?? [];
  const actionType = rec.action_type;
  const eventName = rec.event_name;

  const lines: string[] = [];

  // Context comment
  if (rec.element_selector) {
    lines.push(`// Trigger: on click/submit of "${rec.element_text ?? rec.element_selector}"`);
    lines.push(`// Selector: ${rec.element_selector}`);
  } else {
    lines.push(`// Trigger: on page load`);
  }
  lines.push('');
  lines.push('window.dataLayer = window.dataLayer || [];');

  if (['purchase'].includes(actionType)) {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    lines.push('  ecommerce: {');
    lines.push(`    transaction_id: '{{ORDER_ID}}',         // REQUIRED: Unique order ID from your system`);
    lines.push(`    value: {{ORDER_TOTAL}},                  // REQUIRED: Total order value (number, e.g., 99.99)`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',           // REQUIRED: ISO currency code, e.g., 'USD'`);
    lines.push(`    tax: {{TAX_AMOUNT}},                     // Optional`);
    lines.push(`    shipping: {{SHIPPING_COST}},             // Optional`);
    lines.push(`    coupon: '{{COUPON_CODE}}',               // Optional: Applied coupon code`);
    lines.push(`    items: [`);
    lines.push(`      {`);
    lines.push(`        item_id: '{{PRODUCT_SKU}}',`);
    lines.push(`        item_name: '{{PRODUCT_NAME}}',`);
    lines.push(`        price: {{UNIT_PRICE}},`);
    lines.push(`        quantity: {{QUANTITY}}`);
    lines.push(`      }`);
    lines.push(`      // Repeat object above for each product in the order`);
    lines.push(`    ]`);
    lines.push(`  },`);
    lines.push(`  // Enhanced Conversions — hashed by GTM before sending to ad platforms`);
    lines.push(`  user_data: {`);
    lines.push(`    email: '{{CUSTOMER_EMAIL_RAW}}',         // Optional but strongly recommended`);
    lines.push(`    phone_number: '{{CUSTOMER_PHONE_RAW}}'   // Optional`);
    lines.push(`  }`);
    lines.push('});');
  } else if (actionType === 'add_to_cart') {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    lines.push('  ecommerce: {');
    lines.push(`    value: {{ITEM_PRICE}},                   // REQUIRED: Price of item(s) added`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',           // REQUIRED`);
    lines.push(`    items: [{ item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}}, quantity: 1 }]`);
    lines.push('  }');
    lines.push('});');
  } else if (actionType === 'begin_checkout') {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    lines.push('  ecommerce: {');
    lines.push(`    value: {{CART_TOTAL}},                   // REQUIRED: Total cart value`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',           // REQUIRED`);
    lines.push(`    items: [/* ...products in cart... */]`);
    lines.push('  }');
    lines.push('});');
  } else if (actionType === 'generate_lead') {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    if (rec.element_selector) {
      lines.push(`  form_id: '${rec.element_selector.replace(/['"]/g, '').slice(0, 40)}', // REQUIRED: identifies which form`);
    } else {
      lines.push(`  form_id: '{{FORM_ID}}',                  // REQUIRED: identifies which form`);
    }
    lines.push(`  value: {{LEAD_VALUE}},                     // Optional: estimated lead value`);
    lines.push(`  currency: '{{CURRENCY_CODE}}',             // Optional`);
    lines.push(`  user_data: {`);
    lines.push(`    email: '{{LEAD_EMAIL}}',                  // Optional but recommended`);
    lines.push(`    phone_number: '{{LEAD_PHONE}}'           // Optional`);
    lines.push(`  }`);
    lines.push('});');
  } else if (actionType === 'sign_up') {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    lines.push(`  method: '{{SIGNUP_METHOD}}',               // REQUIRED: 'email', 'google', 'facebook', etc.`);
    lines.push(`  user_id: '{{USER_ID}}'                     // Optional: your internal user ID`);
    lines.push('});');
  } else if (actionType === 'view_item') {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    lines.push('  ecommerce: {');
    lines.push(`    value: {{PRODUCT_PRICE}},`);
    lines.push(`    currency: '{{CURRENCY_CODE}}',`);
    lines.push(`    items: [{ item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}} }]`);
    lines.push('  }');
    lines.push('});');
  } else if (actionType === 'search') {
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    lines.push(`  search_term: '{{SEARCH_QUERY}}'            // REQUIRED: the user's search term`);
    lines.push('});');
  } else {
    // Generic custom event — use AI-identified params
    lines.push('window.dataLayer.push({');
    lines.push(`  event: '${eventName}',`);
    for (const p of params) {
      const example = p.example_value ?? `'{{${p.param_key.toUpperCase()}}}'`;
      lines.push(`  ${p.param_key}: ${example},             // ${p.param_label}`);
    }
    if (params.length === 0) {
      lines.push(`  // Add event parameters here`);
    }
    lines.push('});');
  }

  return lines.join('\n');
}

// ── Variable naming guide ─────────────────────────────────────────────────────

const VARIABLE_NAMING_GUIDE = `// ============================================================
// VARIABLE NAMING CONVENTIONS
// ============================================================
//
// Replace all {{PLACEHOLDER}} values in the snippets above with
// real values from your application:
//
// {{ORDER_ID}}          → Your system's unique order/transaction ID
// {{ORDER_TOTAL}}       → Total order value as a number (not a string)
// {{CURRENCY_CODE}}     → 3-letter ISO currency code: 'USD', 'EUR', 'GBP', etc.
// {{PRODUCT_SKU}}       → Your product's unique identifier (SKU or ID)
// {{PRODUCT_NAME}}      → Human-readable product name
// {{UNIT_PRICE}}        → Price per unit as a number
// {{QUANTITY}}          → Quantity as a number
// {{CUSTOMER_EMAIL_RAW}}→ Customer's email — GTM/ad platforms will hash this
// {{CUSTOMER_PHONE_RAW}}→ Customer's phone in E.164 format (+15551234567)
// {{FORM_ID}}           → A slug identifying which form was submitted
// {{USER_ID}}           → Your application's user ID for the logged-in user
// {{SIGNUP_METHOD}}     → How the user signed up: 'email', 'google', 'facebook'
// {{SEARCH_QUERY}}      → The search term the user entered
//
// ============================================================`;

// ── Developer notes ───────────────────────────────────────────────────────────

const DEVELOPER_NOTES = `Implementation checklist:

1. Install GTM on every page (use the installation_snippet above)
2. For each page, add the dataLayer.push() calls BEFORE the GTM script tag
   (or trigger them from your framework's event system)
3. For SPA frameworks (React, Next.js, Vue), wrap the push() calls in
   the appropriate lifecycle hook (e.g., useEffect, onMounted, router.afterEach)
4. For ecommerce events, fire AFTER the transaction is confirmed — not at
   the "place order" button click
5. Test using GTM Preview Mode (Tag Assistant) before publishing
6. Verify GA4 DebugView shows events with correct parameters

IMPORTANT: Never push sensitive data (full card numbers, passwords, SSNs)
into the dataLayer. Email and phone are fine — GTM hashes them automatically.`;

// ── Main generator ────────────────────────────────────────────────────────────

export function generateDataLayerSpec(
  recommendations: PlanningRecommendation[],
  pages: PlanningPage[],
  session: Pick<PlanningSession, 'business_type' | 'selected_platforms'>,
): DataLayerSpecOutput {
  // Group recommendations by page_id
  const byPage = new Map<string, PlanningRecommendation[]>();
  for (const rec of recommendations) {
    const list = byPage.get(rec.page_id) ?? [];
    list.push(rec);
    byPage.set(rec.page_id, list);
  }

  const pageSpecs: DataLayerPageSpec[] = [];

  for (const page of pages) {
    const pageRecs = byPage.get(page.id) ?? [];
    if (pageRecs.length === 0) continue;

    const events: DataLayerEvent[] = pageRecs.map((rec): DataLayerEvent => {
      const params = (rec.required_params as unknown as Array<{ param_key: string; param_label: string; source: string; example_value: string }>) ?? [];
      return {
        event_name: rec.event_name,
        action_type: rec.action_type,
        element_selector: rec.element_selector ?? undefined,
        element_text: rec.element_text ?? undefined,
        trigger_type: rec.element_selector ? 'click/submit' : 'page_load',
        business_justification: rec.business_justification,
        priority: 'required',
        parameters: params.map(p => ({
          key: p.param_key,
          label: p.param_label,
          source: p.source,
          example: p.example_value,
          required: true,
        })),
        code_snippet: buildCodeSnippet(rec),
        platforms: rec.affected_platforms,
      };
    });

    pageSpecs.push({
      page_url: page.url,
      page_title: page.page_title ?? undefined,
      page_type: page.page_type,
      events,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    business_type: session.business_type,
    platforms: session.selected_platforms,
    installation_snippet: INSTALLATION_SNIPPET,
    pages: pageSpecs,
    variable_naming_guide: VARIABLE_NAMING_GUIDE,
    developer_notes: DEVELOPER_NOTES,
  };
}
