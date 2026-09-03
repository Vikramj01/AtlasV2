/**
 * Layer L7 — Identity & Match Quality (11 of 12 rules — see note on L7.12
 * below).
 *
 * L6 asked what's on the conversion event. This layer asks specifically
 * about the identity fields on it: are they present where they matter,
 * normalised and hashed correctly, and — the other direction — never
 * leaked anywhere in the clear. Reads DataLayerEvent.user_data (email/
 * phone plus whatever else a site's own push includes, via its index
 * signature) and scans networkRequests/URLs for plaintext PII shapes.
 *
 * L7.12 ("match keys present at conversion, not only at signup") needs an
 * authenticated app session to observe identity fields collected earlier
 * in a real login flow — Credentials-detectable, deferred like every
 * other non-crawl method so far. Not included in L7_RULES.
 */
import type { AuditData, ValidationResult, ValidationRule, DataLayerEvent, NetworkRequest } from '@/types/audit';

const FALLBACK_CONVERSION_EVENT_NAMES = ['purchase', 'generate_lead', 'sign_up', 'conversion', 'submit_lead_form', 'begin_checkout', 'add_payment_info'];

function primaryConversionName(auditData: AuditData): string | undefined {
  return auditData.declared_conversions?.find((c) => c.kind === 'primary')?.name;
}

function conversionEvents(auditData: AuditData): DataLayerEvent[] {
  const name = primaryConversionName(auditData);
  if (name) return auditData.dataLayer.filter((e) => e.event === name);
  return auditData.dataLayer.filter((e) => FALLBACK_CONVERSION_EVENT_NAMES.includes(e.event));
}

function userDataField(event: DataLayerEvent, key: string): string | undefined {
  const v = event.user_data?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** True for any dataLayer event in the whole journey (not just the conversion) — used by the "where collected" rules to tell "never collected" apart from "collected but dropped by conversion". */
function anyEventHasUserDataField(auditData: AuditData, keys: string[]): boolean {
  return auditData.dataLayer.some((e) => keys.some((k) => userDataField(e, k) !== undefined));
}

function conversionHasUserDataField(auditData: AuditData, keys: string[]): boolean {
  return conversionEvents(auditData).some((e) => keys.some((k) => userDataField(e, k) !== undefined));
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

function looksHashed(value: string): boolean {
  return HASH_PATTERN.test(value);
}

function skippedNoConversion(rule: ValidationRule, expected: string): ValidationResult {
  return {
    rule_id: rule.rule_id,
    validation_layer: rule.layer,
    status: 'skipped',
    severity: rule.severity,
    technical_details: {
      found: 'No conversion event was observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)',
      expected,
      evidence: ['Rule skipped — nothing to check'],
    },
  };
}

// ── L7.1 / L7.2 — Email captured for Enhanced Conversions / CAPI ─────────────
//
// Same underlying observable (a plain or pre-hashed email accompanies the
// conversion) checked against two different platform_scope groups, per
// the register's own split between Google Ads' Enhanced Conversions and
// Meta/TikTok's CAPI.

function makeEmailCapturedRule(id: string, ruleId: string, check: string, platformScope: ValidationRule['platform_scope'], why: string): ValidationRule {
  return {
    id,
    rule_id: ruleId,
    layer: 'identity_match_quality',
    check,
    severity: 'high',
    applies_to: 'all',
    platform_scope: platformScope,
    detectable_by: 'crawl',
    owner: 'Backend',
    requires: ['conversion_surface'],

    test(auditData: AuditData): ValidationResult {
      const events = conversionEvents(auditData);
      if (events.length === 0) return skippedNoConversion(this, why);

      const email = events.map((e) => userDataField(e, 'email')).find((v) => v !== undefined);
      const present = !!email && (email.includes('@') || looksHashed(email));

      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: present ? 'pass' : 'fail',
        severity: this.severity,
        technical_details: {
          found: present ? 'Email present on the conversion event' : 'No email in user_data on the conversion event',
          expected: why,
          evidence: [`user_data.email present: ${present}`],
        },
      };
    },
  };
}

export const EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS = makeEmailCapturedRule(
  'L7.1', 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', 'Email captured for Enhanced Conversions', ['google_ads'],
  'A hashed email accompanies the conversion — the primary recovery mechanism when cookies are unavailable',
);

export const EMAIL_CAPTURED_FOR_CAPI = makeEmailCapturedRule(
  'L7.2', 'EMAIL_CAPTURED_FOR_CAPI', 'Email captured for CAPI', ['meta', 'tiktok'],
  'A hashed email accompanies the server event — the largest single driver of Meta and TikTok match quality',
);

// ── L7.3 — Phone captured where collected ─────────────────────────────────────

export const PHONE_CAPTURED_WHERE_COLLECTED: ValidationRule = {
  id: 'L7.3',
  rule_id: 'PHONE_CAPTURED_WHERE_COLLECTED',
  layer: 'identity_match_quality',
  check: 'Phone captured where collected',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: ['meta', 'tiktok', 'google_ads'],
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const collectedAnywhere = anyEventHasUserDataField(auditData, ['phone']) || !!auditData.test_phone;
    if (!collectedAnywhere) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No phone number was observed being collected anywhere in the journey',
          expected: 'A hashed phone is attached when the business collects one',
          evidence: ['Rule skipped — nothing suggests phone is collected on this site'],
        },
      };
    }

    const atConversion = conversionHasUserDataField(auditData, ['phone']);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: atConversion ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: atConversion ? 'Phone present on the conversion event' : 'Phone was collected but is missing from the conversion event',
        expected: 'Phone is the second strongest match key — dropping it between collection and conversion wastes the signal',
        evidence: [`Collected somewhere in the journey: ${collectedAnywhere}`, `Present at conversion: ${atConversion}`],
      },
    };
  },
};

// ── L7.4 — Name and address captured where collected ─────────────────────────

const NAME_ADDRESS_KEYS = ['first_name', 'last_name', 'address', 'city', 'state', 'zip', 'postal_code', 'country'];

export const NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED: ValidationRule = {
  id: 'L7.4',
  rule_id: 'NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED',
  layer: 'identity_match_quality',
  check: 'Name and address captured where collected',
  severity: 'low',
  applies_to: ['ecommerce', 'lead_gen_b2b'],
  platform_scope: ['meta', 'google_ads'],
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const collectedAnywhere = anyEventHasUserDataField(auditData, NAME_ADDRESS_KEYS);
    if (!collectedAnywhere) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No name or address field was observed being collected anywhere in the journey',
          expected: 'Hashed name and postal fields are attached where the business already collects them',
          evidence: ['Rule skipped — nothing suggests name/address is collected on this site'],
        },
      };
    }

    const atConversion = conversionHasUserDataField(auditData, NAME_ADDRESS_KEYS);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: atConversion ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: atConversion ? 'A name/address field is present on the conversion event' : 'Name/address was collected but is missing from the conversion event',
        expected: 'Name and address give an incremental match rate improvement when the business already has them',
        evidence: [`Collected somewhere in the journey: ${collectedAnywhere}`, `Present at conversion: ${atConversion}`],
      },
    };
  },
};

// ── L7.5 — external_id set ────────────────────────────────────────────────────

export const EXTERNAL_ID_SET: ValidationRule = {
  id: 'L7.5',
  rule_id: 'EXTERNAL_ID_SET',
  layer: 'identity_match_quality',
  check: 'external_id set',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: ['meta'],
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'A stable internal user identifier (external_id) is sent to Meta');

    const present = events.some((e) => userDataField(e, 'external_id') !== undefined);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: present ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: present ? 'external_id present in user_data' : 'No external_id in user_data',
        expected: 'external_id improves match and enables cross-session stitching',
        evidence: [`user_data.external_id present: ${present}`],
      },
    };
  },
};

// ── L7.6 — Identity normalised before hashing ─────────────────────────────────
//
// Only checkable for a field Atlas can still see the pre-hash form of —
// once a value is a 64-hex hash there is no way to inspect what was
// normalised before hashing it. A plaintext email/phone still on the wire
// is exactly what this rule needs to catch.

export const IDENTITY_NORMALISED_BEFORE_HASHING: ValidationRule = {
  id: 'L7.6',
  rule_id: 'IDENTITY_NORMALISED_BEFORE_HASHING',
  layer: 'identity_match_quality',
  check: 'Identity normalised before hashing',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    const email = events.map((e) => userDataField(e, 'email')).find((v) => v !== undefined && v.includes('@'));
    const phone = events.map((e) => userDataField(e, 'phone')).find((v) => v !== undefined && !looksHashed(v));

    if (!email && !phone) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No plaintext email/phone observed to check normalisation on (already hashed, or nothing captured)',
          expected: 'Lowercase, trimmed email and E.164 phone before hashing',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const violations: string[] = [];
    if (email && email !== email.trim().toLowerCase()) violations.push(`email "${email}" is not lowercase/trimmed`);
    if (phone && !E164_PATTERN.test(phone)) violations.push(`phone "${phone}" is not in E.164 format`);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0 ? violations.join('; ') : 'Observed plaintext identity field(s) are normalised',
        expected: 'A correctly hashed but unnormalised value never matches',
        evidence: violations.length > 0 ? violations : ['No normalisation issues found'],
      },
    };
  },
};

// ── L7.7 — Hashed with SHA-256 ────────────────────────────────────────────────

export const HASHED_WITH_SHA256: ValidationRule = {
  id: 'L7.7',
  rule_id: 'HASHED_WITH_SHA256',
  layer: 'identity_match_quality',
  check: 'Hashed with SHA-256',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    const email = events.map((e) => userDataField(e, 'email')).find((v) => v !== undefined);
    const phone = events.map((e) => userDataField(e, 'phone')).find((v) => v !== undefined);

    if (!email && !phone) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No email/phone observed on the conversion event',
          expected: 'Match keys are hashed, not sent in the clear',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const plaintext: string[] = [];
    if (email && email.includes('@')) plaintext.push(`email "${email}"`);
    if (phone && !looksHashed(phone)) plaintext.push(`phone "${phone}"`);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: plaintext.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: plaintext.length > 0 ? `Sent in the clear: ${plaintext.join(', ')}` : 'Match keys are hashed',
        expected: 'A compliance requirement and a platform policy requirement',
        evidence: plaintext.length > 0 ? plaintext : ['No plaintext match keys found'],
      },
    };
  },
};

// ── L7.8 — Hash format valid ───────────────────────────────────────────────────
//
// Distinct from L7.7: this catches a value that was clearly MEANT to be a
// hash (not plaintext — no @ sign, no obvious raw digits) but is malformed
// — wrong length, uppercase, or another algorithm's output entirely.

export const HASH_FORMAT_VALID: ValidationRule = {
  id: 'L7.8',
  rule_id: 'HASH_FORMAT_VALID',
  layer: 'identity_match_quality',
  check: 'Hash format valid',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    const email = events.map((e) => userDataField(e, 'email')).find((v) => v !== undefined && !v.includes('@'));
    const phone = events.map((e) => userDataField(e, 'phone')).find((v) => v !== undefined && !E164_PATTERN.test(v));

    const candidates = [email, phone].filter((v): v is string => v !== undefined);
    if (candidates.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No hash-shaped identity value observed to validate',
          expected: 'Hashed values are 64 hexadecimal characters',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const malformed = candidates.filter((v) => !looksHashed(v));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: malformed.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: malformed.length > 0 ? `Malformed hash(es): ${malformed.join(', ')}` : 'All hash-shaped values are 64 lowercase hex characters',
        expected: 'A malformed hash fails silently and reports as a low match rate',
        evidence: malformed.map((v) => `"${v}" (${v.length} chars) is not a 64-char lowercase hex string`),
      },
    };
  },
};

// ── L7.9 / L7.10 / L7.11 — No plaintext PII leaks ─────────────────────────────
//
// All three scan for the same shape (an email address in the clear — the
// only PII pattern specific enough to flag without false-positiving on
// order IDs, timestamps, and other numeric-looking fields) across three
// different surfaces: request bodies (L7.9), URLs/query strings (L7.10),
// and GA4 hits specifically (L7.11, since Google's own ToS singles it out).

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function findPlaintextEmails(texts: string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    const match = decodeSafely(text).match(EMAIL_PATTERN);
    if (match) found.push(match[0]);
  }
  return [...new Set(found)];
}

export const NO_PLAINTEXT_PII_IN_NETWORK_REQUEST: ValidationRule = {
  id: 'L7.9',
  rule_id: 'NO_PLAINTEXT_PII_IN_NETWORK_REQUEST',
  layer: 'identity_match_quality',
  check: 'No plaintext PII in the network request',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const bodies = auditData.networkRequests.map((r) => r.body).filter((b): b is string => !!b);
    const found = findPlaintextEmails(bodies);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: found.length > 0 ? `${found.length} plaintext email(s) found in request bodies` : 'No plaintext PII found in request bodies',
        expected: 'No unhashed email, phone, or name in any outbound payload — legal exposure and grounds for account suspension',
        evidence: found.length > 0 ? found : ['No plaintext PII detected'],
      },
    };
  },
};

export const NO_PII_IN_URLS_OR_QUERY_STRINGS: ValidationRule = {
  id: 'L7.10',
  rule_id: 'NO_PII_IN_URLS_OR_QUERY_STRINGS',
  layer: 'identity_match_quality',
  check: 'No PII in URLs or query strings',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const urls = [
      ...auditData.networkRequests.map((r) => r.url),
      ...(auditData.landing_final_url ? [auditData.landing_final_url] : []),
    ];
    const found = findPlaintextEmails(urls);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: found.length > 0 ? `${found.length} plaintext email(s) found in URLs/query strings` : 'No plaintext PII found in URLs or query strings',
        expected: 'Personal data in a page URL or referrer leaks to every downstream tag on the page',
        evidence: found.length > 0 ? found : ['No plaintext PII detected'],
      },
    };
  },
};

function isGa4Request(r: NetworkRequest): boolean {
  return r.url.includes('google-analytics.com/g/collect') || r.url.includes('analytics.google.com/g/collect');
}

export const NO_PII_IN_GA4_EVENT_PARAMETERS: ValidationRule = {
  id: 'L7.11',
  rule_id: 'NO_PII_IN_GA4_EVENT_PARAMETERS',
  layer: 'identity_match_quality',
  check: 'No PII in GA4 event parameters',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const ga4Requests = auditData.networkRequests.filter(isGa4Request);
    if (ga4Requests.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No GA4 hits observed',
          expected: 'No personal data in custom dimensions or event params',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const found = findPlaintextEmails([...ga4Requests.map((r) => r.url), ...ga4Requests.map((r) => r.body).filter((b): b is string => !!b)]);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: found.length > 0 ? `${found.length} plaintext email(s) found in GA4 event parameters` : 'No plaintext PII found in GA4 event parameters',
        expected: "A direct violation of Google's terms — repeated breaches lead to data deletion or suspension",
        evidence: found.length > 0 ? found : ['No plaintext PII detected in GA4 hits'],
      },
    };
  },
};

export const L7_RULES: ValidationRule[] = [
  EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS,
  EMAIL_CAPTURED_FOR_CAPI,
  PHONE_CAPTURED_WHERE_COLLECTED,
  NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED,
  EXTERNAL_ID_SET,
  IDENTITY_NORMALISED_BEFORE_HASHING,
  HASHED_WITH_SHA256,
  HASH_FORMAT_VALID,
  NO_PLAINTEXT_PII_IN_NETWORK_REQUEST,
  NO_PII_IN_URLS_OR_QUERY_STRINGS,
  NO_PII_IN_GA4_EVENT_PARAMETERS,
];
