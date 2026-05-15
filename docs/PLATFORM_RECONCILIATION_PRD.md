# Atlas V2 — Platform Reconciliation & Loop Closure PRD

> **Status:** Draft v1.0
> **Owner:** Vikram (Spi3l LLC)
> **For:** Claude Code implementation
> **Companion docs:** `CLAUDE.md`, `ANDROMEDA_SIGNAL_HEALTH_PRD.md`, Strategy Gate B2B PRDs, GTM Destinations PRD Addendum
> **Phases:** 4 (each phase to be expanded into a sprint plan by Claude Code before implementation)

---

## 1. Executive Summary

Atlas currently validates that signals leave the website correctly and that CAPI delivery succeeds. It does **not** verify whether those signals are accepted, attributed, and acted on by Google Ads, Meta, or GA4. This PRD closes that loop.

Platform Reconciliation introduces a continuous, OAuth-based connection from Atlas into each client's Google Ads, Meta, and GA4 accounts. It pulls platform-side ground truth, compares it against what Atlas knows the signal *should* be (from the Strategy Gate brief and Tag Library), and surfaces four classes of finding:

1. **Delivery verification** — events Atlas sent that the platform did not receive or count
2. **Configuration audit** — conversion actions misconfigured against the locked brief (attribution model, counting type, lookback window, value settings, AEM priority)
3. **Strategic alignment** — live campaigns optimising on conversions that do not match the brief's recommended primary/secondary/suppression tier
4. **Volume reconciliation** — material divergence between Atlas-delivered, platform-received, and GA4-recorded counts

These findings extend the **Andromeda Readiness Score** with a sixth dimension ("Platform Acceptance"), feed the **Health Dashboard** alert feed, and add a new alignment section to the **Strategy Gate** locked brief view.

---

## 2. Problem Statement

Today Atlas can tell an agency: *"Your site is firing the right events, your CAPI is delivering, your consent is configured."* It cannot tell them:

- "Your PMax campaign is still optimising on `view_item`, three weeks after you locked a brief recommending `demo_booked`."
- "Your Demo Booked conversion action in Google Ads is set to attribution model `last_click` and counting `every`, which contradicts the brief's lead-gen guidance."
- "Yesterday Atlas delivered 412 Demo Booked events to Meta CAPI but only 287 appear in Events Manager — 30% drop-off."
- "Your AEM priority list ranks Demo Booked at #11, so iOS web traffic isn't optimising on it at all."

These are the failures that destroy ad spend efficiency and that no current tool surfaces in one place. Closing this loop is the difference between Atlas being *a tagging tool* and *the system of record for paid-media signal integrity*.

---

## 3. Goals & Non-Goals

### 3.1 Goals

- OAuth connection management for Google Ads, Meta Marketing API, and GA4 per client
- Daily sync of platform-side conversion actions, campaign optimisation goals, and event statistics
- Comparison engine that diffs platform state against Strategy Gate briefs and Atlas-delivered events
- Persistent storage of findings with severity, dimension, and remediation guidance
- Surfacing in three places: Andromeda score, Health Dashboard alerts, Strategy Gate locked brief view
- Forward-compatible with GTM Destinations as a first-class signal source

### 3.2 Non-Goals (v1)

- Automatic remediation (writing config changes back to Google Ads / Meta). Read-only this phase
- LinkedIn Ads and TikTok Ads platform reconciliation (CAPI delivery already stubbed; full reconciliation deferred)
- Reconciliation of offline conversion uploads beyond what existing OCI logging already covers
- Cross-client benchmark reporting (org-level Andromeda already covers internal benchmarking)
- AI-narrated remediation playbooks (deferred to Auto-insight Reporter)

---

## 4. User-Facing Outcomes

After full rollout, the following changes are visible to users:

| Surface | Change |
|---|---|
| Sidebar | New "Connections" section under SET UP group (Google Ads, Meta, GA4 per client) |
| Settings | OAuth connect/disconnect UI per platform per client |
| Strategy Gate locked brief (`/strategy/briefs/:id`) | New "Live Alignment" panel per objective showing platform-by-platform alignment status (green / amber / red) |
| Health Dashboard | New "Platform Acceptance" widget; new alert types in alert feed |
| Andromeda score | Sixth dimension added; existing score formula re-weighted |
| New page (`/reconciliation/:clientId`) | Detailed view of latest reconciliation run with per-finding drill-in |

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PLATFORM RECONCILIATION                      │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  OAuth Flow  │ →  │   Encrypted  │ →  │   Sync Workers   │  │
│  │  per platform│    │    Tokens    │    │   (Bull queue)   │  │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                    │             │
│                                                    ▼             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │   Platform State Cache (Supabase)                       │    │
│  │   - platform_conversion_actions                          │    │
│  │   - platform_campaign_goals                              │    │
│  │   - platform_event_stats_daily                           │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                         │
│                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │   Reconciliation Engine                                 │    │
│  │   - Diff against strategy_briefs (alignment)            │    │
│  │   - Diff against capi_events (delivery)                 │    │
│  │   - Diff against expected vs observed counts (volume)   │    │
│  │   - Validate against Tag Library specs (config)         │    │
│  └─────────────────────┬───────────────────────────────────┘    │
│                        │                                         │
│                        ▼                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  Andromeda   │  │    Health    │  │   Strategy Gate     │   │
│  │  Dimension 6 │  │   Dashboard  │  │   Locked Brief View │   │
│  └──────────────┘  └──────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

All sync workers run via the existing Bull + Redis queue. All credentials use the existing AES-256-GCM encryption pattern from `capi_providers.credentials`. All API routes follow the existing Express handler convention in `backend/src/api/routes/`.

---

## 6. Data Model

All new tables follow the existing RLS pattern (`organization_id = auth.uid()`) and use UUIDs for primary keys. Migrations are numbered sequentially.

### 6.1 `platform_connections`

```sql
CREATE TABLE platform_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id             UUID REFERENCES clients(id) ON DELETE CASCADE,  -- NULL for parent rows (Manager Account / Business Manager)
  platform              TEXT NOT NULL CHECK (platform IN ('google_ads','meta','ga4','gtm_destinations')),
  connection_type       TEXT NOT NULL CHECK (connection_type IN ('manager','child','standalone')),
                                                  -- 'manager'    = Google Ads Manager Account, Meta Business Manager (no client_id)
                                                  -- 'child'      = a sub-account discovered under a manager (has parent_connection_id)
                                                  -- 'standalone' = direct connection with no parent (in-house teams)
  parent_connection_id  UUID REFERENCES platform_connections(id) ON DELETE CASCADE,
                                                  -- NULL for 'manager' and 'standalone'; required for 'child'
  account_id            TEXT NOT NULL,             -- Google customer ID, Meta ad account ID, GA4 property ID, Manager Account ID
  account_label         TEXT,                       -- human-readable name from the platform
  oauth_tokens          JSONB,                      -- AES-256-GCM encrypted; NULL for 'child' rows (tokens live on parent)
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','error','available')),
                                                  -- 'available' = discovered under a manager but not yet user-connected
  last_synced_at        TIMESTAMPTZ,
  last_error            TEXT,
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, platform, account_id),
  -- A child row must have a parent of the same platform
  CONSTRAINT child_requires_parent CHECK (
    (connection_type = 'child' AND parent_connection_id IS NOT NULL AND client_id IS NOT NULL) OR
    (connection_type = 'manager' AND parent_connection_id IS NULL AND client_id IS NULL) OR
    (connection_type = 'standalone' AND parent_connection_id IS NULL AND client_id IS NOT NULL)
  )
);
```

### 6.2 `platform_conversion_actions`

```sql
CREATE TABLE platform_conversion_actions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id               UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id             UUID NOT NULL,
  external_id                 TEXT NOT NULL,        -- platform's own ID
  name                        TEXT NOT NULL,
  status                      TEXT,                  -- ENABLED/REMOVED/HIDDEN
  category                    TEXT,                  -- PURCHASE, LEAD, SIGNUP, etc
  primary_for_goal            BOOLEAN,
  attribution_model           TEXT,                  -- LAST_CLICK, DATA_DRIVEN, etc
  counting_type               TEXT,                  -- ONE_PER_CLICK, MANY_PER_CLICK
  click_lookback_days         INTEGER,
  view_lookback_days          INTEGER,
  value_settings              JSONB,                 -- { default_value, default_currency, always_use_default }
  include_in_conversions      BOOLEAN,
  aem_priority                INTEGER,               -- Meta only: 1–8 = optimised, 9+ = not optimised
  raw                         JSONB,                 -- full platform response for debugging
  observed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_id)
);
```

### 6.3 `platform_campaign_goals`

```sql
CREATE TABLE platform_campaign_goals (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id                   UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id                 UUID NOT NULL,
  external_campaign_id            TEXT NOT NULL,
  campaign_name                   TEXT NOT NULL,
  campaign_type                   TEXT,              -- SEARCH, PMAX, DISPLAY, etc / Meta objective
  status                          TEXT,
  optimization_goal               TEXT,              -- Meta: OFFSITE_CONVERSIONS, etc
  selective_optimization_actions  TEXT[],            -- Google: external_ids of conversion actions
  custom_event_type               TEXT,              -- Meta: PURCHASE, LEAD, etc
  budget_micros                   BIGINT,
  raw                             JSONB,
  observed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_campaign_id)
);
```

### 6.4 `platform_event_stats_daily`

```sql
CREATE TABLE platform_event_stats_daily (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id     UUID NOT NULL,
  event_date          DATE NOT NULL,
  event_name          TEXT NOT NULL,                 -- normalised event name
  conversion_action_id TEXT,                          -- where applicable
  count_observed      INTEGER NOT NULL DEFAULT 0,
  value_observed      NUMERIC,
  dedup_rate          NUMERIC,                        -- Meta CAPI dedup %
  match_quality       NUMERIC,                        -- Meta EMQ 0–10
  raw                 JSONB,
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, event_date, event_name, conversion_action_id)
);
```

### 6.5 `reconciliation_runs`

```sql
CREATE TABLE reconciliation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  brief_id            UUID REFERENCES strategy_briefs(id),
  run_type            TEXT NOT NULL CHECK (run_type IN ('scheduled','manual','post_brief_lock')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','partial','failed')),
  platforms_run       TEXT[] NOT NULL,
  total_findings      INTEGER DEFAULT 0,
  error_summary       TEXT
);
```

### 6.6 `reconciliation_findings`

```sql
CREATE TABLE reconciliation_findings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  organization_id     UUID NOT NULL,
  client_id           UUID NOT NULL,
  brief_id            UUID REFERENCES strategy_briefs(id),
  objective_id        UUID REFERENCES strategy_objectives(id),
  platform            TEXT NOT NULL,
  dimension           TEXT NOT NULL CHECK (dimension IN ('delivery','config','alignment','volume')),
  severity            TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  finding_code        TEXT NOT NULL,                 -- e.g. 'AEM_PRIORITY_TOO_LOW', 'ATTRIBUTION_MODEL_MISMATCH'
  expected            JSONB,
  observed            JSONB,
  narrative           TEXT NOT NULL,
  remediation_hint    TEXT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.7 Index requirements

```sql
CREATE INDEX idx_platform_connections_client ON platform_connections (client_id, platform) WHERE client_id IS NOT NULL;
CREATE INDEX idx_platform_connections_parent ON platform_connections (parent_connection_id) WHERE parent_connection_id IS NOT NULL;
CREATE INDEX idx_platform_connections_manager ON platform_connections (organization_id, platform) WHERE connection_type = 'manager';
CREATE INDEX idx_pca_connection ON platform_conversion_actions (connection_id);
CREATE INDEX idx_pcg_connection ON platform_campaign_goals (connection_id);
CREATE INDEX idx_pesd_connection_date ON platform_event_stats_daily (connection_id, event_date);
CREATE INDEX idx_findings_client_unresolved ON reconciliation_findings (client_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_findings_brief ON reconciliation_findings (brief_id) WHERE brief_id IS NOT NULL;
```

### 6.8 RLS

Standard RLS template for all six tables:

```sql
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org" ON platform_connections
  FOR ALL USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

Repeat for every table. Service role bypasses RLS for sync worker writes.

---

## 7. Connection Model: Manager-First with User-Controlled Account Selection

This section defines the central UX and access pattern for Platform Reconciliation. It applies to Google Ads and Meta. GA4 follows the same spirit with a slightly different mechanism.

### 7.1 Three connection types

| Type | When it applies | Tokens | client_id | parent_connection_id |
|---|---|---|---|---|
| `manager` | Agency connects their Google Ads Manager Account or Meta Business Manager | Stored on this row | NULL | NULL |
| `child` | A sub-account discovered under a manager and explicitly connected by the user | NULL (uses parent's tokens) | Required | Required |
| `standalone` | In-house team connects a single account directly with no manager above it | Stored on this row | Required | NULL |

### 7.2 Discovery, not auto-registration

After a user completes OAuth on a Manager Account or Business Manager, Atlas calls the platform's account-enumeration endpoints to discover every child account the OAuth token can access. **These discovered accounts are written to `platform_connections` with `status='available'` and are NOT considered connected.** They appear in the UI as a list of available accounts under the manager row, with a per-account "Connect" action.

**Connection is always an explicit user action.** Atlas never auto-registers, auto-syncs, or auto-reconciles any account that the user has not deliberately connected. This is non-negotiable: it is both a trust requirement (agencies cannot have Atlas silently scanning every client account in their Manager Account) and a billing requirement (each connected account counts toward plan limits and triggers paid sync activity).

### 7.3 Account enumeration endpoints

| Platform | Endpoint / Resource | Returns |
|---|---|---|
| Google Ads | `customer_client` resource via GAQL, queried on the Manager Account | Tree of accessible child customer IDs with names, status, manager-or-not flag |
| Meta | `/me/businesses` → `/business/{id}/owned_ad_accounts` and `/business/{id}/client_ad_accounts` | All ad accounts the Business Manager owns or has client access to |
| GA4 | `accountSummaries.list` via Admin API | All accounts the user has access to, with property summaries nested |
| GTM Destinations | (Phase 2+, deferred to GTM Destinations PRD) | — |

### 7.4 User-controlled lifecycle

For every discovered account, the user has explicit control over four state transitions:

1. **Connect** — `status='available'` → `status='active'`. Creates a child row (or activates an existing one). Sync begins on the next worker cycle.
2. **Disconnect** — `status='active'` → `status='available'`. Sync stops; existing platform state cache and findings are retained (read-only history) until the manager connection is fully removed.
3. **Re-discover** — manual button on the manager connection row that re-runs account enumeration. New child accounts not previously seen appear as `status='available'`. Removed accounts are marked `status='revoked'`.
4. **Remove manager** — full delete of the manager connection cascades to all child rows. User confirmation required with explicit warning that historical findings will also be deleted.

### 7.5 Standalone connection flow

For in-house teams or agencies without a Manager Account / Business Manager, the user picks "Connect individual account" instead. This skips enumeration: the OAuth flow grants access to a single account, and a `standalone` row is created directly with `status='active'`. No `available` interstitial state.

### 7.6 API call routing

When Atlas makes platform API calls for a `child` connection:

- **Google Ads:** the sync worker uses the parent Manager Account's tokens, sets `login_customer_id` HTTP header to the manager's `account_id`, and sets the GAQL `customer_id` to the child's `account_id`. This is the standard Google Ads Manager Account access pattern.
- **Meta:** the sync worker uses the Business Manager's tokens. Ad-account-scoped endpoints use the child's `account_id` directly in the URL path (e.g. `/act_{child_account_id}/...`).
- **GA4:** the connection model treats each property as `standalone` from the API call perspective (Google Analytics has no Manager-Account-equivalent for read access), but the OAuth grant covers all properties, so multiple `standalone` rows can share the same underlying refresh token. Token storage duplicates the refresh token on each row for simplicity; this is an acceptable trade-off given GA4 OAuth scope is narrow.

### 7.7 Why this matters

Three reasons this connection model is the right default:

1. **It matches how agencies actually work.** Agencies live in their Manager Account (the entity formerly known as MCC, or My Client Center). They don't have N separate Google logins for N clients; they have one Manager Account with client accounts linked under it.
2. **It puts the user in control of what Atlas scans.** Discovering an account is not the same as scanning it. Users explicitly opt each account in.
3. **It is forward-compatible with billing.** Per-account plan limits and paid sync activity attach cleanly to the `connect` action.

---

## 8. OAuth & Credential Management

### 8.1 Token storage

All `oauth_tokens` JSONB values encrypted at rest using `@noble/ciphers` AES-256-GCM. Same pattern as `capi_providers.credentials`. Encryption key from env var `PLATFORM_CONNECTIONS_ENCRYPTION_KEY` (separate from CAPI key to limit blast radius).

### 8.2 Refresh policy

- Google Ads: access token expires in 1h; refresh on every sync run, store new expiry
- Meta: long-lived tokens (60-day); refresh proactively at day 50; mark `status='expired'` if refresh fails
- GA4 (uses Google OAuth): same as Google Ads
- On expiry → `status='expired'` → block sync → surface alert in Settings + Health Dashboard

### 8.3 Scopes required

| Platform | Scopes |
|---|---|
| Google Ads | `https://www.googleapis.com/auth/adwords` |
| Meta | `ads_read`, `business_management`, `pages_show_list` (if pages involved) |
| GA4 | `https://www.googleapis.com/auth/analytics.readonly` |

### 8.4 OAuth callback routes

All callbacks land at `/api/connections/oauth/:platform/callback` on the backend. Frontend initiates via `GET /api/connections/oauth/:platform/start?clientId=...` which returns the authorisation URL.

### 8.5 No credentials in logs

Same rule as CAPI: decrypted tokens never logged, never echoed in error responses, never included in queue payloads. Sync workers receive only `connection_id`; they fetch + decrypt internally.

---

## 9. Platform API Specifications

### 9.1 Google Ads API

- **Version:** v18 or current at implementation time
- **Library:** `google-ads-api` (TypeScript-first wrapper; verify current maintenance status before locking in)
- **Developer token:** required env var `GOOGLE_ADS_DEVELOPER_TOKEN`. **Standard Access required for production scale**. Basic Access caps at 15k operations/day across all clients
- **Manager Account access pattern:** when calling against a child customer through a Manager Account, every request sets:
  - HTTP header `login-customer-id`: the Manager Account's `account_id`
  - GAQL / RPC `customer_id`: the child account's `account_id`
  This is the standard pattern and works whether the connection is `manager` + `child` or `standalone`.
- **Account enumeration (used during Phase 1 OAuth flow):**

```sql
SELECT
  customer_client.client_customer,
  customer_client.descriptive_name,
  customer_client.id,
  customer_client.manager,
  customer_client.status
FROM customer_client
WHERE customer_client.level <= 1
```

  Run against the Manager Account's customer ID immediately after OAuth completion. Returns the tree of accessible child accounts to populate the user-facing account picker.
- **Key resources used:**
  - `customer` — for account resolution
  - `customer_client` — for Manager Account child enumeration
  - `conversion_action` — for config audit
  - `campaign` — for campaign list and status
  - `customer_conversion_goal` — for account-level goal config
  - `conversion_action_stats` — for daily volume reconciliation
- **GAQL example (daily stats):**

```sql
SELECT
  conversion_action.id,
  conversion_action.name,
  metrics.conversions,
  metrics.conversions_value,
  segments.date
FROM conversion_action
WHERE segments.date DURING LAST_7_DAYS
```

### 9.2 Meta Marketing API

- **Version:** v19 or current at implementation time
- **Library:** `facebook-nodejs-business-sdk`
- **Business Manager access pattern:** OAuth is granted against the user's identity, which can have access to multiple Business Managers and ad accounts. After OAuth completion, enumerate accessible Business Managers and ad accounts via:
  - `GET /me/businesses` — Business Managers the user has access to
  - `GET /{business_id}/owned_ad_accounts` and `/{business_id}/client_ad_accounts` — ad accounts under each Business Manager
  - `GET /me/adaccounts` — fallback for accounts not under any Business Manager (creates `standalone` connections)
  Each Business Manager registered creates a `manager` connection row; each ad account explicitly connected by the user becomes a `child` row pointing to it. Direct ad accounts not under a Business Manager become `standalone` rows.
- **Key endpoints:**
  - `/{pixel_id}` — pixel metadata
  - `/{pixel_id}/stats` — event-level counts
  - `/{pixel_id}/aggregated_event_priorities` — AEM ranking (verify endpoint at implementation; Meta moves these)
  - `/act_{ad_account_id}/customconversions` — custom conversion definitions
  - `/act_{ad_account_id}/campaigns?fields=optimization_goal,custom_event_type,status,objective`
- **Rate limits:** business use case tier; track usage headers and back off accordingly

### 9.3 GA4 Data API

- **Library:** `@google-analytics/data` for stats, `@google-analytics/admin` for property enumeration
- **Property enumeration (used during Phase 1 OAuth flow):** call `accountSummaries.list` on the Admin API to retrieve all GA4 accounts and their nested property summaries that the user has access to. Each property the user explicitly connects becomes a `standalone` row sharing the underlying refresh token.
- **Key reports:**
  - Events report by `eventName` × `sessionSource` × `date` for volume reconciliation
  - Key events list via Admin API
- **Quota:** core token bucket per property; respect `_TOKEN` headers

### 9.4 GTM Destinations (forward-compatible)

Per the GTM Destinations PRD Addendum (Google Marketing Live, May 2026), Atlas treats Destinations as a first-class signal source where available. In Phase 2 the sync layer reads destination acceptance signals when the client's GTM container is on the new Destinations model. Fallback to legacy tag firing diagnostics where not yet available.

Sync worker for Destinations is a separate module to be scoped in the GTM Destinations PRD; this PRD only ensures the schema supports it (`platform='gtm_destinations'`).

---

## 10. Sync & Reconciliation Engine

### 10.1 Sync cadence

| Sync type | Cadence | Trigger |
|---|---|---|
| Config sync (conversion actions, campaign goals) | Every 6h | Bull repeatable job per connection |
| Daily stats sync | Daily 02:00 UTC | Bull repeatable job per connection |
| Stale-window re-sync | Daily 03:00 UTC | For events with lookback windows >7d, re-pull D-30 |
| Post-brief-lock reconciliation | One-shot | Triggered by `strategy_briefs.locked_at` update |
| Manual run | On demand | UI button on `/reconciliation/:clientId` |

### 10.2 Sync worker structure

Located in `backend/src/services/reconciliation/`:

```
reconciliation/
├── sync/
│   ├── googleAdsSync.ts        # conversion actions, campaigns, stats
│   ├── metaSync.ts              # custom conversions, AEM priorities, pixel stats
│   ├── ga4Sync.ts               # key events, event counts by source
│   └── syncOrchestrator.ts      # picks connections due for sync, enqueues jobs
├── engine/
│   ├── deliveryDiff.ts          # capi_events vs platform_event_stats_daily
│   ├── configDiff.ts            # tag_library / brief vs platform_conversion_actions
│   ├── alignmentDiff.ts         # strategy_objectives vs platform_campaign_goals
│   ├── volumeDiff.ts            # capi_events vs platform vs GA4
│   └── findingWriter.ts         # writes to reconciliation_findings with severity
└── codes/
    └── findingCodes.ts          # enum + narrative templates
```

### 10.3 Finding codes (initial set)

| Code | Dimension | Severity | Trigger |
|---|---|---|---|
| `CONNECTION_EXPIRED` | delivery | critical | OAuth token cannot refresh |
| `EVENT_NOT_RECEIVED` | delivery | error | Atlas delivered event, no platform record within 48h |
| `CAPI_DEDUP_LOW` | delivery | warning | Meta dedup_rate < 70% over 7d |
| `EMQ_LOW` | delivery | warning | Meta EMQ < 6.0 over 7d |
| `ATTRIBUTION_MODEL_MISMATCH` | config | warning | Conversion action attribution model differs from brief recommendation |
| `COUNTING_TYPE_MISMATCH` | config | warning | One-per-click vs every-conversion mismatch |
| `LOOKBACK_WINDOW_SHORT` | config | info | Click lookback < platform default |
| `AEM_PRIORITY_TOO_LOW` | config | critical | Recommended primary event ranked 9+ in Meta AEM |
| `VALUE_SETTINGS_MISSING` | config | warning | No default value for action recommended as primary for value-based bidding |
| `WRONG_PRIMARY_CONVERSION` | alignment | critical | Campaign primary conversion ≠ brief primary |
| `MISSING_PRIMARY_CONVERSION` | alignment | critical | Brief primary conversion not present in account |
| `SUPPRESSION_USED_AS_PRIMARY` | alignment | critical | Brief tier=suppression but campaign optimises on it |
| `VOLUME_DELTA_EXCEEDED` | volume | warning | Platform count outside tolerance (default ±15%) vs Atlas-delivered |
| `GA4_VOLUME_DIVERGENCE` | volume | info | GA4 count diverges from platform count >25% |

The narrative for each is a templated string with placeholders for entity names; templates live in `findingCodes.ts`.

### 10.4 Tolerance configuration

Tolerances stored per organisation (later per client) in a new `reconciliation_tolerances` JSONB column on `organizations` (or a dedicated row in `org_subscriptions`). Default tolerances baked in; agency users on `agency` plan can override.

---

## 11. Backend API Routes

New routes under `/api/connections` and `/api/reconciliation`:

| Route | Method | Purpose |
|---|---|---|
| `/api/connections` | GET | List all connections (manager, child, standalone) grouped for the org |
| `/api/connections/oauth/:platform/start` | GET | Initiate OAuth, returns authorisation URL |
| `/api/connections/oauth/:platform/callback` | GET | OAuth callback handler; runs account discovery; persists manager + `available` child rows |
| `/api/connections/:id/discover` | POST | Re-enumerate accounts under a manager connection |
| `/api/connections/:id/connect` | POST | Flip an `available` child row to `active`; body: `{ clientId }` |
| `/api/connections/:id/disconnect` | POST | Flip an `active` child or standalone row to `available`; retains history |
| `/api/connections/:id` | DELETE | Full remove; cascades children for manager rows; requires explicit confirmation flag in body |
| `/api/connections/:id/test` | POST | Test live connection |
| `/api/connections/:id/sync` | POST | Force immediate sync (Phase 2+) |
| `/api/reconciliation/runs` | GET | List runs for a client |
| `/api/reconciliation/runs/:id` | GET | Run detail with findings grouped by dimension |
| `/api/reconciliation/runs/:id/findings` | GET | All findings for a run |
| `/api/reconciliation/findings/:id/resolve` | PATCH | Mark a finding resolved (with optional note) |
| `/api/reconciliation/trigger` | POST | Manual trigger for a client |
| `/api/reconciliation/tolerances` | GET/PUT | Read/update tolerance config |

All routes guarded by `authMiddleware` + `planGuard('pro')` minimum. Sync triggers limited via existing `rateLimiter` middleware. All request bodies validated with Zod. Responses follow `{ data, error, message }` shape.

---

## 12. Frontend Surfaces

### 12.1 New pages

- `/connections` — list of all connections across clients with status badges and re-auth CTA
- `/connections/:clientId` — per-client connection management
- `/reconciliation/:clientId` — latest run summary + findings list with filters
- `/reconciliation/:clientId/runs/:runId` — drill into a specific run

### 12.2 Extended pages

- **Settings** — new "Platform Connections" tab
- **`/strategy/briefs/:id`** — new "Live Alignment" panel showing per-objective alignment status, last reconciled timestamp, link to latest findings
- **Health Dashboard** — new "Platform Acceptance" tile in score grid; new alert types in feed
- **Sidebar** — "Connections" item under SET UP group; "Reconciliation" item under MONITOR group

### 12.3 Components

```
frontend/src/components/connections/
├── ConnectionList.tsx               # top-level list; groups manager + children, separates standalones
├── ManagerConnectionCard.tsx        # Manager Account / Business Manager card with child tree below
├── ChildAccountRow.tsx              # one row per discovered child; shows status, Connect/Disconnect button
├── StandaloneConnectionCard.tsx     # direct connections with no manager
├── ConnectionCard.tsx               # generic card; status, last sync, account label, actions
├── OAuthInitiateButton.tsx          # platform-specific OAuth start
├── AccountPickerModal.tsx           # post-OAuth multi-select picker over discovered accounts
├── RediscoverButton.tsx             # re-enumerate accounts under a manager
├── ConnectionStatusBadge.tsx        # active / available / expired / revoked / error
└── ReauthBanner.tsx                 # global banner when expired connections exist

frontend/src/components/reconciliation/
├── ReconciliationRunSummary.tsx
├── FindingsList.tsx
├── FindingCard.tsx              # severity icon, dimension, narrative, remediation hint
├── FindingFilters.tsx           # by platform, dimension, severity, resolved
├── DimensionScorePanel.tsx      # delivery/config/alignment/volume sub-scores
└── AlignmentMatrix.tsx          # used in Strategy Gate locked brief view
```

### 12.4 Stores

```
frontend/src/store/
├── connectionStore.ts            # connections, OAuth state, sync triggers
└── reconciliationStore.ts        # runs, findings, filters
```

### 12.5 API client modules

```
frontend/src/lib/api/
├── connectionApi.ts
└── reconciliationApi.ts
```

---

## 13. Andromeda Integration

The Andromeda score (per the existing Andromeda PRD) currently spans five dimensions: EMQ monitoring, funnel completeness, signal freshness/latency, dedup health, value parameter coverage.

This PRD adds the sixth dimension: **Platform Acceptance**.

### 13.1 Dimension definition

> **Platform Acceptance** — the degree to which signals delivered by Atlas are accepted, attributed, and acted on by the connected ad platforms in line with the locked strategic brief.

### 13.2 Sub-score composition

| Sub-score | Source | Weight |
|---|---|---|
| Delivery (events received) | Open `EVENT_NOT_RECEIVED` + `CAPI_DEDUP_LOW` findings | 25% |
| Config (conversion action setup) | Open `ATTRIBUTION_MODEL_MISMATCH`, `COUNTING_TYPE_MISMATCH`, `AEM_PRIORITY_TOO_LOW`, `VALUE_SETTINGS_MISSING` | 25% |
| Alignment (campaign goals match brief) | Open `WRONG_PRIMARY_CONVERSION`, `MISSING_PRIMARY_CONVERSION`, `SUPPRESSION_USED_AS_PRIMARY` | 30% |
| Volume (count parity) | Open `VOLUME_DELTA_EXCEEDED`, `GA4_VOLUME_DIVERGENCE` | 20% |

Each sub-score is 100 minus weighted severity-adjusted penalty per open finding.

### 13.3 Overall Andromeda re-weighting

Existing five dimensions reweighted from 20% each to 16.67%; Platform Acceptance enters at 16.67%. Configurable per `org_subscriptions.andromeda_weights` JSONB (new column).

### 13.4 Computation location

`backend/src/services/health/andromedaCalculator.ts` (existing). Adds a new step that pulls open findings count and severity, computes sub-scores, integrates into composite score.

---

## 14. Strategy Gate Integration

### 14.1 Live Alignment panel

Added to `/strategy/briefs/:id` below the existing objectives list. For each objective:

- Per platform (Google Ads, Meta, GA4): traffic-light status
- Severity-coloured findings list scoped to this brief + objective
- "Last reconciled" timestamp with manual re-run button
- Direct link to full reconciliation run

### 14.2 Post-lock reconciliation trigger

When `strategy_briefs.locked_at` is updated:

1. Enqueue an immediate reconciliation run (`run_type='post_brief_lock'`) for the brief's client
2. Wait for run to complete (or timeout at 5 min)
3. Show alignment panel on the locked brief view with results from this run

This makes brief lock the moment Atlas verifies live setup matches strategy — the highest-leverage trust-building moment in the product.

### 14.3 Component changes

`frontend/src/components/strategy/BriefLocked.tsx` extended with `<AlignmentMatrix>` component.

---

## 15. Phase 1 — Connection Plumbing

### 15.1 Scope

- Schema migration for `platform_connections` only (section 6.1 schema + section 6.8 RLS for this table)
- OAuth flows for Google Ads, Meta, GA4
- Token encryption parity with CAPI
- **Manager Account / Business Manager discovery flow** — post-OAuth account enumeration and persistence as `status='available'` rows
- **User-controlled account picker UI** — multi-select picker after OAuth completion, plus per-account Connect / Disconnect actions on the ongoing connection management surface
- **Three connection types fully supported:** `manager`, `child`, `standalone`, including the schema constraints in section 6.1
- **Re-discover action** to re-enumerate accounts under an existing Manager Account or Business Manager
- Connection management API routes (including discovery and connect/disconnect endpoints)
- Connection management UI (`/connections`, `/connections/:clientId`, Settings tab)
- Connection health monitoring (status badge, last sync, error display, re-auth banner)
- **No sync or reconciliation logic yet** — Phase 1 is purely "can we discover, connect, and stay connected"

### 15.2 Deliverables

**Schema**
- `supabase/migrations/2026MMDD_001_platform_connections.sql` — full schema per section 6.1, including the three-type CHECK constraint, the self-referential `parent_connection_id`, and RLS

**Backend**
- `backend/src/services/connections/oauthFlows/googleAdsOAuth.ts`
- `backend/src/services/connections/oauthFlows/metaOAuth.ts`
- `backend/src/services/connections/oauthFlows/ga4OAuth.ts`
- `backend/src/services/connections/discovery/googleAdsDiscovery.ts` — runs `customer_client` GAQL against the Manager Account, returns the tree
- `backend/src/services/connections/discovery/metaDiscovery.ts` — calls `/me/businesses` and ad-account enumeration endpoints
- `backend/src/services/connections/discovery/ga4Discovery.ts` — calls `accountSummaries.list` via Admin API
- `backend/src/services/connections/connectionLifecycle.ts` — orchestrates connect / disconnect / re-discover state transitions
- `backend/src/services/connections/tokenManager.ts` (encryption, refresh, parent-token resolution for child rows)
- `backend/src/services/connections/connectionTester.ts`
- `backend/src/api/routes/connections.ts` — endpoints listed below

**API endpoints added in Phase 1**
- `GET /api/connections` — flat list with manager/child/standalone grouping
- `GET /api/connections/oauth/:platform/start?clientId=...` — initiate OAuth, returns auth URL
- `GET /api/connections/oauth/:platform/callback` — OAuth callback handler; runs discovery; returns list of available accounts
- `POST /api/connections/:id/discover` — re-discover accounts under an existing manager
- `POST /api/connections/:id/connect` — user opts an `available` account into `active` status; requires `clientId` in body to attach to an Atlas client
- `POST /api/connections/:id/disconnect` — flip `active` back to `available` (sync stops, history retained)
- `DELETE /api/connections/:id` — full remove; cascades for manager rows
- `POST /api/connections/:id/test` — live read against the platform to verify token

**Env vars**
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `META_APP_ID`, `META_APP_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `PLATFORM_CONNECTIONS_ENCRYPTION_KEY`

**Frontend**
- `frontend/src/pages/ConnectionsPage.tsx` — global connections overview, all clients
- `frontend/src/pages/ClientConnectionsPage.tsx` — per-client connection management
- All components from section 12.3 connections folder, including `AccountPickerModal`, `ManagerConnectionCard`, `ChildAccountRow`, `StandaloneConnectionCard`, `RediscoverButton`
- `frontend/src/store/connectionStore.ts`
- `frontend/src/lib/api/connectionApi.ts`
- Settings tab extension ("Platform Connections")
- Sidebar entry under SET UP group

### 15.3 Acceptance criteria

**OAuth + discovery (manager flow)**
- A user on `pro` or higher can initiate Google Ads OAuth, complete the consent screen, and land on the post-OAuth account picker
- The picker lists every child account discovered under their Manager Account, with the Manager Account itself shown as the parent and clearly labelled
- Selecting accounts in the picker and confirming creates `child` rows with `status='active'`, all pointing to the same Manager Account `parent_connection_id`
- Unselected accounts persist as `status='available'` and remain accessible for later connection
- Same flow works end to end for Meta (Business Manager + ad accounts) and GA4 (property enumeration)

**OAuth (standalone flow)**
- A user can choose "Connect individual account" instead, which creates a `standalone` row directly without an `available` interstitial
- Standalone connections show without a manager parent in the connection list

**Lifecycle controls**
- Per-account "Connect" button flips `available` → `active`
- Per-account "Disconnect" button flips `active` → `available`; sync state is retained but no new syncs occur
- "Re-discover" on a manager connection re-enumerates child accounts; new accounts appear as `available`, removed ones are marked `revoked`
- "Remove manager" cascade-deletes all children with explicit user confirmation listing what will be lost

**Token + auth health**
- A connection with an expired refresh token shows `status='expired'` and the global re-auth banner appears
- The "Test connection" button performs a no-op read call (Google Ads: a `customer` query; Meta: `/me`; GA4: a single property metadata read) and returns success/failure
- Decrypted tokens never appear in logs, error responses, or any API payload returned to the client

**Phase 1 boundary**
- Manual "Sync now" button exists on connected accounts but is disabled with "Sync available in Phase 2" tooltip
- No reconciliation runs are created; no findings exist yet

### 15.4 Dependencies

- Google Ads developer token application submitted (this is a real-world gating item, may take 1–4 weeks)
- Meta App Review for `ads_read` and `business_management` for production use (4–6 weeks typical)
- GA4 OAuth uses same Google OAuth client as Google Ads — single consent screen if scopes combined

---

## 16. Phase 2 — Config Audit & Strategic Alignment

### 16.1 Scope

- Schema for `platform_conversion_actions`, `platform_campaign_goals`
- Sync workers for Google Ads and Meta (read conversion actions + campaign goals)
- GA4 key events sync (for completeness)
- Config diff engine (`configDiff.ts`)
- Alignment diff engine (`alignmentDiff.ts`)
- `reconciliation_runs` and `reconciliation_findings` schemas
- Reconciliation API routes (read-only at this stage)
- Strategy Gate Live Alignment panel
- Post-lock reconciliation trigger

### 16.2 Deliverables

**Schema**
- `supabase/migrations/2026MMDD_002_platform_state_cache.sql` (sections 6.2, 6.3 + RLS)
- `supabase/migrations/2026MMDD_003_reconciliation_core.sql` (sections 6.5, 6.6 + RLS)

**Backend**
- `backend/src/services/reconciliation/sync/googleAdsSync.ts` (conversion actions + campaigns only)
- `backend/src/services/reconciliation/sync/metaSync.ts` (custom conversions + AEM priorities + campaigns)
- `backend/src/services/reconciliation/sync/ga4Sync.ts` (key events list)
- `backend/src/services/reconciliation/sync/syncOrchestrator.ts`
- `backend/src/services/reconciliation/engine/configDiff.ts`
- `backend/src/services/reconciliation/engine/alignmentDiff.ts`
- `backend/src/services/reconciliation/engine/findingWriter.ts`
- `backend/src/services/reconciliation/codes/findingCodes.ts`
- `backend/src/services/queue/workers/reconciliationWorker.ts`
- `backend/src/api/routes/reconciliation.ts`
- Bull repeatable job registration for 6-hourly config sync

**Frontend**
- `frontend/src/components/reconciliation/AlignmentMatrix.tsx`
- `frontend/src/components/reconciliation/FindingsList.tsx`, `FindingCard.tsx`, `FindingFilters.tsx`
- `frontend/src/components/strategy/BriefLocked.tsx` extension
- `frontend/src/store/reconciliationStore.ts`
- `frontend/src/lib/api/reconciliationApi.ts`

### 16.3 Acceptance criteria

- After Phase 1 connection exists, within 6h the platform state cache populates with all conversion actions, custom conversions, and campaign goals
- Locking a brief triggers a one-shot reconciliation run that completes within 5 minutes
- Brief view shows alignment status per objective per platform
- All finding codes in dimensions `config` and `alignment` (per section 10.3) generate when their conditions are met
- AEM priority finding correctly identifies events ranked 9 or lower as `critical`
- Manual re-reconciliation via UI button works and re-renders the alignment panel
- Findings list is filterable by platform, dimension, severity, and resolved state

### 16.4 Dependencies

- Phase 1 complete and stable
- Strategy Gate B2B fields (`conversion_tier`, `platform_action_types`) present on `strategy_objectives` (already shipped per CLAUDE.md)

---

## 17. Phase 3 — Delivery Verification & Volume Reconciliation

### 17.1 Scope

- Schema for `platform_event_stats_daily`
- Daily stats sync workers (Google Ads, Meta, GA4)
- Stale-window re-sync logic (D-30 re-pull for long lookback windows)
- Delivery diff engine (`deliveryDiff.ts`)
- Volume diff engine (`volumeDiff.ts`)
- Tolerance config (`reconciliation_tolerances`)
- `/reconciliation/:clientId` page

### 17.2 Deliverables

**Schema**
- `supabase/migrations/2026MMDD_004_platform_event_stats.sql` (section 6.4 + RLS)
- `supabase/migrations/2026MMDD_005_reconciliation_tolerances.sql` (org-level config column)

**Backend**
- Extend `googleAdsSync.ts` with `conversion_action_stats` GAQL query
- Extend `metaSync.ts` with `/{pixel_id}/stats` and EMQ pull
- Extend `ga4Sync.ts` with `runReport` for daily events
- `backend/src/services/reconciliation/engine/deliveryDiff.ts`
- `backend/src/services/reconciliation/engine/volumeDiff.ts`
- Bull repeatable jobs: daily 02:00 UTC stats sync, daily 03:00 UTC stale-window re-sync
- Extend `/api/reconciliation/tolerances` route

**Frontend**
- `frontend/src/pages/ReconciliationPage.tsx`
- `frontend/src/pages/ReconciliationRunDetailPage.tsx`
- `frontend/src/components/reconciliation/ReconciliationRunSummary.tsx`
- `frontend/src/components/reconciliation/DimensionScorePanel.tsx`
- Tolerance config UI in Settings

### 17.3 Acceptance criteria

- Daily sync completes for all active connections by 04:00 UTC
- `EVENT_NOT_RECEIVED` triggers when an Atlas-delivered event has no platform record within 48h, scoped to events in Tag Library marked as platform-delivered
- `VOLUME_DELTA_EXCEEDED` triggers per configured tolerance (default ±15%)
- `GA4_VOLUME_DIVERGENCE` triggers when GA4 count diverges >25% from primary platform count
- Stale-window re-sync overwrites previous daily rows correctly without duplication
- Reconciliation page shows trend chart of findings count by dimension over 30 days

### 17.4 Dependencies

- Phase 2 complete
- Existing `capi_events` table reliably populated (already shipped)

---

## 18. Phase 4 — Andromeda Score & Alerting

### 18.1 Scope

- Andromeda Platform Acceptance dimension integration
- Andromeda re-weighting + config UI
- Health Dashboard widgets
- Alert feed integration
- Operator alerts via existing `alertDelivery` service

### 18.2 Deliverables

**Schema**
- `supabase/migrations/2026MMDD_006_andromeda_weights.sql` (add `andromeda_weights` JSONB to `org_subscriptions`)

**Backend**
- Extend `backend/src/services/health/andromedaCalculator.ts` with Platform Acceptance sub-score
- Extend `backend/src/services/usage/alertDelivery.ts` with new alert types: `RECON_CRITICAL_FINDING`, `RECON_BRIEF_MISALIGNED`, `CONNECTION_EXPIRED`
- Integrate reconciliation findings into Health Dashboard alert feed query

**Frontend**
- `frontend/src/components/dashboard/PlatformAcceptanceTile.tsx`
- Extend `HealthDashboardPage.tsx` with new tile and alert types
- Andromeda weights config UI in Settings (super admin only initially)
- `ReauthBanner.tsx` integration as site-wide banner

### 18.3 Acceptance criteria

- Andromeda score reflects open findings within 1 hour of finding creation
- `critical` findings trigger operator email/Slack alerts per existing alert delivery rules
- `RECON_BRIEF_MISALIGNED` fires when a brief that was previously fully aligned develops a `critical` alignment finding
- Health Dashboard alert feed shows top 10 open reconciliation findings with severity, narrative, and link to detail
- Platform Acceptance tile shows 0–100 score with sub-score breakdown on hover
- Org-level weights can be tuned and score recomputes correctly

### 18.4 Dependencies

- Phase 3 complete
- Andromeda v1 in production (per existing Andromeda PRD)

---

## 19. Cross-Phase Concerns

### 19.1 Testing

- Unit tests for every diff engine module with fixture-based input
- Integration tests for sync workers using mocked platform clients (don't hit live APIs in CI)
- E2E happy-path test per phase: connect → sync → reconcile → finding rendered in UI
- Golden sample reconciliation runs stored in `backend/test/fixtures/reconciliation/` per the existing golden sample CI pattern

### 19.2 Observability

- Sync worker logs: connection_id, platform, duration, records_fetched, error if any
- Reconciliation run logs: run_id, total findings by severity, duration per engine module
- Bull queue health metrics already covered by existing dashboard

### 19.3 Security

- All OAuth flows use `state` parameter with HMAC to prevent CSRF
- All token storage encrypted (section 8.1)
- All routes pass through `authMiddleware` + appropriate `planGuard`
- RLS on all tables (section 6.8)
- No PII in queue payloads (only connection_id / run_id)
- Decrypted tokens never logged

### 19.4 Rate limits & quotas

- Google Ads: respect `RESOURCE_EXHAUSTED` and back off exponentially; degrade to `partial` run status
- Meta: track `X-Business-Use-Case-Usage` header; pause at 80% utilisation
- GA4: respect token bucket headers; queue retries
- Operator alert fires if any connection consistently hits rate limits over 24h

### 19.5 Cost monitoring

- Browserbase reconciliation snapshots already cover one cost vector
- Add quota usage logging per platform per day to `usage_events` for visibility
- Surface on internal admin dashboard (super admin only)

---

## 20. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google Ads Standard Access not granted | Medium | High | Apply early in Phase 1; build with Basic Access for dev, gate production rollout on approval |
| Meta App Review delays | High | High | Submit app review in Phase 1; build with development pixels for QA; have rollout plan for both reviewed and unreviewed paths |
| Attribution window lag causes false `EVENT_NOT_RECEIVED` | High | Medium | Default 48h tolerance for delivery diff; document re-reconciliation behaviour clearly |
| AEM priority endpoint changes | Medium | Medium | Wrap Meta SDK calls in abstraction; verify endpoint at implementation; add monitoring |
| GA4 quota exhaustion on high-traffic properties | Medium | Medium | Implement per-property quota tracking; batch queries; reduce daily sync frequency on large properties |
| Andromeda re-weighting breaks existing customer expectations | Medium | Medium | Communicate change in release notes; allow per-org override; default weights match prior behaviour for first 30 days |
| GTM Destinations rollout shifts ground under Phase 1 | Medium | Low | Schema supports `gtm_destinations` platform from day one; reconciliation engine modules are platform-pluggable |
| Customer revokes OAuth without notifying agency | High | Low | Daily connection health check; expired status surfaced prominently; re-auth banner |

---

## 21. Out of Scope

- Write-back / auto-remediation (deferred to a v2)
- LinkedIn Ads and TikTok Ads platform reconciliation
- Reconciliation of offline conversion uploads beyond existing OCI logging
- Cross-client benchmarking dashboards
- AI-narrated remediation playbooks (deferred to Auto-insight Reporter)
- Real-time (sub-minute) reconciliation — Phase 3 cadence is daily, Phase 2 is 6-hourly for config

---

## 22. Open Questions

> **Decided (was Open Question 1):** *Manager Account vs individual customer connection for Google Ads, and Business Manager vs individual ad account for Meta.* **Resolved:** Manager-first with user-controlled account selection and a standalone fallback for in-house teams. Full design in section 7 ("Connection Model"). Schema in section 6.1 reflects this with three connection types and `parent_connection_id`.

1. **Pricing tier gating** — Platform Reconciliation likely a `pro`+ feature, but should Andromeda Platform Acceptance score be visible (read-only) on `free` to demonstrate value? Decision needed before Phase 4.
2. **Tolerance defaults** — current proposal is ±15% for volume, ±25% for GA4 divergence. Need real-world calibration once we have a few weeks of live data.
3. **Finding resolution semantics** — should resolution be manual only, or auto-resolve when the underlying condition disappears? Recommendation: auto-resolve with audit log; manual resolution with note also supported.
4. **Brief versioning** — when a brief is unlocked, superseded, and re-locked, do prior findings carry over or reset? Recommendation: findings link to brief version; new lock starts fresh.
5. **Per-account plan limits** — does each connected account count against plan limits separately, or do Manager Accounts have a different billing treatment? Decision needed before Phase 1 production rollout.

---

## Appendix A — Platform Library Selection

| Platform | Library | Reason | Risks |
|---|---|---|---|
| Google Ads | `google-ads-api` (npm) | TypeScript-first, idiomatic, active maintenance | Verify maintenance status at implementation; fallback to `google-ads-node` |
| Meta | `facebook-nodejs-business-sdk` | Official Meta SDK | Verbose API; wrap in internal abstraction |
| GA4 | `@google-analytics/data` + `@google-analytics/admin` | Official Google libraries | Quota handling is caller's responsibility |

---

## Appendix B — Sample Reconciliation Run (illustrative)

```jsonc
{
  "run_id": "run_01H...",
  "client_id": "client_01H...",
  "brief_id": "brief_01H...",
  "run_type": "scheduled",
  "started_at": "2026-06-01T02:01:13Z",
  "finished_at": "2026-06-01T02:04:47Z",
  "status": "succeeded",
  "platforms_run": ["google_ads", "meta", "ga4"],
  "total_findings": 4,
  "findings": [
    {
      "platform": "meta",
      "dimension": "config",
      "severity": "critical",
      "finding_code": "AEM_PRIORITY_TOO_LOW",
      "narrative": "The brief recommends 'Demo Booked' as the primary conversion for Acme Ltd, but it is ranked #11 in Meta Aggregated Event Measurement. iOS web traffic is not optimising on this event.",
      "remediation_hint": "Open Events Manager → Aggregated Event Measurement → Web Events Configuration and move 'Demo Booked' into positions 1–8."
    },
    {
      "platform": "google_ads",
      "dimension": "alignment",
      "severity": "critical",
      "finding_code": "WRONG_PRIMARY_CONVERSION",
      "narrative": "Campaign 'Acme PMax — UAE' is optimising on 'view_item', but the locked brief sets 'demo_booked' as the primary conversion for this objective.",
      "remediation_hint": "In Google Ads → Campaign → Settings → Conversion goals, set 'Demo Booked' as the campaign-level conversion goal and remove 'view_item'."
    },
    {
      "platform": "google_ads",
      "dimension": "config",
      "severity": "warning",
      "finding_code": "ATTRIBUTION_MODEL_MISMATCH",
      "narrative": "'Demo Booked' uses LAST_CLICK attribution. For lead-gen campaigns, DATA_DRIVEN is recommended.",
      "remediation_hint": "Tools → Conversions → Demo Booked → Edit settings → Attribution model."
    },
    {
      "platform": "meta",
      "dimension": "volume",
      "severity": "warning",
      "finding_code": "VOLUME_DELTA_EXCEEDED",
      "narrative": "Yesterday Atlas delivered 412 'Demo Booked' events to Meta CAPI but only 287 appear in pixel stats — a 30% drop-off, outside the 15% tolerance.",
      "remediation_hint": "Check dedup rate (currently 64%) and EMQ score; verify Conversions API events include all matching parameters."
    }
  ]
}
```

---

**End of PRD.**
