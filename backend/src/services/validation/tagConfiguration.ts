/**
 * Layer: tag_configuration (12 rules total — 7 in Phase A, 5 in Phase B)
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

// ── Phase B rules ─────────────────────────────────────────────────────────────

/**
 * Required consent types per GTM tag type.
 * Ad/conversion platforms need ad_storage + ad_user_data (GCM v2).
 * Analytics platforms need analytics_storage.
 */
const REQUIRED_CONSENT_TYPES: Partial<Record<string, string[]>> = {
  awct:      ['ad_storage', 'ad_user_data'],
  asp:       ['ad_storage', 'ad_user_data'],
  sp:        ['ad_storage', 'ad_user_data'],
  flc:       ['ad_storage', 'ad_user_data'],
  fls:       ['ad_storage', 'ad_user_data'],
  ga4_event: ['analytics_storage'],
  gaawe:     ['analytics_storage'],
  gaawc:     ['analytics_storage'],
  fbt:       ['ad_storage', 'ad_user_data'],
  lia:       ['ad_storage'],
  tktk:      ['ad_storage'],
  msadmc:    ['ad_storage'],
};

/** Consent types where a default of "granted" violates GDPR opt-in requirement. */
const SENSITIVE_CONSENT_TYPES = new Set([
  'ad_storage', 'ad_user_data', 'analytics_storage', 'ad_personalization',
]);

// ── 5.8 CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG ────────────────────────────

export const CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG = {
  rule_id: 'CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const violations: string[] = [];

    for (const tag of auditData.gtmContainer.tags) {
      if (!MARKETING_TAG_TYPES.has(tag.type)) continue;

      const hasConsentConfig =
        tag.consentSettings != null &&
        tag.consentSettings.consentStatus !== 'NOT_SET';

      if (!hasConsentConfig) {
        violations.push(`"${tag.name}" (${tag.type}): no consent requirements configured`);
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} marketing tag${violations.length > 1 ? 's' : ''} missing consent settings`
          : 'All marketing tags have consent settings configured',
        expected: 'Every marketing/advertising tag must declare required consent types (ad_storage, ad_user_data)',
        evidence: violations.length > 0 ? violations : ['No consent configuration gaps on marketing tags'],
      },
    };
  },
};

// ── 5.9 CONSENT_TYPE_MISMATCH ─────────────────────────────────────────────────

export const CONSENT_TYPE_MISMATCH = {
  rule_id: 'CONSENT_TYPE_MISMATCH',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const violations: string[] = [];

    for (const tag of auditData.gtmContainer.tags) {
      const requiredTypes = REQUIRED_CONSENT_TYPES[tag.type];
      if (!requiredTypes) continue;

      // Only check tags that actually have consent configured — missing config is caught by 5.8
      if (!tag.consentSettings || tag.consentSettings.consentStatus === 'NOT_SET') continue;

      const configuredTypes = tag.consentSettings.consentType ?? [];
      const missingTypes = requiredTypes.filter((t) => !configuredTypes.includes(t));

      if (missingTypes.length > 0) {
        violations.push(
          `"${tag.name}" (${tag.type}): missing ${missingTypes.join(', ')} ` +
          `(has: ${configuredTypes.length > 0 ? configuredTypes.join(', ') : 'none'})`,
        );
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} tag${violations.length > 1 ? 's' : ''} with incorrect consent type mapping`
          : 'All marketing tags have correct consent type mapping',
        expected: 'Ad tags require ad_storage + ad_user_data; GA4 tags require analytics_storage',
        evidence: violations.length > 0 ? violations : ['All consent type mappings are correct'],
      },
    };
  },
};

// ── 5.10 DEFAULT_CONSENT_GRANTED_GLOBALLY ────────────────────────────────────

export const DEFAULT_CONSENT_GRANTED_GLOBALLY = {
  rule_id: 'DEFAULT_CONSENT_GRANTED_GLOBALLY',
  validation_layer: 'tag_configuration' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const { consent_default_tag } = auditData.gtmContainer;

    if (!consent_default_tag) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.validation_layer,
        status: 'fail',
        severity: this.severity,
        technical_details: {
          found: 'No Consent Mode initialisation tag found in container',
          expected: 'A consent initialisation tag setting sensitive types to "denied" by default',
          evidence: ['No tag with type "consent_init" or a name matching "Consent Mode" was found'],
        },
      };
    }

    const grantedByDefault: string[] = [];

    for (const param of consent_default_tag.parameter ?? []) {
      // LIST-of-MAP format used by the native GTM Consent Initialization tag
      if (param.type === 'LIST' && param.key === 'defaultValue' && Array.isArray(param.list)) {
        for (const entry of param.list) {
          const mapEntries = (entry as { map?: Array<{ key: string; value?: string }> }).map ?? [];
          const typeEntry   = mapEntries.find((m) => m.key === 'consentType');
          const statusEntry = mapEntries.find((m) => m.key === 'consentStatus');
          if (
            typeEntry?.value &&
            SENSITIVE_CONSENT_TYPES.has(typeEntry.value) &&
            statusEntry?.value === 'granted'
          ) {
            grantedByDefault.push(`${typeEntry.value} defaults to "granted"`);
          }
        }
      }

      // Flat key-value format used by some custom consent tags
      if (SENSITIVE_CONSENT_TYPES.has(param.key) && param.value === 'granted') {
        grantedByDefault.push(`${param.key} defaults to "granted"`);
      }
    }

    if (grantedByDefault.length > 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.validation_layer,
        status: 'fail',
        severity: this.severity,
        technical_details: {
          found: `${grantedByDefault.length} sensitive consent type${grantedByDefault.length > 1 ? 's' : ''} defaulting to "granted"`,
          expected: 'All sensitive consent types default to "denied" until explicit user consent is recorded',
          evidence: [`Consent tag: "${consent_default_tag.name}"`, ...grantedByDefault],
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: 'pass',
      severity: this.severity,
      technical_details: {
        found: 'Consent Mode initialised with "denied" defaults for all sensitive consent types',
        expected: 'All sensitive consent types default to "denied"',
        evidence: [`Consent tag: "${consent_default_tag.name}" — all sensitive types denied by default`],
      },
    };
  },
};

// ── 5.11 FRAGILE_CSS_SELECTOR_TRIGGER ────────────────────────────────────────

/** GTM condition types that rely on CSS selectors and break when UI changes. */
const CSS_CONDITION_TYPES = new Set(['CSS_SELECTOR', 'MATCHES_CSS_SELECTOR', 'MATCHES_CSS']);

export const FRAGILE_CSS_SELECTOR_TRIGGER = {
  rule_id: 'FRAGILE_CSS_SELECTOR_TRIGGER',
  validation_layer: 'tag_configuration' as const,
  severity: 'medium' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const { tags, triggers } = auditData.gtmContainer;

    // Collect trigger IDs that use CSS selectors
    const cssTriggerIds = new Set<string>();
    for (const trigger of triggers) {
      const isElementVisibility = trigger.type === 'element_visibility';
      const hasCssFilter = trigger.filter?.some((c) => CSS_CONDITION_TYPES.has(c.type)) ?? false;
      const hasCssAutoFilter =
        (trigger.autoEventFilter as Array<{ type: string }> | undefined)?.some(
          (c) => CSS_CONDITION_TYPES.has(c.type),
        ) ?? false;

      if (isElementVisibility || hasCssFilter || hasCssAutoFilter) {
        cssTriggerIds.add(trigger.triggerId);
      }
    }

    // Find conversion tags that fire on CSS-selector triggers
    const violations: string[] = [];
    for (const tag of tags) {
      if (!CONVERSION_TAG_TYPES.has(tag.type)) continue;

      const cssFiringTriggers = tag.firingTriggerId.filter((id) => cssTriggerIds.has(id));
      if (cssFiringTriggers.length === 0) continue;

      const triggerNames = cssFiringTriggers.map((id) => {
        const t = triggers.find((tr) => tr.triggerId === id);
        return t ? `"${t.name}"` : id;
      });
      violations.push(
        `"${tag.name}" (${tag.type}) fires on CSS selector trigger${triggerNames.length > 1 ? 's' : ''}: ${triggerNames.join(', ')}`,
      );
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} conversion tag${violations.length > 1 ? 's' : ''} on fragile CSS selector trigger${violations.length > 1 ? 's' : ''}`
          : 'No conversion tags using CSS selector triggers',
        expected: 'Conversion tags fire on dataLayer event triggers, not CSS selector or element visibility triggers',
        evidence: violations.length > 0 ? violations : ['All conversion tags use event-based triggers'],
      },
    };
  },
};

// ── 5.12 GA4_CROSS_DOMAIN_LINKING_MISSING ────────────────────────────────────
//
// Fires when the container has a GA4 Config tag (gaawc) with no linked_domains
// parameter AND the container also has click triggers or custom event triggers
// whose names/conditions reference a different hostname — a reliable signal that
// the site routes users across domains without a linker configured.
//
// Severity: high — silent session splits corrupt funnel data and attribution
// without any visible error.

function hasOutboundClickTrigger(auditData: AuditData): boolean {
  const triggers = auditData.gtmContainer?.triggers ?? [];
  return triggers.some((t) => {
    // GTM "Click - Just Links" or "Click - All Elements" triggers that filter
    // on a hostname condition are the canonical cross-domain trigger pattern.
    const isClick = t.type === 'LINK_CLICK' || t.type === 'CLICK';
    if (!isClick) return false;
    const filters = [
      ...(t.filter ?? []),
      ...((t as Record<string, unknown>).autoEventFilter as typeof t.filter ?? []),
    ];
    return filters.some((f) => {
      const params = f.parameter ?? [];
      // Look for a hostname condition that differs from the typical "contains"
      // the primary domain — presence is enough to signal cross-domain intent.
      return params.some(
        (p) => p.key === 'arg1' && typeof p.value === 'string' && p.value.includes('{{Click URL}}'),
      );
    });
  });
}

export const GA4_CROSS_DOMAIN_LINKING_MISSING = {
  rule_id: 'GA4_CROSS_DOMAIN_LINKING_MISSING',
  validation_layer: 'tag_configuration' as const,
  severity: 'high' as const,
  affected_platforms: ['GA4'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) return skippedResult(this.rule_id);

    const ga4ConfigTags = auditData.gtmContainer.tags.filter((t) => t.type === 'gaawc');

    if (ga4ConfigTags.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.validation_layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No GA4 Config tag (gaawc) present in container',
          expected: 'A GA4 Config tag with linked_domains configured if cross-domain links exist',
          evidence: ['Rule skipped — no GA4 Config tag found'],
        },
      };
    }

    const violations: string[] = [];

    for (const tag of ga4ConfigTags) {
      const linkedDomainsParam = tag.parameter?.find((p) => p.key === 'linked_domains');
      const hasLinkedDomains =
        linkedDomainsParam !== undefined &&
        linkedDomainsParam.type === 'LIST' &&
        Array.isArray(linkedDomainsParam.list) &&
        linkedDomainsParam.list.length > 0;

      if (!hasLinkedDomains && hasOutboundClickTrigger(auditData)) {
        violations.push(
          `"${tag.name}" (gaawc): no linked_domains configured but outbound click triggers are present — sessions will reset at the domain handoff`,
        );
      }
    }

    if (violations.length > 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.validation_layer,
        status: 'fail',
        severity: this.severity,
        technical_details: {
          found: `${violations.length} GA4 Config tag${violations.length > 1 ? 's' : ''} missing linked_domains`,
          expected: 'GA4 Config tag lists all secondary domains in linked_domains so the client_id cookie is passed across the handoff',
          evidence: violations,
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: 'pass',
      severity: this.severity,
      technical_details: {
        found: 'GA4 Config tag has linked_domains configured or no outbound click triggers detected',
        expected: 'linked_domains present when outbound cross-domain links exist',
        evidence: ['No cross-domain tracking gap detected'],
      },
    };
  },
};

// ── Phase B rule registry ─────────────────────────────────────────────────────

export const TAG_CONFIGURATION_RULES_PHASE_B = [
  CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG,
  CONSENT_TYPE_MISMATCH,
  DEFAULT_CONSENT_GRANTED_GLOBALLY,
  FRAGILE_CSS_SELECTOR_TRIGGER,
  GA4_CROSS_DOMAIN_LINKING_MISSING,
];

// ── Combined registry (all 11 tag_configuration rules) ───────────────────────

export const TAG_CONFIGURATION_RULES_ALL = [
  ...TAG_CONFIGURATION_RULES_PHASE_A,
  ...TAG_CONFIGURATION_RULES_PHASE_B,
];
