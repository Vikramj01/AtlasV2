# PRD-003: Multi-Client Agency Flow

**Product:** Atlas V2 — `atlas.vimi.digital`
**Repo:** `Vikramj01/AtlasV2`
**Status:** Ready for implementation
**Depends on:** PRD-001 (Set Up Tracking Hub) — client setup step 2 links into it
**Parallel with:** PRD-004, PRD-005
**Primary persona:** Agency operator, setting up their second or later client

---

## 1. Overview

After an agency operator completes their first client (PRD-001/002), every subsequent client currently lands them in an identical blank setup flow. They have to rebuild tagging from scratch even when the new client has the same business type, similar conversion goals, and the agency has already done this work before.

This PRD adds three connected features:

1. **Org type at signup** — captures whether the account is an agency or an in-house brand (foundation for PRD-005 too)
2. **Starting point step in ClientSetupWizard** — for client 2+, offers: start fresh, apply a signal pack, or copy from a previous client
3. **Save-as-pack prompt** — after completing a client's tagging, offers to save it as a reusable pack for future clients
4. **Client list status and health** — `ClientListPage` shows setup status and health level per client so the operator knows at a glance which clients need attention

---

## 2. User Stories

- As an agency operator adding my second client, I want to start from my first client's tagging rather than building from scratch
- As an agency operator, I want to save a client's completed tagging setup as a template I can reuse
- As an agency operator, I want to see all my clients and know at a glance which are fully set up, which are in progress, and which have issues
- As an agency operator adding a client with the same business type as an existing client, I want a one-click starting point

---

## 3. Scope

**In scope:**
- Org type selection added to signup flow
- `ClientSetupWizard` "starting point" step (conditional on org already having at least one client)
- `POST /api/clients/:id/save-as-pack` — saves deployed signals as a named signal pack
- `GET /api/clients/summary` — lightweight list with per-client setup status and health level
- `ClientListPage` redesign with status badge, health indicator, signal count, last verified date
- `ClientCard` component extended
- `ClientStatusBadge` component (new)
- Signal pack applied to a new client at creation time (inline in `POST /api/clients`)

**Out of scope:**
- Bulk cross-client operations (separate future PRD)
- Data Manager Console (agency plan feature, already built)
- Platform connection templating (platform connections are always client-specific)
- Strategy Gate templating

---

## 4. Migration

**File:** `supabase/migrations/20260701_003_multi_client_agency.sql`

> Replace `20260701` with the actual next sequential date from migration history.

```sql
-- Track where a client's initial tagging came from
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS template_source_client_id UUID REFERENCES clients(id),
      ADD COLUMN IF NOT EXISTS template_source_pack_id   UUID REFERENCES signal_packs(id);
  END IF;
END $$;

-- Track source client on signal packs saved from a client's setup
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'signal_packs') THEN
    ALTER TABLE signal_packs
      ADD COLUMN IF NOT EXISTS source_client_id UUID REFERENCES clients(id),
      ADD COLUMN IF NOT EXISTS is_agency_template BOOLEAN DEFAULT FALSE;
    -- is_starter already added in PRD-002 migration
  END IF;
END $$;

-- Store org type — 'agency' | 'brand' — column may already exist per schema
-- organizations already has a 'type' column per schema.
-- Confirm existing CHECK constraint; if absent, add:
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations') THEN
    -- No-op if type column already exists and has correct constraint
    -- Claude Code: verify the existing type column constraint and update if needed
    NULL;
  END IF;
END $$;
```

---

## 5. Backend

### 5.1 Modify: `backend/src/api/routes/clients.ts`

#### `GET /api/clients` → replace with `GET /api/clients/summary`

Or add `?include=summary` query param to the existing list endpoint — whichever is cleaner given the existing route shape.

Returns a lightweight array of client summaries for the calling org. Used by `ClientListPage` and `DashboardPage` (PRD-004).

**Auth:** `authMiddleware`. Resolve `organization_id` from profiles.

**Response shape:**
```ts
{
  data: Array<{
    id: string
    name: string
    website_url: string | null
    business_type: string | null
    industry: string | null
    created_at: string
    template_source_client_id: string | null
    template_source_pack_id: string | null

    // Derived
    setup_status: 'not_started' | 'in_progress' | 'complete'
    signals_count: number
    platforms_connected: string[]          // ['google_ads', 'meta', ...]
    last_verified_at: string | null        // latest crawl_run.completed_at where is_baseline=true
    open_findings_count: number            // unresolved audit_findings + reconciliation_findings
    health_level: 'healthy' | 'warning' | 'critical' | 'unknown'
  }>
  error: string | null
  message: string | null
}
```

**Derivation logic:**

`setup_status`:
- `complete`: `deployments` row exists for client AND `client_deliverable_exports` rows exist for both gtm_container and datalayer_spec
- `in_progress`: `deployments` row exists OR `planning_sessions` row exists for client
- `not_started`: none of the above

`health_level`:
- `critical`: unresolved `audit_findings` or `reconciliation_findings` with severity = 'critical' for this client
- `warning`: unresolved findings with severity IN ('high', 'medium')
- `healthy`: no unresolved findings AND baseline exists
- `unknown`: no `crawl_runs` with `is_baseline = true` for this client's `website_url`

`open_findings_count`: COUNT of unresolved `audit_findings` + `reconciliation_findings` for this client.

Run all sub-queries per client in `Promise.all` — avoid N+1 patterns. If org has many clients, batch the sub-queries.

---

#### `POST /api/clients` — extend request body

Add to the Zod schema:
```ts
{
  // existing fields...
  name: z.string(),
  website_url: z.string().url().optional(),
  industry: z.string().optional(),
  business_type: z.enum([...]).optional(),
  primary_conversion_objective: z.string().max(500).optional(),

  // NEW
  apply_pack_id: z.string().uuid().optional(),
  copy_signals_from_client_id: z.string().uuid().optional(),
}
```

**Post-creation logic:**

If `apply_pack_id` is provided:
1. Create the client row
2. Write `template_source_pack_id = apply_pack_id` to clients
3. Look up `signal_pack_signals` for that pack
4. Create `deployments` rows for each signal in the pack, setting `client_id` to the new client

If `copy_signals_from_client_id` is provided:
1. Create the client row
2. Write `template_source_client_id = copy_signals_from_client_id` to clients
3. Call `savePack(sourceClientId)` internally to materialise a pack (see below)
4. Apply that pack to the new client as above

Only one of `apply_pack_id` / `copy_signals_from_client_id` may be present. Zod: `.refine()` to enforce this.

---

#### New: `POST /api/clients/:clientId/save-as-pack`

Creates a signal pack from the client's currently deployed signals.

**Auth:** `authMiddleware`. Verify caller's org owns the client.

**Request body (Zod-validated):**
```ts
{
  pack_name: z.string().min(1).max(100),
  pack_description: z.string().max(500).optional(),
  make_agency_template: z.boolean().default(false),
}
```

**Logic:**
1. Fetch all `deployments` WHERE `client_id = :clientId` AND `status = 'deployed'`
2. If none → 400 "No deployed signals to save"
3. Create row in `signal_packs`: `{ organisation_id, name: pack_name, description, is_system: false, is_starter: false, is_agency_template: make_agency_template, source_client_id: clientId }`
4. Create `signal_pack_signals` rows linking the pack to each deployed signal
5. Return created pack

**Response:**
```ts
{
  data: {
    pack_id: string
    pack_name: string
    signals_count: number
  }
  error: string | null
  message: string | null
}
```

---

### 5.2 Modify: signup flow

**Where signup currently lives:** Identify the existing signup page/component and the backend route that creates the org. This is likely in `backend/src/api/routes/auth.ts` or handled via Supabase Auth hooks.

**Change:** After collecting email/password/org name, capture `org_type: 'agency' | 'brand'`. Write to `organizations.type` at org creation time. If the existing auth flow uses Supabase's `signUp` and creates the org in a post-signup webhook or route, add `type` to that org insert.

For the frontend signup UI: before or immediately after the existing org name field, add a card-style radio group:

> **I'm setting up Atlas for…**
> ○ An agency or consultancy — I manage tracking for multiple clients
> ○ My company's in-house marketing team — I'm managing tracking for one brand

Map selection to `org_type` sent in the org creation payload. Default: no pre-selection (require explicit choice). This is the same `org_type` that PRD-005 reads to trigger the in-house onboarding variant.

---

## 6. Frontend

### 6.1 Modify: `frontend/src/components/organisation/ClientSetupWizard.tsx`

Add a conditional "Starting point" step. This step only appears if the org already has at least one client with deployed signals (`signals_count > 0` in the client summary).

**Step order:**
1. Client details (existing + `business_type` from PRD-001)
2. **Starting point** ← NEW, conditional
3. Review (existing) → Create

**Starting point step UI:**

Three option cards:

| Option | Label | Description | When to show |
|---|---|---|---|
| A | Start fresh | Build tagging from scratch using the tracking hub | Always |
| B | Apply a signal pack | Start from one of your saved packs | Only if org has at least one `signal_pack` with `is_starter OR is_agency_template = true` |
| C | Copy from an existing client | Use the tagging you've already built for a similar client | Only if org has at least one client with `setup_status = 'complete'` |

**Option B flow:**
- Selecting option B shows a pack picker (list of org packs + system starter packs)
- Each pack shows: name, signal count, `source_client_id` label if applicable
- Selection sets `apply_pack_id` in the form state

**Option C flow:**
- Selecting option C shows a client picker (clients with `setup_status = 'complete'`)
- Each client card shows: name, business type, signal count
- Selection sets `copy_signals_from_client_id` in the form state

**On wizard submit:**
- If option A: `POST /api/clients` with no template fields
- If option B: `POST /api/clients` with `apply_pack_id`
- If option C: `POST /api/clients` with `copy_signals_from_client_id`

After client is created, navigate to `/clients/:newClientId/tracking`.

**Detection of whether to show the step:**
Call `GET /api/clients/summary` before opening the wizard. If the response has at least one client with `signals_count > 0`, include the starting point step. Store this in the wizard's local state — do not add to the global Zustand store.

---

### 6.2 Modify: `frontend/src/pages/ClientListPage.tsx`

Replace the existing client card grid with the enhanced version.

**Data source:** `GET /api/clients/summary` (new endpoint). Show skeleton grid while loading.

**Layout:** Responsive grid. Each card renders `<ClientCard />`.

**Add controls:**
- Sort by: Name A–Z / Health (critical first) / Recently added / Setup status
- Filter by: All / Setup complete / In progress / Not started / Has issues
- "Add client" button — opens `ClientSetupWizard`

---

### 6.3 Modify: `frontend/src/components/organisation/ClientCard.tsx`

Extend with summary data. Current card likely shows: name, website. New card shows:

```
[Client name]                                [health badge]
[website_url]
───────────────────────────────────────────
Signals: 14     Platforms: GA4, Meta
Last verified: 3 days ago
Setup: Complete
───────────────────────────────────────────
[Set up tracking]   [View health]
```

Props addition:
```ts
interface ClientCardProps {
  // existing
  client: ClientSummary   // use the new summary type
  onSetupClick: () => void
  onHealthClick: () => void
}
```

---

### 6.4 New component: `frontend/src/components/organisation/ClientStatusBadge.tsx`

```ts
interface ClientStatusBadgeProps {
  status: 'not_started' | 'in_progress' | 'complete'
}
```

Renders a small pill badge:
- `not_started`: grey — "Not started"
- `in_progress`: amber — "In progress"
- `complete`: green — "Complete"

---

### 6.5 New component: `frontend/src/components/organisation/ClientHealthBadge.tsx`

```ts
interface ClientHealthBadgeProps {
  healthLevel: 'healthy' | 'warning' | 'critical' | 'unknown'
  findingsCount?: number
}
```

Renders an icon + label:
- `healthy`: green dot — "Healthy"
- `warning`: amber triangle — "X issues"
- `critical`: red circle — "X critical"
- `unknown`: grey dash — "Not verified"

---

### 6.6 New hook: `frontend/src/lib/api/clientsApi.ts` — extend

Add:
```ts
fetchClientSummary(): Promise<ClientSummary[]>
saveClientAsPack(clientId: string, body: SaveAsPackBody): Promise<SaveAsPackResult>
```

---

### 6.7 New types: `frontend/src/types/organisation.ts` — extend

Add `ClientSummary`, `SaveAsPackBody`, `SaveAsPackResult`.

---

### 6.8 Save-as-pack post-completion prompt

After `OnboardingChecklist` step 2.4 completes (deliverables generated), or after the Deliverables card in the tracking hub is used, show a dismissible banner:

> "Want to reuse this client's tagging for future clients? Save it as a reusable pack."
> [Save as pack] [Not now]

"Save as pack" opens a small `<Dialog>` with:
- Pack name (pre-filled: `[Client Name] — [Business Type] Setup`)
- Description (optional)
- "Mark as agency template" toggle
- [Save] button → calls `POST /api/clients/:id/save-as-pack`

Show this banner:
- Only once per client (store dismissal in `localStorage` keyed by `clientId`)
- Only when `setup_status = 'complete'` for that client
- In both `SetupTrackingHubPage` (State C) and in the `OnboardingChecklist` after step 2.4 marks complete

---

## 7. Technical Constraints

- All new backend request bodies Zod-validated
- `GET /api/clients/summary` sub-queries must run in `Promise.all` per client batch — not sequentially
- `copy_signals_from_client_id` and `apply_pack_id` are mutually exclusive — enforce with Zod `.refine()`
- Verify caller's org owns `source_client_id` before any copy operation
- `noUnusedLocals` / `noUnusedParameters` strict TypeScript
- New wizard step must not break the existing wizard step sequence for first-time client creation

---

## 8. Acceptance Criteria

- [ ] Signup flow shows the org type selection card before or alongside org name; selection is required to proceed
- [ ] `organizations.type` is set correctly to `'agency'` or `'brand'` at org creation
- [ ] `ClientSetupWizard` shows the "Starting point" step only when the org has at least one client with `signals_count > 0`
- [ ] Option A (start fresh) creates the client with no template fields set
- [ ] Option B (apply pack) deploys all pack signals to the new client immediately on creation; `template_source_pack_id` is set
- [ ] Option C (copy from client) creates a pack from the source client's deployments, applies it to the new client, and sets `template_source_client_id`
- [ ] `POST /api/clients/:id/save-as-pack` creates a signal_pack with correct signal associations; returns 400 if no deployed signals exist
- [ ] `ClientListPage` renders enhanced cards with status badge, health badge, signal count, last verified date
- [ ] Sort and filter controls on `ClientListPage` work correctly without API calls (client-side on the summary array)
- [ ] Save-as-pack prompt appears after step 2.4 completes and only once per client
- [ ] All new TypeScript files pass strict compilation

---

## 9. Open Decisions

1. **Org type validation at signup.** Should org type selection be required (can't proceed without it) or optional with a default of `'agency'`? Recommendation: required — the default onboarding path changes meaningfully between types.

2. **Pack application depth.** When applying a pack, should the journey structure (journey_stages) also be copied to the new client, or only the signal deployments? Recommendation: signals only for now. Journey copying is more complex and the strategist can still use Journey Builder to set up the journey structure.

3. **Pack visibility.** Should `is_agency_template` packs be visible to all team members or only the admin who created them? Recommendation: visible to all org members.

4. **`GET /api/clients/summary` performance.** If an agency has 50+ clients, the per-client sub-queries could be slow. Consider: materialise a `client_status_cache` table updated on write rather than computing at query time. For the initial release, the `Promise.all` approach is acceptable; add the cache if P95 latency exceeds 1s.
