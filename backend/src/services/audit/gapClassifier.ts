/**
 * Gap Classifier
 * Compares per-stage Browserbase captures against the ValidationSpec's
 * expected events and produces Gap[] classified as MISSING or WRONG.
 *
 * GTM-aware detection model
 * ─────────────────────────
 * Sites increasingly fire ad-platform tags (Meta Pixel, Google Ads,
 * GA4) through Google Tag Manager rather than inline scripts.
 * In this model the dataLayer only ever sees the generic action event
 * (e.g. {event:'purchase'}) — GTM translates it to the platform event
 * (fbq('track','Purchase'), gtag('event','conversion') etc.) and sends
 * the network request from the browser.
 *
 * Therefore, for each expected event × platform pair we accept either:
 *  (a) platform-specific event name found in the dataLayer (direct impl.)
 *  OR
 *  (b) generic action_key found in the dataLayer AND the platform's
 *      delivery endpoint received a network request (GTM-mediated impl.)
 *
 * If neither is true → event_not_found gap
 * If action is in DL but endpoint got no request → platform_not_receiving
 * If event is tracked but required params are absent → parameter_absent
 */
import type { ValidationSpec, StageValidationSpec, Gap, StageStatus } from '@/types/journey';
import type { StageCapture } from './stageSimulator';
import { getPlatformSchema } from '@/services/journey/platformSchemas';

export interface StageGapResult {
  stage_order: number;
  stage_label: string;
  stage_status: StageStatus;
  gaps: Gap[];
}

function detectEventInDataLayer(
  datalayerEvents: Array<{ event?: string; [key: string]: unknown }>,
  eventName: string,
): { found: boolean; event?: { event?: string; [key: string]: unknown } } {
  const found = datalayerEvents.find(
    (e) => e.event?.toLowerCase() === eventName.toLowerCase(),
  );
  return { found: !!found, event: found };
}

function detectNetworkRequest(
  networkRequests: Array<{ url: string }>,
  endpointPatterns: string[],
): boolean {
  return networkRequests.some((r) =>
    endpointPatterns.some((pattern) => r.url.includes(pattern)),
  );
}

function checkRequiredParams(
  event: Record<string, unknown>,
  requiredParams: string[],
): string[] {
  // Flatten ecommerce sub-object if present
  const flat: Record<string, unknown> = { ...event };
  if (event['ecommerce'] && typeof event['ecommerce'] === 'object') {
    Object.assign(flat, event['ecommerce'] as object);
  }

  return requiredParams.filter((param) => {
    const val = flat[param];
    if (val === undefined || val === null || val === '') return true;
    return false;
  });
}

function buildFixCode(actionKey: string, platform: string, subType: string): string {
  if (subType === 'event_not_found') {
    if (actionKey === 'purchase' && platform === 'ga4') {
      return `window.dataLayer.push({\n  event: 'purchase',\n  ecommerce: {\n    transaction_id: '{{ORDER_ID}}',\n    value: {{ORDER_TOTAL}},\n    currency: '{{CURRENCY}}'\n  }\n});`;
    }
    if (actionKey === 'purchase' && platform === 'meta') {
      return `// Option A — direct pixel call:\nfbq('track', 'Purchase', { value: {{ORDER_TOTAL}}, currency: '{{CURRENCY}}' });\n\n// Option B — via GTM dataLayer (recommended):\nwindow.dataLayer.push({ event: 'purchase', value: {{ORDER_TOTAL}}, currency: '{{CURRENCY}}' });\n// Then configure a GTM trigger on event == 'purchase' firing the Meta Pixel tag`;
    }
    return `// Add the required ${actionKey} event to your ${platform} implementation`;
  }
  if (subType === 'parameter_absent') {
    return `// Ensure all required parameters are included in your ${actionKey} event push`;
  }
  if (subType === 'platform_not_receiving') {
    return `// The dataLayer event is firing, but ${platform.toUpperCase()} is not receiving a network request.\n// If using GTM: verify the ${platform.toUpperCase()} tag trigger fires on this dataLayer event\n// If using direct pixel: verify the pixel base tag loads on every page`;
  }
  return `// Review your ${platform} implementation for the ${actionKey} event`;
}

function classifyStageGaps(
  stageSpec: StageValidationSpec,
  capture: StageCapture,
): Gap[] {
  const gaps: Gap[] = [];

  if (capture.skipped || !capture.navigation_success) {
    return gaps; // Stage was skipped or failed to load — no gaps to classify
  }

  // ── Check expected events ─────────────────────────────────────────────────
  for (const expectedEvent of stageSpec.expected_events) {
    for (const [platform, platformEventName] of Object.entries(expectedEvent.event_name_by_platform)) {
      const schema = getPlatformSchema(platform as any);

      // ── GTM-aware event detection ────────────────────────────────────────
      //
      // (a) Direct implementation: platform-specific event in dataLayer
      //     e.g. Meta: {event:'Purchase'} or GA4: {event:'purchase'}
      const platformEventInDL = detectEventInDataLayer(
        capture.datalayer_events as any[],
        platformEventName,
      );

      // (b) GTM-mediated: generic action_key in dataLayer
      //     e.g. {event:'purchase'} triggers GTM → fires Meta/GAds tag
      const actionInDL = detectEventInDataLayer(
        capture.datalayer_events as any[],
        expectedEvent.action_key,
      );

      // Network endpoint: did the platform actually receive a request?
      const hasNetworkEndpoints = !!(schema && schema.delivery.endpoint_patterns.length > 0);
      const networkHit = hasNetworkEndpoints
        ? detectNetworkRequest(capture.network_requests, schema!.delivery.endpoint_patterns)
        : null; // null = "no network endpoint to check"

      // Event is tracked if:
      //  - direct: platform-specific event name in dataLayer, OR
      //  - GTM-mediated: action_key in dataLayer + platform got a network request
      const dlEventFound = platformEventInDL.found || actionInDL.found;
      const isTracked =
        platformEventInDL.found ||
        (actionInDL.found && (networkHit === true || networkHit === null));

      if (!isTracked) {
        // Neither direct implementation nor GTM-mediated tracking detected
        gaps.push({
          gap_type: 'MISSING',
          sub_type: 'event_not_found',
          severity: 'critical',
          action_key: expectedEvent.action_key,
          platform,
          expected: `A "${platformEventName}" event should fire here — either directly in the dataLayer or via GTM`,
          found: `No "${platformEventName}" event or "${expectedEvent.action_key}" trigger was detected`,
          business_impact: platform === 'meta'
            ? `Meta cannot attribute this conversion. Your ROAS reporting will be incomplete.`
            : platform === 'ga4'
            ? `Google Analytics cannot track this conversion. Reporting will be missing this step.`
            : `${platform.toUpperCase()} cannot see this conversion event.`,
          fix_owner: 'Developer or GTM Admin',
          fix_description: `Add the ${platformEventName} event to the page at: ${capture.url_navigated}`,
          fix_code: buildFixCode(expectedEvent.action_key, platform, 'event_not_found'),
          estimated_effort: 'low',
        });
        continue;
      }

      // ── Check required parameters ────────────────────────────────────────
      // Prefer the platform-specific DL event for param checking; fall back
      // to the generic action event (which is the dataLayer payload for GTM)
      const dlEventForParams =
        (platformEventInDL.event ?? actionInDL.event) as Record<string, unknown> | undefined;

      if (dlEventForParams) {
        const missingParams = checkRequiredParams(dlEventForParams, expectedEvent.required_params);
        for (const param of missingParams) {
          gaps.push({
            gap_type: 'MISSING',
            sub_type: 'parameter_absent',
            severity: 'high',
            action_key: expectedEvent.action_key,
            platform,
            expected: `The "${param}" parameter should be present in the ${platformEventName} event`,
            found: `"${param}" was not found or was empty in the event payload`,
            business_impact: param === 'transaction_id'
              ? 'Without a transaction ID, duplicate conversions cannot be detected. You may be double-counting revenue.'
              : param === 'value'
              ? 'Without a value, ROAS (Return on Ad Spend) cannot be calculated for this platform.'
              : `The "${param}" field is required for full signal accuracy on ${platform}.`,
            fix_owner: 'Developer',
            fix_description: `Ensure the "${param}" field is populated before the dataLayer.push() call`,
            fix_code: buildFixCode(expectedEvent.action_key, platform, 'parameter_absent'),
            estimated_effort: 'low',
          });
        }
      }

      // ── Check that platform's network endpoint received the event ─────────
      // Only flag this if we know the action event is firing (it's in the DL)
      // but the platform isn't receiving it — which means GTM/pixel config
      // is broken, not that tracking is absent entirely.
      if (dlEventFound && networkHit === false) {
        gaps.push({
          gap_type: 'MISSING',
          sub_type: 'platform_not_receiving',
          severity: 'critical',
          action_key: expectedEvent.action_key,
          platform,
          expected: `A network request to ${schema!.delivery.endpoint_patterns[0]} should be observed`,
          found: `The "${expectedEvent.action_key}" event is in the dataLayer but no outbound request to ${platform.toUpperCase()} was detected`,
          business_impact: `${schema!.display_name} is not receiving the event. The dataLayer push is firing but the ${schema!.display_name} tag in GTM (or direct pixel) is not forwarding it to the platform.`,
          fix_owner: 'GTM Admin',
          fix_description: `Verify the ${schema!.display_name} tag in GTM fires on the "${expectedEvent.action_key}" dataLayer trigger. Check tag firing rules and preview mode.`,
          fix_code: buildFixCode(expectedEvent.action_key, platform, 'platform_not_receiving'),
          estimated_effort: 'medium',
        });
      }
    }
  }

  // ── Check platform base tags ──────────────────────────────────────────────
  // When a platform fires via GTM, its base script is loaded dynamically
  // by GTM (not inline on the page). We accept either:
  //  (a) the platform's own script in network requests, OR
  //  (b) GTM container loaded + platform delivery endpoint seen
  //     (meaning GTM is acting as the platform loader)
  const gtmLoaded = detectNetworkRequest(capture.network_requests, [
    'googletagmanager.com/gtm.js',
    'googletagmanager.com/gtag/js',
  ]);

  for (const expectedPlatform of stageSpec.expected_platforms) {
    if (!expectedPlatform.must_detect_tag) continue;
    const schema = getPlatformSchema(expectedPlatform.platform as any);
    if (!schema) continue;

    // Direct script detection
    const directScriptLoaded = detectNetworkRequest(
      capture.network_requests,
      schema.detection.script_patterns,
    );

    // GTM-mediated: GTM is present AND the platform endpoint received a request
    // (confirms GTM loaded and fired the platform tag, even if base script is
    //  loaded asynchronously and merged into GTM's own bundle)
    const deliveryHit =
      schema.delivery.endpoint_patterns.length > 0 &&
      detectNetworkRequest(capture.network_requests, schema.delivery.endpoint_patterns);

    const tagDetected = directScriptLoaded || (gtmLoaded && deliveryHit);

    if (!tagDetected) {
      gaps.push({
        gap_type: 'MISSING',
        sub_type: 'platform_tag_absent',
        severity: 'critical',
        action_key: 'ad_landing',
        platform: expectedPlatform.platform,
        expected: `The ${schema.display_name} tag should be active on this page (either loaded directly or via GTM)`,
        found: `No ${schema.display_name} script or network activity was detected on this page`,
        business_impact: `${schema.display_name} cannot track any events on this page. All conversion tracking for this platform is broken here.`,
        fix_owner: 'GTM Admin',
        fix_description: `Add the ${schema.display_name} tag to your GTM container and ensure it fires on All Pages, or add the base tag directly to the page`,
        fix_code: `// Option A — GTM: Tags → New → ${schema.display_name} tag → Trigger: All Pages\n// Option B — Direct: embed the ${schema.display_name} base tag in your site's <head>`,
        estimated_effort: 'low',
      });
    }
  }

  return gaps;
}

function resolveStageStatus(gaps: Gap[], skipped: boolean): StageStatus {
  if (skipped) return 'not_checked';
  if (gaps.length === 0) return 'healthy';
  if (gaps.some((g) => g.severity === 'critical')) return 'signals_missing';
  return 'issues_found';
}

export function classifyAllStageGaps(
  spec: ValidationSpec,
  captures: StageCapture[],
): StageGapResult[] {
  const results: StageGapResult[] = [];

  for (const stageSpec of spec.stages) {
    const capture = captures.find((c) => c.stage_order === stageSpec.stage_order);

    if (!capture) {
      results.push({
        stage_order: stageSpec.stage_order,
        stage_label: stageSpec.stage_label,
        stage_status: 'not_checked',
        gaps: [],
      });
      continue;
    }

    const gaps = classifyStageGaps(stageSpec, capture);
    results.push({
      stage_order: stageSpec.stage_order,
      stage_label: stageSpec.stage_label,
      stage_status: resolveStageStatus(gaps, capture.skipped),
      gaps,
    });
  }

  return results;
}
