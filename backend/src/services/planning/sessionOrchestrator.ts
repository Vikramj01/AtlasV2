/**
 * Session Orchestrator — drives the full multi-page scan for a Planning Mode session.
 *
 * Flow per job:
 *  1. Mark session status → 'scanning'
 *  2. Create a single Browserbase session (reused across all pages)
 *  3. Scan pages in batches of up to CONCURRENCY_LIMIT using Promise.allSettled
 *     - For each page: capturePage → analysePageWithAI → createRecommendations → update page status
 *  4. After all pages: update session status → 'review_ready'
 *  5. On unrecoverable error: update session status → 'failed'
 *
 * Failed pages do NOT abort the whole session.
 */
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import { capturePage } from './pageCaptureService';
import { analysePageWithAI } from './aiAnalysisService';
import {
  updateSessionStatus,
  updatePage,
  createRecommendations,
  type CreateRecommendationInput,
} from '@/services/database/planningQueries';
import type { PlanningPage, PlanningSession } from '@/types/planning';
import logger from '@/utils/logger';

const CONCURRENCY_LIMIT = 3; // max simultaneous Browserbase pages

interface PlaywrightBrowser {
  newContext(opts?: object): Promise<unknown>;
  close?(): Promise<void>;
}

export interface OrchestratorInput {
  session: PlanningSession;
  pages: PlanningPage[];
}

/**
 * Run the full scan for a planning session.
 * Called by the Bull job processor.
 */
export async function runPlanningOrchestrator(input: OrchestratorInput): Promise<void> {
  const { session, pages } = input;
  const sessionId = session.id;

  logger.info({ sessionId, pageCount: pages.length }, 'Planning orchestrator starting');

  // ── 1. Mark as scanning ──────────────────────────────────────────────────
  await updateSessionStatus(sessionId, 'scanning');

  // ── 2. Create Browserbase session ───────────────────────────────────────
  let browser: PlaywrightBrowser;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { chromium } = require('playwright-core') as {
      chromium: { connectOverCDP(url: string): Promise<PlaywrightBrowser> };
    };
    const bbSession = await createBrowserbaseSession();
    const cdpUrl = getCDPUrl(bbSession.id);
    browser = await chromium.connectOverCDP(cdpUrl);
    logger.info({ sessionId, bbSessionId: bbSession.id }, 'Browserbase session connected');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ sessionId, err: msg }, 'Failed to connect to Browserbase');
    await updateSessionStatus(sessionId, 'failed', `Browserbase connection failed: ${msg}`);
    return;
  }

  // ── 3. Scan pages in batches ─────────────────────────────────────────────
  const sortedPages = [...pages].sort((a, b) => a.page_order - b.page_order);

  // Process in chunks of CONCURRENCY_LIMIT
  for (let i = 0; i < sortedPages.length; i += CONCURRENCY_LIMIT) {
    const batch = sortedPages.slice(i, i + CONCURRENCY_LIMIT);

    const results = await Promise.allSettled(
      batch.map((page) => scanOnePage(browser, session, page)),
    );

    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const page = batch[idx];
        logger.error(
          { sessionId, pageId: page?.id, url: page?.url, err: String(result.reason) },
          'Page scan failed (non-fatal)',
        );
      }
    });
  }

  // ── 4. Close Browserbase session ─────────────────────────────────────────
  await browser.close?.().catch(() => {});

  // ── 5. Mark session as review_ready ──────────────────────────────────────
  await updateSessionStatus(sessionId, 'review_ready');
  logger.info({ sessionId }, 'Planning session scan complete → review_ready');
}

/**
 * Scan a single page: capture → AI analysis → persist recommendations.
 * Updates the page row status throughout.
 */
async function scanOnePage(
  browser: PlaywrightBrowser,
  session: PlanningSession,
  page: PlanningPage,
): Promise<void> {
  const { id: pageId, url, session_id: sessionId } = page;

  logger.info({ sessionId, pageId, url }, 'Scanning page');

  // Mark page as scanning
  await updatePage(pageId, { status: 'scanning' });

  try {
    // ── Capture ──────────────────────────────────────────────────────────────
    const capture = await capturePage(
      browser as Parameters<typeof capturePage>[0],
      url,
      {
        upload: {
          userId: session.user_id,
          sessionId,
          pageId,
        },
      },
    );

    // Map existing_tracking to the DB JSONB shape
    const existingTrackingForDB = buildExistingTrackingArray(capture.existing_tracking);

    // Update page metadata
    await updatePage(pageId, {
      status: 'scanning', // still scanning (AI next)
      page_title: capture.page_title || undefined,
      meta_description: capture.meta_tags['description'] || capture.meta_tags['og:description'] || undefined,
      screenshot_url: capture.screenshot_storage_path || undefined,
      existing_tracking: existingTrackingForDB,
    });

    // ── AI analysis ──────────────────────────────────────────────────────────
    // If screenshot was uploaded, we need base64 for the AI vision call.
    // In standalone mode (upload not set), base64 is still in capture.screenshot_base64.
    // In session mode, we already cleared it; re-encode from the uploaded buffer is complex,
    // so for the AI call we do a separate lightweight screenshot re-capture. However,
    // to keep cost down we only do this if the base64 was cleared. In practice,
    // the orchestrator always has the upload option set, so we need a workaround:
    // We take the screenshot BEFORE clearing it for the AI call.
    // → The actual implementation: capturePage still holds screenshot_base64 during
    //   this function call (it's a local variable). We just pass it directly.
    const screenshotForAI = capture.screenshot_base64 ||
      // If base64 was cleared after upload, we note this is a known limitation —
      // for the MVP, we accept that AI analysis without a screenshot degrades quality.
      // A future improvement would pass the signed URL to Claude's URL-based image loading.
      '';

    const aiResponse = await analysePageWithAI({
      page_url: capture.actual_url,
      page_title: capture.page_title,
      business_type: session.business_type as 'ecommerce' | 'saas' | 'lead_gen' | 'content' | 'marketplace' | 'custom',
      business_context: session.business_description ?? '',
      screenshot_base64: screenshotForAI,
      simplified_dom: capture.simplified_dom,
      interactive_elements: capture.interactive_elements,
      forms: capture.forms,
      existing_tracking: capture.existing_tracking,
      platforms_selected: session.selected_platforms,
    });

    // ── Persist recommendations ──────────────────────────────────────────────
    const recInputs: CreateRecommendationInput[] = aiResponse.recommended_elements.map((rec) => ({
      page_id: pageId,
      element_selector: rec.selector !== 'document' ? rec.selector : undefined,
      element_text: capture.interactive_elements.find((el) => el.element_id === rec.element_reference)?.text,
      element_type: rec.recommendation_type,
      action_type: rec.action_primitive_key,
      event_name: rec.suggested_event_name,
      required_params: rec.parameters_to_capture.filter((_, i) => i < 5), // store as required_params
      optional_params: [],
      bbox_x: rec.screenshot_annotation.x,
      bbox_y: rec.screenshot_annotation.y,
      bbox_width: rec.screenshot_annotation.width,
      bbox_height: rec.screenshot_annotation.height,
      confidence_score: rec.confidence,
      business_justification: rec.business_justification,
      affected_platforms: session.selected_platforms,
      source: 'ai',
    }));

    await createRecommendations(recInputs);

    // ── Mark page done ────────────────────────────────────────────────────────
    await updatePage(pageId, {
      status: 'done',
      scanned_at: new Date().toISOString(),
    });

    logger.info(
      { sessionId, pageId, recCount: recInputs.length, pageType: aiResponse.page_classification.page_type },
      'Page scan done',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ sessionId, pageId, url, err: msg }, 'Page scan error');
    await updatePage(pageId, { status: 'failed', error_message: msg });
    throw err; // re-throw so Promise.allSettled records it as rejected
  }
}

/** Convert ExistingTrackingDetection to the JSONB array format stored in DB */
function buildExistingTrackingArray(
  detection: import('@/types/planning').ExistingTrackingDetection,
): Array<{ platform: string; detected_via: string; detail: string }> {
  const result: Array<{ platform: string; detected_via: string; detail: string }> = [];

  if (detection.gtm_detected) {
    result.push({ platform: 'gtm', detected_via: 'script_tag', detail: detection.gtm_container_id ?? 'GTM detected' });
  }
  if (detection.ga4_detected) {
    result.push({ platform: 'ga4', detected_via: 'script_tag', detail: detection.ga4_measurement_id ?? 'GA4 detected' });
  }
  if (detection.meta_pixel_detected) {
    result.push({ platform: 'meta', detected_via: 'script_tag', detail: detection.meta_pixel_id ?? 'Meta Pixel detected' });
  }
  if (detection.google_ads_detected) {
    result.push({ platform: 'google_ads', detected_via: 'script_tag', detail: detection.google_ads_id ?? 'Google Ads detected' });
  }
  if (detection.tiktok_pixel_detected) {
    result.push({ platform: 'tiktok', detected_via: 'script_tag', detail: 'TikTok Pixel detected' });
  }
  if (detection.linkedin_insight_detected) {
    result.push({ platform: 'linkedin', detected_via: 'script_tag', detail: 'LinkedIn Insight Tag detected' });
  }
  if (detection.walkeros_detected) {
    result.push({ platform: 'walkeros', detected_via: 'script_tag', detail: 'WalkerOS detected' });
  }
  for (const tag of detection.other_tags) {
    result.push({ platform: 'other', detected_via: 'script_tag', detail: tag });
  }
  return result;
}
