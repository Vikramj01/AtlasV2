# Atlas PRD — CRM Outcome Integration (Value-Calibrated Signal Ladder)

**Target path in repo:** `docs/prd/crm-outcome-integration.md`
**Status:** Sprint 0 complete · Sprint 1 unblocked
**Owner:** Vikram
**Depends on:** `platform_connections` (20260606001), `capi_providers`, `processServerSourcedEvent()` (`pipeline.ts`), DMA `events:ingest` (`googleDelivery.ts`/`googleOfflineUpload.ts`), `journey_stages.proxy_value_gbp`, LinkedIn `conversion_routes`, `refundDelivery.ts` adjustment machinery, DQM alert evaluator

---

## 0. Sprint 0 resolution log (2026-09-19)

**D1 — CRM sequencing.** Confirmed as written: HubSpot first behind the shared `CrmProvider` interface, Salesforce as Sprint 10.

**D2 — Value derivation mode.** Confirmed as written: both `DECLARED` and `DERIVED` ship in v1. `DECLARED` is the default; `DERIVED` is gated behind the §7.3 sample-size floor with `withheld` fallback.

**D3 — Attribution write-back.** Confirmed as written: build it (Sprint 9), off by default, opt-in per client, namespaced properties only.

**D4 — Plan gating.** Confirmed as written: `planGuard('pro')`, consistent with the rest of `/api/connections`.

**Green-field check.** Repo-wide grep (`hubspot`, `salesforce`, `\bcrm\b`) across `backend/src`, `frontend/src`, `supabase/migrations` confirms no collision: every `salesforce` hit is `salesforce_commerce_cloud` (an unrelated ecommerce-platform-detection enum in `commercePlatformDetector.ts`/`CommercePlatform`), every bare `crm` hit is prose ("CRM-driven pipeline", "store it in your CRM") with no existing table, directory, or type. No `hubspot` hits at all. `backend/src/services/crm/`, `crm_sync_configs`, `crm_stage_mappings`, `crm_outcome_events`, `crm_derived_value_snapshots` are genuinely green-field.

**§9.3 ingest-window verification.** This sandbox's network egress proxy blocks direct `WebFetch` to `support.google.com`, `developers.facebook.com`, and `learn.microsoft.com` (same class of restriction the OpenAI Ads sprint hit against `developers.openai.com` — see the Google Stack Alignment sprint history above). The Data Manager Discovery Document itself (`datamanager.googleapis.com/$discovery/rest?version=v1`) *is* reachable and was re-fetched; it documents no event-age constraint on `events:ingest` (the limits below are Google Ads-side policy, not a DMA schema field). The three destination limits below were therefore verified via live web search against current (2026-09, `view=li-lms-2026-08`/`-09` for LinkedIn) indexed copies of each vendor's own docs, not from training data. **Re-verify by direct fetch before this reaches a live client**, per the standing instruction in Key Technical Decision §14/§23 — recorded as such in `ingestWindows.ts`.

| Destination | Window | Source | Verified |
|---|---|---|---|
| Google Ads — standard offline conversion import (click-ID based) | 90 days from last click (GCLID retention) | Google Ads Help, "About offline conversion imports" (`support.google.com/google-ads/answer/2998031`) | 2026-09-19 |
| Google Ads — Enhanced Conversions for Leads (hashed-PII based) | 63 days from last click | Google Ads Help, "About enhanced conversions for leads" (`support.google.com/google-ads/answer/15713840`) | 2026-09-19 |
| Meta Conversions API — offline/server-sourced events | 62 days from `event_time`; older events are accepted (2xx) but silently never attach to attribution — no error surfaced | Meta for Developers, "Sending Offline Events Using the Conversions API" (`developers.facebook.com/documentation/ads-commerce/conversions-api/offline-events`) | 2026-09-19 |
| LinkedIn Conversions API — `conversionHappenedAt` | 90 days | Microsoft Learn, "Conversions API" (`learn.microsoft.com/.../conversions-api?view=li-lms-2026-08`) | 2026-09-19 |

Also confirmed: `linkedinDelivery.ts`'s pinned `LINKEDIN_VERSION = '202608'` is still live (LinkedIn's one-year sunset policy puts its retirement around Aug 2027; `202609` exists as a newer version but no PRD scope requires bumping the pin). Not in this PRD's scope to change — noted only because §9.3 asked to confirm it hadn't silently sunset. Also confirmed via search: Google's June 15 2026 migration of offline conversion import + Enhanced Conversions for Leads onto the Data Manager API (and off the Google Ads API) has already taken effect as of today's date, consistent with this codebase's existing `googleOfflineUpload.ts` already targeting DMA rather than the Google Ads API for ingestion.

Sourced constants land in `backend/src/services/crm/ingestWindows.ts` (added in Sprint 0 so Sprint 5's `outcomeDelivery.ts` consumes an already-verified constant rather than re-deriving it under deadline pressure).

---

## 1. Context and problem

Atlas's delivery side is solved. Enhanced Conversions, DMA offline ingest, Customer Match, CAPI across seven providers, hashing, dedup, delivery confirmation polling — all shipped. What Atlas cannot do today is know **what a lead was worth**.

For ecommerce that gap does not exist: purchase value arrives in the pixel or the Shopify webhook. For B2B it is the whole problem. A demo request has no value at the moment it fires. Its value is only knowable 30 to 180 days later, in HubSpot or Salesforce, when it became an opportunity or closed won or died.

Two consequences, and the second is the one that matters commercially:

**Thin volume breaks platform learning.** Google Smart Bidding needs roughly 30 conversions in 30 days as a floor; PMax does not behave stably below 50 to 100 a week. A B2B advertiser with 12 demo requests a month never gets there.

**Adding volume without calibration makes it worse.** Feeding more low-intent events into the pool teaches the platform to buy more low-intent leads efficiently. The documented failure mode is optimising against form fills that never correlate with pipeline.

The fix is a **value-calibrated signal ladder**: multiple conversion actions across the lead lifecycle, each carrying a value derived from real downstream CRM outcomes, delivered to each platform with correct identity and correct dedup. That requires reading the CRM.

This PRD specifies that integration.

### 1.1 What this unlocks in already-shipped Atlas features

This is deliberately an enabling integration, not a new surface. Existing features that become materially better with CRM outcome data:

| Feature | Today | With CRM outcomes |
|---|---|---|
| Offline Conversions | CSV upload, manual, per-batch | Automatic scheduled sync, no human in the loop |
| LinkedIn `conversion_routes` | `SALES_QUALIFIED_LEAD` route exists but nothing knows which leads are SQLs | Real SQL routing driven by CRM stage |
| Journey Builder `proxy_value_gbp` | Operator-declared estimate | Can be validated against, or derived from, actual stage-to-close rates |
| Campaign Signal Validator | Event-verdict heuristic from scan + declared stages | Can state actual weekly conversion volume vs the learning threshold |
| AIR | Anomalies on channel metrics only | Pipeline/revenue outcome as a correlatable series |
| Bid Signal Enricher | Customer Match from uploaded lists | Audiences segmented by real CRM stage and value |

---

## 2. Non-goals

- **Not a CRM.** Atlas never becomes a system of record. All writes back to the CRM are confined to the optional attribution write-back in §6.4, which is opt-in and off by default.
- **Not marketing automation.** No email sending, no workflow triggering, no list management in the CRM.
- **Not a full CRM data warehouse.** Atlas stores the minimum needed to compute and deliver a conversion: identity join keys, stage, timestamp, value, currency. Not contact records, not notes, not activity history.
- **Not attribution modelling.** Atlas delivers outcome signal to the platforms. What each platform does with it is the platform's model, not Atlas's. Do not build a multi-touch attribution engine here.
- **Not a replacement for the CSV offline upload path.** That stays as the route for clients with no supported CRM, and as the manual fallback.

---

## 3. Open decisions — resolve before Sprint 1

These are product calls, not engineering ones. Sprint 0 is blocked on them.

**D1 · CRM scope and sequencing.** This PRD assumes **HubSpot first, Salesforce second**, behind a shared `CrmProvider` abstraction. Rationale: HubSpot dominates the B2B mid-market that is this ICP, its OAuth and custom-property model are simpler, and its API is stable and well-documented. Salesforce needs sandbox-vs-production handling, package/field-permission complexity, and a different query language. Confirm, or reorder. A third provider (Pipedrive, Zoho, Close) is out of scope entirely for v1.

**D2 · Value derivation mode.** Two modes are specified in §7. `DECLARED` (operator sets a value per stage) is simple and always available. `DERIVED` (Atlas computes stage value from the client's own historical stage-to-close rate × average closed-won value) is honest but needs sample size. Decide whether `DERIVED` ships in v1 or as a fast-follow. Recommendation: build both, default to `DECLARED`, gate `DERIVED` behind the sample-size floor in §7.3 and disclose its confidence — consistent with how this codebase already handles `score_withheld_reason` and `MIN_CONFIRMED_RATIO`.

**D3 · Attribution write-back.** Should Atlas write the computed attribution (source campaign, delivered conversion actions) back onto the CRM record? It is genuinely useful for the client's own reporting and it makes Atlas sticky. It also makes Atlas a writer to a system of record, which raises support and trust cost. Recommendation: build it, ship it **off by default**, require explicit per-client opt-in, and confine writes to Atlas-namespaced custom properties only (§6.4).

**D4 · Plan gating.** Which plan tier gets CRM sync — `pro` or `agency`? Every existing connection route uses `planGuard('pro')`. Recommendation: `pro`, consistent with the rest of `/api/connections`.

---

## 4. Architecture

### 4.1 Placement

New service directory `backend/src/services/crm/`, following the shape of `services/air/ingestion/` (per-source connector, shared utils, one orchestrator) rather than `services/capi/` (per-provider delivery).

```
backend/src/services/crm/
├── providers/
│   ├── hubspotClient.ts        # HubSpot CRM API v3 client
│   ├── salesforceClient.ts     # Phase 2
│   └── types.ts                # CrmProvider interface — the abstraction both implement
├── crmSyncOrchestrator.ts      # per-org run: fetch → map → value → enqueue delivery
├── objectMapper.ts             # CRM object/stage → Atlas event name
├── valueLadder.ts              # stage → conversion value resolution (DECLARED | DERIVED)
├── identityResolver.ts         # click ID / hashed-email join, the hard part (§6)
├── outcomeDelivery.ts          # routes a resolved outcome into the CAPI pipeline
├── derivedValueCalculator.ts   # historical stage-to-close computation
└── __tests__/
```

New OAuth flow at `backend/src/services/connections/oauthFlows/hubspotOAuth.ts`, following `googleAdsOAuth.ts`.

New route `backend/src/api/routes/crm.ts`, mounted at `/api/crm`.

### 4.2 The `CrmProvider` interface

Both providers implement one interface so the orchestrator is provider-agnostic. Define in `providers/types.ts`:

```ts
export interface CrmProvider {
  readonly name: CrmProviderName;              // 'hubspot' | 'salesforce'

  /** Verify credentials and return the account identity for display. */
  testConnection(tokens: DecryptedTokens): Promise<CrmAccountInfo>;

  /** List pipelines and their stages, for the mapping UI. */
  listPipelines(tokens: DecryptedTokens): Promise<CrmPipeline[]>;

  /** List custom properties on a given object, for readiness checking (§6.2). */
  listProperties(tokens: DecryptedTokens, object: CrmObjectType): Promise<CrmProperty[]>;

  /**
   * Fetch records whose stage changed within [since, until].
   * MUST paginate internally and MUST be driven by a modified-since
   * filter, never a full table scan.
   */
  fetchChangedRecords(
    tokens: DecryptedTokens,
    object: CrmObjectType,
    since: Date,
    until: Date,
    propertyNames: string[],
  ): AsyncIterable<CrmRecord>;

  /** Optional attribution write-back (D3). Namespaced properties only. */
  writeAttribution?(
    tokens: DecryptedTokens,
    object: CrmObjectType,
    recordId: string,
    properties: Record<string, string>,
  ): Promise<void>;
}
```

`CrmObjectType` is `'contact' | 'deal'` for v1. HubSpot tickets and Salesforce cases are out of scope.

### 4.3 Data flow

```
                         crmSyncQueue (Bull, scheduled per org)
                                      │
                    crmSyncOrchestrator.runSync(orgId, clientId)
                                      │
             ┌────────────────────────┼────────────────────────┐
             ▼                        ▼                        ▼
   provider.fetchChangedRecords   objectMapper          identityResolver
   (since = last_synced_at)    (stage → event name)   (click ID | hashed email)
             │                        │                        │
             └────────────────────────┼────────────────────────┘
                                      ▼
                              valueLadder.resolve()
                          (DECLARED or DERIVED value + currency)
                                      │
                                      ▼
                           crm_outcome_events (persisted)
                                      │
                                      ▼
                        outcomeDelivery.deliver()
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
  processServerSourcedEvent()   googleOfflineUpload          LinkedIn conversion_routes
  (live CAPI path, Meta/       (DMA events:ingest,          (SALES_QUALIFIED_LEAD —
   TikTok/Microsoft/OpenAI)     Google Ads + GA4)            already built, now fed)
```

Every delivery goes through an **existing** shipped path. This PRD adds no new delivery service.

### 4.4 Why `processServerSourcedEvent()`

A CRM stage change has no live browser session from which a real consent decision could have been captured. This is the exact condition Key Technical Decision §15 carved the `processServerSourcedEvent()` exception for, and the same one Shopify order/refund webhooks use. Use it. Do **not** default `consent_state` to `'granted'` anywhere in the live-browser pipeline.

Consent basis for the original lead is handled in §8.

---

## 5. Schema

One migration: `supabase/migrations/20260919001_crm_integration.sql`.

Naming follows Key Technical Decision §21 — `YYYYMMDDNNN_name.sql`, **no underscore after the date**. Do not use `20260919_001_...`.

RLS required on every new table. Use `organization_id` (not `org_id`) for consistency with `platform_connections` and `offline_conversion_configs`, both of which this feature sits alongside.

### 5.1 `platform_connections.platform` widened

```sql
ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('google_ads','meta','ga4','gtm_destinations','linkedin',
                      'shopify','klaviyo','hubspot','salesforce'));
```

Wrap in the `DO $$ IF EXISTS (SELECT FROM pg_tables ...)` guard per Implementation Rule 9.

The CRM connection reuses `platform_connections` wholesale — AES-256-GCM encrypted `oauth_tokens`, `status`, `last_synced_at`, `metadata`, `client_id`. Do not create a parallel `crm_connections` table.

### 5.2 `crm_sync_configs`

One per client. Holds mapping and behaviour.

```sql
CREATE TABLE IF NOT EXISTS crm_sync_configs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id           UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,

  provider                TEXT NOT NULL CHECK (provider IN ('hubspot','salesforce')),

  -- Which pipeline's stages drive the ladder. NULL = the provider's default pipeline.
  pipeline_id             TEXT,
  tracked_object          TEXT NOT NULL DEFAULT 'deal' CHECK (tracked_object IN ('contact','deal')),

  -- Identity join: names of the CRM properties holding Atlas-captured click IDs.
  -- Defaults match the property names the readiness check provisions (§6.2).
  identity_property_map   JSONB NOT NULL DEFAULT '{}',

  value_mode              TEXT NOT NULL DEFAULT 'DECLARED'
                          CHECK (value_mode IN ('DECLARED','DERIVED')),
  default_currency        TEXT NOT NULL DEFAULT 'USD' CHECK (char_length(default_currency) = 3),

  -- How far back the first sync reaches. Bounded by platform ingest windows (§9.3).
  backfill_days           INTEGER NOT NULL DEFAULT 30 CHECK (backfill_days BETWEEN 0 AND 90),

  sync_enabled            BOOLEAN NOT NULL DEFAULT false,
  sync_interval_minutes   INTEGER NOT NULL DEFAULT 360 CHECK (sync_interval_minutes >= 60),
  write_back_enabled      BOOLEAN NOT NULL DEFAULT false,   -- D3, opt-in

  last_synced_at          TIMESTAMPTZ,
  last_sync_status        TEXT CHECK (last_sync_status IN ('ok','partial','failed')),
  last_sync_error         TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);
```

### 5.3 `crm_stage_mappings`

The ladder itself. One row per CRM stage that should produce a conversion.

```sql
CREATE TABLE IF NOT EXISTS crm_stage_mappings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id               UUID NOT NULL REFERENCES crm_sync_configs(id) ON DELETE CASCADE,

  crm_stage_id            TEXT NOT NULL,          -- provider's stage identifier
  crm_stage_label         TEXT NOT NULL DEFAULT '',
  stage_order             INTEGER NOT NULL,        -- ladder position, ascending

  atlas_event_name        TEXT NOT NULL,           -- e.g. 'crm_mql','crm_sql','crm_closed_won'
  is_terminal_won         BOOLEAN NOT NULL DEFAULT false,
  is_terminal_lost        BOOLEAN NOT NULL DEFAULT false,

  -- DECLARED mode value. NULL in DERIVED mode (computed at delivery time).
  declared_value          DECIMAL(12,2),
  currency                TEXT CHECK (currency IS NULL OR char_length(currency) = 3),

  -- Per-destination conversion identifiers. One conversion action per stage (§9.1).
  google_conversion_action_id  TEXT,
  meta_event_name              TEXT,
  linkedin_conversion_id       TEXT,

  enabled                 BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, crm_stage_id)
);
```

### 5.4 `crm_outcome_events`

The join between a CRM record's stage change and what Atlas delivered. This is the audit trail and the dedup key store.

```sql
CREATE TABLE IF NOT EXISTS crm_outcome_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  config_id               UUID NOT NULL REFERENCES crm_sync_configs(id) ON DELETE CASCADE,
  mapping_id              UUID REFERENCES crm_stage_mappings(id) ON DELETE SET NULL,

  crm_record_id           TEXT NOT NULL,
  crm_object              TEXT NOT NULL CHECK (crm_object IN ('contact','deal')),
  crm_stage_id            TEXT NOT NULL,
  stage_changed_at        TIMESTAMPTZ NOT NULL,

  atlas_event_name        TEXT NOT NULL,
  event_id                TEXT NOT NULL,           -- deterministic, see §9.2

  -- Identity join outcome
  identity_method         TEXT NOT NULL CHECK (identity_method IN
                            ('click_id','hashed_email','hashed_phone','unresolved')),
  identity_key_present    TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {'gclid','email'} — NAMES ONLY
  -- Raw PII is NEVER stored here. Hashes are built at delivery time and discarded.

  conversion_value        DECIMAL(12,2),
  currency                TEXT CHECK (currency IS NULL OR char_length(currency) = 3),
  value_source            TEXT NOT NULL CHECK (value_source IN
                            ('DECLARED','DERIVED','CRM_AMOUNT','NONE')),
  derived_confidence      TEXT CHECK (derived_confidence IN ('high','low','withheld')),

  delivery_status         TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN
                            ('pending','delivered','partial','failed','skipped_unresolved',
                             'skipped_window','dedup_skipped')),
  delivery_detail         JSONB NOT NULL DEFAULT '{}',    -- per-destination outcome
  delivered_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, crm_record_id, crm_stage_id)          -- idempotency, see §9.2
);
```

**PII rule.** `identity_key_present` stores property *names*, never values. Per Implementation Rule 3 and the `offline_conversion_rows` precedent (raw PII nulled post-upload), no raw or hashed email, phone or click ID is persisted on this table. Identity values are fetched from the CRM, used to build hashed identifiers in-process, delivered, and dropped.

### 5.5 `crm_derived_value_snapshots`

Populated by `derivedValueCalculator.ts` when `value_mode = 'DERIVED'`. Recomputed on a schedule, not per event.

```sql
CREATE TABLE IF NOT EXISTS crm_derived_value_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id               UUID NOT NULL REFERENCES crm_sync_configs(id) ON DELETE CASCADE,
  crm_stage_id            TEXT NOT NULL,

  sample_size             INTEGER NOT NULL,        -- records that reached this stage in window
  reached_won_count       INTEGER NOT NULL,
  stage_to_won_rate       DECIMAL(6,5) NOT NULL,
  avg_won_amount          DECIMAL(12,2) NOT NULL,
  currency                TEXT NOT NULL CHECK (char_length(currency) = 3),
  derived_value           DECIMAL(12,2) NOT NULL,  -- rate × avg amount

  confidence              TEXT NOT NULL CHECK (confidence IN ('high','low','withheld')),
  window_start            DATE NOT NULL,
  window_end              DATE NOT NULL,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, crm_stage_id, window_end)
);
```

### 5.6 `health_alerts.alert_type` widened

```sql
ALTER TABLE health_alerts DROP CONSTRAINT IF EXISTS health_alerts_alert_type_check;
ALTER TABLE health_alerts ADD CONSTRAINT health_alerts_alert_type_check
  CHECK (alert_type IN (
    'dqm_gtg','dqm_dma','dqm_sgtm','dqm_google_delivery','dqm_crm_sync', /* + every existing value */
  ));
```

**Do not skip this.** Sprint 8 of the Google Stack Alignment plan found that `dqm_sgtm` had been a live, actively-inserted `AlertType` that was never added to this constraint — every sGTM alert open had been throwing a CHECK violation since the feature shipped, so no client was ever alerted. Read the current constraint from the live schema before writing this migration and enumerate every existing value; do not reconstruct the list from memory.

---

## 6. The identity join

This is the hardest part of the feature and the most likely place for it to silently not work. Treat it as the primary risk.

### 6.1 The problem

A CRM record is a person or a deal. A platform conversion needs a click identifier or a hashed PII match. Nothing in HubSpot or Salesforce carries a `gclid` unless someone put it there. If the click ID was never captured at form submission and written to the CRM record, the outcome cannot be attributed and the whole ladder delivers nothing.

Atlas already generates the capture half. AI Planning Mode's implementation guide covers GCLID/UTM capture and CRM mapping; `gtmContainerGenerator.ts` emits the `Atlas - Click ID Cookie Capture` tag and `URL Query - <clickid>` variables for gclid/fbclid/wbraid/gbraid/ttclid; `client_identity_configs` already has a field per click ID including `oppref_field` and `ttclid_field`. What is missing is the leg from the client's form into the CRM property, and any verification that it happened.

### 6.2 Readiness check — build this first

Before `sync_enabled` can be set true, `POST /api/crm/configs/:id/readiness` must run and return a structured verdict. It calls `provider.listProperties()` and checks for the Atlas identity properties.

Expected property names (Atlas-namespaced, created by the client or by Atlas's setup helper):

| Property | Purpose |
|---|---|
| `atlas_gclid` | Google Ads click ID |
| `atlas_gbraid` / `atlas_wbraid` | Google app/web-to-app click IDs |
| `atlas_fbclid` | Meta click ID |
| `atlas_ttclid` | TikTok click ID |
| `atlas_li_fat_id` | LinkedIn click ID |
| `atlas_msclkid` | Microsoft click ID |
| `atlas_oppref` | OpenAI/ChatGPT Ads reference |
| `atlas_event_id` | The original lead event's `event_id`, for exact dedup |
| `atlas_landing_url` | First-touch landing URL |
| `atlas_first_touch_at` | First-touch timestamp |

The readiness verdict has four levels, and the wording must pass `outputLint.ts`'s banned-word gate if it is ever rendered into a report (Key Technical Decision §18 — absence is never asserted as certainty):

- `READY` — required properties exist and at least one has a non-null value on a sample of recent records.
- `PROPERTIES_PRESENT_NO_DATA` — properties exist but every sampled record has them empty. This is the dangerous state: the CRM looks configured, the capture is not actually wired. Must block `sync_enabled` and say so explicitly.
- `PROPERTIES_ABSENT` — properties do not exist. Offer the setup helper.
- `NOT_OBSERVED` — could not sample (permissions, empty CRM). Not a failure; do not assert absence.

The sample check is the point of this. A properties-exist check alone would have passed every one of the failure modes this is designed to catch.

### 6.3 Resolution order

`identityResolver.ts` resolves in this order and records which method won on `crm_outcome_events.identity_method`:

1. **Click ID** — the strongest match. Pick the click ID matching the destination platform. Do not send a gclid to Meta.
2. **`atlas_event_id`** — if present, join directly to the original `capi_events` row. This is the cleanest dedup path and should be preferred over hashed PII when available.
3. **Hashed email** — Enhanced Conversions for Leads (Google) / `user_data.em` (Meta). Weaker, but the realistic fallback for B2B where the form fill and the CRM record may be days apart.
4. **Hashed phone** — last resort.
5. **`unresolved`** — persist the row with `delivery_status = 'skipped_unresolved'`. **Never fabricate an identifier, never fall back to a synthetic ID.** An unresolved outcome is data about the client's instrumentation gap and should surface as such, not silently vanish.

The unresolved rate is a first-class metric. Surface it (§10). If a client's unresolved rate is above 30%, the ladder is not working and the report should say which identity property is empty, not just that the number is bad.

### 6.4 Optional write-back (D3)

If `write_back_enabled`, after successful delivery write back to Atlas-namespaced properties only:

- `atlas_attributed_source` — the platform that got credit
- `atlas_attributed_campaign` — campaign name where resolvable
- `atlas_conversions_delivered` — comma-separated Atlas event names delivered for this record
- `atlas_last_delivered_at`

Never write to a property Atlas did not create. Never write to a standard CRM field. Any write failure is logged and non-fatal — it must never fail the delivery that already succeeded.

---

## 7. The value ladder

### 7.1 `DECLARED` mode

Operator sets `crm_stage_mappings.declared_value` per stage. Simple, always available, honest about being an estimate.

Seed the defaults from `journey_stages.proxy_value_gbp` where a journey exists for the client — that field already holds exactly this concept and there is no reason to make the operator enter it twice. Note the currency mismatch: the column is named `_gbp` but clients are UAE and SEA. Read it as a number in the client's `default_currency` and flag the naming in a code comment; do not rename the column in this PRD's migration.

### 7.2 `CRM_AMOUNT` — terminal won stages

When a stage is `is_terminal_won` and the CRM record carries a real deal amount, use it. This is the only genuinely observed value in the whole ladder. Record `value_source = 'CRM_AMOUNT'`.

Currency comes from the CRM record's own currency field where the provider exposes one, falling back to `default_currency`. Do **not** convert currencies. Deliver the amount in its own currency and let the platform handle it. A conversion-rate layer is a source of silent error and there is no requirement for one.

### 7.3 `DERIVED` mode

For a non-terminal stage, compute:

```
derived_value(stage) = stage_to_won_rate(stage) × avg_won_amount
```

over a trailing window (default 180 days, configurable), computed by `derivedValueCalculator.ts` on a weekly schedule into `crm_derived_value_snapshots`.

**Sample-size gating.** This is where the feature earns or loses trust.

- `sample_size >= 50` and `reached_won_count >= 10` → `confidence = 'high'`, value used.
- `sample_size >= 20` → `confidence = 'low'`, value used but disclosed as low-confidence in UI and reporting.
- Below that → `confidence = 'withheld'`, **fall back to the `DECLARED` value** for that stage. Do not deliver a value computed from six deals.

This mirrors the `MIN_CONFIRMED_RATIO` / `score_withheld_reason` pattern already established in Check Register v2 scoring: an under-evidenced figure is withheld, not averaged down into something that looks authoritative.

**Cold start.** A brand-new client has no history. `DERIVED` must degrade to `DECLARED` cleanly and the UI must say why, rather than showing zeros.

### 7.4 Lost deals

When a record reaches an `is_terminal_lost` stage, the value previously delivered for its earlier stages is now known to be wrong. Handle it with the machinery already built for refunds:

- **Google:** `submitGoogleConversionAdjustment()` (`refundDelivery.ts`) with `RETRACTION`. That function already exists and already handles the Google Ads REST adjustment path, which Sprint 8 confirmed is unaffected by either 2026 migration wave.
- **Meta:** no reversal API exists. Follow the precedent set by `sendMetaRefundSignal()` — dispatch a forward-looking custom event (`atlas_deal_lost`), logged, never claimed as a reversal.
- **LinkedIn / others:** logged only.

Do not invent a reversal mechanism where the platform has none. Record what was and was not possible in `delivery_detail`.

---

## 8. Consent and PII

**Consent basis.** A B2B lead who submitted a form has a lawful basis distinct from a browsing visitor. But Atlas must not assume it. `crm_sync_configs` gains no consent override field. Instead:

- Delivery goes through `processServerSourcedEvent()`, the documented exception for events with no live browser session (Key Technical Decision §15).
- If the original lead event exists in `capi_events` (resolvable via `atlas_event_id`), inherit its recorded `consent_state`. A lead that was `consent_blocked` at capture stays blocked at outcome — do not launder a blocked event through the CRM path.
- If no original event is resolvable, the outcome is delivered as server-sourced. Document this in the module header as a deliberate decision with its reasoning, the way `pipeline.ts` documents the Shopify path.

**PII handling.** Non-negotiable, per Implementation Rules 3 and 5:

- Queue payloads carry IDs only — `config_id`, `crm_outcome_event_id`. Never a record's email.
- `crm_outcome_events` stores property *names*, never values.
- Identity values are fetched, hashed in-process by the existing `buildHashedIdentifiers()`, delivered, and dropped.
- Never log a decrypted token or a raw identifier.

**GDPR/PDPA deletion.** When a CRM record is deleted, Atlas holds no PII for it, only a `crm_record_id` string and stage metadata. Document that this is the reason no deletion webhook handling is needed, so a future reader does not think it was overlooked.

---

## 9. Delivery, dedup, and windows

### 9.1 One conversion action per stage

Each ladder stage maps to its own conversion action (`google_conversion_action_id`), its own Meta event name, its own LinkedIn conversion ID. Do **not** restate a single conversion action's value as the deal progresses.

Reasoning: separate actions let the client see stage-level performance in the platform UI, let them choose which actions are primary for bidding, and avoid the restatement ambiguity that Google's adjustment API handles poorly for non-purchase conversions. It also means a client can start by bidding on `crm_mql` (high volume, low value) and move to `crm_sql` as volume grows — which is the whole point of the ladder.

### 9.2 Idempotency and dedup

`event_id` is deterministic, not random:

```ts
event_id = sha256(`${config_id}:${crm_record_id}:${crm_stage_id}`).slice(0, 32)
```

Combined with `UNIQUE(config_id, crm_record_id, crm_stage_id)` on `crm_outcome_events`, this makes a re-run of an overlapping sync window a no-op rather than a double count. The existing `dedupStore.ts` window check catches anything that gets past it.

**A record moving backwards** (deal regressed from SQL to MQL) must not re-fire the earlier stage. The unique constraint handles this: the row already exists.

**A record that skips stages** (straight from new to closed-won) fires only the stage it landed on. Do not backfill intermediate stages it never occupied.

### 9.3 Ingest windows — verify, do not assume

Every destination has a maximum lag between click and conversion import. These limits are the single most likely cause of silently dropped B2B outcomes, because B2B sales cycles routinely exceed them.

**Before implementing, verify each of the following against its live primary source.** Do not take a figure from training data or from this document. This repo has been burned by exactly this: Key Technical Decision §14 (DMA schema drift, found only by fetching the Discovery Document) and §23 (Google Ads REST pinned to two sunset versions, failing silently for 12 to 15 months).

- **Google Data Manager** — verify via `https://datamanager.googleapis.com/$discovery/rest?version=v1` and the current Google Ads offline conversion import documentation.
- **Meta Conversions API** — verify the current offline/`action_source` event age limit against Meta's own docs. Note that `metaOfflineUpload.ts` currently pins Graph `v19.0` and describes the standalone Offline Conversions API; confirm whether that endpoint and version are still live before extending it.
- **LinkedIn Conversions API** — verify against the pinned API version. Note that CLAUDE.md records LinkedIn was bumped 202501 → 202608; confirm the current version is still supported, since LinkedIn sunsets versions annually.

Implement the resolved limit as a per-destination constant with a comment naming the source and the date verified. An outcome older than the window is persisted with `delivery_status = 'skipped_window'` and counted — never silently dropped, and never delivered in the hope it lands.

### 9.4 Rate limits and batching

- HubSpot and Salesforce both rate-limit. `fetchChangedRecords` must handle 429 with exponential backoff and must page rather than requesting large property sets in one call.
- Sync is incremental by `last_synced_at` with a deliberate overlap (default 60 minutes) to tolerate clock skew and late-arriving CRM updates. The idempotency key makes the overlap safe.
- Cap records per run (default 5,000). If the cap is hit, do not advance `last_synced_at` past the last processed record, and enqueue a continuation.

---

## 10. Observability

Reuse the existing DQM alert shape (`dqmAlertEvaluator.ts`, same open/update/resolve semantics as `dqm_gtg` / `dqm_dma` / `dqm_sgtm` / `dqm_google_delivery`). New `AlertType`: `dqm_crm_sync`. One rolled-up alert per org, not one per record.

Alert conditions:

| Condition | Severity |
|---|---|
| Sync failed on consecutive runs | high |
| Unresolved identity rate > 30% over the last 7 days | high |
| Unresolved identity rate 10–30% | medium |
| `skipped_window` rate > 10% | medium |
| Token expired / reconnect needed | high |
| `DERIVED` value withheld for a stage that is bidding-primary | medium |

Surface on the CAPI Monitoring Dashboard as a new `CrmOutcomesTab`, following `RefundsTab`'s shape. Per Implementation Rule 12, do not add a trend chart unless there is a real time-series endpoint behind it — `crm_outcome_events` grouped by day qualifies, so a chart is permissible here, but wire it to the real query.

Feed `getClientSummaries()` so CRM sync health reaches the org Dashboard's `ClientHealthList`. Follow the established convention: **escalate-only, never silently downgrade** an existing findings-based health level.

---

## 11. API surface

Mount at `/api/crm`. All routes `authMiddleware` + `planGuard('pro')` (pending D4). All request bodies Zod-validated (Implementation Rule 5). All responses `{ data, error, message }` (Rule 10).

| Method | Path | Purpose |
|---|---|---|
| GET | `/oauth/hubspot/start` | Begin OAuth, `generateState()` carrying `clientId` |
| GET | `/oauth/hubspot/callback` | Exchange code, discover portal, cache pending creds in Redis under one-time ref — **do not write to DB yet** |
| POST | `/oauth/hubspot/callback/finalize` | Validate ref (403 on org mismatch), persist `platform_connections` row |
| GET | `/configs` | List configs for org |
| POST | `/configs` | Create config for a client |
| PATCH | `/configs/:id` | Update mapping, value mode, schedule |
| POST | `/configs/:id/readiness` | Run the §6.2 readiness check |
| GET | `/configs/:id/pipelines` | List CRM pipelines and stages for the mapping UI |
| PUT | `/configs/:id/stage-mappings` | Replace the ladder |
| POST | `/configs/:id/sync` | Trigger a sync run manually |
| GET | `/configs/:id/outcomes` | Paginated `crm_outcome_events` with filters |
| GET | `/configs/:id/derived-values` | Latest `crm_derived_value_snapshots` |
| DELETE | `/configs/:id` | Remove config (connection removal reuses generic `DELETE /api/connections/:id`) |

The two-phase OAuth callback is not optional. It is the pattern the GTM OAuth Connect UI sprint established after the single-phase version proved to have nothing to pick from — follow it.

---

## 12. Frontend

- `frontend/src/pages/CrmIntegrationPage.tsx` — route `/crm`, sidebar under **Implementation**.
- `frontend/src/components/crm/` — `CrmConnectCard`, `ReadinessPanel`, `StageLadderEditor`, `ValueModeSelector`, `OutcomeEventsTable`, `DerivedValuePanel`.
- `frontend/src/lib/api/crmApi.ts`, `frontend/src/store/crmStore.ts` (Zustand, Rule 11), `frontend/src/types/crm.ts`.

Styling: `console.*` / `severity.*` / `navy.*` tokens and `font-display` / `font-heading` / `font-mono` per Key Technical Decision §13. Grep for `#[0-9A-Fa-f]{3,6}` before styling any file you touch.

Wrap pages in `SectionErrorBoundary` (Rule 6). Skeletons on every async op (Rule 7).

The `StageLadderEditor` is the most important surface. It must show, per stage: CRM stage label, Atlas event name, resolved value with its source badge (`DECLARED` / `DERIVED` / `CRM_AMOUNT`) and confidence, destination conversion IDs, and the count of outcomes delivered in the last 30 days. An operator should be able to see at a glance that the ladder is actually producing volume.

---

## 13. Sprint plan

| Sprint | Scope | Exit criterion |
|---|---|---|
| **0** | Resolve D1–D4. Verify every ingest window and API version in §9.3 against live primary sources; record each with source and date. Confirm by grep that `crm_`, `hubspot`, `salesforce` are genuinely green-field in the code paths this touches. | Decisions recorded; window constants written with sourced comments |
| **1** | Migration `20260919001`. `CrmProvider` interface. `hubspotClient.ts` with `testConnection`/`listPipelines`/`listProperties`. `hubspotOAuth.ts` two-phase flow. `/api/crm` connect + config routes. | Can connect a HubSpot portal and list its pipelines through the API |
| **2** | `identityResolver.ts` + readiness check (§6.2) including the sample-based `PROPERTIES_PRESENT_NO_DATA` state. Frontend `CrmConnectCard` + `ReadinessPanel`. | Readiness check correctly distinguishes all four verdicts against a real portal |
| **3** | `objectMapper.ts`, `valueLadder.ts` (`DECLARED` + `CRM_AMOUNT`), `crm_stage_mappings` CRUD, `StageLadderEditor`. | A ladder can be defined and persisted; values resolve correctly for both modes |
| **4** | `crmSyncOrchestrator.ts`, `crmSyncQueue` in `jobQueue.ts`, worker handler, incremental sync with overlap, rate-limit backoff, pagination, record cap and continuation. | A scheduled sync reads changed records and writes `crm_outcome_events` idempotently |
| **5** | `outcomeDelivery.ts` — route into `processServerSourcedEvent()`, `googleOfflineUpload`, and LinkedIn `conversion_routes`. Window skipping. Deterministic `event_id`. | Outcomes deliver to at least Google and Meta with correct dedup |
| **6** | Lost-deal handling via `submitGoogleConversionAdjustment()` RETRACTION + `atlas_deal_lost` Meta signal. | A closed-lost deal retracts on Google and logs on Meta |
| **7** | `derivedValueCalculator.ts`, `crm_derived_value_snapshots`, weekly schedule, sample-size gating with `withheld` fallback, `DerivedValuePanel`. | Derived values compute and withhold correctly at each sample threshold |
| **8** | `dqm_crm_sync` alert type (including the `health_alerts` CHECK widening), `CrmOutcomesTab`, `getClientSummaries()` integration. | Alerts fire and resolve; CRM health reaches the org Dashboard |
| **9** | Attribution write-back (D3), opt-in, namespaced properties only, non-fatal. | Write-back succeeds when enabled and never fails a successful delivery |
| **10** | Salesforce provider behind the same interface (D1 dependent). | Salesforce reaches parity with HubSpot on Sprints 1–8 |

Sequencing note: Sprint 2 gates everything downstream. If the identity join does not work, nothing else in this PRD produces a single correct conversion. Do not proceed past it on a `PROPERTIES_PRESENT_NO_DATA` verdict.

---

## 14. Acceptance criteria

Each maps to at least one test. Follow the `acceptanceReplay` precedent — replay real data through the actual pipeline stages in the orchestrator's own call order, not through mocks of it.

1. A HubSpot portal connects via the two-phase OAuth flow; credentials are AES-256-GCM encrypted at rest and never logged.
2. The readiness check returns `PROPERTIES_PRESENT_NO_DATA` when identity properties exist but every sampled record has them empty, and blocks `sync_enabled`.
3. A deal moving `new → MQL → SQL → closed-won` produces exactly four `crm_outcome_events` rows, one per mapped stage, no duplicates across overlapping sync windows.
4. Re-running a sync over an already-processed window produces zero new rows and zero new deliveries.
5. A deal that regresses to an earlier stage does not re-fire that stage.
6. A deal that skips stages fires only the stage it reached.
7. An outcome with no resolvable identifier is persisted with `skipped_unresolved` and counted in the unresolved rate, never delivered with a fabricated identifier.
8. An outcome older than the verified destination ingest window is persisted with `skipped_window`, never delivered.
9. A terminal-won stage uses `CRM_AMOUNT` in the CRM record's own currency with no conversion applied.
10. A `DERIVED` stage with `sample_size < 20` falls back to its `DECLARED` value and records `confidence = 'withheld'`.
11. A closed-lost deal submits a Google `RETRACTION` and dispatches the Meta forward-looking signal, with both outcomes recorded in `delivery_detail`.
12. A lead whose original `capi_events` row was `consent_blocked` does not deliver an outcome.
13. No queue payload and no log line contains a raw email, phone, or click ID.
14. `crm_outcome_events` contains no PII values — only property names in `identity_key_present`.
15. A sync failure on consecutive runs opens exactly one `dqm_crm_sync` alert per org, which resolves on the next successful run.
16. Write-back failure does not mark a successful delivery as failed.
17. Rate-limit 429s from the CRM back off and retry without losing records or advancing `last_synced_at` past unprocessed data.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Click ID never reaches the CRM — the whole feature produces nothing | Sprint 2 readiness check with the sample-based no-data state; block `sync_enabled` rather than syncing into a void |
| B2B sales cycles exceed platform ingest windows | Verify windows in Sprint 0; `skipped_window` is counted and surfaced, not hidden. Expect this to be a real limitation for long-cycle clients and say so in the product, not just the logs |
| `DERIVED` values computed from tiny samples look authoritative | Sample-size gating with withheld fallback (§7.3); confidence rendered in UI |
| Meta offline endpoint or Graph version has moved since `metaOfflineUpload.ts` was written | Sprint 0 verification against live docs, per Key Technical Decision §14's standing instruction |
| `health_alerts` CHECK constraint omission repeats the `dqm_sgtm` silent failure | Read the live constraint before writing the migration; add an explicit test that inserting a `dqm_crm_sync` alert succeeds |
| Atlas becomes a de facto CRM writer and inherits support burden | Write-back off by default, namespaced properties only, non-fatal |
| Multi-currency B2B (AED/SGD/USD/GBP) mishandled | Never convert; deliver in the record's own currency. `proxy_value_gbp`'s misleading name is flagged in comments, not renamed |

---

## 16. What this PRD deliberately does not decide

- The commercial packaging of CRM sync (which retainer tier includes it) — that is the service-line decision, not this build.
- Whether the unresolved-identity rate becomes a client-facing report metric. It is captured and surfaced internally; whether it appears in a Signal Observation Report is a separate product call, and would need to pass `outputLint.ts`'s absence-assertion gate.
- Any accuracy figure derived from `DERIVED` value predictions versus actual outcomes. Capture the data; publish nothing from it without the sample-size reasoning being settled first, following the precedent set for `rule_confirmations` (Key Technical Decision §20).
