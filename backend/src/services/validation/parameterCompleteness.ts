/**
 * Layer 2 — Parameter Completeness (12 rules)
 * Are required parameters present in conversion events?
 */
import type { AuditData, ValidationResult } from '@/types/audit';

export const TRANSACTION_ID_PRESENT = {
  rule_id: 'TRANSACTION_ID_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasTransactionID = purchaseEvents.some(
      (e) => e.transaction_id && e.transaction_id !== '' && e.transaction_id !== 'null',
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasTransactionID ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: String(purchaseEvents[0]?.transaction_id ?? 'Missing'),
        expected: 'Non-empty transaction_id (e.g., "ORDER-12345")',
        evidence: [
          `Purchase events with transaction_id: ${purchaseEvents.filter((e) => e.transaction_id).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const VALUE_PARAMETER_PRESENT = {
  rule_id: 'VALUE_PARAMETER_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasValue = purchaseEvents.some((e) => {
      const v = Number(e.value);
      return v > 0 && v < 1_000_000;
    });
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasValue ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: String(purchaseEvents[0]?.value ?? 'Missing'),
        expected: 'Numeric value > 0',
        evidence: [
          `Purchase events with value: ${purchaseEvents.filter((e) => Number(e.value) > 0).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const CURRENCY_PARAMETER_PRESENT = {
  rule_id: 'CURRENCY_PARAMETER_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasCurrency = purchaseEvents.some(
      (e) => e.currency && typeof e.currency === 'string' && e.currency.length === 3,
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasCurrency ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: String(purchaseEvents[0]?.currency ?? 'Missing'),
        expected: 'ISO 4217 currency code (3 letters, e.g., "USD")',
        evidence: [
          `Purchase events with currency: ${purchaseEvents.filter((e) => e.currency).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const GCLID_CAPTURED_AT_LANDING = {
  rule_id: 'GCLID_CAPTURED_AT_LANDING',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const gclidInUrl = auditData.urlParams?.gclid;
    const gclidInStorage = auditData.storage?.gclid;
    const hasGclid = !!(gclidInUrl || gclidInStorage);
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasGclid ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasGclid ? 'gclid found' : 'Missing',
        expected: 'gclid present in URL params or storage',
        evidence: [
          `gclid in URL: ${!!gclidInUrl}`,
          `gclid in storage: ${!!gclidInStorage}`,
        ],
      },
    };
  },
};

export const FBCLID_CAPTURED_AT_LANDING = {
  rule_id: 'FBCLID_CAPTURED_AT_LANDING',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const fbclid = auditData.urlParams?.fbclid;
    const hasFBPixel = auditData.networkRequests.some((r) => r.url.includes('facebook.com'));
    const hasIdentifiers = !!(fbclid || hasFBPixel);
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasIdentifiers ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasIdentifiers ? 'Meta identifiers detected' : 'Missing',
        expected: 'fbclid in URL or Meta Pixel loaded',
        evidence: [
          `fbclid in URL: ${!!fbclid}`,
          `Meta Pixel detected: ${hasFBPixel}`,
        ],
      },
    };
  },
};

export const EVENT_ID_GENERATED = {
  rule_id: 'EVENT_ID_GENERATED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const eventIds = purchaseEvents.map((e) => e.event_id).filter(Boolean);
    const uniqueIds = new Set(eventIds);
    const hasUniqueEventIds =
      purchaseEvents.length > 0 &&
      eventIds.length === purchaseEvents.length &&
      uniqueIds.size === eventIds.length;
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasUniqueEventIds ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: `${eventIds.length} events with IDs, ${uniqueIds.size} unique`,
        expected: 'Each purchase event has a unique event_id',
        evidence: [
          `Events with event_id: ${eventIds.length}/${purchaseEvents.length}`,
          `Unique event_ids: ${uniqueIds.size}`,
        ],
      },
    };
  },
};

export const EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS = {
  rule_id: 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasEmail = purchaseEvents.some((e) => {
      const email = e.user_data?.email;
      if (!email || typeof email !== 'string') return false;
      // Accept plain email (contains @) or pre-hashed SHA256 (64-char hex)
      return email.includes('@') || /^[a-f0-9]{64}$/.test(email);
    });
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasEmail ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: purchaseEvents[0]?.user_data?.email ? 'Email captured' : 'Missing',
        expected: 'Valid email in user_data.email',
        evidence: [
          `Events with email: ${purchaseEvents.filter((e) => e.user_data?.email).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const PHONE_CAPTURED_FOR_CAPI = {
  rule_id: 'PHONE_CAPTURED_FOR_CAPI',
  validation_layer: 'parameter_completeness' as const,
  severity: 'medium' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasPhone = purchaseEvents.some(
      (e) =>
        e.user_data?.phone &&
        String(e.user_data.phone).replace(/\D/g, '').length >= 10,
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasPhone ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: purchaseEvents[0]?.user_data?.phone ? 'Phone captured' : 'Missing',
        expected: 'Phone number with 10+ digits in user_data.phone',
        evidence: [
          `Events with phone: ${purchaseEvents.filter((e) => e.user_data?.phone).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const ITEMS_ARRAY_POPULATED = {
  rule_id: 'ITEMS_ARRAY_POPULATED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'medium' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasItems = purchaseEvents.some(
      (e) =>
        Array.isArray(e.items) &&
        e.items.length > 0 &&
        e.items.some((item) => item.id && item.price !== undefined && item.quantity !== undefined),
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasItems ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: purchaseEvents[0]?.items
          ? `${purchaseEvents[0].items.length} items`
          : 'Missing',
        expected: 'items array with 1+ products (id, price, quantity)',
        evidence: [
          `Events with items: ${purchaseEvents.filter((e) => Array.isArray(e.items) && e.items.length > 0).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const USER_ID_PRESENT = {
  rule_id: 'USER_ID_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasUserID = purchaseEvents.some(
      (e) => e.user_id && String(e.user_id).length > 0,
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasUserID ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: purchaseEvents[0]?.user_id ? 'user_id present' : 'Missing',
        expected: 'Unique user_id for repeat tracking',
        evidence: [
          `Events with user_id: ${purchaseEvents.filter((e) => e.user_id).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const COUPON_CAPTURED_IF_USED = {
  rule_id: 'COUPON_CAPTURED_IF_USED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'low' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasCoupon = purchaseEvents.some((e) => e.coupon && String(e.coupon).length > 0);
    // Warning (not fail) — coupon may legitimately not be used
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasCoupon || purchaseEvents.length === 0 ? 'pass' : 'warning',
      severity: this.severity,
      technical_details: {
        found: purchaseEvents[0]?.coupon ? 'coupon captured' : 'Not captured',
        expected: 'coupon code when a discount is applied',
        evidence: [
          `Events with coupon: ${purchaseEvents.filter((e) => e.coupon).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const SHIPPING_CAPTURED = {
  rule_id: 'SHIPPING_CAPTURED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'low' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvents = auditData.dataLayer.filter((e) => e.event === 'purchase');
    const hasShipping = purchaseEvents.some(
      (e) => e.shipping !== undefined && e.shipping !== null,
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasShipping || purchaseEvents.length === 0 ? 'pass' : 'warning',
      severity: this.severity,
      technical_details: {
        found: purchaseEvents[0]?.shipping !== undefined ? 'shipping captured' : 'Not captured',
        expected: 'shipping cost when applicable',
        evidence: [
          `Events with shipping: ${purchaseEvents.filter((e) => e.shipping !== undefined).length}/${purchaseEvents.length}`,
        ],
      },
    };
  },
};

export const LAYER_2_RULES = [
  TRANSACTION_ID_PRESENT,
  VALUE_PARAMETER_PRESENT,
  CURRENCY_PARAMETER_PRESENT,
  GCLID_CAPTURED_AT_LANDING,
  FBCLID_CAPTURED_AT_LANDING,
  EVENT_ID_GENERATED,
  EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS,
  PHONE_CAPTURED_FOR_CAPI,
  ITEMS_ARRAY_POPULATED,
  USER_ID_PRESENT,
  COUPON_CAPTURED_IF_USED,
  SHIPPING_CAPTURED,
];
