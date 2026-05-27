# PRD-001: Set Up Tracking Hub

**Product:** Atlas V2 — `atlas.vimi.digital`
**Repo:** `Vikramj01/AtlasV2`
**Status:** Ready for implementation
**Ship before:** PRD-002 (Agency Onboarding Checklist) — this is a hard dependency
**Primary persona:** Agency strategist, managing multiple clients

---

## 1. Overview

The platform currently has three tools that can all initiate tagging design for a client — Planning Mode, Journey Builder, and the Crawl Signal Extractor (CSE). They appear as peer navigation items with no guidance on which to use or when. Additionally, deliverables produced by these tools (GTM container JSON, dataLayer implementation spec) live in three separate surfaces, making handover to the developer fragile.

This PRD introduces the **Set Up Tracking Hub** — a per-client surface at `/clients/:clientId/tracking` that:

1. Disambiguates the three tools by surfacing them as distinct intents rather than alternatives
2. Tracks in-progress work across modules so the strategist never loses context
3. Consolidates GTM container JSON and dataLayer spec generation into a single Deliverables card
4. Produces a public shareable link for the dataLayer spec so a developer without an Atlas account can access it
5. Exposes a verification trigger (CSE run + IHC baseline) in the same view after implementation

---

## 2. User Stories

- As an agency strategist, I want to know immediately which tool to use when I open a new client, without reading documentation
- As an agency strategist, I want to resume a tagging design I started earlier without hunting through the sidebar
- As an agency strategist, I want to download both the GTM container JSON and the dataLayer spec from one place
- As an agency strategist, I want to share the dataLayer spec with my developer via a link they can open without an Atlas login
- As an agency strategist, I want to confirm the tagging is live on the client's site from the same view I designed it in

---

## 3. Scope

**In scope:**
- New page `SetupTrackingHubPage` at `/clients/:clientId/tracking`
- Three intent cards routing to Planning Mode, Journey Builder, CSE
- In-progress resume state for all three modules
- Status & Deliverables view once tagging design is complete
- GTM container JSON + dataLayer spec generation/download
- Public shareable link for dataLayer spec (no Atlas auth required)
- CSE verification trigger
- Journey Builder → Signal Library save-to-library bridge (mirrors Planning Mode's existing bridge)
- Tracking tab on `ClientDetailPage`
- `clients` table extended with `business_type` and `primary_conversion_objective`

**Out of scope:**
- CAPI, Enricher, Offline Conversions (separate per-client tabs)
- Strategy Gate (remains a standalone tool, not surfaced here)
- Returning-user health monitoring (separate PRD)
- In-house marketer persona

---

## 4. Migration

**File:** `supabase/migrations/20260701_001_setup_tracking_hub.sql`

> Note: Use the actual next sequential date from the migration history in place of `20260701`.

```sql
-- Extend clients table
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients') THEN
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS business_type TEXT
        CHECK (business_type IN ('ecommerce','lead_gen','b2b_saas','marketplace','nonprofit','b2b_lead_gen')),
      ADD COLUMN IF NOT EXISTS primary_conversion_objective TEXT;
  END IF;
END $$;

-- Shareable deliverable links
CREATE TABLE IF NOT EXISTS shareable_deliverable_links (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  share_token       TEXT        UNIQUE NOT NULL,
  deliverable_type  TEXT        NOT NULL CHECK (deliverable_type IN ('datalayer_spec','gtm_container','combined')),
  content           JSONB       NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_by        UUID        REFERENCES profiles(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  view_count        INT         DEFAULT 0,
  last_viewed_at    TIMESTAMPTZ
);

-- RLS
ALTER TABLE shareable_deliverable_links ENABLE ROW LEVEL SECURITY;

-- Org members can manage their own links
CREATE POLICY "org members manage shareable links"
  ON shareable_deliverable_links
  USING (organization_id = auth.uid())
  WITH CHECK (organization_id = auth.uid());

-- Public read by token (no auth required — checked in application layer)
CREATE POLICY "public read by token"
  ON shareable_deliverable_links FOR SELECT
  USING (expires_at > NOW());

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_shareable_links_token
  ON shareable_deliverable_links(share_token);

-- Extend journey_stages for Signal Library sync
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journey_stages') THEN
    ALTER TABLE journey_stages
      ADD COLUMN IF NOT EXISTS signal_library_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS signal_library_signal_id UUID REFERENCES signals(id);
  END IF;
END $$;

-- Client deliverable export log (referenced by Onboarding Checklist PRD-002)
CREATE TABLE IF NOT EXISTS client_deliverable_exports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  export_type       TEXT        NOT NULL CHECK (export_type IN ('gtm_container','datalayer_spec','combined')),
  exported_by       UUID        REFERENCES profiles(id),
  storage_path      TEXT,
  shareable_url     TEXT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_deliverable_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members access deliverable exports"
  ON client_deliverable_exports
  USING (organization_id = auth.uid())
  WITH CHECK (organization_id = auth.uid());
```

---

## 5. Backend

### 5.1 New route file: `backend/src/api/routes/tracking.ts`

Register at `backend/src/api/routes/index.ts` (or wherever routes are mounted) as `/api/tracking`.

#### `GET /api/tracking/clients/:clientId/status`

Returns the full hub state for a client. Used by `SetupTrackingHubPage` on mount.

**Auth:** `authMiddleware` required. Resolve `organization_id` from `profiles` for the calling user.

**Response shape:**
```ts
{
  data: {
    client: {
      id: string
      name: string
      website_url: string | null
      business_type: string | null
      primary_conversion_objective: string | null
    }
    preconditions: {
      website_url: boolean
      business_type: boolean
      platforms_connected: string[]   // e.g. ['google_ads','meta']
    }
    in_progress: {
      planning_session: {
        id: string
        started_at: string
        page_count: number
        approved_count: number
      } | null
      journey_draft: {
        id: string
        saved_at: string
        current_step: number
        total_steps: number
      } | null
      recent_crawl: {
        run_id: string
        completed_at: string
        signals_found: number
        is_baseline: boolean
      } | null
    }
    deployment: {
      signals_count: number
      stages_count: number
      last_updated_at: string | null
      designed_via: 'planning_mode' | 'journey_builder' | 'mixed' | null
      deliverables: {
        datalayer_spec: {
          last_generated_at: string
          shareable_url: string | null
          expires_at: string | null
        } | null
        gtm_container: {
          last_generated_at: string
        } | null
      }
    }
    verification: {
      latest_crawl_run: {
        run_id: string
        completed_at: string
        signals_found: number
      } | null
      baseline: {
        set: boolean
        set_at: string | null
      }
      ihc: {
        drift_count: number
        last_checked_at: string | null
      } | null
    }
  }
  error: string | null
  message: string | null
}
```

**Derivation logic:**
- `preconditions.platforms_connected` — query `platform_connections` for `client_id` WHERE `status = 'active'`, return `platform[]`
- `in_progress.planning_session` — latest `planning_sessions` row for `client_id` (join on `clients.id`) where `status != 'completed'`, ordered by `created_at DESC`
- `in_progress.journey_draft` — latest `journeys` row for `client_id` (via `journey_client_link`) where a journey is in a non-published state. If Journey Builder doesn't currently have draft state, use last modified journey.
- `in_progress.recent_crawl` — latest `crawl_runs` row for the client's `site_url` within last 30 days
- `deployment.signals_count` — COUNT from `deployments` WHERE `client_id` AND `status = 'deployed'`
- `deployment.designed_via` — if both `planning_sessions` and `journeys` exist with saved signals: `'mixed'`; else whichever exists
- `deployment.deliverables` — latest rows from `client_deliverable_exports` per type
- `verification.baseline` — EXISTS `crawl_runs` WHERE `is_baseline = true` for this client site
- `verification.ihc.drift_count` — COUNT from `audit_findings` WHERE `organization_id` and `run_id` in the latest IHC run for this client, not resolved

#### `GET /api/tracking/clients/:clientId/deliverables/build`

Builds the current GTM container JSON and dataLayer spec from the live Signal Library state for this client. Does not persist — returns the artifacts for preview or download.

**Auth:** `authMiddleware`. Verify caller belongs to the same org as the client.

**Response:**
```ts
{
  data: {
    gtm_container: object    // full GTM container JSON
    datalayer_spec: {
      version: string
      generated_at: string
      client: { name: string, website_url: string }
      events: Array<{
        signal_key: string
        event_name: string
        trigger: string
        datalayer_push: object   // the exact dataLayer.push({...}) call
        parameters: object
        platform_mappings: object
        notes: string | null
      }>
    }
  }
  error: string | null
  message: string | null
}
```

**Service to create:** `backend/src/services/tracking/deliverableBuilder.ts`

Reads from `deployments JOIN signals WHERE client_id AND status = 'deployed'`. Reuses the GTM container generation logic already in `backend/src/services/gtm/` — extend rather than duplicate.

#### `POST /api/tracking/clients/:clientId/deliverables/export`

Persists an export to `client_deliverable_exports`. Called immediately after download.

**Auth:** `authMiddleware`.

**Request body (Zod-validated):**
```ts
{
  export_type: 'gtm_container' | 'datalayer_spec' | 'combined'
}
```

**Response:** `{ data: { id: string, created_at: string }, error, message }`

#### `POST /api/tracking/clients/:clientId/deliverables/share`

Generates a public-readable shareable link for the dataLayer spec. Stores snapshot of current spec content in `shareable_deliverable_links`.

**Auth:** `authMiddleware`.

**Request body (Zod-validated):**
```ts
{
  expires_in_days: number  // 30 | 60 | 90, default 30
}
```

**Response:**
```ts
{
  data: {
    share_url: string   // https://atlas.vimi.digital/share/:token
    token: string
    expires_at: string
  }
  error: string | null
  message: string | null
}
```

**Service to create:** `backend/src/services/tracking/shareableLinkService.ts`
- Generate `share_token` using `crypto.randomBytes(32).toString('hex')`
- Build spec content by calling `deliverableBuilder` internally
- Insert into `shareable_deliverable_links`

### 5.2 New route file: `backend/src/api/routes/share.ts`

Register at `/api/share`. **This route must NOT use `authMiddleware`.**

#### `GET /api/share/:token`

Public endpoint for reading a shareable deliverable link.

**Auth:** None. Use `supabaseAdmin` for the DB query to bypass RLS.

**Logic:**
1. Look up `shareable_deliverable_links` WHERE `share_token = :token` AND `expires_at > NOW()`
2. If not found or expired → 404
3. Increment `view_count`, set `last_viewed_at = NOW()`
4. Return content

**Response:**
```ts
{
  data: {
    deliverable_type: string
    content: object
    client_name: string
    expires_at: string
    generated_at: string
  }
  error: string | null
  message: string | null
}
```

### 5.3 Modify: `backend/src/api/routes/journeys.ts`

Add `POST /api/journeys/:id/save-to-library` — mirrors the existing `POST /api/planning/sessions/:id/save-to-library` in `planning.ts`.

**Logic:**
1. Load journey stages for this journey ID
2. For each stage, upsert into `signals` table (org-scoped, `is_custom = true`, `is_system = false`)
3. Create `signal_pack_signals` entry linking these signals to a pack named after the journey
4. Create/update `deployments` rows for the associated client
5. Write `signal_library_synced_at` and `signal_library_signal_id` back to each `journey_stages` row

**Request body:** none (derives everything from the journey ID)

**Response:** `{ data: { signals_created: number, pack_id: string }, error, message }`

### 5.4 Modify: `backend/src/api/routes/clients.ts`

The `business_type` and `primary_conversion_objective` fields are now part of client creation and update. Extend existing `POST /api/clients` and `PATCH /api/clients/:id` Zod schemas to include:
```ts
business_type: z.enum(['ecommerce','lead_gen','b2b_saas','marketplace','nonprofit','b2b_lead_gen']).optional()
primary_conversion_objective: z.string().max(500).optional()
```

---

## 6. Frontend

### 6.1 New routes — add to React Router config (App.tsx)

```tsx
// Inside ProtectedRoute wrapper
<Route path="/clients/:clientId/tracking" element={<SetupTrackingHubPage />} />

// Outside ProtectedRoute — public, no app shell
<Route path="/share/:token" element={<PublicDeliverableView />} />
```

### 6.2 New page: `frontend/src/pages/SetupTrackingHubPage.tsx`

- Wrap in `SectionErrorBoundary`
- On mount: call `GET /api/tracking/clients/:clientId/status`, store in `trackingHubStore`
- Show full-page skeleton while loading
- Render one of three states (A, B, C) based on store state
- Read `clientId` from `useParams()`

**State A — Empty (no tagging designed)**

Heading: *"How would you like to set up tracking for [Client Name]?"*
Subheading: *"Choose an approach based on where your client is starting from."*
Render `<IntentCard />` × 3

**State B — In progress**

Render `<InProgressBanner />` for each in-progress module (can be multiple)
Below: `<IntentCard />` × 3 with modified label "Continue or start a fresh approach"

**State C — Design complete**

Render `<TaggingSummaryCard />`, `<DeliverablesCard />`, `<VerificationCard />`
Collapsed `<RedesignDrawer />` at bottom

**State determination logic (in `trackingHubStore`):**
```ts
type HubState = 'empty' | 'in_progress' | 'complete'

function deriveHubState(status: TrackingStatus): HubState {
  if (status.deployment.signals_count > 0) return 'complete'
  const hasInProgress =
    status.in_progress.planning_session !== null ||
    status.in_progress.journey_draft !== null
  return hasInProgress ? 'in_progress' : 'empty'
}
```

### 6.3 New components: `frontend/src/components/tracking/`

#### `IntentCard.tsx`

Props:
```ts
interface IntentCardProps {
  intent: 'plan_from_scratch' | 'audit_existing' | 'inventory'
  preconditions: {
    website_url: boolean
    business_type: boolean
    platforms_connected: string[]
    subscription_supports_cse: boolean
  }
  clientId: string
  businessType: string | null
}
```

Content per intent:

| Intent | Title | Description | Best when | Output | CTA label | Route |
|---|---|---|---|---|---|---|
| `plan_from_scratch` | Plan tagging from scratch | Build a structured tagging plan based on your client's business type. | Your client has little or no existing tracking, or you want a clean reset. | Tagging plan in Signal Library, dataLayer spec, GTM container JSON | Open Journey Builder | `/journey/new?client_id=:clientId&business_type=:businessType` |
| `audit_existing` | Audit and improve existing tagging | Scan the client's site and get AI-curated recommendations to fix gaps and inconsistencies. | Your client already has tracking and you want to improve it, not replace it. | Approved recommendations in Signal Library, implementation guide, updated GTM container | Open Planning Mode | `/planning?client_id=:clientId` |
| `inventory` | Inventory what's currently running | Catalogue every tracking signal currently firing on the site. No recommendations — just a snapshot. | Discovery calls, status checks, or pre-pitch audits. | Signal inventory report | Run a site scan | Calls CSE trigger, then routes to `/crawl/:runId` |

**Disabled state (precondition not met):**
- Card is rendered at 50% opacity
- CTA replaced by an inline pill button: "Add website URL first" or "Set business type first" or "Upgrade to run site scans"
- Clicking the pill opens a small `<Dialog>` that captures the missing field and POSTs to `PATCH /api/clients/:id`, then enables the card

**Subscription gate for CSE card:**
- Check `req.user.plan` (available in auth context). CSE requires `pro` or `agency`
- If `free`: show `<PlanGate minPlan="pro">` overlay on card

#### `InProgressBanner.tsx`

Props:
```ts
interface InProgressBannerProps {
  module: 'planning' | 'journey' | 'crawl'
  detail: {
    id: string
    label: string          // e.g. "Planning session · started 3 days ago · 4 of 7 pages reviewed"
    resume_url: string
  }
  onDiscard: () => void
}
```

UI: amber-tinted banner with `module` icon, `detail.label`, "Resume" button (navigates to `resume_url`), "Discard" button (calls discard endpoint, removes banner from store).

#### `TaggingSummaryCard.tsx`

Props: derived from `TrackingStatus.deployment`

Displays:
- Signal count badge
- Stage count badge
- "Last updated by [name] on [date]"
- "Designed via: [Planning Mode | Journey Builder | Mixed]"
- `<Button variant="outline">View all signals for this client</Button>` → `/signals?client_id=:clientId`

#### `DeliverablesCard.tsx`

Props: `clientId: string`, `deliverables: TrackingStatus['deployment']['deliverables']`

**For your developer section:**
- "Download dataLayer spec (PDF)" → `GET /api/tracking/clients/:clientId/deliverables/build`, triggers PDF download, then `POST /api/tracking/clients/:clientId/deliverables/export`
- "Generate shareable link" → `POST /api/tracking/clients/:clientId/deliverables/share`, shows the returned URL in a copy-to-clipboard input
- "Regenerate" (small text button) — visible if `last_generated_at` is older than last signal update

**For GTM import section:**
- "Download GTM container JSON" → same build endpoint, JSON file download
- "Regenerate from current Signal Library state" — same endpoint, re-downloads

Show `last_generated_at` timestamp under each button. Skeleton while building.

#### `VerificationCard.tsx`

Props: `clientId: string`, `siteUrl: string`, `verification: TrackingStatus['verification']`

States:
- **Empty (no baseline):** "Once your developer has implemented the dataLayer and you've imported the GTM container, run a scan to confirm signals are firing." + "Run verification scan" button
- **Crawl running:** progress bar, "Scanning [siteUrl]…"
- **Baseline set:** green badge "Verified [date]", drift count if > 0, "Re-baseline" + "View drift" buttons

"Run verification scan" calls `POST /api/crawl/trigger` (existing CSE endpoint), receives `runId`, polls `/api/crawl/run/:runId` for completion. On completion, offers to promote to baseline via `POST /api/ihc/baseline` (existing endpoint).

#### `RedesignDrawer.tsx`

A `<Sheet side="bottom">` (shadcn Sheet) with the three `<IntentCard />` components rendered inside. Trigger: "Need to redesign or add to existing tracking?" link button at the bottom of State C.

If `verification.baseline.set === true`, show a warning before opening: *"Redesigning your tagging will invalidate the current IHC baseline. You'll need to re-verify after implementing changes. Continue?"*

### 6.4 New page: `frontend/src/pages/PublicDeliverableView.tsx`

- **No app shell** — do not wrap in `AppLayout`. Render a standalone page.
- On mount: call `GET /api/share/:token`
- If 404 or expired: show friendly error — "This link has expired or is invalid. Ask your Atlas contact to generate a new one."
- On success: render the dataLayer spec content in a clean, print-friendly layout

Page structure:
```
[Atlas logo — link to atlas.vimi.digital]
[Client name] — DataLayer Implementation Spec
Generated [date] · [X events]

[For each event:]
  Event: [event_name]
  Trigger: [trigger description]
  DataLayer push:
    [code block with exact dataLayer.push({...}) call]
  Parameters:
    [table of param name / type / required / description]
  Platform mappings:
    [GA4 | Meta | Google Ads equivalents]
  Notes: [if any]

[Footer: "Generated by Atlas · View Atlas at atlas.vimi.digital"]
```

No auth required. No sidebar. Minimal Tailwind classes. Suitable for printing or sharing as-is.

### 6.5 New store: `frontend/src/store/trackingHubStore.ts`

```ts
interface TrackingHubStore {
  status: TrackingStatus | null
  hubState: 'empty' | 'in_progress' | 'complete'
  isLoading: boolean
  error: string | null
  shareUrl: string | null
  shareExpiry: string | null
  isGeneratingDeliverables: boolean
  isGeneratingShareLink: boolean

  // Actions
  fetchStatus: (clientId: string) => Promise<void>
  discardInProgress: (module: 'planning' | 'journey' | 'crawl', id: string) => Promise<void>
  buildAndDownloadDeliverables: (clientId: string, type: 'gtm_container' | 'datalayer_spec') => Promise<void>
  generateShareLink: (clientId: string, expiresInDays: number) => Promise<void>
  triggerVerification: (clientId: string, siteUrl: string) => Promise<void>
  reset: () => void
}
```

### 6.6 New API client: `frontend/src/lib/api/trackingApi.ts`

Functions:
- `fetchTrackingStatus(clientId: string): Promise<TrackingStatus>`
- `buildDeliverables(clientId: string): Promise<DeliverablesBuildResult>`
- `exportDeliverable(clientId: string, type: string): Promise<void>`
- `generateShareLink(clientId: string, expiresInDays: number): Promise<ShareLinkResult>`
- `fetchPublicShare(token: string): Promise<PublicShareResult>`

### 6.7 New types: `frontend/src/types/tracking.ts`

Define `TrackingStatus`, `DeliverablesBuildResult`, `ShareLinkResult`, `PublicShareResult` matching the response shapes in section 5.

### 6.8 Modify: `frontend/src/pages/ClientDetailPage.tsx`

Add a "Tracking" tab to the existing tab group. Tab content: `<SetupTrackingHubPage />` rendered inline (or navigate to `/clients/:clientId/tracking` — prefer navigation to keep each page focused).

### 6.9 Modify: `frontend/src/components/layout/Sidebar.tsx`

Under the client section, if a client is selected, add "Set up tracking" as a secondary nav item linking to `/clients/:clientId/tracking`.

### 6.10 Modify: `frontend/src/lib/api/journeyApi.ts`

Add:
```ts
saveToLibrary(journeyId: string): Promise<{ signals_created: number; pack_id: string }>
```

---

## 7. Technical Constraints

- Follow `{ data, error, message }` response shape on all endpoints
- All backend request bodies validated with Zod
- Use `supabaseAdmin` in `GET /api/share/:token` — no `authMiddleware` on that route
- Resolve `organization_id` via `supabaseAdmin.from('profiles').select('organization_id').eq('id', req.user.id)` in all protected tracking routes
- `noUnusedLocals: true` and `noUnusedParameters: true` — remove any unused imports
- Wrap `SetupTrackingHubPage` in `SectionErrorBoundary`
- Every async operation in the hub shows a skeleton or spinner — no blank loading states
- `PublicDeliverableView` must not import or reference any auth hooks or stores
- The `deliverableBuilder` service must not duplicate GTM generation logic — extend `backend/src/services/gtm/`
- Do not log decrypted credentials anywhere in the new services

---

## 8. Acceptance Criteria

- [ ] `GET /api/tracking/clients/:clientId/status` returns correct state for a client with no history (empty), a client with a draft planning session (in_progress), and a client with deployed signals (complete)
- [ ] State A renders three intent cards; each card's CTA navigates to the correct module with `client_id` param
- [ ] Pre-condition inline modals (missing website_url, missing business_type) save the field and enable the card without a page reload
- [ ] CSE card is gated behind `pro` plan; free users see an upgrade CTA
- [ ] State B renders all in-progress banners present; Resume navigates correctly; Discard removes the banner
- [ ] State C renders `TaggingSummaryCard`, `DeliverablesCard`, `VerificationCard`
- [ ] "Download dataLayer spec" produces a valid PDF download; the export is logged in `client_deliverable_exports`
- [ ] "Download GTM container JSON" produces a valid JSON file download; the export is logged
- [ ] "Generate shareable link" returns a URL; opening it in a private/incognito browser window (no Atlas session) renders `PublicDeliverableView` with the correct spec
- [ ] An expired share token returns a 404 from the backend and renders the expired-link error state in `PublicDeliverableView`
- [ ] `POST /api/journeys/:id/save-to-library` creates signals and deployments in Signal Library for the associated client
- [ ] `RedesignDrawer` shows the baseline-invalidation warning when a baseline is set
- [ ] All new TypeScript files pass strict compilation with no unused imports
- [ ] `PublicDeliverableView` renders correctly without being authenticated

---

## 9. Open Decisions

These were flagged during design and need a resolution before or during implementation:

1. **Mixed-design source of truth.** When a client has both a Planning Mode session and a Journey Builder journey, which signals are authoritative for deliverable generation? **Recommended default:** Signal Library is the source of truth. Both modules write to it via save-to-library. Deliverables are always built from `deployments` for that client regardless of origin.

2. **Developer interactivity on shareable spec.** Should the developer be able to mark events as "implemented" on the public view? **Recommended default:** View-only for this release. Add implementation tracking in v2.

3. **Shareable link expiry default.** **Recommended default:** 30 days, not configurable in this release.

4. **Discard in-progress flow.** What does "Discard" do for a planning session vs a journey? For planning: soft-delete the session (set status to 'discarded'). For journey: keep the journey but remove the `journey_client_link` so it no longer surfaces here.
