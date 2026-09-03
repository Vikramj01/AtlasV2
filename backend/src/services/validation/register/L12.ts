/**
 * Layer L12 — Hygiene & Integrity (4 of 8 rules — see note below).
 *
 * L12.4/L12.8 need real new capture: dataCapture.ts's interceptConsoleErrors
 * (registered in journeySimulator.ts alongside interceptNetworkRequests)
 * now feeds AuditData.consoleErrors. L12.3/L12.7 reuse data already
 * captured for earlier layers (gtm_script_srcs, NetworkRequest.loadTime).
 *
 * Four rules are excluded:
 *  - L12.1 ("bot and prerender traffic excluded") is labeled Crawl in the
 *    register, but testing it honestly means the site's tracking code
 *    treating THIS crawl as a bot and NOT firing — which would starve
 *    every other layer of the data it depends on. journeySimulator is
 *    deliberately not adversarial toward the site's own bot-detection, so
 *    there is no crawl-safe way to observe this without a second,
 *    deliberately-bot-flagged pass. Same structural gap as L5.8.
 *  - L12.2 ("internal traffic excluded") and L12.6 ("no deprecated API
 *    routes") are Connector-detectable — they live in GA4 admin settings
 *    and platform API version metadata, neither observable from a crawl.
 *  - L12.5 ("conversion survives client-side blocking") is Second-pass
 *    detectable — needs a second crawl with client-side requests blocked
 *    to compare against.
 * All deferred like every other non-crawl (or structurally untestable)
 * method so far. Not included in L12_RULES.
 */
import type { AuditData, ValidationResult, ValidationRule } from '@/types/audit';

/** The last non-init step the crawl visited — the presumed conversion surface. */
function completionStep(auditData: AuditData): string | undefined {
  const steps = (auditData.steps_visited ?? []).filter((s) => s !== 'init');
  return steps[steps.length - 1];
}

// ── L12.3 — No staging or test container in production ───────────────────────
//
// GTM's own preview/debug mode adds gtm_auth/gtm_preview query params to
// the gtm.js loader URL when a non-published environment is what's
// actually live — the one crawl-observable signal that a staging/test
// container is serving in production rather than the live one.

export const NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION: ValidationRule = {
  id: 'L12.3',
  rule_id: 'NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION',
  layer: 'hygiene_integrity',
  check: 'No staging or test container in production',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',

  test(auditData: AuditData): ValidationResult {
    const srcs = (auditData.pageMetadata?.gtm_script_srcs as string[] | undefined) ?? [];
    if (srcs.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No GTM container detected — see GTM_CONTAINER_LOADED (L1.1)',
          expected: 'Container and measurement IDs are the production ones',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const previewSrcs = srcs.filter((s) => s.includes('gtm_preview=') || s.includes('gtm_auth='));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: previewSrcs.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: previewSrcs.length > 0
          ? `GTM Preview/Debug mode is live in production: ${previewSrcs.join(', ')}`
          : 'No GTM preview/debug environment detected — the published container is live',
        expected: 'A test container in production routes real data to nowhere',
        evidence: previewSrcs.length > 0 ? previewSrcs : ['No gtm_preview/gtm_auth params found on the loaded container'],
      },
    };
  },
};

// ── L12.4 — No console errors from measurement code ───────────────────────────

const TRACKING_ERROR_KEYWORDS = [
  'gtag', 'datalayer', 'gtm.js', 'googletagmanager', 'fbq', 'fbevents', 'facebook.net',
  'ttq', 'analytics.tiktok', 'uetq', 'bat.bing', 'lintrk', 'google-analytics',
];

export const NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE: ValidationRule = {
  id: 'L12.4',
  rule_id: 'NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE',
  layer: 'hygiene_integrity',
  check: 'No console errors from measurement code',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    if (auditData.consoleErrors === undefined) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'Console error capture did not run for this audit',
          expected: 'Tag-related JavaScript errors are absent',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const trackingErrors = auditData.consoleErrors.filter((e) =>
      TRACKING_ERROR_KEYWORDS.some((k) => e.message.toLowerCase().includes(k)),
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: trackingErrors.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: trackingErrors.length > 0
          ? `${trackingErrors.length} console error(s) referencing measurement code`
          : 'No console errors referencing measurement code',
        expected: 'A failing tag reports as absent rather than as broken',
        evidence: trackingErrors.length > 0
          ? trackingErrors.map((e) => `[${e.step}] ${e.message}`)
          : ['No tracking-related console errors found'],
      },
    };
  },
};

// ── L12.7 — Tag load does not materially delay the page ──────────────────────

const SLOW_LOAD_THRESHOLD_MS = 2000;

export const TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE: ValidationRule = {
  id: 'L12.7',
  rule_id: 'TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE',
  layer: 'hygiene_integrity',
  check: 'Tag load does not materially delay the page',
  severity: 'low',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const timed = auditData.networkRequests.filter((r) => r.loadTime !== undefined);
    if (timed.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No tracking request load times were captured',
          expected: 'Measurement code is not blocking rendering',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const slow = timed.filter((r) => (r.loadTime as number) > SLOW_LOAD_THRESHOLD_MS);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: slow.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: slow.length > 0
          ? `${slow.length} tracking request(s) took longer than ${SLOW_LOAD_THRESHOLD_MS}ms to load`
          : `All tracking requests loaded within ${SLOW_LOAD_THRESHOLD_MS}ms`,
        expected: 'A tag that times out on slow connections is a tag that does not fire',
        evidence: slow.map((r) => `${r.url}: ${r.loadTime}ms`),
      },
    };
  },
};

// ── L12.8 — Conversion surface reachable without JavaScript errors ───────────

export const CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS: ValidationRule = {
  id: 'L12.8',
  rule_id: 'CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS',
  layer: 'hygiene_integrity',
  check: 'Conversion surface reachable without JavaScript errors',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',

  test(auditData: AuditData): ValidationResult {
    const completion = completionStep(auditData);

    if (auditData.consoleErrors === undefined || !completion) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: auditData.consoleErrors === undefined ? 'Console error capture did not run for this audit' : 'No completion step identified',
          expected: 'The confirmation state renders reliably',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const errorsAtCompletion = auditData.consoleErrors.filter((e) => e.step === completion);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: errorsAtCompletion.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: errorsAtCompletion.length > 0
          ? `${errorsAtCompletion.length} JavaScript error(s) on the conversion surface ("${completion}")`
          : `No JavaScript errors on the conversion surface ("${completion}")`,
        expected: 'An intermittently failing confirmation page is an intermittently failing conversion',
        evidence: errorsAtCompletion.length > 0 ? errorsAtCompletion.map((e) => e.message) : ['No errors found on the completion step'],
      },
    };
  },
};

export const L12_RULES: ValidationRule[] = [
  NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION,
  NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE,
  TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE,
  CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS,
];
