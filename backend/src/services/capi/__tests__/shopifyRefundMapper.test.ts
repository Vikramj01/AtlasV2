import { describe, it, expect } from 'vitest';
import { mapShopifyRefundToRecordRefundInput } from '../shopifyRefundMapper';
import type { ShopifyRefundPayload } from '../shopifyRefundMapper';
import type { ShopifyOrderPayload } from '../shopifyOrderMapper';

const ORDER: ShopifyOrderPayload = {
  id: 5551234,
  currency: 'USD',
  total_price: '100.00',
  email: 'customer@example.com',
  phone: '+15551234567',
};

describe('mapShopifyRefundToRecordRefundInput', () => {
  it('maps a full refund (amount == order total) as not partial', () => {
    const refund: ShopifyRefundPayload = {
      id: 999,
      order_id: 5551234,
      transactions: [{ amount: '100.00', currency: 'USD', status: 'success' }],
    };
    const input = mapShopifyRefundToRecordRefundInput(refund, ORDER);
    expect(input.original_transaction_id).toBe('5551234');
    expect(input.refund_amount).toBe(100);
    expect(input.is_partial).toBe(false);
    expect(input.new_conversion_value).toBeUndefined();
  });

  it('maps a partial refund with an absolute new_conversion_value (not a delta)', () => {
    const refund: ShopifyRefundPayload = {
      id: 999,
      order_id: 5551234,
      transactions: [{ amount: '30.00', currency: 'USD', status: 'success' }],
    };
    const input = mapShopifyRefundToRecordRefundInput(refund, ORDER);
    expect(input.refund_amount).toBe(30);
    expect(input.is_partial).toBe(true);
    expect(input.new_conversion_value).toBe(70);
  });

  it('sums multiple successful refund transactions', () => {
    const refund: ShopifyRefundPayload = {
      id: 999,
      order_id: 5551234,
      transactions: [
        { amount: '20.00', currency: 'USD', status: 'success' },
        { amount: '10.00', currency: 'USD', status: 'success' },
      ],
    };
    const input = mapShopifyRefundToRecordRefundInput(refund, ORDER);
    expect(input.refund_amount).toBe(30);
    expect(input.is_partial).toBe(true);
    expect(input.new_conversion_value).toBe(70);
  });

  it('excludes non-successful transactions from the refund total', () => {
    const refund: ShopifyRefundPayload = {
      id: 999,
      order_id: 5551234,
      transactions: [
        { amount: '30.00', currency: 'USD', status: 'success' },
        { amount: '999.00', currency: 'USD', status: 'failure' },
      ],
    };
    const input = mapShopifyRefundToRecordRefundInput(refund, ORDER);
    expect(input.refund_amount).toBe(30);
  });

  it('carries customer identity from the order for the Google audience-removal call', () => {
    const refund: ShopifyRefundPayload = {
      id: 999,
      order_id: 5551234,
      transactions: [{ amount: '100.00', currency: 'USD', status: 'success' }],
    };
    const input = mapShopifyRefundToRecordRefundInput(refund, ORDER);
    expect(input.email).toBe('customer@example.com');
    expect(input.phone).toBe('+15551234567');
  });

  it('never lets new_conversion_value go negative on an over-refund edge case', () => {
    const refund: ShopifyRefundPayload = {
      id: 999,
      order_id: 5551234,
      transactions: [{ amount: '150.00', currency: 'USD', status: 'success' }],
    };
    const input = mapShopifyRefundToRecordRefundInput(refund, ORDER);
    expect(input.is_partial).toBe(false);
  });
});
