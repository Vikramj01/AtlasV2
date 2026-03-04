/**
 * Gap Classifier
 * Compares per-stage Browserbase captures against the ValidationSpec's
 * expected events and produces Gap[] classified as MISSING or WRONG.
 */
import type { ValidationSpec, StageValidationSpec, Gap, GapType, GapSeverity, EstimatedEffort, StageStatus } from '@/types/journey';
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
      return `fbq('track', 'Purchase', {\n  value: {{ORDER_TOTAL}},\n  currency: '{{CURRENCY}}'\n});`;
    }
    return `// Add the required ${actionKey} event to your ${platform} implementation`;
  }
  if (subType === 'parameter_absent') {
    return `// Ensure all required parameters are included in your ${actionKey} event push`;
  }
  if (subType === 'platform_not_receiving') {
    return `// Verify your ${platform} tag is configured in GTM to fire on this page`;
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

      // 1. Check dataLayer for this event (GA4 and GTM-based platforms)
      const dlCheck = detectEventInDataLayer(
        capture.datalayer_events as any[],
        expectedEvent.action_key === 'purchase' && platform !== 'ga4'
          ? platformEventName
          : expectedEvent.action_key,
      );

      if (!dlCheck.found) {
        gaps.push({
          gap_type: 'MISSING',
          sub_type: 'event_not_found',
          severity: 'critical',
          action_key: expectedEvent.action_key,
          platform,
          expected: `A "${platformEventName}" event should fire here`,
          found: `No "${platformEventName}" event was detected in the dataLayer or network requests`,
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

      // 2. Event found — check required parameters
      const missingParams = checkRequiredParams(
        dlCheck.event as Record<string, unknown>,
        expectedEvent.required_params,
      );

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

      // 3. Check that the platform's network endpoint received the event
      if (schema && schema.delivery.endpoint_patterns.length > 0) {
        const networkHit = detectNetworkRequest(
          capture.network_requests,
          schema.delivery.endpoint_patterns,
        );

        if (!networkHit) {
          gaps.push({
            gap_type: 'MISSING',
            sub_type: 'platform_not_receiving',
            severity: 'critical',
            action_key: expectedEvent.action_key,
            platform,
            expected: `A network request to ${schema.delivery.endpoint_patterns[0]} should be observed`,
            found: `No outbound request to ${platform.toUpperCase()} endpoints was detected`,
            business_impact: `${schema.display_name} is not receiving the event. Even if it fires in your dataLayer, the platform cannot record it.`,
            fix_owner: 'GTM Admin',
            fix_description: `Verify the ${schema.display_name} tag in GTM is set to fire on this trigger`,
            fix_code: buildFixCode(expectedEvent.action_key, platform, 'platform_not_receiving'),
            estimated_effort: 'medium',
          });
        }
      }
    }
  }

  // ── Check platform base tags ──────────────────────────────────────────────
  for (const expectedPlatform of stageSpec.expected_platforms) {
    if (!expectedPlatform.must_detect_tag) continue;
    const schema = getPlatformSchema(expectedPlatform.platform as any);
    if (!schema) continue;

    // Check for the platform's base script in network requests
    const tagLoaded = detectNetworkRequest(
      capture.network_requests,
      schema.detection.script_patterns,
    );

    if (!tagLoaded) {
      gaps.push({
        gap_type: 'MISSING',
        sub_type: 'platform_tag_absent',
        severity: 'critical',
        action_key: 'ad_landing',
        platform: expectedPlatform.platform,
        expected: `The ${schema.display_name} base tag should be loaded on every page`,
        found: `No ${schema.display_name} script was detected loading on this page`,
        business_impact: `${schema.display_name} cannot track any events on this page without its base tag. All conversion tracking is broken here.`,
        fix_owner: 'GTM Admin',
        fix_description: `Add the ${schema.display_name} base tag to your GTM container and ensure it fires on All Pages`,
        fix_code: `// Add ${schema.display_name} base tag via GTM → Tags → New Tag`,
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
