/**
 * Identity resolution — docs/prd/crm-outcome-integration.md §6.3.
 *
 * A pure, synchronous function: given a CRM record's raw properties and the
 * client's identity_property_map, decide which identity signal a
 * crm_outcome_events row should be classified under. Mirrors this
 * codebase's "resolve outside, read inside" convention (Key Technical
 * Decision §16) — the one lookup this needs that isn't a pure function of
 * the record itself (does an atlas_event_id join a real capi_events row?)
 * is resolved by the caller (crmSyncOrchestrator.ts, Sprint 4) and passed
 * in as `originalEvent`, not queried here.
 *
 * Resolution order (§6.3):
 *   1. Click ID — the strongest match.
 *   2. atlas_event_id — if it joins a real capi_events row, prefer that
 *      row's own already-resolved identity over re-deriving from current
 *      CRM properties (the cleanest dedup path).
 *   3. Hashed email.
 *   4. Hashed phone.
 *   5. unresolved — never fabricate an identifier.
 *
 * Note the crm_outcome_events.identity_method CHECK constraint only has
 * four values ('click_id'|'hashed_email'|'hashed_phone'|'unresolved') — an
 * atlas_event_id join isn't a fifth method, it's a way to inherit a
 * *stronger or already-known* verdict (and, per §8, the original event's
 * consent_state) rather than re-deriving one from possibly-stale CRM data.
 */

import type { CrmProviderName } from './sources/types';

export type IdentityMethod = 'click_id' | 'hashed_email' | 'hashed_phone' | 'unresolved';

// Logical identity keys this resolver understands, independent of which
// literal CRM property name a client has mapped them to.
export type IdentityKey =
  | 'gclid' | 'gbraid' | 'wbraid'
  | 'fbclid' | 'ttclid' | 'li_fat_id' | 'msclkid' | 'oppref'
  | 'event_id' | 'email' | 'phone';

const CLICK_ID_KEYS: IdentityKey[] = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'li_fat_id', 'msclkid', 'oppref'];

// Default Atlas-namespaced CRM property names — §6.2's readiness-check
// table. A client's crm_sync_configs.identity_property_map overrides
// individual entries; anything not overridden falls back to this default.
export const DEFAULT_IDENTITY_PROPERTY_MAP: Record<IdentityKey, string> = {
  gclid: 'atlas_gclid',
  gbraid: 'atlas_gbraid',
  wbraid: 'atlas_wbraid',
  fbclid: 'atlas_fbclid',
  ttclid: 'atlas_ttclid',
  li_fat_id: 'atlas_li_fat_id',
  msclkid: 'atlas_msclkid',
  oppref: 'atlas_oppref',
  event_id: 'atlas_event_id',
  email: 'email',   // the object's own standard email property, not Atlas-namespaced
  phone: 'phone',   // ditto
};

// Salesforce (Sprint 10) — its field-naming conventions differ structurally
// from HubSpot's: standard fields are PascalCase (Email, Phone), and a
// CUSTOM field's API name MUST end in __c (a Salesforce platform
// requirement, not a style choice) — an Atlas-namespaced custom field
// created on a Salesforce org is therefore atlas_gclid__c, never
// atlas_gclid. Still only a DEFAULT — crm_sync_configs.identity_property_map
// always overrides individual entries, exactly as it already must for a
// HubSpot portal whose deal-stage setup doesn't match the HubSpot default
// map either (e.g. a deal with no direct email/phone property at all).
export const SALESFORCE_DEFAULT_IDENTITY_PROPERTY_MAP: Record<IdentityKey, string> = {
  gclid: 'atlas_gclid__c',
  gbraid: 'atlas_gbraid__c',
  wbraid: 'atlas_wbraid__c',
  fbclid: 'atlas_fbclid__c',
  ttclid: 'atlas_ttclid__c',
  li_fat_id: 'atlas_li_fat_id__c',
  msclkid: 'atlas_msclkid__c',
  oppref: 'atlas_oppref__c',
  event_id: 'atlas_event_id__c',
  email: 'Email',
  phone: 'Phone',
};

export function resolveIdentityPropertyMap(
  configMap: Record<string, string> | null | undefined,
  provider: CrmProviderName = 'hubspot',
): Record<IdentityKey, string> {
  const base = provider === 'salesforce' ? SALESFORCE_DEFAULT_IDENTITY_PROPERTY_MAP : DEFAULT_IDENTITY_PROPERTY_MAP;
  return { ...base, ...(configMap ?? {}) };
}

export interface ResolvedIdentity {
  method: IdentityMethod;
  /** Logical identity keys with a non-empty value on this record — names only, never the values (§5.4's PII rule). */
  keys_present: IdentityKey[];
  /** Raw (unhashed) values for keys_present, keyed by logical name. Never persisted — consumed in-process by outcomeDelivery.ts (Sprint 5) and discarded. */
  values: Partial<Record<IdentityKey, string>>;
}

// A caller-resolved original lead event, found by joining atlas_event_id to
// capi_events (Sprint 4/5's job — never done inside this pure function).
export interface OriginalEventIdentity {
  method: IdentityMethod;
  keys_present: IdentityKey[];
}

// Exported for readinessCheck.ts's sample-data check — same "does this
// property actually hold a value" test, not duplicated there.
export function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveIdentity(
  properties: Record<string, string | null | undefined>,
  identityPropertyMap: Record<string, string> | null | undefined,
  originalEvent?: OriginalEventIdentity | null,
  provider: CrmProviderName = 'hubspot',
): ResolvedIdentity {
  const propertyMap = resolveIdentityPropertyMap(identityPropertyMap, provider);

  const keysPresent: IdentityKey[] = [];
  const values: Partial<Record<IdentityKey, string>> = {};
  for (const key of Object.keys(propertyMap) as IdentityKey[]) {
    const sourcePropertyName = propertyMap[key];
    const value = properties[sourcePropertyName];
    if (isPresent(value)) {
      keysPresent.push(key);
      values[key] = value;
    }
  }

  const presentClickIds = CLICK_ID_KEYS.filter((k) => keysPresent.includes(k));
  if (presentClickIds.length > 0) {
    return { method: 'click_id', keys_present: keysPresent, values };
  }

  // atlas_event_id joins a real capi_events row — prefer its own
  // already-resolved method (it was captured live, closer to the source of
  // truth than a CRM property re-derivation) over falling through to
  // hashed email/phone below.
  if (keysPresent.includes('event_id') && originalEvent) {
    return {
      method: originalEvent.method,
      keys_present: Array.from(new Set([...keysPresent, ...originalEvent.keys_present])),
      values,
    };
  }

  if (keysPresent.includes('email')) {
    return { method: 'hashed_email', keys_present: keysPresent, values };
  }

  if (keysPresent.includes('phone')) {
    return { method: 'hashed_phone', keys_present: keysPresent, values };
  }

  return { method: 'unresolved', keys_present: keysPresent, values };
}

// Which logical click-id keys a destination platform can use — never send
// a gclid to Meta (§6.3, point 1).
export const CLICK_ID_KEYS_BY_DESTINATION: Record<string, IdentityKey[]> = {
  google_ads: ['gclid', 'gbraid', 'wbraid'],
  meta: ['fbclid'],
  tiktok: ['ttclid'],
  linkedin: ['li_fat_id'],
  microsoft: ['msclkid'],
  openai: ['oppref'],
};
