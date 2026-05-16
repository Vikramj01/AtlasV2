# Platform Reconciliation — Phase 3 Sprint Plan: Delivery & Volume

Source PRD: `docs/PLATFORM_RECONCILIATION_PRD.md` (§6.4, §10.3, §17)
Implementation branch: `claude/platform-reconciliation-sprint-plan-s5Qmu`

---

## Phase 3 Goal

Phase 2 established config sync and strategic alignment diffs. Phase 3 closes the signal delivery loop: pull daily event counts from each platform, compare them against what Atlas sent, and raise structured findings when events go missing or volumes diverge beyond tolerance.

When Phase 3 is complete:
- Every active connection syncs daily event counts from the platform (Google Ads, Meta, GA4)
- `EVENT_NOT_RECEIVED` fires when an expected key event has 0 platform-side counts over the last 7 days
- `CAPI_DEDUP_LOW` fires when server-side dedup rate falls below threshold (Meta)
- `VOLUME_DELTA_EXCEEDED` fires when atlas_count vs platform_count diverges beyond tolerance
- Tolerance thresholds are configurable per client via API
- A full `/reconciliation/:clientId` page shows run history + live alignment
- `/reconciliation/runs/:id` shows full findings breakdown by dimension

**What Phase 3 does NOT do:** Andromeda score integration (Phase 4), Health Dashboard widgets (Phase 4).

---

## Architecture (Phase 3 additions)

```
24h Bull repeatable job per connection
   └── statsOrchestrator.ts
         ├── googleAdsStatsSync.ts  → platform_event_stats_daily (GAQL conversion stats)
         ├── metaStatsSync.ts       → platform_event_stats_daily (Insights API actions breakdown)
         └── ga4StatsSync.ts        → platform_event_stats_daily (Data API key events)

reconciliationRunner.executeRun()  ← extended with:
         ├── deliveryDiff.ts   → EVENT_NOT_RECEIVED, CAPI_DEDUP_LOW findings
         └── volumeDiff.ts     → VOLUME_DELTA_EXCEEDED findings

GET  /api/reconciliation/tolerance?clientId=X
PUT  /api/reconciliation/tolerance
GET  /api/reconciliation/stats?clientId=X&days=7

/reconciliation/:clientId            → ReconciliationPage
/reconciliation/runs/:id             → ReconciliationRunDetailPage
```

---

## Sprint Overview

| Sprint | Focus | Key Deliverables |
|---|---|---|
| **3.A** | Schema | platform_event_stats_daily + reconciliation_tolerance_configs migrations |
| **3.B** | Daily Stats Sync | googleAdsStatsSync, metaStatsSync, ga4StatsSync, statsOrchestrator, 24h Bull cron |
| **3.C** | Delivery + Volume Engine | New finding codes, deliveryDiff, volumeDiff, wired into reconciliationRunner |
| **3.D** | API Routes | Tolerance CRUD, stats query endpoint, updated trigger |
| **3.E** | Frontend Pages | ReconciliationPage, ReconciliationRunDetailPage, sidebar, App routes |

---

## Sprint 3.A — Schema

### Files
- `supabase/migrations/20260608_001_event_stats_daily.sql`
- `supabase/migrations/20260608_002_tolerance_config.sql`

### Migration 1: `platform_event_stats_daily`

Daily time-series of event counts per connection, keyed by (connection_id, date, event_name).

```sql
CREATE TABLE IF NOT EXISTS platform_event_stats_daily (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL,
  client_id         UUID NOT NULL,
  date              DATE NOT NULL,
  event_name        TEXT NOT NULL,        -- matches platform's event/conversion name
  platform_count    INTEGER NOT NULL DEFAULT 0,
  atlas_count       INTEGER,              -- count from capi_events for same client+event+date; null if no CAPI
  delta_pct         NUMERIC(6,2),         -- ((platform_count - atlas_count) / NULLIF(atlas_count,0)) * 100
  quality_signals   JSONB,               -- { dedup_rate, match_rate, event_match_score } platform-specific signals
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, date, event_name)
);
ALTER TABLE platform_event_stats_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org stats" ON platform_event_stats_daily
  FOR ALL USING (organization_id = auth.uid());
CREATE INDEX idx_stats_connection_date ON platform_event_stats_daily (connection_id, date DESC);
CREATE INDEX idx_stats_client_event    ON platform_event_stats_daily (client_id, event_name, date DESC);
```

### Migration 2: `reconciliation_tolerance_configs`

Per-client, per-event tolerance settings for volume reconciliation.

```sql
CREATE TABLE IF NOT EXISTS reconciliation_tolerance_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  client_id             UUID NOT NULL,
  event_name            TEXT,            -- NULL = applies to all events for this client
  platform              TEXT,            -- NULL = applies to all platforms
  volume_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 20.0,  -- fire warning if delta > this %
  dedup_warn_threshold  NUMERIC(4,3) NOT NULL DEFAULT 0.70,  -- fire warning if dedup_rate < this
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, client_id, COALESCE(event_name,'*'), COALESCE(platform,'*'))
);
ALTER TABLE reconciliation_tolerance_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org tolerance" ON reconciliation_tolerance_configs
  FOR ALL USING (organization_id = auth.uid());
CREATE INDEX idx_tolerance_client ON reconciliation_tolerance_configs (client_id);
```

---

## Sprint 3.B — Daily Stats Sync

### Files
```
backend/src/services/reconciliation/sync/
├── googleAdsStatsSync.ts    — GAQL conversion stats (last 7 days window)
├── metaStatsSync.ts         — Meta Insights API (actions breakdown + event match score)
└── ga4StatsSync.ts          — GA4 Data API (runReport for key events)
    statsOrchestrator.ts     — EXTENDED: adds getConnectionsDueForStatsSync + runStatsSyncForConnection

backend/src/services/queue/jobQueue.ts    — add reconciliationStatsQueue
backend/src/services/queue/worker.ts     — register stats processor + 24h repeatable
```

### `googleAdsStatsSync.ts`
- `syncConversionStats(connectionId, orgId, clientId)` — GAQL:
  ```
  SELECT segments.date, conversion_action.name, metrics.conversions, metrics.all_conversions
  FROM customer
  WHERE segments.date DURING LAST_7_DAYS
  ```
  Upserts one row per (connection_id, date, event_name) into `platform_event_stats_daily`.
  Fetches `atlas_count` from `capi_events` for same client + event + date range.
  Computes `delta_pct`.

### `metaStatsSync.ts`
- `syncAdAccountStats(connectionId, orgId, clientId)` — Meta Insights API:
  ```
  GET /{adAccountId}/insights?fields=actions,action_values,website_ctr&time_range=...&action_breakdowns=action_type&level=account&date_preset=last_7d
  ```
  Also fetches `event_match_score` from `/{adAccountId}/signal_quality_metrics` if available.
  Writes `quality_signals: { event_match_score, dedup_rate }`.
  `dedup_rate` = (server_event_count - browser_event_count) / server_event_count where both exist.

### `ga4StatsSync.ts`
- `syncKeyEventStats(connectionId, orgId, clientId)` — GA4 Data API:
  ```
  POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport
  { dimensions: [{name:"keyEventName"},{name:"date"}], metrics:[{name:"keyEvents"}], dateRanges:[{startDate:"7daysAgo",endDate:"yesterday"}] }
  ```
  Upserts per (connection_id, date, event_name).

### `statsOrchestrator.ts` (extend existing file)
- Add `getConnectionsDueForStatsSync()` — connections where `last_stats_synced_at < NOW() - INTERVAL '23 hours'` (needs new column on `platform_connections`)
- Add `runStatsSyncForConnection(job)` — dispatches to platform-specific stats sync

> **Note:** Add `last_stats_synced_at TIMESTAMPTZ` column to `platform_connections` in migration 20260608_001 or as a separate alter.

---

## Sprint 3.C — Delivery + Volume Engine

### Files
```
backend/src/services/reconciliation/engine/
├── deliveryDiff.ts      — EVENT_NOT_RECEIVED, CAPI_DEDUP_LOW
└── volumeDiff.ts        — VOLUME_DELTA_EXCEEDED

backend/src/services/reconciliation/codes/findingCodes.ts   — EXTENDED with 3 new codes
backend/src/services/reconciliation/reconciliationRunner.ts  — EXTENDED: calls delivery + volume diffs
```

### New finding codes (extend `findingCodes.ts`)

| Code | Dimension | Severity | Trigger |
|---|---|---|---|
| `EVENT_NOT_RECEIVED` | delivery | critical | Event in brief's objectives has 0 platform-side counts over the last 7 days |
| `CAPI_DEDUP_LOW` | delivery | warning | Meta `dedup_rate` in `quality_signals` < `dedup_warn_threshold` for last 7 days |
| `VOLUME_DELTA_EXCEEDED` | volume | warning (≤2× tolerance) / error (>2×) | `abs(delta_pct)` > `volume_tolerance_pct` |

### `deliveryDiff.ts`
- `runDeliveryDiff(runId, clientId, briefId, orgId)`:
  1. Load locked objectives + their `recommended_primary_event` / `current_event`
  2. Load `platform_event_stats_daily` for client, last 7 days, SUM by event_name + platform
  3. For each objective × platform in `obj.platforms`:
     - If event_name not found OR `SUM(platform_count) === 0` → `EVENT_NOT_RECEIVED`
  4. For Meta connections: for each event where `quality_signals.dedup_rate` exists:
     - If `dedup_rate < threshold` → `CAPI_DEDUP_LOW`

### `volumeDiff.ts`
- `runVolumeDiff(runId, clientId, briefId, orgId)`:
  1. Load active `platform_event_stats_daily` for client, last 7 days, where `atlas_count IS NOT NULL`
  2. Load tolerance configs for client (most specific match wins: event+platform > event-only > client-wide)
  3. For each (event_name, platform) where `abs(delta_pct) > volume_tolerance_pct`:
     - Severity: `abs(delta_pct) > volume_tolerance_pct * 2` → error, else → warning
     - Fire `VOLUME_DELTA_EXCEEDED` with expected=`{atlas_count, tolerance_pct}`, observed=`{platform_count, delta_pct}`

### `reconciliationRunner.ts` (extend `executeRun`)
- After existing `runConfigDiff` + `runAlignmentDiff`:
  ```typescript
  await runDeliveryDiff(runId, clientId, briefId, orgId);
  await runVolumeDiff(runId, clientId, briefId, orgId);
  ```
- For `post_brief_lock` runs: skip delivery+volume if no stats data yet (no rows in platform_event_stats_daily for client)
- For `scheduled` + `manual` runs: always run all 4 diffs

---

## Sprint 3.D — API Routes

### Files
```
backend/src/api/routes/reconciliation.ts   — EXTENDED with 3 new routes
```

### New routes

```
GET  /api/reconciliation/tolerance?clientId=X
     → list tolerance configs for client

PUT  /api/reconciliation/tolerance
     body: { clientId, eventName?, platform?, volumeTolerancePct?, dedupWarnThreshold?, enabled? }
     → upsert tolerance config (on conflict (org+client+event+platform) update)

GET  /api/reconciliation/stats?clientId=X&days=7&eventName=Y&platform=Z
     → list platform_event_stats_daily rows for client, ordered by date DESC
     → groups: [{ event_name, platform, rows: [{date, platform_count, atlas_count, delta_pct, quality_signals}] }]
```

Validation with Zod on all bodies. All routes behind `authMiddleware` + `planGuard('pro')`.

---

## Sprint 3.E — Frontend Pages

### Files
```
frontend/src/pages/ReconciliationPage.tsx           — /reconciliation/:clientId
frontend/src/pages/ReconciliationRunDetailPage.tsx  — /reconciliation/runs/:id
frontend/src/App.tsx                                — add both routes
frontend/src/components/layout/Sidebar.tsx          — add Reconciliation nav item
frontend/src/lib/api/reconciliationApi.ts           — EXTENDED: tolerance + stats endpoints
frontend/src/store/reconciliationStore.ts           — EXTENDED: fetchStats, tolerance state
```

### `ReconciliationPage.tsx` (`/reconciliation/:clientId`)
- Reads `clientId` from URL params
- Header: client name (fetched from clientApi), "Run now" button → `triggerRun`
- Latest run summary: status badge, timestamp, `total_findings` count chips (critical/warning)
- `<AlignmentMatrix>` (reusing existing component — pass `briefId` of latest brief for this client if one exists)
- Run history table: columns = started_at, run_type, status, total_findings, link to detail
- Empty state when no runs yet

### `ReconciliationRunDetailPage.tsx` (`/reconciliation/runs/:id`)
- Reads `runId` from URL params; fetches via `reconciliationApi.getRun(runId)`
- Header: run type badge, status, duration (finished_at - started_at), platforms_run chips
- Four dimension tabs: Delivery / Config / Alignment / Volume
- Each tab renders `<FindingsList>` (reusing existing component) for that dimension's findings
- "Back to client reconciliation" breadcrumb link

### `Sidebar.tsx` extension
- Under the **MONITOR** group (where Health Dashboard sits), add:
  ```
  <SidebarItem href="/reconciliation" icon={GitCompareArrows} label="Reconciliation" />
  ```
  - `/reconciliation` without clientId redirects to the first client or shows a client picker
  - Badge showing count of open critical findings across all clients

### `App.tsx` additions
```tsx
<Route path="/reconciliation/:clientId" element={<ProtectedRoute><ReconciliationPage /></ProtectedRoute>} />
<Route path="/reconciliation/runs/:id"  element={<ProtectedRoute><ReconciliationRunDetailPage /></ProtectedRoute>} />
```

---

## File Manifest

### New files (Phase 3)
```
supabase/migrations/20260608_001_event_stats_daily.sql
supabase/migrations/20260608_002_tolerance_config.sql

backend/src/services/reconciliation/sync/googleAdsStatsSync.ts
backend/src/services/reconciliation/sync/metaStatsSync.ts
backend/src/services/reconciliation/sync/ga4StatsSync.ts

backend/src/services/reconciliation/engine/deliveryDiff.ts
backend/src/services/reconciliation/engine/volumeDiff.ts

frontend/src/pages/ReconciliationPage.tsx
frontend/src/pages/ReconciliationRunDetailPage.tsx
```

### Modified files (Phase 3)
```
supabase/migrations/20260608_001_event_stats_daily.sql     — includes platform_connections alter
backend/src/services/reconciliation/sync/syncOrchestrator.ts  — add stats sync methods
backend/src/services/reconciliation/codes/findingCodes.ts  — 3 new codes
backend/src/services/reconciliation/reconciliationRunner.ts — call delivery + volume diffs
backend/src/services/queue/jobQueue.ts                     — add reconciliationStatsQueue
backend/src/services/queue/worker.ts                       — 24h cron + stats processor
backend/src/api/routes/reconciliation.ts                   — 3 new routes
frontend/src/lib/api/reconciliationApi.ts                  — tolerance + stats methods
frontend/src/store/reconciliationStore.ts                  — tolerance + stats state
frontend/src/App.tsx                                       — 2 new routes
frontend/src/components/layout/Sidebar.tsx                 — Reconciliation nav item
```

---

## Acceptance Criteria

- [ ] `platform_event_stats_daily` populated for each active connection within 24h of first stats sync
- [ ] `EVENT_NOT_RECEIVED` fires with severity=critical when brief primary event has 0 platform counts over 7 days
- [ ] `CAPI_DEDUP_LOW` fires when Meta dedup rate < threshold
- [ ] `VOLUME_DELTA_EXCEEDED` fires at warning when delta > tolerance, error when delta > 2× tolerance
- [ ] Tolerance config is per-client with event+platform specificity; most specific match wins
- [ ] `GET /api/reconciliation/stats` returns time-series for chart rendering
- [ ] `/reconciliation/:clientId` page loads run history and latest AlignmentMatrix
- [ ] `/reconciliation/runs/:id` shows findings by dimension in 4 tabs
- [ ] Reconciliation nav item appears in sidebar under MONITOR group
- [ ] No Phase 4 Andromeda score changes yet
