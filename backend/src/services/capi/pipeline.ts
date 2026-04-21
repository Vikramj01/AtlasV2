/**
 * CAPI Server-Side Processing Pipeline
 *
 * For each incoming AtlasEvent:
 *   1. Consent gate  — reject if required categories are denied
 *   2. Dedup check   — skip if event_id seen within dedup window
 *   3. Hash PII      — normalise + SHA-256 hash user_data fields
 *   4. Format        — build provider-specific payload
 *   5. Deliver       — send to provider API
 *   6. Log           — write CAPIEvent record to DB
 *   7. Counters      — increment provider sent/failed totals
 *
 * Supports: Meta CAPI, Google Enhanced Conversions
 */

import { createHash, randomUUID } from 'crypto';
import type {
  AtlasEvent,
  CAPIProviderConfig,
  CAPIProvider,
  HashedIdentifier,
  IdentifierType,
  DeliveryResult,
  EventMapping,
} from '@/types/capi';
import { safeDecryptCredentials } from './credentials';
import { isEventDuplicate, createCAPIEvent, incrementProviderCounters } from '@/services/database/capiQueries';
import { sendMetaEvents, checkUserParamCompleteness } from './metaDelivery';
import { sendGoogleEvents } from './googleDelivery';
import type { MetaCredentials, GoogleCredentials } from '@/types/capi';
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

function buildHashedIdentifiers(
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

  return results;
}

// ── Consent gate ──────────────────────────────────────────────────────────────

function isConsentGranted(event: AtlasEvent, provider: CAPIProvider): boolean {
  const d = event.consent_state;
  if (!d) return false;

  switch (provider) {
    case 'meta':
      // Meta requires marketing consent
      return d.marketing === 'granted';
    case 'google':
      // Google requires analytics consent
      return d.analytics === 'granted';
    default:
      return d.marketing === 'granted';
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  event_id: string;
  status: 'delivered' | 'failed' | 'consent_blocked' | 'dedup_skipped';
  provider_response?: unknown;
  error_code?: string;
  error_message?: string;
}

export async function processEvent(
  event: AtlasEvent,
  providerConfig: CAPIProviderConfig,
): Promise<PipelineResult> {
  const { id: providerId, provider, organization_id, identifier_config, dedup_config, event_mapping } = providerConfig;

  // 0. Ensure event_id is present — auto-generate UUID if caller omitted it
  if (!event.event_id) {
    event = { ...event, event_id: randomUUID() };
  }

  // 1. Consent gate
  if (!isConsentGranted(event, provider)) {
    await createCAPIEvent({
      provider_config_id: providerId,
      organization_id,
      atlas_event_id: event.event_id,
      provider_event_name: resolveProviderEvent(event.event_name, event_mapping),
      status: 'consent_blocked',
      consent_state: event.consent_state as Record<string, string>,
      identifiers_sent: 0,
    });
    return { event_id: event.event_id, status: 'consent_blocked' };
  }

  // 2. Dedup check
  if (dedup_config.enabled) {
    const isDup = await isEventDuplicate(providerId, event.event_id, dedup_config.dedup_window_minutes);
    if (isDup) {
      logger.debug({ event_id: event.event_id, provider }, 'CAPI dedup: skipping duplicate event');
      return { event_id: event.event_id, status: 'dedup_skipped' };
    }
  }

  // 3. Hash PII
  const identifiers = buildHashedIdentifiers(event, identifier_config.enabled_identifiers);

  // 3a. Meta-specific pre-flight checks
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

  // 4 + 5. Format + deliver (provider-specific)
  let results: DeliveryResult[];
  try {
    results = await deliverToProvider(event, identifiers, providerConfig);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ event_id: event.event_id, provider, err: errMsg }, 'CAPI delivery threw');
    results = [{
      event_id: event.event_id,
      status: 'failed',
      provider_response: null,
      error_code: 'DELIVERY_ERROR',
      error_message: errMsg,
    }];
  }

  const result = results[0];
  const delivered = result.status === 'delivered';

  // 6. Log event
  const mapping = resolveProviderEvent(event.event_name, event_mapping);
  await createCAPIEvent({
    provider_config_id: providerId,
    organization_id,
    atlas_event_id: event.event_id,
    provider_event_name: mapping,
    status: delivered ? 'delivered' : 'delivery_failed',
    consent_state: event.consent_state as Record<string, string>,
    identifiers_sent: identifiers.length,
    event_value: event.custom_data?.value ?? null,
    event_currency: event.custom_data?.currency ?? null,
    provider_response: result.provider_response,
    error_code: result.error_code ?? null,
    error_message: result.error_message ?? null,
  });

  // 7. Counters
  await incrementProviderCounters(providerId, delivered ? 1 : 0, delivered ? 0 : 1);

  return {
    event_id: event.event_id,
    status: delivered ? 'delivered' : 'failed',
    provider_response: result.provider_response,
    error_code: result.error_code,
    error_message: result.error_message,
  };
}

// ── Provider dispatch ─────────────────────────────────────────────────────────

async function deliverToProvider(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  config: CAPIProviderConfig,
): Promise<DeliveryResult[]> {
  const creds = safeDecryptCredentials(config.credentials);

  switch (config.provider) {
    case 'meta': {
      const metaDpo = config.data_processing_options?.length
        ? {
            options: config.data_processing_options,
            country: config.data_processing_options_country ?? 0,
            state:   config.data_processing_options_state   ?? 0,
          }
        : undefined;
      return sendMetaEvents(
        [event],
        [identifiers],
        config.event_mapping,
        creds as MetaCredentials,
        config.test_event_code,
        metaDpo,
      );
    }

    case 'google':
      return sendGoogleEvents(
        [event],
        [identifiers],
        config.event_mapping,
        creds as GoogleCredentials,
      );

    default:
      return [{
        event_id: event.event_id,
        status: 'failed',
        provider_response: null,
        error_code: 'UNSUPPORTED_PROVIDER',
        error_message: `Provider ${config.provider} not yet supported`,
      }];
  }
}

function resolveProviderEvent(atlasEvent: string, mappings: EventMapping[]): string {
  return mappings.find(m => m.atlas_event === atlasEvent)?.provider_event ?? atlasEvent;
}
