/**
 * Webhook authentication — docs/prd/universal-outcome-ingestion.md §6.1.
 *
 * HMAC-SHA256 over the raw request body, keyed by the config's OWN
 * per-source secret — never a shared app-wide secret. Unlike
 * shopifyWebhookVerify.ts (one global SHOPIFY_APP_API_SECRET, since every
 * Shopify webhook comes from the same app), this endpoint serves many
 * independent external senders, one per outcome_source_configs row, so a
 * forged payload for one client's config must never be able to pass by
 * reusing another client's valid signature.
 *
 * Replay protection (§6.1): the timestamp is signed together with the
 * body (`${timestamp}.${rawBody}`), not merely checked separately — an
 * attacker who intercepts one valid (body, signature, timestamp) tuple
 * cannot bump the timestamp to slip a stale-but-otherwise-valid replay
 * past the window check, since a new timestamp needs a new signature,
 * which needs the secret. The existing deterministic event_id idempotency
 * (eventId.ts's computeEventId, shared by syncOrchestrator.ts and
 * webhookIngest.ts) is what actually stops a genuinely-in-window replay from double-delivering
 * — this header check only bounds how long a captured request stays replayable.
 *
 * Secret encryption mirrors api/routes/slack.ts's own webhook-URL
 * encryption (AES-256-GCM, iv/tag/ciphertext JSON envelope,
 * CAPI_ENCRYPTION_KEY) rather than tokenManager.ts's OAuth-token-shaped
 * encryptTokens/resolveTokens — this is a single opaque string, not an
 * OAuthTokens envelope.
 */
import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '@/config/env';

export const WEBHOOK_SIGNATURE_HEADER = 'x-atlas-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-atlas-timestamp';

// How long a signed request stays acceptable. Generous enough for real
// clock drift and network retries, tight enough that a leaked request
// capture isn't replayable indefinitely.
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

interface EncEnvelope { iv: string; tag: string; ciphertext: string }

function getEncKey(): Buffer {
  const hex = env.CAPI_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CAPI_ENCRYPTION_KEY must be set in production');
    }
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex, 'hex');
}

export function encryptWebhookSecret(plain: string): string {
  const key = getEncKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncEnvelope = { iv: iv.toString('hex'), tag: tag.toString('hex'), ciphertext: ct.toString('hex') };
  return JSON.stringify(envelope);
}

export function decryptWebhookSecret(encrypted: string): string {
  const key = getEncKey();
  const { iv, tag, ciphertext } = JSON.parse(encrypted) as EncEnvelope;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

export type WebhookVerifyFailureReason =
  | 'missing_signature' | 'missing_timestamp' | 'invalid_timestamp'
  | 'timestamp_out_of_window' | 'signature_mismatch';

export interface WebhookVerifyResult {
  valid: boolean;
  reason?: WebhookVerifyFailureReason;
}

export function verifyWebhookRequest(
  rawBody: Buffer,
  secret: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
): WebhookVerifyResult {
  if (!signatureHeader) return { valid: false, reason: 'missing_signature' };
  if (!timestampHeader) return { valid: false, reason: 'missing_timestamp' };

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) return { valid: false, reason: 'invalid_timestamp' };
  if (Math.abs(Date.now() - timestampMs) > REPLAY_WINDOW_MS) return { valid: false, reason: 'timestamp_out_of_window' };

  const expected = createHmac('sha256', secret)
    .update(`${timestampHeader}.`)
    .update(rawBody)
    .digest('hex');

  // Buffer.from(..., 'hex') never throws on malformed input — it silently
  // stops at the first invalid character, which the length check below
  // already catches (a truncated buffer can't match expected's length).
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signatureHeader, 'hex');
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  return { valid: true };
}
