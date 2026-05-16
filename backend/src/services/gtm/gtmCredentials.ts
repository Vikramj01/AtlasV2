/**
 * GTM OAuth credential encryption/decryption.
 *
 * Reuses the same AES-256-GCM envelope format as capi/credentials.ts.
 * Key: CAPI_ENCRYPTION_KEY (shared encryption key for all at-rest secrets).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import logger from '@/utils/logger';
import { env } from '@/config/env';

export interface GtmOAuthCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

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

export function encryptGtmCredentials(creds: GtmOAuthCredentials): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(creds);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: EncryptedEnvelope = {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
  return JSON.stringify(envelope);
}

export function decryptGtmCredentials(encrypted: string): GtmOAuthCredentials {
  const key = getKey();
  const envelope = JSON.parse(encrypted) as EncryptedEnvelope;
  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const ciphertext = Buffer.from(envelope.ciphertext, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as GtmOAuthCredentials;
}
