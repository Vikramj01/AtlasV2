# Atlas: Offline Conversion Upload — Technical Implementation PRD

> **Status**: Ready for build | **Priority**: HIGH | **Date**: April 2026
> **Repo**: `github.com/Vikramj01/AtlasV2` (private)
> **Parent module**: Conversion APIs (existing CAPI module)
> **Estimated effort**: 2–3 weeks

---

## 0. Read This First

### What This Feature Does

Enables Atlas users to upload offline conversion data (leads that closed in their CRM) back to Google Ads via Enhanced Conversions for Leads. The user exports closed deals from their CRM, maps them to a CSV template, uploads via Atlas, and Atlas validates, hashes PII, and pushes the conversions to Google Ads.

This solves a critical problem for B2B advertisers: Google Ads only sees the form fill (lead capture), not the actual sale. Without offline conversion data flowing back, Google's bidding algorithms optimise for form fills rather than revenue. PMax in particular suffers — it can't learn which types of leads actually convert downstream.

### Why CSV Upload First

CRM API integrations (Salesforce, HubSpot, Pipedrive) are complex, require per-CRM engineering, and face enterprise security pushback. CSV upload is:
- Zero CRM exposure — the client controls exactly what data leaves their system
- Universal — works with any CRM, spreadsheet, or manual process
- Shippable in weeks, not months
- Still delivers the core value: getting offline conversion signals to Google Ads

A webhook-based automated approach is planned for v2 but is explicitly out of scope for this PRD.

### How It Fits Into Atlas

This is a **sub-feature of the existing Conversion APIs module**, not a separate module. It appears as a new tab or section within the Conversion APIs page. The navigation does not change. The user flow is:

```
Conversion APIs page → "Offline Conversions" tab → Setup (one-time) → Upload CSV → Review & Confirm → Push to Google Ads → View upload history
```

### Actual Tech Stack (use this, not CLAUDE.md)

| Layer | Technology |
|-------|-----------|
| Frontend | **Vite + React 19 + React Router v6** |
| Backend | **Express.js** (separate service in `backend/src/`) |
| State | **Zustand** stores in `frontend/src/store/` |
| UI | **shadcn/ui** components |
| Database | **Supabase** (PostgreSQL) |
| Auth | **Supabase Auth** — JWT passed as `Bearer` token |
| Queue | **Bull** (Redis-backed) in `backend/src/services/queue/` |
| CAPI infra | Existing provider adapter pattern, PII hashing service, event pipeline |

### Key Existing Files to Reference

```
# CAPI module — extend these
backend/src/api/routes/capi.ts              — Existing CAPI route file (add new endpoints here or create sub-router)
backend/src/services/capi/                  — Existing CAPI services directory
backend/src/types/capi.ts                   — Existing CAPI types (CAPIProviderAdapter interface, provider types)

# Patterns to follow
backend/src/api/routes/health.ts            — Express Router + authMiddleware pattern
backend/src/services/database/              — Supabase query patterns
backend/src/services/queue/jobQueue.ts      — Bull queue definitions
backend/src/services/queue/worker.ts        — Queue worker pattern
frontend/src/lib/api/healthApi.ts           — apiFetch<T> pattern
frontend/src/store/auditStore.ts            — Zustand store pattern
frontend/src/pages/HealthDashboardPage.tsx  — Page with loading states pattern

# Existing CAPI schema (already in database)
# Tables: capi_providers, capi_events, capi_event_queue
# RLS: org_isolation pattern on all tables
```

### Build Order

```
Task 1: Database migration (new tables) .............. ~1 day
Task 2: CSV parsing + validation service .............. ~3 days
Task 3: Google Ads API upload service ................. ~3 days
Task 4: Backend API endpoints ......................... ~2 days
Task 5: Frontend — setup flow ......................... ~2 days
Task 6: Frontend — upload + review UI ................. ~3 days
Task 7: Frontend — upload history ..................... ~1 day
```

---

## 1. Database Schema

### 1.1 New Tables

Create a new migration file in `supabase/migrations/` following the existing timestamped naming pattern (e.g., `20260406_001_offline_conversions.sql`).

#### Table: `offline_conversion_configs`

Stores the one-time setup configuration for offline conversion uploads per client/org.

```sql
CREATE TABLE offline_conversion_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,  -- nullable for personal workspace

  -- Google Ads connection (reuses existing OAuth from capi_providers)
  google_ads_customer_id TEXT NOT NULL,            -- e.g., '123-456-7890'
  conversion_action_id TEXT NOT NULL,              -- Google Ads conversion action resource name
  conversion_action_name TEXT NOT NULL,            -- Human-readable name for UI display

  -- Column mapping (maps CSV columns to required fields)
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Structure: {
  --   "gclid": "Click ID",           -- CSV column header that contains GCLID
  --   "email": "Email Address",       -- CSV column header for email
  --   "phone": "Phone",              -- CSV column header for phone (optional)
  --   "conversion_time": "Close Date", -- CSV column header for conversion timestamp
  --   "conversion_value": "Deal Value", -- CSV column header for value (optional)
  --   "conversion_currency": "Currency", -- CSV column header for currency (optional)
  --   "order_id": "Deal ID"           -- CSV column header for order/deal ID (optional, for dedup)
  -- }

  -- Settings
  default_currency TEXT NOT NULL DEFAULT 'USD',    -- ISO 4217, used when CSV doesn't specify currency
  default_conversion_value DECIMAL,                -- Used when CSV doesn't specify value per row
  auto_hash_pii BOOLEAN NOT NULL DEFAULT true,     -- Hash email/phone before upload (should always be true)

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oc_configs_org ON offline_conversion_configs(organization_id);
CREATE INDEX idx_oc_configs_client ON offline_conversion_configs(client_id) WHERE client_id IS NOT NULL;
```

#### Table: `offline_conversion_uploads`

Stores metadata for each CSV upload batch.

```sql
CREATE TABLE offline_conversion_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID NOT NULL REFERENCES offline_conversion_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),

  -- File metadata
  filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',           -- File uploaded, not yet validated
    'validating',        -- Validation in progress
    'validated',         -- Validation complete, awaiting user confirmation
    'confirmed',         -- User confirmed, queued for upload to Google
    'uploading',         -- Upload to Google Ads API in progress
    'completed',         -- All rows uploaded successfully
    'partial',           -- Some rows failed
    'failed',            -- Upload failed entirely
    'cancelled'          -- User cancelled before confirmation
  )),

  -- Results
  uploaded_count INTEGER NOT NULL DEFAULT 0,       -- Rows successfully sent to Google
  failed_count INTEGER NOT NULL DEFAULT 0,         -- Rows that failed Google API upload
  google_job_id TEXT,                              -- Google Ads API offline conversion job ID

  -- Validation errors (stored for user review)
  validation_errors JSONB DEFAULT '[]'::jsonb,
  -- Structure: [{ "row": 3, "column": "email", "error": "Invalid email format" }, ...]

  -- Timing
  validated_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oc_uploads_config ON offline_conversion_uploads(config_id);
CREATE INDEX idx_oc_uploads_org ON offline_conversion_uploads(organization_id);
CREATE INDEX idx_oc_uploads_status ON offline_conversion_uploads(status) WHERE status NOT IN ('completed', 'cancelled');
```

#### Table: `offline_conversion_rows`

Stores individual rows from uploaded CSVs — both the raw data and the processed/hashed version sent to Google.

```sql
CREATE TABLE offline_conversion_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES offline_conversion_uploads(id) ON DELETE CASCADE,

  row_number INTEGER NOT NULL,                     -- Original row number in CSV (for error reporting)

  -- Raw identifiers (stored temporarily for validation display, purged after upload)
  raw_gclid TEXT,
  raw_email TEXT,
  raw_phone TEXT,
  raw_order_id TEXT,

  -- Hashed identifiers (what actually gets sent to Google)
  hashed_email TEXT,                               -- SHA-256 lowercase trimmed
  hashed_phone TEXT,                               -- SHA-256 E.164 formatted

  -- Conversion data
  gclid TEXT,                                      -- GCLID is not hashed
  conversion_time TIMESTAMPTZ NOT NULL,
  conversion_value DECIMAL,
  conversion_currency TEXT,
  order_id TEXT,                                   -- For deduplication

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',       -- Awaiting validation
    'valid',         -- Passed validation
    'invalid',       -- Failed validation (see validation_error)
    'duplicate',     -- Duplicate of another row in this or previous upload
    'uploaded',      -- Successfully sent to Google
    'upload_failed'  -- Google API rejected this row
  )),
  validation_error TEXT,                           -- Human-readable error if invalid
  google_error TEXT,                               -- Google API error if upload_failed

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oc_rows_upload ON offline_conversion_rows(upload_id);
CREATE INDEX idx_oc_rows_status ON offline_conversion_rows(upload_id, status);
CREATE INDEX idx_oc_rows_gclid ON offline_conversion_rows(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_oc_rows_email ON offline_conversion_rows(hashed_email) WHERE hashed_email IS NOT NULL;
```

### 1.2 RLS Policies

Apply the same `org_isolation` pattern used on `capi_providers` and `capi_events`:

```sql
ALTER TABLE offline_conversion_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_conversion_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_conversion_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON offline_conversion_configs
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "org_isolation" ON offline_conversion_uploads
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Rows are accessed via upload_id join, but add policy for direct queries
CREATE POLICY "org_isolation" ON offline_conversion_rows
  FOR ALL USING (
    upload_id IN (
      SELECT id FROM offline_conversion_uploads WHERE organization_id IN (
        SELECT organization_id FROM profiles WHERE id = auth.uid()
      )
    )
  );
```

### 1.3 PII Purge Function

Raw PII (unhashed email, phone) should not persist in the database after upload is complete. Add a function that purges raw identifiers:

```sql
CREATE OR REPLACE FUNCTION purge_raw_pii(p_upload_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE offline_conversion_rows
  SET raw_email = NULL,
      raw_phone = NULL,
      raw_gclid = NULL,
      raw_order_id = NULL
  WHERE upload_id = p_upload_id
    AND status IN ('uploaded', 'upload_failed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 2. CSV Template & Validation

### 2.1 Template

Atlas provides a downloadable CSV template. The template has these columns:

```csv
GCLID,Email,Phone,Conversion Time,Conversion Value,Currency,Order ID
```

**Column definitions:**

| Column | Required | Format | Notes |
|--------|----------|--------|-------|
| GCLID | One of GCLID or Email required | String | The Google Click ID captured at form submission |
| Email | One of GCLID or Email required | Email address | Will be SHA-256 hashed before upload. Lowercased and trimmed. |
| Phone | Optional | E.164 format preferred, but accept any format | Will be normalised to E.164 then SHA-256 hashed |
| Conversion Time | **Required** | ISO 8601 datetime OR common date formats | Must be within Google's 90-day lookback window |
| Conversion Value | Optional | Number (decimal) | Revenue amount of the conversion |
| Currency | Optional | ISO 4217 (USD, AED, SGD, etc.) | Defaults to config's `default_currency` if empty |
| Order ID | Optional | String | Used for deduplication — Google ignores duplicate order IDs |

### 2.2 Validation Service

**File to create**: `backend/src/services/capi/offline/csvValidator.ts`

The validator processes the uploaded CSV and produces a validated result set. It does NOT hash PII — that happens in the upload step after user confirmation.

```typescript
import { parse } from 'csv-parse/sync';  // npm install csv-parse

export interface CsvValidationResult {
  totalRows: number;
  validRows: ValidatedRow[];
  invalidRows: InvalidRow[];
  duplicateRows: DuplicateRow[];
  warnings: string[];  // non-blocking issues (e.g., "12 rows have no GCLID, will use email matching only")
}

export interface ValidatedRow {
  rowNumber: number;
  gclid: string | null;
  email: string | null;
  phone: string | null;
  conversionTime: Date;
  conversionValue: number | null;
  conversionCurrency: string | null;
  orderId: string | null;
}

export interface InvalidRow {
  rowNumber: number;
  rawData: Record<string, string>;
  errors: string[];  // e.g., ["Missing both GCLID and Email", "Conversion Time is outside 90-day window"]
}

export interface DuplicateRow {
  rowNumber: number;
  duplicateOf: number;  // row number of the original
  reason: string;       // e.g., "Same GCLID + Conversion Time"
}

export function validateCsv(
  csvContent: string,
  columnMapping: Record<string, string>,
  config: {
    defaultCurrency: string;
    defaultConversionValue: number | null;
  }
): CsvValidationResult {
  // Implementation steps:
  //
  // 1. Parse CSV using csv-parse/sync
  //    - Handle BOM (byte order mark) at start of file
  //    - Trim whitespace from all values
  //    - Handle both \r\n and \n line endings
  //
  // 2. Map columns using columnMapping
  //    - columnMapping maps Atlas field names to actual CSV column headers
  //    - e.g., { "gclid": "Click ID", "email": "Customer Email" }
  //    - If a mapped column doesn't exist in the CSV, add to warnings
  //
  // 3. Validate each row:
  //
  //    a. IDENTIFIER CHECK: At least one of GCLID or Email must be present
  //       - If both are missing → invalid: "Row must have either a GCLID or an Email address"
  //
  //    b. EMAIL FORMAT: If email is present, validate format
  //       - Basic regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  //       - If invalid → invalid: "Invalid email format"
  //       - Lowercase and trim before storing
  //
  //    c. PHONE FORMAT: If phone is present, attempt normalisation
  //       - Strip spaces, dashes, parentheses, dots
  //       - If starts with '+', keep as-is
  //       - If starts with '00', replace with '+'
  //       - If no country code, add warning (not invalid): "Phone number has no country code — matching accuracy may be lower"
  //       - Store the normalised version
  //
  //    d. CONVERSION TIME: Required. Parse flexibly.
  //       - Accept ISO 8601: "2026-03-15T14:30:00Z"
  //       - Accept common date formats: "2026-03-15", "03/15/2026", "15/03/2026", "March 15, 2026"
  //       - Accept datetime with various separators: "2026-03-15 14:30:00"
  //       - If time is missing, default to 00:00:00 UTC
  //       - If date cannot be parsed → invalid: "Cannot parse Conversion Time"
  //       - If date is in the future → invalid: "Conversion Time is in the future"
  //       - If date is > 90 days ago → invalid: "Conversion Time is outside Google's 90-day lookback window"
  //
  //    e. CONVERSION VALUE: If present, must be a positive number
  //       - Parse as float, strip currency symbols ($, €, £, etc.)
  //       - If negative → invalid: "Conversion Value must be positive"
  //       - If not a number → invalid: "Conversion Value is not a valid number"
  //       - If absent and config.defaultConversionValue is set, use that
  //
  //    f. CURRENCY: If present, validate against ISO 4217 list
  //       - Uppercase and trim
  //       - If not valid ISO 4217 → invalid: "Unknown currency code"
  //       - If absent, use config.defaultCurrency
  //
  //    g. ORDER ID: No validation needed, just trim whitespace
  //
  // 4. Deduplicate within the upload:
  //    - If two rows have the same GCLID + Conversion Time (within 60 seconds), mark the second as duplicate
  //    - If two rows have the same Order ID (non-empty), mark the second as duplicate
  //
  // 5. Generate warnings:
  //    - "X rows have no GCLID — will use email matching only (lower match rate)"
  //    - "X rows have no email — will use GCLID matching only"
  //    - "X rows have no conversion value — using default value of Y"
  //    - "X rows have conversion times older than 60 days — match rates may be lower for older conversions"

  // ... implementation
}
```

**Dependencies to install**: `npm install csv-parse` in the backend directory.

### 2.3 GCLID Lookback Validation

Google Ads accepts conversions up to 90 days after the click. However, match rates degrade significantly for conversions older than 30 days. The validator should:
- **Reject** rows with conversion times > 90 days ago (hard limit)
- **Warn** about rows with conversion times > 60 days ago (soft warning in the UI: "Older conversions may have lower match rates")

### 2.4 Cross-Upload Deduplication

In addition to within-upload dedup, check the `offline_conversion_rows` table for previously uploaded rows:
- Query by GCLID + conversion_time (within 60 seconds) for the same config_id
- Query by order_id for the same config_id
- Mark as duplicate if found, with `duplicate_of` referencing the previous upload

```typescript
export async function checkCrossUploadDuplicates(
  configId: string,
  rows: ValidatedRow[]
): Promise<{ rowNumber: number; previousUploadId: string }[]> {
  // Query offline_conversion_rows for matching gclid + conversion_time
  // or matching order_id, limited to the same config_id
  // Return list of duplicates with their original upload reference
}
```

---

## 3. Google Ads API Integration

### 3.1 Overview

Atlas uses the Google Ads API to upload offline conversions. The existing CAPI module already handles Google OAuth and stores credentials in `capi_providers`. This service reuses that authentication.

**API endpoint**: `UploadConversionAdjustments` method on the `ConversionUploadService`

**Google Ads API version**: Use the latest stable version (check at build time — currently v17+).

### 3.2 Upload Service

**File to create**: `backend/src/services/capi/offline/googleOfflineUpload.ts`

```typescript
import { GoogleAdsApi } from 'google-ads-api';  // npm install google-ads-api

export interface OfflineConversionPayload {
  gclid?: string;
  hashedEmail?: string;       // SHA-256, lowercase, trimmed
  hashedPhone?: string;       // SHA-256, E.164 format
  conversionAction: string;   // Resource name: 'customers/{id}/conversionActions/{id}'
  conversionTime: string;     // ISO 8601
  conversionValue?: number;
  currencyCode?: string;
  orderId?: string;
}

export interface UploadResult {
  totalSent: number;
  successCount: number;
  failureCount: number;
  failures: {
    rowNumber: number;
    errorCode: string;
    errorMessage: string;
  }[];
  googleJobId?: string;
}

export async function uploadOfflineConversions(
  customerId: string,
  oauthTokens: { accessToken: string; refreshToken: string },
  conversions: OfflineConversionPayload[],
  partialFailure: boolean = true   // continue uploading even if some rows fail
): Promise<UploadResult> {
  // Implementation steps:
  //
  // 1. Initialise Google Ads API client with OAuth tokens
  //    - Use the existing OAuth credentials stored in capi_providers
  //    - Refresh token if expired (handle token refresh flow)
  //
  // 2. Build the UploadClickConversionsRequest
  //    - customer_id: remove dashes from customerId (Google wants plain digits)
  //    - partial_failure: true (so one bad row doesn't block the entire batch)
  //    - conversions: array of ClickConversion objects
  //
  // 3. For each conversion, build the ClickConversion:
  //
  //    If GCLID is present:
  //      {
  //        gclid: conversion.gclid,
  //        conversion_action: conversion.conversionAction,
  //        conversion_date_time: formatGoogleDateTime(conversion.conversionTime),
  //        conversion_value: conversion.conversionValue,
  //        currency_code: conversion.currencyCode,
  //        order_id: conversion.orderId,
  //        user_identifiers: [
  //          // Include hashed email/phone even with GCLID for enhanced matching
  //          { hashed_email: conversion.hashedEmail },
  //          { hashed_phone_number: conversion.hashedPhone },
  //        ].filter(id => Object.values(id)[0] != null)
  //      }
  //
  //    If NO GCLID (email-only matching):
  //      {
  //        conversion_action: conversion.conversionAction,
  //        conversion_date_time: formatGoogleDateTime(conversion.conversionTime),
  //        conversion_value: conversion.conversionValue,
  //        currency_code: conversion.currencyCode,
  //        order_id: conversion.orderId,
  //        user_identifiers: [
  //          { hashed_email: conversion.hashedEmail },
  //          { hashed_phone_number: conversion.hashedPhone },
  //        ].filter(id => Object.values(id)[0] != null)
  //      }
  //
  // 4. Send the request
  //    - Use batch upload (Google supports up to 2000 conversions per request)
  //    - If more than 2000 rows, split into batches
  //
  // 5. Process the response
  //    - partial_failure_error contains details of failed rows
  //    - Map failures back to original row numbers
  //    - Return UploadResult with counts and failure details
  //
  // 6. Error handling
  //    - AUTHENTICATION_ERROR → token expired, trigger refresh
  //    - CONVERSION_ACTION_IS_NOT_ACTIVE → report to user, the conversion action needs to be enabled in Google Ads
  //    - TOO_RECENT_CONVERSION_ACTION → conversion action was created < 6 hours ago
  //    - CLICK_NOT_FOUND → GCLID not recognised (may be too old or invalid)
  //    - CONVERSION_ALREADY_EXISTS → duplicate (order_id match)
}

// Google Ads requires datetime in 'yyyy-MM-dd HH:mm:ssZ' format
function formatGoogleDateTime(isoString: string): string {
  const d = new Date(isoString);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}+0000`;
}
```

**Dependencies**: `npm install google-ads-api` in the backend directory.

### 3.3 PII Hashing

Reuse the existing PII hashing service from the CAPI module. Check for `backend/src/services/capi/hash-pii.ts` or `backend/src/lib/shared/crypto.ts` or equivalent. The hashing rules for Google Enhanced Conversions:

- **Email**: Lowercase → trim whitespace → SHA-256 hex digest
- **Phone**: Convert to E.164 format (include country code with +) → SHA-256 hex digest
- **Name/address**: Not used for Enhanced Conversions for Leads (only for Enhanced Conversions for Web)

If the existing hashing service doesn't exist yet, create it:

**File**: `backend/src/services/capi/offline/hashPii.ts`

```typescript
import { createHash } from 'crypto';

export function hashEmail(email: string): string {
  return createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex');
}

export function hashPhone(phone: string): string {
  // Normalise to E.164 first
  const normalised = normalisePhone(phone);
  return createHash('sha256')
    .update(normalised)
    .digest('hex');
}

function normalisePhone(phone: string): string {
  // Strip all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // If no + prefix, assume it needs a country code (can't hash reliably without one)
  // Return as-is and let the validator warn about it
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;  // best effort
  }

  return cleaned;
}
```

### 3.4 Rate Limiting

Google Ads API has rate limits. For offline conversion uploads:
- **Per request**: Max 2,000 conversions per `UploadClickConversions` call
- **Per day**: Check the user's Google Ads API quota (varies by developer token tier)

Implementation:
- Split uploads into batches of 2,000
- Add a 1-second delay between batches
- If rate limited (HTTP 429 or `RESOURCE_EXHAUSTED`), exponential backoff with max 3 retries
- Store the batch progress so uploads can be resumed if interrupted

---

## 4. Backend API Endpoints

### 4.1 Route Structure

**File to create**: `backend/src/api/routes/offlineConversions.ts`

Mount as a sub-router under the existing CAPI routes, or as a separate route:

```typescript
// In backend/src/app.ts:
import offlineConversionRoutes from './api/routes/offlineConversions';
app.use('/api/offline-conversions', offlineConversionRoutes);
```

### 4.2 Endpoints

#### `GET /api/offline-conversions/template`

Returns the CSV template file for download.

```
Response: CSV file download
Headers: Content-Type: text/csv, Content-Disposition: attachment; filename="atlas-offline-conversions-template.csv"
```

#### `POST /api/offline-conversions/config`

Creates or updates the offline conversion configuration for a client.

```typescript
// Request body:
{
  org_id: string;
  client_id?: string;
  google_ads_customer_id: string;      // e.g., "123-456-7890"
  conversion_action_id: string;        // Google Ads conversion action resource name
  conversion_action_name: string;      // Human-readable name
  column_mapping: Record<string, string>;
  default_currency: string;            // ISO 4217
  default_conversion_value?: number;
}

// Response (200):
{
  id: string;
  status: 'active';
  created_at: string;
}
```

**Validation**:
- `google_ads_customer_id` must match pattern `/^\d{3}-\d{3}-\d{4}$/`
- `conversion_action_id` must be a valid Google Ads resource name
- `default_currency` must be valid ISO 4217
- Verify Google Ads OAuth credentials exist for this org (check `capi_providers` where provider = 'google')

#### `GET /api/offline-conversions/config`

Returns the current config for the org (and optionally client).

```
Query params: org_id (required), client_id (optional)
Response (200): OfflineConversionConfig object or null
```

#### `GET /api/offline-conversions/conversion-actions`

Fetches available conversion actions from the user's Google Ads account. This calls the Google Ads API to list conversion actions so the user can select which one to upload against.

```
Query params: org_id (required)
Response (200):
{
  conversion_actions: [
    {
      resource_name: "customers/1234567890/conversionActions/98765",
      name: "Qualified Lead",
      category: "LEAD",
      status: "ENABLED"
    },
    ...
  ]
}
```

**Note**: Filter to only show ENABLED conversion actions with category relevant to offline conversions (LEAD, PURCHASE, SIGNUP, etc.).

#### `POST /api/offline-conversions/upload`

Accepts a CSV file upload, validates it, and stores the results for user review.

```typescript
// Request: multipart/form-data
// Fields:
//   file: CSV file (max 10MB)
//   config_id: string

// Response (200):
{
  upload_id: string;
  status: 'validated';
  summary: {
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    duplicate_rows: number;
    warnings: string[];
  };
  // First 5 invalid rows for preview (don't send all errors in the response)
  sample_errors: {
    row: number;
    errors: string[];
  }[];
}
```

**Implementation**:
1. Accept multipart file upload (use `multer` or existing file upload middleware)
2. Parse CSV using `csvValidator.validateCsv()`
3. Run cross-upload dedup check
4. Store all rows in `offline_conversion_rows` with status `valid` or `invalid`
5. Store upload metadata in `offline_conversion_uploads` with status `validated`
6. Return summary for user review
7. Do NOT hash PII yet — that happens at confirmation

**File size limit**: 10MB (covers ~50,000 rows comfortably). Reject larger files with a 413 response.

#### `GET /api/offline-conversions/upload/:uploadId`

Returns full details of an upload including all validation errors.

```
Response (200):
{
  id: string;
  status: string;
  filename: string;
  summary: { total_rows, valid_rows, invalid_rows, duplicate_rows };
  validation_errors: { row: number; column: string; error: string }[];
  warnings: string[];
  created_at: string;
}
```

#### `POST /api/offline-conversions/upload/:uploadId/confirm`

User confirms the upload after reviewing validation results. This triggers PII hashing and queues the upload to Google Ads.

```typescript
// Request body: (empty or { skip_invalid: true })
// If skip_invalid is true, proceed with only valid rows
// If skip_invalid is false/absent and there are invalid rows, return 400

// Response (200):
{
  upload_id: string;
  status: 'confirmed';
  queued_rows: number;
  message: 'Upload queued for processing. Check upload history for results.'
}
```

**Implementation**:
1. Change upload status to `confirmed`
2. Hash all PII in `offline_conversion_rows` (email → hashed_email, phone → hashed_phone)
3. Create a Bull queue job for the Google Ads upload
4. Return immediately — the actual upload happens asynchronously in the worker

#### `POST /api/offline-conversions/upload/:uploadId/cancel`

Cancels an upload before confirmation.

```
Response (200): { status: 'cancelled' }
```

Deletes all rows from `offline_conversion_rows` for this upload. Updates upload status to `cancelled`.

#### `GET /api/offline-conversions/history`

Returns upload history for the org/client.

```
Query params: org_id (required), client_id (optional), limit (default 20), offset (default 0)
Response (200):
{
  uploads: [
    {
      id: string;
      filename: string;
      status: string;
      total_rows: number;
      uploaded_count: number;
      failed_count: number;
      created_at: string;
      completed_at: string | null;
    }
  ],
  total: number;
}
```

### 4.3 Queue Worker

**File to create**: `backend/src/services/capi/offline/offlineUploadWorker.ts`

Add a new Bull queue for offline conversion uploads, following the pattern in `backend/src/services/queue/jobQueue.ts`:

```typescript
// In jobQueue.ts, add:
export const offlineConversionQueue = new Bull('offline-conversion-upload', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },  // 30s, 60s, 120s
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
```

Worker implementation:

```typescript
// In worker.ts or a new dedicated worker file:

offlineConversionQueue.process(async (job) => {
  const { uploadId, configId } = job.data;

  // 1. Fetch config (Google Ads credentials, conversion action)
  // 2. Fetch all valid rows for this upload from offline_conversion_rows
  // 3. Build OfflineConversionPayload array from the hashed rows
  // 4. Split into batches of 2,000
  // 5. Upload each batch via googleOfflineUpload.uploadOfflineConversions()
  // 6. Update each row's status in offline_conversion_rows (uploaded or upload_failed)
  // 7. Update upload summary counts in offline_conversion_uploads
  // 8. If all rows uploaded: status = 'completed'
  //    If some failed: status = 'partial'
  //    If all failed: status = 'failed'
  // 9. Call purge_raw_pii() to remove unhashed PII from the database
  // 10. Log completion for monitoring
});
```

---

## 5. TypeScript Interfaces

### 5.1 Backend Types

**File to create**: `backend/src/types/offlineConversions.ts`

```typescript
export interface OfflineConversionConfig {
  id: string;
  organization_id: string;
  client_id: string | null;
  google_ads_customer_id: string;
  conversion_action_id: string;
  conversion_action_name: string;
  column_mapping: ColumnMapping;
  default_currency: string;
  default_conversion_value: number | null;
  auto_hash_pii: boolean;
  status: 'active' | 'paused' | 'error';
  created_at: string;
  updated_at: string;
}

export interface ColumnMapping {
  gclid?: string;
  email?: string;
  phone?: string;
  conversion_time: string;
  conversion_value?: string;
  conversion_currency?: string;
  order_id?: string;
}

export interface OfflineConversionUpload {
  id: string;
  config_id: string;
  organization_id: string;
  uploaded_by: string;
  filename: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  status: UploadStatus;
  uploaded_count: number;
  failed_count: number;
  google_job_id: string | null;
  validation_errors: ValidationError[];
  validated_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type UploadStatus =
  | 'pending'
  | 'validating'
  | 'validated'
  | 'confirmed'
  | 'uploading'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface ValidationError {
  row: number;
  column: string;
  error: string;
}

export interface OfflineConversionRow {
  id: string;
  upload_id: string;
  row_number: number;
  raw_gclid: string | null;
  raw_email: string | null;
  raw_phone: string | null;
  hashed_email: string | null;
  hashed_phone: string | null;
  gclid: string | null;
  conversion_time: string;
  conversion_value: number | null;
  conversion_currency: string | null;
  order_id: string | null;
  status: RowStatus;
  validation_error: string | null;
  google_error: string | null;
}

export type RowStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'duplicate'
  | 'uploaded'
  | 'upload_failed';

export interface GoogleConversionAction {
  resource_name: string;
  name: string;
  category: string;
  status: string;
}
```

### 5.2 Frontend Types

**File to create**: `frontend/src/types/offlineConversions.ts`

Mirror the backend types needed for the UI. Also add:

```typescript
export interface UploadSummary {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  warnings: string[];
}

export interface UploadHistoryItem {
  id: string;
  filename: string;
  status: string;
  total_rows: number;
  uploaded_count: number;
  failed_count: number;
  created_at: string;
  completed_at: string | null;
}

// Setup wizard steps
export type SetupStep = 'connect' | 'action' | 'mapping' | 'defaults' | 'done';
```

---

## 6. Frontend

### 6.1 Navigation

This feature lives inside the existing Conversion APIs page. Add a tab to the CAPI page:

**File to modify**: The Conversion APIs page (find it in `frontend/src/pages/` — likely `CapiPage.tsx` or `ConversionApiPage.tsx` or similar)

Add a tab using shadcn `Tabs`:

```tsx
<Tabs defaultValue="providers" className="w-full">
  <TabsList>
    <TabsTrigger value="providers">Providers</TabsTrigger>
    <TabsTrigger value="offline">Offline Conversions</TabsTrigger>
  </TabsList>
  <TabsContent value="providers">
    {/* Existing CAPI provider cards and setup */}
  </TabsContent>
  <TabsContent value="offline">
    <OfflineConversionsTab />
  </TabsContent>
</Tabs>
```

### 6.2 Component Structure

```
frontend/src/components/offline-conversions/
├── OfflineConversionsTab.tsx       — Main tab container (routes between setup, upload, history)
├── SetupWizard.tsx                 — One-time configuration flow
├── ConversionActionSelector.tsx    — Fetches and displays Google Ads conversion actions
├── ColumnMapper.tsx                — Maps CSV columns to Atlas fields
├── UploadFlow.tsx                  — CSV upload + validation review + confirm
├── UploadDropzone.tsx              — Drag-and-drop file upload area
├── ValidationReview.tsx            — Shows validation results with error table
├── UploadHistory.tsx               — Historical uploads table with status
└── TemplateDownload.tsx            — Download template button component
```

### 6.3 API Client

**File to create**: `frontend/src/lib/api/offlineConversionsApi.ts`

```typescript
import { apiFetch } from './apiFetch';
import type {
  OfflineConversionConfig,
  UploadSummary,
  UploadHistoryItem,
  GoogleConversionAction,
  OfflineConversionUpload,
} from '@/types/offlineConversions';

export const offlineConversionsApi = {
  getConfig: (orgId: string, clientId?: string) => {
    const params = new URLSearchParams({ org_id: orgId });
    if (clientId) params.set('client_id', clientId);
    return apiFetch<OfflineConversionConfig | null>(`/api/offline-conversions/config?${params}`);
  },

  saveConfig: (config: Omit<OfflineConversionConfig, 'id' | 'created_at' | 'updated_at' | 'status' | 'auto_hash_pii'>) =>
    apiFetch<{ id: string; status: string }>('/api/offline-conversions/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  getConversionActions: (orgId: string) =>
    apiFetch<{ conversion_actions: GoogleConversionAction[] }>(
      `/api/offline-conversions/conversion-actions?org_id=${orgId}`
    ),

  uploadCsv: async (configId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('config_id', configId);

    // Can't use apiFetch for multipart — use fetch directly
    const session = await getSession();  // get Supabase session
    const response = await fetch('/api/offline-conversions/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
      body: formData,
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    return response.json() as Promise<{ upload_id: string; status: string; summary: UploadSummary; sample_errors: any[] }>;
  },

  getUpload: (uploadId: string) =>
    apiFetch<OfflineConversionUpload>(`/api/offline-conversions/upload/${uploadId}`),

  confirmUpload: (uploadId: string, skipInvalid: boolean = true) =>
    apiFetch<{ upload_id: string; status: string; queued_rows: number }>(
      `/api/offline-conversions/upload/${uploadId}/confirm`,
      { method: 'POST', body: JSON.stringify({ skip_invalid: skipInvalid }) }
    ),

  cancelUpload: (uploadId: string) =>
    apiFetch<{ status: string }>(
      `/api/offline-conversions/upload/${uploadId}/cancel`,
      { method: 'POST' }
    ),

  getHistory: (orgId: string, clientId?: string, limit = 20, offset = 0) => {
    const params = new URLSearchParams({ org_id: orgId, limit: String(limit), offset: String(offset) });
    if (clientId) params.set('client_id', clientId);
    return apiFetch<{ uploads: UploadHistoryItem[]; total: number }>(
      `/api/offline-conversions/history?${params}`
    );
  },

  downloadTemplate: () => {
    // Direct download — no auth needed for a static template
    window.open('/api/offline-conversions/template', '_blank');
  },
};
```

### 6.4 Zustand Store

**File to create**: `frontend/src/store/offlineConversionsStore.ts`

```typescript
import { create } from 'zustand';
import type {
  OfflineConversionConfig,
  UploadHistoryItem,
  SetupStep,
} from '@/types/offlineConversions';

interface OfflineConversionsStore {
  config: OfflineConversionConfig | null;
  setupStep: SetupStep;
  currentUploadId: string | null;
  history: UploadHistoryItem[];
  loading: boolean;
  error: string | null;

  setConfig: (config: OfflineConversionConfig | null) => void;
  setSetupStep: (step: SetupStep) => void;
  setCurrentUploadId: (id: string | null) => void;
  setHistory: (history: UploadHistoryItem[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useOfflineConversionsStore = create<OfflineConversionsStore>((set) => ({
  config: null,
  setupStep: 'connect',
  currentUploadId: null,
  history: [],
  loading: false,
  error: null,

  setConfig: (config) => set({ config }),
  setSetupStep: (setupStep) => set({ setupStep }),
  setCurrentUploadId: (currentUploadId) => set({ currentUploadId }),
  setHistory: (history) => set({ history }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  clear: () => set({ config: null, setupStep: 'connect', currentUploadId: null, history: [], loading: false, error: null }),
}));
```

### 6.5 UI Flows

#### Flow A: First-Time Setup

User has no `offline_conversion_config` yet. Show the setup wizard:

**Step 1 — Connect Google Ads**
- Check if Google OAuth already exists in `capi_providers` for this org
- If yes: show "Google Ads connected" with the account name, skip to Step 2
- If no: show "Connect Google Ads" button that triggers the existing OAuth flow from the CAPI module
- Display the Google Ads customer ID after connection

**Step 2 — Select Conversion Action**
- Fetch conversion actions from `GET /api/offline-conversions/conversion-actions`
- Display as a selectable list (radio buttons), showing action name and category
- If no suitable conversion action exists, show guidance: "You need to create an 'Offline' conversion action in Google Ads first. Go to Google Ads → Tools → Conversions → New conversion action → Import → Track conversions from clicks."
- Link: open Google Ads conversions page in new tab

**Step 3 — Map Columns**
- Show the expected Atlas fields on the left (GCLID, Email, Phone, Conversion Time, Value, Currency, Order ID)
- For each field, a text input where the user enters the column header name from their CSV
- Pre-fill with default column names (GCLID, Email, Phone, Conversion Time, Conversion Value, Currency, Order ID)
- Mark required fields with asterisk
- Tooltip on each field explaining what it is and where to find it in their CRM

**Step 4 — Set Defaults**
- Default currency dropdown (pre-fill based on user's locale — AED if UAE, SGD if Singapore, USD otherwise)
- Default conversion value input (optional)
- Note: "These defaults are used when your CSV doesn't include values for individual rows"

**Step 5 — Done**
- Confirmation: "Offline conversion upload is configured"
- "Download CSV Template" button
- "Upload Your First File" button
- Show a brief reminder about GCLID capture: "Make sure your lead forms include a hidden GCLID field. Without the GCLID, Google can only match conversions using email addresses, which has a lower match rate."

#### Flow B: Upload CSV

User has a config. Show the upload interface:

**Upload Area**
- Drag-and-drop zone (dashed border, icon, "Drop your CSV file here or click to browse")
- File type restriction: `.csv` only
- File size limit display: "Max 10MB (~50,000 rows)"
- "Download template" text link below the dropzone

**After Upload — Validation Review**
- Summary card at top:
  - Total rows: X
  - Valid: X (green)
  - Invalid: X (red) — clickable to show error table
  - Duplicates: X (amber) — clickable to show which rows
- Warnings section (amber background, if any):
  - "23 rows have no GCLID — will use email matching only"
  - "5 rows have conversion times older than 60 days"
- Error table (if invalid rows exist):
  - Columns: Row #, Error, Raw Data Preview
  - Paginated if > 20 errors
  - "Download full error report" link (CSV with all errors)

**Confirmation Step**
- Two buttons:
  - "Upload X valid rows to Google Ads" (primary, navy) — triggers confirm with `skip_invalid: true`
  - "Cancel" (ghost)
- If ALL rows are invalid, disable the upload button and show: "No valid rows to upload. Fix the errors in your CSV and try again."
- Checkbox (pre-checked): "Skip X invalid rows and upload valid rows only"

**Processing State**
- After confirmation, show a progress indicator:
  - "Processing... Hashing identifiers" → "Uploading to Google Ads (batch 1 of 3)" → "Complete"
  - Poll `GET /api/offline-conversions/upload/:id` every 5 seconds for status updates
  - When complete, show results:
    - "X conversions uploaded successfully"
    - "X rows failed" (with expandable error details showing Google's error codes)
    - "View in Google Ads" link to the conversion action diagnostics page

#### Flow C: Upload History

Table showing all previous uploads:

| Column | Content |
|--------|---------|
| Date | Upload date, relative time |
| File | Filename |
| Rows | Total / Uploaded / Failed |
| Status | Badge: Completed (green), Partial (amber), Failed (red), Processing (blue spinner) |
| Actions | View details, Re-upload (opens upload flow with same config) |

Click a row to see full details including per-row results and any Google error messages.

### 6.6 Contextual Guidance

Add guidance text throughout the UI:

**On the setup wizard, Step 2 (conversion action selection)**:
> "Choose the conversion action that represents a qualified lead or closed deal — not the form submission. Google Ads will optimise your campaigns toward this offline outcome rather than just form fills, which typically improves lead quality by 20–40%."

**On the upload dropzone**:
> "Upload closed deals from the last 90 days. Google matches these back to the original ad click and uses the data to optimise your campaigns for actual revenue, not just leads."

**On the validation review, next to the GCLID warning**:
> "Rows without a GCLID can still be matched using email addresses, but match rates are significantly lower (~30–50% vs ~90% with GCLID). To improve GCLID capture, add a hidden form field that stores the GCLID from the visitor's URL."

**On the upload history, when status is 'completed'**:
> "Google Ads typically reflects uploaded offline conversions within 24 hours. You should see these conversions appear in your Google Ads reporting under the conversion action you selected."

### 6.7 GCLID Capture Guidance Panel

Add a persistent help section on the Offline Conversions tab (collapsible, below the upload history):

**Title**: "How to capture GCLID on your lead forms"

**Content**:

```
For offline conversion tracking to work, your website must capture the Google Click ID (GCLID) 
when a visitor fills in a form. Here's how:

1. When a visitor arrives from a Google ad, the URL contains a 'gclid' parameter
   Example: yoursite.com/contact?gclid=EAIaIQobChMI...

2. Your website needs JavaScript that:
   a. Reads the gclid from the URL on page load
   b. Stores it in a cookie or localStorage (so it persists across pages)
   c. Populates a hidden form field with the stored gclid value

3. When the form is submitted, the gclid is sent to your CRM along with the lead data

4. When you export closed deals for upload, include the gclid column

If you used Atlas's Set Up Tracking to generate your data layer, GCLID capture is already 
included. Check your Developer Handoff to verify it's been implemented.
```

Include a code snippet that the user can copy:

```javascript
// Atlas — GCLID Capture Snippet
// Add this to your site's <head> or GTM Custom HTML tag

(function() {
  var match = window.location.search.match(/[?&]gclid=([^&]*)/);
  if (match) {
    var gclid = decodeURIComponent(match[1]);
    document.cookie = '_atlas_gclid=' + gclid + ';max-age=7776000;path=/;SameSite=Lax';
  }

  // Populate hidden form fields
  document.addEventListener('DOMContentLoaded', function() {
    var gclidCookie = document.cookie.match(/(^|;)\s*_atlas_gclid=([^;]*)/);
    if (gclidCookie) {
      var fields = document.querySelectorAll('input[name="gclid"], input[name="GCLID"], input[data-atlas="gclid"]');
      fields.forEach(function(f) { f.value = gclidCookie[2]; });
    }
  });
})();
```

---

## 7. Security & Privacy

### 7.1 PII Handling

- Raw PII (unhashed email, phone) is stored in `offline_conversion_rows` ONLY during the validation review phase
- Once the upload is confirmed and processed, `purge_raw_pii()` is called to null out all raw fields
- The `raw_email`, `raw_phone`, `raw_gclid`, and `raw_order_id` columns exist solely for displaying validation errors to the user before they confirm
- Hashed versions are retained for audit trail purposes
- **Never log unhashed PII** — not in console.log, not in error messages, not in Bull queue job data

### 7.2 File Handling

- Uploaded CSV files are parsed in memory, not stored on disk
- The CSV content is never written to Supabase Storage — only the parsed, validated row data is stored in the database
- Multer (or equivalent) should use `memoryStorage`, not `diskStorage`
- Max file size enforced at both the Express middleware level (10MB) and in the frontend dropzone

### 7.3 Google Ads Credentials

- Reuse existing OAuth tokens from the `capi_providers` table (where provider = 'google')
- Do NOT store Google Ads credentials separately — always reference the existing CAPI provider config
- Token refresh is handled by the existing CAPI auth service

---

## 8. Error Handling

### 8.1 Upload Errors

| Error | User Message | Action |
|-------|-------------|--------|
| File too large | "File exceeds 10MB limit. Split your data into smaller files." | Show before upload starts |
| Invalid file type | "Please upload a CSV file." | Show before upload starts |
| Empty file | "The uploaded file is empty." | Show after upload |
| No valid rows | "No valid rows found. Check the error report and fix your CSV." | Show after validation |
| All rows duplicate | "All rows in this file have already been uploaded." | Show after validation |

### 8.2 Google Ads API Errors

| Google Error Code | User Message | Severity |
|---|---|---|
| AUTHENTICATION_ERROR | "Google Ads connection expired. Please reconnect in Conversion APIs settings." | Critical — block upload |
| CONVERSION_ACTION_IS_NOT_ACTIVE | "The selected conversion action is disabled in Google Ads. Enable it and try again." | Critical — block upload |
| TOO_RECENT_CONVERSION_ACTION | "This conversion action was created less than 6 hours ago. Wait and try again." | Temporary — retry later |
| CLICK_NOT_FOUND | "GCLID not recognised by Google (may be expired or from a different account)." | Per-row — mark row as failed |
| CONVERSION_ALREADY_EXISTS | "This conversion was already uploaded (matched by Order ID)." | Per-row — mark as duplicate, not failure |
| EXPIRED_EVENT | "Conversion is older than 90 days and can no longer be uploaded." | Per-row — mark as failed |

### 8.3 Queue Failures

If the Bull job fails after 3 retries:
- Update upload status to `failed`
- Store the error message in the upload record
- Surface on the Action Dashboard as a warning card: "Offline conversion upload failed — X rows could not be sent to Google Ads. [View details →]"

---

## 9. Integration with Action Dashboard

When the Phase 1 Action Dashboard is built (or if it already exists), add two new card generators to `dashboardService.ts`:

**Upload reminder card** (info severity):
- Triggers on the 1st and 15th of each month if the org has an active offline conversion config
- Title: "Time to upload your latest closed deals"
- Description: "Upload your CRM exports to keep Google Ads optimising for real revenue, not just form fills."
- Action: route to Conversion APIs → Offline Conversions tab

**Upload failure card** (warning severity):
- Triggers when an upload has status `failed` or `partial`
- Title: "Offline conversion upload had failures"
- Description: "X of Y rows failed to upload to Google Ads."
- Action: route to the specific upload detail view

---

## 10. Testing Checklist

- [ ] CSV template downloads correctly with proper headers
- [ ] Upload accepts valid CSV and returns correct validation summary
- [ ] Upload rejects files > 10MB
- [ ] Upload rejects non-CSV files
- [ ] Validation catches: missing identifiers, invalid emails, unparseable dates, future dates, dates > 90 days old, negative values, invalid currencies
- [ ] Within-upload deduplication works (same GCLID + time, same Order ID)
- [ ] Cross-upload deduplication detects previously uploaded rows
- [ ] PII hashing produces correct SHA-256 hex output for email and phone
- [ ] Phone normalisation handles various formats (with/without country code, spaces, dashes)
- [ ] Google Ads API upload works with a test conversion action
- [ ] Partial failure handling: some rows fail, others succeed, counts are correct
- [ ] Upload status transitions correctly through the full lifecycle
- [ ] Raw PII is purged from database after upload completion
- [ ] Upload history shows all previous uploads with correct status
- [ ] Polling correctly updates the UI during async processing
- [ ] Error messages from Google API are translated to user-friendly text
- [ ] Setup wizard reuses existing Google OAuth from CAPI providers
- [ ] Works for orgs with and without client_id
- [ ] RLS policies prevent cross-org data access
- [ ] No PII appears in console logs or error reports

---

## 11. Deployment Checklist

- [ ] Migration applied: `20260406_001_offline_conversions.sql`
- [ ] Backend dependencies installed: `csv-parse`, `google-ads-api`
- [ ] New Bull queue registered and worker processing
- [ ] Backend routes mounted and accessible
- [ ] Frontend tab added to Conversion APIs page
- [ ] GCLID capture snippet renders correctly in the guidance panel
- [ ] File upload works through Vercel → Render (check request size limits on both)
- [ ] Google Ads API credentials working in production
- [ ] PII purge function tested in production database

---

## 12. Future: Webhook Receiver (v2, out of scope)

For reference only — this is NOT part of the current build but documents the planned v2 approach:

The webhook receiver will add an automated input method alongside CSV upload. Each client gets a unique webhook URL: `POST /api/offline-conversions/ingest/{token}`. CRM workflow automations send a JSON payload when a deal closes. Atlas validates, hashes, and queues the conversion identically to the CSV flow.

The database schema in this PRD already supports this — `offline_conversion_rows` and the upload pipeline are input-agnostic. The v2 work is primarily:
- A new route that accepts webhook payloads
- Token generation and management UI
- Per-CRM setup guide generator (HubSpot, Salesforce, Pipedrive)
- Rate limiting on the webhook endpoint

This is noted here so that nothing in the current implementation blocks the v2 path.
