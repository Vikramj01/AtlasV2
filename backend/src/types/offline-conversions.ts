/**
 * Atlas: Offline Conversion Upload Module — Backend TypeScript Types
 * File: backend/src/types/offline-conversions.ts
 *
 * Mirrors the frontend types but scoped to what the backend needs.
 * These are the shapes used for DB operations, service functions,
 * and API request/response bodies.
 */

// ── Status Literals ──────────────────────────────────────────────────────────

export type OfflineConfigStatus = 'active' | 'paused' | 'error';

export type OfflineUploadStatus =
  | 'pending'
  | 'validating'
  | 'validated'
  | 'confirmed'
  | 'uploading'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type OfflineRowStatus =
  | 'valid'
  | 'invalid'
  | 'duplicate'
  | 'uploaded'
  | 'rejected'
  | 'skipped';

// ── Column Mapping ───────────────────────────────────────────────────────────

export interface ColumnMapping {
  gclid?: string;
  email?: string;
  phone?: string;
  conversion_time?: string;
  conversion_value?: string;
  currency?: string;
  order_id?: string;
  [key: string]: string | undefined;
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface OfflineConversionConfig {
  id: string;
  organization_id: string;
  google_customer_id: string;
  conversion_action_id: string;
  conversion_action_name: string;
  column_mapping: ColumnMapping;
  default_currency: string;
  default_conversion_value: number | null;
  status: OfflineConfigStatus;
  error_message: string | null;
  capi_provider_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertConfigInput {
  organization_id: string;
  google_customer_id: string;
  conversion_action_id: string;
  conversion_action_name: string;
  column_mapping: ColumnMapping;
  default_currency: string;
  default_conversion_value?: number | null;
  capi_provider_id: string;
}

// ── Uploads ──────────────────────────────────────────────────────────────────

export interface OfflineConversionUpload {
  id: string;
  organization_id: string;
  config_id: string;
  filename: string;
  file_size_bytes: number;
  row_count_total: number;
  status: OfflineUploadStatus;
  row_count_valid: number;
  row_count_invalid: number;
  row_count_duplicate: number;
  row_count_uploaded: number;
  row_count_rejected: number;
  validation_summary: ValidationSummary | null;
  upload_result: UploadResult | null;
  error_message: string | null;
  uploaded_by: string;
  created_at: string;
  validated_at: string | null;
  confirmed_at: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface CreateUploadInput {
  organization_id: string;
  config_id: string;
  filename: string;
  file_size_bytes: number;
  uploaded_by: string;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface OfflineConversionRow {
  id: string;
  upload_id: string;
  organization_id: string;
  row_index: number;
  raw_email: string | null;
  raw_phone: string | null;
  raw_gclid: string | null;
  hashed_email: string | null;
  hashed_phone: string | null;
  conversion_time: string | null;
  conversion_value: number | null;
  currency: string | null;
  order_id: string | null;
  status: OfflineRowStatus;
  validation_errors: ValidationIssue[] | null;
  validation_warnings: ValidationIssue[] | null;
  google_error_code: string | null;
  google_error_message: string | null;
  uploaded_at: string | null;
  created_at: string;
}

export interface InsertRowInput {
  upload_id: string;
  organization_id: string;
  row_index: number;
  raw_email?: string | null;
  raw_phone?: string | null;
  raw_gclid?: string | null;
  hashed_email?: string | null;
  hashed_phone?: string | null;
  conversion_time?: string | null;
  conversion_value?: number | null;
  currency?: string | null;
  order_id?: string | null;
  status: OfflineRowStatus;
  validation_errors?: ValidationIssue[] | null;
  validation_warnings?: ValidationIssue[] | null;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationIssue {
  row: number;
  field: string;
  code: string;
  message: string;
}

export interface ValidationSummary {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Google upload result ──────────────────────────────────────────────────────

export interface GoogleRowResult {
  row_index: number;
  status: 'uploaded' | 'rejected';
  error_code: string | null;
  error_message: string | null;
}

export interface UploadResult {
  partial_failure: boolean;
  row_results: GoogleRowResult[];
}

// ── Google conversion actions ─────────────────────────────────────────────────

export interface GoogleConversionAction {
  id: string;
  name: string;
  category: string;
  status: string;
  type: string;
}
