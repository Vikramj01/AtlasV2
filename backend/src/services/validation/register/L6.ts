/**
 * Layer L6 — Parameter Completeness (15 of 17 rules — see note on L6.6/L6.8
 * below).
 *
 * L5 asked "does the conversion event fire." This layer asks what's on it:
 * value, currency, transaction ID, and a set of business-context fields
 * (plan tier, billing period, seat count, lead quality, ...) that vary by
 * site type and aren't part of GA4's fixed ecommerce schema — those are
 * matched against a candidate key-name list per concept, since a site's
 * own dataLayer push can name a custom field anything (DataLayerEvent's
 * index signature carries whatever the site actually pushed).
 *
 * L6.6 ("transaction ID is genuinely unique") needs to compare IDs across
 * repeated conversions — Second-pass detectable, deferred like every other
 * non-crawl method so far. L6.8 ("user_id set when authenticated") needs
 * an authenticated app session — Credentials-detectable, also deferred.
 * Neither is included in L6_RULES.
 */
import type { AuditData, ValidationResult, ValidationRule, RuleStatus, DataLayerEvent, SiteType } from '@/types/audit';

const FALLBACK_CONVERSION_EVENT_NAMES = ['purchase', 'generate_lead', 'sign_up', 'conversion', 'submit_lead_form', 'begin_checkout', 'add_payment_info'];

function primaryConversionName(auditData: AuditData): string | undefined {
  return auditData.declared_conversions?.find((c) => c.kind === 'primary')?.name;
}

/**
 * The primary conversion event(s) observed — matched against the declared
 * name when Scan Inputs provided one, falling back to the same common
 * conversion-event-name set the v1 engine's tagConfiguration.ts uses, so
 * this layer still produces useful results for an audit that hasn't
 * declared a conversion yet.
 */
function conversionEvents(auditData: AuditData): DataLayerEvent[] {
  const name = primaryConversionName(auditData);
  if (name) return auditData.dataLayer.filter((e) => e.event === name);
  return auditData.dataLayer.filter((e) => FALLBACK_CONVERSION_EVENT_NAMES.includes(e.event));
}

function secondaryConversionEvents(auditData: AuditData): DataLayerEvent[] {
  const names = (auditData.declared_conversions ?? []).filter((c) => c.kind === 'secondary').map((c) => c.name);
  return auditData.dataLayer.filter((e) => names.includes(e.event));
}

/** The last non-init step the crawl visited — the presumed conversion surface. */
function completionStep(auditData: AuditData): string | undefined {
  const steps = (auditData.steps_visited ?? []).filter((s) => s !== 'init');
  return steps[steps.length - 1];
}

function hasAnyKey(event: DataLayerEvent, keys: string[]): boolean {
  return keys.some((k) => {
    const v = event[k];
    return v !== undefined && v !== null && v !== '';
  });
}

function eventsHaveAnyKey(events: DataLayerEvent[], keys: string[]): boolean {
  return events.some((e) => hasAnyKey(e, keys));
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

// ── L6.1 — Conversion value present ───────────────────────────────────────────

export const CONVERSION_VALUE_PRESENT: ValidationRule = {
  id: 'L6.1',
  rule_id: 'CONVERSION_VALUE_PRESENT',
  layer: 'parameter_completeness',
  check: 'Conversion value present',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'A value parameter is attached to the conversion');

    const hasValue = events.some((e) => e.value !== undefined && e.value !== null && e.value !== '');

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: hasValue ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasValue ? `value present: ${String(events.find((e) => e.value !== undefined)?.value)}` : 'No value parameter on the conversion event',
        expected: 'Without a value, value-based bidding has nothing to optimise toward',
        evidence: [`Conversion events checked: ${events.length}`, `With value: ${events.filter((e) => e.value !== undefined && e.value !== null && e.value !== '').length}`],
      },
    };
  },
};

// ── L6.2 — Value is non-zero and plausible ────────────────────────────────────

export const VALUE_NON_ZERO_AND_PLAUSIBLE: ValidationRule = {
  id: 'L6.2',
  rule_id: 'VALUE_NON_ZERO_AND_PLAUSIBLE',
  layer: 'parameter_completeness',
  check: 'Value is non-zero and plausible',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData).filter((e) => e.value !== undefined && e.value !== null && e.value !== '');
    if (events.length === 0) return skippedNoConversion(this, 'Value is not 0, null, or a constant placeholder');

    const values = events.map((e) => Number(e.value));
    const implausible = values.filter((v) => Number.isNaN(v) || v <= 0 || v >= 1_000_000);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: implausible.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: implausible.length > 0 ? `Implausible value(s): ${implausible.join(', ')}` : `Plausible value(s): ${values.join(', ')}`,
        expected: 'A constant/zero/null value is functionally identical to no value',
        evidence: [`Observed value(s): ${values.join(', ')}`],
      },
    };
  },
};

// ── L6.3 — Value differentiates outcomes ──────────────────────────────────────
//
// A single crawl only walks one funnel path, so it can't observe two
// distinct primary-conversion outcomes to compare directly. The one
// comparison this data does support: does the primary conversion's value
// differ from a declared secondary/micro-conversion's value, when both
// carry one. Skipped — not failed — when there's nothing to compare.

export const VALUE_DIFFERENTIATES_OUTCOMES: ValidationRule = {
  id: 'L6.3',
  rule_id: 'VALUE_DIFFERENTIATES_OUTCOMES',
  layer: 'parameter_completeness',
  check: 'Value differentiates outcomes',
  severity: 'critical',
  applies_to: ['plg_saas', 'lead_gen_b2b', 'subscription_media'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const primaryValue = conversionEvents(auditData).find((e) => e.value !== undefined && e.value !== null)?.value;
    const secondaryValues = secondaryConversionEvents(auditData)
      .map((e) => e.value)
      .filter((v): v is number | string => v !== undefined && v !== null);

    if (primaryValue === undefined || secondaryValues.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No primary + secondary conversion value pair observed in this crawl to compare',
          expected: 'Different conversion outcomes carry different values',
          evidence: ['Rule skipped — a single-path crawl cannot observe two distinct outcomes on its own'],
        },
      };
    }

    const identical = secondaryValues.some((v) => String(v) === String(primaryValue));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: identical ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: identical
          ? `Primary conversion value (${primaryValue}) matches a secondary conversion's value`
          : `Primary conversion value (${primaryValue}) differs from observed secondary conversion value(s)`,
        expected: 'Where every conversion is worth the same, the model cannot prefer better customers',
        evidence: [`Primary value: ${primaryValue}`, `Secondary value(s): ${secondaryValues.join(', ')}`],
      },
    };
  },
};

// ── L6.4 — Currency present and valid ─────────────────────────────────────────

export const CURRENCY_PRESENT_AND_VALID: ValidationRule = {
  id: 'L6.4',
  rule_id: 'CURRENCY_PRESENT_AND_VALID',
  layer: 'parameter_completeness',
  check: 'Currency present and valid',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'A valid ISO 4217 currency code accompanies the value');

    const valid = events.some((e) => typeof e.currency === 'string' && /^[A-Z]{3}$/.test(e.currency));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: valid ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: valid ? `Valid currency: ${events.find((e) => typeof e.currency === 'string')?.currency}` : `No valid ISO 4217 currency code found (observed: ${events.map((e) => e.currency).filter(Boolean).join(', ') || 'none'})`,
        expected: 'Multi-currency reporting silently misreports without a valid currency code',
        evidence: [`Currency value(s) observed: ${events.map((e) => e.currency).filter(Boolean).join(', ') || 'none'}`],
      },
    };
  },
};

// ── L6.5 — Transaction or order ID present ────────────────────────────────────

export const TRANSACTION_ID_PRESENT: ValidationRule = {
  id: 'L6.5',
  rule_id: 'TRANSACTION_ID_PRESENT',
  layer: 'parameter_completeness',
  check: 'Transaction or order ID present',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'A unique identifier for the conversion instance is attached');

    const present = events.some((e) => !!e.transaction_id && e.transaction_id !== 'null' && e.transaction_id !== 'undefined');

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: present ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: present ? `transaction_id present: ${events.find((e) => e.transaction_id)?.transaction_id}` : 'No transaction_id on the conversion event',
        expected: 'transaction_id is the key for deduplication and for reconciliation against billing',
        evidence: [`Conversion events checked: ${events.length}`, `With transaction_id: ${events.filter((e) => !!e.transaction_id).length}`],
      },
    };
  },
};

// ── L6.7 — event_id present ────────────────────────────────────────────────────

export const EVENT_ID_PRESENT: ValidationRule = {
  id: 'L6.7',
  rule_id: 'EVENT_ID_PRESENT',
  layer: 'parameter_completeness',
  check: 'event_id present',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'A deduplication ID (event_id) is generated per event');

    const present = events.some((e) => !!e.event_id);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: present ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: present ? `event_id present: ${events.find((e) => e.event_id)?.event_id}` : 'No event_id on the conversion event',
        expected: 'event_id is required for client and server deduplication',
        evidence: [`Conversion events checked: ${events.length}`, `With event_id: ${events.filter((e) => !!e.event_id).length}`],
      },
    };
  },
};

// ── L6.9-6.16 — Business-context fields matched against candidate keys ───────
//
// None of these have a fixed schema field the way transaction_id/currency
// do — a site's own dataLayer push can name them anything reasonable, so
// each checks a short list of the names real implementations actually use.

function makeCandidateKeyRule(opts: {
  id: string;
  rule_id: string;
  check: string;
  severity: ValidationRule['severity'];
  applies_to: SiteType[] | 'all';
  candidateKeys: string[];
  expected: string;
  scanScope?: 'conversion' | 'all';
}): ValidationRule {
  return {
    id: opts.id,
    rule_id: opts.rule_id,
    layer: 'parameter_completeness',
    check: opts.check,
    severity: opts.severity,
    applies_to: opts.applies_to,
    platform_scope: 'any',
    detectable_by: 'crawl',
    owner: 'Backend',
    requires: ['conversion_surface'],

    test(auditData: AuditData): ValidationResult {
      const scanEvents = opts.scanScope === 'all' ? auditData.dataLayer : conversionEvents(auditData);
      if (scanEvents.length === 0) return skippedNoConversion(this, opts.expected);

      const present = eventsHaveAnyKey(scanEvents, opts.candidateKeys);

      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: present ? 'pass' : 'fail',
        severity: this.severity,
        technical_details: {
          found: present ? `Found one of: ${opts.candidateKeys.join(', ')}` : `None of ${opts.candidateKeys.join(', ')} present on the conversion event`,
          expected: opts.expected,
          evidence: [`Checked keys: ${opts.candidateKeys.join(', ')}`, `Events scanned: ${scanEvents.length}`],
        },
      };
    },
  };
}

export const NEW_VS_RETURNING_FLAG = makeCandidateKeyRule({
  id: 'L6.9',
  rule_id: 'NEW_VS_RETURNING_FLAG',
  check: 'New versus returning flag',
  severity: 'medium',
  applies_to: ['ecommerce', 'plg_saas', 'subscription_media'],
  candidateKeys: ['new_customer', 'customerType', 'customer_type', 'is_new_customer', 'new_vs_returning'],
  expected: 'The conversion carries an indicator of first purchase or repeat, so the platform can bid differently for acquisition vs. expansion',
});

export const PLAN_OR_TIER_IDENTIFIER = makeCandidateKeyRule({
  id: 'L6.10',
  rule_id: 'PLAN_OR_TIER_IDENTIFIER',
  check: 'Plan or tier identifier',
  severity: 'high',
  applies_to: ['plg_saas', 'subscription_media'],
  candidateKeys: ['plan', 'tier', 'plan_tier', 'subscription_tier', 'plan_name'],
  expected: 'Subscription tier is attached to the conversion, distinguishing a low tier from a top tier',
});

export const BILLING_PERIOD_ATTACHED = makeCandidateKeyRule({
  id: 'L6.11',
  rule_id: 'BILLING_PERIOD_ATTACHED',
  check: 'Billing period attached',
  severity: 'high',
  applies_to: ['plg_saas', 'subscription_media'],
  candidateKeys: ['billing_period', 'billing_cycle', 'interval', 'plan_interval'],
  expected: 'Monthly vs. annual is recorded — annual and monthly customers have very different values and identical events otherwise',
});

export const SEAT_OR_QUANTITY_ATTACHED = makeCandidateKeyRule({
  id: 'L6.12',
  rule_id: 'SEAT_OR_QUANTITY_ATTACHED',
  check: 'Seat or quantity attached',
  severity: 'medium',
  applies_to: ['plg_saas', 'ecommerce', 'marketplace'],
  candidateKeys: ['seats', 'quantity', 'seat_count', 'num_seats', 'units'],
  expected: 'Number of seats or units is recorded — expansion revenue is invisible without it',
});

export const LEAD_QUALITY_INDICATOR = makeCandidateKeyRule({
  id: 'L6.15',
  rule_id: 'LEAD_QUALITY_INDICATOR',
  check: 'Lead quality indicator',
  severity: 'high',
  applies_to: ['lead_gen_b2b'],
  candidateKeys: ['lead_score', 'lead_quality', 'qualification', 'mql_score', 'lead_grade'],
  expected: 'Form conversions carry a qualification or scoring field, so the platform can learn which leads are worth having',
});

export const COUPON_OR_DISCOUNT_CAPTURED = makeCandidateKeyRule({
  id: 'L6.16',
  rule_id: 'COUPON_OR_DISCOUNT_CAPTURED',
  check: 'Coupon or discount captured',
  severity: 'low',
  applies_to: ['ecommerce', 'subscription_media'],
  candidateKeys: ['coupon', 'discount_code', 'promo_code'],
  expected: 'A promotional code recorded on the conversion distinguishes discounted from full-price acquisition',
});

// ── L6.13 — Items array populated ─────────────────────────────────────────────

export const ITEMS_ARRAY_POPULATED: ValidationRule = {
  id: 'L6.13',
  rule_id: 'ITEMS_ARRAY_POPULATED',
  layer: 'parameter_completeness',
  check: 'Items array populated',
  severity: 'medium',
  applies_to: ['ecommerce', 'marketplace'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'Line-item detail is attached to the conversion');

    const populated = events.some(
      (e) => Array.isArray(e.items) && e.items.length > 0 && e.items.some((item) => item.id && item.price !== undefined && item.quantity !== undefined),
    );

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: populated ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: populated ? `items array populated (${events.find((e) => Array.isArray(e.items) && e.items.length > 0)?.items?.length} item(s))` : 'No populated items array on the conversion event',
        expected: 'Product-level return analysis depends on line-item detail (id, price, quantity)',
        evidence: [`Conversion events checked: ${events.length}`],
      },
    };
  },
};

// ── L6.14 — Proxy value on stage events ───────────────────────────────────────

export const PROXY_VALUE_ON_STAGE_EVENTS: ValidationRule = {
  id: 'L6.14',
  rule_id: 'PROXY_VALUE_ON_STAGE_EVENTS',
  layer: 'parameter_completeness',
  check: 'Proxy value on stage events',
  severity: 'high',
  applies_to: ['plg_saas', 'lead_gen_b2b'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const completion = completionStep(auditData);
    const stageEvents = auditData.dataLayer.filter((e) => e.step !== 'init' && e.step !== completion);

    if (stageEvents.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No intermediate funnel-stage events observed before the completion step',
          expected: 'Intermediate funnel stages carry an estimated value',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const withValue = eventsHaveAnyKey(stageEvents, ['value', 'proxy_value']);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: withValue ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: withValue ? 'At least one intermediate stage event carries a value/proxy_value' : `${stageEvents.length} intermediate stage event(s) with no value or proxy_value`,
        expected: 'Long cycles need early signal — waiting for the final conversion is too slow to train on',
        evidence: [`Intermediate events checked: ${stageEvents.length}`, `Steps: ${[...new Set(stageEvents.map((e) => e.step))].join(', ')}`],
      },
    };
  },
};

// ── L6.17 — Shipping and tax separated ────────────────────────────────────────

export const SHIPPING_AND_TAX_SEPARATED: ValidationRule = {
  id: 'L6.17',
  rule_id: 'SHIPPING_AND_TAX_SEPARATED',
  layer: 'parameter_completeness',
  check: 'Shipping and tax separated',
  severity: 'low',
  applies_to: ['ecommerce'],
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Backend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const events = conversionEvents(auditData);
    if (events.length === 0) return skippedNoConversion(this, 'Value excludes, or separately records, shipping and tax');

    const separated = events.some((e) => (e.shipping !== undefined && e.shipping !== null) || hasAnyKey(e, ['tax']));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: separated ? 'pass' : 'warning',
      severity: this.severity,
      technical_details: {
        found: separated ? 'shipping/tax recorded separately from value' : 'No separate shipping/tax field found — value may bundle them in',
        expected: 'Bundling shipping/tax into value inflates the reported return',
        evidence: [`Conversion events checked: ${events.length}`],
      },
    };
  },
};

export const L6_RULES: ValidationRule[] = [
  CONVERSION_VALUE_PRESENT,
  VALUE_NON_ZERO_AND_PLAUSIBLE,
  VALUE_DIFFERENTIATES_OUTCOMES,
  CURRENCY_PRESENT_AND_VALID,
  TRANSACTION_ID_PRESENT,
  EVENT_ID_PRESENT,
  NEW_VS_RETURNING_FLAG,
  PLAN_OR_TIER_IDENTIFIER,
  BILLING_PERIOD_ATTACHED,
  SEAT_OR_QUANTITY_ATTACHED,
  ITEMS_ARRAY_POPULATED,
  PROXY_VALUE_ON_STAGE_EVENTS,
  LEAD_QUALITY_INDICATOR,
  COUPON_OR_DISCOUNT_CAPTURED,
  SHIPPING_AND_TAX_SEPARATED,
];
