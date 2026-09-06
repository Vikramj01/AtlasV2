/**
 * Layer L12 — Hygiene & Integrity rule tests.
 *
 * Covers each of the 4 crawl-detectable rules' pass/fail/skipped
 * branches. L12.1 (structurally untestable without an adversarial
 * bot-detection pass), L12.2/L12.6 (connector detectable), and L12.5
 * (second-pass detectable) are out of scope for this phase — not tested
 * here because they aren't shipped.
 */
import { describe, it, expect } from 'vitest';
import {
  NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION,
  NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE,
  TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE,
  CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS,
  L12_RULES,
} from '../L12';
import type { AuditData, NetworkRequest, ConsoleError } from '@/types/audit';

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://example.com/whatever',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    step: 'landing',
    ...overrides,
  };
}

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'audit-1',
    website_url: 'https://example.com',
    funnel_type: 'saas',
    region: 'us',
    rule_set_version: 'v2',
    site_type: 'plg_saas',
    declared_platforms: ['google_ads', 'meta'],
    steps_visited: ['init', 'landing', 'confirmation'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L12.3 — No staging or test container in production ───────────────────────

describe('NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION (L12.3)', () => {
  it('is skipped when no GTM container was detected', () => {
    expect(NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the published (non-preview) container is live', () => {
    const auditData = makeAuditData({ pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'] } });
    expect(NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION.test(auditData).status).toBe('pass');
  });

  it('fails when GTM Preview/Debug mode is live', () => {
    const auditData = makeAuditData({
      pageMetadata: { gtm_script_srcs: ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC123&gtm_auth=abc&gtm_preview=env-4&gtm_cookies_win=x'] },
    });
    expect(NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION.test(auditData).status).toBe('fail');
  });
});

// ── L12.4 — No console errors from measurement code ───────────────────────────

describe('NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE (L12.4)', () => {
  it('is skipped when console capture never ran', () => {
    expect(NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when there are no console errors at all', () => {
    const auditData = makeAuditData({ consoleErrors: [] });
    expect(NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE.test(auditData).status).toBe('pass');
  });

  it('passes when console errors exist but none reference tracking code', () => {
    const errors: ConsoleError[] = [{ message: 'Failed to load resource: styles.css', step: 'landing' }];
    const auditData = makeAuditData({ consoleErrors: errors });
    expect(NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE.test(auditData).status).toBe('pass');
  });

  it('fails when a console error references measurement code', () => {
    const errors: ConsoleError[] = [{ message: 'Uncaught TypeError: gtag is not a function', step: 'landing' }];
    const auditData = makeAuditData({ consoleErrors: errors });
    expect(NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE.test(auditData).status).toBe('fail');
  });

  // Report Correctness Programme PRD Part C5 — a tracking-keyword match
  // from inside a cross-origin ad/consent iframe's own script (e.g. an ad
  // network's own script mentioning "google-analytics.com") is ambient
  // noise, not evidence the SITE's measurement code errored.
  it('passes when a tracking-keyword-matching error originates in a cross-origin iframe', () => {
    const auditData = makeAuditData({
      website_url: 'https://example.com',
      consoleErrors: [{ message: 'gtag config failed inside ad frame', step: 'landing', frame_url: 'https://ads.example-network.com/tag.js' }],
    });
    expect(NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE.test(auditData).status).toBe('pass');
  });

  it('still fails when the same-origin script throws a tracking-keyword-matching error', () => {
    const auditData = makeAuditData({
      website_url: 'https://example.com',
      consoleErrors: [{ message: 'Uncaught TypeError: gtag is not a function', step: 'landing', frame_url: 'https://example.com/site.js' }],
    });
    expect(NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE.test(auditData).status).toBe('fail');
  });
});

// ── L12.7 — Tag load does not materially delay the page ──────────────────────

describe('TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE (L12.7)', () => {
  it('is skipped when no request load times were captured', () => {
    expect(TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when all tracking requests load quickly', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ loadTime: 350 })] });
    expect(TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE.test(auditData).status).toBe('pass');
  });

  it('fails when a tracking request takes too long to load', () => {
    const auditData = makeAuditData({ networkRequests: [makeRequest({ loadTime: 4000 })] });
    expect(TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE.test(auditData).status).toBe('fail');
  });
});

// ── L12.8 — Conversion surface reachable without JavaScript errors ───────────

describe('CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS (L12.8)', () => {
  it('is skipped when console capture never ran', () => {
    expect(CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when there are no errors on the completion step', () => {
    const auditData = makeAuditData({ consoleErrors: [{ message: 'unrelated error', step: 'landing' }] });
    expect(CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS.test(auditData).status).toBe('pass');
  });

  it('fails when there is an error on the completion step', () => {
    const auditData = makeAuditData({ consoleErrors: [{ message: 'ReferenceError: foo is not defined', step: 'confirmation' }] });
    expect(CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS.test(auditData).status).toBe('fail');
  });

  // Report Correctness Programme PRD Part C5 — Birkenstock audit 13795830's
  // 15 "JavaScript errors on the conversion surface" were sandboxed
  // `about:blank` ad/consent iframes, not site defects; filtered by frame
  // origin, not by error text (a text denylist requires perpetual
  // maintenance and fails silently on every new browser warning shape).
  it('passes when every completion-step error originates in a sandboxed/cross-origin iframe', () => {
    const auditData = makeAuditData({
      website_url: 'https://birkenstock.com',
      consoleErrors: [
        { message: 'Permissions-Policy header contains errors', step: 'confirmation', frame_url: 'about:blank' },
        { message: 'Uncaught SyntaxError in ad script', step: 'confirmation', frame_url: 'https://consent-vendor.example/widget.js' },
      ],
    });
    expect(CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS.test(auditData).status).toBe('pass');
  });

  it('still fails when a same-origin (top-document) error occurs alongside ambient iframe noise', () => {
    const auditData = makeAuditData({
      website_url: 'https://birkenstock.com',
      consoleErrors: [
        { message: 'Permissions-Policy header contains errors', step: 'confirmation', frame_url: 'about:blank' },
        { message: 'Uncaught TypeError: dataLayer.push is not a function', step: 'confirmation', frame_url: 'https://birkenstock.com/main.js' },
      ],
    });
    const result = CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence).toHaveLength(1);
    expect(result.technical_details.evidence[0]).toContain('dataLayer.push');
  });

  it('keeps an error with no frame_url — unknown origin is never proof of a cross-origin iframe', () => {
    const auditData = makeAuditData({ consoleErrors: [{ message: 'unattributed error', step: 'confirmation' }] });
    expect(CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS.test(auditData).status).toBe('fail');
  });
});

describe('L12_RULES', () => {
  it('exports all 4 crawl-detectable L12 rules', () => {
    expect(L12_RULES).toHaveLength(4);
    expect(new Set(L12_RULES.map((r) => r.id)).size).toBe(4);
    expect(new Set(L12_RULES.map((r) => r.rule_id)).size).toBe(4);
  });

  it('excludes the 4 non-crawl or structurally untestable rules (L12.1, L12.2, L12.5, L12.6)', () => {
    expect(L12_RULES.some((r) => ['L12.1', 'L12.2', 'L12.5', 'L12.6'].includes(r.id))).toBe(false);
  });
});
