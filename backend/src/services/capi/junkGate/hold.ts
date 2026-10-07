/**
 * Holding one destination's copy of a conversion (GA4 Admin / L11 / Junk Gate PRD §C.6, C2).
 *
 * `/api/capi/process` is called once per provider, so an Atlas event is held PER DESTINATION: each
 * call prepares its own identifiers (the exact step the pipeline would have run — `prepareForDelivery`)
 * and stores them, with the event, as one encrypted target under the event's single hold record.
 *
 * What is stored: identifiers already hashed (SHA-256, per that provider's enabled set); the event
 * with raw email, phone, names and address REMOVED from `user_data`; `external_id` replaced by a
 * hash. Click ids, user agent and IP stay in the (AES-256-GCM encrypted) blob because delivery
 * needs them verbatim. The blob is nulled on every terminal status (release.ts).
 *
 * Replaced `external_id`: amazon/microsoft delivery read `external_id ?? email` as a stable key.
 * A released hold supplies the hash of that same value instead of the raw string. It is stable
 * and unique per person, which is all those modules use it for, but it is NOT byte-identical to
 * what a never-held event would have sent — recorded in the PRD §12 C2 notes.
 */
import { createHash } from 'crypto';
import type { AtlasEvent, CAPIProviderConfig, HashedIdentifier } from '@/types/capi';
import { prepareForDelivery } from '../prepare';
import { encryptJson } from '../credentials';
import { createCAPIEvent } from '@/services/database/capiQueries';
import { insertHoldTarget, getHoldById } from '@/services/database/junkGateQueries';

export interface HeldPayload {
  event: AtlasEvent;
  identifiers: HashedIdentifier[];
}

const sha256 = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');

/** Removes every raw contact field; exported for the PII-never-stored test. */
export function sanitiseForHold(event: AtlasEvent): AtlasEvent {
  const { email, phone, first_name, last_name, city, state, zip, external_id, ...rest } = event.user_data;
  const stable = external_id ?? email;
  return {
    ...event,
    user_data: { ...rest, ...(stable ? { external_id: sha256(stable.trim().toLowerCase()) } : {}) },
  };
}

export function buildHeldPayload(event: AtlasEvent, providerConfig: CAPIProviderConfig): HeldPayload {
  const prepared = prepareForDelivery(event, providerConfig);
  return { event: sanitiseForHold(prepared.event), identifiers: prepared.identifiers };
}

/**
 * `held`: the copy is stored. `send` / `drop`: a reviewer (or the timeout) had already decided the
 * hold by the time this provider's call arrived, so there is nothing to wait for — follow that
 * decision instead of orphaning a copy under a closed hold.
 */
export type HoldTargetOutcome = 'held' | 'send' | 'drop';

export async function holdEventTarget(
  recordId: string,
  event: AtlasEvent,
  providerConfig: CAPIProviderConfig,
): Promise<HoldTargetOutcome> {
  const hold = await getHoldById(recordId);
  if (!hold) throw new Error('hold record not found');
  if (hold.status === 'released' || hold.status === 'auto_released') return 'send';
  if (hold.status === 'rejected' || hold.status === 'auto_dropped') return 'drop';
  if (hold.status !== 'held') throw new Error(`hold is ${hold.status}`);

  const payload = buildHeldPayload(event, providerConfig);
  const mapped = providerConfig.event_mapping.find((m) => m.atlas_event === event.event_name)?.provider_event ?? event.event_name;

  const capiEvent = await createCAPIEvent({
    provider_config_id: providerConfig.id,
    organization_id: providerConfig.organization_id,
    atlas_event_id: event.event_id,
    provider_event_name: mapped,
    status: 'junk_held',
    consent_state: event.consent_state as Record<string, string>,
    identifiers_sent: 0,
  });

  await insertHoldTarget({
    hold_id: recordId,
    organization_id: providerConfig.organization_id,
    provider_config_id: providerConfig.id,
    provider: providerConfig.provider,
    capi_event_id: capiEvent?.id ?? null,
    payload_encrypted: encryptJson(payload),
  });
  return 'held';
}
