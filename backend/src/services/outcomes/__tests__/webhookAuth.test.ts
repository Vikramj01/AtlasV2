import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  generateWebhookSecret,
  encryptWebhookSecret,
  decryptWebhookSecret,
  verifyWebhookRequest,
} from '../webhookAuth';

function sign(secret: string, timestamp: string, body: Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

describe('generateWebhookSecret', () => {
  it('generates a long, random hex string', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('encryptWebhookSecret / decryptWebhookSecret', () => {
  it('round-trips a secret exactly', () => {
    const secret = generateWebhookSecret();
    const encrypted = encryptWebhookSecret(secret);
    expect(decryptWebhookSecret(encrypted)).toBe(secret);
  });

  it('never stores the plaintext secret inside the encrypted envelope', () => {
    const secret = 'a-very-identifiable-secret-value';
    const encrypted = encryptWebhookSecret(secret);
    expect(encrypted).not.toContain(secret);
  });

  it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
    const secret = generateWebhookSecret();
    expect(encryptWebhookSecret(secret)).not.toBe(encryptWebhookSecret(secret));
  });
});

describe('verifyWebhookRequest', () => {
  const secret = 'test-secret-123';
  const body = Buffer.from(JSON.stringify({ source_record_id: 'r1' }));

  it('accepts a correctly signed, fresh request', () => {
    const timestamp = String(Date.now());
    const signature = sign(secret, timestamp, body);
    expect(verifyWebhookRequest(body, secret, signature, timestamp)).toEqual({ valid: true });
  });

  it('rejects a missing signature header', () => {
    const timestamp = String(Date.now());
    expect(verifyWebhookRequest(body, secret, undefined, timestamp)).toEqual({ valid: false, reason: 'missing_signature' });
  });

  it('rejects a missing timestamp header', () => {
    const timestamp = String(Date.now());
    const signature = sign(secret, timestamp, body);
    expect(verifyWebhookRequest(body, secret, signature, undefined)).toEqual({ valid: false, reason: 'missing_timestamp' });
  });

  it('rejects a non-numeric timestamp', () => {
    const signature = sign(secret, 'not-a-number', body);
    expect(verifyWebhookRequest(body, secret, signature, 'not-a-number')).toEqual({ valid: false, reason: 'invalid_timestamp' });
  });

  it('rejects a timestamp outside the replay window', () => {
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes old
    const signature = sign(secret, staleTimestamp, body);
    expect(verifyWebhookRequest(body, secret, signature, staleTimestamp)).toEqual({ valid: false, reason: 'timestamp_out_of_window' });
  });

  it('rejects a wrong-secret signature', () => {
    const timestamp = String(Date.now());
    const signature = sign('wrong-secret', timestamp, body);
    expect(verifyWebhookRequest(body, secret, signature, timestamp)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a tampered body even with a valid-looking signature for the original body', () => {
    const timestamp = String(Date.now());
    const signature = sign(secret, timestamp, body);
    const tamperedBody = Buffer.from(JSON.stringify({ source_record_id: 'r2' }));
    expect(verifyWebhookRequest(tamperedBody, secret, signature, timestamp)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature that was computed without the timestamp (replay-with-bumped-timestamp attempt)', () => {
    // Attacker captures a valid (body, signature) pair for an old timestamp
    // and tries to replay it with a freshly bumped timestamp to slip past
    // the window check — the signature no longer matches because the
    // timestamp is part of what's signed.
    const originalTimestamp = String(Date.now() - 10 * 60 * 1000);
    const signature = sign(secret, originalTimestamp, body);
    const bumpedTimestamp = String(Date.now());
    expect(verifyWebhookRequest(body, secret, signature, bumpedTimestamp)).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a malformed (non-hex) signature without throwing', () => {
    const timestamp = String(Date.now());
    expect(() => verifyWebhookRequest(body, secret, 'not-hex-!!!', timestamp)).not.toThrow();
    expect(verifyWebhookRequest(body, secret, 'not-hex-!!!', timestamp).valid).toBe(false);
  });
});
