import { describe, it, expect } from 'vitest';
import { mapShopifyOrderToAtlasEvent } from '../shopifyOrderMapper';
import type { ShopifyOrderPayload } from '../shopifyOrderMapper';

const BASE_ORDER: ShopifyOrderPayload = {
  id: 5551234,
  name: '#1001',
  created_at: '2026-08-31T12:00:00-04:00',
  currency: 'USD',
  total_price: '129.99',
  email: 'customer@example.com',
  phone: '+15551234567',
  customer: { email: 'customer@example.com', phone: '+15551234567', first_name: 'Jane', last_name: 'Doe' },
  billing_address: { city: 'Austin', province_code: 'TX', zip: '78701', country_code: 'US' },
  line_items: [
    { product_id: 111, quantity: 2 },
    { product_id: 222, quantity: 1 },
  ],
};

describe('mapShopifyOrderToAtlasEvent', () => {
  it('maps core fields correctly', () => {
    const event = mapShopifyOrderToAtlasEvent('my-store.myshopify.com', BASE_ORDER);
    expect(event.event_name).toBe('purchase');
    expect(event.action_source).toBe('system_generated');
    expect(event.event_id).toBe('shopify_order_5551234');
    expect(event.custom_data?.value).toBe(129.99);
    expect(event.custom_data?.currency).toBe('USD');
    expect(event.custom_data?.order_id).toBe('5551234');
    expect(event.custom_data?.num_items).toBe(3);
    expect(event.custom_data?.content_ids).toEqual(['111', '222']);
  });

  it('maps user_data from customer + billing_address', () => {
    const event = mapShopifyOrderToAtlasEvent('my-store.myshopify.com', BASE_ORDER);
    expect(event.user_data.email).toBe('customer@example.com');
    expect(event.user_data.phone).toBe('+15551234567');
    expect(event.user_data.first_name).toBe('Jane');
    expect(event.user_data.city).toBe('Austin');
    expect(event.user_data.state).toBe('TX');
    expect(event.user_data.country).toBe('US');
  });

  it('falls back to order-level email/phone when customer object is absent', () => {
    const { customer, ...rest } = BASE_ORDER;
    void customer;
    const event = mapShopifyOrderToAtlasEvent('my-store.myshopify.com', rest);
    expect(event.user_data.email).toBe('customer@example.com');
    expect(event.user_data.phone).toBe('+15551234567');
  });

  it('has no live consent decision — all categories not_required', () => {
    const event = mapShopifyOrderToAtlasEvent('my-store.myshopify.com', BASE_ORDER);
    expect(event.consent_state).toEqual({
      analytics: 'not_required',
      marketing: 'not_required',
      personalisation: 'not_required',
      functional: 'not_required',
    });
  });

  it('never captures gclid/fbclid in v1 (deferred scope)', () => {
    const event = mapShopifyOrderToAtlasEvent('my-store.myshopify.com', BASE_ORDER);
    expect(event.user_data.gclid).toBeUndefined();
    expect(event.user_data.fbc).toBeUndefined();
    expect(event.user_data.fbp).toBeUndefined();
  });

  it('handles missing line_items gracefully', () => {
    const { line_items, ...rest } = BASE_ORDER;
    void line_items;
    const event = mapShopifyOrderToAtlasEvent('my-store.myshopify.com', rest);
    expect(event.custom_data?.num_items).toBe(0);
    expect(event.custom_data?.content_ids).toEqual([]);
  });
});
