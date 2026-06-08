// ============================================================
// Atlas Signal Enrichment Configuration — Backend Types
// ============================================================

import type { ActionSource, IdentifierType } from './capi';

export type CurrencyMode = 'static' | 'dynamic';
export type ContentIdsPathType = 'array' | 'string' | 'nested';
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
  event_source: ActionSource;
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
  event_source?: ActionSource;
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
