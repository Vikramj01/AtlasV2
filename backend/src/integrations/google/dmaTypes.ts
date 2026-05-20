// Google Data Manager API v1 — type definitions
// Reference: https://developers.google.com/ads-data-manager/reference/rest

export type DMAEventSource = 'WEB' | 'APP' | 'IN_STORE' | 'PHONE' | 'OTHER';
export type DMAConsentValue = 'GRANTED' | 'DENIED' | 'UNSPECIFIED';
export type DMADestinationType = 'GOOGLE_ADS' | 'GA4' | 'DV360' | 'CM360';
export type DMAOperationType = 'CREATE' | 'REMOVE';

export interface DMAAddressInfo {
  hashedFirstName?: string;
  hashedLastName?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
}

export interface DMAUserIdentifier {
  hashedEmail?: string;
  hashedPhoneNumber?: string;
  addressInfo?: DMAAddressInfo;
  userId?: string;
}

export interface DMAConsent {
  adUserData: DMAConsentValue;
  adPersonalization: DMAConsentValue;
}

export interface DMAGclidDateTimePair {
  gclid: string;
  conversionDateTime: string; // ISO 8601
}

export interface DMAEvent {
  eventType: string;                        // 'CONVERSION' | 'CLICK' | custom
  eventDateTime: string;                    // ISO 8601
  eventSource: DMAEventSource;
  userIdentifiers: DMAUserIdentifier[];
  transactionId?: string;                   // required for offline-supplementary flows
  conversionAction?: string;                // resource name: customers/{id}/conversionActions/{id}
  currencyCode?: string;                    // ISO 4217
  conversionValue?: number;
  gclidDateTimePair?: DMAGclidDateTimePair; // for GCLID-matched offline conversions
  consent?: DMAConsent;
}

export interface DMADestination {
  type: DMADestinationType;
  customerId?: string;           // Google Ads customer ID (digits only, no dashes)
  propertyId?: string;           // GA4 measurement ID or numeric property ID
  advertiserId?: string;         // DV360 / CM360 advertiser ID
  floodlightActivityId?: string; // CM360 floodlight activity ID
}

// events:ingest

export interface DMAIngestEventsRequest {
  events: DMAEvent[];
  destinations: DMADestination[];
  validateOnly?: boolean;
}

export interface DMAEventResult {
  eventIndex: number;
  error?: DMAApiError;
}

export interface DMAIngestEventsResponse {
  eventResults?: DMAEventResult[];
  partialFailureError?: DMAApiError;
  validatedEventCount?: number; // present when validateOnly=true
}

// audiencemembers:ingest (Customer Match)

export interface DMAUserIdData {
  hashedEmail?: string;
  hashedPhoneNumber?: string;
  mobileDeviceId?: string;
  userId?: string;
  addressInfo?: DMAAddressInfo;
}

export interface DMAIngestAudienceMembersRequest {
  audienceMembers: DMAUserIdData[];
  destinations: DMADestination[];
  operationType: DMAOperationType;
}

export interface DMAMemberResult {
  memberIndex: number;
  error?: DMAApiError;
}

export interface DMAIngestAudienceMembersResponse {
  memberResults?: DMAMemberResult[];
  partialFailureError?: DMAApiError;
}

// Shared error shape returned by DMA in non-2xx bodies
export interface DMAApiError {
  code: number;
  message: string;
  status: string;
  details?: unknown[];
}
