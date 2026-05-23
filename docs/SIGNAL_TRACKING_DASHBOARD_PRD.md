# PRD: Signal Tracking Dashboard

| Field | Value |
|---|---|
| Module | Signal Tracking Dashboard |
| Repo | `Vikramj01/AtlasV2` |
| Status | Draft for Claude Code implementation |
| Priority | #1 (foundational visibility surface) |
| Suggested location | `/docs/prd/SIGNAL_TRACKING_DASHBOARD_PRD.md` |
| Date | 2026-05-23 |

---

## Pre-implementation checklist for Claude Code

Before writing any code, verify the following in the current repo state. Several assumptions in this PRD are based on Atlas's documented architecture but should be confirmed against the live codebase:

1. Read `backend/supabase/migrations/20260519_001_capi_dedup.sql` and any later migrations touching `capi_events` to confirm exact schema.
2. Check `backend/src/routes/` for existing route patterns and follow them rather than introducing new ones.
3. Check `frontend/src/pages/` and `frontend/src/components/` for existing layout, navigation, and component patterns. Match them.
4. Confirm the workspace switcher component exists and is reusable for this module.
5. Confirm Tanstack Query is the established server-state pattern (or note the actual pattern in use).
6. Confirm the auth middleware enforcing workspace-scoped RLS on Supabase queries.
7. If any column referenced in this PRD does not exist on `capi_events` (`match_quality_score`, `latency_ms`), include a migration to add them as part of the first PR.

If any of the assumptions above are materially wrong, stop and ask before proceeding.

---

## 1. Context

Atlas is a conversion signal intelligence platform with the following relevant shipped components:

- **Crawl Signal Extractor (CSE)** — Browserbase-driven detection of signals on customer sites. Tables: `crawl_runs`, `crawl_pages`, `detected_signals`, `org_page_scope`. Migration: `20260530_001_crawl_signal_extractor.sql`.
- **Four-layer deduplication architecture** — GTM browser beacon → DB event ID check → Redis click signal check (provider-specific TTLs) → Meta platform-side dedup. Migration `20260519_001_capi_dedup.sql` added `dedup_status`, `dedup_key`, `dedup_matched_at` to `capi_events`.
- **GTM Destinations support** — Two container output schemas, Journey Builder Step 2.5 for container mode selection, four Direct Audit checks (DA-GTM-001 through DA-GTM-004).
- **Andromeda Signal Health** — Five-dimension composite Readiness Score (EMQ monitoring, funnel completeness, signal freshness/latency, dedup health, value parameter coverage). PRD at `/docs/prd/ANDROMEDA_SIGNAL_HEALTH_PRD.md`.

Tech stack: Vite + React Router + Express (not Next.js). Supabase project ID `irirgimsdmnatoxkhcas`. Bull/Redis managed by Render (service ID `red-d7vpjnr7uimc73evp8lg`). Multi-tenant model: Organisation → Workspace → User with Supabase RLS. Brand: Spi3l red `#ec4d37` primary.

## 2. Problem statement

**Audience.** Agency users managing signal infrastructure for multiple clients, and direct customers monitoring their own signal flow.

**Current state.** Signal data is captured in `capi_events` with full dedup tracking, but no UI surface exists to view it. Agencies cannot show clients what Atlas is doing. Direct customers have no operational view into signal health. Andromeda's five dimensions are surfaced only via periodic scoring, not as continuous monitoring.

**Desired state.** A real-time operational dashboard showing every signal Atlas has tracked, with metadata, filters, drill-downs, and aggregated views. Atlas shifts from "monthly check-in via report" to "daily operational tool."

**Why this is the right thing to build first.** The data layer exists, so this is a UI-and-API build with no new pipeline work. The webinar circuit and Voyantis content both treat signal-level audit trail as one of five foundational architecture pillars. Several downstream Atlas builds (Data Quality Monitor alert drilldowns, Auto-insight Reporter context, Shadow Mode comparison, segment bias detection) all need this surface as their substrate.

## 3. Goals

1. Surface real-time signal flow with filtering by workspace, destination, event type, time range, and status.
2. Provide per-signal drill-down showing full payload, dedup status, match quality, latency, response, and Andromeda dimension contributions.
3. Show aggregate metrics: signals over time, by destination, by event type, with trend indicators.
4. Highlight anomalies visually (volume drops, dedup failures, low match quality, latency spikes) — visual surfacing only, not alerting.
5. Tie visual indicators back to Andromeda's five dimensions so the dashboard becomes the operational view of signal health.
6. Support agency multi-client views with proper RLS isolation between workspaces.

## 4. Non-goals

- Sending or modifying signals (Bid Signal Enricher's territory).
- Anomaly *alerting* via email/Slack (Data Quality Monitor's territory; this dashboard surfaces issues visually, DQM pushes them out).
- Cross-customer benchmarking.
- Predicted vs actual LTV comparison (Auto-insight Reporter).
- Mobile-responsive layout for v1 (desktop-first; mobile in a later phase).

## 5. User stories

1. As an agency user managing 5 clients, I switch between client workspaces and see signal flow per client to monitor their campaigns daily.
2. As a direct customer, I see today's signals at a glance and drill into any one that looks wrong (failed dedup, low match quality).
3. As an agency user, I filter by destination (Meta vs Google) and event type (Purchase vs Lead) to investigate platform-specific issues.
4. As an internal support user, I look up a specific `event_id` across customers I have access to in order to debug a client-raised issue.
5. As an analyst, I export a time-bounded set of signals to CSV for offline analysis.

## 6. Functional requirements

### 6.1 Pages and routes

Add under the existing Atlas navigation, in the monitoring / Andromeda area:

| Route | Purpose |
|---|---|
| `/signals` | Main dashboard. Default view: last 24 hours, active workspace, all destinations, all event types. |
| `/signals/:event_id` | Drill-down view for a single signal. |
| `/signals/export` | Export configuration page (CSV download). |

Navigation: add a "Signals" entry in the existing sidebar/topnav (verify the navigation component location in the current repo and add accordingly).

### 6.2 Main dashboard (`/signals`)

Three primary sections, top to bottom.

#### a) Filter bar (sticky at top)

| Filter | Type | Behavior |
|---|---|---|
| Workspace | Single-select for direct users; multi-select for agency users with access to >1 workspace | Defaults to active workspace from existing switcher |
| Time range | Preset (1h, 24h, 7d, 30d) + custom range picker | Default 24h |
| Destination | Multi-select (Meta, Google, all) | Default all |
| Event type | Multi-select, dynamically populated from `event_name` values present in current workspace + range | Default all |
| Status | Multi-select (success, failure, dedup_matched, dedup_orphaned, pending) | Default all |

Filter state syncs to URL query params so views are shareable and bookmarkable.

#### b) Aggregate panel (4-card row)

| Card | Metric | Sparkline / trend |
|---|---|---|
| 1 | Total signals sent in range | 7-day sparkline |
| 2 | Match quality average (EMQ proxy) | Trend arrow vs previous period |
| 3 | Dedup health (% successfully matched) | Trend arrow vs previous period |
| 4 | Average latency (event-to-send, ms) | Trend arrow vs previous period |

Each card is clickable. Clicking filters the main table to that card's relevant subset (e.g., clicking the dedup card filters status to `dedup_orphaned`).

#### c) Signal flow table

Default 50 rows per page, cursor-based pagination.

| Column | Sortable | Notes |
|---|---|---|
| Timestamp (`sent_at`) | Yes (default desc) | Display in user's timezone |
| Destination | No | Icon + label |
| Event name | No | |
| Event ID | No | Clickable → drill-down |
| Workspace | No | Only shown when agency user has multi-workspace filter active |
| Status | No | Badge (success/failure/pending) |
| Dedup status | No | Badge (matched/orphaned/pending) |
| Match quality | Yes | Numeric score 0–10 with color coding |
| Latency | Yes | ms, with color coding for outliers |
| Actions | No | View payload, view response (inline modal or row expansion) |

Visual rules:
- Failed status → red badge
- Dedup orphaned → amber badge
- Match quality < 5 → red text
- Latency > 95th percentile for this workspace → red text

### 6.3 Drill-down view (`/signals/:event_id`)

Full detail page. Sections, top to bottom:

1. **Header** — Event name, destination, timestamp, status badges, workspace
2. **Timeline** — When event occurred (if available from payload), when sent to destination, when dedup decision made, when response received. Visual horizontal timeline.
3. **Payload** — Full `payload` jsonb, rendered as a collapsible tree, with syntax highlighting
4. **Response** — Full `response` jsonb from destination, collapsible tree, syntax highlighting
5. **Andromeda annotations** — Which dimensions this signal contributes to and how. Example: "Contributing to: EMQ score (match quality 8.2/10), dedup health (matched), latency average (180ms)". This section ties the signal back to the operational health metrics.
6. **Related signals** — Other signals with the same `dedup_key`, or same user identifier if available. Up to 10 most recent.

### 6.4 Export (`/signals/export`)

Form with:
- Time range
- Workspace(s)
- Destinations
- Event types
- Format (CSV only for v1)

Submit kicks off an async Bull job. Job writes CSV to Supabase Storage. User receives:
- In-app notification when ready (use existing notification pattern if present; otherwise add a simple toast + polled status)
- Download link valid for 24 hours

Limit: 100k rows per export request. If filters exceed this, show a warning to narrow the range.

## 7. Non-functional requirements

### Performance
- Initial page load < 2s with 1M+ rows in `capi_events` (requires indexes specified in §8)
- Filter changes return within 500ms
- Aggregate cards backed by materialized view, refreshed every 5 min for the rolling 30-day window
- Pagination cursor-based, never offset-based

### Security and RLS
- All queries scoped to user's accessible workspaces via Supabase RLS on `capi_events`
- Agency users see only workspaces where they have explicit membership
- Drill-down route returns 404 (not 403) for events outside the user's workspace access — do not leak existence
- Export jobs include workspace_id checks server-side, not just client-trusted filter params

### Multi-tenancy
- Organisation → Workspace → User model preserved
- Workspace switcher in topnav respected as the source of truth for default filter
- Agency multi-select UI shown only for users with access to >1 workspace

### Accessibility
- Keyboard navigation through table rows (tab, enter to drill down)
- ARIA labels on all interactive elements
- Status indicators never color-only; pair color with text or icon

### Observability
- Add structured logs for each signal API request (workspace_id, filter set, response time, row count)
- Add the dashboard's own queries to the existing query performance monitoring if one exists

## 8. Data model

### 8.1 Existing tables read

- `capi_events` — read-only for this module
- `workspaces`, `workspace_members`, `users` — for RLS / agency multi-select

### 8.2 Expected `capi_events` schema (verify against live)

Required for this module to function:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `org_id` | uuid | FK organisations |
| `workspace_id` | uuid | FK workspaces |
| `event_id` | text | external event ID |
| `event_name` | text | e.g. Purchase, Lead |
| `destination` | text | e.g. meta, google |
| `sent_at` | timestamptz | |
| `payload` | jsonb | request payload sent to destination |
| `response` | jsonb | response from destination |
| `status` | text | success, failure, pending |
| `dedup_status` | text | matched, orphaned, pending (from `20260519_001_capi_dedup.sql`) |
| `dedup_key` | text | (from `20260519_001_capi_dedup.sql`) |
| `dedup_matched_at` | timestamptz | (from `20260519_001_capi_dedup.sql`) |
| `match_quality_score` | numeric(3,1) | **may not exist — add via migration if absent** |
| `latency_ms` | integer | **may not exist — add via migration if absent; can be backfilled from payload timestamps where available** |

### 8.3 New objects

**Materialized view: `mv_signal_aggregates_daily`**

```sql
-- Pseudocode; final form per Claude Code implementation
CREATE MATERIALIZED VIEW mv_signal_aggregates_daily AS
SELECT
  date_trunc('day', sent_at) AS day,
  workspace_id,
  destination,
  event_name,
  count(*) AS signal_count,
  count(*) FILTER (WHERE status = 'success') AS success_count,
  count(*) FILTER (WHERE dedup_status = 'matched') AS dedup_matched_count,
  avg(match_quality_score) AS avg_match_quality,
  avg(latency_ms) AS avg_latency_ms
FROM capi_events
WHERE sent_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4;

CREATE UNIQUE INDEX ON mv_signal_aggregates_daily (day, workspace_id, destination, event_name);
```

Refresh every 5 minutes via a Bull scheduled job. Existing job infrastructure should be reused; do not introduce new schedulers.

**Indexes on `capi_events`** (add if not already present)

```sql
CREATE INDEX IF NOT EXISTS idx_capi_events_workspace_sent ON capi_events (workspace_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_workspace_dest_sent ON capi_events (workspace_id, destination, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_dedup_status ON capi_events (workspace_id, dedup_status, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_capi_events_event_id ON capi_events (workspace_id, event_id);
```

**Migration filename**: `backend/supabase/migrations/20260524_001_signal_tracking_dashboard.sql` (or next available date; follow existing convention).

## 9. API endpoints

Add to existing Express backend, in `backend/src/routes/signals/` (or per existing route organisation pattern).

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/signals` | Paginated list with filters |
| GET | `/api/signals/:event_id` | Single signal detail |
| GET | `/api/signals/aggregates` | Aggregate card data |
| POST | `/api/signals/export` | Kick off async export job |
| GET | `/api/signals/export/:job_id` | Poll export job status; return download URL when ready |

### Query parameters for list and aggregates

| Param | Type | Default |
|---|---|---|
| `workspace_ids` | comma-separated uuids | active workspace |
| `from` | ISO timestamp | now - 24h |
| `to` | ISO timestamp | now |
| `destinations` | comma-separated strings | all |
| `event_names` | comma-separated strings | all |
| `statuses` | comma-separated strings | all |
| `cursor` | opaque string | null (first page) |
| `limit` | integer | 50 (max 200) |

All endpoints enforce workspace-scoped RLS via the existing auth middleware. Filter params for `workspace_ids` are intersected with the user's accessible workspaces server-side, never trusted as-is.

## 10. Frontend implementation

### Component structure

```
frontend/src/pages/signals/
  index.tsx              -- main dashboard
  [event_id].tsx         -- drill-down
  export.tsx             -- export config
frontend/src/components/signals/
  SignalFilterBar.tsx
  SignalAggregateCard.tsx
  SignalFlowTable.tsx
  SignalPayloadViewer.tsx
  SignalTimeline.tsx
  AndromedaAnnotations.tsx
frontend/src/hooks/signals/
  useSignals.ts          -- list query
  useSignalDetail.ts     -- single signal query
  useSignalAggregates.ts -- aggregate cards query
  useSignalExport.ts     -- export job mutation + polling
```

### Real-time refresh

Polling every 30s via Tanstack Query `refetchInterval` when dashboard is visible. Pause polling when tab hidden (`refetchIntervalInBackground: false`). No websocket / Supabase Realtime subscription in v1 — revisit if poll load becomes meaningful.

### Visual treatment

- Spi3l red `#ec4d37` for primary actions and alert states
- Match existing card and table styling — verify in current Atlas components, do not introduce new design tokens
- jsonb viewers use a syntax-highlighted collapsible tree component; use an existing library if Atlas already has one, otherwise pick a lightweight one (e.g., `react-json-tree`) and document the choice

## 11. Acceptance criteria

The module is complete when:

1. An agency user logs in, switches between two client workspaces via the existing switcher, and sees correctly isolated signal flow for each.
2. Filters (workspace, time, destination, event type, status) update both aggregate cards and the table within 500ms.
3. URL query params reflect current filter state; pasting the URL in a new tab reproduces the same view.
4. A signal row clicked opens the drill-down with full payload, response, timeline, and Andromeda annotations.
5. Aggregate cards show values no more than 5 minutes stale and clicking a card filters the table appropriately.
6. CSV export works for a 7-day window with 10k+ rows, completes within 60s, and notifies the user on completion.
7. RLS verified: a user from workspace A cannot retrieve a signal from workspace B via direct URL access to `/signals/:event_id`. Test included.
8. Performance verified: page load < 2s with 1M rows in `capi_events`. Load test included or scripted.
9. Andromeda dimensions visually present: low match quality signals highlighted, dedup orphans visually distinct, latency outliers visually distinct.
10. All endpoints have integration tests covering workspace isolation, filter validation, and pagination.

## 12. Implementation phasing

If breaking into smaller PRs:

| Phase | Scope |
|---|---|
| 1 | Migration (`capi_events` indexes + missing columns if any) + `GET /api/signals` + `GET /api/signals/:event_id` with tests |
| 2 | Frontend `/signals` page with filter bar and signal flow table |
| 3 | Materialized view + aggregate cards + scheduled refresh job |
| 4 | Drill-down view with payload viewer, timeline, Andromeda annotations |
| 5 | Async CSV export via Bull |

Phases 1 and 2 together constitute the minimum useful release.

## 13. Open questions to resolve in implementation

1. Do `match_quality_score` and `latency_ms` columns exist on `capi_events`? If not, add via migration and backfill from `payload`/`response`.
2. Should the dashboard include signals detected by Crawl Signal Extractor (not yet sent)? Recommendation: no — CSE has its own view, and this dashboard is specifically for outbound signals. Confirm with product.
3. What is the existing notification pattern for async job completion (toast, in-app inbox, email)? Use whatever exists rather than inventing new.
4. Is there an existing rate-limit pattern for expensive endpoints? Apply it to `GET /api/signals/aggregates` since it hits the materialized view.

## 14. Future considerations (do not implement now)

- **Shadow Mode column** — when Bid Signal Enricher ships, `capi_events` will gain a `signal_mode` (production / shadow) column. The indexes proposed here should still work; the filter bar will need a Mode filter added then.
- **Segment bias view** — a future Andromeda dimension that compares signal volume and value distribution across device/geo/time-of-day segments will use this same data layer. Keep aggregations extensible.
- **Mobile layout** — defer to v2.
- **Realtime via Supabase Realtime subscriptions** — defer; revisit if polling load becomes a concern.

## 15. Coordination with other modules

| Module | Relationship |
|---|---|
| Data Quality Monitor (next build) | DQM alerts will deep-link to specific signals on this dashboard. Ensure URLs are stable and filter state is URL-encoded. |
| Auto-insight Reporter | Will reference signal-level data; coordinate on shared query patterns. |
| Bid Signal Enricher | Once live, will populate `capi_events` more heavily. Indexes designed here should hold. |
| Andromeda Signal Health | This dashboard is the operational surface for Andromeda's five dimensions. PRD reference: `/docs/prd/ANDROMEDA_SIGNAL_HEALTH_PRD.md`. |
| Conversion Strategy Gate | No direct dependency, but signal shape changes recommended by the Strategy Gate should be reflected in `event_name` patterns visible here. |
