/**
 * PII Hashing for CAPI Events
 *
 * Ad platforms (Meta, Google) require specific normalisation before SHA-256
 * hashing. Wrong normalisation = lower match quality (EMQ) even if the event
 * reaches the platform.
 *
 * Rules applied per field:
 *   email        — lowercase, trim whitespace
 *   phone        — strip everything except digits and leading +, E.164 format
 *   first_name   — lowercase, trim, strip punctuation
 *   last_name    — lowercase, trim, strip punctuation
 *   city         — lowercase, trim, remove spaces
 *   state        — lowercase, trim, 2-letter ISO code where possible
 *   zip          — lowercase, trim (US: 5 digits; international: as-is)
 *   country      — lowercase, 2-letter ISO 3166-1 alpha-2
 *
 * Click IDs (gclid, fbc, fbp, wbraid, gbraid) are NEVER hashed — sent raw.
 *
 * Reference:
 *   Meta:   https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 *   Google: https://developers.google.com/google-ads/api/docs/conversions/enhanced-conversions/web#normalizing_and_hashing
 */

import { sha256, sha256OrNull } from '@/lib/shared/crypto';
import type { HashedIdentifier, IdentifierType } from '@/types/capi';

// ── Normalisation ─────────────────────────────────────────────────────────────

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Normalise a phone number toward E.164 format.
 * Strips spaces, dashes, parentheses, dots.
 * Preserves a leading '+' if present.
 * Does NOT add a country code — the caller must supply one if missing.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  // Keep leading + then strip all non-digit chars
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function normaliseName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z\u00C0-\u024F\s-]/g, '') // keep letters (incl. accented), spaces, hyphens
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseCity(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '');
}

export function normaliseState(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normaliseZip(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normaliseCountry(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 2);
}

// ── Hash individual fields ────────────────────────────────────────────────────

export async function hashEmail(raw: string): Promise<string> {
  return sha256(normaliseEmail(raw));
}

export async function hashPhone(raw: string): Promise<string> {
  return sha256(normalisePhone(raw));
}

export async function hashFirstName(raw: string): Promise<string> {
  return sha256(normaliseName(raw));
}

export async function hashLastName(raw: string): Promise<string> {
  return sha256(normaliseName(raw));
}

export async function hashCity(raw: string): Promise<string> {
  return sha256(normaliseCity(raw));
}

export async function hashState(raw: string): Promise<string> {
  return sha256(normaliseState(raw));
}

export async function hashZip(raw: string): Promise<string> {
  return sha256(normaliseZip(raw));
}

export async function hashCountry(raw: string): Promise<string> {
  return sha256(normaliseCountry(raw));
}

// ── Batch hasher — converts AtlasEvent user_data → HashedIdentifier[] ─────────

export interface RawUserData {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  external_id?: string;
  // Click IDs — sent raw, never hashed
  fbc?: string;
  fbp?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
}

/**
 * Takes raw user_data from an AtlasEvent and returns an array of
 * HashedIdentifier objects ready to be included in a CAPI payload.
 *
 * PII fields are normalised then SHA-256 hashed.
 * Click IDs are returned as-is (is_hashed: false).
 * Empty / undefined fields are omitted.
 */
export async function hashUserData(
  raw: RawUserData,
  enabledIdentifiers: IdentifierType[],
): Promise<HashedIdentifier[]> {
  const enabled = new Set(enabledIdentifiers);
  const results: HashedIdentifier[] = [];

  async function pushHashed(
    type: IdentifierType,
    rawValue: string | undefined,
    hasher: (v: string) => Promise<string>,
  ): Promise<void> {
    if (!enabled.has(type) || !rawValue || rawValue.trim() === '') return;
    results.push({ type, value: await hasher(rawValue), is_hashed: true });
  }

  function pushRaw(type: IdentifierType, rawValue: string | undefined): void {
    if (!enabled.has(type) || !rawValue || rawValue.trim() === '') return;
    results.push({ type, value: rawValue.trim(), is_hashed: false });
  }

  await Promise.all([
    pushHashed('email',    raw.email,      hashEmail),
    pushHashed('phone',    raw.phone,      hashPhone),
    pushHashed('fn',       raw.first_name, hashFirstName),
    pushHashed('ln',       raw.last_name,  hashLastName),
    pushHashed('ct',       raw.city,       hashCity),
    pushHashed('st',       raw.state,      hashState),
    pushHashed('zp',       raw.zip,        hashZip),
    pushHashed('country',  raw.country,    hashCountry),
  ]);

  // external_id: hashed per Meta spec, raw per Google — hash by default
  if (enabled.has('external_id') && raw.external_id) {
    const hashed = await sha256OrNull(raw.external_id);
    if (hashed) results.push({ type: 'external_id', value: hashed, is_hashed: true });
  }

  // Click IDs — always raw
  pushRaw('fbc',    raw.fbc);
  pushRaw('fbp',    raw.fbp);
  pushRaw('gclid',  raw.gclid);
  pushRaw('wbraid', raw.wbraid);
  pushRaw('gbraid', raw.gbraid);

  return results;
}
