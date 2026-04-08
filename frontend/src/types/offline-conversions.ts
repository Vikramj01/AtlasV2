// ============================================================
// Atlas: Offline Conversion Upload Module — TypeScript Types
// File: frontend/src/types/offline-conversions.ts
// ============================================================

// ── Status Literals ──────────────────────────────────────────────────────────

export type OfflineConfigStatus = 'active' | 'paused' | 'error';

/** Full lifecycle of a CSV batch upload. */
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

/** Per-row status after validation and upload. */
export type OfflineRowStatus =
  | 'valid'
  | 'invalid'
  | 'duplicate'
  | 'uploaded'
  | 'rejected'
  | 'skipped';

// ── Column Mapping ───────────────────────────────────────────────────────────

/**
 * Maps Atlas field names to CSV column headers provided by the user.
 * All fields are optional — at least `gclid`/`fbclid` or `email` must be present.
 */
export interface ColumnMapping {
  gclid?: string;        // Google Click ID — required for Google provider
  fbclid?: string;       // Facebook Click ID — required for Meta provider
  email?: string;
  phone?: string;
  conversion_time?: string;
  conversion_value?: string;
  currency?: string;
  order_id?: string;
  [key: string]: string | undefined;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Which ad platform this config routes offline conversions to. */
export type OfflineProviderType = 'google' | 'meta';

/** One per organisation. Matches `offline_conversion_configs` table. */
export interface OfflineConversionConfig {
  id: string;
  organization_id: string;

  /** 'google' | 'meta' — drives worker routing. */
  provider_type: OfflineProviderType;

  // ── Google-specific (null for Meta configs) ───────────────────────────
  google_customer_id: string | null;
  conversion_action_id: string | null;
  conversion_action_name: string | null;

  // ── Meta-specific (null for Google configs) ───────────────────────────
  /** Meta Conversions API event name, e.g. 'Purchase', 'Lead'. */
  meta_event_name: string | null;

  column_mapping: ColumnMapping;

  default_currency: string;              // ISO 4217, e.g. 'USD'
  default_conversion_value: number | null;

  status: OfflineConfigStatus;
  error_message: string | null;

  /** FK to capi_providers — reuses existing OAuth / access token credentials. */
  capi_provider_id: string | null;

  created_at: string;
  updated_at: string;
}

/** Input shape for POST /api/offline-conversions/config */
export interface CreateOfflineConfigInput {
  provider_type: OfflineProviderType;
  capi_provider_id: string;
  column_mapping: ColumnMapping;
  default_currency: string;
  default_conversion_value?: number | null;
  // Google-specific
  google_customer_id?: string;
  conversion_action_id?: string;
  conversion_action_name?: string;
  // Meta-specific
  meta_event_name?: string;
}

/** Input shape for PUT /api/offline-conversions/config */
export type UpdateOfflineConfigInput = Partial<CreateOfflineConfigInput>;

// ── Conversion Actions ───────────────────────────────────────────────────────

/** A single Google Ads conversion action fetched from the customer's account. */
export interface GoogleConversionAction {
  id: string;                // Google resource name, e.g. "customers/123/conversionActions/456"
  name: string;
  category: string;          // e.g. "PURCHASE", "SUBMIT_LEAD_FORM"
  status: string;            // "ENABLED" | "REMOVED" | "HIDDEN"
  type: string;              // e.g. "UPLOAD_CLICKS", "UPLOAD_CALLS"
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationIssue {
  row: number;               // 1-based row index (excluding header)
  field: string;             // e.g. "email", "conversion_time"
  code: string;              // machine-readable code, e.g. "INVALID_EMAIL"
  message: string;           // human-readable description
}

export interface ValidationSummary {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Uploads ──────────────────────────────────────────────────────────────────

/** Google API result for a single row in a batch upload. */
export interface GoogleRowResult {
  row_index: number;         // 0-based index within the batch
  status: 'uploaded' | 'rejected';
  error_code: string | null;
  error_message: string | null;
}

export interface UploadResult {
  partial_failure: boolean;
  row_results: GoogleRowResult[];
}

/** Full upload record. Matches `offline_conversion_uploads` table. */
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

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Individual conversion row. Raw PII fields are nulled after upload. */
export interface OfflineConversionRow {
  id: string;
  upload_id: string;
  organization_id: string;
  row_index: number;

  // Raw PII — only present during validation phase, nulled after upload
  raw_email: string | null;
  raw_phone: string | null;
  raw_gclid: string | null;    // Google Click ID
  raw_fbclid: string | null;   // Facebook Click ID (Meta provider)

  // Hashed identifiers (retained permanently)
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

// ── API Request / Response shapes ────────────────────────────────────────────

/** POST /api/offline-conversions/upload — multipart form response */
export interface UploadValidationResponse {
  upload_id: string;
  status: 'validated';
  validation_summary: ValidationSummary;
  /** Sample of invalid rows for UI preview (max 20) */
  error_sample: OfflineConversionRow[];
}

/** POST /api/offline-conversions/upload/:id/confirm */
export interface ConfirmUploadResponse {
  upload_id: string;
  status: 'confirmed' | 'uploading';
  message: string;
}

/** GET /api/offline-conversions/upload/:id */
export interface UploadDetailResponse {
  upload: OfflineConversionUpload;
  /** Paginated rows for the detail view */
  rows: OfflineConversionRow[];
  total_rows: number;
}

/** GET /api/offline-conversions/history */
export interface UploadHistoryResponse {
  uploads: OfflineConversionUpload[];
  total: number;
  page: number;
  page_size: number;
}

// ── Setup Wizard ─────────────────────────────────────────────────────────────

export type SetupWizardStep = 1 | 2 | 3 | 4 | 5;

/** Draft state accumulated across wizard steps. */
export interface SetupWizardDraft {
  /** Step 1: Selected provider + detected type */
  capi_provider_id: string;
  provider_type: OfflineProviderType;

  /** Step 2 (Google): conversion action */
  google_customer_id: string;
  conversion_action_id: string;
  conversion_action_name: string;

  /** Step 2 (Meta): event name */
  meta_event_name: string;

  /** Step 3: Column mapping */
  column_mapping: ColumnMapping;

  /** Step 4: Defaults */
  default_currency: string;
  default_conversion_value: number | null;
}

export const DEFAULT_WIZARD_DRAFT: SetupWizardDraft = {
  capi_provider_id: '',
  provider_type: 'google',
  google_customer_id: '',
  conversion_action_id: '',
  conversion_action_name: '',
  meta_event_name: '',
  column_mapping: {},
  default_currency: 'USD',
  default_conversion_value: null,
};
