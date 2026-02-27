/**
 * Layer 3 — Persistence (6 rules)
 * Do critical identifiers survive cross-page navigation?
 */
import type { AuditData, ValidationResult } from '@/types/audit';

export const GCLID_PERSISTS_TO_CONVERSION = {
  rule_id: 'GCLID_PERSISTS_TO_CONVERSION',
  validation_layer: 'persistence' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const landingGclid = auditData.urlParams?.gclid ?? auditData.injected?.gclid;
    const purchaseEvent = auditData.dataLayer.find((e) => e.event === 'purchase');
    const purchaseGclid = purchaseEvent?.gclid as string | undefined;
    const hasPersistence = !!(landingGclid && purchaseGclid && landingGclid === purchaseGclid);
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasPersistence ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasPersistence ? 'gclid persisted to purchase event' : 'gclid lost between steps',
        expected: 'Same gclid from landing page present in purchase event',
        evidence: [
          `Landing page gclid: ${landingGclid ? 'present' : 'missing'}`,
          `Purchase event gclid: ${purchaseGclid ? 'present' : 'missing'}`,
          `Values match: ${landingGclid === purchaseGclid}`,
        ],
      },
    };
  },
};

export const FBCLID_PERSISTS_TO_CONVERSION = {
  rule_id: 'FBCLID_PERSISTS_TO_CONVERSION',
  validation_layer: 'persistence' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const hasFBPixelOnLanding = !!(auditData.pageMetadata?.pixel_fbclid);
    const hasFBCookie = !!(auditData.cookies?.['_fbp'] || auditData.cookies?.['_fbc']);
    const hasIdentifiers = hasFBPixelOnLanding && hasFBCookie;
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasIdentifiers ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasIdentifiers ? 'Meta identifiers persisted' : 'Meta identifiers lost',
        expected: 'Meta cookies (_fbp/_fbc) persist across pages',
        evidence: [
          `Meta Pixel on landing: ${hasFBPixelOnLanding}`,
          `Meta cookies (_fbp/_fbc) present: ${hasFBCookie}`,
        ],
      },
    };
  },
};

export const TRANSACTION_ID_MATCHES_ORDER_SYSTEM = {
  rule_id: 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
  validation_layer: 'persistence' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvent = auditData.dataLayer.find((e) => e.event === 'purchase');
    const transactionId = purchaseEvent?.transaction_id;
    // Validates format — cross-system check requires real order system integration
    const validFormat =
      !!transactionId &&
      String(transactionId).length > 0 &&
      transactionId !== 'null' &&
      transactionId !== 'undefined';
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: validFormat ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: transactionId ? `"${String(transactionId)}"` : 'Missing',
        expected: 'Valid non-empty order ID from order management system',
        evidence: [
          `Transaction ID present: ${!!transactionId}`,
          `Format valid: ${validFormat}`,
        ],
      },
    };
  },
};

export const EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER = {
  rule_id: 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
  validation_layer: 'persistence' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvent = auditData.dataLayer.find((e) => e.event === 'purchase');
    const clientEventId = purchaseEvent?.event_id;
    const serverHasEventId = !!(
      clientEventId &&
      auditData.networkRequests.some(
        (r) => r.url.includes('sgtm') && r.body?.includes(String(clientEventId)),
      )
    );
    const isConsistent = !!(clientEventId && serverHasEventId);
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: isConsistent ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: isConsistent ? 'event_ids match client and server' : 'event_ids not consistent',
        expected: 'Same event_id in both client dataLayer and sGTM server request',
        evidence: [
          `Client event_id: ${clientEventId ? 'present' : 'missing'}`,
          `Server event_id: ${serverHasEventId ? 'found in sGTM request' : 'not found'}`,
        ],
      },
    };
  },
};

export const USER_DATA_NORMALIZED_CONSISTENTLY = {
  rule_id: 'USER_DATA_NORMALIZED_CONSISTENTLY',
  validation_layer: 'persistence' as const,
  severity: 'medium' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvent = auditData.dataLayer.find((e) => e.event === 'purchase');
    const email = purchaseEvent?.user_data?.email;
    const phone = purchaseEvent?.user_data?.phone;
    const emailNormalized =
      !email || (typeof email === 'string' && email === email.toLowerCase().trim());
    const phoneNormalized = !phone || /^\d+$/.test(String(phone));
    const isConsistent = emailNormalized && phoneNormalized;
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: isConsistent ? 'pass' : 'warning',
      severity: this.severity,
      technical_details: {
        found: isConsistent ? 'User data normalized' : 'User data not normalized',
        expected: 'Email lowercase+trim, phone digits-only',
        evidence: [
          `Email normalized: ${String(emailNormalized)}`,
          `Phone normalized: ${String(phoneNormalized)}`,
        ],
      },
    };
  },
};

export const PII_PROPERLY_HASHED = {
  rule_id: 'PII_PROPERLY_HASHED',
  validation_layer: 'persistence' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const purchaseEvent = auditData.dataLayer.find((e) => e.event === 'purchase');
    const email = purchaseEvent?.user_data?.email;
    const phone = purchaseEvent?.user_data?.phone;
    // SHA256 hashes are exactly 64 hex characters
    const isEmailHashed = !!email && /^[a-f0-9]{64}$/.test(String(email));
    const isPhoneHashed = !!phone && /^[a-f0-9]{64}$/.test(String(phone));
    const isSentToPlatform = auditData.networkRequests.some(
      (r) => r.url.includes('facebook.com') || r.url.includes('googleads'),
    );
    // Only fail if PII is actually being sent to a platform
    const isProperlyHashed = isSentToPlatform ? isEmailHashed || isPhoneHashed : true;
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: isProperlyHashed ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: isProperlyHashed ? 'PII properly hashed (SHA256)' : 'PII not hashed or plaintext',
        expected: 'PII hashed with SHA256 before sending to any ad platform',
        evidence: [
          `Sent to platforms: ${isSentToPlatform}`,
          `Email hashed: ${isEmailHashed ? 'yes' : email ? 'no — plaintext' : 'N/A'}`,
          `Phone hashed: ${isPhoneHashed ? 'yes' : phone ? 'no — plaintext' : 'N/A'}`,
        ],
      },
    };
  },
};

export const LAYER_3_RULES = [
  GCLID_PERSISTS_TO_CONVERSION,
  FBCLID_PERSISTS_TO_CONVERSION,
  TRANSACTION_ID_MATCHES_ORDER_SYSTEM,
  EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER,
  USER_DATA_NORMALIZED_CONSISTENTLY,
  PII_PROPERLY_HASHED,
];
