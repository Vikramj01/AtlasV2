// ============================================================
// Atlas Signal Enrichment Configuration — TypeScript Types
// ============================================================

import type { IdentifierType } from './capi';

// ─── Client-Level Identity Configuration ─────────────────────────────────────

/**
 * Maps each identity field to the dataLayer path where Atlas reads it.
 * 'auto' = read from HTTP request context (IP, UA only).
 * null   = field not configured / not sent.
 */
export interface IdentityFieldMapping {
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  postal_code?: string | null;
  country?: string | null;
  external_id?: string | null;
  fbc?: string;
  fbp?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  client_ip_address?: 'auto' | null;
  client_user_agent?: 'auto' | null;
}

export interface ClientIdentityConfig {
  id: string;
  client_id: string;
  email_field: string | null;
  phone_field: string | null;
  first_name_field: string | null;
  last_name_field: string | null;
  postal_code_field: string | null;
  country_field: string | null;
  external_id_field: string | null;
  fbc_field: string;
  fbp_field: string;
  gclid_field: string;
  wbraid_field: string;
  gbraid_field: string;
  auto_capture_ip: boolean;
  auto_capture_ua: boolean;
  enabled_identifiers: IdentifierType[];
  validated_at: string | null;
  identity_score: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Signal-Level Enrichment Configuration ───────────────────────────────────

export type CurrencyMode = 'static' | 'dynamic';
export type ContentIdsPathType = 'array' | 'string' | 'nested';

export interface ValueConfig {
  field: string;
  includes_tax: boolean;
  includes_shipping: boolean;
}

export interface CurrencyConfig {
  mode: CurrencyMode;
  field?: string;
  static_value?: string;
}

export interface SignalDedupConfig {
  field: string;
}

export interface ContentConfig {
  ids_field?: string;
  ids_path_type: ContentIdsPathType;
  num_items_field?: string;
}

export interface SignalEnrichmentConfig {
  id: string;
  deployment_id: string;
  signal_key: string;
  value_config: ValueConfig | null;
  currency_config: CurrencyConfig | null;
  dedup_config: SignalDedupConfig | null;
  content_config: ContentConfig | null;
  enabled_for_meta: boolean;
  enabled_for_google: boolean;
  validated_at: string | null;
  validation_score: number | null;
  validation_warnings: EnrichmentWarning[];
  created_at: string;
  updated_at: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface EnrichmentWarning {
  field: string;
  message: string;
  severity: WarningSeverity;
}

export interface EnrichmentValidationResult {
  score: number;
  warnings: EnrichmentWarning[];
  required_missing: string[];
  recommended_missing: string[];
}

// ─── Enrichment Score (client dashboard) ─────────────────────────────────────

export interface ClientEnrichmentScore {
  overall: number;
  identity_score: number;
  signal_scores: Array<{
    signal_key: string;
    signal_name: string;
    score: number;
    warnings: EnrichmentWarning[];
  }>;
  estimated_meta_emq: number;
  estimated_google_match_rate: number;
}

// ─── API Request / Response Types ────────────────────────────────────────────

export interface SaveIdentityConfigRequest {
  client_id: string;
  email_field?: string | null;
  phone_field?: string | null;
  first_name_field?: string | null;
  last_name_field?: string | null;
  postal_code_field?: string | null;
  country_field?: string | null;
  external_id_field?: string | null;
  fbc_field?: string;
  fbp_field?: string;
  gclid_field?: string;
  wbraid_field?: string;
  gbraid_field?: string;
  auto_capture_ip?: boolean;
  auto_capture_ua?: boolean;
  enabled_identifiers?: IdentifierType[];
}

export interface SaveSignalEnrichmentRequest {
  deployment_id: string;
  signal_key: string;
  value_config: ValueConfig | null;
  currency_config: CurrencyConfig | null;
  dedup_config: SignalDedupConfig | null;
  content_config: ContentConfig | null;
  enabled_for_meta: boolean;
  enabled_for_google: boolean;
}

export interface ValidateFieldPathRequest {
  field_path: string;
  sample_event?: Record<string, unknown>;
}

export interface ValidateFieldPathResponse {
  valid: boolean;
  resolved_value?: unknown;
  error?: string;
}
