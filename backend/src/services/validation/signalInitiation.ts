/**
 * Layer 1 — Signal Initiation (8 rules)
 * Are conversion events firing at all?
 */
import type { AuditData, ValidationResult } from '@/types/audit';

export const GA4_PURCHASE_EVENT_FIRED = {
  rule_id: 'GA4_PURCHASE_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const hasGA4Event = auditData.dataLayer.some((e) => e.event === 'purchase');
    const hasGA4NetworkCall = auditData.networkRequests.some(
      (r) => r.url.includes('analytics.google.com') && r.body?.includes('purchase'),
    );
    const status = hasGA4Event || hasGA4NetworkCall ? 'pass' : 'fail';
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status,
      severity: this.severity,
      technical_details: {
        found: hasGA4Event ? 'GA4 event detected' : hasGA4NetworkCall ? 'GA4 network call detected' : 'Not found',
        expected: 'Purchase event fired on confirmation page',
        evidence: [
          `dataLayer purchase events: ${auditData.dataLayer.filter((e) => e.event === 'purchase').length}`,
          `GA4 network requests: ${auditData.networkRequests.filter((r) => r.url.includes('analytics.google.com')).length}`,
        ],
      },
    };
  },
};

export const META_PIXEL_PURCHASE_EVENT_FIRED = {
  rule_id: 'META_PIXEL_PURCHASE_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const hasMetaPixelEvent = auditData.networkRequests.some(
      (r) => r.url.includes('facebook.com/tr') && r.body?.includes('Purchase'),
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasMetaPixelEvent ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasMetaPixelEvent ? 'Meta Pixel Purchase event detected' : 'Not found',
        expected: 'Meta Pixel Purchase event fired on confirmation page',
        evidence: [
          `Meta Pixel requests: ${auditData.networkRequests.filter((r) => r.url.includes('facebook.com/tr')).length}`,
        ],
      },
    };
  },
};

export const GOOGLE_ADS_CONVERSION_EVENT_FIRED = {
  rule_id: 'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const hasGAdsConversion = auditData.networkRequests.some(
      (r) =>
        (r.url.includes('google.com/pagead') || r.url.includes('googleads')) &&
        r.body?.includes('conversion'),
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasGAdsConversion ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasGAdsConversion ? 'Google Ads conversion detected' : 'Not found',
        expected: 'Google Ads conversion event fired on confirmation page',
        evidence: [
          `Google Ads requests: ${auditData.networkRequests.filter((r) => r.url.includes('google.com/pagead')).length}`,
        ],
      },
    };
  },
};

export const SGTM_SERVER_EVENT_FIRED = {
  rule_id: 'SGTM_SERVER_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const hasSGTMEvent = auditData.networkRequests.some(
      (r) =>
        (r.url.includes('sgtm') || r.url.includes('gtm-msr') || r.url.includes('.co/collect')) &&
        r.method === 'POST',
    );
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasSGTMEvent ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasSGTMEvent ? 'Server-side event detected' : 'Not found',
        expected: 'Server-side GTM endpoint receives event via POST',
        evidence: [
          `POST requests to sGTM: ${auditData.networkRequests.filter((r) => r.method === 'POST' && r.url.includes('sgtm')).length}`,
        ],
      },
    };
  },
};

export const DATALAYER_POPULATED = {
  rule_id: 'DATALAYER_POPULATED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const eventCount = auditData.dataLayer.length;
    const status = eventCount >= 2 ? 'pass' : eventCount === 1 ? 'warning' : 'fail';
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status,
      severity: this.severity,
      technical_details: {
        found: `${eventCount} dataLayer events`,
        expected: '2+ events pushed to dataLayer',
        evidence: [
          `Total events: ${eventCount}`,
          `Event types: ${[...new Set(auditData.dataLayer.map((e) => e.event))].join(', ')}`,
        ],
      },
    };
  },
};

export const GTM_CONTAINER_LOADED = {
  rule_id: 'GTM_CONTAINER_LOADED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,

  test(auditData: AuditData): ValidationResult {
    const gtmRequest = auditData.networkRequests.find(
      (r) => r.url.includes('googletagmanager.com') && r.url.includes('gtm.js'),
    );
    const hasGTMScript = !!gtmRequest;
    const loadTime = gtmRequest?.loadTime ?? 0;
    const status = hasGTMScript ? (loadTime > 2000 ? 'warning' : 'pass') : 'fail';
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status,
      severity: this.severity,
      technical_details: {
        found: hasGTMScript ? `GTM loaded in ${loadTime}ms` : 'GTM not loaded',
        expected: 'GTM script loads in <2000ms',
        evidence: [`GTM script detected: ${hasGTMScript}`, `Load time: ${loadTime}ms`],
      },
    };
  },
};

export const PAGE_VIEW_EVENT_FIRED = {
  rule_id: 'PAGE_VIEW_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'high' as const,

  test(auditData: AuditData): ValidationResult {
    const pageViewEvents = auditData.dataLayer.filter((e) => e.event === 'page_view');
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: pageViewEvents.length > 0 ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: `${pageViewEvents.length} page_view events`,
        expected: '1+ page_view events across journey',
        evidence: [`Total page_view events: ${pageViewEvents.length}`],
      },
    };
  },
};

export const ADD_TO_CART_EVENT_FIRED = {
  rule_id: 'ADD_TO_CART_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'medium' as const,

  test(auditData: AuditData): ValidationResult {
    const hasAddToCart = auditData.dataLayer.some((e) => e.event === 'add_to_cart');
    return {
      rule_id: this.rule_id,
      validation_layer: this.validation_layer,
      status: hasAddToCart ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: hasAddToCart ? 'add_to_cart event detected' : 'Not found',
        expected: 'add_to_cart event fired when user adds product',
        evidence: [
          `add_to_cart events: ${auditData.dataLayer.filter((e) => e.event === 'add_to_cart').length}`,
        ],
      },
    };
  },
};

export const LAYER_1_RULES = [
  GA4_PURCHASE_EVENT_FIRED,
  META_PIXEL_PURCHASE_EVENT_FIRED,
  GOOGLE_ADS_CONVERSION_EVENT_FIRED,
  SGTM_SERVER_EVENT_FIRED,
  DATALAYER_POPULATED,
  GTM_CONTAINER_LOADED,
  PAGE_VIEW_EVENT_FIRED,
  ADD_TO_CART_EVENT_FIRED,
];
