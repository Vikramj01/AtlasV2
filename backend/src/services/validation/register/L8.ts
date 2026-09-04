/**
 * Layer L8 — Consent (3 rules).
 *
 * The first scored rules for this layer — previously zero (Site Evaluation
 * Coverage & Honesty PRD §11, defect #8) — unblocked by Phase 1's consent
 * banner handling (services/detection/consentBanner.ts, journeySimulator.ts's
 * landing-step wiring), which populates AuditData.consent_capture:
 * banner_present, vendor, dismissed, declared_cmp, tags_before, tags_after.
 *
 * All three rules read consent_capture directly; none require a second
 * crawl pass. A genuinely deeper consent audit (does declining consent
 * actually suppress tags, per-purpose granularity, IAB TCF string
 * validity) is Second-pass/Credentials detectable and out of scope here,
 * same as every other deferred rule in this register.
 */
import type { AuditData, ValidationRule, ValidationResult } from '@/types/audit';
import { PLATFORM_LABELS } from './platformDetection';

const REGULATED_TRAFFIC_REGIONS = ['eea', 'uk', 'switzerland'] as const;

// ── L8.1 — Consent banner present when required ──────────────────────────────
//
// "Required" here means either the site declared a CMP (Scan Input `cmp`,
// not 'none') or declared EEA/UK/Switzerland traffic — both are the
// advertiser telling Atlas a consent banner should exist. A US-only site
// with no declared CMP has no expectation here and this rule skips.

export const CONSENT_BANNER_PRESENT_WHEN_REQUIRED: ValidationRule = {
  id: 'L8.1',
  rule_id: 'CONSENT_BANNER_PRESENT_WHEN_REQUIRED',
  layer: 'consent',
  check: 'Consent banner present when required',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: 'Install a consent management platform (OneTrust, Cookiebot, Usercentrics, or a custom banner) on the landing page — a declared CMP or EEA/UK/Switzerland traffic both mean visitors need to see a consent choice before marketing tags fire.',

  test(auditData: AuditData): ValidationResult {
    const capture = auditData.consent_capture;
    const declaredCmp = auditData.cmp;
    const hasRegulatedTraffic = (auditData.traffic_regions ?? []).some((r) =>
      (REGULATED_TRAFFIC_REGIONS as readonly string[]).includes(r),
    );
    const required = (!!declaredCmp && declaredCmp !== 'none') || hasRegulatedTraffic;

    if (!capture) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'Consent handling was not attempted for this run',
          expected: 'A consent banner is present when a CMP is declared or EEA/UK/Switzerland traffic is declared',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    if (!required) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No CMP declared and no EEA/UK/Switzerland traffic declared — a consent banner is not expected',
          expected: 'A consent banner is present when a CMP is declared or EEA/UK/Switzerland traffic is declared',
          evidence: ['Rule skipped — nothing requires a banner here'],
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: capture.banner_present ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: capture.banner_present
          ? `Consent banner detected${capture.vendor ? ` (${capture.vendor})` : ''}`
          : 'No consent banner was detected on the landing page',
        expected: 'A consent banner is present when a CMP is declared or EEA/UK/Switzerland traffic is declared',
        evidence: [
          `Declared CMP: ${declaredCmp ?? 'none'}`,
          `Declared regulated traffic: ${hasRegulatedTraffic}`,
          `Banner detected: ${capture.banner_present}`,
        ],
      },
    };
  },
};

// ── L8.2 — Declared CMP matches the detected vendor ───────────────────────────

export const DECLARED_CMP_MATCHES_DETECTED_VENDOR: ValidationRule = {
  id: 'L8.2',
  rule_id: 'DECLARED_CMP_MATCHES_DETECTED_VENDOR',
  layer: 'consent',
  check: 'Declared CMP matches the detected vendor',
  severity: 'low',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: (result) => {
    const declaredLine = result.technical_details.evidence.find((e) => e.startsWith('Declared:'));
    const detectedLine = result.technical_details.evidence.find((e) => e.startsWith('Detected:'));
    const declared = declaredLine ? declaredLine.replace('Declared: ', '') : 'the declared CMP';
    const detected = detectedLine ? detectedLine.replace('Detected: ', '') : 'the site\'s actual CMP';
    return `Update Scan Inputs' declared CMP to match what's actually live (${detected}), or correct the CMP configuration if ${declared} was meant to be installed. A mismatch here is usually a stale Scan Inputs value after a CMP migration, not a broken banner.`;
  },

  test(auditData: AuditData): ValidationResult {
    const capture = auditData.consent_capture;
    const declaredCmp = auditData.cmp;

    if (!capture || !capture.banner_present) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: !capture ? 'Consent handling was not attempted for this run' : 'No consent banner was detected — nothing to compare against',
          expected: 'The declared CMP Scan Input matches the vendor actually detected on the site',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    if (!declaredCmp || declaredCmp === 'none') {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No CMP was declared in Scan Inputs — nothing to compare the detected vendor against',
          expected: 'The declared CMP Scan Input matches the vendor actually detected on the site',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    // 'custom' is a deliberate catch-all — any detected vendor satisfies it,
    // since detectConsentBanner falls back to 'custom' for anything matched
    // only by text (not one of the known-vendor selectors) rather than
    // guessing a specific vendor identity from generic "Accept all" text.
    const matches = declaredCmp === 'custom' || capture.vendor === declaredCmp;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: matches ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: matches
          ? `Detected vendor (${capture.vendor ?? 'custom'}) matches the declared CMP (${declaredCmp})`
          : `Declared CMP is "${declaredCmp}" but the detected vendor is "${capture.vendor ?? 'unknown'}"`,
        expected: 'The declared CMP Scan Input matches the vendor actually detected on the site',
        evidence: [`Declared: ${declaredCmp}`, `Detected: ${capture.vendor ?? 'unknown'}`],
      },
    };
  },
};

// ── L8.3 — No declared platform tags fire before consent ─────────────────────
//
// The compliance-critical check in this layer: a declared platform's tag
// firing before the visitor has made a consent decision is a live GDPR/CCPA
// exposure, not just a data-quality issue. Reads the tags_before/tags_after
// delta consent_capture records around the landing-step dismissal.

export const NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT: ValidationRule = {
  id: 'L8.3',
  rule_id: 'NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT',
  layer: 'consent',
  check: 'No declared platform tags fire before consent',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'n/a',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  remediation: (result) => {
    const firedLine = result.technical_details.evidence.find((e) => e.startsWith('Fired pre-consent:'));
    const fired = firedLine ? firedLine.replace('Fired pre-consent: ', '') : 'the affected platform(s)';
    return `Add consent-gating to the ${fired} tag(s) in GTM — require ad_storage and ad_user_data (for marketing pixels) or analytics_storage (for GA4) before they're allowed to fire. This is a live compliance violation under GDPR/ePrivacy, not just a data-quality issue.`;
  },

  test(auditData: AuditData): ValidationResult {
    const capture = auditData.consent_capture;
    const declared = auditData.declared_platforms ?? [];

    if (!capture || !capture.banner_present) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: !capture ? 'Consent handling was not attempted for this run' : 'No consent banner was detected — nothing gates tags here',
          expected: 'None of the declared platforms\' tags fire before the visitor grants consent',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    if (declared.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No platforms declared in Scan Inputs',
          expected: 'None of the declared platforms\' tags fire before the visitor grants consent',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const firedBeforeConsent = declared.filter((p) => capture.tags_before.includes(p));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: firedBeforeConsent.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: firedBeforeConsent.length > 0
          ? `${firedBeforeConsent.length} declared platform tag(s) fired before consent: ${firedBeforeConsent.map((p) => PLATFORM_LABELS[p]).join(', ')}`
          : 'No declared platform tags fired before the visitor granted consent',
        expected: 'None of the declared platforms\' tags fire before the visitor grants consent',
        evidence: [
          `Declared platforms: ${declared.map((p) => PLATFORM_LABELS[p]).join(', ')}`,
          `Fired pre-consent: ${firedBeforeConsent.length > 0 ? firedBeforeConsent.map((p) => PLATFORM_LABELS[p]).join(', ') : 'none'}`,
        ],
      },
    };
  },
};

export const L8_RULES: ValidationRule[] = [
  CONSENT_BANNER_PRESENT_WHEN_REQUIRED,
  DECLARED_CMP_MATCHES_DETECTED_VENDOR,
  NO_DECLARED_PLATFORM_TAGS_FIRE_BEFORE_CONSENT,
];
