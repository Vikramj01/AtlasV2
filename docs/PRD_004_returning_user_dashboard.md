# PRD-004: Returning User Steady-State Dashboard

**Product:** Atlas V2 — `atlas.vimi.digital`
**Repo:** `Vikramj01/AtlasV2`
**Status:** Ready for implementation
**Depends on:** PRD-001 (Tracking Hub), PRD-002 (Onboarding Checklist)
**Parallel with:** PRD-003, PRD-005
**Primary persona:** Agency operator returning to Atlas after initial setup is complete

---

## 1. Overview

Once an agency operator completes onboarding (PRD-002), `DashboardPage` currently has nothing meaningful to show them. The platform's monitoring data — IHC drift findings, DQM status, platform reconciliation results, CAPI event health — lives across five separate pages. A returning operator has no single surface that answers "what's broken, what changed, and what do I need to do?"

This PRD transforms `DashboardPage` into a **steady-state operations view** for returning users. It is not a new page — it is a new state of the existing `DashboardPage`, which already shows the onboarding checklist for new users (PRD-002). Once the operator is onboarded, the same route renders this dashboard.

The dashboard answers three questions in one view:
1. **What needs my attention right now?** — aggregated alerts across all modules, all clients
2. **What changed since I was last here?** — time-anchored delta against previous login
3. **Which clients have issues?** — per-client health cards with one-click drill-down

---

## 2. User Stories

- As a returning agency operator, I want to see all outstanding issues across all my clients in one place the moment I log in
- As a returning agency operator, I want to know what changed since my last session without visiting five separate monitoring pages
- As a returning agency operator, I want to know which specific client and which module generated each issue, and go directly to it
- As a returning agency operator, I want a health summary per client so I can prioritise where to spend time

---

## 3. Scope

**In scope:**
- `DashboardPage` steady-state view (renders when `onboarding_status.overall_status = 'complete'`)
- `GET /api/dashboard/summary` aggregator endpoint
- `POST /api/auth/record-login` — updates `last_login_at` and returns previous value
- Alert feed component aggregating: IHC findings, DQM failures, Reconciliation findings, health score drops
- Client health cards (reuses `ClientStatusBadge` and `ClientHealthBadge` from PRD-003)
- Org snapshot metrics strip
- "Mark as reviewed" action on individual alerts
- Per-alert deep-link to the originating module page

**Out of scope:**
- Per-client detailed health page (that's `HealthDashboardPage`, already exists)
- Signal Tracking Dashboard (separate page, already exists)
- CAPI event log (separate tab on `CAPIPage`, already exists)
- Any new monitoring logic — this PRD consumes existing monitoring data, it does not produce new monitoring

---

## 4. Migration

**File:** `supabase/migrations/20260701_004_returning_user_dashboard.sql`

> Replace `20260701` with the actual next sequential date.

```sql
-- Track last login time per user
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'profiles') THEN
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS previous_login_at TIMESTAMPTZ;
  END IF;
END $$;

-- Track alert review state (so "Mark as reviewed" persists)
CREATE TABLE IF NOT EXISTS dashboard_alert_reviews (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_table      TEXT        NOT NULL,  -- 'audit_findings' | 'reconciliation_findings' | 'dqm_gtg_checks'
  source_id         UUID        NOT NULL,
  reviewed_by       UUID        REFERENCES profiles(id),
  reviewed_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, source_table, source_id)
);

ALTER TABLE dashboard_alert_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members access alert reviews"
  ON dashboard_alert_reviews
  USING (organization_id = auth.uid())
  WITH CHECK (organization_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_alert_reviews_lookup
  ON dashboard_alert_reviews(organization_id, source_table, source_id);
```

---

## 5. Backend

### 5.1 New endpoint: `POST /api/auth/record-login`

Call this from the frontend on every app initialisation after Supabase auth confirms a session. Updates the login timestamp and returns the previous one so the dashboard can label the delta.

**Auth:** `authMiddleware`.

**No request body.**

**Logic:**
1. Fetch `last_login_at` from `profiles` WHERE `id = req.user.id` — store as `previous_login_at`
2. Update `profiles`: `previous_login_at = last_login_at`, `last_login_at = NOW()`
3. Return both values

**Response:**
```ts
{
  data: {
    last_login_at: string        // just set — NOW()
    previous_login_at: string | null   // what it was before this login
  }
  error: string | null
  message: string | null
}
```

---

### 5.2 New route file: `backend/src/api/routes/dashboard.ts`

Register at `/api/dashboard`. This may already exist — check for an existing dashboard route before creating a new file.

#### `GET /api/dashboard/summary`

The primary aggregator. Called once on `DashboardPage` mount when `onboarding_status = 'complete'`.

**Auth:** `authMiddleware`. Resolve `organization_id` from profiles.

**Query param:** `?since=ISO_TIMESTAMP` (optional) — if provided, uses this as the delta baseline instead of `previous_login_at`. Allows the user to change the "since" window.

**Response shape:**
```ts
{
  data: {
    delta: {
      since_label: string          // "Since 3 days ago" | "Since your last visit on [date]" | "Since [date]"
      since_timestamp: string      // ISO timestamp used as the delta baseline
      new_alerts_count: number     // alerts with created_at > since_timestamp
    }

    alerts: Array<{
      id: string                   // UUID from source table
      source_table: string         // 'audit_findings' | 'reconciliation_findings' | 'dqm_gtg_checks' | 'health_drop'
      client_id: string | null
      client_name: string | null
      module: 'ihc' | 'dqm' | 'reconciliation' | 'health'
      severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
      title: string                // short human-readable title, generated server-side
      description: string
      created_at: string
      is_new: boolean              // created_at > since_timestamp
      is_reviewed: boolean         // exists in dashboard_alert_reviews
      action_url: string           // deep-link to the finding in the relevant module page
      // e.g. "/reconciliation/runs/:id" | "/implementation-health?client=:id" | "/health"
    }>

    clients: Array<{               // same shape as PRD-003 GET /api/clients/summary
      id: string
      name: string
      setup_status: 'not_started' | 'in_progress' | 'complete'
      health_level: 'healthy' | 'warning' | 'critical' | 'unknown'
      signals_count: number
      platforms_connected: string[]
      last_verified_at: string | null
      open_findings_count: number
    }>

    org_metrics: {
      total_clients: number
      total_signals_monitored: number
      capi_events_24h: number
      avg_match_quality_7d: number | null    // from mv_signal_aggregates_daily
      clients_with_issues: number
    }
  }
  error: string | null
  message: string | null
}
```

**Alert sources and how to query each:**

| Source | Table | Filter | Title template | Action URL |
|---|---|---|---|---|
| IHC drift | `audit_findings` | `resolved_at IS NULL` AND not in `dashboard_alert_reviews` | "[rule_id] failed on [client_name]" | `/implementation-health?client_id=:client_id` |
| Reconciliation | `reconciliation_findings` | `resolved_at IS NULL` AND not reviewed | "[dimension] gap detected for [event_name] on [platform]" | `/reconciliation/runs/:run_id` |
| DQM failure | `dqm_gtg_checks` | `check_status = 'fail'` AND `checked_at > (NOW() - INTERVAL '24 hours')` | "GTG endpoint failing for [org]" | `/health` |
| Health drop | Compare latest vs previous `health_snapshots` | Drop > 5 points since `since_timestamp` | "Health score dropped from X to Y" | `/health` |

**Alert enrichment:** Join `audit_findings` and `reconciliation_findings` with `clients` to get `client_name`. For DQM and health alerts, `client_id` may be NULL (org-level).

**`action_url` construction:** Build from known route patterns. These are internal SPA routes (no hostname needed).

**`title` generation:** Build server-side using the templates above. Do not call Claude API for alert titles — these are formulaic.

**Performance:** Run all four source queries in `Promise.all`. For the clients array, reuse the same derivation logic as `GET /api/clients/summary` (PRD-003) — extract to a shared service function `getClientSummaries(orgId)`.

**New service:** `backend/src/services/dashboard/dashboardSummaryService.ts`
- `getAlerts(orgId, sinceTimestamp)` — runs the four source queries
- `getOrgMetrics(orgId)` — runs counts and aggregates
- Calls `getClientSummaries(orgId)` from the shared client summary service

---

#### `POST /api/dashboard/alerts/review`

Marks one or more alerts as reviewed. Persists to `dashboard_alert_reviews`.

**Auth:** `authMiddleware`.

**Request body (Zod-validated):**
```ts
{
  reviews: z.array(z.object({
    source_table: z.enum(['audit_findings', 'reconciliation_findings', 'dqm_gtg_checks', 'health_drop']),
    source_id: z.string().uuid(),
  })).min(1).max(50)
}
```

**Logic:** Upsert into `dashboard_alert_reviews` for each item.

**Response:** `{ data: { reviewed_count: number }, error, message }`

---

## 6. Frontend

### 6.1 Modify: `frontend/src/pages/DashboardPage.tsx`

`DashboardPage` now renders one of three states based on the onboarding store (from PRD-002):

```tsx
function DashboardPage() {
  const onboardingStatus = useOnboardingStore(s => s.status)
  const isOnboardingComplete = onboardingStatus?.overall_status === 'complete'

  if (!onboardingStatus) return <DashboardSkeleton />

  if (!isOnboardingComplete) {
    return (
      <>
        <OnboardingChecklist />
        {/* Existing partial dashboard content if any */}
      </>
    )
  }

  return <ReturningUserDashboard />
}
```

`onboardingStore.fetchStatus()` is already called on mount by PRD-002. No additional fetch needed here — render reactively from store state.

---

### 6.2 New component: `frontend/src/components/dashboard/ReturningUserDashboard.tsx`

Top-level container for the steady-state dashboard. Calls `GET /api/dashboard/summary` on mount, stores in `dashboardStore`.

**Layout (top to bottom):**

1. `<DeltaHeader />` — "What changed since [label]"
2. `<OrgMetricsStrip />` — snapshot numbers
3. Two-column layout (2:1 ratio on desktop, stacked on mobile):
   - Left (wide): `<AlertFeed />`
   - Right (narrow): `<ClientHealthList />`

---

### 6.3 New component: `frontend/src/components/dashboard/DeltaHeader.tsx`

Displays the "since last visit" context and alert count.

```
Welcome back. You were last here [X days ago / on [date]].
[N new alert(s)] since your last visit.   [Change window ▾]
```

"Change window" dropdown lets user select: Last 24h / Last 7 days / Last 30 days / Since last login (default). Selecting a value appends `?since=...` to the summary call.

Props: `delta: DashboardSummary['delta']`

---

### 6.4 New component: `frontend/src/components/dashboard/OrgMetricsStrip.tsx`

A horizontal strip of 5 metric tiles:

| Tile | Value | Source |
|---|---|---|
| Clients | N total | `org_metrics.total_clients` |
| Signals monitored | N | `org_metrics.total_signals_monitored` |
| Clients with issues | N | `org_metrics.clients_with_issues` |
| CAPI events (24h) | N | `org_metrics.capi_events_24h` |
| Avg match quality (7d) | X% | `org_metrics.avg_match_quality_7d` |

Each tile links to the relevant page: Clients → `/clients`, CAPI → `/capi`, match quality → `/capi`.

---

### 6.5 New component: `frontend/src/components/dashboard/AlertFeed.tsx`

The main action surface. Renders the sorted alert list.

**Default sort:** is_new DESC, severity order (critical → high → medium → low), created_at DESC.

**Filter tabs:** All / New / IHC / DQM / Reconciliation / Health

**Each alert row renders `<AlertRow />`:**

```
[severity icon] [client badge]  [module badge]  [NEW pill if is_new]
[title]
[description — max 2 lines, truncated]
[created_at — relative time]          [Mark reviewed] [→ View]
```

**"Mark reviewed"** calls `POST /api/dashboard/alerts/review` with that alert's source. On success, dims the row but does not remove it (user may want to navigate to it). "Reviewed" alerts move to the bottom on next page load.

**"View"** navigates to `alert.action_url`.

**Empty state (no alerts):** "No issues to report. Everything looks good."

**If all alerts are reviewed:** "You're up to date. All issues have been reviewed."

---

### 6.6 New component: `frontend/src/components/dashboard/AlertRow.tsx`

Renders a single alert. Props: `alert: DashboardAlert`, `onReview: (alert: DashboardAlert) => void`.

Severity icon colours:
- `critical`: red
- `high`: orange
- `medium`: amber
- `low`: blue
- `info`: grey

---

### 6.7 New component: `frontend/src/components/dashboard/ClientHealthList.tsx`

Right-column client list. Compact version of the cards from `ClientListPage` (PRD-003).

Shows: client name, health badge, open findings count, "View" button → `/clients/:clientId/tracking`.

Sorted by health_level: critical first, then warning, then healthy, then unknown.

If more than 8 clients: "Show all X clients →" link to `/clients`.

---

### 6.8 New store: `frontend/src/store/dashboardStore.ts`

```ts
interface DashboardStore {
  summary: DashboardSummary | null
  isLoading: boolean
  error: string | null
  sinceTimestamp: string | null   // current delta window

  // Actions
  fetchSummary: (since?: string) => Promise<void>
  reviewAlert: (sourceTable: string, sourceId: string) => Promise<void>
  reviewAll: () => Promise<void>
  setSinceTimestamp: (iso: string) => void
  reset: () => void
}
```

---

### 6.9 New API client: `frontend/src/lib/api/dashboardApi.ts`

```ts
fetchDashboardSummary(since?: string): Promise<DashboardSummary>
reviewAlerts(reviews: AlertReview[]): Promise<{ reviewed_count: number }>
recordLogin(): Promise<{ last_login_at: string; previous_login_at: string | null }>
```

---

### 6.10 New types: `frontend/src/types/dashboard.ts`

Define `DashboardSummary`, `DashboardAlert`, `OrgMetrics`, `AlertReview` matching the API response shapes in section 5.

---

### 6.11 Modify: `frontend/src/App.tsx` or equivalent auth hook

After Supabase auth confirms a session (in `onAuthStateChange` or equivalent), call `dashboardApi.recordLogin()`. This should fire once per session, not on every route change.

Pattern:
```ts
// In the auth initialisation effect
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    dashboardApi.recordLogin().catch(() => {}) // fire and forget — non-critical
  }
})
```

Store the returned `previous_login_at` in `dashboardStore.sinceTimestamp` so the delta header has the correct value before the summary fetch resolves.

---

## 7. Technical Constraints

- `GET /api/dashboard/summary` must respond in under 1 second on a warm Supabase connection — use `Promise.all` for all source queries
- Alert `action_url` values must be internal SPA routes, not full URLs — the frontend router will handle them with `useNavigate` or `<Link>`
- `POST /api/auth/record-login` is fire-and-forget on the frontend — failure must not block the dashboard from loading
- Do not call the Claude API for any data in this PRD — all content is derived from existing structured data
- `noUnusedLocals` / `noUnusedParameters` strict TypeScript
- `ReturningUserDashboard` and all child components must be wrapped in `SectionErrorBoundary`
- Every async op in the dashboard shows skeleton cards while loading — no blank states
- Alert list must be accessible — severity icons must have `aria-label`, not colour alone

---

## 8. Acceptance Criteria

- [ ] `DashboardPage` renders `<OnboardingChecklist />` when `overall_status !== 'complete'` and `<ReturningUserDashboard />` when complete
- [ ] `POST /api/auth/record-login` updates `profiles.last_login_at` and returns the previous value; calling it twice in quick succession does not cause a race condition
- [ ] `DeltaHeader` correctly displays the time since the previous login; "change window" dropdown re-fetches summary with new `?since=` param
- [ ] Alert feed shows alerts from all four sources (IHC, DQM, Reconciliation, Health)
- [ ] `is_new: true` alerts are visually distinct (NEW pill) and sorted above `is_new: false` alerts
- [ ] "Mark reviewed" persists across sessions — a reviewed alert shows as reviewed on next login
- [ ] "View" on any alert navigates to the correct module page for that finding
- [ ] Module filter tabs correctly filter the alert list client-side (no additional API calls)
- [ ] `ClientHealthList` sorts critical clients first; "Show all" links to `ClientListPage`
- [ ] `OrgMetricsStrip` renders with correct values; tiles link to the correct pages
- [ ] Full dashboard renders within 2 seconds on a cold load (including skeleton-to-content transition)
- [ ] Dashboard renders correctly for an org with 1 client and for an org with 20+ clients
- [ ] All strict TypeScript checks pass with no unused imports

---

## 9. Open Decisions

1. **Default "since" window.** Using `previous_login_at` means a user who last logged in 90 days ago sees 90 days of alerts — potentially overwhelming. Should there be a cap (e.g., max 30 days)? Recommendation: cap at 30 days and label it "Since [date] (30-day max)". The user can manually extend via the "Change window" control.

2. **Health score drop threshold.** Currently specced as: flag a drop of > 5 points from `previous_login_at` to now. This threshold needs tuning — flag it as configurable in `dashboardSummaryService.ts` via a constant `HEALTH_DROP_ALERT_THRESHOLD = 5`.

3. **DQM alert client association.** `dqm_gtg_checks` is org-scoped (not per client). If there's only one client, the association is implicit. For multi-client orgs, the `client_id` on DQM alerts will be NULL. The alert row should render "All clients" in the client badge in this case.

4. **"Mark all reviewed" scope.** Does "review all" mark everything as reviewed, or just the currently-filtered set? Recommendation: "Review all" applies to all currently visible alerts (respects active filter). Add a separate "Review all issues" CTA for the unfiltered case.

5. **Alerts for orgs mid-onboarding.** What if an org has 3 clients — 2 complete, 1 in progress? The dashboard should show. Only show alerts for clients where `setup_status = 'complete'`; clients still being set up are expected to have findings.
