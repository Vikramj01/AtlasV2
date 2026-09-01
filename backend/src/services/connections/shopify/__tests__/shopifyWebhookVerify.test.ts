import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyWebhookHmac } from '../shopifyWebhookVerify';
import { env } from '@/config/env';

function sign(body: Buffer): string {
  return createHmac('sha256', env.SHOPIFY_APP_API_SECRET).update(body).digest('base64');
}

describe('verifyWebhookHmac', () => {
  it('accepts a correctly-signed body', () => {
    const body = Buffer.from(JSON.stringify({ id: 123, total_price: '49.99' }));
    expect(verifyWebhookHmac(body, sign(body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = Buffer.from(JSON.stringify({ id: 123, total_price: '49.99' }));
    const hmac = sign(body);
    const tampered = Buffer.from(JSON.stringify({ id: 123, total_price: '999.99' }));
    expect(verifyWebhookHmac(tampered, hmac)).toBe(false);
  });

  it('rejects a missing header', () => {
    const body = Buffer.from('{}');
    expect(verifyWebhookHmac(body, undefined)).toBe(false);
  });

  it('rejects a malformed (non-base64-matching-length) header', () => {
    const body = Buffer.from('{}');
    expect(verifyWebhookHmac(body, 'not-a-real-hmac')).toBe(false);
  });
});
