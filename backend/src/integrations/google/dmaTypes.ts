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
//
// Re-verified 2026-09-15 (revision 20260904) against a fresh fetch of the
// same live Discovery Document, per the IAB ECAPI/DMA field-parity
// verification pass (note: Google's own "ECAPI mapping" is a translation
// FROM IAB Tech Lab's ECAPI 1.0 spec — snake_case fields like `timestamp`,
// `event_type`, `user_data.customer_identifier` — TO this file's native
// camelCase DMA schema; DMA never adopted ECAPI's own field names
// verbatim, unlike this file's header previously implied). Found and
// closed two real gaps against Atlas's own AtlasEvent data (both already
// captured elsewhere in the pipeline but never reaching DMA):
//   - DMAEvent.userId (ECAPI's ~customer_identifier concept) — Atlas
//     carries this as AtlasEvent.user_data.external_id but
//     dmaEventBuilder.ts never mapped it through. Now does.
//   - DMAEvent.eventDeviceInfo (new type below, mirroring the live
//     DeviceInfo schema) — Atlas carries client_user_agent/client_ip_address
//     (already sent to Meta) but had no DMA equivalent field declared at
//     all. Now does, via eventDeviceInfo.userAgent/ipAddress.
// DMAItem gained itemId/additionalItemParameters (present on the live
// Item schema, missing here) for completeness — not wired into
// dmaEventBuilder.ts because Atlas doesn't build cartData.items at all yet
// (AtlasEvent.custom_data only carries aggregate content_ids/num_items, not
// a real per-item array with quantity/unit price) — flagged as a follow-up,
// not a same-pass fix, since it needs an AtlasEvent shape change, not just
// a new field mapping.

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

export interface DMAItemParameter {
  parameterName?: string;
  value?: string;
}

export interface DMAItem {
  itemId?: string;
  merchantProductId?: string;
  quantity?: string;      // int64 encoded as string per discovery doc
  unitPrice?: number;
  conversionValue?: number;
  merchantId?: string;
  merchantFeedLabel?: string;
  merchantFeedLanguageCode?: string;
  customVariables?: DMACustomVariable[];
  additionalItemParameters?: DMAItemParameter[];
}

// DeviceInfo — referenced by Event.eventDeviceInfo. Atlas only ever
// populates userAgent/ipAddress today (the fields it already captures for
// Meta via AtlasEvent.user_data.client_user_agent/client_ip_address); the
// rest are declared for completeness, matching this file's existing
// practice of declaring the full API shape even when only part of it is
// used by dmaEventBuilder.ts.
export interface DMAEventDeviceInfo {
  userAgent?: string;
  ipAddress?: string;
  languageCode?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  browser?: string;
  browserVersion?: string;
  model?: string;
  brand?: string;
  category?: string;
  screenWidth?: number;
  screenHeight?: number;
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
  eventDeviceInfo?: DMAEventDeviceInfo;
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

// ── requestStatus:retrieve (Google Stack Alignment sprint plan, Sprint 8) ──
//
// GET v1/requestStatus:retrieve?requestId=<IngestEventsResponse.requestId>
// Verified against the same live Discovery Document (revision 20260904) as
// the rest of this file. This is the only way to learn what actually
// happened to a batch after events:ingest's 2xx, which confirms submission
// only (requestId + fieldWarnings — field-level validation warnings caught
// before processing, not delivery outcome).
//
// Important scope limit found during verification, not assumed: the
// response is aggregated per destination by error/warning REASON with a
// recordCount — there is no per-event or per-row identifier anywhere in
// this schema. For a request that batched N>1 events/rows together (as
// googleOfflineUpload.ts's 2,000-row batches do), a FAILED/PARTIAL_SUCCESS
// destination tells you how many records hit each reason, never which ones.
// Atlas's live CAPI pipeline (pipeline.ts's deliverToProvider) always calls
// sendGoogleEvents with a single-event array, so for that path alone one
// requestId does map to exactly one Atlas event — offline batches remain
// batch-level truth only. Customer Match / Bid Signal Enricher runs
// (enricherService.ts's runAudienceEnricher) are the same shape as offline
// batches here — one requestId per run, batch-level truth, not per-member —
// polled via dmaClient.ts's retrieveRequestStatus().
export type DMARequestStatus = 'REQUEST_STATUS_UNKNOWN' | 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'PARTIAL_SUCCESS';

export interface DMAErrorCount {
  reason: string; // PROCESSING_ERROR_REASON_* enum — kept as string, not a closed union, since the live list is 40+ values and growing
  recordCount?: string; // int64 wire format — Google's client libraries return this as a string
}

export interface DMAWarningCount {
  reason: string; // PROCESSING_WARNING_REASON_* enum, same string-not-union rationale as DMAErrorCount
  recordCount?: string;
}

export interface DMARequestStatusPerDestination {
  destination?: DMADestination;
  requestStatus?: DMARequestStatus;
  eventsIngestionStatus?: { recordCount?: string };
  // Declared for schema completeness now that dmaClient.ts's
  // retrieveRequestStatus() also polls this endpoint for
  // audienceMembers:ingest/:remove requestIds (enricherQueries.ts /
  // worker.ts's enricher_run_id branch) — Atlas's classification logic
  // (googleDeliveryConfirmation.ts's summarizeDeliveryConfirmation) only
  // reads the shared requestStatus/errorInfo fields below, not these two
  // directly, since it has no per-request-type branching to do.
  audienceMembersIngestionStatus?: { recordCount?: string };
  audienceMembersRemovalStatus?: { recordCount?: string };
  errorInfo?: { errorCounts?: DMAErrorCount[] };
  warningInfo?: { warningCounts?: DMAWarningCount[] };
}

export interface DMARetrieveRequestStatusResponse {
  requestStatusPerDestination?: DMARequestStatusPerDestination[];
}
