/**
 * Layer: tag_configuration (11 rules total — 7 in Phase A, 4 in Phase B)
 *
 * Rules operate on GTMContainerSnapshot inside AuditData.gtmContainer.
 * Every rule returns status: 'skipped' when gtmContainer is absent.
 */
import type { AuditData, ValidationResult, GTMTag, GTMContainerSnapshot } from '@/types/audit';

// ── Internal helpers ────────────────────────────────────────────���─────────────

/** Retrieve a tag parameter value by key. */
function paramValue(tag: GTMTag, key: string): string | undefined {
  return tag.parameter?.find((p) => p.key === key)?.value;
}

/** True if a parameter value is a GTM variable reference: {{...}} */
function isVariableRef(value: string | undefined): boolean {
  return typeof value === 'string' && /^\{\{.+\}\}$/.test(value.trim());
}

/** True if a parameter value is a plain literal (not a variable reference). */
function isLiteral(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '' && !isVariableRef(value);
}

/** Extract the HTML content from a custom HTML tag's 'html' parameter. */
function customHtmlContent(tag: GTMTag): string {
  return paramValue(tag, 'html') ?? '';
}

/** Tags whose type signals they are marketing/advertising pixels. */
const MARKETING_TAG_TYPES = new Set([
  // Google Ads
  'awct',   // Conversion Tracking
  'asp',    // Remarketing
  'sp',     // Remarketing (older)
  'flc',    // Floodlight Counter
  'fls',    // Floodlight Sales
  // GA4
  'ga4_event',
  'gaawe',  // GA4 (older template name)
  'gaawc',  // GA4 Config
  // Meta
  'fbt',    // Facebook Pixel (template)
  // LinkedIn
  'lia',
  // TikTok
  'tktk',
  // Microsoft / Bing
  'msadmc',
]);

/** Tag types that represent conversion destinations (value/currency/txn_id matter). */
const CONVERSION_TAG_TYPES = new Set([
  'awct', 'ga4_event', 'gaawe', 'fbt', 'fls', 'flc',
]);

/** Event names that indicate conversion tracking is expected. */
const CONVERSION_EVENTS = new Set([
  'purchase', 'generate_lead', 'sign_up', 'conversion', 'submit_lead_form',
  'begin_checkout', 'add_payment_info',
]);

/**
 * Regexes that identify tracking-critical content inside custom HTML.
 * Each entry is [regex, platformLabel].
 */
const TRACKING_PATTERNS: Array<[RegExp, string]> = [
  [/gtag\s*\(/, 'gtag()'],
  [/fbq\s*\(/, 'fbq()'],
  [/\bga\s*\(/, 'ga()'],
  [/_gaq\s*\.\s*push/, '_gaq.push'],
  [/ttq\s*\.\s*track/, 'TikTok ttq'],
  [/lintrk\s*\(/, 'LinkedIn lintrk'],
  [/uetq\s*\.\s*push/, 'Microsoft UET'],
  [/snaptr\s*\(/, 'Snap Pixel'],
  [/pintrk\s*\(/, 'Pinterest Tag'],
];

/**
 * Regexes that identify hardcoded conversion IDs / pixel IDs / data literals
 * in custom HTML tag content.
 */
const HARDCODED_DATA_PATTERNS: Array<[RegExp, string]> = [
  [/AW-\d{8,}/,                       'Google Ads conversion ID (AW-...)'],
  [/G-[A-Z0-9]{6,}/,                  'GA4 measurement ID (G-...)'],
  [/UA-\d{5,}-\d/,                    'Universal Analytics ID (UA-...)'],
  [/\d{15,}/,                         'Meta Pixel numeric ID'],
  [/currency\s*:\s*['"][A-Z]{3}['"]/,  'Hardcoded currency literal'],
  [/value\s*:\s*\d+(\.\d+)?/,         'Hardcoded numeric value'],
  [/transaction_id\s*:\s*['"][^'"]+['"]/, 'Hardcoded transaction ID string'],
];

function skippedResult(rule_id: string, layer = 'tag_configuration' as const): ValidationResult {
  return {
    rule_id,
    validation_layer: layer,
    status: 'skipped',
    severity: 'low',
    technical_details: {
      found: 'No GTM container connected',
      expected: 'GTM container snapshot required for this rule',
      evidence: ['Connect a GTM container via Settings → Implementation Health to enable this check'],
    },
  };
}

// ── Phase A rules ─────────────────────────────────────────────────────────────

// ── 5.1 CUSTOM_HTML_TAG_DETECTED ─────────────────────────────────────────────

export const CUSTOM_HTML_TAG_DETECTED = {
  rule_id: 'CUSTOM_HTML_TAG_DETECTED',
  validation_layer: 'tag_configuration' as const,
  severity: 'medium' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const customTags = auditData.gtmContainer.tags.filter((t) => t.type === 'html');
    const count = customTags.length;

    const status = count === 0 ? 'pass' : count <= 3 ? 'warning' : 'fail';

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status,
      severity: this.severity,
      technical_details: {
        found: `${count} custom HTML tag${count !== 1 ? 's' : ''}`,
        expected: '0 custom HTML tags (use built-in templates instead)',
        evidence: [
          `Custom HTML tags: ${count}`,
          ...customTags.map((t) => `  - "${t.name}" (ID: ${t.tagId})`),
        ],
      },
    };
  },
};

// ── 5.2 CUSTOM_HTML_TAG_BYPASSES_CONSENT ─────────────────────────────────────

export const CUSTOM_HTML_TAG_BYPASSES_CONSENT = {
  rule_id: 'CUSTOM_HTML_TAG_BYPASSES_CONSENT',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const customTags = auditData.gtmContainer.tags.filter((t) => t.type === 'html');
    const violating: string[] = [];

    for (const tag of customTags) {
      const html = customHtmlContent(tag);
      const matchedPattern = TRACKING_PATTERNS.find(([re]) => re.test(html));
      if (!matchedPattern) continue;

      const hasConsent =
        tag.consentSettings?.consentStatus === 'NEEDED' &&
        (tag.consentSettings.consentType?.length ?? 0) > 0;

      if (!hasConsent) {
        violating.push(`"${tag.name}" fires ${matchedPattern[1]} without consent gating`);
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violating.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violating.length > 0 ? `${violating.length} ungated tracking tag${violating.length > 1 ? 's' : ''}` : 'All custom HTML tags have consent gating',
        expected: 'All tracking custom HTML tags require consent (ad_storage, ad_user_data)',
        evidence: violating.length > 0 ? violating : ['No consent violations found in custom HTML tags'],
      },
    };
  },
};

// ── 5.3 CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA ──────────────────��─────────

export const CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA = {
  rule_id: 'CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA',
  validation_layer: 'tag_configuration' as const,
  severity: 'high' as const,
  affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const customTags = auditData.gtmContainer.tags.filter((t) => t.type === 'html');
    const violations: string[] = [];

    for (const tag of customTags) {
      const html = customHtmlContent(tag);
      // Only flag tags that look like tracking code (contain tracking patterns)
      const isTracking = TRACKING_PATTERNS.some(([re]) => re.test(html));
      if (!isTracking) continue;

      for (const [re, label] of HARDCODED_DATA_PATTERNS) {
        if (re.test(html)) {
          violations.push(`"${tag.name}": ${label}`);
        }
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0 ? `${violations.length} hardcoded value${violations.length > 1 ? 's' : ''}` : 'No hardcoded conversion data found',
        expected: 'Conversion IDs and values sourced from GTM variables, not hardcoded literals',
        evidence: violations.length > 0 ? violations : ['No hardcoded conversion data in custom HTML tags'],
      },
    };
  },
};

// ── 5.4 HARDCODED_VALUE_IN_TAG_CONFIG ────────────────────────────────────────

export const HARDCODED_VALUE_IN_TAG_CONFIG = {
  rule_id: 'HARDCODED_VALUE_IN_TAG_CONFIG',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['Google Ads', 'Meta Ads', 'GA4', 'sGTM'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const violations: string[] = [];

    for (const tag of auditData.gtmContainer.tags) {
      if (!CONVERSION_TAG_TYPES.has(tag.type)) continue;

      // Check if this tag fires on a conversion event
      const eventName = paramValue(tag, 'eventName') ?? paramValue(tag, 'event') ?? '';
      if (eventName && !CONVERSION_EVENTS.has(eventName) && !isVariableRef(eventName)) {
        // Not clearly a conversion event — skip value check
        // (still check if eventName itself is dynamic, which is fine)
      }

      const valueParam = paramValue(tag, 'value');
      if (valueParam === undefined) continue;

      if (isLiteral(valueParam)) {
        violations.push(`"${tag.name}" (${tag.type}): value="${valueParam}" — should be {{ecommerce.value}} or equivalent variable`);
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0 ? `${violations.length} tag${violations.length > 1 ? 's' : ''} with hardcoded value` : 'No hardcoded value parameters found',
        expected: 'Conversion value sourced from a dataLayer variable reference',
        evidence: violations.length > 0 ? violations : ['All value parameters use variable references'],
      },
    };
  },
};

// ── 5.5 HARDCODED_CURRENCY_IN_TAG_CONFIG ─────────────────────────────────────

export const HARDCODED_CURRENCY_IN_TAG_CONFIG = {
  rule_id: 'HARDCODED_CURRENCY_IN_TAG_CONFIG',
  validation_layer: 'tag_configuration' as const,
  severity: 'high' as const,
  affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const violations: string[] = [];

    for (const tag of auditData.gtmContainer.tags) {
      if (!CONVERSION_TAG_TYPES.has(tag.type)) continue;

      const currencyParam = paramValue(tag, 'currency');
      if (currencyParam === undefined) continue;

      if (isLiteral(currencyParam)) {
        // A hardcoded 3-letter ISO code is fragile but technically valid for single-currency sites.
        // We surface it as a warning so the implementer can document or convert to a variable.
        violations.push(`"${tag.name}" (${tag.type}): currency="${currencyParam}" is hardcoded`);
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'warning' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0 ? `${violations.length} tag${violations.length > 1 ? 's' : ''} with hardcoded currency` : 'No hardcoded currency parameters found',
        expected: 'Currency sourced from a dataLayer variable reference',
        evidence: violations.length > 0 ? violations : ['All currency parameters use variable references'],
      },
    };
  },
};

// ── 5.6 HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG ───────────────────────────────

export const HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG = {
  rule_id: 'HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const violations: string[] = [];

    for (const tag of auditData.gtmContainer.tags) {
      const txnParam =
        paramValue(tag, 'transactionId') ??
        paramValue(tag, 'transaction_id') ??
        paramValue(tag, 'orderId');

      if (txnParam === undefined) continue;

      if (isLiteral(txnParam)) {
        violations.push(`"${tag.name}" (${tag.type}): transaction_id="${txnParam}" is a literal — deduplication will collapse to a single daily conversion`);
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0 ? `${violations.length} tag${violations.length > 1 ? 's' : ''} with hardcoded transaction ID` : 'No hardcoded transaction IDs found',
        expected: 'transaction_id sourced from {{ecommerce.transaction_id}} or equivalent variable',
        evidence: violations.length > 0 ? violations : ['All transaction_id parameters use variable references'],
      },
    };
  },
};

// ── 5.7 DUPLICATE_TAG_CONFIGURATION ──────────────────────────────────────────

export const DUPLICATE_TAG_CONFIGURATION = {
  rule_id: 'DUPLICATE_TAG_CONFIGURATION',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['Google Ads', 'Meta Ads', 'GA4'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const container = auditData.gtmContainer as GTMContainerSnapshot;

    // Build a key per tag: type + primary conversion identifier
    type TagGroup = { tags: GTMTag[]; triggers: Set<string> };
    const groups = new Map<string, TagGroup>();

    for (const tag of container.tags) {
      if (!CONVERSION_TAG_TYPES.has(tag.type) && tag.type !== 'html') continue;

      // Determine the conversion identifier — conversionId for Ads, measurementId for GA4,
      // pixelId for Meta, or fall back to tag type alone
      const convId =
        paramValue(tag, 'conversionId') ??
        paramValue(tag, 'measurementId') ??
        paramValue(tag, 'pixelId') ??
        paramValue(tag, 'adwordsConversionId') ??
        '';

      const eventName =
        paramValue(tag, 'eventName') ??
        paramValue(tag, 'event') ??
        '';

      const groupKey = `${tag.type}::${convId}::${eventName}`;

      const existing = groups.get(groupKey);
      if (existing) {
        existing.tags.push(tag);
        tag.firingTriggerId.forEach((id) => existing.triggers.add(id));
      } else {
        groups.set(groupKey, {
          tags: [tag],
          triggers: new Set(tag.firingTriggerId),
        });
      }
    }

    const violations: string[] = [];

    for (const [key, group] of groups) {
      if (group.tags.length < 2) continue;

      // Check if all tags in the duplicate group have event_id configured
      // (which enables platform-side deduplication)
      const allHaveEventId = group.tags.every(
        (t) => paramValue(t, 'eventId') !== undefined || paramValue(t, 'event_id') !== undefined,
      );

      if (!allHaveEventId) {
        const [tagType, convId, eventName] = key.split('::');
        const tagNames = group.tags.map((t) => `"${t.name}"`).join(', ');
        violations.push(
          `Duplicate ${tagType} tags${convId ? ` for ID ${convId}` : ''}${eventName ? ` event "${eventName}"` : ''}: ${tagNames} — no event_id deduplication configured`,
        );
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0 ? `${violations.length} duplicate tag group${violations.length > 1 ? 's' : ''} without deduplication` : 'No duplicate conversion tags found',
        expected: 'Each (destination, conversion ID, event) combination has exactly one tag, or all duplicates set event_id for deduplication',
        evidence: violations.length > 0 ? violations : ['No unguarded duplicate conversion tags detected'],
      },
    };
  },
};

// ── Phase A rule registry ─────────────────────────────────────────────────────

export const TAG_CONFIGURATION_RULES_PHASE_A = [
  CUSTOM_HTML_TAG_DETECTED,
  CUSTOM_HTML_TAG_BYPASSES_CONSENT,
  CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA,
  HARDCODED_VALUE_IN_TAG_CONFIG,
  HARDCODED_CURRENCY_IN_TAG_CONFIG,
  HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG,
  DUPLICATE_TAG_CONFIGURATION,
];
