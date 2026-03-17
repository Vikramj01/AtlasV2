/**
 * CAPI Credential Encryption
 *
 * Provider credentials (access tokens, pixel IDs) are encrypted at rest using
 * AES-256-GCM via Node.js built-in `crypto`. A random 12-byte IV is generated
 * per encryption and stored alongside the ciphertext as a JSON envelope.
 *
 * Envelope format: { iv: hex, tag: hex, ciphertext: hex }
 *
 * Key: CAPI_ENCRYPTION_KEY env var — 64 hex chars (32 bytes = 256 bits).
 * If the key is absent (dev/test without the env var), a deterministic
 * all-zeros dev key is used and a warning is logged. NEVER use in production
 * without setting a real key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import logger from '@/utils/logger';
import { env } from '@/config/env';
import type { ProviderCredentials } from '@/types/capi';

interface EncryptedEnvelope {
  iv: string;
  tag: string;
  ciphertext: string;
}

function getKey(): Buffer {
  const hex = env.CAPI_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CAPI_ENCRYPTION_KEY must be set to a 64-char hex string in production');
    }
    logger.warn('CAPI_ENCRYPTION_KEY not set — using dev zero-key (unsafe for production)');
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex, 'hex');
}

export function encryptCredentials(creds: ProviderCredentials): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(creds);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
  return JSON.stringify(envelope);
}

export function decryptCredentials(encrypted: string): ProviderCredentials {
  const key = getKey();
  const envelope = JSON.parse(encrypted) as EncryptedEnvelope;

  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertext, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(plaintext) as ProviderCredentials;
}

/**
 * Store raw credentials JSON (from DB JSONB column) through decryption.
 * Handles both the encrypted envelope string and legacy plain-object shapes
 * (for test/dev seeds that bypass encryption).
 */
export function safeDecryptCredentials(raw: unknown): ProviderCredentials {
  if (typeof raw === 'string') {
    return decryptCredentials(raw);
  }
  // Plain object (test seed or if encryption was skipped)
  return raw as ProviderCredentials;
}
