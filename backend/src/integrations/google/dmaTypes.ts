// Google Data Manager API v1 — type definitions
// Reference: https://developers.google.com/ads-data-manager/reference/rest
//
// Verified directly against the live Discovery Document
// (https://datamanager.googleapis.com/$discovery/rest?version=v1,
// revision 20260828) via a raw fetch — NOT from memory or docs-site
// browsing (developers.google.com is network-blocked in this sandbox).
// This replaces an earlier version of this file that had drifted from
// the live API (wrong field names, wrong nesting, and in the audience
// endpoints' case a wrong URL path casing) — see the incident writeup
// for the full list of what was wrong and how each was verified.

export type DMAEventSource = 'EVENT_SOURCE_UNSPECIFIED' | 'WEB' | 'APP' | 'IN_STORE' | 'PHONE' | 'MESSAGE' | 'OTHER';
export type DMAConsentStatus = 'CONSENT_STATUS_UNSPECIFIED' | 'CONSENT_GRANTED' | 'CONSENT_DENIED';
export type DMAAccountType =
  | 'ACCOUNT_TYPE_UNSPECIFIED'
  | 'GOOGLE_ADS'
  | 'DISPLAY_VIDEO_PARTNER'
  | 'DISPLAY_VIDEO_ADVERTISER'
  | 'DATA_PARTNER'
  | 'GOOGLE_ANALYTICS_PROPERTY'
  | 'GOOGLE_AD_MANAGER_AUDIENCE_LINK'
  | 'FLOODLIGHT_CONFIG';
export type DMACustomerType = 'CUSTOMER_TYPE_UNSPECIFIED' | 'NEW' | 'RETURNING' | 'REENGAGED';
export type DMACustomerValueBucket = 'CUSTOMER_VALUE_BUCKET_UNSPECIFIED' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface DMAAddressInfo {
  givenName?: string;   // Required by Google when addressInfo is present: hashed, lowercase, no punctuation
  familyName?: string;  // Same as givenName
  city?: string;
  administrativeArea?: string; // state/province
  postalCode?: string;
  regionCode?: string;  // ISO-3166-1 alpha-2
  addressLine?: string;
}

export interface DMAUserIdentifier {
  emailAddress?: string;  // SHA-256 hash after normalization
  phoneNumber?: string;   // SHA-256 hash after normalization (E.164)
  address?: DMAAddressInfo;
}

export interface DMAUserData {
  userIdentifiers: DMAUserIdentifier[]; // at most 10
}

export interface DMAAdIdentifiers {
  gclid?: string;
  gbraid?: string;  // iOS14+ app click identifier
  wbraid?: string;  // iOS14+ web click identifier
  dclid?: string;   // display click ID
  matchId?: string;
  impressionId?: string;
  mobileDeviceId?: string;
  sessionAttributes?: string;
}

export interface DMAConsent {
  adUserData?: DMAConsentStatus;
  adPersonalization?: DMAConsentStatus;
}

export interface DMAUserProperties {
  customerType?: DMACustomerType;
  customerValueBucket?: DMACustomerValueBucket;
}

export interface DMACustomVariable {
  variable?: string;
  value?: string;
  destinationReferences?: string[];
}

export interface DMAEventParameter {
  parameterName: string;
  value: string;
}

export interface DMAItem {
  merchantProductId?: string;
  quantity?: string;      // int64 encoded as string per discovery doc
  unitPrice?: number;
  conversionValue?: number;
  merchantId?: string;
  merchantFeedLabel?: string;
  merchantFeedLanguageCode?: string;
  customVariables?: DMACustomVariable[];
}

export interface DMACartData {
  items?: DMAItem[];
  couponCodes?: string[];
  merchantId?: string;
  merchantFeedLabel?: string;
  merchantFeedLanguageCode?: string;
  transactionDiscount?: number;
}

export interface DMAEvent {
  eventTimestamp: string;   // Required. google-datetime (RFC3339)
  eventName?: string;       // Required for GA4 events
  eventSource?: DMAEventSource;
  transactionId?: string;
  currency?: string;
  conversionValue?: number;
  conversionCount?: number;
  userData?: DMAUserData;
  adIdentifiers?: DMAAdIdentifiers;
  userProperties?: DMAUserProperties;
  consent?: DMAConsent;
  cartData?: DMACartData;
  customVariables?: DMACustomVariable[];
  additionalEventParameters?: DMAEventParameter[];
  destinationReferences?: string[];
  userId?: string;
  clientId?: string;      // GA4 web stream client ID
  appInstanceId?: string; // GA4 app stream instance ID
}

// ── Destinations ────────────────────────────────────────────────────────────

export interface DMAProductAccount {
  accountId: string;
  accountType: DMAAccountType;
}

export interface DMADestination {
  operatingAccount: DMAProductAccount;   // Required — the account to send data to
  loginAccount?: DMAProductAccount;
  linkedAccount?: DMAProductAccount;
  productDestinationId?: string;         // e.g. a Google Ads conversion action ID
  reference?: string;
}

// ── events:ingest ──────────────────────────────────────────────────────────

export interface DMAIngestEventsRequest {
  events: DMAEvent[];               // at most 2000
  destinations: DMADestination[];
  consent?: DMAConsent;
  validateOnly?: boolean;
}

export interface DMAFieldWarning {
  field: string;
  reason: string;
  description: string;
}

export interface DMAIngestEventsResponse {
  requestId?: string;
  fieldWarnings?: DMAFieldWarning[];
}

// ── audienceMembers:ingest / audienceMembers:remove ───────────────────────

export interface DMAUserIdData {
  userId: string; // Required within UserIdData when present
}

export interface DMAAudienceMember {
  userData?: DMAUserData;
  userIdData?: DMAUserIdData;
  destinationReferences?: string[];
}

export interface DMAIngestAudienceMembersRequest {
  audienceMembers: DMAAudienceMember[]; // at most 10000
  destinations: DMADestination[];
  consent?: DMAConsent;
  validateOnly?: boolean;
}

export interface DMAIngestAudienceMembersResponse {
  requestId?: string;
}

export interface DMARemoveAudienceMembersRequest {
  audienceMembers: DMAAudienceMember[];
  destinations: DMADestination[];
  validateOnly?: boolean;
}

export interface DMARemoveAudienceMembersResponse {
  requestId?: string;
}

// ── Shared error shape returned by DMA in non-2xx bodies ──────────────────

export interface DMAApiError {
  code: number;
  message: string;
  status: string;
  details?: unknown[];
}
