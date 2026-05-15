# Platform Reconciliation — Phase 2 Sprint Plan: Config Audit & Strategic Alignment

Source PRD: `docs/PLATFORM_RECONCILIATION_PRD.md` (sections 6.2, 6.3, 6.5, 6.6, 10, 11, 12, 14, 16)
Implementation branch: `claude/platform-reconciliation-sprint-plan-s5Qmu`

---

## Phase 2 Goal

After Phase 1 established the connection plumbing (OAuth, discovery, lifecycle), Phase 2 adds the first reconciliation intelligence layer: pull platform-side configuration (conversion actions, campaign goals) on a schedule, diff it against the locked Strategy Gate brief, write structured findings, and surface them in the Strategy Gate locked brief view.

When Phase 2 is complete:
- Every active connection has its conversion actions and campaign goals populated in the platform state cache within 6h
- Locking a Strategy Gate brief triggers a one-shot reconciliation run that completes within 5 minutes
- The locked brief view shows a per-objective, per-platform alignment matrix (green/amber/red)
- Config and alignment finding codes generate when their conditions are met
- Findings are readable via API and filterable in the brief view

**What Phase 2 does NOT do:** delivery verification (Phase 3), daily stats sync (Phase 3), Andromeda score integration (Phase 4).

---

## Architecture (Phase 2 additions)

```
6h Bull repeatable job per connection
   └── syncOrchestrator.ts
         ├── googleAdsSync.ts  → platform_conversion_actions + platform_campaign_goals
         ├── metaSync.ts       → custom conversions + AEM priorities + campaigns
         └── ga4Sync.ts        → key events list

strategy_briefs.locked_at updated
   └── reconciliationWorker.ts (post_brief_lock)
         ├── configDiff.ts     → config findings (ATTRIBUTION_MODEL_MISMATCH etc.)
         ├── alignmentDiff.ts  → alignment findings (WRONG_PRIMARY_CONVERSION etc.)
         └── findingWriter.ts  → writes reconciliation_findings

GET /api/reconciliation/runs
GET /api/reconciliation/runs/:id
GET /api/reconciliation/runs/:id/findings
PATCH /api/reconciliation/findings/:id/resolve
POST /api/reconciliation/trigger

BriefLocked.tsx ← AlignmentMatrix.tsx (reads latest run for this brief)
```

---

## Sprint Overview

| Sprint | Focus | Key Deliverables |
|---|---|---|
| **2.A** | Schema | 2 migrations: platform state cache + reconciliation core |
| **2.B** | Sync Workers | googleAdsSync, metaSync, ga4Sync, syncOrchestrator, Bull queue/worker registration |
| **2.C** | Reconciliation Engine | findingCodes, configDiff, alignmentDiff, findingWriter |
| **2.D** | API Routes + Post-Lock Trigger | reconciliation.ts routes, post-brief-lock Bull job hook |
| **2.E** | Frontend | reconciliationApi, reconciliationStore, AlignmentMatrix, FindingsList/Card/Filters, BriefLocked extension |

---

## Sprint 2.A — Schema

### Files
- `supabase/migrations/20260607_001_platform_state_cache.sql`
- `supabase/migrations/20260607_002_reconciliation_core.sql`

### Migration 1: Platform State Cache

Creates `platform_conversion_actions` (section 6.2) and `platform_campaign_goals` (section 6.3).

```sql
CREATE TABLE IF NOT EXISTS platform_conversion_actions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id       UUID NOT NULL,
  external_id           TEXT NOT NULL,
  name                  TEXT NOT NULL,
  status                TEXT,
  category              TEXT,
  primary_for_goal      BOOLEAN,
  attribution_model     TEXT,
  counting_type         TEXT,
  click_lookback_days   INTEGER,
  view_lookback_days    INTEGER,
  value_settings        JSONB,
  include_in_conversions BOOLEAN,
  aem_priority          INTEGER,
  raw                   JSONB,
  observed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_id)
);
ALTER TABLE platform_conversion_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org pca" ON platform_conversion_actions
  FOR ALL USING (organization_id = auth.uid());
CREATE INDEX idx_pca_connection ON platform_conversion_actions (connection_id);

CREATE TABLE IF NOT EXISTS platform_campaign_goals (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id                   UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  organization_id                 UUID NOT NULL,
  external_campaign_id            TEXT NOT NULL,
  campaign_name                   TEXT NOT NULL,
  campaign_type                   TEXT,
  status                          TEXT,
  optimization_goal               TEXT,
  selective_optimization_actions  TEXT[],
  custom_event_type               TEXT,
  budget_micros                   BIGINT,
  raw                             JSONB,
  observed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, external_campaign_id)
);
ALTER TABLE platform_campaign_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org pcg" ON platform_campaign_goals
  FOR ALL USING (organization_id = auth.uid());
CREATE INDEX idx_pcg_connection ON platform_campaign_goals (connection_id);
```

### Migration 2: Reconciliation Core

Creates `reconciliation_runs` (section 6.5) and `reconciliation_findings` (section 6.6).

```sql
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL,
  client_id        UUID NOT NULL,          -- soft ref, no FK (preview env safety)
  brief_id         UUID REFERENCES strategy_briefs(id),
  run_type         TEXT NOT NULL CHECK (run_type IN ('scheduled','manual','post_brief_lock')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','succeeded','partial','failed')),
  platforms_run    TEXT[] NOT NULL,
  total_findings   INTEGER DEFAULT 0,
  error_summary    TEXT
);
ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org runs" ON reconciliation_runs
  FOR ALL USING (organization_id = auth.uid());

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL,
  client_id         UUID NOT NULL,
  brief_id          UUID REFERENCES strategy_briefs(id),
  objective_id      UUID REFERENCES strategy_objectives(id),
  platform          TEXT NOT NULL,
  dimension         TEXT NOT NULL CHECK (dimension IN ('delivery','config','alignment','volume')),
  severity          TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  finding_code      TEXT NOT NULL,
  expected          JSONB,
  observed          JSONB,
  narrative         TEXT NOT NULL,
  remediation_hint  TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE reconciliation_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own org findings" ON reconciliation_findings
  FOR ALL USING (organization_id = auth.uid());
CREATE INDEX idx_findings_client_unresolved ON reconciliation_findings (client_id)
  WHERE resolved_at IS NULL;
CREATE INDEX idx_findings_brief ON reconciliation_findings (brief_id)
  WHERE brief_id IS NOT NULL;
CREATE INDEX idx_findings_run ON reconciliation_findings (run_id);
```

---

## Sprint 2.B — Sync Workers

### Files
```
backend/src/services/reconciliation/sync/
├── googleAdsSync.ts     — conversion actions + campaigns via GAQL
├── metaSync.ts          — custom conversions + AEM + ad sets
├── ga4Sync.ts           — key events via Admin API
└── syncOrchestrator.ts  — picks connections due, enqueues jobs

backend/src/services/queue/jobQueue.ts    — add reconciliationSyncQueue
backend/src/services/queue/worker.ts      — register reconciliation sync processor + 6h repeatable
```

### `googleAdsSync.ts`
- `syncConversionActions(connectionId, orgId)` — GAQL `SELECT conversion_action.*` against the account; upserts into `platform_conversion_actions`
- `syncCampaignGoals(connectionId, orgId)` — GAQL `SELECT campaign.id, campaign.name, campaign.status, campaign.selective_optimization_conversion_actions FROM campaign`; upserts into `platform_campaign_goals`

### `metaSync.ts`
- `syncCustomConversions(connectionId, orgId)` — `GET /{ad_account_id}/customconversions?fields=id,name,event_source_url,custom_event_type,rule,creation_time&limit=500`
- `syncAemPriorities(connectionId, orgId)` — `GET /{ad_account_id}/customconversions?fields=id,name,event_source_url,custom_event_type,rule,creation_time,pixel_id,data_sources&limit=500` (AEM pixel ordering)
- `syncCampaigns(connectionId, orgId)` — `GET /{ad_account_id}/campaigns?fields=id,name,status,objective,optimization_goal,promoted_object,budget_remaining&limit=200`

### `ga4Sync.ts`
- `syncKeyEvents(connectionId, orgId)` — `GET https://analyticsadmin.googleapis.com/v1beta/properties/{propertyId}/keyEvents`; stores each key event as a row in `platform_conversion_actions` (with `platform='ga4'`)

### `syncOrchestrator.ts`
- `getConnectionsDueForSync()` — queries active connections where `last_synced_at < NOW() - INTERVAL '5.5 hours'` (leaves buffer before 6h cadence)
- `enqueueConfigSync(connectionId)` — adds to `reconciliationSyncQueue`
- `runConfigSyncForConnection(connectionId, orgId)` — dispatches to platform-specific sync based on connection.platform; updates `last_synced_at` on completion

---

## Sprint 2.C — Reconciliation Engine

### Files
```
backend/src/services/reconciliation/engine/
├── configDiff.ts     — compares brief recommendations vs platform_conversion_actions
├── alignmentDiff.ts  — compares brief primary/secondary/suppression tiers vs platform_campaign_goals
└── findingWriter.ts  — upserts findings into reconciliation_findings

backend/src/services/reconciliation/codes/
└── findingCodes.ts   — enum, severity map, narrative templates
```

### `findingCodes.ts`
Defines all Phase 2 finding codes and narrative templates:
- `ATTRIBUTION_MODEL_MISMATCH` (config / warning)
- `COUNTING_TYPE_MISMATCH` (config / warning)
- `LOOKBACK_WINDOW_SHORT` (config / info)
- `AEM_PRIORITY_TOO_LOW` (config / critical) — triggered when `aem_priority >= 9`
- `VALUE_SETTINGS_MISSING` (config / warning)
- `WRONG_PRIMARY_CONVERSION` (alignment / critical)
- `MISSING_PRIMARY_CONVERSION` (alignment / critical)
- `SUPPRESSION_USED_AS_PRIMARY` (alignment / critical)

### `configDiff.ts`
- `runConfigDiff(runId, clientId, briefId, orgId)` — loads locked brief objectives + their `platform_action_types`, loads `platform_conversion_actions` for the client's active connections, diffs each:
  - Attribution model: brief `platform_action_types.google_ads.attribution_model` vs `platform_conversion_actions.attribution_model`
  - Counting type: one-per-click vs every-conversion check
  - Lookback window: brief-recommended vs `click_lookback_days`
  - AEM priority: Meta only — `aem_priority >= 9` → critical
  - Value settings: if brief objective recommends value-based bidding and `value_settings` is null → warning

### `alignmentDiff.ts`
- `runAlignmentDiff(runId, clientId, briefId, orgId)` — loads locked brief objectives + tiers, loads `platform_campaign_goals`, diffs:
  - `WRONG_PRIMARY_CONVERSION`: campaign's `selective_optimization_actions` list does not include the brief's primary conversion external_id
  - `MISSING_PRIMARY_CONVERSION`: brief primary conversion action does not exist in `platform_conversion_actions` at all
  - `SUPPRESSION_USED_AS_PRIMARY`: brief tier=suppression but campaign is optimising on it

### `findingWriter.ts`
- `writeFinding(finding)` — upserts into `reconciliation_findings`
- `closeFindingsByRun(runId)` — finalises run: counts total findings, sets `finished_at`, sets status to `succeeded` or `partial`

---

## Sprint 2.D — API Routes + Post-Lock Trigger

### Files
```
backend/src/api/routes/reconciliation.ts
backend/src/services/reconciliation/reconciliationRunner.ts  — orchestrates a full run
backend/src/api/routes/connections.ts                        — extend /:id/sync to 200 (no longer 501)
backend/src/app.ts                                           — mount reconciliationRouter
```

### `reconciliation.ts` routes
- `GET /api/reconciliation/runs?clientId=X` — list runs for a client, ordered by `started_at DESC`
- `GET /api/reconciliation/runs/:id` — run detail + findings grouped by dimension
- `GET /api/reconciliation/runs/:id/findings` — findings for a run with optional `?dimension=&severity=&platform=&resolved=`
- `PATCH /api/reconciliation/findings/:id/resolve` — set `resolved_at = NOW()`
- `POST /api/reconciliation/trigger` — body: `{ clientId, briefId? }` — enqueues manual run immediately

### Post-lock trigger
In `backend/src/api/routes/strategy.ts` (existing), when `POST /api/strategy/briefs/:id/lock` succeeds, enqueue a `post_brief_lock` reconciliation run job.

---

## Sprint 2.E — Frontend

### Files
```
frontend/src/lib/api/reconciliationApi.ts
frontend/src/store/reconciliationStore.ts
frontend/src/components/reconciliation/
├── AlignmentMatrix.tsx         — per-objective per-platform traffic-light grid
├── FindingCard.tsx             — severity icon, finding_code, narrative, remediation hint, resolve button
├── FindingsList.tsx            — filtered list of FindingCards
└── FindingFilters.tsx          — filter bar: platform, dimension, severity, resolved toggle
frontend/src/components/strategy/BriefLocked.tsx  — extension: AlignmentMatrix + trigger button
```

### `reconciliationApi.ts`
- `listRuns(clientId)`, `getRun(runId)`, `getFindings(runId, filters)`, `resolveFinding(findingId)`, `triggerRun(clientId, briefId?)`

### `reconciliationStore.ts`
- State: `runs`, `currentRun`, `findings`, `filters`, `triggering`, `loading`, `error`
- Actions: `fetchRuns`, `fetchFindings`, `resolveFinding`, `triggerRun`

### `AlignmentMatrix.tsx`
- Input: `briefId` (fetches latest post_brief_lock run for this brief)
- Renders a grid: rows = objectives, cols = platforms (Google Ads, Meta, GA4)
- Each cell: green (no open critical/error findings) / amber (warnings) / red (critical/error findings)
- Clicking a cell scrolls to that finding in the findings list below

### `BriefLocked.tsx` extension
- After the existing objectives list, add:
  - "Live Alignment" section heading
  - `<AlignmentMatrix briefId={brief.id} />`
  - Collapsed findings list (expandable)
  - "Re-run reconciliation" button → `triggerRun(brief.client_id, brief.id)`

---

## File Manifest

### New files (Phase 2)
```
supabase/migrations/20260607_001_platform_state_cache.sql
supabase/migrations/20260607_002_reconciliation_core.sql

backend/src/services/reconciliation/sync/googleAdsSync.ts
backend/src/services/reconciliation/sync/metaSync.ts
backend/src/services/reconciliation/sync/ga4Sync.ts
backend/src/services/reconciliation/sync/syncOrchestrator.ts
backend/src/services/reconciliation/engine/configDiff.ts
backend/src/services/reconciliation/engine/alignmentDiff.ts
backend/src/services/reconciliation/engine/findingWriter.ts
backend/src/services/reconciliation/codes/findingCodes.ts
backend/src/services/reconciliation/reconciliationRunner.ts
backend/src/api/routes/reconciliation.ts

frontend/src/lib/api/reconciliationApi.ts
frontend/src/store/reconciliationStore.ts
frontend/src/components/reconciliation/AlignmentMatrix.tsx
frontend/src/components/reconciliation/FindingCard.tsx
frontend/src/components/reconciliation/FindingsList.tsx
frontend/src/components/reconciliation/FindingFilters.tsx
```

### Modified files (Phase 2)
```
backend/src/services/queue/jobQueue.ts         — add reconciliationSyncQueue
backend/src/services/queue/worker.ts           — register processor + 6h repeatable job
backend/src/app.ts                             — mount /api/reconciliation
backend/src/api/routes/connections.ts          — un-stub /:id/sync
backend/src/api/routes/strategy.ts             — post-lock trigger
backend/src/config/env.ts                      — no new vars needed (uses Phase 1 vars)
frontend/src/components/strategy/BriefLocked.tsx
```

---

## Acceptance Criteria

- [ ] After connecting a Google Ads account, within 6h `platform_conversion_actions` and `platform_campaign_goals` are populated for that connection
- [ ] Locking a strategy brief enqueues a `post_brief_lock` run; run completes within 5 min
- [ ] Locked brief view shows AlignmentMatrix with per-objective per-platform traffic lights
- [ ] `WRONG_PRIMARY_CONVERSION` fires when campaign's optimisation conversion ≠ brief primary
- [ ] `MISSING_PRIMARY_CONVERSION` fires when brief primary conversion action doesn't exist in account
- [ ] `SUPPRESSION_USED_AS_PRIMARY` fires when suppression-tier event is a campaign's primary conversion
- [ ] `AEM_PRIORITY_TOO_LOW` fires with severity=critical when Meta AEM rank ≥ 9
- [ ] `ATTRIBUTION_MODEL_MISMATCH` fires when conversion action model differs from brief recommendation
- [ ] `VALUE_SETTINGS_MISSING` fires when value-based bidding is recommended but no default value set
- [ ] Findings are filterable by platform, dimension, severity, and resolved state
- [ ] Manual re-run via UI button works and re-renders the alignment matrix
- [ ] No Phase 3 stats sync runs yet; `platform_event_stats_daily` table not yet created
