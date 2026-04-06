// ============================================================
// Atlas Phase 1: Conversion API Module — TypeScript Types
// File: frontend/src/types/capi.ts
// ============================================================

import type { ConsentDecisions } from './consent';

// --- Enums & Literals ---

export type CAPIProvider = 'meta' | 'google' | 'tiktok' | 'linkedin' | 'snapchat';
export type CAPIProviderStatus = 'draft' | 'testing' | 'active' | 'paused' | 'error';

export type CAPIEventStatus =
  | 'received'
  | 'consent_valid'
  | 'consent_blocked'
  | 'validated'
  | 'prepared'
  | 'delivered'
  | 'delivery_failed'
  | 'dead_letter';

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type IdentifierType =
  | 'email'
  | 'phone'
  | 'fn'      // first name
  | 'ln'      // last name
  | 'ct'      // city
  | 'st'      // state
  | 'zp'      // zip/postal code
  | 'country'
  | 'external_id'
  | 'fbc'     // Meta click cookie
  | 'fbp'     // Meta browser cookie
  | 'gclid'   // Google click ID
  | 'wbraid'  // Google iOS web-to-app
  | 'gbraid'; // Google iOS app-to-web

export type ActionSource = 'website' | 'physical_store' | 'system_generated';

// --- Hashed Identifier ---

export interface HashedIdentifier {
  type: IdentifierType;
  value: string; // SHA-256 hex string (for PII) or raw value (for click IDs)
  is_hashed: boolean;
}

// --- Provider Credentials (stored encrypted in DB) ---

export interface MetaCredentials {
  pixel_id: string;
  access_token: string;
  dataset_id: string;
}

export interface GoogleCredentials {
  customer_id: string;
  oauth_access_token: string;
  oauth_refresh_token: string;
  conversion_action_id: string;
  login_customer_id?: string; // MCC ID if using manager account
}

export interface TikTokCredentials {
  pixel_id: string;
  access_token: string;
}

export interface LinkedInCredentials {
  account_id: string;
  access_token: string;
  conversion_id: string;
}

export type ProviderCredentials =
  | MetaCredentials
  | GoogleCredentials
  | TikTokCredentials
  | LinkedInCredentials;

// --- Event Mapping ---

export interface EventMapping {
  atlas_event: string;         // Event name from Atlas Journey Builder
  provider_event: string;      // Provider's standard event name
  custom_params?: Record<string, string>; // Additional parameter mappings
}

// --- Identifier Configuration ---

export interface IdentifierConfig {
  enabled_identifiers: IdentifierType[];
  source_mapping: Partial<Record<IdentifierType, string>>; // Maps identifier type to data layer field path
}

// --- Deduplication Configuration ---

export interface DedupConfig {
  enabled: boolean;
  event_id_field: string;         // Data layer field containing the unique event ID
  dedup_window_minutes: number;   // Window for dedup matching (Meta default: 2880 = 48hrs)
}

// --- CAPI Provider Config (Database Record) ---

export interface CAPIProviderConfig {
  id: string;
  project_id: string;
  organization_id: string;
  provider: CAPIProvider;
  status: CAPIProviderStatus;
  credentials: ProviderCredentials; // Encrypted at rest
  event_mapping: EventMapping[];
  identifier_config: IdentifierConfig;
  dedup_config: DedupConfig;
  test_event_code: string | null;
  error_message: string | null;
  last_health_check: string | null;
  events_sent_total: number;
  events_failed_total: number;
  created_at: string;
  updated_at: string;
}

// --- CAPI Event (Database Record) ---

export interface CAPIEvent {
  id: string;
  provider_config_id: string;
  organization_id: string;
  atlas_event_id: string;
  provider_event_name: string;
  status: CAPIEventStatus;
  consent_state: ConsentDecisions;
  identifiers_sent: number;
  event_value: number | null;
  event_currency: string | null;
  provider_response: unknown | null;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  processed_at: string;
  delivered_at: string | null;
}

// --- Atlas Event (from WalkerOS pipeline) ---

export interface AtlasEvent {
  event_id: string;
  event_name: string;
  event_time: number;            // Unix timestamp
  event_source_url: string;
  action_source: ActionSource;
  user_data: {
    email?: string;              // Unhashed (will be hashed before sending)
    phone?: string;
    first_name?: string;
    last_name?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    external_id?: string;
    fbc?: string;                // Meta click cookie (_fbc)
    fbp?: string;                // Meta browser cookie (_fbp)
    gclid?: string;              // Google Click ID
    wbraid?: string;
    gbraid?: string;
    client_user_agent?: string;
    client_ip_address?: string;
  };
  custom_data?: {
    value?: number;
    currency?: string;
    content_type?: string;
    content_ids?: string[];
    order_id?: string;
    num_items?: number;
    [key: string]: unknown;
  };
  consent_state: ConsentDecisions;
}

// --- Provider Adapter Interface ---
// Every CAPI provider MUST implement this interface.
// This is the extensibility contract.

export interface ProviderPayload {
  provider: CAPIProvider;
  raw: unknown; // Provider-specific formatted payload
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface DeliveryResult {
  event_id: string;
  status: 'delivered' | 'failed';
  provider_response: unknown;
  error_code?: string;
  error_message?: string;
}

export interface TestResult {
  status: 'success' | 'failed';
  provider_response: unknown;
  emq_estimate?: number; // Meta only: estimated Event Match Quality (0-10)
  error?: string;
}

export interface EMQReport {
  overall_score: number;
  by_event: Array<{
    event_name: string;
    score: number;
    sample_size: number;
  }>;
  recommendations: string[];
}

export interface CAPIProviderAdapter {
  /** The provider this adapter handles */
  provider: CAPIProvider;

  /** Validate that the provided credentials are valid and can connect */
  validateCredentials(creds: ProviderCredentials): Promise<ValidationResult>;

  /** Format an Atlas event into the provider's expected payload format */
  formatEvent(
    event: AtlasEvent,
    mapping: EventMapping,
    identifiers: HashedIdentifier[]
  ): ProviderPayload;

  /** Send a batch of formatted events to the provider's API */
  sendEvents(
    payloads: ProviderPayload[],
    creds: ProviderCredentials
  ): Promise<DeliveryResult[]>;

  /** Send a single test event (uses provider's test mode if available) */
  sendTestEvent(
    payload: ProviderPayload,
    creds: ProviderCredentials,
    testCode?: string
  ): Promise<TestResult>;

  /** Get Event Match Quality report (optional — Meta-specific) */
  getEventMatchQuality?(creds: ProviderCredentials): Promise<EMQReport>;
}

// --- API Request/Response Types ---

export interface CreateProviderRequest {
  project_id: string;
  provider: CAPIProvider;
  credentials: ProviderCredentials;
  event_mapping: EventMapping[];
  identifier_config: IdentifierConfig;
  dedup_config: DedupConfig;
}

export interface CreateProviderResponse {
  id: string;
  status: CAPIProviderStatus;
  provider: CAPIProvider;
  created_at: string;
}

export interface TestProviderRequest {
  test_events: AtlasEvent[];
}

export interface TestProviderResponse {
  results: Array<{
    event_name: string;
    status: 'success' | 'failed';
    provider_response: unknown;
    emq_estimate?: number;
  }>;
}

export interface ActivateProviderResponse {
  id: string;
  status: 'active';
  activated_at: string;
}

export interface ProviderDashboardResponse {
  total_events: number;
  delivered: number;
  failed: number;
  blocked_by_consent: number;
  avg_emq: number | null; // Meta only
  delivery_rate: number;
  avg_latency_ms: number;
  by_event: Array<{
    event_name: string;
    count: number;
    success_rate: number;
  }>;
  by_day: Array<{
    date: string;
    delivered: number;
    failed: number;
  }>;
  errors?: Array<{
    event_name: string;
    error_code: string;
    error_message: string | null;
    count: number;
    last_seen: string;
  }>;
}

// --- Error Types ---

export type CAPIErrorCode =
  | 'INVALID_PROVIDER'
  | 'INVALID_CREDENTIALS'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_NOT_ACTIVE'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMITED'
  | 'DELIVERY_FAILED'
  | 'CONSENT_BLOCKED'
  | 'DEDUP_CONFLICT'
  | 'QUEUE_FULL'
  | 'VALIDATION_FAILED';

export interface CAPIError {
  error: CAPIErrorCode;
  message: string;
  provider?: CAPIProvider;
  details?: Record<string, unknown>;
}

// --- Meta-Specific Types ---

export interface MetaEventPayload {
  data: Array<{
    event_name: string;
    event_time: number;
    event_id: string;
    event_source_url: string;
    action_source: ActionSource;
    user_data: {
      em?: string[];     // SHA-256 hashed emails
      ph?: string[];     // SHA-256 hashed phones
      fn?: string[];     // SHA-256 hashed first names
      ln?: string[];     // SHA-256 hashed last names
      ct?: string[];     // SHA-256 hashed cities
      st?: string[];     // SHA-256 hashed states
      zp?: string[];     // SHA-256 hashed zip codes
      country?: string[];// SHA-256 hashed country codes
      external_id?: string[];
      fbc?: string;
      fbp?: string;
      client_user_agent?: string;
      client_ip_address?: string;
    };
    custom_data?: {
      value?: number;
      currency?: string;
      content_type?: string;
      content_ids?: string[];
      order_id?: string;
      num_items?: number;
    };
  }>;
  test_event_code?: string;
  access_token: string;
}

// --- Google-Specific Types ---

export interface GoogleConversionAdjustment {
  adjustmentType: 'ENHANCEMENT';
  conversionAction: string; // Resource name: customers/{id}/conversionActions/{id}
  orderId?: string;
  gclidDateTimePair?: {
    gclid: string;
    conversionDateTime: string; // yyyy-mm-dd HH:mm:ss+|-HH:mm
  };
  userAgent?: string;
  userIdentifiers: Array<
    | { hashedEmail: string }
    | { hashedPhoneNumber: string }
    | {
        addressInfo: {
          hashedFirstName?: string;
          hashedLastName?: string;
          city?: string;
          state?: string;
          postalCode?: string;
          countryCode?: string;
        };
      }
  >;
}

export interface GoogleUploadRequest {
  conversionAdjustments: GoogleConversionAdjustment[];
  partialFailure: boolean;
}
