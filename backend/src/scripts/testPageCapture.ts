/**
 * Dev test script — Sprint PM-1 acceptance test.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/testPageCapture.ts <url> [business_type] [platforms]
 *
 * Examples:
 *   npx ts-node -r tsconfig-paths/register src/scripts/testPageCapture.ts https://example.com ecommerce ga4,meta
 *   npx ts-node -r tsconfig-paths/register src/scripts/testPageCapture.ts https://stripe.com/pricing saas ga4
 *
 * Environment: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, ANTHROPIC_API_KEY must be set in .env
 *
 * This script is NOT production code — it is a developer verification tool for Sprint PM-1.
 */
import 'dotenv/config';

async function main() {
  const url = process.argv[2];
  const businessType = (process.argv[3] ?? 'ecommerce') as
    | 'ecommerce'
    | 'saas'
    | 'lead_gen'
    | 'content'
    | 'marketplace'
    | 'custom';
  const platforms = (process.argv[4] ?? 'ga4,meta').split(',').map((p) => p.trim());

  if (!url) {
    console.error('Usage: npx ts-node -r tsconfig-paths/register src/scripts/testPageCapture.ts <url> [business_type] [platforms]');
    process.exit(1);
  }

  console.log('\n=== Atlas Planning Mode — Page Capture Test ===');
  console.log(`URL:           ${url}`);
  console.log(`Business type: ${businessType}`);
  console.log(`Platforms:     ${platforms.join(', ')}`);
  console.log('');

  // ── Step 1: Page Capture ─────────────────────────────────────────────────
  console.log('[1/2] Capturing page via Browserbase...');
  const captureStart = Date.now();

  // Lazy import to allow env to load first
  const { capturePageStandalone } = await import('@/services/planning/pageCaptureService');
  const capture = await capturePageStandalone(url);

  const captureMs = Date.now() - captureStart;
  console.log(`      Done in ${captureMs}ms`);
  console.log(`      Page title:           "${capture.page_title}"`);
  console.log(`      Actual URL:           ${capture.actual_url}`);
  console.log(`      Interactive elements: ${capture.interactive_elements.length}`);
  console.log(`      Forms:                ${capture.forms.length}`);
  console.log(`      Screenshot size:      ${Math.round(capture.screenshot_base64.length * 0.75 / 1024)}KB`);
  console.log(`      GTM detected:         ${capture.existing_tracking.gtm_detected}`);
  console.log(`      GA4 detected:         ${capture.existing_tracking.ga4_detected}`);
  console.log(`      Meta detected:        ${capture.existing_tracking.meta_pixel_detected}`);
  console.log(`      Existing dL events:   [${capture.existing_tracking.datalayer_events_found.join(', ')}]`);

  if (capture.interactive_elements.length > 0) {
    console.log('\n  Top interactive elements:');
    capture.interactive_elements.slice(0, 6).forEach((el) => {
      console.log(`    [${el.element_id}] <${el.tag}> "${el.text.slice(0, 50)}" (${el.element_type}${el.is_above_fold ? ', above-fold' : ''})`);
    });
  }

  // Estimate DOM token count
  const domJson = JSON.stringify(capture.simplified_dom);
  const estimatedTokens = Math.round(domJson.length / 4);
  console.log(`\n  Simplified DOM: ~${estimatedTokens.toLocaleString()} tokens (${domJson.length.toLocaleString()} chars)`);
  if (estimatedTokens > 15000) {
    console.warn(`  ⚠️  DOM exceeds 15K token target — check domSimplifier pruning rules`);
  }

  // ── Step 2: AI Analysis ──────────────────────────────────────────────────
  console.log('\n[2/2] Sending to Claude API for analysis...');
  const aiStart = Date.now();

  const { analysePageWithAI } = await import('@/services/planning/aiAnalysisService');
  const analysis = await analysePageWithAI({
    page_url: capture.actual_url,
    page_title: capture.page_title,
    business_type: businessType,
    business_context: `A ${businessType} website. Analyse the page and recommend what to track.`,
    screenshot_base64: capture.screenshot_base64,
    simplified_dom: capture.simplified_dom,
    interactive_elements: capture.interactive_elements,
    forms: capture.forms,
    existing_tracking: capture.existing_tracking,
    platforms_selected: platforms,
  });

  const aiMs = Date.now() - aiStart;
  console.log(`      Done in ${aiMs}ms`);

  // ── Results ──────────────────────────────────────────────────────────────
  console.log('\n=== RESULTS ===\n');

  console.log('Page Classification:');
  console.log(`  Type:        ${analysis.page_classification.page_type}`);
  console.log(`  Position:    ${analysis.page_classification.funnel_position}`);
  console.log(`  Importance:  ${analysis.page_classification.business_importance}`);
  console.log(`  Reasoning:   ${analysis.page_classification.reasoning}`);
  console.log('');

  console.log('Page Summary:');
  console.log(`  ${analysis.page_summary}`);
  console.log('');

  console.log('Existing Tracking Assessment:');
  console.log(`  Quality:  ${analysis.existing_tracking_assessment.quality}`);
  console.log(`  Summary:  ${analysis.existing_tracking_assessment.summary}`);
  if (analysis.existing_tracking_assessment.conflicts.length) {
    console.log(`  Conflicts: ${analysis.existing_tracking_assessment.conflicts.join('; ')}`);
  }
  console.log('');

  console.log(`Recommendations (${analysis.recommended_elements.length}):`);
  analysis.recommended_elements.forEach((rec, i) => {
    const conf = Math.round(rec.confidence * 100);
    const confStr = conf >= 80 ? `✅ ${conf}%` : conf >= 60 ? `⚠️  ${conf}%` : `❌ ${conf}%`;
    console.log(`\n  [${i + 1}] ${rec.suggested_event_name} (${rec.priority}) — ${confStr} confidence`);
    console.log(`      Action:      ${rec.action_primitive_key}`);
    console.log(`      Type:        ${rec.recommendation_type}`);
    console.log(`      Selector:    ${rec.selector}`);
    console.log(`      Justif:      ${rec.business_justification.slice(0, 100)}`);
    if (rec.parameters_to_capture.length) {
      console.log(`      Params:      ${rec.parameters_to_capture.map((p) => p.param_key).join(', ')}`);
    }
    console.log(`      Annotation:  x=${rec.screenshot_annotation.x} y=${rec.screenshot_annotation.y} "${rec.screenshot_annotation.label}"`);
  });

  console.log('\n=== TIMING ===');
  console.log(`  Page capture: ${captureMs}ms`);
  console.log(`  AI analysis:  ${aiMs}ms`);
  console.log(`  Total:        ${captureMs + aiMs}ms`);

  console.log('\n✅ Sprint PM-1 test complete. No errors.\n');
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err.message ?? err);
  process.exit(1);
});
