# Atlas Signal Enrichment Configuration — Product Requirements Document

**File:** `ATLAS_Signal_Enrichment_PRD.md`  
**Status:** Ready for implementation  
**Consumes:** `capi.ts`, `ATLAS_Composable_Signals_PRD.md`, `ATLAS_CX_Improvements_PRD.md`  
**Implements:** Payload field mapping UI missing from Deployment Wizard and Client Setup flow  

---

## 1. Background & Problem Statement

### 1.1 What Exists Today

The Atlas CAPI module (`frontend/src/types/capi.ts`) has a well-designed type system for sending enriched conversion payloads to Meta CAPI and Google Enhanced Conversions. Specifically:

- `IdentifierConfig` with `enabled_identifiers` and `source_mapping` — maps identifier types (`email`, `phone`, `fbp`, `fbc`, `gclid`, etc.) to dataLayer field paths
- `DedupConfig` with `event_id_field` — specifies the field holding the unique event ID
- `CAPIProviderConfig` — stores per-client CAPI credentials, event mappings, identifier config, and dedup config
- `AtlasEvent.user_data` — full schema for all identity fields including `email`, `phone`, `fbc`, `fbp`, `gclid`, `wbraid`, `gbraid`, `client_ip_address`, `client_user_agent`
- `CAPIProviderAdapter.formatEvent` — the interface all adapters implement to format an AtlasEvent into a provider-specific payload

The Composable Signals PRD defines a Signal Library with platform mappings. The `purchase` signal seed data includes `value`, `currency`, and `transaction_id` as required/optional params mapped to Meta and Google — but **identity fields (`em`, `ph`, `fbp`, `fbc`) are absent from the purchase signal's platform mappings**, despite being the primary mechanism by which both platforms identify the buyer and learn who high-value customers resemble.

The `generate_lead` signal does include `user_email → em` and `user_phone → ph` in its Meta mapping, but this is inconsistent and the underlying UX problem remains: **there is no UI surface in the Deployment Wizard or Client Setup flow where a user can specify which dataLayer variables hold the identity, value, and dedup data for a given signal**. The `source_mapping` field in `IdentifierConfig` is never populated via a user action.

### 1.2 The Gap

A user who deploys the "Ecommerce Standard" signal pack to a client today will get GTM containers and WalkerOS configs that correctly track the event names and basic parameters (value, currency, items). They will **not** get:

- Hashed email sent to Meta CAPI or Google Enhanced Conversions
- `fbp` / `fbc` cookies passed through to Meta
- `gclid` passed to Google for Enhanced Conversions matching
- Proper `event_id` deduplication between browser and server events
- Accurate post-discount order value (net of discounts, excluding tax and shipping)

These are not optional hygiene items. They are the primary mechanism for value-based bidding optimisation — without them, the ad platform cannot identify who the buyer is and therefore cannot find more buyers who look like them. The Atlas system can detect their absence (via the Validation Engine) but cannot configure or inject them, which limits Atlas from being a complete signal infrastructure solution.

### 1.3 Why This Matters for Atlas's Positioning

Atlas's core positioning is "signal intelligence" — the idea that the quality of conversion signals, not just their presence, determines campaign performance. An Atlas client who has configured event names but not identity enrichment is sending structurally incomplete signals. Every checklist item that Atlas's own diagnostic tools flag as missing (hashed email, fbp/fbc, accurate value, dedup key) should be fixable within Atlas itself, not require the user to go back to GTM manually.

---

## 2. Goals

1. Give every user a guided UI to map their client's dataLayer field names to Atlas's identity, value, and dedup signal schema — as part of either the Deployment Wizard or standalone CAPI provider setup.
2. Ensure that every signal with a `conversion` category automatically prompts enrichment configuration for the fields that are required by the platform mapping.
3. Propagate enrichment config into the CAPI pipeline so that events sent server-side carry the correctly hashed identity data without developer intervention beyond the initial mapping setup.
4. Surface enrichment completeness as a score within the client dashboard ("Signal Enrichment Quality") alongside the existing implementation health score.
5. Extend the `purchase` and other conversion signals' platform mappings to include identity fields so GTM output and WalkerOS output also carry the correct parameter references.

---

## 3. Scope

### In Scope

- New `EnrichmentConfig` TypeScript type (extending existing `IdentifierConfig` and `DedupConfig`)
- Schema extension: `signal_enrichment_configs` table (per deployment, per signal)
- Schema extension: `capi_provider_configs` table gets `enrichment_validated_at` and `enrichment_score` columns
- Extension of `signal_overrides` JSONB in `deployments` to include `enrichment_ref` foreign key
- New Deployment Wizard step: **Step 4 — Signal Enrichment** (inserted between "Assign Signals to Pages" and "Generate Outputs")
- New Client Setup Wizard step: **Step 4 — Identity Configuration** (inserted between "Platform IDs" and "Deploy Packs")
- Updated seed data: add identity fields to `purchase`, `begin_checkout`, `generate_lead`, `sign_up` signal platform mappings
- Backend service: `enrichmentConfigService.ts` — validates field paths, applies enrichment to live events
- Backend endpoint additions to the client routes
- Frontend components: `SignalEnrichmentStep.tsx`, `IdentityConfigStep.tsx`, `FieldMappingRow.tsx`, `EnrichmentScoreBadge.tsx`
- Enrichment score visible on `ClientDetailPage.tsx`
- GTM output includes identity variable references in tag configs
- WalkerOS output includes identity field references in signal files

### Out of Scope

- Automatic dataLayer field detection / AI-assisted field discovery (future feature)
- Real-time enrichment pipeline (the WalkerOS Atlas destination, Phase 3)
- Consent enforcement integration changes (covered in `consent.ts` separately)
- TikTok / LinkedIn / Snapchat identity enrichment (Meta and Google only in v1)
- Customer CSV upload for the identity store (covered in BSE PRD separately)

---

## 4. Architecture Overview

### 4.1 Two Configuration Surfaces

Enrichment config is split across two surfaces because identity field mapping is a **client-level concern** (email is always at the same path regardless of which signal fires) while value/dedup configuration is a **signal-level concern** (the Purchase event's value field is different from the Lead event's value field).

```
CLIENT LEVEL (once per client per platform)
────────────────────────────────────────────
IdentityMappingConfig:
  email    → "customer.email"        ← The dataLayer path
  phone    → "customer.phone"
  fbp      → "_fbp"                  ← Cookie name or dL path
  fbc      → "_fbc"
  gclid    → "gclid"
  first_name → "customer.firstName"
  last_name  → "customer.lastName"
  postal_code → "customer.zip"
  country    → "customer.country"
  external_id → "customer.id"
  client_ip_address → "auto"         ← "auto" = read from request
  client_user_agent → "auto"

SIGNAL LEVEL (once per signal per deployment)
─────────────────────────────────────────────
SignalEnrichmentConfig (per signal key, e.g. "purchase"):
  value_field         → "ecommerce.purchase.actionField.revenue"
  value_includes_tax  → false
  value_includes_shipping → false
  currency_field      → "ecommerce.currencyCode"    ← or hardcoded
  currency_static     → null                        ← if static e.g. "AED"
  dedup_id_field      → "ecommerce.purchase.actionField.id"
  content_ids_field   → "ecommerce.purchase.products[].id"
  num_items_field     → "ecommerce.purchase.products.length"
  enabled_for_meta    → true
  enabled_for_google  → true
```

### 4.2 How the CAPI Pipeline Uses This

When Atlas processes a server-side event through the CAPI pipeline:

1. Receives an `AtlasEvent` from the WalkerOS/GTM event source
2. Looks up the `CAPIProviderConfig` for this client + platform
3. Reads `identifier_config.source_mapping` to resolve identity fields from the event's raw data
4. Reads the deployment's `SignalEnrichmentConfig` for this signal key to resolve value, currency, dedup
5. Constructs a fully populated `AtlasEvent` with all identity and value fields
6. Passes to the provider adapter (`formatEvent`) which hashes PII and formats for the platform API

This means enrichment configuration is applied server-side by Atlas — the GTM/WalkerOS implementation only needs to pass the raw data; Atlas handles the hashing, field resolution, and formatting.

---

## 5. Data Model

### 5.1 New Table: `signal_enrichment_configs`

```sql
-- Migration: db/migrations/20260603_001_signal_enrichment_configs.sql

CREATE TABLE signal_enrichment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: enrichment config belongs to a deployment for a specific signal
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  signal_key    TEXT NOT NULL,                    -- e.g. 'purchase', 'generate_lead'

  -- Value configuration
  value_field             TEXT,                   -- dataLayer path: 'ecommerce.purchase.actionField.revenue'
  value_includes_tax      BOOLEAN NOT NULL DEFAULT false,
  value_includes_shipping BOOLEAN NOT NULL DEFAULT false,
  currency_field          TEXT,                   -- dataLayer path, OR null if currency_static is set
  currency_static         TEXT,                   -- Hardcoded currency code e.g. 'AED', 'SGD', 'USD'

  -- Deduplication
  dedup_id_field          TEXT,                   -- dataLayer path: 'ecommerce.purchase.actionField.id'

  -- Item data (for catalogue/dynamic retargeting)
  content_ids_field       TEXT,                   -- dataLayer path to array of product IDs
  content_ids_path_type   TEXT NOT NULL DEFAULT 'array'
                          CHECK (content_ids_path_type IN ('array', 'string', 'nested')),
  num_items_field         TEXT,                   -- dataLayer path or 'auto' (computed from array length)

  -- Platform enablement
  enabled_for_meta        BOOLEAN NOT NULL DEFAULT true,
  enabled_for_google      BOOLEAN NOT NULL DEFAULT true,

  -- Validation state
  validated_at            TIMESTAMPTZ,
  validation_score        INTEGER,                -- 0-100, computed enrichment completeness for this signal
  validation_warnings     JSONB DEFAULT '[]',     -- Array of { field, message, severity }

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(deployment_id, signal_key)
);

CREATE INDEX idx_enrichment_deployment ON signal_enrichment_configs(deployment_id);
CREATE INDEX idx_enrichment_signal_key ON signal_enrichment_configs(signal_key);

ALTER TABLE signal_enrichment_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members access enrichment configs" ON signal_enrichment_configs
  FOR ALL USING (
    deployment_id IN (
      SELECT d.id FROM deployments d
      JOIN clients c ON c.id = d.client_id
      JOIN organisation_members om ON om.organisation_id = c.organisation_id
      WHERE om.user_id = auth.uid()
    )
  );
```

### 5.2 New Table: `client_identity_configs`

```sql
-- Client-level identity field mapping (once per client, used by all CAPI providers for this client)

CREATE TABLE client_identity_configs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE UNIQUE,

  -- Identity field paths (dataLayer variable names or cookie names)
  -- 'auto' = Atlas reads from HTTP request headers
  -- null   = field not configured / not collected
  email_field        TEXT,                        -- e.g. 'customer.email'
  phone_field        TEXT,                        -- e.g. 'customer.phone'
  first_name_field   TEXT,
  last_name_field    TEXT,
  postal_code_field  TEXT,
  country_field      TEXT,
  external_id_field  TEXT,                        -- e.g. 'customer.id'

  -- Click IDs (typically captured via URL param and stored in cookie or dL)
  fbc_field          TEXT DEFAULT '_fbc',         -- Meta click ID
  fbp_field          TEXT DEFAULT '_fbp',         -- Meta browser cookie
  gclid_field        TEXT DEFAULT 'gclid',        -- Google click ID
  wbraid_field       TEXT DEFAULT 'wbraid',
  gbraid_field       TEXT DEFAULT 'gbraid',

  -- Auto-capture settings
  auto_capture_ip    BOOLEAN NOT NULL DEFAULT true,
  auto_capture_ua    BOOLEAN NOT NULL DEFAULT true,

  -- Enabled identifiers (controls which fields are sent, even if mapped)
  enabled_identifiers TEXT[] NOT NULL DEFAULT
    ARRAY['email', 'phone', 'fbp', 'fbc', 'gclid', 'client_ip_address', 'client_user_agent'],

  -- Validation
  validated_at       TIMESTAMPTZ,
  identity_score     INTEGER,                     -- 0-100, match quality estimate

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_identity_client ON client_identity_configs(client_id);

ALTER TABLE client_identity_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members access identity configs" ON client_identity_configs
  FOR ALL USING (
    client_id IN (
      SELECT c.id FROM clients c
      JOIN organisation_members om ON om.organisation_id = c.organisation_id
      WHERE om.user_id = auth.uid()
    )
  );
```

### 5.3 Extend `capi_provider_configs` (if table exists) or apply to `CAPIProviderConfig`

```sql
-- If capi_provider_configs table exists, add columns:
ALTER TABLE capi_provider_configs
  ADD COLUMN IF NOT EXISTS identity_config_id UUID REFERENCES client_identity_configs(id),
  ADD COLUMN IF NOT EXISTS enrichment_score    INTEGER,
  ADD COLUMN IF NOT EXISTS enrichment_validated_at TIMESTAMPTZ;
```

### 5.4 Update `purchase` Signal Platform Mappings (Seed Data Patch)

```sql
-- Migration: patch the purchase signal to include identity fields in platform mappings
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "meta": {
    "event_name": "Purchase",
    "param_mapping": {
      "transaction_id": "order_id",
      "value": "value",
      "currency": "currency",
      "items": "content_ids"
    },
    "identity_fields": ["email", "phone", "fbp", "fbc", "external_id",
                        "first_name", "last_name", "postal_code", "country",
                        "client_ip_address", "client_user_agent"],
    "additional": {
      "content_type": "product"
    }
  },
  "google": {
    "event_name": "conversion",
    "param_mapping": {
      "transaction_id": "order_id",
      "value": "value",
      "currency": "currency"
    },
    "identity_fields": ["email", "phone", "first_name", "last_name",
                        "postal_code", "country", "gclid"],
    "additional": {
      "send_to": "{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}"
    }
  }
}'::jsonb
WHERE key = 'purchase' AND is_system = true;

-- Patch generate_lead (already has some identity but needs google identity fields)
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "google": {
    "event_name": "conversion",
    "param_mapping": { "value": "value", "currency": "currency" },
    "identity_fields": ["email", "phone", "first_name", "last_name",
                        "postal_code", "country", "gclid"],
    "additional": { "send_to": "{{GOOGLE_ADS_CONVERSION_ID}}/{{CONVERSION_LABEL}}" }
  }
}'::jsonb
WHERE key = 'generate_lead' AND is_system = true;

-- Patch begin_checkout and sign_up similarly
UPDATE signals
SET platform_mappings = platform_mappings || '{
  "meta": {
    "event_name": "InitiateCheckout",
    "param_mapping": { "value": "value", "currency": "currency", "items": "content_ids" },
    "identity_fields": ["email", "phone", "fbp", "fbc", "client_ip_address", "client_user_agent"],
    "additional": { "content_type": "product" }
  }
}'::jsonb
WHERE key = 'begin_checkout' AND is_system = true;
```

---

## 6. TypeScript Types

**File: `frontend/src/types/enrichment.ts`** (new file)

```typescript
// ============================================================
// Atlas Signal Enrichment Configuration Types
// ============================================================

import type { IdentifierType, CAPIProvider } from './capi';

// -----------------------------------------------------------
// Client-Level Identity Configuration
// -----------------------------------------------------------

/**
 * Maps each identity field type to the dataLayer path where
 * Atlas should read it from for this client.
 * 'auto' = read from HTTP request (IP, UA).
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
  fbc?: string;               // Default: '_fbc'
  fbp?: string;               // Default: '_fbp'
  gclid?: string;             // Default: 'gclid'
  wbraid?: string;            // Default: 'wbraid'
  gbraid?: string;            // Default: 'gbraid'
  client_ip_address?: 'auto' | null;
  client_user_agent?: 'auto' | null;
}

export interface ClientIdentityConfig {
  id: string;
  client_id: string;
  field_mapping: IdentityFieldMapping;
  enabled_identifiers: IdentifierType[];
  auto_capture_ip: boolean;
  auto_capture_ua: boolean;
  validated_at: string | null;
  identity_score: number | null;   // 0-100 estimate of EMQ contribution
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------
// Signal-Level Enrichment Configuration
// -----------------------------------------------------------

export type CurrencyMode = 'static' | 'dynamic';
export type ContentIdsPathType = 'array' | 'string' | 'nested';

export interface ValueConfig {
  field: string;                    // dataLayer path e.g. 'ecommerce.purchase.actionField.revenue'
  includes_tax: boolean;
  includes_shipping: boolean;
}

export interface CurrencyConfig {
  mode: CurrencyMode;
  field?: string;                   // If mode === 'dynamic', dataLayer path
  static_value?: string;            // If mode === 'static', e.g. 'AED'
}

export interface DedupConfig {
  field: string;                    // dataLayer path e.g. 'ecommerce.purchase.actionField.id'
}

export interface ContentConfig {
  ids_field?: string;               // dataLayer path to product ID array
  ids_path_type: ContentIdsPathType;
  num_items_field?: string;         // dataLayer path or 'auto'
}

export interface SignalEnrichmentConfig {
  id: string;
  deployment_id: string;
  signal_key: string;
  value_config: ValueConfig | null;
  currency_config: CurrencyConfig | null;
  dedup_config: DedupConfig | null;
  content_config: ContentConfig | null;
  enabled_for_meta: boolean;
  enabled_for_google: boolean;
  validated_at: string | null;
  validation_score: number | null;
  validation_warnings: EnrichmentWarning[];
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------
// Validation
// -----------------------------------------------------------

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface EnrichmentWarning {
  field: string;
  message: string;
  severity: WarningSeverity;
}

export interface EnrichmentValidationResult {
  score: number;                    // 0-100
  warnings: EnrichmentWarning[];
  required_missing: string[];
  recommended_missing: string[];
}

// -----------------------------------------------------------
// Enrichment Score (displayed on client dashboard)
// -----------------------------------------------------------

export interface ClientEnrichmentScore {
  overall: number;                  // 0-100
  identity_score: number;           // Contribution of identity config
  signal_scores: Array<{
    signal_key: string;
    signal_name: string;
    score: number;
    warnings: EnrichmentWarning[];
  }>;
  estimated_meta_emq: number;       // 0-10 estimate
  estimated_google_match_rate: number; // 0-100% estimate
}

// -----------------------------------------------------------
// API Request/Response Types
// -----------------------------------------------------------

export interface SaveIdentityConfigRequest {
  client_id: string;
  field_mapping: IdentityFieldMapping;
  enabled_identifiers: IdentifierType[];
  auto_capture_ip: boolean;
  auto_capture_ua: boolean;
}

export interface SaveSignalEnrichmentRequest {
  deployment_id: string;
  signal_key: string;
  value_config: ValueConfig | null;
  currency_config: CurrencyConfig | null;
  dedup_config: DedupConfig | null;
  content_config: ContentConfig | null;
  enabled_for_meta: boolean;
  enabled_for_google: boolean;
}

export interface ValidateFieldPathRequest {
  client_id: string;
  field_path: string;
  sample_event?: Record<string, unknown>;  // Optional: validate against a sample event
}

export interface ValidateFieldPathResponse {
  valid: boolean;
  resolved_value?: unknown;
  error?: string;
}
```

---

## 7. Backend Changes

### 7.1 New Service: `enrichmentConfigService.ts`

**File: `backend/src/services/enrichment/enrichmentConfigService.ts`** (new file)

```typescript
/**
 * EnrichmentConfigService
 *
 * Responsibilities:
 * 1. CRUD for ClientIdentityConfig and SignalEnrichmentConfig
 * 2. Validate field paths against a sample event payload
 * 3. Compute enrichment scores
 * 4. Apply enrichment to a live AtlasEvent (resolving fields from raw event data)
 */

import { createClient } from '@supabase/supabase-js';
import type { AtlasEvent } from '../../types/capi';
import type {
  ClientIdentityConfig,
  SignalEnrichmentConfig,
  EnrichmentValidationResult,
  ClientEnrichmentScore,
  IdentityFieldMapping,
} from '../../types/enrichment';
import { hashValue } from '../capi/hashingService';  // SHA-256 hashing utility

export class EnrichmentConfigService {

  /**
   * Resolve a dotted path like 'ecommerce.purchase.actionField.id'
   * against a raw event data object. Returns the value or undefined.
   */
  resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
    if (path === 'auto') return undefined;  // Handled separately (IP, UA)
    return path.split('.').reduce((acc: unknown, key: string) => {
      if (acc === null || acc === undefined) return undefined;
      if (typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }

  /**
   * Apply identity config to an AtlasEvent, resolving identity fields
   * from the event's raw_data payload.
   *
   * Returns the AtlasEvent with user_data fields populated.
   */
  applyIdentityConfig(
    event: AtlasEvent,
    rawEventData: Record<string, unknown>,
    identityConfig: ClientIdentityConfig,
    requestIp?: string,
    requestUa?: string,
  ): AtlasEvent {
    const mapping = identityConfig.field_mapping;
    const enabled = new Set(identityConfig.enabled_identifiers);

    const userData = { ...event.user_data };

    if (enabled.has('email') && mapping.email) {
      const raw = this.resolveFieldPath(rawEventData, mapping.email);
      if (raw && typeof raw === 'string') userData.email = raw; // Will be hashed by adapter
    }

    if (enabled.has('phone') && mapping.phone) {
      const raw = this.resolveFieldPath(rawEventData, mapping.phone);
      if (raw && typeof raw === 'string') userData.phone = raw;
    }

    if (enabled.has('fn') && mapping.first_name) {
      const raw = this.resolveFieldPath(rawEventData, mapping.first_name);
      if (raw && typeof raw === 'string') userData.first_name = raw;
    }

    if (enabled.has('ln') && mapping.last_name) {
      const raw = this.resolveFieldPath(rawEventData, mapping.last_name);
      if (raw && typeof raw === 'string') userData.last_name = raw;
    }

    if (enabled.has('zp') && mapping.postal_code) {
      const raw = this.resolveFieldPath(rawEventData, mapping.postal_code);
      if (raw && typeof raw === 'string') userData.zip = raw;
    }

    if (enabled.has('country') && mapping.country) {
      const raw = this.resolveFieldPath(rawEventData, mapping.country);
      if (raw && typeof raw === 'string') userData.country = raw;
    }

    if (enabled.has('external_id') && mapping.external_id) {
      const raw = this.resolveFieldPath(rawEventData, mapping.external_id);
      if (raw && typeof raw === 'string') userData.external_id = raw;
    }

    // Click IDs (not hashed)
    if (enabled.has('fbc') && mapping.fbc) {
      const raw = this.resolveFieldPath(rawEventData, mapping.fbc)
                  ?? rawEventData[mapping.fbc];       // Also check flat cookie store
      if (raw && typeof raw === 'string') userData.fbc = raw;
    }

    if (enabled.has('fbp') && mapping.fbp) {
      const raw = this.resolveFieldPath(rawEventData, mapping.fbp)
                  ?? rawEventData[mapping.fbp];
      if (raw && typeof raw === 'string') userData.fbp = raw;
    }

    if (enabled.has('gclid') && mapping.gclid) {
      const raw = this.resolveFieldPath(rawEventData, mapping.gclid)
                  ?? rawEventData[mapping.gclid];
      if (raw && typeof raw === 'string') userData.gclid = raw;
    }

    if (enabled.has('wbraid') && mapping.wbraid) {
      const raw = this.resolveFieldPath(rawEventData, mapping.wbraid);
      if (raw && typeof raw === 'string') userData.wbraid = raw;
    }

    // Auto-capture
    if (identityConfig.auto_capture_ip && requestIp) {
      userData.client_ip_address = requestIp;
    }
    if (identityConfig.auto_capture_ua && requestUa) {
      userData.client_user_agent = requestUa;
    }

    return { ...event, user_data: userData };
  }

  /**
   * Apply signal enrichment config to an AtlasEvent's custom_data.
   */
  applySignalEnrichment(
    event: AtlasEvent,
    rawEventData: Record<string, unknown>,
    enrichmentConfig: SignalEnrichmentConfig,
  ): AtlasEvent {
    const customData = { ...event.custom_data };

    // Value
    if (enrichmentConfig.value_config?.field) {
      let value = this.resolveFieldPath(rawEventData, enrichmentConfig.value_config.field);
      if (typeof value === 'string') value = parseFloat(value);
      if (typeof value === 'number' && !isNaN(value)) {
        customData.value = value;
      }
    }

    // Currency
    if (enrichmentConfig.currency_config) {
      if (enrichmentConfig.currency_config.mode === 'static' && enrichmentConfig.currency_config.static_value) {
        customData.currency = enrichmentConfig.currency_config.static_value;
      } else if (enrichmentConfig.currency_config.mode === 'dynamic' && enrichmentConfig.currency_config.field) {
        const currency = this.resolveFieldPath(rawEventData, enrichmentConfig.currency_config.field);
        if (typeof currency === 'string') customData.currency = currency;
      }
    }

    // Dedup / order_id
    if (enrichmentConfig.dedup_config?.field) {
      const orderId = this.resolveFieldPath(rawEventData, enrichmentConfig.dedup_config.field);
      if (orderId !== undefined) customData.order_id = String(orderId);
    }

    // Content IDs
    if (enrichmentConfig.content_config?.ids_field) {
      const ids = this.resolveFieldPath(rawEventData, enrichmentConfig.content_config.ids_field);
      if (Array.isArray(ids)) {
        customData.content_ids = ids.map(String);
        customData.num_items = ids.length;
      }
    }

    return { ...event, custom_data: customData };
  }

  /**
   * Validate an enrichment config for a given signal.
   * Checks required fields, field path syntax, and produces a score.
   */
  validateSignalEnrichment(
    config: SignalEnrichmentConfig,
    signalPlatformMappings: Record<string, unknown>,
  ): EnrichmentValidationResult {
    const warnings = [];
    const requiredMissing = [];
    const recommendedMissing = [];

    // Value is REQUIRED for conversion signals
    if (!config.value_config?.field) {
      requiredMissing.push('value_field');
      warnings.push({ field: 'value_field', message: 'Order/conversion value field is required for value-based bidding', severity: 'error' });
    }

    // Dedup is REQUIRED
    if (!config.dedup_config?.field) {
      requiredMissing.push('dedup_id_field');
      warnings.push({ field: 'dedup_id_field', message: 'Deduplication ID field is required to prevent double-counting browser and server events', severity: 'error' });
    }

    // Currency
    if (!config.currency_config) {
      requiredMissing.push('currency');
      warnings.push({ field: 'currency', message: 'Currency must be configured (static or dynamic)', severity: 'error' });
    }

    // Content IDs recommended for ecommerce signals
    if (!config.content_config?.ids_field) {
      recommendedMissing.push('content_ids_field');
      warnings.push({ field: 'content_ids_field', message: 'Product ID array field missing — dynamic product retargeting will not work', severity: 'warning' });
    }

    // Score: start at 100, deduct per missing item
    let score = 100;
    score -= requiredMissing.length * 25;
    score -= recommendedMissing.length * 10;
    score = Math.max(0, score);

    return { score, warnings, required_missing: requiredMissing, recommended_missing: recommendedMissing };
  }

  /**
   * Compute overall enrichment score for a client.
   */
  computeClientEnrichmentScore(
    identityConfig: ClientIdentityConfig | null,
    signalEnrichments: SignalEnrichmentConfig[],
  ): ClientEnrichmentScore {
    // Identity score: based on which identifiers are enabled and mapped
    let identityScore = 0;
    if (identityConfig) {
      const enabled = identityConfig.enabled_identifiers;
      const mapping = identityConfig.field_mapping;
      if (enabled.includes('email') && mapping.email) identityScore += 35;
      if (enabled.includes('phone') && mapping.phone) identityScore += 20;
      if (enabled.includes('fbc') && mapping.fbc) identityScore += 15;
      if (enabled.includes('fbp') && mapping.fbp) identityScore += 10;
      if (enabled.includes('gclid') && mapping.gclid) identityScore += 10;
      if (identityConfig.auto_capture_ip) identityScore += 5;
      if (identityConfig.auto_capture_ua) identityScore += 5;
    }

    const signalScores = signalEnrichments.map(e => ({
      signal_key: e.signal_key,
      signal_name: e.signal_key,                   // Resolved from signal library in real implementation
      score: e.validation_score ?? 0,
      warnings: e.validation_warnings,
    }));

    const avgSignalScore = signalScores.length > 0
      ? signalScores.reduce((acc, s) => acc + s.score, 0) / signalScores.length
      : 0;

    const overall = Math.round((identityScore * 0.5) + (avgSignalScore * 0.5));

    // Rough EMQ estimate for Meta (email + phone + fbp + fbc = ~8 EMQ)
    const emqEstimate = identityScore >= 80 ? 8 : identityScore >= 60 ? 6 : identityScore >= 40 ? 4 : 2;

    // Rough Google match rate estimate
    const googleMatchRate = identityScore >= 70 ? 65 : identityScore >= 50 ? 45 : 20;

    return {
      overall,
      identity_score: identityScore,
      signal_scores: signalScores,
      estimated_meta_emq: emqEstimate,
      estimated_google_match_rate: googleMatchRate,
    };
  }
}
```

### 7.2 New Route Handlers

**File: `backend/src/api/routes/enrichment.ts`** (new file)

Add the following endpoints. Mount at `backend/src/api/index.ts` under the `/api` prefix.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/organisations/:orgId/clients/:clientId/identity-config` | Get client identity config |
| `PUT`  | `/api/organisations/:orgId/clients/:clientId/identity-config` | Save/update client identity config |
| `POST` | `/api/organisations/:orgId/clients/:clientId/identity-config/validate` | Validate and score the identity config |
| `GET`  | `/api/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment` | Get all signal enrichment configs for a deployment |
| `PUT`  | `/api/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment/:signalKey` | Save enrichment config for a specific signal |
| `POST` | `/api/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment/:signalKey/validate` | Validate enrichment config for a signal |
| `POST` | `/api/organisations/:orgId/clients/:clientId/validate-field-path` | Validate a dataLayer field path syntax |
| `GET`  | `/api/organisations/:orgId/clients/:clientId/enrichment-score` | Get computed enrichment score for client dashboard |

**Validation endpoint body (`POST .../validate-field-path`):**
```json
{
  "field_path": "ecommerce.purchase.actionField.revenue",
  "sample_event": { "ecommerce": { "purchase": { "actionField": { "revenue": 149.99 } } } }
}
```

**Response:**
```json
{
  "valid": true,
  "resolved_value": 149.99,
  "path_syntax": "valid"
}
```

### 7.3 Modifications to CAPI Event Processing Pipeline

**File: `backend/src/services/capi/capiEventProcessor.ts`** (modify existing)

In the event processing pipeline, after receiving a raw event from the queue, inject the enrichment resolution step:

```typescript
// In processEvent() method, after loading the provider config:

const enrichmentService = new EnrichmentConfigService();

// 1. Resolve identity config for this client
const identityConfig = await loadClientIdentityConfig(providerConfig.project_id);
if (identityConfig) {
  atlasEvent = enrichmentService.applyIdentityConfig(
    atlasEvent,
    rawEventData,
    identityConfig,
    requestContext.ip,
    requestContext.userAgent,
  );
}

// 2. Resolve signal enrichment config for this event's signal key
const signalEnrichment = await loadSignalEnrichmentConfig(
  providerConfig.id,             // deployment_id (via provider config → deployment)
  atlasEvent.event_name,         // signal_key
);
if (signalEnrichment) {
  atlasEvent = enrichmentService.applySignalEnrichment(
    atlasEvent,
    rawEventData,
    signalEnrichment,
  );
}

// 3. Continue to provider adapter (formatEvent + sendEvents)
```

### 7.4 Modifications to GTM Output Generator

**File: `backend/src/services/signals/gtmContainerGenerator.ts`** (modify existing)

When generating a GTM tag for a conversion signal that has enrichment configured, include the identity variable references as GTM variable lookups in the tag's fieldsToSet:

```typescript
// For a Purchase tag with enrichment config:
{
  "type": "html",                         // or appropriate tag type
  "parameter": [
    { "key": "value", "value": "{{dlv - ecommerce.purchase.actionField.revenue}}" },
    { "key": "transaction_id", "value": "{{dlv - ecommerce.purchase.actionField.id}}" },
    { "key": "currency", "value": "{{dlv - ecommerce.currencyCode}}" },
    // Identity variables (for browser-side Enhanced Conversions):
    { "key": "email", "value": "{{dlv - customer.email}}" },
    { "key": "phone_number", "value": "{{dlv - customer.phone}}" }
  ]
}
```

Auto-generate the corresponding GTM dataLayer variable definitions for each mapped field path.

---

## 8. Frontend Changes

### 8.1 New Component: `IdentityConfigStep.tsx`

**File: `frontend/src/components/enrichment/IdentityConfigStep.tsx`** (new)

This component is used in two places:
1. As Step 4 of `ClientSetupWizard.tsx`
2. As a standalone tab on `ClientDetailPage.tsx`

**Props:**
```typescript
interface IdentityConfigStepProps {
  clientId: string;
  initialConfig: ClientIdentityConfig | null;
  onSave: (config: SaveIdentityConfigRequest) => Promise<void>;
  onSkip?: () => void;   // Only in wizard context
  mode: 'wizard' | 'standalone';
}
```

**UI Layout:**

```
┌──────────────────────────────────────────────────────────────────┐
│  Identity & Match Quality Configuration                          │
│  These settings control how Atlas matches conversions to         │
│  real people in Google and Meta — the #1 driver of value-       │
│  optimised campaign performance.                                 │
├──────────────────────────────────────────────────────────────────┤
│  REQUIRED — Email                                    [Enabled ●] │
│  dataLayer path to customer email address                        │
│  ┌────────────────────────────────────────┐                      │
│  │ customer.email                          │  [Validate]         │
│  └────────────────────────────────────────┘                      │
│  ✓ Valid — resolves to a string field                            │
│                                                                  │
│  HIGH IMPACT — Phone                                 [Enabled ●] │
│  dataLayer path to customer phone number                         │
│  ┌────────────────────────────────────────┐                      │
│  │ customer.phone                          │  [Validate]         │
│  └────────────────────────────────────────┘                      │
│                                                                  │
│  HIGH IMPACT — Facebook Click ID (fbc)               [Enabled ●] │
│  Cookie name or dataLayer path for Meta ad click ID             │
│  ┌────────────────────────────────────────┐                      │
│  │ _fbc                                    │                     │
│  └────────────────────────────────────────┘                      │
│  ℹ Default is '_fbc' (Meta's standard cookie name)              │
│                                                                  │
│  HIGH IMPACT — Facebook Browser ID (fbp)             [Enabled ●] │
│  ... (same pattern)                                              │
│                                                                  │
│  HIGH IMPACT — Google Click ID (gclid)               [Enabled ●] │
│  ...                                                             │
│                                                                  │
│  BEST PRACTICE — First Name, Last Name, Postal, Country         │
│  [+ Expand address fields]                                       │
│                                                                  │
│  BEST PRACTICE — Customer / External ID              [Disabled ○]│
│  ...                                                             │
│                                                                  │
│  Auto-capture Settings                                           │
│  ☑ Automatically capture client IP address from request          │
│  ☑ Automatically capture browser user agent from request         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Estimated Match Quality                                         │
│                                                                  │
│  Meta EMQ estimate:    ████████░░  8/10                         │
│  Google match rate:    ██████████  ~65%                          │
│                                                                  │
│  Based on: email ✓  phone ✓  fbc ✓  fbp ✓  gclid ✓             │
├──────────────────────────────────────────────────────────────────┤
│                         [Skip for now]     [Save & Continue →]  │
└──────────────────────────────────────────────────────────────────┘
```

**Behaviour:**
- Each field has a toggle (enabled/disabled) and a text input for the field path
- "Validate" button calls `POST .../validate-field-path` with a sample event if available
- Estimated Match Quality section updates in real-time as fields are toggled
- Pre-populated defaults for fbc (`_fbc`), fbp (`_fbp`), gclid (`gclid`)
- Fields grouped by priority tier (REQUIRED / HIGH IMPACT / BEST PRACTICE) matching the checklist

### 8.2 New Component: `SignalEnrichmentStep.tsx`

**File: `frontend/src/components/enrichment/SignalEnrichmentStep.tsx`** (new)

This component appears as Step 4 of `DeploymentWizard.tsx`. It shows one tab per conversion signal in the deployment, each with its enrichment configuration.

**Props:**
```typescript
interface SignalEnrichmentStepProps {
  deploymentId: string;
  conversionSignals: Array<{
    signal_key: string;
    signal_name: string;
    platform_mappings: Record<string, unknown>;
    current_config: SignalEnrichmentConfig | null;
  }>;
  onSave: (configs: SaveSignalEnrichmentRequest[]) => Promise<void>;
  onBack: () => void;
  onSkip: () => void;
}
```

**UI Layout (per signal tab):**

```
┌──────────────────────────────────────────────────────────────────┐
│  [Purchase] [Begin Checkout] [Generate Lead]                     │
│                                                                  │
│  Purchase — Signal Enrichment                      Score: 85/100 │
├──────────────────────────────────────────────────────────────────┤
│  VALUE CONFIGURATION                                             │
│                                                                  │
│  Order value field path                             [REQUIRED]   │
│  ┌────────────────────────────────────────────────┐              │
│  │ ecommerce.purchase.actionField.revenue          │ [Validate]  │
│  └────────────────────────────────────────────────┘              │
│  Common paths: ecommerce.value · ecommerce.purchase.revenue      │
│                                                                  │
│  ☐ Value includes tax (uncheck to exclude)                       │
│  ☐ Value includes shipping (uncheck to exclude)                  │
│                                                                  │
│  Currency                                           [REQUIRED]   │
│  ○ Static value:  [AED ▾]                                        │
│  ● Dynamic from dataLayer: [ecommerce.currencyCode]  [Validate]  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  DEDUPLICATION                                                   │
│                                                                  │
│  Unique order ID field                              [REQUIRED]   │
│  ┌────────────────────────────────────────────────┐              │
│  │ ecommerce.purchase.actionField.id               │ [Validate]  │
│  └────────────────────────────────────────────────┘              │
│  ⚠ This ID must be the same in both browser and server events.  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  PRODUCT DATA (for dynamic retargeting)                          │
│                                                                  │
│  Product IDs field                                  [HIGH IMPACT]│
│  ┌────────────────────────────────────────────────┐              │
│  │ ecommerce.purchase.products                     │ [Validate]  │
│  └────────────────────────────────────────────────┘              │
│  Path type: ● Array of objects  ○ Array of strings  ○ Nested    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  PLATFORM ENABLEMENT                                             │
│  ☑ Send enriched signal to Meta CAPI                             │
│  ☑ Send enriched signal to Google Enhanced Conversions           │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                [← Back]  [Skip enrichment]  [Save & Generate →] │
└──────────────────────────────────────────────────────────────────┘
```

**Behaviour:**
- Only shows conversion signals (category === 'conversion') — engagement signals don't need value enrichment
- If a signal has no conversion value (e.g., purely engagement), show a simplified view with dedup only
- Score badge in tab header updates as fields are filled in
- Common paths shown as clickable suggestions below each input
- "Validate" calls `POST .../validate-field-path` to check syntax
- Saving is per-signal and debounced (auto-save on blur)

### 8.3 New Component: `FieldMappingRow.tsx`

**File: `frontend/src/components/enrichment/FieldMappingRow.tsx`** (new)

Reusable row used in both `IdentityConfigStep` and `SignalEnrichmentStep`:

```typescript
interface FieldMappingRowProps {
  label: string;
  description?: string;
  priority: 'must' | 'recommended' | 'best';
  value: string;
  onChange: (value: string) => void;
  enabled: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  showToggle?: boolean;
  onValidate?: (path: string) => Promise<ValidateFieldPathResponse>;
  suggestions?: string[];           // Common paths shown as chips below input
  placeholder?: string;
  defaultValue?: string;
  validationState?: 'idle' | 'validating' | 'valid' | 'error';
  validationMessage?: string;
}
```

### 8.4 New Component: `EnrichmentScoreBadge.tsx`

**File: `frontend/src/components/enrichment/EnrichmentScoreBadge.tsx`** (new)

Displays the enrichment score on the client dashboard. Shows:
- Overall score 0-100
- Estimated Meta EMQ (0-10)
- Estimated Google match rate (%)
- Quick link to the enrichment configuration

### 8.5 Modifications to `DeploymentWizard.tsx`

**File: `frontend/src/components/signals/DeploymentWizard.tsx`** (modify existing)

**Current steps:**
1. Select Signal Pack
2. Configure Client Pages
3. Assign Signals to Pages
4. Generate Outputs

**New steps:**
1. Select Signal Pack
2. Configure Client Pages
3. Assign Signals to Pages
4. **Signal Enrichment** ← INSERT HERE
5. Generate Outputs

**Step 4 is skippable** — a "Skip for now" button allows the user to bypass enrichment and generate basic outputs. If skipped, the client dashboard shows an enrichment warning: "Your conversion signals are missing value and identity configuration — add them to enable value-optimised bidding."

Insert `SignalEnrichmentStep` as a new wizard step. Pass it the conversion signals from the deployed pack and the deployment ID (created at the end of Step 3 when the user confirms the assignment).

### 8.6 Modifications to `ClientSetupWizard.tsx`

**File: `frontend/src/components/organisation/ClientSetupWizard.tsx`** (modify existing)

**Current steps:**
1. Client Name & URL
2. Business Type & Platform Detection
3. Platform IDs (GA4, Meta Pixel, Google Ads conversion ID)
4. Add Pages
5. Deploy Packs

**New steps:**
1. Client Name & URL
2. Business Type & Platform Detection
3. Platform IDs
4. **Identity Configuration** ← INSERT HERE (calls `IdentityConfigStep` in wizard mode)
5. Add Pages
6. Deploy Packs

### 8.7 Modifications to `ClientDetailPage.tsx`

**File: `frontend/src/pages/ClientDetailPage.tsx`** (modify existing)

Add an **"Enrichment"** tab to the client detail tabs (alongside Overview, Outputs, Audits):

```
[Overview] [Outputs] [Enrichment] [Audits]
```

The Enrichment tab shows:
1. `EnrichmentScoreBadge` at top (overall score, Meta EMQ estimate, Google match rate estimate)
2. **Identity Configuration** section with `IdentityConfigStep` in standalone mode
3. **Signal Enrichment** section — one card per deployed conversion signal, each showing current config and warnings
4. CTA: "Re-generate outputs with enrichment" if enrichment config has been updated since last output generation

### 8.8 New Zustand Store: `enrichmentStore.ts`

**File: `frontend/src/store/enrichmentStore.ts`** (new)

```typescript
interface EnrichmentState {
  identityConfigs: Record<string, ClientIdentityConfig>;   // keyed by client_id
  signalEnrichments: Record<string, SignalEnrichmentConfig[]>; // keyed by deployment_id
  enrichmentScores: Record<string, ClientEnrichmentScore>;  // keyed by client_id

  loadIdentityConfig: (clientId: string) => Promise<void>;
  saveIdentityConfig: (clientId: string, config: SaveIdentityConfigRequest) => Promise<void>;
  loadSignalEnrichments: (deploymentId: string) => Promise<void>;
  saveSignalEnrichment: (req: SaveSignalEnrichmentRequest) => Promise<void>;
  loadEnrichmentScore: (clientId: string) => Promise<void>;
  validateFieldPath: (clientId: string, path: string, sampleEvent?: Record<string, unknown>) => Promise<ValidateFieldPathResponse>;
}
```

---

## 9. GTM Output Changes

When enrichment config exists for a deployed signal, the GTM container output must include:

1. **DataLayer variable definitions** for each mapped field path:
   ```json
   {
     "type": "DATA_LAYER_VARIABLE",
     "name": "dlv - customer.email",
     "parameter": [{ "key": "name", "value": "customer.email" }]
   }
   ```

2. **Updated tag configurations** that reference these variables for value, currency, order ID, and identity fields.

3. **An implementation note in the dataLayer spec** explaining that Atlas handles server-side hashing, so the browser implementation should pass raw (unhashed) values.

**File: `backend/src/services/signals/gtmContainerGenerator.ts`** — add `generateIdentityVariables(identityConfig)` and `generateEnrichedTagConfig(signal, enrichmentConfig)` helper methods.

---

## 10. Validation Rules

The following validation rules govern enrichment config quality. These are checked on save and surfaced as warnings in the `EnrichmentScoreBadge` and signal enrichment tabs.

| Rule | Severity | Condition |
|------|----------|-----------|
| `MISSING_VALUE_FIELD` | Error | Conversion signal has no value_field configured |
| `MISSING_DEDUP_FIELD` | Error | Conversion signal has no dedup_id_field configured |
| `MISSING_CURRENCY` | Error | No currency config (neither static nor dynamic) |
| `MISSING_EMAIL` | Warning | Email field not configured or disabled |
| `MISSING_FBP_FBC` | Warning | Both fbp and fbc disabled for Meta-enabled signal |
| `MISSING_GCLID` | Warning | gclid disabled for Google-enabled signal |
| `INVALID_FIELD_PATH` | Error | Field path contains invalid characters or syntax |
| `VALUE_INCLUDES_TAX` | Info | Value config has `includes_tax: true` — may inflate ROAS |
| `VALUE_INCLUDES_SHIPPING` | Info | Value config has `includes_shipping: true` — may inflate ROAS |
| `MISSING_CONTENT_IDS` | Warning | No content_ids_field for ecommerce signal — dynamic retargeting unavailable |
| `STATIC_CURRENCY_MULTI_MARKET` | Warning | Static currency set but client has multiple market URLs detected |
| `ENRICHMENT_NOT_CONFIGURED` | Warning | Conversion signal deployed but no enrichment config saved at all |

---

## 11. Common dataLayer Path Reference

Include this as in-app help copy adjacent to each field path input. Shown as collapsible "Common paths" under each input in `FieldMappingRow`.

**Shopify (dataLayer via pixel / theme):**
```
Order value:    ecommerce.purchase.actionField.revenue
                checkout.totalPrice
Order ID:       ecommerce.purchase.actionField.id
                checkout.orderId
Currency:       ecommerce.currencyCode
Product IDs:    ecommerce.purchase.products     (array of objects with .id)
Customer email: customer.email
Customer phone: customer.phone
Customer ID:    customer.id
```

**WooCommerce:**
```
Order value:    ecommerce.purchase.actionField.revenue
Order ID:       ecommerce.purchase.actionField.id
Currency:       ecommerce.currencyCode
Customer email: wpCustomer.email
```

**GA4 ecommerce (standard schema):**
```
Order value:    ecommerce.value
Order ID:       ecommerce.transaction_id
Currency:       ecommerce.currency
Product IDs:    ecommerce.items              (array, use 'item_id' key)
```

**Meta cookies (standard names):**
```
fbp:   _fbp
fbc:   _fbc
```

---

## 12. Implementation Sequence

### Sprint 1 (Days 1–4): Data Layer & Backend

| Task | File | Estimate |
|------|------|----------|
| DB migration: `signal_enrichment_configs` table | `db/migrations/20260603_001_signal_enrichment_configs.sql` | 2h |
| DB migration: `client_identity_configs` table | `db/migrations/20260603_002_client_identity_configs.sql` | 2h |
| DB patch: update purchase/generate_lead/begin_checkout signal platform_mappings to include identity_fields | `db/migrations/20260603_003_patch_signal_platform_mappings.sql` | 1h |
| New type file: `enrichment.ts` | `frontend/src/types/enrichment.ts` | 2h |
| New service: `enrichmentConfigService.ts` with `resolveFieldPath`, `applyIdentityConfig`, `applySignalEnrichment`, `validateSignalEnrichment`, `computeClientEnrichmentScore` | `backend/src/services/enrichment/enrichmentConfigService.ts` | 6h |
| New routes: enrichment CRUD + validate-field-path + enrichment-score | `backend/src/api/routes/enrichment.ts` | 5h |
| Mount enrichment routes in `backend/src/api/index.ts` | `backend/src/api/index.ts` | 0.5h |
| Unit tests for `resolveFieldPath` and `applyIdentityConfig` | `backend/src/services/enrichment/__tests__/enrichmentConfigService.test.ts` | 3h |

### Sprint 2 (Days 5–9): Core Frontend Components

| Task | File | Estimate |
|------|------|----------|
| `FieldMappingRow.tsx` — reusable field mapping row with toggle, input, validate button, suggestions | `frontend/src/components/enrichment/FieldMappingRow.tsx` | 4h |
| `EnrichmentScoreBadge.tsx` — score display with Meta EMQ and Google match rate estimates | `frontend/src/components/enrichment/EnrichmentScoreBadge.tsx` | 3h |
| `IdentityConfigStep.tsx` — full identity config UI with priority tiers and live score preview | `frontend/src/components/enrichment/IdentityConfigStep.tsx` | 8h |
| `SignalEnrichmentStep.tsx` — tabbed signal enrichment with value/currency/dedup/content config | `frontend/src/components/enrichment/SignalEnrichmentStep.tsx` | 10h |
| `enrichmentStore.ts` — Zustand store for all enrichment state | `frontend/src/store/enrichmentStore.ts` | 3h |

### Sprint 3 (Days 10–13): Wizard Integration

| Task | File | Estimate |
|------|------|----------|
| Modify `DeploymentWizard.tsx` to insert `SignalEnrichmentStep` as Step 4 | `frontend/src/components/signals/DeploymentWizard.tsx` | 4h |
| Modify `ClientSetupWizard.tsx` to insert `IdentityConfigStep` as Step 4 | `frontend/src/components/organisation/ClientSetupWizard.tsx` | 3h |
| Add "Enrichment" tab to `ClientDetailPage.tsx` with identity config + signal cards + score | `frontend/src/pages/ClientDetailPage.tsx` | 5h |
| Add enrichment warning banner on `ClientDetailPage.tsx` when enrichment missing | `frontend/src/pages/ClientDetailPage.tsx` | 2h |

### Sprint 4 (Days 14–16): Pipeline & Output Integration

| Task | File | Estimate |
|------|------|----------|
| Modify `capiEventProcessor.ts` to call enrichment service before sending events | `backend/src/services/capi/capiEventProcessor.ts` | 4h |
| Modify `gtmContainerGenerator.ts` to include identity variables and enriched tag configs | `backend/src/services/signals/gtmContainerGenerator.ts` | 5h |
| Modify WalkerOS output generator to include identity field references | `backend/src/services/signals/walkerosComposableGenerator.ts` | 3h |
| Integration test: full flow from identity config → deploy → CAPI event → verify enriched payload | `backend/src/services/enrichment/__tests__/integration.test.ts` | 4h |
| E2E test: wizard flow — set up client → configure identity → deploy pack → configure enrichment → generate outputs | Manual / Playwright | 2h |

---

## 13. Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Enrichment config completion rate | >70% of new deployments have enrichment configured within 7 days | Track `signal_enrichment_configs` rows with `validation_score > 60` |
| Identity config adoption | >60% of new clients have identity config within first deployment | Track `client_identity_configs` rows created within 7 days of client creation |
| Average enrichment score | >70/100 across all active clients after 30 days | Query `enrichment_score` on `capi_provider_configs` |
| Meta EMQ improvement | Clients with enrichment configured show EMQ ≥6 vs EMQ <4 without | Compare `getEventMatchQuality` results before/after |
| Skip rate on enrichment wizard step | <30% skip the Signal Enrichment step | Track `onSkip` events vs `onSave` events in wizard |
| Re-generate rate after enrichment config | >50% of clients re-generate outputs within 24h of saving enrichment config | Track `generate` endpoint calls following enrichment saves |

---

## 14. Out of Scope

- AI-assisted field discovery ("detect that `customer.email` exists by scanning a live dataLayer push") — future feature
- Consent-gated identity sending (covered in `consent.ts` separately — enrichment config is applied after consent check)
- TikTok, LinkedIn, Snapchat identity enrichment
- Identity store / CSV upload (separate BSE PRD)
- Real-time enrichment health monitoring (Phase 3 WalkerOS destination)
- Per-field encryption UI (encryption happens at the database level for `CAPIProviderConfig.credentials` — enrichment field paths are not sensitive)
