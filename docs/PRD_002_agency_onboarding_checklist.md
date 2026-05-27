# PRD-002: Agency Onboarding Checklist

**Product:** Atlas V2 — `atlas.vimi.digital`
**Repo:** `Vikramj01/AtlasV2`
**Status:** Ready for implementation
**Depends on:** PRD-001 (Set Up Tracking Hub) must be shipped first — Step 2.3 links directly into it
**Primary persona:** Agency operator (admin role), first-time account setup

---

## 1. Overview

A new agency operator currently lands on `DashboardPage` with an empty interface and no guidance on where to begin. The platform has everything they need, but the entry surface is missing. This PRD adds a persistent, progress-aware checklist that walks the operator through org-level defaults and first-client setup in a fixed, logical sequence.

The checklist surfaces on `DashboardPage` immediately after signup, tracks completion automatically from existing database state wherever possible, and collapses out of the way once the operator is fully onboarded. It does not block access to any other part of the product.

---

## 2. User Stories

- As a first-time agency operator, I want to know exactly what to do after signing up, in the right order, without reading documentation
- As a first-time agency operator, I want to be able to skip optional steps without losing my place
- As an agency operator returning after a break, I want to see which setup steps are still pending without hunting through the product
- As a returning operator with onboarding complete, I do not want to see the checklist on every login

---

## 3. Scope

**In scope:**
- `OnboardingChecklist` component on `DashboardPage`
- `OnboardingWidget` compact version in `TopBar` (after dismissal)
- `/getting-started` route (standalone view of the checklist)
- Progress derivation from existing tables — no manual check-off for most steps
- Skip/dismiss/reset actions
- Step 2.3 deep-links into the Set Up Tracking Hub from PRD-001
- `clients` table: `business_type` and `primary_conversion_objective` columns (already added in PRD-001 migration — do not re-add)
- `organizations` table: `taxonomy_accepted_at` column
- `signal_packs` table: `is_starter` column
- `organization_onboarding_state` table for skip/dismiss flags

**Out of scope:**
- Per-user onboarding (this is per-org, admin-only completion authority)
- Second-client+ flows (separate PRD)
- In-house marketer persona
- Returning-user dashboards

---

## 4. Migration

**File:** `supabase/migrations/20260701_002_onboarding_checklist.sql`

> Use the actual next sequential date. If PRD-001 migration runs first on the same day, use `20260701_002`.

```sql
-- Extend organizations
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations') THEN
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS taxonomy_accepted_at TIMESTAMPTZ;
  END IF;
END $$;

-- Extend signal_packs
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_packs') THEN
    ALTER TABLE signal_packs
      ADD COLUMN IF NOT EXISTS is_starter BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Onboarding state (skip flags, dismiss, completion timestamp)
CREATE TABLE IF NOT EXISTS organization_onboarding_state (
  organization_id   UUID        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  steps_state       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- shape: { "1.2": { "status": "skipped", "at": "ISO timestamp" }, ... }
  dismissed_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE organization_onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members access onboarding state"
  ON organization_onboarding_state
  USING (organization_id = auth.uid())
  WITH CHECK (organization_id = auth.uid());
```

---

## 5. Step Definitions

There are nine steps across two phases. Steps marked **required** must be completed or have zero skippable alternative. Steps marked **optional** can be explicitly skipped.

### Phase 1 — Org defaults (one-time)

---

#### Step 1.1 — Set naming conventions

| Field | Value |
|---|---|
| **ID** | `1.1` |
| **Required** | Yes (can accept defaults — that still counts as complete) |
| **CTA label** | Set conventions |
| **CTA destination** | NamingConventionPage — open as focused view or modal |
| **Alt CTA** | "Use Atlas recommended conventions" — writes default config, marks complete |
| **Completion derived from** | `naming_conventions` row exists for `organization_id` |
| **Estimated time** | 2 min |

---

#### Step 1.2 — Review event taxonomy

| Field | Value |
|---|---|
| **ID** | `1.2` |
| **Required** | Optional |
| **CTA label** | Review taxonomy |
| **CTA destination** | EventTaxonomyPage (read-only review mode with "Accept defaults" button) |
| **Alt CTA** | "Accept defaults" button within the step row — writes `taxonomy_accepted_at = NOW()` to `organizations` |
| **Completion derived from** | `organizations.taxonomy_accepted_at IS NOT NULL` OR custom entry exists in `event_taxonomy` for this org |
| **Estimated time** | 1 min |

---

#### Step 1.3 — Choose a starter signal pack

| Field | Value |
|---|---|
| **ID** | `1.3` |
| **Required** | Optional |
| **CTA label** | Choose a starter pack |
| **CTA destination** | `SignalPacksPage` filtered to `is_starter = true` |
| **Skip label** | "I'll build my own later" |
| **Completion derived from** | `signal_packs` row exists for org OR step is marked `skipped` in `steps_state` |
| **Estimated time** | 2 min |

Starter packs to pre-seed in the migration or an admin seed script: B2B SaaS Standard, Lead Gen Essentials, Ecommerce Growth, Marketplace Standard, Nonprofit Essentials.

---

#### Step 1.4 — Invite your team

| Field | Value |
|---|---|
| **ID** | `1.4` |
| **Required** | Optional |
| **CTA label** | Invite teammates |
| **CTA destination** | OrgSettingsPage member invite modal |
| **Skip label** | "I'll do this later" |
| **Completion derived from** | `(SELECT COUNT(*) FROM organisation_members WHERE organisation_id = ?) > 1` OR step `skipped` |
| **Estimated time** | 1 min |

---

### Phase 2 — First client (one-time)

---

#### Step 2.1 — Add your first client

| Field | Value |
|---|---|
| **ID** | `2.1` |
| **Required** | Yes |
| **CTA label** | Add a client |
| **CTA destination** | Opens `ClientSetupWizard` |
| **Completion derived from** | `clients` row exists for `organization_id` |
| **Estimated time** | 3 min |
| **Wizard change required** | Extend `ClientSetupWizard` to capture `business_type` (dropdown, same enum as Journey Builder) and `primary_conversion_objective` (optional text field). These columns were added in PRD-001 migration. |

---

#### Step 2.2 — Connect platforms

| Field | Value |
|---|---|
| **ID** | `2.2` |
| **Required** | Yes (at least one of Google Ads / Meta / GA4) |
| **CTA label** | Connect platforms |
| **CTA destination** | `ConnectionsPage` scoped to the first client |
| **Completion derived from** | `platform_connections` row exists WHERE `client_id = [first_client_id]` AND `status = 'active'` |
| **Estimated time** | 5 min |
| **Inline note** | Show soft reminder: "Connect GTM to enable drift detection — you can do this anytime." if GTM not connected. Not a blocker. |

---

#### Step 2.3 — Design your tagging

| Field | Value |
|---|---|
| **ID** | `2.3` |
| **Required** | Yes |
| **CTA label** | Set up tracking |
| **CTA destination** | `/clients/:firstClientId/tracking` — the Set Up Tracking Hub (PRD-001) |
| **Completion derived from** | `deployments` row exists WHERE `client_id = [first_client_id]` AND `status = 'deployed'` OR `planning_recommendations` row WHERE `approved = true` for a session linked to first client OR `journeys` row linked to first client |
| **Estimated time** | 15–30 min |

---

#### Step 2.4 — Generate deliverables

| Field | Value |
|---|---|
| **ID** | `2.4` |
| **Required** | Yes |
| **CTA label** | Generate deliverables |
| **CTA destination** | `/clients/:firstClientId/tracking` — scrolls to the Deliverables card (hash anchor `#deliverables`) |
| **Completion derived from** | `client_deliverable_exports` rows exist WHERE `client_id = [first_client_id]` AND `export_type IN ('gtm_container', 'datalayer_spec')` — both must exist |
| **Estimated time** | 1 min |

---

#### Step 2.5 — Verify your implementation

| Field | Value |
|---|---|
| **ID** | `2.5` |
| **Required** | Yes |
| **CTA label** | Run verification scan |
| **CTA destination** | `/clients/:firstClientId/tracking` — scrolls to Verification card (hash anchor `#verification`) |
| **Completion derived from** | `crawl_runs` row WHERE `is_baseline = true` AND site_url matches first client's `website_url` |
| **Estimated time** | 5 min (background job) |
| **Helper copy in step row** | "Once your developer has implemented the dataLayer and you've imported the GTM container into the client's GTM, run this scan to confirm signals are firing." |

---

## 6. Progress Derivation

All progress is derived server-side on every call to `GET /api/onboarding/status`. The frontend does not compute step state — it renders what the API returns.

### `first_client_id` resolution

The endpoint resolves the "first client" as:
```sql
SELECT id, website_url, business_type
FROM clients
WHERE organization_id = :org_id
ORDER BY created_at ASC
LIMIT 1
```

All Phase 2 completion checks run against this `client_id`.

### Full derivation table

| Step | Query | Complete when |
|---|---|---|
| 1.1 | `SELECT id FROM naming_conventions WHERE organisation_id = :org_id LIMIT 1` | Row exists |
| 1.2 | `SELECT taxonomy_accepted_at FROM organizations WHERE id = :org_id` | NOT NULL, OR custom `event_taxonomy` row with `is_system = false` and `organisation_id` |
| 1.3 | `SELECT id FROM signal_packs WHERE organisation_id = :org_id LIMIT 1` | Row exists OR `steps_state['1.3'].status = 'skipped'` |
| 1.4 | `SELECT COUNT(*) FROM organisation_members WHERE organisation_id = :org_id` | COUNT > 1 OR `steps_state['1.4'].status = 'skipped'` |
| 2.1 | `SELECT id FROM clients WHERE organization_id = :org_id LIMIT 1` | Row exists |
| 2.2 | `SELECT id FROM platform_connections WHERE client_id = :first_client_id AND status = 'active' LIMIT 1` | Row exists |
| 2.3 | See step definition above (three-way OR) | Any of the three conditions true |
| 2.4 | `SELECT export_type FROM client_deliverable_exports WHERE client_id = :first_client_id` | Both `'gtm_container'` and `'datalayer_spec'` rows exist |
| 2.5 | `SELECT id FROM crawl_runs WHERE is_baseline = true AND site_url = :first_client_website_url LIMIT 1` | Row exists |

### Onboarding complete condition

All required steps complete (1.1, 2.1, 2.2, 2.3, 2.4, 2.5) AND all optional steps either complete or skipped (1.2, 1.3, 1.4).

Write `completed_at = NOW()` to `organization_onboarding_state` on the API response when this condition is first met.

---

## 7. Backend

### 7.1 New route file: `backend/src/api/routes/onboarding.ts`

Register at `/api/onboarding`.

#### `GET /api/onboarding/status`

Returns the full checklist state for the current org.

**Auth:** `authMiddleware`. Only callable by users with `role = 'admin'` for the org — check `organisation_members.role`. Non-admins receive a 403.

**Response shape:**
```ts
{
  data: {
    overall_status: 'not_started' | 'in_progress' | 'complete'
    completed_at: string | null
    dismissed_at: string | null
    first_client: {
      id: string
      name: string
      website_url: string | null
    } | null
    steps: {
      [stepId: string]: {
        id: string                             // e.g. "1.1"
        phase: 1 | 2
        status: 'complete' | 'incomplete' | 'skipped'
        required: boolean
        completed_at: string | null
        skipped_at: string | null
      }
    }
    phase_1_complete: boolean
    phase_2_complete: boolean
  }
  error: string | null
  message: string | null
}
```

**Service to create:** `backend/src/services/onboarding/onboardingStatusService.ts`

Contains all derivation queries from section 6. Runs queries in parallel (Promise.all) to keep latency low.

---

#### `POST /api/onboarding/skip`

Mark an optional step as skipped.

**Auth:** `authMiddleware`. Admin only.

**Request body (Zod-validated):**
```ts
{ step_id: z.enum(['1.2', '1.3', '1.4']) }
// Only optional steps can be skipped
```

**Logic:** Upsert into `organization_onboarding_state.steps_state` — merge `{ [step_id]: { status: 'skipped', at: new Date().toISOString() } }` into existing JSONB.

**Response:** `{ data: { step_id: string, status: 'skipped' }, error, message }`

---

#### `POST /api/onboarding/dismiss`

Hides the checklist from DashboardPage; compact widget remains in TopBar.

**Auth:** `authMiddleware`. Admin only.

**Logic:** Upsert `organization_onboarding_state.dismissed_at = NOW()`.

**Response:** `{ data: { dismissed_at: string }, error, message }`

---

#### `POST /api/onboarding/reset`

Clears all skip/dismiss/complete state. Checklist reappears on DashboardPage.

**Auth:** `authMiddleware`. Admin only.

**Logic:** Upsert `organization_onboarding_state` — set `steps_state = '{}'`, `dismissed_at = NULL`, `completed_at = NULL`.

**Response:** `{ data: { reset: true }, error, message }`

---

#### `POST /api/onboarding/accept-taxonomy`

Convenience endpoint for the "Accept defaults" action in Step 1.2. Writes `organizations.taxonomy_accepted_at = NOW()`.

**Auth:** `authMiddleware`. Admin only.

**Response:** `{ data: { accepted_at: string }, error, message }`

---

### 7.2 Modify: `frontend/src/components/organisation/ClientSetupWizard.tsx`

Add two new fields to the wizard:

1. **Business type** — required `<Select>` with options: Ecommerce, Lead Generation, B2B SaaS, Marketplace, Nonprofit, B2B Lead Generation. Maps to the values in the `business_type` CHECK constraint. Required field.
2. **Primary conversion objective** — optional `<Textarea>` with placeholder: "e.g. Form submissions from enterprise prospects, demo bookings, trial signups". 500 char max.

Include both fields in the existing `POST /api/clients` payload. The backend schema was extended in PRD-001.

---

## 8. Frontend

### 8.1 New components: `frontend/src/components/onboarding/`

#### `OnboardingChecklist.tsx`

Top-level container. Mounted in `DashboardPage`.

**Visibility logic:**
```ts
// Do not render if:
// - onboardingStore.dismissed === true AND onboardingStore.overall_status !== 'complete'
// - OR overall_status === 'complete' AND completedMoreThan7DaysAgo === true
```

**Layout:** Full-width card, two sections (Phase 1, Phase 2), each with its own header.

**Phase gating:** Phase 2 steps are visible from the start (no hard lock), but display a small note "Complete org setup above first" if any Phase 1 required step is incomplete. Soft nudge only — do not disable CTAs.

**When all required steps complete:** Show a green "You're all set — [Org Name] is ready to go." banner at the top. After 7 days, set a local flag and stop rendering the checklist entirely. `OnboardingWidget` in TopBar remains permanently accessible.

---

#### `OnboardingStep.tsx`

Props:
```ts
interface OnboardingStepProps {
  stepId: string
  title: string
  description: string
  helperCopy?: string       // rendered as small muted text under description
  status: 'complete' | 'incomplete' | 'skipped'
  required: boolean
  ctaLabel: string
  ctaHref?: string          // internal route
  ctaAction?: () => void    // for steps that trigger an action inline (e.g. accept-taxonomy)
  altCtaLabel?: string      // e.g. "Use recommended conventions"
  altCtaAction?: () => void
  skipLabel?: string        // only for optional steps
  onSkip?: () => void
  estimatedTime?: string    // e.g. "~2 min"
}
```

**States:**

- **Complete:** Green checkmark icon, title struck through (or grey), no CTA rendered. Collapsed height.
- **Incomplete (current / highlighted):** Full height, CTA prominent, time estimate visible.
- **Incomplete (pending):** Dimmed, CTA visible but style `variant="outline"`.
- **Skipped:** Grey dash icon, title grey, "Undo" text link to re-open.

Do not auto-expand/collapse steps. All steps remain visible at all times — the status icon is the signal.

---

#### `OnboardingWidget.tsx`

Shown in `TopBar` once the checklist is dismissed OR after it completes.

Content: "Setup: X/9 complete" with a small progress ring (SVG). Clicking expands a dropdown panel showing a compact version of the step list. Panel has a "Open full setup guide" link to `/getting-started`.

---

### 8.2 New store: `frontend/src/store/onboardingStore.ts`

```ts
interface OnboardingStore {
  status: OnboardingStatus | null
  isLoading: boolean
  error: string | null
  dismissed: boolean

  // Derived
  completedCount: number    // steps with status 'complete'
  totalSteps: number        // 9
  overallProgress: number   // 0–100

  // Actions
  fetchStatus: () => Promise<void>
  skipStep: (stepId: string) => Promise<void>
  dismiss: () => Promise<void>
  reset: () => Promise<void>
  acceptTaxonomy: () => Promise<void>
}
```

`fetchStatus` is called:
1. On `DashboardPage` mount
2. After any action that could complete a step (e.g., after `ClientSetupWizard` saves, after `ConnectionsPage` connects a platform)
3. On `/getting-started` page mount

Use a simple polling interval is NOT required — fetch on action, not continuously.

---

### 8.3 New API client: `frontend/src/lib/api/onboardingApi.ts`

```ts
fetchOnboardingStatus(): Promise<OnboardingStatus>
skipStep(stepId: string): Promise<void>
dismiss(): Promise<void>
reset(): Promise<void>
acceptTaxonomy(): Promise<void>
```

---

### 8.4 New types: `frontend/src/types/onboarding.ts`

Define `OnboardingStatus`, `OnboardingStep` matching the API response shape in section 7.1.

---

### 8.5 New page: `frontend/src/pages/GettingStartedPage.tsx`

Route: `/getting-started`

Simple layout — renders `<OnboardingChecklist />` full-page with a heading "Set up your Atlas workspace" and a breadcrumb back to Dashboard. Accessible from user menu and from `OnboardingWidget`.

Wrap in `SectionErrorBoundary`.

---

### 8.6 Modify: `frontend/src/pages/DashboardPage.tsx`

At the top of the page content, before existing dashboard widgets:

```tsx
{onboardingStore.status && !onboardingStore.dismissed && (
  <OnboardingChecklist />
)}
```

`onboardingStore.fetchStatus()` called in `useEffect` on mount (if `status === null`).

---

### 8.7 Modify: `frontend/src/components/layout/TopBar.tsx`

In the right-side icon group, add `<OnboardingWidget />`. Show only when:
- `onboardingStore.status !== null`
- AND `onboardingStore.dismissed === true` OR `onboardingStore.status.overall_status === 'complete'`

Widget stays visible permanently — even after onboarding is complete — as a navigation shortcut.

---

### 8.8 Modify: `frontend/src/pages/SettingsPage.tsx`

Under a new "Account" or "Workspace" section, add:

- **Onboarding status:** "Setup complete on [date]" or "In progress — X/9 steps done"
- **Action:** "Restart setup guide" button — calls `onboardingStore.reset()`, navigates to `/getting-started`

---

### 8.9 Modify: React Router config (`App.tsx`)

Add route:
```tsx
<Route path="/getting-started" element={<GettingStartedPage />} />
```

Inside `ProtectedRoute` wrapper.

---

## 9. Step-to-CTA Destination Map

| Step | CTA destination | Notes |
|---|---|---|
| 1.1 | NamingConventionPage | Open in modal or focused view |
| 1.2 | EventTaxonomyPage (review mode) | "Accept defaults" alt CTA calls `POST /api/onboarding/accept-taxonomy` inline |
| 1.3 | SignalPacksPage (`?filter=starter`) | |
| 1.4 | OrgSettingsPage member invite modal | |
| 2.1 | `ClientSetupWizard` (modal) | Wizard now captures `business_type` |
| 2.2 | `/connections?client_id=:firstClientId` | |
| 2.3 | `/clients/:firstClientId/tracking` | PRD-001 must be shipped |
| 2.4 | `/clients/:firstClientId/tracking#deliverables` | |
| 2.5 | `/clients/:firstClientId/tracking#verification` | |

---

## 10. Technical Constraints

- Follow `{ data, error, message }` response shape on all endpoints
- All backend request bodies validated with Zod
- Admin-only endpoints: check `organisation_members.role = 'admin'` — return 403 for non-admins
- Resolve `organization_id` via `supabaseAdmin.from('profiles').select('organization_id').eq('id', req.user.id)`
- `noUnusedLocals: true` and `noUnusedParameters: true` — no unused imports
- Wrap `GettingStartedPage` in `SectionErrorBoundary`
- All async operations in `OnboardingChecklist` show a skeleton or spinner — no blank loading states
- `onboardingStatusService` should run all DB queries in `Promise.all()` — do not run sequentially
- The checklist must render correctly for an org with zero clients (Phase 2 steps show as incomplete with safe null handling)

---

## 11. Acceptance Criteria

- [ ] A brand new org with no data sees all 9 steps as incomplete on DashboardPage immediately after signup
- [ ] Completing Step 1.1 (naming conventions) is auto-detected on the next `fetchStatus` call — no manual check-off
- [ ] "Accept defaults" on Step 1.2 writes `taxonomy_accepted_at` and marks the step complete without navigating away
- [ ] Skipping an optional step (1.2, 1.3, 1.4) marks it as skipped and does not block Phase 2 access
- [ ] Step 2.1 CTA opens the extended `ClientSetupWizard` with `business_type` as a required field — a client cannot be created without selecting one
- [ ] After creating the first client, Step 2.1 is automatically marked complete
- [ ] Step 2.3 CTA links to `/clients/:firstClientId/tracking` — the Set Up Tracking Hub
- [ ] Step 2.4 is marked complete only when both `gtm_container` and `datalayer_spec` exports exist for the first client
- [ ] Step 2.5 is marked complete when a baseline CSE run exists for the first client's site URL
- [ ] When all required steps are complete, a "You're all set" banner appears and `completed_at` is written to `organization_onboarding_state`
- [ ] Dismissing the checklist hides it from DashboardPage; `OnboardingWidget` appears in TopBar
- [ ] `OnboardingWidget` shows the correct completed count at all times
- [ ] Clicking "Restart setup guide" in Settings clears all state and the checklist reappears on DashboardPage
- [ ] `/getting-started` renders the checklist for direct access without requiring it to be visible on Dashboard
- [ ] The API returns 403 for non-admin users calling any `/api/onboarding` endpoint
- [ ] All derivation queries run in parallel — `GET /api/onboarding/status` completes in under 500ms on a warm Supabase connection
- [ ] All new TypeScript files pass strict compilation with no unused imports

---

## 12. Open Decisions

1. **Admin-only vs all-member visibility.** Currently specced as: only admins can take completion actions, but all org members can view the checklist (read-only). If you want to restrict view entirely to admin: add the role check to `GET /api/onboarding/status` as well and suppress the component for non-admins on the frontend.

2. **Phase gating strength.** Currently: Phase 2 shows a soft nudge if Phase 1 is incomplete, but CTAs are not disabled. If you prefer hard gating (Phase 2 CTAs disabled until Phase 1 required steps are done), set `disabled` on Phase 2 step CTA buttons when `phase_1_complete === false`.

3. **Checklist visibility after completion.** Currently: hidden after 7 days post-completion. The 7-day countdown is client-side (localStorage flag). If you want server-side: add a `hidden_after_at` column to `organization_onboarding_state` and compute it as `completed_at + INTERVAL '7 days'`.

4. **Starter signal packs seeding.** The five starter packs (B2B SaaS Standard, Lead Gen Essentials, Ecommerce Growth, Marketplace Standard, Nonprofit Essentials) need to exist as `signal_packs` rows with `is_starter = true` and `is_system = true`. Either include them in the migration as INSERT statements, or create a separate seed script. Confirm which approach matches existing system signal seeding conventions in the codebase.
