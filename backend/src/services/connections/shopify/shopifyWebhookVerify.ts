import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '@/config/env';

// Verifies the X-Shopify-Hmac-Sha256 header on an inbound webhook: a
// base64 HMAC-SHA256 digest of the raw request body using the app's client
// secret. Distinct from the OAuth callback's query-string HMAC (hex digest,
// see shopifyOAuth.ts's verifyCallbackHmac) — same secret, different input
// and encoding, per Shopify's webhook vs. OAuth verification specs.
export function verifyWebhookHmac(rawBody: Buffer, headerHmac: string | undefined): boolean {
  if (!headerHmac) return false;

  const expected = createHmac('sha256', env.SHOPIFY_APP_API_SECRET)
    .update(rawBody)
    .digest('base64');

  const expectedBuf = Buffer.from(expected, 'base64');
  const receivedBuf = Buffer.from(headerHmac, 'base64');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
