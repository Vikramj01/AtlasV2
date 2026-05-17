/**
 * IHC (Implementation Health Check) Rule Correctness Tests
 *
 * Tests rules from backend/src/services/validation/tagConfiguration.ts.
 *
 * Rule inventory (11 total):
 *
 * Phase A (7 rules):
 *   5.1  CUSTOM_HTML_TAG_DETECTED           — counts 'html' type tags; 0=pass, 1–3=warn, >3=fail
 *   5.2  CUSTOM_HTML_TAG_BYPASSES_CONSENT   — html tags with tracking patterns & no NEEDED consent
 *   5.3  CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA — tracking html tags with literal IDs / values
 *   5.4  HARDCODED_VALUE_IN_TAG_CONFIG      — conversion tags with literal 'value' param
 *   5.5  HARDCODED_CURRENCY_IN_TAG_CONFIG   — conversion tags with literal 'currency' param (→ warn)
 *   5.6  HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG — any tag with literal transactionId/orderId
 *   5.7  DUPLICATE_TAG_CONFIGURATION        — duplicate (type+convId+event) without event_id
 *
 * Phase B (4 rules):
 *   5.8  CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG — MARKETING_TAG_TYPES with consentStatus NOT_SET
 *   5.9  CONSENT_TYPE_MISMATCH              — ad tags missing ad_storage/ad_user_data etc.
 *   5.10 DEFAULT_CONSENT_GRANTED_GLOBALLY   — consent_default_tag has sensitive type defaulting to granted
 *   5.11 FRAGILE_CSS_SELECTOR_TRIGGER       — conversion tags firing on CSS selector triggers
 *
 * Signature check:
 *   Every rule's test() method accepts (auditData: AuditData).
 *   AuditData.gtmContainer is a GTMContainerSnapshot | undefined.
 *   This is correct — rules self-guard with `if (!auditData.gtmContainer) return skippedResult(...)`.
 *   No rule receives a "baseline" separately; drift rules live in implementation_drift layer
 *   and use AuditData.baselineAuditData. The tag_configuration rules tested here do NOT need a baseline.
 */

import { describe, it, expect } from 'vitest';
import {
  // GA4 config tag rule (representative for "GA4 container presence")
  CUSTOM_HTML_TAG_DETECTED,
  CUSTOM_HTML_TAG_BYPASSES_CONSENT,
  CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG,
} from '../../../backend/src/services/validation/tagConfiguration';
import type { AuditData, GTMContainerSnapshot, GTMTag } from '../../../backend/src/types/audit';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAuditData(gtmContainer?: GTMContainerSnapshot): AuditData {
  return {
    audit_id: 'test-audit',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'global',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: 'gclid_test', fbclid: 'fbclid_test' },
    gtmContainer,
  };
}

function makeContainer(overrides?: Partial<GTMContainerSnapshot>): GTMContainerSnapshot {
  return {
    container_id: 'GTM-TEST',
    fetched_at: new Date().toISOString(),
    source: 'manual_upload',
    tags: [],
    triggers: [],
    variables: [],
    built_in_variables: [],
    consent_default_tag: null,
    ...overrides,
  };
}

function makeTag(overrides: Partial<GTMTag> & { tagId: string; name: string; type: string }): GTMTag {
  return {
    firingTriggerId: ['trigger-1'],
    ...overrides,
  };
}

// ── Rule 1: GA4 config tag presence (represented via CUSTOM_HTML_TAG_DETECTED) ──

/**
 * There is no dedicated "GA4 config tag present" rule in tagConfiguration.ts.
 * The closest representation in Phase A is rule 5.1 CUSTOM_HTML_TAG_DETECTED,
 * which fires on 'html' type tags. Rule 5.8 CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG
 * is the gating mechanism that would catch a 'gaawc' (GA4 Config) tag without consent.
 *
 * We test 5.1 as the "custom HTML / non-template tag detected" proxy for improper GA4
 * implementations (where GA4 is loaded via raw html rather than the native gaawc template).
 */
describe('Rule 5.1 — CUSTOM_HTML_TAG_DETECTED (GA4 custom HTML proxy)', () => {
  it('passes when container has no html-type tags', () => {
    const container = makeContainer({
      tags: [makeTag({ tagId: '1', name: 'GA4 Config', type: 'gaawc' })],
    });
    const result = CUSTOM_HTML_TAG_DETECTED.test(makeAuditData(container));
    expect(result.status).toBe('pass');
  });

  it('warns when container has 1–3 custom HTML tags', () => {
    const container = makeContainer({
      tags: [makeTag({ tagId: '2', name: 'Legacy GA via HTML', type: 'html' })],
    });
    const result = CUSTOM_HTML_TAG_DETECTED.test(makeAuditData(container));
    expect(result.status).toBe('warning');
  });

  it('fails when container has more than 3 custom HTML tags', () => {
    const container = makeContainer({
      tags: [
        makeTag({ tagId: '3', name: 'HTML1', type: 'html' }),
        makeTag({ tagId: '4', name: 'HTML2', type: 'html' }),
        makeTag({ tagId: '5', name: 'HTML3', type: 'html' }),
        makeTag({ tagId: '6', name: 'HTML4', type: 'html' }),
      ],
    });
    const result = CUSTOM_HTML_TAG_DETECTED.test(makeAuditData(container));
    expect(result.status).toBe('fail');
  });

  it('returns skipped when no gtmContainer is provided', () => {
    const result = CUSTOM_HTML_TAG_DETECTED.test(makeAuditData(undefined));
    expect(result.status).toBe('skipped');
  });
});

// ── Rule 2: Consent — tags with no consent settings fire tracking code ────────

describe('Rule 5.2 — CUSTOM_HTML_TAG_BYPASSES_CONSENT', () => {
  it('fails when an html tag fires gtag() without NEEDED consent', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '10',
          name: 'GA Conversion Tag',
          type: 'html',
          parameter: [{ type: 'TEMPLATE', key: 'html', value: '<script>gtag("event", "purchase")</script>' }],
          // No consentSettings → consentSettings is undefined
        }),
      ],
    });
    const result = CUSTOM_HTML_TAG_BYPASSES_CONSENT.test(makeAuditData(container));
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence[0]).toMatch(/without consent gating/);
  });

  it('passes when an html tag fires gtag() but has NEEDED consent gating', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '11',
          name: 'GA Conversion Tag — Consented',
          type: 'html',
          parameter: [{ type: 'TEMPLATE', key: 'html', value: '<script>gtag("event", "purchase")</script>' }],
          consentSettings: { consentStatus: 'NEEDED', consentType: ['ad_storage', 'ad_user_data'] },
        }),
      ],
    });
    const result = CUSTOM_HTML_TAG_BYPASSES_CONSENT.test(makeAuditData(container));
    expect(result.status).toBe('pass');
  });

  it('passes when html tag has no tracking patterns (plain utility script)', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '12',
          name: 'Utility Script',
          type: 'html',
          parameter: [{ type: 'TEMPLATE', key: 'html', value: '<script>console.log("hello")</script>' }],
          // No consent settings — but no tracking patterns either, so it should pass
        }),
      ],
    });
    const result = CUSTOM_HTML_TAG_BYPASSES_CONSENT.test(makeAuditData(container));
    expect(result.status).toBe('pass');
  });

  it('fires on fbq() as well as gtag()', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '13',
          name: 'Meta Pixel Custom',
          type: 'html',
          parameter: [{ type: 'TEMPLATE', key: 'html', value: '<script>fbq("track", "Purchase")</script>' }],
          // No consent settings
        }),
      ],
    });
    const result = CUSTOM_HTML_TAG_BYPASSES_CONSENT.test(makeAuditData(container));
    expect(result.status).toBe('fail');
  });

  it('returns skipped when no gtmContainer is provided', () => {
    const result = CUSTOM_HTML_TAG_BYPASSES_CONSENT.test(makeAuditData(undefined));
    expect(result.status).toBe('skipped');
  });
});

// ── Rule 3 (Phase B): Marketing tags without consent settings ─────────────────

describe('Rule 5.8 — CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG', () => {
  it('fails when a Google Ads tag (awct) has no consent settings at all', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '20',
          name: 'Google Ads Conversion',
          type: 'awct',
          // No consentSettings
        }),
      ],
    });
    const result = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(makeAuditData(container));
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence[0]).toMatch(/no consent requirements configured/);
  });

  it('fails when a GA4 event tag has consentStatus NOT_SET', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '21',
          name: 'GA4 Event',
          type: 'ga4_event',
          consentSettings: { consentStatus: 'NOT_SET' },
        }),
      ],
    });
    const result = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(makeAuditData(container));
    expect(result.status).toBe('fail');
  });

  it('passes when a marketing tag has NEEDED consent configured', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '22',
          name: 'Meta Pixel',
          type: 'fbt',
          consentSettings: { consentStatus: 'NEEDED', consentType: ['ad_storage', 'ad_user_data'] },
        }),
      ],
    });
    const result = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(makeAuditData(container));
    expect(result.status).toBe('pass');
  });

  it('passes when a marketing tag has NOT_NEEDED consent status (explicitly opted out)', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '23',
          name: 'GA4 Config',
          type: 'gaawc',
          consentSettings: { consentStatus: 'NOT_NEEDED' },
        }),
      ],
    });
    const result = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(makeAuditData(container));
    expect(result.status).toBe('pass');
  });

  it('does not flag non-marketing tag types', () => {
    const container = makeContainer({
      tags: [
        makeTag({
          tagId: '24',
          name: 'Custom Scroll Depth',
          type: 'scroll_depth', // not in MARKETING_TAG_TYPES
          // No consentSettings
        }),
      ],
    });
    const result = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(makeAuditData(container));
    expect(result.status).toBe('pass');
  });

  it('returns skipped when no gtmContainer is provided', () => {
    const result = CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG.test(makeAuditData(undefined));
    expect(result.status).toBe('skipped');
  });
});

// ── Drift rule: implementation_drift is in a separate layer ──────────────────
//
// The tagConfiguration.ts file does NOT contain a drift/baseline comparison rule.
// Drift logic resides in the `implementation_drift` validation layer and uses
// AuditData.baselineAuditData vs current crawlSignals.
//
// The following test documents this architectural separation and verifies that
// the tag_configuration rules correctly return 'skipped' for missing data,
// never 'pass' with a false negative.

describe('Drift boundary — tag_configuration rules skip when container absent', () => {
  const allRules = [CUSTOM_HTML_TAG_DETECTED, CUSTOM_HTML_TAG_BYPASSES_CONSENT, CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG];

  for (const rule of allRules) {
    it(`${rule.rule_id} returns skipped when gtmContainer is undefined`, () => {
      const result = rule.test(makeAuditData(undefined));
      expect(result.status).toBe('skipped');
      // Should never silently pass — skipped is the only acceptable fallback
      expect(result.status).not.toBe('pass');
    });
  }
});
