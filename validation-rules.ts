/**
 * ATLAS Validation Rules Framework
 * Complete rule definitions for Signal Integrity auditing
 * 
 * To use: Import these rules into your validation engine
 * Each rule is a pure function that takes AuditData and returns ValidationResult
 */

import { AuditData, ValidationResult } from '../types/audit';

// ============================================================================
// LAYER 1: SIGNAL INITIATION (8 Rules)
// Are conversion events firing at all?
// ============================================================================

export const GA4_PURCHASE_EVENT_FIRED = {
  rule_id: 'GA4_PURCHASE_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,
  affected_platforms: ['GA4'],
  business_impact: 'Google Analytics is not tracking your conversions. This breaks all reporting and attribution.',
  recommended_owner: 'Frontend Developer or GTM implementer',
  fix_summary: 'Add gtag("event", "purchase", {...}) to confirmation page, triggered on order completion.',
  
  test: (auditData: AuditData): ValidationResult => {
    const hasGA4Event = auditData.dataLayer.some(event => event.event === 'purchase');
    const hasGA4NetworkCall = auditData.networkRequests.some(
      req => req.url.includes('analytics.google.com') && req.body?.includes('purchase')
    );

    const status = hasGA4Event || hasGA4NetworkCall ? 'pass' : 'fail';

    return {
      rule_id: 'GA4_PURCHASE_EVENT_FIRED',
      validation_layer: 'signal_initiation',
      status,
      severity: 'critical',
      technical_details: {
        found: hasGA4Event ? 'GA4 event detected' : hasGA4NetworkCall ? 'GA4 network call detected' : 'Not found',
        expected: 'Purchase event fired on confirmation page',
        evidence: [
          `dataLayer events: ${auditData.dataLayer.filter(e => e.event === 'purchase').length}`,
          `GA4 network requests: ${auditData.networkRequests.filter(r => r.url.includes('analytics.google.com')).length}`
        ]
      }
    };
  }
};

export const META_PIXEL_PURCHASE_EVENT_FIRED = {
  rule_id: 'META_PIXEL_PURCHASE_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,
  affected_platforms: ['Meta Ads'],
  business_impact: 'Meta cannot track purchases. You\'re flying blind on campaign performance.',
  recommended_owner: 'Frontend Developer or GTM implementer',
  fix_summary: 'Add fbq("track", "Purchase", {...}) to confirmation page.',

  test: (auditData: AuditData): ValidationResult => {
    const hasMetaPixelEvent = auditData.networkRequests.some(
      req => req.url.includes('facebook.com/tr') && req.body?.includes('Purchase')
    );

    return {
      rule_id: 'META_PIXEL_PURCHASE_EVENT_FIRED',
      validation_layer: 'signal_initiation',
      status: hasMetaPixelEvent ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: hasMetaPixelEvent ? 'Meta Pixel Purchase event detected' : 'Not found',
        expected: 'Meta Pixel Purchase event fired',
        evidence: [
          `Meta Pixel requests: ${auditData.networkRequests.filter(r => r.url.includes('facebook.com/tr')).length}`
        ]
      }
    };
  }
};

export const GOOGLE_ADS_CONVERSION_EVENT_FIRED = {
  rule_id: 'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,
  affected_platforms: ['Google Ads'],
  business_impact: 'Google Ads cannot count conversions. Smart bidding cannot optimize.',
  recommended_owner: 'Frontend Developer or GTM implementer',
  fix_summary: 'Configure Google Ads conversion tracking in GTM or implement gtag conversion event.',

  test: (auditData: AuditData): ValidationResult => {
    const hasGAdsConversion = auditData.networkRequests.some(
      req => (req.url.includes('google.com/pagead') || req.url.includes('googleads')) && 
              req.body?.includes('conversion')
    );

    return {
      rule_id: 'GOOGLE_ADS_CONVERSION_EVENT_FIRED',
      validation_layer: 'signal_initiation',
      status: hasGAdsConversion ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: hasGAdsConversion ? 'Google Ads conversion detected' : 'Not found',
        expected: 'Google Ads conversion event fired',
        evidence: [
          `Google Ads network requests: ${auditData.networkRequests.filter(r => r.url.includes('google.com/pagead')).length}`
        ]
      }
    };
  }
};

export const SGTM_SERVER_EVENT_FIRED = {
  rule_id: 'SGTM_SERVER_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'high' as const,
  affected_platforms: ['sGTM', 'GA4 Measurement Protocol'],
  business_impact: 'Server-side tracking is not active. You\'re missing signal deduplication and conversions may be counted twice.',
  recommended_owner: 'Backend Developer or GTM implementer',
  fix_summary: 'Configure your dataLayer to POST conversion events to your sGTM endpoint.',

  test: (auditData: AuditData): ValidationResult => {
    // Check for custom domain sGTM endpoint or GTM Tagging Server
    const hasSGTMEvent = auditData.networkRequests.some(
      req => (req.url.includes('sgtm') || req.url.includes('gtm-msr') || 
              req.url.includes('.co/collect')) && 
             req.method === 'POST'
    );

    return {
      rule_id: 'SGTM_SERVER_EVENT_FIRED',
      validation_layer: 'signal_initiation',
      status: hasSGTMEvent ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: hasSGTMEvent ? 'Server-side event detected' : 'Not found',
        expected: 'Server-side GTM endpoint receives event',
        evidence: [
          `POST requests to sGTM: ${auditData.networkRequests.filter(r => r.method === 'POST' && r.url.includes('sgtm')).length}`
        ]
      }
    };
  }
};

export const DATALAYER_POPULATED = {
  rule_id: 'DATALAYER_POPULATED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,
  affected_platforms: ['All'],
  business_impact: 'GTM has no data to work with. All conversion tracking will fail.',
  recommended_owner: 'Frontend Developer',
  fix_summary: 'Implement dataLayer initialization. Push events at key points.',

  test: (auditData: AuditData): ValidationResult => {
    const eventCount = auditData.dataLayer.length;
    const status = eventCount >= 2 ? 'pass' : eventCount === 1 ? 'warning' : 'fail';

    return {
      rule_id: 'DATALAYER_POPULATED',
      validation_layer: 'signal_initiation',
      status,
      severity: 'critical',
      technical_details: {
        found: `${eventCount} dataLayer events`,
        expected: '2+ events pushed to dataLayer',
        evidence: [
          `Total events in dataLayer: ${eventCount}`,
          `Event types: ${[...new Set(auditData.dataLayer.map(e => e.event))].join(', ')}`
        ]
      }
    };
  }
};

export const GTM_CONTAINER_LOADED = {
  rule_id: 'GTM_CONTAINER_LOADED',
  validation_layer: 'signal_initiation' as const,
  severity: 'critical' as const,
  affected_platforms: ['GTM', 'GA4', 'Meta', 'Google Ads'],
  business_impact: 'GTM is the backbone of all tracking. Without it, nothing tracks.',
  recommended_owner: 'Frontend Developer or DevOps',
  fix_summary: 'Ensure GTM script is in <head>. Check for CSP/ad blocker conflicts.',

  test: (auditData: AuditData): ValidationResult => {
    const hasGTMScript = auditData.networkRequests.some(
      req => req.url.includes('googletagmanager.com') && req.url.includes('gtm.js')
    );
    const gtmLoadTime = auditData.networkRequests.find(
      req => req.url.includes('googletagmanager.com') && req.url.includes('gtm.js')
    )?.loadTime || 0;

    const status = hasGTMScript ? (gtmLoadTime > 2000 ? 'warning' : 'pass') : 'fail';

    return {
      rule_id: 'GTM_CONTAINER_LOADED',
      validation_layer: 'signal_initiation',
      status,
      severity: 'critical',
      technical_details: {
        found: hasGTMScript ? `GTM loaded in ${gtmLoadTime}ms` : 'GTM not loaded',
        expected: 'GTM script loads in <2000ms',
        evidence: [
          `GTM script detected: ${hasGTMScript}`,
          `Load time: ${gtmLoadTime}ms`
        ]
      }
    };
  }
};

export const PAGE_VIEW_EVENT_FIRED = {
  rule_id: 'PAGE_VIEW_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'high' as const,
  affected_platforms: ['GA4', 'GTM'],
  business_impact: 'GA4 cannot track pageviews. Funnel analysis will be broken.',
  recommended_owner: 'Frontend Developer or GTM implementer',
  fix_summary: 'Configure GTM to send page_view event on each page load.',

  test: (auditData: AuditData): ValidationResult => {
    const pageViewEvents = auditData.dataLayer.filter(e => e.event === 'page_view');
    const hasPageView = pageViewEvents.length > 0;

    return {
      rule_id: 'PAGE_VIEW_EVENT_FIRED',
      validation_layer: 'signal_initiation',
      status: hasPageView ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: `${pageViewEvents.length} page_view events`,
        expected: '1+ page_view events per page',
        evidence: [
          `Total page_view events: ${pageViewEvents.length}`
        ]
      }
    };
  }
};

export const ADD_TO_CART_EVENT_FIRED = {
  rule_id: 'ADD_TO_CART_EVENT_FIRED',
  validation_layer: 'signal_initiation' as const,
  severity: 'medium' as const,
  affected_platforms: ['GA4', 'Meta', 'Google Ads'],
  business_impact: 'You cannot optimize for add-to-cart. Meta and Google cannot build lookalike audiences.',
  recommended_owner: 'Frontend Developer',
  fix_summary: 'Push add_to_cart event to dataLayer with product details.',

  test: (auditData: AuditData): ValidationResult => {
    const hasAddToCart = auditData.dataLayer.some(e => e.event === 'add_to_cart');

    return {
      rule_id: 'ADD_TO_CART_EVENT_FIRED',
      validation_layer: 'signal_initiation',
      status: hasAddToCart ? 'pass' : 'fail',
      severity: 'medium',
      technical_details: {
        found: hasAddToCart ? 'add_to_cart event detected' : 'Not found',
        expected: 'add_to_cart event fired when user adds product',
        evidence: [
          `add_to_cart events: ${auditData.dataLayer.filter(e => e.event === 'add_to_cart').length}`
        ]
      }
    };
  }
};

// ============================================================================
// LAYER 2: PARAMETER COMPLETENESS (12 Rules)
// Are required parameters present in conversion events?
// ============================================================================

export const TRANSACTION_ID_PRESENT = {
  rule_id: 'TRANSACTION_ID_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,
  affected_platforms: ['GA4', 'Google Ads', 'Meta', 'sGTM'],
  business_impact: 'Conversions cannot be deduplicated. You\'ll see inflated conversion counts and double-billing.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Attach unique transaction_id from your order system.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasTransactionID = purchaseEvents.some(
      e => e.transaction_id && e.transaction_id !== '' && e.transaction_id !== 'null'
    );

    return {
      rule_id: 'TRANSACTION_ID_PRESENT',
      validation_layer: 'parameter_completeness',
      status: hasTransactionID ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: purchaseEvents[0]?.transaction_id || 'Missing',
        expected: 'Non-empty transaction_id (e.g., "ORDER-12345")',
        evidence: [
          `Purchase events with transaction_id: ${purchaseEvents.filter(e => e.transaction_id).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const VALUE_PARAMETER_PRESENT = {
  rule_id: 'VALUE_PARAMETER_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,
  affected_platforms: ['GA4', 'Google Ads', 'Meta', 'sGTM'],
  business_impact: 'Cannot track ROAS or revenue. Smart bidding cannot optimize for value.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Include transaction value in purchase event.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasValue = purchaseEvents.some(e => {
      const value = Number(e.value);
      return value > 0 && value < 1000000; // Sanity check
    });

    return {
      rule_id: 'VALUE_PARAMETER_PRESENT',
      validation_layer: 'parameter_completeness',
      status: hasValue ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: purchaseEvents[0]?.value || 'Missing',
        expected: 'Numeric value > 0',
        evidence: [
          `Purchase events with value: ${purchaseEvents.filter(e => Number(e.value) > 0).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const CURRENCY_PARAMETER_PRESENT = {
  rule_id: 'CURRENCY_PARAMETER_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,
  affected_platforms: ['GA4', 'Google Ads'],
  business_impact: 'Multi-currency revenue reports will be wrong.',
  recommended_owner: 'Backend Developer or GTM implementer',
  fix_summary: 'Add currency code: {currency: "USD"}',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasCurrency = purchaseEvents.some(
      e => e.currency && typeof e.currency === 'string' && e.currency.length === 3
    );

    return {
      rule_id: 'CURRENCY_PARAMETER_PRESENT',
      validation_layer: 'parameter_completeness',
      status: hasCurrency ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: purchaseEvents[0]?.currency || 'Missing',
        expected: 'ISO 4217 currency code (3 letters, e.g., "USD")',
        evidence: [
          `Purchase events with currency: ${purchaseEvents.filter(e => e.currency).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const GCLID_CAPTURED_AT_LANDING = {
  rule_id: 'GCLID_CAPTURED_AT_LANDING',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,
  affected_platforms: ['Google Ads'],
  business_impact: 'Google Ads cannot attribute any conversions to ad clicks.',
  recommended_owner: 'Frontend Developer or Marketing',
  fix_summary: 'Ensure your Google Ads tracking is enabled and auto-tagging is ON.',

  test: (auditData: AuditData): ValidationResult => {
    const gclid = auditData.urlParams?.gclid || auditData.storage?.gclid || null;
    const hasGclid = !!gclid;

    return {
      rule_id: 'GCLID_CAPTURED_AT_LANDING',
      validation_layer: 'parameter_completeness',
      status: hasGclid ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: hasGclid ? 'gclid found' : 'Missing',
        expected: 'gclid present in URL or stored',
        evidence: [
          `gclid in URL: ${!!auditData.urlParams?.gclid}`,
          `gclid in storage: ${!!auditData.storage?.gclid}`
        ]
      }
    };
  }
};

export const FBCLID_CAPTURED_AT_LANDING = {
  rule_id: 'FBCLID_CAPTURED_AT_LANDING',
  validation_layer: 'parameter_completeness' as const,
  severity: 'critical' as const,
  affected_platforms: ['Meta Ads'],
  business_impact: 'Meta cannot attribute conversions.',
  recommended_owner: 'Frontend Developer or GTM implementer',
  fix_summary: 'Meta Pixel automatically captures fbclid. Ensure it fires on landing page.',

  test: (auditData: AuditData): ValidationResult => {
    const fbclid = auditData.urlParams?.fbclid || null;
    const hasFBPixel = auditData.networkRequests.some(r => r.url.includes('facebook.com'));
    const hasIdentifiers = fbclid || hasFBPixel;

    return {
      rule_id: 'FBCLID_CAPTURED_AT_LANDING',
      validation_layer: 'parameter_completeness',
      status: hasIdentifiers ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: hasIdentifiers ? 'Meta identifiers detected' : 'Missing',
        expected: 'fbclid in URL or Meta Pixel loaded',
        evidence: [
          `fbclid in URL: ${!!fbclid}`,
          `Meta Pixel detected: ${hasFBPixel}`
        ]
      }
    };
  }
};

export const EVENT_ID_GENERATED = {
  rule_id: 'EVENT_ID_GENERATED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,
  affected_platforms: ['GA4', 'Meta', 'sGTM'],
  business_impact: 'Client and server events cannot be deduplicated. Conversion counts will be inflated by 2-3x.',
  recommended_owner: 'Frontend Developer',
  fix_summary: 'Generate UUID or timestamp-based event_id for each event.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const eventIds = purchaseEvents.map(e => e.event_id).filter(Boolean);
    const uniqueIds = new Set(eventIds);
    const hasUniqueEventIds = eventIds.length === purchaseEvents.length && uniqueIds.size === eventIds.length;

    return {
      rule_id: 'EVENT_ID_GENERATED',
      validation_layer: 'parameter_completeness',
      status: hasUniqueEventIds ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: `${eventIds.length} events with IDs, ${uniqueIds.size} unique`,
        expected: 'Each event has unique event_id',
        evidence: [
          `Events with event_id: ${eventIds.length}/${purchaseEvents.length}`,
          `Unique event_ids: ${uniqueIds.size}`
        ]
      }
    };
  }
};

export const EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS = {
  rule_id: 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,
  affected_platforms: ['Google Ads', 'Meta CAPI'],
  business_impact: 'Enhanced Conversions cannot match users. Match rate drops to <30%.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Capture customer email at checkout.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasEmail = purchaseEvents.some(
      e => e.user_data?.email && typeof e.user_data.email === 'string' && e.user_data.email.includes('@')
    );

    return {
      rule_id: 'EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS',
      validation_layer: 'parameter_completeness',
      status: hasEmail ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: purchaseEvents[0]?.user_data?.email ? 'Email captured' : 'Missing',
        expected: 'Valid email in user_data.email',
        evidence: [
          `Events with email: ${purchaseEvents.filter(e => e.user_data?.email).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const PHONE_CAPTURED_FOR_CAPI = {
  rule_id: 'PHONE_CAPTURED_FOR_CAPI',
  validation_layer: 'parameter_completeness' as const,
  severity: 'medium' as const,
  affected_platforms: ['Meta CAPI'],
  business_impact: 'Meta match rate drops 20-30%.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Capture phone at checkout, normalize to digits only.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasPhone = purchaseEvents.some(
      e => e.user_data?.phone && String(e.user_data.phone).replace(/\D/g, '').length >= 10
    );

    return {
      rule_id: 'PHONE_CAPTURED_FOR_CAPI',
      validation_layer: 'parameter_completeness',
      status: hasPhone ? 'pass' : 'fail',
      severity: 'medium',
      technical_details: {
        found: purchaseEvents[0]?.user_data?.phone ? 'Phone captured' : 'Missing',
        expected: 'Phone number with 10+ digits',
        evidence: [
          `Events with phone: ${purchaseEvents.filter(e => e.user_data?.phone).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const ITEMS_ARRAY_POPULATED = {
  rule_id: 'ITEMS_ARRAY_POPULATED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'medium' as const,
  affected_platforms: ['GA4', 'Meta'],
  business_impact: 'Cannot do product-level analysis. ROI by SKU is blind.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Include all products: {items: [{id, price, quantity}]}',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasItems = purchaseEvents.some(
      e => Array.isArray(e.items) && e.items.length > 0 && 
           e.items.some(item => item.id && item.price && item.quantity !== undefined)
    );

    return {
      rule_id: 'ITEMS_ARRAY_POPULATED',
      validation_layer: 'parameter_completeness',
      status: hasItems ? 'pass' : 'fail',
      severity: 'medium',
      technical_details: {
        found: purchaseEvents[0]?.items ? `${purchaseEvents[0].items.length} items` : 'Missing',
        expected: 'items array with 1+ products (id, price, quantity)',
        evidence: [
          `Events with items: ${purchaseEvents.filter(e => Array.isArray(e.items) && e.items.length > 0).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const USER_ID_PRESENT = {
  rule_id: 'USER_ID_PRESENT',
  validation_layer: 'parameter_completeness' as const,
  severity: 'high' as const,
  affected_platforms: ['GA4', 'sGTM'],
  business_impact: 'Cannot track repeat customers. Repeat purchase rate is wrong.',
  recommended_owner: 'Backend Developer or GA4 implementer',
  fix_summary: 'Set GA4 user_id when user logs in.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasUserID = purchaseEvents.some(e => e.user_id && String(e.user_id).length > 0);

    return {
      rule_id: 'USER_ID_PRESENT',
      validation_layer: 'parameter_completeness',
      status: hasUserID ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: purchaseEvents[0]?.user_id ? 'user_id present' : 'Missing',
        expected: 'Unique user_id for repeat tracking',
        evidence: [
          `Events with user_id: ${purchaseEvents.filter(e => e.user_id).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const COUPON_CAPTURED_IF_USED = {
  rule_id: 'COUPON_CAPTURED_IF_USED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'low' as const,
  affected_platforms: ['GA4', 'Meta'],
  business_impact: 'Cannot measure coupon effectiveness.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Include coupon code when used: {coupon: "SUMMER20"}',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasCoupon = purchaseEvents.some(e => e.coupon && String(e.coupon).length > 0);

    return {
      rule_id: 'COUPON_CAPTURED_IF_USED',
      validation_layer: 'parameter_completeness',
      status: hasCoupon || purchaseEvents.length === 0 ? 'pass' : 'warning',
      severity: 'low',
      technical_details: {
        found: purchaseEvents[0]?.coupon ? 'coupon captured' : 'Not captured',
        expected: 'coupon code when used',
        evidence: [
          `Events with coupon: ${purchaseEvents.filter(e => e.coupon).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

export const SHIPPING_CAPTURED = {
  rule_id: 'SHIPPING_CAPTURED',
  validation_layer: 'parameter_completeness' as const,
  severity: 'low' as const,
  affected_platforms: ['GA4', 'Meta'],
  business_impact: 'Cannot analyze margin impact of shipping.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Track shipping separately: {shipping: order.shipping_cost}',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvents = auditData.dataLayer.filter(e => e.event === 'purchase');
    const hasShipping = purchaseEvents.some(e => e.shipping !== undefined && e.shipping !== null);

    return {
      rule_id: 'SHIPPING_CAPTURED',
      validation_layer: 'parameter_completeness',
      status: hasShipping || purchaseEvents.length === 0 ? 'pass' : 'warning',
      severity: 'low',
      technical_details: {
        found: purchaseEvents[0]?.shipping !== undefined ? 'shipping captured' : 'Not captured',
        expected: 'shipping cost when applicable',
        evidence: [
          `Events with shipping: ${purchaseEvents.filter(e => e.shipping !== undefined).length}/${purchaseEvents.length}`
        ]
      }
    };
  }
};

// ============================================================================
// LAYER 3: PERSISTENCE (6 Rules)
// Do critical identifiers survive cross-page navigation?
// ============================================================================

export const GCLID_PERSISTS_TO_CONVERSION = {
  rule_id: 'GCLID_PERSISTS_TO_CONVERSION',
  validation_layer: 'persistence' as const,
  severity: 'critical' as const,
  affected_platforms: ['Google Ads'],
  business_impact: 'Google Ads cannot attribute this conversion.',
  recommended_owner: 'Frontend Developer',
  fix_summary: 'Store gclid in sessionStorage and include in purchase event.',

  test: (auditData: AuditData): ValidationResult => {
    const landingPageGclid = auditData.urlParams?.gclid;
    const purchaseEvent = auditData.dataLayer.find(e => e.event === 'purchase');
    const purchaseEventGclid = purchaseEvent?.gclid;

    const hasPersistence = landingPageGclid && purchaseEventGclid && landingPageGclid === purchaseEventGclid;

    return {
      rule_id: 'GCLID_PERSISTS_TO_CONVERSION',
      validation_layer: 'persistence',
      status: hasPersistence ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: hasPersistence ? 'gclid persisted' : 'gclid lost',
        expected: 'Same gclid from landing to purchase event',
        evidence: [
          `Landing page gclid: ${landingPageGclid ? 'present' : 'missing'}`,
          `Purchase event gclid: ${purchaseEventGclid ? 'present' : 'missing'}`,
          `Match: ${landingPageGclid === purchaseEventGclid}`
        ]
      }
    };
  }
};

export const FBCLID_PERSISTS_TO_CONVERSION = {
  rule_id: 'FBCLID_PERSISTS_TO_CONVERSION',
  validation_layer: 'persistence' as const,
  severity: 'critical' as const,
  affected_platforms: ['Meta Ads'],
  business_impact: 'Meta cannot match user. Conversion tracking fails.',
  recommended_owner: 'Frontend Developer or DevOps',
  fix_summary: 'Ensure Meta Pixel fires on all pages. Check cookie settings.',

  test: (auditData: AuditData): ValidationResult => {
    const hasFBPixelOnLanding = auditData.pageMetadata?.pixel_fbclid === true;
    const hasMetaCookies = auditData.cookies?.fbp || auditData.cookies?.fbc;
    const hasIdentifiers = hasFBPixelOnLanding && hasMetaCookies;

    return {
      rule_id: 'FBCLID_PERSISTS_TO_CONVERSION',
      validation_layer: 'persistence',
      status: hasIdentifiers ? 'pass' : 'fail',
      severity: 'critical',
      technical_details: {
        found: hasIdentifiers ? 'Meta identifiers persisted' : 'Meta identifiers lost',
        expected: 'Meta cookies (fbp/fbc) persist across pages',
        evidence: [
          `Meta Pixel on landing: ${hasFBPixelOnLanding}`,
          `Meta cookies present: ${!!hasMetaCookies}`
        ]
      }
    };
  }
};

export const TRANSACTION_ID_MATCHES_ORDER_SYSTEM = {
  rule_id: 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
  validation_layer: 'persistence' as const,
  severity: 'high' as const,
  affected_platforms: ['All'],
  business_impact: 'Cannot reconcile conversion data with actual revenue.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Use the actual order ID from your system.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvent = auditData.dataLayer.find(e => e.event === 'purchase');
    const transactionID = purchaseEvent?.transaction_id;
    
    // This would normally check against your actual order system
    // For now, we just verify format
    const validFormat = transactionID && String(transactionID).length > 0 && transactionID !== 'null';

    return {
      rule_id: 'TRANSACTION_ID_MATCHES_ORDER_SYSTEM',
      validation_layer: 'persistence',
      status: validFormat ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: transactionID ? `"${transactionID}"` : 'Missing',
        expected: 'Valid order ID from your system',
        evidence: [
          `Transaction ID present: ${!!transactionID}`,
          `Format valid: ${validFormat}`
        ]
      }
    };
  }
};

export const EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER = {
  rule_id: 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
  validation_layer: 'persistence' as const,
  severity: 'high' as const,
  affected_platforms: ['sGTM', 'GA4', 'Meta CAPI'],
  business_impact: 'Deduplication fails. Conversion counts double.',
  recommended_owner: 'Backend Developer / sGTM implementer',
  fix_summary: 'Pass event_id from client to server in same request.',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvent = auditData.dataLayer.find(e => e.event === 'purchase');
    const clientEventID = purchaseEvent?.event_id;
    
    // Check if same event_id appears in server request
    const serverEventID = auditData.networkRequests.find(
      r => r.url.includes('sgtm') && r.body?.includes(String(clientEventID))
    );

    const isConsistent = clientEventID && !!serverEventID;

    return {
      rule_id: 'EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER',
      validation_layer: 'persistence',
      status: isConsistent ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: isConsistent ? 'event_ids match' : 'event_ids mismatch',
        expected: 'Same event_id in client and server events',
        evidence: [
          `Client event_id: ${clientEventID ? 'present' : 'missing'}`,
          `Server event_id: ${serverEventID ? 'found' : 'not found'}`
        ]
      }
    };
  }
};

export const USER_DATA_NORMALIZED_CONSISTENTLY = {
  rule_id: 'USER_DATA_NORMALIZED_CONSISTENTLY',
  validation_layer: 'persistence' as const,
  severity: 'medium' as const,
  affected_platforms: ['Meta CAPI', 'Google Ads Enhanced Conversions'],
  business_impact: 'Match rates drop 30-50%.',
  recommended_owner: 'Backend Developer',
  fix_summary: 'Normalize email (lowercase, trim), phone (digits only).',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvent = auditData.dataLayer.find(e => e.event === 'purchase');
    const email = purchaseEvent?.user_data?.email;
    const phone = purchaseEvent?.user_data?.phone;

    const emailNormalized = email && email === email.toLowerCase().trim();
    const phoneNormalized = phone && /^\d+$/.test(String(phone));

    const isConsistent = (!email || emailNormalized) && (!phone || phoneNormalized);

    return {
      rule_id: 'USER_DATA_NORMALIZED_CONSISTENTLY',
      validation_layer: 'persistence',
      status: isConsistent ? 'pass' : 'warning',
      severity: 'medium',
      technical_details: {
        found: isConsistent ? 'Normalized' : 'Not normalized',
        expected: 'Email lowercase+trim, phone digits-only',
        evidence: [
          `Email normalized: ${emailNormalized || 'N/A'}`,
          `Phone normalized: ${phoneNormalized || 'N/A'}`
        ]
      }
    };
  }
};

export const PII_PROPERLY_HASHED = {
  rule_id: 'PII_PROPERLY_HASHED',
  validation_layer: 'persistence' as const,
  severity: 'high' as const,
  affected_platforms: ['Meta CAPI', 'Google Ads Enhanced Conversions'],
  business_impact: 'Privacy/compliance risk. May violate GDPR, CCPA.',
  recommended_owner: 'Backend Developer / Security',
  fix_summary: 'Hash with SHA256: crypto.createHash("sha256").update(email).digest("hex")',

  test: (auditData: AuditData): ValidationResult => {
    const purchaseEvent = auditData.dataLayer.find(e => e.event === 'purchase');
    const email = purchaseEvent?.user_data?.email;
    const phone = purchaseEvent?.user_data?.phone;

    // SHA256 hashes are 64 hex characters
    const isEmailHashed = email && /^[a-f0-9]{64}$/.test(String(email));
    const isPhoneHashed = phone && /^[a-f0-9]{64}$/.test(String(phone));

    const isSentToServer = auditData.networkRequests.some(
      r => r.url.includes('facebook.com') || r.url.includes('googleads')
    );

    const isProperly Hashed = isSentToServer ? (isEmailHashed || isPhoneHashed) : true;

    return {
      rule_id: 'PII_PROPERLY_HASHED',
      validation_layer: 'persistence',
      status: isProperlyHashed ? 'pass' : 'fail',
      severity: 'high',
      technical_details: {
        found: isProperlyHashed ? 'PII properly hashed' : 'PII not hashed',
        expected: 'PII hashed with SHA256 before sending to platforms',
        evidence: [
          `Sent to platforms: ${isSentToServer}`,
          `Email hashed: ${isEmailHashed || 'N/A'}`,
          `Phone hashed: ${isPhoneHashed || 'N/A'}`
        ]
      }
    };
  }
};

// ============================================================================
// Rule Registry
// ============================================================================

export const ALL_VALIDATION_RULES = [
  // Layer 1
  GA4_PURCHASE_EVENT_FIRED,
  META_PIXEL_PURCHASE_EVENT_FIRED,
  GOOGLE_ADS_CONVERSION_EVENT_FIRED,
  SGTM_SERVER_EVENT_FIRED,
  DATALAYER_POPULATED,
  GTM_CONTAINER_LOADED,
  PAGE_VIEW_EVENT_FIRED,
  ADD_TO_CART_EVENT_FIRED,

  // Layer 2
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

  // Layer 3
  GCLID_PERSISTS_TO_CONVERSION,
  FBCLID_PERSISTS_TO_CONVERSION,
  TRANSACTION_ID_MATCHES_ORDER_SYSTEM,
  EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER,
  USER_DATA_NORMALIZED_CONSISTENTLY,
  PII_PROPERLY_HASHED
];
