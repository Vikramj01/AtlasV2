// ============================================================
// Atlas Phase 1: Consent Integration Hub — TypeScript Types
// File: frontend/src/types/consent.ts
// ============================================================

// --- Enums & Literals ---

export type ConsentState = 'granted' | 'denied' | 'pending' | 'not_required';
export type ConsentCategory = 'analytics' | 'marketing' | 'personalisation' | 'functional';
export type ConsentMode = 'builtin' | 'onetrust' | 'cookiebot' | 'usercentrics';
export type ConsentRegulation = 'gdpr' | 'ccpa' | 'custom';
export type ConsentSource = ConsentMode | 'api';
export type BannerPosition = 'bottom_bar' | 'modal' | 'corner';

// --- Google Consent Mode v2 ---

export type GCMSignal =
  | 'analytics_storage'
  | 'ad_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'personalization_storage'
  | 'functionality_storage'
  | 'security_storage';

export type GCMState = Partial<Record<GCMSignal, 'granted' | 'denied'>>;
export type GCMMapping = Record<ConsentCategory, GCMSignal[]>;

// --- Category Configuration ---

export interface ConsentCategoryConfig {
  id: ConsentCategory;
  name: string;
  description: string;
  required: boolean;
  default_state: ConsentState;
}

// --- Banner Configuration ---

export interface BannerColors {
  background: string;
  button_primary: string;
  button_secondary: string;
  text: string;
}

export interface BannerCopy {
  heading: string;
  body: string;
  accept_button: string;
  reject_button: string;
  manage_link: string;
}

export interface BannerConfig {
  position: BannerPosition;
  colors: BannerColors;
  copy: BannerCopy;
  logo_url: string | null;
  ttl_days: number;
}

// --- CMP Integration Configuration ---

export interface CMPConfig {
  api_key: string;
  account_id?: string;
  domain?: string;
  category_mapping: Record<string, ConsentCategory>; // CMP category ID → Atlas category
  webhook_url?: string;
}

// --- Consent Config (Database Record) ---

export interface ConsentConfig {
  id: string;
  project_id: string;
  organization_id: string;
  mode: ConsentMode;
  regulation: ConsentRegulation;
  categories: ConsentCategoryConfig[];
  banner_config: BannerConfig | null;
  cmp_config: CMPConfig | null;
  gcm_enabled: boolean;
  gcm_mapping: GCMMapping;
  created_at: string;
  updated_at: string;
}

// --- Consent Decisions ---

export type ConsentDecisions = Record<ConsentCategory, ConsentState>;

// --- Consent Record (Database Record) ---

export interface ConsentRecord {
  id: string;
  project_id: string;
  organization_id: string;
  visitor_id: string;
  consent_id: string;
  decisions: ConsentDecisions;
  gcm_state: GCMState | null;
  regulation: string;
  ip_country: string | null;
  user_agent: string | null;
  source: ConsentSource;
  expires_at: string;
  created_at: string;
}

// --- API Request/Response Types ---

export interface RecordConsentRequest {
  project_id: string;
  visitor_id: string;
  consent_id: string;
  decisions: ConsentDecisions;
  source: ConsentSource;
  user_agent?: string;
  ip?: string;
}

export interface RecordConsentResponse {
  id: string;
  gcm_state: GCMState;
  expires_at: string;
}

export interface GetConsentResponse {
  visitor_id: string;
  decisions: ConsentDecisions;
  gcm_state: GCMState;
  expires_at: string;
  last_updated: string;
}

export interface ConsentAnalyticsParams {
  period: '7d' | '30d' | '90d' | 'all';
  group_by: 'category' | 'country' | 'source' | 'day';
}

export interface ConsentAnalyticsResponse {
  total_decisions: number;
  opt_in_rate: Record<ConsentCategory, number>;
  by_country: Array<{ country: string; opt_in_rate: number; total: number }>;
  by_day: Array<{ date: string; granted: number; denied: number }>;
  consent_coverage: number; // % of events with consent state attached
}

export interface DeleteConsentResponse {
  deleted_count: number;
  visitor_id: string;
}

// --- Consent Error Types ---

export type ConsentErrorCode =
  | 'INVALID_PROJECT'
  | 'MISSING_VISITOR_ID'
  | 'INVALID_DECISIONS'
  | 'NO_CONSENT_RECORD'
  | 'CONFIG_NOT_FOUND'
  | 'CMP_CONNECTION_ERROR';

export interface ConsentError {
  error: ConsentErrorCode;
  message: string;
}
