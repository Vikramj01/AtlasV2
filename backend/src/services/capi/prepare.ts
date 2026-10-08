/**
 * Identifier preparation (pipeline steps 3 + 3a), split out of pipeline.ts so the junk gate can
 * run exactly the same step at HOLD time and store the result: a held conversion is released
 * with the identifiers it would have been sent with, never re-derived later from raw PII.
 */
import { createHash } from 'crypto';
import type { AtlasEvent, CAPIProviderConfig, HashedIdentifier, IdentifierType } from '@/types/capi';
import { checkUserParamCompleteness } from './metaDelivery';
import logger from '@/utils/logger';

// ── PII Hashing ───────────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function normaliseEmail(v: string): string { return v.trim().toLowerCase(); }
function normalisePhone(v: string): string {
  const hasPlus = v.trim().startsWith('+');
  const digits = v.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}
function normaliseName(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z\u00C0-\u024F\s-]/g, '').replace(/\s+/g, ' ').trim();
}
function normaliseCity(v: string): string { return v.trim().toLowerCase().replace(/\s+/g, ''); }
function normaliseState(v: string): string { return v.trim().toLowerCase(); }
function normaliseZip(v: string): string { return v.trim().toLowerCase(); }
function normaliseCountry(v: string): string { return v.trim().toLowerCase().slice(0, 2); }

export function buildHashedIdentifiers(
  event: AtlasEvent,
  enabledIdentifiers: IdentifierType[],
): HashedIdentifier[] {
  const enabled = new Set(enabledIdentifiers);
  const results: HashedIdentifier[] = [];

  function pushHashed(type: IdentifierType, raw: string | undefined, normalise: (v: string) => string): void {
    if (!enabled.has(type) || !raw || raw.trim() === '') return;
    results.push({ type, value: sha256hex(normalise(raw)), is_hashed: true });
  }

  function pushRaw(type: IdentifierType, raw: string | undefined): void {
    if (!enabled.has(type) || !raw || raw.trim() === '') return;
    results.push({ type, value: raw.trim(), is_hashed: false });
  }

  const ud = event.user_data;
  pushHashed('email',   ud.email,      normaliseEmail);
  pushHashed('phone',   ud.phone,      normalisePhone);
  pushHashed('fn',      ud.first_name, normaliseName);
  pushHashed('ln',      ud.last_name,  normaliseName);
  pushHashed('ct',      ud.city,       normaliseCity);
  pushHashed('st',      ud.state,      normaliseState);
  pushHashed('zp',      ud.zip,        normaliseZip);
  pushHashed('country', ud.country,    normaliseCountry);

  if (enabled.has('external_id') && ud.external_id) {
    results.push({ type: 'external_id', value: sha256hex(ud.external_id), is_hashed: true });
  }

  // Click IDs — raw
  pushRaw('fbc',    ud.fbc);
  pushRaw('fbp',    ud.fbp);
  pushRaw('gclid',  ud.gclid);
  pushRaw('wbraid', ud.wbraid);
  pushRaw('gbraid', ud.gbraid);
  pushRaw('ttclid', ud.ttclid);
  pushRaw('oppref', ud.oppref);

  return results;
}


export interface PreparedDelivery {
  event: AtlasEvent;
  identifiers: HashedIdentifier[];
}

/** Pipeline steps 3 and 3a: hash PII and apply the Meta pre-flight fallback. */
export function prepareForDelivery(event: AtlasEvent, providerConfig: CAPIProviderConfig): PreparedDelivery {
  const { provider, identifier_config } = providerConfig;
  const identifiers = buildHashedIdentifiers(event, identifier_config.enabled_identifiers);

  if (provider === 'meta') {
    // Fallback: use email as external_id when external_id is absent
    if (!event.user_data.external_id && event.user_data.email) {
      event = { ...event, user_data: { ...event.user_data, external_id: event.user_data.email } };
      // Re-hash identifiers with the new external_id
      identifiers.push({ type: 'external_id', value: identifiers.find(i => i.type === 'email')?.value ?? '', is_hashed: true });
      logger.info({ event_id: event.event_id }, 'Meta: using hashed email as external_id fallback');
    } else if (!event.user_data.external_id) {
      logger.warn({ event_id: event.event_id }, 'Meta: external_id missing and no email for fallback');
    }

    // Warn on low user param count
    const completeness = checkUserParamCompleteness(
      identifiers,
      !!event.user_data.client_user_agent,
      !!event.user_data.client_ip_address,
    );
    if (completeness) {
      logger.warn(
        { event_id: event.event_id, param_count: completeness.param_count, missing: completeness.missing_recommended },
        'Meta: low user parameter count — match quality may be reduced',
      );
    }
  }

  return { event, identifiers };
}
