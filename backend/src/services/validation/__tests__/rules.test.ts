import { describe, it, expect } from 'vitest';
import { makePerfectAuditData, makeEmptyAuditData, makePurchaseEvent, makeNetworkRequest } from './mockAuditData';

// Layer 1
import {
  GA4_PURCHASE_EVENT_FIRED,
  META_PIXEL_PURCHASE_EVENT_FIRED,
  GOOGLE_ADS_CONVERSION_EVENT_FIRED,
  SGTM_SERVER_EVENT_FIRED,
  DATALAYER_POPULATED,
  GTM_CONTAINER_LOADED,
  PAGE_VIEW_EVENT_FIRED,
  ADD_TO_CART_EVENT_FIRED,
} from '../signalInitiation';

// Layer 2
import {
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
} from '../parameterCompleteness';

// Layer 3
import {
  GCLID_PERSISTS_TO_CONVERSION,
  FBCLID_PERSISTS_TO_CONVERSION,
  TRANSACTION_ID_MATCHES_ORDER_SYSTEM,
  EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER,
  USER_DATA_NORMALIZED_CONSISTENTLY,
  PII_PROPERLY_HASHED,
} from '../persistence';

// ─── Layer 1 ─────────────────────────────────────────────────────────────────

describe('GA4_PURCHASE_EVENT_FIRED', () => {
  it('passes when dataLayer has a purchase event', () => {
    expect(GA4_PURCHASE_EVENT_FIRED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('passes when GA4 network call is present', () => {
    const data = makeEmptyAuditData();
    data.networkRequests.push(makeNetworkRequest({ url: 'https://analytics.google.com/g/collect', body: 'en=purchase', step: 'confirmation' }));
    expect(GA4_PURCHASE_EVENT_FIRED.test(data).status).toBe('pass');
  });
  it('fails when neither event nor network call present', () => {
    expect(GA4_PURCHASE_EVENT_FIRED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('META_PIXEL_PURCHASE_EVENT_FIRED', () => {
  it('passes with Meta Pixel network request', () => {
    expect(META_PIXEL_PURCHASE_EVENT_FIRED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with no Meta requests', () => {
    expect(META_PIXEL_PURCHASE_EVENT_FIRED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('GOOGLE_ADS_CONVERSION_EVENT_FIRED', () => {
  it('passes with Google Ads conversion request', () => {
    expect(GOOGLE_ADS_CONVERSION_EVENT_FIRED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with no Google Ads requests', () => {
    expect(GOOGLE_ADS_CONVERSION_EVENT_FIRED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('SGTM_SERVER_EVENT_FIRED', () => {
  it('passes with sGTM POST request', () => {
    expect(SGTM_SERVER_EVENT_FIRED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with no sGTM POST', () => {
    expect(SGTM_SERVER_EVENT_FIRED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('DATALAYER_POPULATED', () => {
  it('passes with 2+ events', () => {
    expect(DATALAYER_POPULATED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('returns warning with exactly 1 event', () => {
    const data = makeEmptyAuditData();
    data.dataLayer.push({ event: 'page_view', timestamp: Date.now(), step: 'landing' });
    expect(DATALAYER_POPULATED.test(data).status).toBe('warning');
  });
  it('fails with 0 events', () => {
    expect(DATALAYER_POPULATED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('GTM_CONTAINER_LOADED', () => {
  it('passes when GTM loads quickly', () => {
    expect(GTM_CONTAINER_LOADED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('returns warning when GTM loads slowly (>2000ms)', () => {
    const data = makePerfectAuditData();
    data.networkRequests = [makeNetworkRequest({ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST', method: 'GET', step: 'landing', loadTime: 2500 })];
    expect(GTM_CONTAINER_LOADED.test(data).status).toBe('warning');
  });
  it('fails when GTM not loaded', () => {
    expect(GTM_CONTAINER_LOADED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('PAGE_VIEW_EVENT_FIRED', () => {
  it('passes with page_view event', () => {
    expect(PAGE_VIEW_EVENT_FIRED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with no page_view event', () => {
    const data = makeEmptyAuditData();
    data.dataLayer.push(makePurchaseEvent());
    expect(PAGE_VIEW_EVENT_FIRED.test(data).status).toBe('fail');
  });
});

describe('ADD_TO_CART_EVENT_FIRED', () => {
  it('passes with add_to_cart event', () => {
    expect(ADD_TO_CART_EVENT_FIRED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with no add_to_cart event', () => {
    expect(ADD_TO_CART_EVENT_FIRED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

// ─── Layer 2 ─────────────────────────────────────────────────────────────────

describe('TRANSACTION_ID_PRESENT', () => {
  it('passes with valid transaction_id', () => {
    expect(TRANSACTION_ID_PRESENT.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when transaction_id is missing', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ transaction_id: undefined })];
    expect(TRANSACTION_ID_PRESENT.test(data).status).toBe('fail');
  });
  it('fails when transaction_id is "null" string', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ transaction_id: 'null' })];
    expect(TRANSACTION_ID_PRESENT.test(data).status).toBe('fail');
  });
  it('fails with no purchase events', () => {
    expect(TRANSACTION_ID_PRESENT.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('VALUE_PARAMETER_PRESENT', () => {
  it('passes with positive value', () => {
    expect(VALUE_PARAMETER_PRESENT.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when value is 0', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ value: 0 })];
    expect(VALUE_PARAMETER_PRESENT.test(data).status).toBe('fail');
  });
  it('fails when value is missing', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ value: undefined })];
    expect(VALUE_PARAMETER_PRESENT.test(data).status).toBe('fail');
  });
});

describe('CURRENCY_PARAMETER_PRESENT', () => {
  it('passes with 3-letter currency code', () => {
    expect(CURRENCY_PARAMETER_PRESENT.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with missing currency', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ currency: undefined })];
    expect(CURRENCY_PARAMETER_PRESENT.test(data).status).toBe('fail');
  });
  it('fails with wrong-length currency', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ currency: 'US' })];
    expect(CURRENCY_PARAMETER_PRESENT.test(data).status).toBe('fail');
  });
});

describe('GCLID_CAPTURED_AT_LANDING', () => {
  it('passes when gclid in urlParams', () => {
    expect(GCLID_CAPTURED_AT_LANDING.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('passes when gclid in storage', () => {
    const data = makeEmptyAuditData();
    data.storage = { gclid: 'test_gclid_xxx' };
    expect(GCLID_CAPTURED_AT_LANDING.test(data).status).toBe('pass');
  });
  it('fails when gclid absent', () => {
    expect(GCLID_CAPTURED_AT_LANDING.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('FBCLID_CAPTURED_AT_LANDING', () => {
  it('passes with Meta Pixel request', () => {
    expect(FBCLID_CAPTURED_AT_LANDING.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('passes with fbclid in urlParams', () => {
    const data = makeEmptyAuditData();
    data.urlParams = { fbclid: 'test_fbclid_xxx' };
    expect(FBCLID_CAPTURED_AT_LANDING.test(data).status).toBe('pass');
  });
  it('fails with no Meta identifiers', () => {
    expect(FBCLID_CAPTURED_AT_LANDING.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('EVENT_ID_GENERATED', () => {
  it('passes with unique event_id per purchase event', () => {
    expect(EVENT_ID_GENERATED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when event_id is missing', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ event_id: undefined })];
    expect(EVENT_ID_GENERATED.test(data).status).toBe('fail');
  });
  it('fails when no purchase events', () => {
    expect(EVENT_ID_GENERATED.test(makeEmptyAuditData()).status).toBe('fail');
  });
});

describe('EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS', () => {
  it('passes with valid email in user_data', () => {
    expect(EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when user_data.email is missing', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { phone: '15551234567' } })];
    expect(EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS.test(data).status).toBe('fail');
  });
  it('fails when email has no @', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'notanemail' } })];
    expect(EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS.test(data).status).toBe('fail');
  });
});

describe('PHONE_CAPTURED_FOR_CAPI', () => {
  it('passes with 10-digit phone', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'a@b.com', phone: '15551234567' } })];
    expect(PHONE_CAPTURED_FOR_CAPI.test(data).status).toBe('pass');
  });
  it('fails when phone is missing', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'a@b.com' } })];
    expect(PHONE_CAPTURED_FOR_CAPI.test(data).status).toBe('fail');
  });
  it('fails when phone has fewer than 10 digits', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { phone: '12345' } })];
    expect(PHONE_CAPTURED_FOR_CAPI.test(data).status).toBe('fail');
  });
});

describe('ITEMS_ARRAY_POPULATED', () => {
  it('passes with valid items array', () => {
    expect(ITEMS_ARRAY_POPULATED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with empty items array', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ items: [] })];
    expect(ITEMS_ARRAY_POPULATED.test(data).status).toBe('fail');
  });
  it('fails with items missing required fields', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ items: [{ id: '', price: undefined, quantity: undefined }] })];
    expect(ITEMS_ARRAY_POPULATED.test(data).status).toBe('fail');
  });
});

describe('USER_ID_PRESENT', () => {
  it('passes with user_id', () => {
    expect(USER_ID_PRESENT.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails without user_id', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_id: undefined })];
    expect(USER_ID_PRESENT.test(data).status).toBe('fail');
  });
});

describe('COUPON_CAPTURED_IF_USED', () => {
  it('passes when coupon is present', () => {
    expect(COUPON_CAPTURED_IF_USED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('returns warning (not fail) when coupon absent but purchase present', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ coupon: undefined })];
    expect(COUPON_CAPTURED_IF_USED.test(data).status).toBe('warning');
  });
  it('passes when no purchase events (coupon not applicable)', () => {
    expect(COUPON_CAPTURED_IF_USED.test(makeEmptyAuditData()).status).toBe('pass');
  });
});

describe('SHIPPING_CAPTURED', () => {
  it('passes when shipping is present', () => {
    expect(SHIPPING_CAPTURED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('passes when shipping is 0 (free shipping)', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ shipping: 0 })];
    expect(SHIPPING_CAPTURED.test(data).status).toBe('pass');
  });
  it('returns warning when shipping absent and purchase present', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ shipping: undefined })];
    expect(SHIPPING_CAPTURED.test(data).status).toBe('warning');
  });
});

// ─── Layer 3 ─────────────────────────────────────────────────────────────────

describe('GCLID_PERSISTS_TO_CONVERSION', () => {
  it('passes when gclid in urlParams matches purchase event gclid', () => {
    expect(GCLID_PERSISTS_TO_CONVERSION.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when purchase event has no gclid', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ gclid: undefined })];
    expect(GCLID_PERSISTS_TO_CONVERSION.test(data).status).toBe('fail');
  });
  it('fails when gclid does not match landing page value', () => {
    const data = makePerfectAuditData();
    data.urlParams = { gclid: 'different_gclid' };
    expect(GCLID_PERSISTS_TO_CONVERSION.test(data).status).toBe('fail');
  });
});

describe('FBCLID_PERSISTS_TO_CONVERSION', () => {
  it('passes with Meta Pixel on landing and fbp/fbc cookies', () => {
    expect(FBCLID_PERSISTS_TO_CONVERSION.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when Meta cookies are missing', () => {
    const data = makePerfectAuditData();
    data.cookies = {};
    expect(FBCLID_PERSISTS_TO_CONVERSION.test(data).status).toBe('fail');
  });
  it('fails when Meta Pixel not detected on landing', () => {
    const data = makePerfectAuditData();
    data.pageMetadata = { pixel_fbclid: false };
    expect(FBCLID_PERSISTS_TO_CONVERSION.test(data).status).toBe('fail');
  });
});

describe('TRANSACTION_ID_MATCHES_ORDER_SYSTEM', () => {
  it('passes with valid transaction_id format', () => {
    expect(TRANSACTION_ID_MATCHES_ORDER_SYSTEM.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails with missing transaction_id', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ transaction_id: undefined })];
    expect(TRANSACTION_ID_MATCHES_ORDER_SYSTEM.test(data).status).toBe('fail');
  });
  it('fails with "null" string transaction_id', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ transaction_id: 'null' })];
    expect(TRANSACTION_ID_MATCHES_ORDER_SYSTEM.test(data).status).toBe('fail');
  });
});

describe('EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER', () => {
  it('passes when client event_id appears in sGTM request body', () => {
    expect(EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when event_id not in any sGTM request', () => {
    const data = makePerfectAuditData();
    data.networkRequests = data.networkRequests.filter((r) => !r.url.includes('sgtm'));
    expect(EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER.test(data).status).toBe('fail');
  });
  it('fails when client has no event_id', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ event_id: undefined })];
    expect(EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER.test(data).status).toBe('fail');
  });
});

describe('USER_DATA_NORMALIZED_CONSISTENTLY', () => {
  it('passes when email is lowercase+trimmed and phone is digits-only', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'test@example.com', phone: '15551234567' } })];
    expect(USER_DATA_NORMALIZED_CONSISTENTLY.test(data).status).toBe('pass');
  });
  it('returns warning when email has uppercase', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'Test@Example.COM', phone: '15551234567' } })];
    expect(USER_DATA_NORMALIZED_CONSISTENTLY.test(data).status).toBe('warning');
  });
  it('returns warning when phone has non-digit characters', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'test@example.com', phone: '+1 555-123-4567' } })];
    expect(USER_DATA_NORMALIZED_CONSISTENTLY.test(data).status).toBe('warning');
  });
  it('passes when no user_data present (not required field)', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: undefined })];
    expect(USER_DATA_NORMALIZED_CONSISTENTLY.test(data).status).toBe('pass');
  });
});

describe('PII_PROPERLY_HASHED', () => {
  it('passes when email is a valid SHA256 hash', () => {
    expect(PII_PROPERLY_HASHED.test(makePerfectAuditData()).status).toBe('pass');
  });
  it('fails when email is plaintext and sent to platform', () => {
    const data = makePerfectAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'test@example.com' } })];
    // networkRequests still contains facebook.com — so it IS sent to platform
    expect(PII_PROPERLY_HASHED.test(data).status).toBe('fail');
  });
  it('passes when no platform requests and no hashing (nothing sent)', () => {
    const data = makeEmptyAuditData();
    data.dataLayer = [makePurchaseEvent({ user_data: { email: 'test@example.com' } })];
    // No network requests to ad platforms
    expect(PII_PROPERLY_HASHED.test(data).status).toBe('pass');
  });
});
