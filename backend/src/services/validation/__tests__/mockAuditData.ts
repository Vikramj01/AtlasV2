/**
 * Mock AuditData factory for unit tests.
 * Returns a "perfect" baseline audit where all rules should pass.
 * Individual tests override specific fields to trigger failures.
 */
import type { AuditData, DataLayerEvent, NetworkRequest } from '@/types/audit';

/** Build a passing purchase event with all required fields */
export function makePurchaseEvent(overrides?: Partial<DataLayerEvent>): DataLayerEvent {
  return {
    event: 'purchase',
    timestamp: Date.now(),
    step: 'confirmation',
    transaction_id: 'ORDER-12345',
    value: 99.99,
    currency: 'USD',
    coupon: 'SAVE10',
    shipping: 5.99,
    items: [{ id: 'SKU-1', name: 'Widget', price: 99.99, quantity: 1 }],
    user_id: 'user_abc123',
    event_id: 'evt_' + Math.random().toString(36).slice(2),
    gclid: 'test_gclid_1234567890',
    user_data: {
      email: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', // SHA256-like
      phone:  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    },
    ...overrides,
  };
}

/** Build a passing network request for a given platform */
export function makeNetworkRequest(partial: Partial<NetworkRequest> & { url: string }): NetworkRequest {
  return {
    method: 'POST',
    headers: {},
    timestamp: Date.now(),
    step: 'confirmation',
    body: '',
    ...partial,
  };
}

/** A fully passing AuditData — all 26 rules should pass against this */
export function makePerfectAuditData(overrides?: Partial<AuditData>): AuditData {
  const gclid = 'test_gclid_1234567890';
  const fbclid = 'test_fbclid_1234567890';
  const eventId = 'evt_abc123xyz';

  const purchaseEvent = makePurchaseEvent({ event_id: eventId, gclid });

  return {
    audit_id: 'test-audit-id',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    dataLayer: [
      { event: 'page_view', timestamp: Date.now(), step: 'landing' },
      { event: 'page_view', timestamp: Date.now(), step: 'product' },
      { event: 'add_to_cart', timestamp: Date.now(), step: 'product' },
      { event: 'page_view', timestamp: Date.now(), step: 'checkout' },
      purchaseEvent,
    ],
    networkRequests: [
      makeNetworkRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX', method: 'GET', step: 'landing', loadTime: 300 }),
      makeNetworkRequest({ url: 'https://analytics.google.com/g/collect', body: 'en=purchase', step: 'confirmation' }),
      makeNetworkRequest({ url: 'https://www.facebook.com/tr/', body: 'ev=Purchase&cd[content_type]=product', step: 'confirmation' }),
      makeNetworkRequest({ url: 'https://www.google.com/pagead/1p-conversion/', body: 'conversion=1', step: 'confirmation' }),
      makeNetworkRequest({ url: 'https://sgtm.example.com/collect', method: 'POST', body: JSON.stringify({ event_id: eventId }), step: 'confirmation' }),
    ],
    cookieSnapshots: [
      { step: 'confirmation', cookies: { _fbp: 'fb.1.123456.789', _fbc: 'fb.1.123456.fbclid' } },
    ],
    localStorageSnapshots: [],
    injected: { gclid, fbclid },
    urlParams: { gclid, fbclid },
    storage: { gclid },
    cookies: { _fbp: 'fb.1.123456.789', _fbc: 'fb.1.123456.fbclid' },
    pageMetadata: { pixel_fbclid: true },
    ...overrides,
  };
}

/** AuditData with no events, no network requests — most rules should fail */
export function makeEmptyAuditData(): AuditData {
  return {
    audit_id: 'test-empty-audit',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    urlParams: {},
    storage: {},
    cookies: {},
    pageMetadata: {},
  };
}
