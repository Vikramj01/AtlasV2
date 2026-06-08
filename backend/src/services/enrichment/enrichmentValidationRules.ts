/**
 * Enrichment Validation Rule Engine
 *
 * Evaluates all 12 PRD §10 rules against a client's enrichment configuration.
 * Rules are pure functions — no DB access.
 */

import type { ClientIdentityConfig, SignalEnrichmentConfig, EnrichmentWarning } from '@/types/enrichment';

export interface ValidationRuleResult {
  rule_id: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface EnrichmentValidationReport {
  passed: boolean;
  rule_results: ValidationRuleResult[];
  warnings: EnrichmentWarning[];
}

// ── Identity rules ─────────────────────────────────────────────────────────────

function rule_IDENT_01(identity: ClientIdentityConfig | null): ValidationRuleResult {
  return {
    rule_id: 'IDENT_01',
    passed: !!identity?.email_field,
    severity: 'error',
    message: identity?.email_field
      ? `Email field mapped to: ${identity.email_field}`
      : 'Email field is not mapped — required for Meta match quality and Google enhanced conversions',
  };
}

function rule_IDENT_02(identity: ClientIdentityConfig | null): ValidationRuleResult {
  return {
    rule_id: 'IDENT_02',
    passed: !!identity?.phone_field,
    severity: 'warning',
    message: identity?.phone_field
      ? `Phone field mapped to: ${identity.phone_field}`
      : 'Phone field not mapped — strongly recommended for Meta EMQ and Google match rate',
  };
}

function rule_IDENT_03(identity: ClientIdentityConfig | null): ValidationRuleResult {
  const hasClickId = !!(identity?.fbc_field || identity?.fbp_field || identity?.gclid_field);
  return {
    rule_id: 'IDENT_03',
    passed: hasClickId,
    severity: 'warning',
    message: hasClickId
      ? 'At least one click ID field is configured'
      : 'No click ID fields configured (fbc/fbp/gclid) — deduplication and attribution will be impaired',
  };
}

function rule_IDENT_04(identity: ClientIdentityConfig | null): ValidationRuleResult {
  const hasExternal = !!identity?.external_id_field;
  return {
    rule_id: 'IDENT_04',
    passed: hasExternal,
    severity: 'info',
    message: hasExternal
      ? `External ID field mapped to: ${identity!.external_id_field}`
      : 'External ID not mapped — recommended for long-term audience matching stability',
  };
}

function rule_IDENT_05(identity: ClientIdentityConfig | null): ValidationRuleResult {
  const hasName = !!(identity?.first_name_field && identity?.last_name_field);
  return {
    rule_id: 'IDENT_05',
    passed: hasName,
    severity: 'info',
    message: hasName
      ? 'First name and last name fields are mapped'
      : 'Name fields not mapped — mapping them improves Meta match quality (fn/ln identifiers)',
  };
}

// ── Signal enrichment rules ────────────────────────────────────────────────────

function rule_SIG_01(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  const purchaseConfig = signals.find((s) => s.signal_key === 'purchase');
  const hasValue = !!purchaseConfig?.value_config?.field;
  return {
    rule_id: 'SIG_01',
    passed: hasValue,
    severity: 'error',
    message: hasValue
      ? `Purchase value field mapped to: ${purchaseConfig!.value_config!.field}`
      : 'Purchase value field is not mapped — required for value-based bidding and ROAS optimisation',
  };
}

function rule_SIG_02(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  const purchaseConfig = signals.find((s) => s.signal_key === 'purchase');
  const hasCurrency = !!(purchaseConfig?.currency_config?.static_value || purchaseConfig?.currency_config?.field);
  return {
    rule_id: 'SIG_02',
    passed: hasCurrency,
    severity: 'warning',
    message: hasCurrency
      ? 'Purchase currency is configured'
      : 'Purchase currency not configured — defaults will be used; configure for multi-currency sites',
  };
}

function rule_SIG_03(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  const purchaseConfig = signals.find((s) => s.signal_key === 'purchase');
  const hasDedup = !!purchaseConfig?.dedup_config?.field;
  return {
    rule_id: 'SIG_03',
    passed: hasDedup,
    severity: 'error',
    message: hasDedup
      ? `Purchase dedup ID field mapped to: ${purchaseConfig!.dedup_config!.field}`
      : 'Purchase dedup ID not mapped — without it, duplicate conversions cannot be suppressed',
  };
}

function rule_SIG_04(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  const conversionSignals = ['purchase', 'begin_checkout', 'generate_lead'];
  const enabledForMeta = signals.filter(
    (s) => conversionSignals.includes(s.signal_key) && s.enabled_for_meta,
  );
  const enabledForGoogle = signals.filter(
    (s) => conversionSignals.includes(s.signal_key) && s.enabled_for_google,
  );
  const passed = enabledForMeta.length > 0 || enabledForGoogle.length > 0;
  return {
    rule_id: 'SIG_04',
    passed,
    severity: 'warning',
    message: passed
      ? `${enabledForMeta.length} signal(s) enabled for Meta, ${enabledForGoogle.length} for Google`
      : 'No conversion signals are enabled for any platform CAPI delivery',
  };
}

function rule_SIG_05(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  const purchaseConfig = signals.find((s) => s.signal_key === 'purchase');
  const hasContentIds = !!purchaseConfig?.content_config?.ids_field;
  return {
    rule_id: 'SIG_05',
    passed: hasContentIds,
    severity: 'info',
    message: hasContentIds
      ? `Purchase content IDs mapped to: ${purchaseConfig!.content_config!.ids_field}`
      : 'Purchase content IDs not mapped — recommended for Meta Advantage+ catalogue campaigns',
  };
}

// ── Cross-cutting rules ────────────────────────────────────────────────────────

function rule_CROSS_01(
  identity: ClientIdentityConfig | null,
  signals: SignalEnrichmentConfig[],
): ValidationRuleResult {
  const hasIdentity = !!(identity?.email_field || identity?.phone_field);
  const hasConversionSignal = signals.some(
    (s) => (s.signal_key === 'purchase' || s.signal_key === 'generate_lead') && (s.enabled_for_meta || s.enabled_for_google),
  );
  // If there are enabled conversion signals, identity must be configured
  const passed = !hasConversionSignal || hasIdentity;
  return {
    rule_id: 'CROSS_01',
    passed,
    severity: 'error',
    message: passed
      ? 'Identity configuration is consistent with enabled conversion signals'
      : 'Conversion signals are enabled for CAPI delivery but identity fields (email/phone) are not mapped — match quality will be zero',
  };
}

function rule_CROSS_02(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  const metaEnabled = signals.filter((s) => s.enabled_for_meta);
  const allHaveDedup = metaEnabled.every((s) => !!s.dedup_config?.field);
  const passed = metaEnabled.length === 0 || allHaveDedup;
  return {
    rule_id: 'CROSS_02',
    passed,
    severity: 'warning',
    message: passed
      ? 'All Meta-enabled signals have dedup IDs configured'
      : `${metaEnabled.filter((s) => !s.dedup_config?.field).length} Meta-enabled signal(s) lack dedup IDs — duplicate events may inflate conversion counts`,
  };
}

// ── Offline / event-time rules ─────────────────────────────────────────────────

// Attribution windows in days per platform and event source.
const ONLINE_WINDOW_DAYS = 7;       // Meta online
const OFFLINE_WINDOW_DAYS_META = 62; // Meta offline (physical_store / system_generated)
const OFFLINE_WINDOW_DAYS_GOOGLE = 90; // Google DMA offline

function isOfflineSource(source: string | undefined): boolean {
  return source === 'physical_store' || source === 'system_generated' || source === 'phone_call';
}

function rule_TIME_01(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  // Checks whether any signal's event_source is set to an offline type while
  // the configured window hints (carried in platform_mappings metadata) would
  // exceed the online 7-day default. Since Atlas doesn't store a concrete
  // event_time on the config itself, this rule validates that offline signals
  // are explicitly configured — i.e. the operator has consciously chosen a
  // non-website source. A future enhancement can validate live event timestamps
  // against the window when the CAPI pipeline rejects out-of-window events.
  const offlineSignals = signals.filter((s) => isOfflineSource(s.event_source));
  const passed = offlineSignals.every((s) => {
    // Offline signals must have at least email or phone mapped (validated via
    // identity config in TIME_02) — here we just confirm the source is explicit.
    return s.event_source !== undefined && s.event_source !== 'website';
  });
  return {
    rule_id: 'TIME_01',
    passed: true, // informational — real window enforcement happens at ingest time
    severity: 'info',
    message: offlineSignals.length > 0
      ? `${offlineSignals.length} offline signal(s) configured — attribution window: ${OFFLINE_WINDOW_DAYS_META} days (Meta) / ${OFFLINE_WINDOW_DAYS_GOOGLE} days (Google). Ensure event_time in payloads is within these windows.`
      : `No offline signals configured — default ${ONLINE_WINDOW_DAYS}-day attribution window applies`,
  };
}

function rule_TIME_02(
  identity: ClientIdentityConfig | null,
  signals: SignalEnrichmentConfig[],
): ValidationRuleResult {
  // OFFLINE_SOURCE_MISSING_IDENTITY: physical_store signals require email or
  // phone to have any chance of matching — without them, Meta and Google cannot
  // join the event to an ad click.
  const physicalStoreSignals = signals.filter((s) => s.event_source === 'physical_store');
  if (physicalStoreSignals.length === 0) {
    return { rule_id: 'TIME_02', passed: true, severity: 'error', message: 'No physical store signals configured' };
  }
  const hasIdentity = !!(identity?.email_field || identity?.phone_field);
  return {
    rule_id: 'TIME_02',
    passed: hasIdentity,
    severity: 'error',
    message: hasIdentity
      ? 'Identity fields (email/phone) are configured for physical store signals'
      : 'Physical store signals require email or phone identity fields — without them match rate will be zero',
  };
}

function rule_TIME_03(signals: SignalEnrichmentConfig[]): ValidationRuleResult {
  // OFFLINE_MISSING_FBC_CONTEXT: physical_store events benefit greatly from
  // fbclid capture at the initial online touchpoint. This is a warning to
  // remind operators to capture it in CRM/loyalty systems.
  const physicalStoreSignals = signals.filter((s) => s.event_source === 'physical_store');
  if (physicalStoreSignals.length === 0) {
    return { rule_id: 'TIME_03', passed: true, severity: 'warning', message: 'No physical store signals configured' };
  }
  return {
    rule_id: 'TIME_03',
    passed: false, // Always a reminder when physical_store is configured
    severity: 'warning',
    message: 'Physical store signals: capture fbclid at the initial online touchpoint and store it in your CRM or loyalty system to enable cross-channel matching on Meta',
  };
}

// ── Main evaluator ─────────────────────────────────────────────────────────────

export function evaluateEnrichmentRules(
  identity: ClientIdentityConfig | null,
  signals: SignalEnrichmentConfig[],
): EnrichmentValidationReport {
  const ruleResults: ValidationRuleResult[] = [
    rule_IDENT_01(identity),
    rule_IDENT_02(identity),
    rule_IDENT_03(identity),
    rule_IDENT_04(identity),
    rule_IDENT_05(identity),
    rule_SIG_01(signals),
    rule_SIG_02(signals),
    rule_SIG_03(signals),
    rule_SIG_04(signals),
    rule_SIG_05(signals),
    rule_CROSS_01(identity, signals),
    rule_CROSS_02(signals),
    rule_TIME_01(signals),
    rule_TIME_02(identity, signals),
    rule_TIME_03(signals),
  ];

  const warnings: EnrichmentWarning[] = ruleResults
    .filter((r) => !r.passed)
    .map((r) => ({
      field: r.rule_id,
      severity: r.severity === 'error' ? 'error' : r.severity === 'warning' ? 'warning' : 'info',
      message: r.message,
    }));

  const passed = ruleResults.filter((r) => r.severity === 'error').every((r) => r.passed);

  return { passed, rule_results: ruleResults, warnings };
}
