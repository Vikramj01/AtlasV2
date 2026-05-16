/**
 * Layer: implementation_drift (3 rules — Sprint C)
 *
 * Rules compare the current CSE crawl snapshot against the designated baseline.
 * All three rules are skipped when either crawlSignals or baselineAuditData is absent.
 * Rules 5.13 and 5.14 require 2 consecutive failures to open a finding (anti-flap).
 * The 2-run promotion is enforced in the findings writer, not here — the rule
 * itself always returns the honest status.
 */
import type { AuditData, ValidationResult, CrawlSignalSnapshot } from '@/types/audit';

// ── helpers ───────────────────────────────────────────────────────────────────

function skippedResult(rule_id: string, reason: string): ValidationResult {
  return {
    rule_id,
    validation_layer: 'implementation_drift',
    status: 'skipped',
    severity: 'low',
    technical_details: {
      found: reason,
      expected: 'A completed CSE baseline crawl is required for drift detection',
      evidence: [
        'Run a site crawl, then promote it to baseline via Settings → Implementation Health.',
      ],
    },
  };
}

/** Build a lookup key for matching signals across runs. */
function signalKey(s: CrawlSignalSnapshot): string {
  return `${s.page_url}::${s.signal_type}::${s.signal_name ?? ''}::${s.signal_id ?? ''}`;
}

/** GTM tag type → CSE signal types that represent that tag's output. */
const TAG_TYPE_TO_SIGNAL_TYPES: Partial<Record<string, string[]>> = {
  awct:      ['google_ads_conversion'],
  fls:       ['google_ads_conversion'],
  flc:       ['google_ads_conversion'],
  asp:       ['google_ads_remarketing'],
  sp:        ['google_ads_remarketing'],
  ga4_event: ['ga4_event'],
  gaawe:     ['ga4_event'],
  gaawc:     ['ga4_base'],
  fbt:       ['meta_pixel'],
  lia:       ['linkedin_insight'],
  tktk:      ['tiktok_pixel'],
};

const CSS_CONDITION_TYPES = new Set(['CSS_SELECTOR', 'MATCHES_CSS_SELECTOR', 'MATCHES_CSS']);

// ── 5.12 SELECTOR_NOT_FOUND_ON_LIVE_SITE ─────────────────────────────────────

export const SELECTOR_NOT_FOUND_ON_LIVE_SITE = {
  rule_id: 'SELECTOR_NOT_FOUND_ON_LIVE_SITE',
  validation_layer: 'implementation_drift' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.gtmContainer) {
      return skippedResult(this.rule_id, 'No GTM container connected');
    }
    if (!auditData.crawlSignals?.length) {
      return skippedResult(this.rule_id, 'No current CSE crawl data');
    }
    if (!auditData.baselineAuditData?.crawlSignals?.length) {
      return skippedResult(this.rule_id, 'No baseline CSE crawl data');
    }

    const { tags, triggers } = auditData.gtmContainer;

    // Find triggers that rely on CSS selectors
    const cssTriggerIds = new Set<string>();
    for (const trigger of triggers) {
      const isCssVisibility = trigger.type === 'element_visibility';
      const hasCssFilter = trigger.filter?.some((c) => CSS_CONDITION_TYPES.has(c.type)) ?? false;
      const hasCssAutoFilter =
        (trigger.autoEventFilter as Array<{ type: string }> | undefined)?.some(
          (c) => CSS_CONDITION_TYPES.has(c.type),
        ) ?? false;
      if (isCssVisibility || hasCssFilter || hasCssAutoFilter) {
        cssTriggerIds.add(trigger.triggerId);
      }
    }

    // Conversion tags that fire on CSS selector triggers
    const CONVERSION_TAG_TYPES = new Set(Object.keys(TAG_TYPE_TO_SIGNAL_TYPES));
    const convTagsOnCss = tags.filter(
      (t) => CONVERSION_TAG_TYPES.has(t.type) && t.firingTriggerId.some((id) => cssTriggerIds.has(id)),
    );

    if (convTagsOnCss.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.validation_layer,
        status: 'pass',
        severity: this.severity,
        technical_details: {
          found: 'No conversion tags fire on CSS selector triggers',
          expected: 'Conversion tags use dataLayer event triggers',
          evidence: ['CSS selector trigger analysis: no conversion tags at risk'],
        },
      };
    }

    // Build baseline signal health map by type
    const baselineHealthy = new Set<string>();
    for (const s of auditData.baselineAuditData.crawlSignals!) {
      if (s.health_status === 'healthy') baselineHealthy.add(`${s.page_url}::${s.signal_type}`);
    }

    // Check current crawl for degraded/missing signals that were healthy in baseline
    const currentByTypeAndPage = new Map<string, CrawlSignalSnapshot>();
    for (const s of auditData.crawlSignals) {
      currentByTypeAndPage.set(`${s.page_url}::${s.signal_type}`, s);
    }

    const violations: string[] = [];
    for (const tag of convTagsOnCss) {
      const expectedTypes = TAG_TYPE_TO_SIGNAL_TYPES[tag.type] ?? [];
      const cssTriggerNames = tag.firingTriggerId
        .filter((id) => cssTriggerIds.has(id))
        .map((id) => {
          const t = triggers.find((tr) => tr.triggerId === id);
          return t ? `"${t.name}"` : id;
        });

      for (const signalType of expectedTypes) {
        // Find pages where this signal was healthy in baseline but is now degraded/missing
        const degradedPages: string[] = [];
        for (const [key, current] of currentByTypeAndPage) {
          if (!key.endsWith(`::${signalType}`)) continue;
          const pageUrl = key.replace(`::${signalType}`, '');
          if (
            baselineHealthy.has(`${pageUrl}::${signalType}`) &&
            (current.health_status === 'missing' || current.health_status === 'degraded')
          ) {
            degradedPages.push(pageUrl);
          }
        }

        if (degradedPages.length > 0) {
          violations.push(
            `"${tag.name}" (${tag.type}) fires on CSS trigger${cssTriggerNames.length > 1 ? 's' : ''} ` +
            `${cssTriggerNames.join(', ')}: ${signalType} signal now ${
              currentByTypeAndPage.get(`${degradedPages[0]}::${signalType}`)?.health_status ?? 'degraded'
            } on ${degradedPages.length} page${degradedPages.length > 1 ? 's' : ''} ` +
            `(was healthy in baseline)`,
          );
        }
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} CSS selector trigger correlation${violations.length > 1 ? 's' : ''} with signal regression`
          : 'No signal regressions correlated to CSS selector triggers',
        expected: 'Signals dependent on CSS selector triggers remain healthy across site changes',
        evidence: violations.length > 0 ? violations : ['All CSS-selector-triggered conversion signals are healthy'],
      },
    };
  },
};

// ── 5.13 TAG_FIRING_REGRESSION_VS_BASELINE ───────────────────────────────────

export const TAG_FIRING_REGRESSION_VS_BASELINE = {
  rule_id: 'TAG_FIRING_REGRESSION_VS_BASELINE',
  validation_layer: 'implementation_drift' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.crawlSignals?.length) {
      return skippedResult(this.rule_id, 'No current CSE crawl data');
    }
    if (!auditData.baselineAuditData?.crawlSignals?.length) {
      return skippedResult(this.rule_id, 'No baseline CSE crawl data');
    }

    // Build current crawl lookup by signal key
    const currentByKey = new Map<string, CrawlSignalSnapshot>();
    for (const s of auditData.crawlSignals) {
      currentByKey.set(signalKey(s), s);
    }

    const failures: string[] = [];
    const warnings: string[] = [];

    for (const baseline of auditData.baselineAuditData.crawlSignals!) {
      if (baseline.health_status !== 'healthy') continue; // only care about previously-healthy signals

      const current = currentByKey.get(signalKey(baseline));

      if (!current || current.health_status === 'missing') {
        failures.push(
          `${baseline.signal_type}${baseline.signal_name ? ` "${baseline.signal_name}"` : ''} ` +
          `on ${baseline.page_url}: was healthy in baseline, now missing`,
        );
      } else if (current.health_status === 'degraded') {
        warnings.push(
          `${baseline.signal_type}${baseline.signal_name ? ` "${baseline.signal_name}"` : ''} ` +
          `on ${baseline.page_url}: was healthy in baseline, now degraded`,
        );
      }
    }

    const status =
      failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass';

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status,
      severity: this.severity,
      technical_details: {
        found: failures.length > 0
          ? `${failures.length} signal${failures.length > 1 ? 's' : ''} that fired in baseline are now missing`
          : warnings.length > 0
            ? `${warnings.length} signal${warnings.length > 1 ? 's' : ''} degraded vs baseline`
            : 'All baseline signals still firing correctly',
        expected: 'All signals that fired in the baseline continue to fire and remain healthy',
        evidence: [...failures, ...warnings].length > 0
          ? [...failures, ...warnings]
          : ['No firing regressions detected vs baseline'],
      },
    };
  },
};

// ── 5.14 TAG_PAYLOAD_REGRESSION_VS_BASELINE ──────────────────────────────────

/** Key payload fields to compare across runs. */
const PAYLOAD_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'value',          label: 'conversion value' },
  { key: 'currency',       label: 'currency' },
  { key: 'transaction_id', label: 'transaction_id' },
  { key: 'event_id',       label: 'event_id' },
  { key: 'order_id',       label: 'order_id' },
];

/** Returns true if a parameters field should be considered "populated". */
function isPopulated(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && v !== 0;
}

export const TAG_PAYLOAD_REGRESSION_VS_BASELINE = {
  rule_id: 'TAG_PAYLOAD_REGRESSION_VS_BASELINE',
  validation_layer: 'implementation_drift' as const,
  severity: 'high' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    if (!auditData.crawlSignals?.length) {
      return skippedResult(this.rule_id, 'No current CSE crawl data');
    }
    if (!auditData.baselineAuditData?.crawlSignals?.length) {
      return skippedResult(this.rule_id, 'No baseline CSE crawl data');
    }

    const currentByKey = new Map<string, CrawlSignalSnapshot>();
    for (const s of auditData.crawlSignals) {
      currentByKey.set(signalKey(s), s);
    }

    const violations: string[] = [];

    for (const baseline of auditData.baselineAuditData.crawlSignals!) {
      if (!baseline.parameters) continue;

      const current = currentByKey.get(signalKey(baseline));
      if (!current?.parameters) continue;

      // Compare items array length (ecommerce)
      const baselineItemCount = Array.isArray(baseline.parameters['items'])
        ? (baseline.parameters['items'] as unknown[]).length
        : null;
      const currentItemCount = Array.isArray(current.parameters['items'])
        ? (current.parameters['items'] as unknown[]).length
        : null;

      if (baselineItemCount !== null && currentItemCount === 0) {
        violations.push(
          `${baseline.signal_type}${baseline.signal_name ? ` "${baseline.signal_name}"` : ''} ` +
          `on ${baseline.page_url}: items[] was ${baselineItemCount} item${baselineItemCount !== 1 ? 's' : ''} in baseline, now empty`,
        );
      }

      // Compare user_data presence
      const hadUserData = baseline.parameters['user_data'] != null;
      const hasUserData = current.parameters['user_data'] != null;
      if (hadUserData && !hasUserData) {
        violations.push(
          `${baseline.signal_type}${baseline.signal_name ? ` "${baseline.signal_name}"` : ''} ` +
          `on ${baseline.page_url}: user_data was present in baseline, now missing (Enhanced Conversions signal lost)`,
        );
      }

      // Compare scalar key fields
      for (const { key, label } of PAYLOAD_FIELDS) {
        const baselineVal = baseline.parameters[key];
        const currentVal = current.parameters[key];

        if (isPopulated(baselineVal) && !isPopulated(currentVal)) {
          violations.push(
            `${baseline.signal_type}${baseline.signal_name ? ` "${baseline.signal_name}"` : ''} ` +
            `on ${baseline.page_url}: ${label} was "${String(baselineVal)}" in baseline, now missing/null`,
          );
        }
      }
    }

    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} payload field regression${violations.length > 1 ? 's' : ''} vs baseline`
          : 'All signal payload fields match baseline',
        expected: 'Key payload fields (value, currency, transaction_id, event_id, items, user_data) match baseline',
        evidence: violations.length > 0 ? violations : ['No payload regressions detected vs baseline'],
      },
    };
  },
};

// ── Drift rule registry ───────────────────────────────────────────────────────

export const IMPLEMENTATION_DRIFT_RULES = [
  SELECTOR_NOT_FOUND_ON_LIVE_SITE,
  TAG_FIRING_REGRESSION_VS_BASELINE,
  TAG_PAYLOAD_REGRESSION_VS_BASELINE,
];
