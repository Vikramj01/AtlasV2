import { describe, it, expect } from 'vitest';
import {
  isValidShopDomain,
  generateState,
  verifyState,
  verifyCallbackHmac,
} from '../shopifyOAuth';
import { createHmac } from 'crypto';
import { env } from '@/config/env';

describe('isValidShopDomain', () => {
  it('accepts a well-formed myshopify.com domain', () => {
    expect(isValidShopDomain('my-store.myshopify.com')).toBe(true);
  });

  it('rejects a non-myshopify domain', () => {
    expect(isValidShopDomain('my-store.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidShopDomain('')).toBe(false);
  });

  it('rejects a domain with a scheme prefix', () => {
    expect(isValidShopDomain('https://my-store.myshopify.com')).toBe(false);
  });
});

describe('generateState / verifyState', () => {
  it('round-trips for the matching shop', () => {
    const state = generateState('my-store.myshopify.com');
    expect(() => verifyState(state, 'my-store.myshopify.com')).not.toThrow();
  });

  it('rejects a state generated for a different shop', () => {
    const state = generateState('shop-a.myshopify.com');
    expect(() => verifyState(state, 'shop-b.myshopify.com')).toThrow(/shop domain mismatch/);
  });

  it('rejects a tampered state', () => {
    const state = generateState('my-store.myshopify.com');
    const tampered = state.slice(0, -4) + 'abcd';
    expect(() => verifyState(tampered, 'my-store.myshopify.com')).toThrow();
  });

  it('rejects a malformed state string', () => {
    expect(() => verifyState('not-a-real-state', 'my-store.myshopify.com')).toThrow();
  });
});

describe('verifyCallbackHmac', () => {
  function signQuery(query: Record<string, string>): string {
    const message = Object.keys(query)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join('&');
    return createHmac('sha256', env.SHOPIFY_APP_API_SECRET).update(message).digest('hex');
  }

  it('accepts a correctly-signed query', () => {
    const query = { shop: 'my-store.myshopify.com', code: 'abc123', timestamp: '1700000000' };
    const hmac = signQuery(query);
    expect(verifyCallbackHmac({ ...query, hmac })).toBe(true);
  });

  it('rejects a tampered query', () => {
    const query = { shop: 'my-store.myshopify.com', code: 'abc123', timestamp: '1700000000' };
    const hmac = signQuery(query);
    expect(verifyCallbackHmac({ ...query, code: 'tampered', hmac })).toBe(false);
  });

  it('rejects a missing hmac', () => {
    expect(verifyCallbackHmac({ shop: 'my-store.myshopify.com' })).toBe(false);
  });

  it('ignores the signature param, matching Shopify verification spec', () => {
    const query = { shop: 'my-store.myshopify.com', code: 'abc123' };
    const hmac = signQuery(query);
    expect(verifyCallbackHmac({ ...query, hmac, signature: 'irrelevant' })).toBe(true);
  });
});
