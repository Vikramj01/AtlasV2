/**
 * Shared SHA-256 hashing utility.
 *
 * Works in both environments:
 *   Browser  — Web Crypto API (crypto.subtle)
 *   Node.js  — built-in `crypto` module (used by backend pipeline)
 *
 * Always returns a lowercase hex string.
 */

/**
 * Hash a UTF-8 string with SHA-256.
 * Returns a lowercase 64-character hex string.
 */
export async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);

  // Browser / Vite / Cloudflare Workers — Web Crypto API
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return bufferToHex(hashBuffer);
  }

  // Node.js fallback (used by backend code that imports this module)
  const { createHash } = await import('crypto');
  return createHash('sha256').update(encoded).digest('hex');
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash a value only if it is a non-empty string.
 * Returns null for empty / null / undefined inputs.
 */
export async function sha256OrNull(input: string | null | undefined): Promise<string | null> {
  if (!input || input.trim() === '') return null;
  return sha256(input.trim());
}
