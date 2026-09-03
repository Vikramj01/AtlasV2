/**
 * Layer L6 — Parameter Completeness rule tests.
 *
 * Covers each of the 15 crawl-detectable rules' pass/fail/skipped/warning
 * branches. L6.6 (second-pass detectable) and L6.8 (credentials
 * detectable) are out of scope for this phase — not tested here because
 * they aren't shipped.
 */
import { describe, it, expect } from 'vitest';
import {
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
  L6_RULES,
} from '../L6';
import type { AuditData, DataLayerEvent } from '@/types/audit';

function makeEvent(overrides: Partial<DataLayerEvent> = {}): DataLayerEvent {
  return { event: 'purchase', timestamp: Date.now(), step: 'confirmation', ...overrides };
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
    steps_visited: ['init', 'landing', 'confirmation'],
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── L6.1 — Conversion value present ───────────────────────────────────────────

describe('CONVERSION_VALUE_PRESENT (L6.1)', () => {
  it('is skipped when no conversion event was observed', () => {
    expect(CONVERSION_VALUE_PRESENT.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the conversion event carries a value', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ value: 99.99 })] });
    expect(CONVERSION_VALUE_PRESENT.test(auditData).status).toBe('pass');
  });

  it('fails when the conversion event has no value', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(CONVERSION_VALUE_PRESENT.test(auditData).status).toBe('fail');
  });
});

// ── L6.2 — Value is non-zero and plausible ────────────────────────────────────

describe('VALUE_NON_ZERO_AND_PLAUSIBLE (L6.2)', () => {
  it('is skipped when no value is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(VALUE_NON_ZERO_AND_PLAUSIBLE.test(auditData).status).toBe('skipped');
  });

  it('passes for a plausible positive value', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ value: 49.99 })] });
    expect(VALUE_NON_ZERO_AND_PLAUSIBLE.test(auditData).status).toBe('pass');
  });

  it('fails for a zero value', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ value: 0 })] });
    expect(VALUE_NON_ZERO_AND_PLAUSIBLE.test(auditData).status).toBe('fail');
  });

  it('fails for an implausibly large value', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ value: 5_000_000 })] });
    expect(VALUE_NON_ZERO_AND_PLAUSIBLE.test(auditData).status).toBe('fail');
  });
});

// ── L6.3 — Value differentiates outcomes ──────────────────────────────────────

describe('VALUE_DIFFERENTIATES_OUTCOMES (L6.3)', () => {
  it('is skipped when there is no primary+secondary value pair to compare', () => {
    expect(VALUE_DIFFERENTIATES_OUTCOMES.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when the primary and secondary values differ', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'purchase', kind: 'primary' }, { name: 'add_to_cart', kind: 'secondary' }],
      dataLayer: [makeEvent({ event: 'purchase', value: 200 }), makeEvent({ event: 'add_to_cart', value: 20 })],
    });
    expect(VALUE_DIFFERENTIATES_OUTCOMES.test(auditData).status).toBe('pass');
  });

  it('fails when the primary and secondary values are identical', () => {
    const auditData = makeAuditData({
      declared_conversions: [{ name: 'purchase', kind: 'primary' }, { name: 'add_to_cart', kind: 'secondary' }],
      dataLayer: [makeEvent({ event: 'purchase', value: 20 }), makeEvent({ event: 'add_to_cart', value: 20 })],
    });
    expect(VALUE_DIFFERENTIATES_OUTCOMES.test(auditData).status).toBe('fail');
  });
});

// ── L6.4 — Currency present and valid ─────────────────────────────────────────

describe('CURRENCY_PRESENT_AND_VALID (L6.4)', () => {
  it('is skipped when no conversion event was observed', () => {
    expect(CURRENCY_PRESENT_AND_VALID.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes for a valid 3-letter code', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ currency: 'USD' })] });
    expect(CURRENCY_PRESENT_AND_VALID.test(auditData).status).toBe('pass');
  });

  it('fails for a missing or malformed currency', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ currency: 'dollars' })] });
    expect(CURRENCY_PRESENT_AND_VALID.test(auditData).status).toBe('fail');
  });
});

// ── L6.5 — Transaction or order ID present ────────────────────────────────────

describe('TRANSACTION_ID_PRESENT (L6.5)', () => {
  it('passes when transaction_id is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ transaction_id: 'ORDER-1' })] });
    expect(TRANSACTION_ID_PRESENT.test(auditData).status).toBe('pass');
  });

  it('fails when transaction_id is absent', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(TRANSACTION_ID_PRESENT.test(auditData).status).toBe('fail');
  });
});

// ── L6.7 — event_id present ────────────────────────────────────────────────────

describe('EVENT_ID_PRESENT (L6.7)', () => {
  it('passes when event_id is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event_id: 'evt-1' })] });
    expect(EVENT_ID_PRESENT.test(auditData).status).toBe('pass');
  });

  it('fails when event_id is absent', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(EVENT_ID_PRESENT.test(auditData).status).toBe('fail');
  });
});

// ── L6.9-6.12, L6.15, L6.16 — Candidate-key business context fields ──────────

describe('NEW_VS_RETURNING_FLAG (L6.9)', () => {
  it('passes when a recognized key is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ new_customer: true })] });
    expect(NEW_VS_RETURNING_FLAG.test(auditData).status).toBe('pass');
  });
  it('fails when none are present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(NEW_VS_RETURNING_FLAG.test(auditData).status).toBe('fail');
  });
});

describe('PLAN_OR_TIER_IDENTIFIER (L6.10)', () => {
  it('passes when a recognized key is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ plan: 'pro' })] });
    expect(PLAN_OR_TIER_IDENTIFIER.test(auditData).status).toBe('pass');
  });
  it('fails when none are present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(PLAN_OR_TIER_IDENTIFIER.test(auditData).status).toBe('fail');
  });
});

describe('BILLING_PERIOD_ATTACHED (L6.11)', () => {
  it('passes when a recognized key is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ billing_period: 'annual' })] });
    expect(BILLING_PERIOD_ATTACHED.test(auditData).status).toBe('pass');
  });
  it('fails when none are present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(BILLING_PERIOD_ATTACHED.test(auditData).status).toBe('fail');
  });
});

describe('SEAT_OR_QUANTITY_ATTACHED (L6.12)', () => {
  it('passes when a recognized key is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ seats: 5 })] });
    expect(SEAT_OR_QUANTITY_ATTACHED.test(auditData).status).toBe('pass');
  });
  it('fails when none are present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(SEAT_OR_QUANTITY_ATTACHED.test(auditData).status).toBe('fail');
  });
});

describe('LEAD_QUALITY_INDICATOR (L6.15)', () => {
  it('passes when a recognized key is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event: 'submit_lead_form', lead_score: 80 })] });
    expect(LEAD_QUALITY_INDICATOR.test(auditData).status).toBe('pass');
  });
  it('fails when none are present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ event: 'submit_lead_form' })] });
    expect(LEAD_QUALITY_INDICATOR.test(auditData).status).toBe('fail');
  });
});

describe('COUPON_OR_DISCOUNT_CAPTURED (L6.16)', () => {
  it('passes when a recognized key is present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ coupon: 'SAVE10' })] });
    expect(COUPON_OR_DISCOUNT_CAPTURED.test(auditData).status).toBe('pass');
  });
  it('fails when none are present', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(COUPON_OR_DISCOUNT_CAPTURED.test(auditData).status).toBe('fail');
  });
});

// ── L6.13 — Items array populated ─────────────────────────────────────────────

describe('ITEMS_ARRAY_POPULATED (L6.13)', () => {
  it('passes when items array has a well-formed line item', () => {
    const auditData = makeAuditData({
      dataLayer: [makeEvent({ items: [{ id: 'sku-1', price: 10, quantity: 1 }] })],
    });
    expect(ITEMS_ARRAY_POPULATED.test(auditData).status).toBe('pass');
  });

  it('fails when items array is missing or empty', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(ITEMS_ARRAY_POPULATED.test(auditData).status).toBe('fail');
  });
});

// ── L6.14 — Proxy value on stage events ───────────────────────────────────────

describe('PROXY_VALUE_ON_STAGE_EVENTS (L6.14)', () => {
  it('is skipped when there are no intermediate stage events', () => {
    const auditData = makeAuditData({ steps_visited: ['init', 'confirmation'], dataLayer: [makeEvent({ step: 'confirmation' })] });
    expect(PROXY_VALUE_ON_STAGE_EVENTS.test(auditData).status).toBe('skipped');
  });

  it('passes when an intermediate stage event carries a value', () => {
    const auditData = makeAuditData({
      steps_visited: ['init', 'pricing', 'confirmation'],
      dataLayer: [makeEvent({ event: 'view_pricing', step: 'pricing', value: 10 }), makeEvent({ step: 'confirmation' })],
    });
    expect(PROXY_VALUE_ON_STAGE_EVENTS.test(auditData).status).toBe('pass');
  });

  it('fails when no intermediate stage event carries a value', () => {
    const auditData = makeAuditData({
      steps_visited: ['init', 'pricing', 'confirmation'],
      dataLayer: [makeEvent({ event: 'view_pricing', step: 'pricing' }), makeEvent({ step: 'confirmation' })],
    });
    expect(PROXY_VALUE_ON_STAGE_EVENTS.test(auditData).status).toBe('fail');
  });
});

// ── L6.17 — Shipping and tax separated ────────────────────────────────────────

describe('SHIPPING_AND_TAX_SEPARATED (L6.17)', () => {
  it('is skipped when no conversion event was observed', () => {
    expect(SHIPPING_AND_TAX_SEPARATED.test(makeAuditData()).status).toBe('skipped');
  });

  it('passes when shipping is recorded separately', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent({ shipping: 5.99 })] });
    expect(SHIPPING_AND_TAX_SEPARATED.test(auditData).status).toBe('pass');
  });

  it('warns when no separate shipping/tax field is found', () => {
    const auditData = makeAuditData({ dataLayer: [makeEvent()] });
    expect(SHIPPING_AND_TAX_SEPARATED.test(auditData).status).toBe('warning');
  });
});

describe('L6_RULES', () => {
  it('exports all 15 crawl-detectable L6 rules', () => {
    expect(L6_RULES).toHaveLength(15);
    expect(new Set(L6_RULES.map((r) => r.id)).size).toBe(15);
    expect(new Set(L6_RULES.map((r) => r.rule_id)).size).toBe(15);
  });

  it('excludes L6.6 (second-pass detectable) and L6.8 (credentials detectable)', () => {
    expect(L6_RULES.some((r) => ['L6.6', 'L6.8'].includes(r.id))).toBe(false);
  });
});
