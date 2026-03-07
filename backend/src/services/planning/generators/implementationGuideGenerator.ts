/**
 * Implementation Guide Generator
 *
 * Produces a self-contained HTML file readable by a non-technical marketer.
 * All CSS is inline — no external dependencies. Safe to open in any browser.
 *
 * Sections:
 *   1. Executive Summary
 *   2. For Your Developer (GTM install + dataLayer code)
 *   3. For Your GTM Implementer (import + placeholder values)
 *   4. Platform Setup (what IDs to fill in, where to find them)
 *   5. Testing Checklist
 *   6. What's Next (Atlas Audit Mode CTA)
 */
import type { PlanningRecommendation, PlanningPage, PlanningSession } from '@/types/planning';

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function priorityBadge(actionType: string): string {
  const conversions = new Set(['purchase', 'generate_lead', 'sign_up']);
  if (conversions.has(actionType)) return '<span class="badge badge-critical">Conversion</span>';
  return '<span class="badge badge-engagement">Engagement</span>';
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; color: #1a1a2e; background: #f8f9fa; line-height: 1.6; }
  .container { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 28px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
  h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-bottom: 12px; margin-top: 36px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  h3 { font-size: 16px; font-weight: 600; color: #334155; margin-bottom: 8px; margin-top: 20px; }
  p { margin-bottom: 12px; color: #475569; }
  ul, ol { padding-left: 20px; margin-bottom: 12px; color: #475569; }
  li { margin-bottom: 6px; }
  a { color: #3b82f6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .header { background: linear-gradient(135deg, #1e40af 0%, #7c3aed 100%); color: white; padding: 32px 24px; margin-bottom: 0; }
  .header h1 { color: white; }
  .header .subtitle { color: rgba(255,255,255,0.8); font-size: 14px; margin-top: 6px; }
  .section { background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-row { display: flex; gap: 16px; margin: 16px 0; flex-wrap: wrap; }
  .stat { background: #f1f5f9; border-radius: 8px; padding: 16px 20px; flex: 1; min-width: 120px; }
  .stat .value { font-size: 28px; font-weight: 700; color: #0f172a; }
  .stat .label { font-size: 13px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; letter-spacing: 0.3px; }
  .badge-critical { background: #fef2f2; color: #991b1b; }
  .badge-engagement { background: #eff6ff; color: #1d4ed8; }
  .badge-platform { background: #f0fdf4; color: #166534; }
  .event-card { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .event-card-header { background: #f8fafc; padding: 12px 16px; display: flex; align-items: center; gap: 10px; }
  .event-card-header .event-name { font-weight: 600; font-size: 15px; color: #0f172a; }
  .event-card-body { padding: 16px; }
  .event-card-body .justification { color: #475569; font-size: 14px; margin-bottom: 12px; font-style: italic; }
  .selector { font-family: monospace; font-size: 13px; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; color: #475569; }
  pre { background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; line-height: 1.7; margin: 12px 0; }
  pre code { font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace; }
  .code-label { font-size: 12px; color: #64748b; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 4px; margin-top: 16px; }
  .step { display: flex; gap: 12px; margin-bottom: 16px; }
  .step-num { width: 28px; height: 28px; border-radius: 50%; background: #3b82f6; color: white; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
  .step-body h4 { font-weight: 600; color: #0f172a; margin-bottom: 4px; }
  .step-body p { margin-bottom: 0; font-size: 14px; }
  .platform-row { display: flex; align-items: flex-start; gap: 16px; border-bottom: 1px solid #f1f5f9; padding: 12px 0; }
  .platform-row:last-child { border-bottom: none; }
  .platform-name { font-weight: 600; min-width: 120px; color: #0f172a; }
  .platform-detail { font-size: 14px; color: #475569; flex: 1; }
  .checklist-item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .checklist-item:last-child { border-bottom: none; }
  .checkbox { width: 18px; height: 18px; border: 2px solid #cbd5e1; border-radius: 3px; flex-shrink: 0; margin-top: 3px; }
  .checklist-text { font-size: 14px; color: #334155; }
  .cta-box { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); color: white; border-radius: 8px; padding: 24px; margin-top: 24px; }
  .cta-box h3 { color: white; margin-top: 0; }
  .cta-box p { color: rgba(255,255,255,0.75); }
  .cta-btn { display: inline-block; background: #3b82f6; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 600; margin-top: 12px; }
  .warning-box { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 12px 16px; font-size: 14px; color: #92400e; margin-bottom: 16px; }
  .info-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px 16px; font-size: 14px; color: #1e40af; margin-bottom: 16px; }
  .page-tab { display: inline-block; background: #e2e8f0; color: #475569; padding: 4px 10px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
  .footer { text-align: center; color: #94a3b8; font-size: 13px; margin-top: 48px; }
`;

// ── Main generator ────────────────────────────────────────────────────────────

export function generateImplementationGuide(
  recommendations: PlanningRecommendation[],
  pages: PlanningPage[],
  session: PlanningSession,
): string {
  const platforms = session.selected_platforms;
  const hasGA4 = platforms.includes('ga4');
  const hasGoogleAds = platforms.includes('google_ads');
  const hasMeta = platforms.includes('meta');
  const hasTikTok = platforms.includes('tiktok');
  const hasLinkedIn = platforms.includes('linkedin');

  const conversionRecs = recommendations.filter(r =>
    ['purchase', 'generate_lead', 'sign_up'].includes(r.action_type));
  const engagementRecs = recommendations.filter(r =>
    !['purchase', 'generate_lead', 'sign_up'].includes(r.action_type));

  const pageMap = new Map(pages.map(p => [p.id, p]));
  const byPage = new Map<string, PlanningRecommendation[]>();
  for (const rec of recommendations) {
    const list = byPage.get(rec.page_id) ?? [];
    list.push(rec);
    byPage.set(rec.page_id, list);
  }

  const generatedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Section 1: Executive Summary ──────────────────────────────────────────
  const execSummary = `
  <div class="section">
    <h2>1. Executive Summary</h2>
    <p>Atlas scanned <strong>${pages.length} page${pages.length !== 1 ? 's' : ''}</strong> on <strong>${esc(session.website_url)}</strong> and found <strong>${recommendations.length} tracking opportunities</strong> across your marketing funnel.</p>
    <div class="stat-row">
      <div class="stat"><div class="value">${recommendations.length}</div><div class="label">Total Events</div></div>
      <div class="stat"><div class="value">${conversionRecs.length}</div><div class="label">Conversion Events</div></div>
      <div class="stat"><div class="value">${engagementRecs.length}</div><div class="label">Engagement Events</div></div>
      <div class="stat"><div class="value">${platforms.length}</div><div class="label">Ad Platforms</div></div>
    </div>
    <h3>What this guide covers</h3>
    <ul>
      <li><strong>Developer instructions</strong> — the dataLayer.push() code to add to each page</li>
      <li><strong>GTM setup</strong> — how to import the ready-made GTM container and configure your platform IDs</li>
      <li><strong>Platform-by-platform checklist</strong> — what values to fill in for each ad platform</li>
      <li><strong>Testing checklist</strong> — how to verify everything is working before you go live</li>
    </ul>
    <div class="warning-box">
      ⚠️ <strong>Before you begin:</strong> This guide was generated automatically. Review each event with your marketing team to confirm it matches your business goals before asking a developer to implement it.
    </div>
  </div>`;

  // ── Section 2: For Your Developer ─────────────────────────────────────────
  const devSection = `
  <div class="section">
    <h2>2. For Your Developer</h2>
    <p>Forward this section to the developer who manages your website's code.</p>

    <h3>Step 1 — Install Google Tag Manager</h3>
    <p>Add this code to <strong>every page</strong> of your site. Replace <code>GTM-XXXXXXX</code> with your GTM Container ID (found in your GTM account after creating a container).</p>
    <div class="code-label">In &lt;head&gt; — as high as possible</div>
    <pre><code>&lt;!-- Google Tag Manager --&gt;
&lt;script&gt;(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&amp;l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');&lt;/script&gt;</code></pre>
    <div class="code-label">Immediately after &lt;body&gt; tag</div>
    <pre><code>&lt;noscript&gt;&lt;iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
height="0" width="0" style="display:none;visibility:hidden"&gt;&lt;/iframe&gt;&lt;/noscript&gt;</code></pre>

    <h3>Step 2 — Add dataLayer events to each page</h3>
    <p>For each event below, add the <code>window.dataLayer.push()</code> call to the relevant page. Replace all <code>{{PLACEHOLDER}}</code> values with real data from your application.</p>
    <div class="info-box">
      💡 <strong>SPA note (React, Next.js, Vue):</strong> Fire dataLayer events after navigation completes and the page content is visible — typically in a <code>useEffect</code> hook, <code>router.afterEach</code>, or equivalent lifecycle method.
    </div>

    ${Array.from(byPage.entries()).map(([pageId, recs]) => {
      const page = pageMap.get(pageId);
      if (!page) return '';
      return `
      <div class="page-tab">📄 ${esc(page.page_title ?? page.url)}</div>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:12px">${esc(page.url)}</p>
      ${recs.map(rec => `
        <div class="event-card">
          <div class="event-card-header">
            <span class="event-name">${esc(rec.event_name)}</span>
            ${priorityBadge(rec.action_type)}
            ${rec.element_selector ? `<span class="selector">${esc(rec.element_selector)}</span>` : ''}
          </div>
          <div class="event-card-body">
            <div class="justification">${esc(rec.business_justification)}</div>
            <div class="code-label">dataLayer.push() code</div>
            <pre><code>${esc(buildDevSnippet(rec))}</code></pre>
          </div>
        </div>`).join('')}`;
    }).join('')}
  </div>`;

  // ── Section 3: For Your GTM Implementer ───────────────────────────────────
  const gtmSection = `
  <div class="section">
    <h2>3. For Your GTM Implementer</h2>
    <p>Atlas has generated a ready-made GTM container JSON file. Import it into your GTM workspace to get all tags, triggers, and variables pre-configured.</p>

    <h3>How to import</h3>
    <div class="step"><div class="step-num">1</div><div class="step-body"><h4>Download the GTM container file</h4><p>Download <strong>gtm-container.json</strong> from the Atlas Planning Mode outputs page.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h4>Open GTM → Admin → Import Container</h4><p>In Google Tag Manager, go to <strong>Admin</strong> (gear icon) → <strong>Import Container</strong>.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h4>Choose your workspace and merge option</h4><p>Select <strong>Existing workspace</strong> and choose <strong>Merge</strong> (not Overwrite) to keep your existing tags.</p></div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><h4>Fill in the placeholder values</h4><p>After import, go to <strong>Variables</strong> and update the CONST variables — see Section 4 below.</p></div></div>
    <div class="step"><div class="step-num">5</div><div class="step-body"><h4>Preview and publish</h4><p>Use <strong>Preview</strong> mode to verify tags fire correctly, then <strong>Submit</strong> to publish.</p></div></div>

    <div class="warning-box">
      ⚠️ <strong>Merge, don't overwrite.</strong> Always select "Merge" when importing to avoid replacing your existing GTM configuration.
    </div>
  </div>`;

  // ── Section 4: Platform Setup ─────────────────────────────────────────────
  const platformRows: string[] = [];

  if (hasGA4) {
    platformRows.push(`
    <div class="platform-row">
      <div class="platform-name">Google Analytics 4</div>
      <div class="platform-detail">
        <strong>Variable to update:</strong> <code>CONST - GA4 Measurement ID</code><br>
        <strong>Where to find it:</strong> GA4 → Admin → Data Streams → select your stream → Measurement ID (starts with <code>G-</code>)<br>
        <strong>Example:</strong> <code>G-XXXXXXXXXX</code>
      </div>
    </div>`);
  }

  if (hasGoogleAds) {
    platformRows.push(`
    <div class="platform-row">
      <div class="platform-name">Google Ads</div>
      <div class="platform-detail">
        <strong>Variable to update:</strong> <code>CONST - Google Ads Conversion ID</code><br>
        <strong>Where to find it:</strong> Google Ads → Tools → Conversions → select a conversion → Tag setup → "Conversion ID" (starts with <code>AW-</code>)<br>
        <strong>Also update:</strong> Each <em>Google Ads Conversion</em> tag — replace <code>{{CONVERSION_LABEL}}</code> with the conversion label for each event.
      </div>
    </div>`);
  }

  if (hasMeta) {
    platformRows.push(`
    <div class="platform-row">
      <div class="platform-name">Meta (Facebook)</div>
      <div class="platform-detail">
        <strong>Variable to update:</strong> <code>CONST - Meta Pixel ID</code><br>
        <strong>Where to find it:</strong> Meta Business Manager → Events Manager → your pixel → Pixel ID (15–16 digit number)<br>
        <strong>Example:</strong> <code>1234567890123456</code>
      </div>
    </div>`);
  }

  if (hasTikTok) {
    platformRows.push(`
    <div class="platform-row">
      <div class="platform-name">TikTok Ads</div>
      <div class="platform-detail">
        <strong>Variable to update:</strong> <code>CONST - TikTok Pixel ID</code><br>
        <strong>Where to find it:</strong> TikTok Ads Manager → Assets → Events → Web Events → your pixel → Pixel ID
      </div>
    </div>`);
  }

  if (hasLinkedIn) {
    platformRows.push(`
    <div class="platform-row">
      <div class="platform-name">LinkedIn</div>
      <div class="platform-detail">
        <strong>Variable to update:</strong> <code>CONST - LinkedIn Partner ID</code><br>
        <strong>Where to find it:</strong> LinkedIn Campaign Manager → Account Assets → Insight Tag → Partner ID<br>
        <strong>Also update:</strong> Each <em>LinkedIn Conversion</em> tag — replace <code>{{LINKEDIN_CONVERSION_ID}}</code> with the conversion ID.
      </div>
    </div>`);
  }

  const platformSection = `
  <div class="section">
    <h2>4. Platform Setup — Values to Fill In</h2>
    <p>After importing the GTM container, update these variables in GTM under <strong>Variables → User-Defined Variables</strong>:</p>
    ${platformRows.join('')}
    <div class="info-box" style="margin-top:16px">
      💡 <strong>Consent Mode:</strong> The imported container includes a Consent Mode v2 default tag that sets all consent signals to "denied" by default. If you use a Consent Management Platform (CMP) like Cookiebot or OneTrust, configure it to update these consent signals when the user accepts cookies.
    </div>
  </div>`;

  // ── Section 5: Testing Checklist ──────────────────────────────────────────
  const checklistItems = [
    'GTM container is published and loaded on all pages (check with Tag Assistant Chrome extension)',
    'GA4 DebugView shows a page_view event when you visit the site',
    recommendations.some(r => r.action_type === 'purchase')
      ? 'A test purchase shows a "purchase" event in GA4 DebugView with correct transaction_id and value'
      : null,
    recommendations.some(r => r.action_type === 'generate_lead')
      ? 'Submitting a test form shows a "generate_lead" event in GA4 DebugView'
      : null,
    recommendations.some(r => r.action_type === 'add_to_cart')
      ? 'Clicking "Add to Cart" shows an "add_to_cart" event in GA4 DebugView'
      : null,
    hasGoogleAds ? 'Google Ads Tag Assistant shows conversion tags firing (not blocked by consent)' : null,
    hasMeta ? 'Meta Pixel Helper Chrome extension shows events firing on the relevant pages' : null,
    'No duplicate events in GA4 DebugView (each action fires the event exactly once)',
    'Test with a real browser (not incognito) to verify cookies are being set',
    'Ask a developer to do a code review of the dataLayer.push() calls before going live',
  ].filter(Boolean);

  const testingSection = `
  <div class="section">
    <h2>5. Testing Checklist</h2>
    <p>Use this checklist to verify your tracking is working before running ads:</p>
    ${checklistItems.map(item => `
    <div class="checklist-item">
      <div class="checkbox"></div>
      <div class="checklist-text">${esc(item!)}</div>
    </div>`).join('')}
  </div>`;

  // ── Section 6: What's Next ────────────────────────────────────────────────
  const nextSection = `
  <div class="section">
    <h2>6. What's Next</h2>
    <p>Once your developer has implemented the dataLayer code and you've imported the GTM container, you're ready to verify everything is working correctly in production.</p>
    <div class="cta-box">
      <h3>Verify Your Tracking with Atlas Audit Mode</h3>
      <p>Atlas Audit Mode simulates a real user journey through your site and validates that all your tracking signals are firing correctly — with the right parameters, on the right pages.</p>
      <p>It checks all ${recommendations.length} of the events above and scores your Conversion Signal Health from 0–100.</p>
      <a class="cta-btn" href="/audit">Run an Audit →</a>
    </div>
  </div>`;

  // ── Assemble the full HTML ─────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Atlas Tracking Implementation Guide — ${esc(session.website_url)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="header">
  <div class="container">
    <h1>Tracking Implementation Guide</h1>
    <div class="subtitle">Generated by Atlas for ${esc(session.website_url)} · ${generatedDate}</div>
  </div>
</div>
<div class="container">
  ${execSummary}
  ${devSection}
  ${gtmSection}
  ${platformSection}
  ${testingSection}
  ${nextSection}
  <div class="footer">
    Generated by <strong>Atlas Planning Mode</strong> · ${generatedDate}<br>
    This guide is specific to your site. Do not share publicly.
  </div>
</div>
</body>
</html>`;
}

// ── Inline snippet builder (used in the dev section) ─────────────────────────

function buildDevSnippet(rec: PlanningRecommendation): string {
  const lines: string[] = [];
  if (rec.element_selector) {
    lines.push(`// Fire this when the user interacts with: ${rec.element_text ?? rec.element_selector}`);
  } else {
    lines.push(`// Fire this on page load (before GTM script)`);
  }
  lines.push('window.dataLayer = window.dataLayer || [];');

  const a = rec.action_type;
  if (a === 'purchase') {
    lines.push(`window.dataLayer.push({ event: 'purchase', ecommerce: { transaction_id: '{{ORDER_ID}}', value: {{ORDER_TOTAL}}, currency: '{{CURRENCY}}', items: [{ item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}}, quantity: {{QTY}} }] }, user_data: { email: '{{EMAIL}}' } });`);
  } else if (a === 'add_to_cart') {
    lines.push(`window.dataLayer.push({ event: '${rec.event_name}', ecommerce: { value: {{PRICE}}, currency: '{{CURRENCY}}', items: [{ item_id: '{{SKU}}', item_name: '{{NAME}}', price: {{PRICE}}, quantity: 1 }] } });`);
  } else if (a === 'generate_lead') {
    lines.push(`window.dataLayer.push({ event: '${rec.event_name}', form_id: '${rec.element_selector?.replace(/['"]/g, '').slice(0, 40) ?? '{{FORM_ID}}'}', user_data: { email: '{{EMAIL}}' } });`);
  } else if (a === 'sign_up') {
    lines.push(`window.dataLayer.push({ event: '${rec.event_name}', method: '{{METHOD}}', user_id: '{{USER_ID}}' });`);
  } else if (a === 'begin_checkout') {
    lines.push(`window.dataLayer.push({ event: '${rec.event_name}', ecommerce: { value: {{CART_TOTAL}}, currency: '{{CURRENCY}}', items: [] } });`);
  } else {
    const params = (rec.required_params as unknown as Array<{ param_key: string }>) ?? [];
    const paramStr = params.map(p => `${p.param_key}: '{{${p.param_key.toUpperCase()}}}'`).join(', ');
    lines.push(`window.dataLayer.push({ event: '${rec.event_name}'${paramStr ? ', ' + paramStr : ''} });`);
  }

  return lines.join('\n');
}
