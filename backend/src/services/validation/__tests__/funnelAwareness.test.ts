/**
 * Funnel-type awareness in the validation engine.
 *
 * Regression coverage for the bug where a SaaS/lead_gen audit's report read
 * as if ecommerce had been selected: every rule ran unconditionally and many
 * were hardcoded to look for a dataLayer `purchase` event, which SaaS/lead_gen
 * journeys never fire (see JOURNEY_CONFIGS — saas ends at signup/onboarding,
 * lead_gen at thank_you). Covers two fixes:
 *   1. Rules conceptually specific to ecommerce (funnel_types: ['ecommerce'])
 *      are excluded entirely for other funnels instead of auto-failing.
 *   2. Rules that check something universal (value/currency/email present,
 *      event_id generated, PII hashed, etc.) now resolve the funnel-appropriate
 *      conversion event via conversionEvent.ts instead of hardcoding 'purchase'.
 */
import { describe, it, expect } from 'vitest';
import { runAllRules, runRulesForPlatforms } from '../engine';
import { getConversionEvent, getConversionEvents, CONVERSION_EVENT_NAME } from '../conversionEvent';
import { makePerfectAuditData, makePurchaseEvent } from './mockAuditData';
import type { AuditData, DataLayerEvent } from '@/types/audit';

const ECOMMERCE_ONLY_RULE_IDS = [
  'GA4_PURCHASE_EVENT_FIRED',
  'META_PIXEL_PURCHASE_EVENT_FIRED',
  'ADD_TO_CART_EVENT_FIRED',
  'ITEMS_ARRAY_POPULATED',
  'COUPON_CAPTURED_IF_USED',
  'SHIPPING_CAPTURED',
  'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
  'TRANSACTION_ID_PRESENT',
];

// Reuses the "perfect" ecommerce fixture's purchase event as the conversion
// event, just renamed/re-stepped for the target funnel — every field these
// rules check (value, currency, user_data, event_id, gclid, items) is
// otherwise identical, isolating "does event-name resolution work" from
// "is the field-level logic correct" (already covered by engine.test.ts).
function makeFunnelAuditData(funnelType: 'saas' | 'lead_gen', step: string): AuditData {
  const eventName = CONVERSION_EVENT_NAME[funnelType];
  const conversionEvent: DataLayerEvent = makePurchaseEvent({ event: eventName, step });
  const base = makePerfectAuditData({ funnel_type: funnelType });
  return {
    ...base,
    dataLayer: [
      { event: 'page_view', timestamp: Date.now(), step: 'landing' },
      conversionEvent,
    ],
  };
}

describe('conversionEvent — funnel-appropriate event resolution', () => {
  it('resolves purchase for ecommerce', () => {
    expect(CONVERSION_EVENT_NAME.ecommerce).toBe('purchase');
  });

  it('resolves sign_up for saas', () => {
    expect(CONVERSION_EVENT_NAME.saas).toBe('sign_up');
  });

  it('resolves generate_lead for lead_gen', () => {
    expect(CONVERSION_EVENT_NAME.lead_gen).toBe('generate_lead');
  });

  it('getConversionEvents filters dataLayer by the funnel-appropriate event name', () => {
    const auditData = makeFunnelAuditData('saas', 'signup');
    const events = getConversionEvents(auditData);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('sign_up');
  });

  it('getConversionEvent falls back to purchase resolution for a malformed/missing funnel_type', () => {
    const auditData = { ...makePerfectAuditData(), funnel_type: undefined } as unknown as AuditData;
    const event = getConversionEvent(auditData);
    expect(event?.event).toBe('purchase');
  });
});

describe('runAllRules — ecommerce-only rules excluded for other funnels', () => {
  it('runs all ecommerce-only rules for an ecommerce audit', () => {
    const results = runAllRules(makePerfectAuditData());
    const ranIds = new Set(results.map((r) => r.rule_id));
    for (const id of ECOMMERCE_ONLY_RULE_IDS) {
      expect(ranIds.has(id)).toBe(true);
    }
  });

  it('excludes every ecommerce-only rule for a saas audit', () => {
    const results = runAllRules(makeFunnelAuditData('saas', 'signup'));
    const ranIds = new Set(results.map((r) => r.rule_id));
    for (const id of ECOMMERCE_ONLY_RULE_IDS) {
      expect(ranIds.has(id)).toBe(false);
    }
  });

  it('excludes every ecommerce-only rule for a lead_gen audit', () => {
    const results = runAllRules(makeFunnelAuditData('lead_gen', 'thank_you'));
    const ranIds = new Set(results.map((r) => r.rule_id));
    for (const id of ECOMMERCE_ONLY_RULE_IDS) {
      expect(ranIds.has(id)).toBe(false);
    }
  });

  it('never reports a fail/warning for an excluded ecommerce-only rule on a saas audit', () => {
    const results = runAllRules(makeFunnelAuditData('saas', 'signup'));
    const badStatuses = results.filter(
      (r) => ECOMMERCE_ONLY_RULE_IDS.includes(r.rule_id) && r.status !== 'pass',
    );
    expect(badStatuses).toHaveLength(0);
  });
});

describe('runAllRules — funnel-aware rules pass against the right event for saas/lead_gen', () => {
  it('a well-instrumented saas signup event passes the generic conversion-parameter rules', () => {
    const results = runAllRules(makeFunnelAuditData('saas', 'signup'));
    const byId = new Map(results.map((r) => [r.rule_id, r]));

    for (const ruleId of [
      'VALUE_PARAMETER_PRESENT',
      'CURRENCY_PARAMETER_PRESENT',
      'EVENT_ID_GENERATED',
      'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
      'PHONE_CAPTURED_FOR_CAPI',
      'USER_ID_PRESENT',
      'GCLID_PERSISTS_TO_CONVERSION',
      'PII_PROPERLY_HASHED',
    ]) {
      expect(byId.get(ruleId)?.status, `${ruleId} should pass`).toBe('pass');
    }

    // makePurchaseEvent's phone is a hashed-looking value (for PII_PROPERLY_HASHED
    // above), which legitimately isn't "digits only" — so this is a warning, not a
    // fail, on the shared fixture regardless of funnel. Just confirm it's not 'fail'.
    expect(byId.get('USER_DATA_NORMALIZED_CONSISTENTLY')?.status).not.toBe('fail');
  });

  it('a well-instrumented lead_gen generate_lead event passes the same rules', () => {
    const results = runAllRules(makeFunnelAuditData('lead_gen', 'thank_you'));
    const byId = new Map(results.map((r) => [r.rule_id, r]));

    for (const ruleId of [
      'VALUE_PARAMETER_PRESENT',
      'CURRENCY_PARAMETER_PRESENT',
      'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
      'PHONE_CAPTURED_FOR_CAPI',
      'USER_ID_PRESENT',
    ]) {
      expect(byId.get(ruleId)?.status, `${ruleId} should pass`).toBe('pass');
    }
  });

  it('a saas audit with no sign_up event fails the generic conversion-parameter rules (not silently skipped)', () => {
    const auditData: AuditData = {
      ...makePerfectAuditData({ funnel_type: 'saas' }),
      dataLayer: [{ event: 'page_view', timestamp: Date.now(), step: 'landing' }],
    };
    const results = runAllRules(auditData);
    const byId = new Map(results.map((r) => [r.rule_id, r]));

    expect(byId.get('VALUE_PARAMETER_PRESENT')?.status).toBe('fail');
    expect(byId.get('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS')?.status).toBe('fail');
  });
});

describe('runRulesForPlatforms — funnel filter applies alongside platform filter', () => {
  it('excludes ecommerce-only rules for a saas audit even when platforms are selected', () => {
    const results = runRulesForPlatforms(
      ['google_ads', 'meta', 'ga4', 'sgtm'],
      makeFunnelAuditData('saas', 'signup'),
    );
    const ranIds = new Set(results.map((r) => r.rule_id));
    for (const id of ECOMMERCE_ONLY_RULE_IDS) {
      expect(ranIds.has(id)).toBe(false);
    }
  });
});
