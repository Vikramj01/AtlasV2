/**
 * Layer L8 — Consent rule tests.
 *
 * The first scored rules for this layer (Site Evaluation Coverage &
 * Honesty PRD §11) — reads AuditData.consent_capture, populated by Phase
 * 1's consent banner handling (journeySimulator.ts's landing-step wiring).
 */
import { describe, it, expect } from 'vitest';
import {
  CONSENT_BANNER_PRESENT_WHEN_REQUIRED,
  DECLARED_CMP_MATCHES_DETECTED_VENDOR,
  NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT,
  L8_RULES,
} from '../L8';
import type { AuditData, ConsentCapture } from '@/types/audit';

function makeCapture(overrides: Partial<ConsentCapture> = {}): ConsentCapture {
  return {
    banner_present: true,
    dismissed: true,
    tags_before: [],
    tags_after: [],
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
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L8.1 — Consent banner present when required ─────────────────────────────

describe('CONSENT_BANNER_PRESENT_WHEN_REQUIRED (L8.1)', () => {
  it('is skipped when consent handling was never attempted', () => {
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when no CMP is declared and no regulated traffic is declared', () => {
    const auditData = makeAuditData({ consent_capture: makeCapture({ banner_present: false }), traffic_regions: ['us'] });
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(auditData).status).toBe('skipped');
  });

  it('passes when a CMP is declared and a banner was detected', () => {
    const auditData = makeAuditData({ cmp: 'onetrust', consent_capture: makeCapture({ banner_present: true, vendor: 'onetrust' }) });
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(auditData).status).toBe('pass');
  });

  it('fails when a CMP is declared but no banner was detected', () => {
    const auditData = makeAuditData({ cmp: 'onetrust', consent_capture: makeCapture({ banner_present: false }) });
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(auditData).status).toBe('fail');
  });

  it('fails when EEA traffic is declared but no CMP and no banner is present', () => {
    const auditData = makeAuditData({ traffic_regions: ['eea'], consent_capture: makeCapture({ banner_present: false }) });
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(auditData).status).toBe('fail');
  });

  it('passes when UK traffic is declared and a banner was detected, even with no CMP declared', () => {
    const auditData = makeAuditData({ traffic_regions: ['uk'], consent_capture: makeCapture({ banner_present: true }) });
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(auditData).status).toBe('pass');
  });

  it('does not require a banner for a declared cmp of "none"', () => {
    const auditData = makeAuditData({ cmp: 'none', traffic_regions: ['us'], consent_capture: makeCapture({ banner_present: false }) });
    expect(CONSENT_BANNER_PRESENT_WHEN_REQUIRED.test(auditData).status).toBe('skipped');
  });
});

// ── L8.2 — Declared CMP matches the detected vendor ──────────────────────────

describe('DECLARED_CMP_MATCHES_DETECTED_VENDOR (L8.2)', () => {
  it('is skipped when consent handling was never attempted', () => {
    expect(DECLARED_CMP_MATCHES_DETECTED_VENDOR.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when no banner was detected', () => {
    const auditData = makeAuditData({ cmp: 'onetrust', consent_capture: makeCapture({ banner_present: false }) });
    expect(DECLARED_CMP_MATCHES_DETECTED_VENDOR.test(auditData).status).toBe('skipped');
  });

  it('is skipped when no CMP was declared', () => {
    const auditData = makeAuditData({ consent_capture: makeCapture({ banner_present: true, vendor: 'onetrust' }) });
    expect(DECLARED_CMP_MATCHES_DETECTED_VENDOR.test(auditData).status).toBe('skipped');
  });

  it('passes when the detected vendor matches the declared CMP', () => {
    const auditData = makeAuditData({ cmp: 'cookiebot', consent_capture: makeCapture({ banner_present: true, vendor: 'cookiebot' }) });
    expect(DECLARED_CMP_MATCHES_DETECTED_VENDOR.test(auditData).status).toBe('pass');
  });

  it('fails when the detected vendor differs from the declared CMP', () => {
    const auditData = makeAuditData({ cmp: 'onetrust', consent_capture: makeCapture({ banner_present: true, vendor: 'cookiebot' }) });
    expect(DECLARED_CMP_MATCHES_DETECTED_VENDOR.test(auditData).status).toBe('fail');
  });

  it('always passes for a declared CMP of "custom" — no specific vendor to mismatch against', () => {
    const auditData = makeAuditData({ cmp: 'custom', consent_capture: makeCapture({ banner_present: true, vendor: 'onetrust' }) });
    expect(DECLARED_CMP_MATCHES_DETECTED_VENDOR.test(auditData).status).toBe('pass');
  });
});

// ── L8.3 — No declared platform tags fire before consent ─────────────────────

describe('NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT (L8.3)', () => {
  it('is skipped when consent handling was never attempted', () => {
    expect(NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT.test(makeAuditData()).status).toBe('skipped');
  });

  it('is skipped when no banner was detected', () => {
    const auditData = makeAuditData({ consent_capture: makeCapture({ banner_present: false }) });
    expect(NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT.test(auditData).status).toBe('skipped');
  });

  it('is skipped when no platforms are declared', () => {
    const auditData = makeAuditData({ declared_platforms: [], consent_capture: makeCapture() });
    expect(NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT.test(auditData).status).toBe('skipped');
  });

  it('passes when no declared platform tag fired before consent', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads', 'meta'],
      consent_capture: makeCapture({ tags_before: [], tags_after: ['google_ads', 'meta'] }),
    });
    expect(NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT.test(auditData).status).toBe('pass');
  });

  it('passes when only an undeclared platform fired before consent', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads'],
      consent_capture: makeCapture({ tags_before: ['tiktok'] }), // tiktok isn't declared — not this rule's concern
    });
    expect(NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT.test(auditData).status).toBe('pass');
  });

  it('fails when a declared platform tag fired before consent — the compliance-critical case', () => {
    const auditData = makeAuditData({
      declared_platforms: ['google_ads', 'meta'],
      consent_capture: makeCapture({ tags_before: ['google_ads'] }),
    });
    const result = NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT.test(auditData);
    expect(result.status).toBe('fail');
    expect(result.technical_details.found).toContain('Google Ads');
  });
});

describe('L8_RULES', () => {
  it('exports all 3 L8 rules', () => {
    expect(L8_RULES).toHaveLength(3);
    expect(new Set(L8_RULES.map((r) => r.id)).size).toBe(3);
    expect(new Set(L8_RULES.map((r) => r.rule_id)).size).toBe(3);
  });

  it('every rule declares layer "consent"', () => {
    expect(L8_RULES.every((r) => r.layer === 'consent')).toBe(true);
  });
});
