// Shared builders for the Google Data Manager API's `Event` and
// `AudienceMember` resources — verified against the live Discovery
// Document (see dmaTypes.ts's header comment). Centralizing this here
// replaces three independent, independently-drifted copies of the same
// mapping logic that used to live in googleDelivery.ts,
// googleOfflineUpload.ts, and customerMatch.ts.

import type { AtlasEvent, HashedIdentifier } from '@/types/capi';
import type { ConsentDecisions } from '@/types/consent';
import type {
  DMAEvent,
  DMAEventSource,
  DMAUserIdentifier,
  DMAAddressInfo,
  DMAConsent,
  DMAConsentStatus,
  DMACustomerType,
  DMAAudienceMember,
} from './dmaTypes';

// ── Address / identifier mapping ───────────────────────────────────────────

export interface AddressFields {
  givenName?: string;
  familyName?: string;
  city?: string;
  administrativeArea?: string;
  postalCode?: string;
  regionCode?: string;
  addressLine?: string;
}

export function buildAddressInfo(fields: AddressFields): DMAAddressInfo | undefined {
  const hasAny = Object.values(fields).some((v) => v !== undefined && v !== '');
  if (!hasAny) return undefined;
  return { ...fields };
}

/**
 * Maps Atlas's HashedIdentifier[] (email/phone/fn/ln/ct/st/zp/country —
 * the PII identifier types) into the DMA UserIdentifier[] shape. Click
 * IDs (gclid/wbraid/gbraid/fbc/fbp) are NOT part of this — they go under
 * Event.adIdentifiers, read directly off AtlasEvent.user_data (see
 * buildDMAEvent below), matching how gclid was already handled before
 * this fix.
 */
export function buildUserIdentifiersFromHashed(identifiers: HashedIdentifier[]): DMAUserIdentifier[] {
  const result: DMAUserIdentifier[] = [];
  const address: AddressFields = {};
  let hasAddressField = false;

  for (const id of identifiers) {
    switch (id.type) {
      case 'email':
        result.push({ emailAddress: id.value });
        break;
      case 'phone':
        result.push({ phoneNumber: id.value });
        break;
      case 'fn':
        address.givenName = id.value;
        hasAddressField = true;
        break;
      case 'ln':
        address.familyName = id.value;
        hasAddressField = true;
        break;
      case 'ct':
        address.city = id.value;
        hasAddressField = true;
        break;
      case 'st':
        address.administrativeArea = id.value;
        hasAddressField = true;
        break;
      case 'zp':
        address.postalCode = id.value;
        hasAddressField = true;
        break;
      case 'country':
        address.regionCode = id.value;
        hasAddressField = true;
        break;
      // external_id/fbc/fbp/gclid/wbraid/gbraid: not part of DMA's
      // UserIdentifier — fbc/fbp go to Meta only, gclid/wbraid/gbraid go
      // to Event.adIdentifiers (see buildDMAEvent).
    }
  }

  if (hasAddressField) {
    const addressInfo = buildAddressInfo(address);
    if (addressInfo) result.push({ address: addressInfo });
  }

  return result;
}

function mapConsentStatus(v: string | undefined): DMAConsentStatus {
  if (v === 'granted') return 'CONSENT_GRANTED';
  if (v === 'denied') return 'CONSENT_DENIED';
  return 'CONSENT_STATUS_UNSPECIFIED';
}

export function mapConsentToDMA(consentState: ConsentDecisions | undefined): DMAConsent | undefined {
  if (!consentState) return undefined;
  return {
    adUserData: mapConsentStatus(consentState.marketing),
    adPersonalization: mapConsentStatus(consentState.personalisation),
  };
}

function actionSourceToDMAEventSource(actionSource: string | undefined): DMAEventSource {
  switch (actionSource) {
    case 'physical_store': return 'IN_STORE';
    case 'phone_call':     return 'PHONE';
    case 'app':            return 'APP';
    case 'system_generated':
    case 'chat':           return 'OTHER';
    default:               return 'WEB';
  }
}

function customerTypeFromCustomData(customData: AtlasEvent['custom_data']): DMACustomerType | undefined {
  const value = customData?.['new_customer'];
  if (value === true) return 'NEW';
  if (value === false) return 'RETURNING';
  return undefined;
}

// ── Event builder ───────────────────────────────────────────────────────────

export interface BuildDMAEventOptions {
  transactionId?: string; // overrides event.custom_data?.order_id when set (dedup-resolved order id)
}

export function buildDMAEvent(
  event: AtlasEvent,
  identifiers: HashedIdentifier[],
  options?: BuildDMAEventOptions,
): DMAEvent {
  const eventTimestamp = new Date(event.event_time * 1000).toISOString();
  const userIdentifiers = buildUserIdentifiersFromHashed(identifiers);

  const adIdentifiers: DMAEvent['adIdentifiers'] = {};
  if (event.user_data.gclid) adIdentifiers.gclid = event.user_data.gclid;
  if (event.user_data.wbraid) adIdentifiers.wbraid = event.user_data.wbraid;
  if (event.user_data.gbraid) adIdentifiers.gbraid = event.user_data.gbraid;
  const hasAdIdentifiers = Object.keys(adIdentifiers).length > 0;

  const customerType = customerTypeFromCustomData(event.custom_data);

  const dmaEvent: DMAEvent = {
    eventTimestamp,
    eventName: event.event_name,
    eventSource: actionSourceToDMAEventSource(event.action_source),
    transactionId: options?.transactionId ?? event.custom_data?.order_id,
    currency: event.custom_data?.currency,
    conversionValue: event.custom_data?.value,
  };

  if (userIdentifiers.length > 0) dmaEvent.userData = { userIdentifiers };
  if (hasAdIdentifiers) dmaEvent.adIdentifiers = adIdentifiers;
  if (customerType) dmaEvent.userProperties = { customerType };

  const consent = mapConsentToDMA(event.consent_state);
  if (consent) dmaEvent.consent = consent;

  return dmaEvent;
}

// ── Audience member builder ─────────────────────────────────────────────────

export interface AudienceMemberContact {
  hashedEmail?: string;
  hashedPhone?: string;
  address?: AddressFields;
}

export function buildAudienceMember(contact: AudienceMemberContact): DMAAudienceMember {
  const identifiers: DMAUserIdentifier[] = [];
  if (contact.hashedEmail) identifiers.push({ emailAddress: contact.hashedEmail });
  if (contact.hashedPhone) identifiers.push({ phoneNumber: contact.hashedPhone });
  if (contact.address) {
    const addressInfo = buildAddressInfo(contact.address);
    if (addressInfo) identifiers.push({ address: addressInfo });
  }
  return { userData: { userIdentifiers: identifiers } };
}
