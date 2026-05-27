# PRD-005: In-House Marketer Onboarding

**Product:** Atlas V2 — `atlas.vimi.digital`
**Repo:** `Vikramj01/AtlasV2`
**Status:** Ready for implementation
**Depends on:** PRD-002 (Onboarding Checklist), PRD-003 (org type at signup)
**Parallel with:** PRD-003, PRD-004
**Primary persona:** In-house marketing team member (one brand, no clients to manage)

---

## 1. Overview

The in-house marketer is an Atlas user managing tracking for their own company — not for external clients. They have exactly one "client" entity (their own brand), direct access to their own platforms, and no interest in client management flows.

The current product is designed around the agency model — multi-client management, client picker, "Clients" navigation — which is disorienting for someone who is the marketer, not the consultant.

This PRD adapts the onboarding and core navigation for `org_type = 'brand'` accounts. The underlying modules (Planning Mode, Journey Builder, Signal Library, CSE, CAPI, etc.) are unchanged. What changes is:

1. **Signup** — org type captured (added in PRD-003); brand accounts trigger a different post-signup setup
2. **Auto-client creation** — a single client entity is created automatically from the brand's signup data; no "Add a client" step
3. **Onboarding checklist variant** — same component as PRD-002 with brand-mode props; step 2.1 is pre-completed and renamed
4. **Navigation variant** — sidebar hides the Clients list and shows "My Tracking" as a direct link
5. **Copy and tone** — "your client" → "your site" / "your company" throughout

This is implemented as a variant of the existing onboarding and layout components — not a separate codebase. The same routes, pages, and modules work unchanged; the adaptation is at the component and nav level.

---

## 2. User Stories

- As an in-house marketer, I want to set up tracking for my own company without being asked to manage "clients"
- As an in-house marketer, I want to get from signup to a working GTM container and dataLayer spec without navigating a multi-client interface
- As an in-house marketer, I want the sidebar to take me straight to my tracking setup, not a list of clients

---

## 3. Scope

**In scope:**
- Post-signup auto-client creation for `org_type = 'brand'`
- `organizations.primary_client_id` — stores the auto-created client reference
- Brand-mode variant props for `OnboardingChecklist`
- Brand-mode variant for `Sidebar` navigation
- Copy/label changes throughout onboarding for brand accounts
- Signup extended to capture company website (used to pre-fill auto-client)
- Redirect rules: brand accounts skip `ClientListPage`, land at their tracking hub directly

**Out of scope:**
- Any changes to Planning Mode, Journey Builder, CSE, Signal Library, CAPI, or other feature modules — they work identically for brand accounts
- Team/member management (brand accounts can still invite teammates — just under "Settings", not "Clients")
- Strategy Gate (remains standalone for both org types)
- Per-plan gating changes — brand accounts follow the same plan hierarchy as agencies

---

## 4. Migration

**File:** `supabase/migrations/20260701_005_inhouse_onboarding.sql`

> Replace `20260701` with the actual next sequential date.

```sql
-- Store the auto-created primary client for brand orgs
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations') THEN
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS primary_client_id UUID REFERENCES clients(id),
      ADD COLUMN IF NOT EXISTS signup_website_url TEXT;
  END IF;
END $$;
```

`signup_website_url` captures the brand's website at signup so it can be written to the auto-created client's `website_url`. The `clients.website_url` may already exist per schema.

---

## 5. Backend

### 5.1 Modify: org creation logic

**Where this runs:** The route or Supabase hook that creates the `organizations` row and the initial `profiles` row after Supabase Auth signup completes. Identify the exact location in the codebase.

**Change for `org_type = 'brand'`:** After creating the org row, automatically:

1. Create a `clients` row:
   ```ts
   {
     organization_id: newOrgId,
     name: orgName,              // same as the org name entered at signup
     website_url: signupWebsiteUrl ?? null,
     industry: null,             // left blank, operator fills in onboarding
     business_type: null,        // left blank, operator fills in onboarding variant step
   }
   ```

2. Write `organizations.primary_client_id = newClientId` back to the org row

3. Do NOT create any other clients, journeys, or signal deployments at this point

**Extended signup payload:** The signup form (modified in PRD-003 for org type selection) needs one additional optional field for brand accounts: **company website URL**. Show this field only when the user selects "My company's in-house marketing team" in the org type picker.

Add to the org creation Zod schema:
```ts
{
  org_name: z.string().min(1),
  org_type: z.enum(['agency', 'brand']),
  website_url: z.string().url().optional(),   // brand only
}
```

The `website_url` is written to both `organizations.signup_website_url` and the auto-created client's `website_url`.

---

### 5.2 New endpoint: `GET /api/organisations/me/primary-client`

Convenience endpoint for brand orgs to fetch their primary client ID without querying the full client list.

**Auth:** `authMiddleware`. Resolve `organization_id` from profiles.

**Logic:** Select `primary_client_id` from `organizations WHERE id = :org_id`. If NULL (agency org), return 404.

**Response:**
```ts
{
  data: {
    primary_client_id: string
    client_name: string
    client_website_url: string | null
  }
  error: string | null
  message: string | null
}
```

This is called once in the brand-mode sidebar to build the "My Tracking" direct link.

---

### 5.3 Extend: `GET /api/onboarding/status`

Add `org_type` and `primary_client_id` to the response so the frontend can drive the brand-mode variant without a separate API call:

```ts
// Add to existing response data:
{
  org_type: 'agency' | 'brand'
  primary_client_id: string | null
}
```

Both values come from the `organizations` row — no new queries.

---

## 6. Frontend

### 6.1 Modify: signup UI

**Location:** Identify the existing signup form component — likely in `frontend/src/pages/LoginPage.tsx` or a dedicated signup route.

**Change:** After the user selects "My company's in-house marketing team" (org type picker from PRD-003), reveal an additional field:

> **Your company website** (optional)
> Used to pre-fill your tracking setup
> `[https://example.com]`

The website URL field should only appear for the `brand` selection — hide it for `agency`. It is optional; do not block signup if omitted.

---

### 6.2 Modify: `frontend/src/components/onboarding/OnboardingChecklist.tsx`

Extend to accept an `orgType` prop derived from `onboardingStore.status.org_type`.

```ts
interface OnboardingChecklistProps {
  orgType: 'agency' | 'brand'
  primaryClientId?: string      // only for brand orgs
}
```

**Brand-mode step differences:**

| Step | Agency label | Brand label | Brand behaviour |
|---|---|---|---|
| 2.1 | Add your first client | Connect your company profile | Auto-completed (brand has auto-client); shown as read-only with green checkmark and "Your company is already set up" note |
| 2.2 | Connect platforms for this client | Connect your marketing platforms | Same action, copy updated |
| 2.3 | Design your tagging | Set up your tracking | Same action |
| 2.4 | Generate deliverables | Generate your GTM files | Same action |
| 2.5 | Verify your implementation | Verify your tracking is live | Same action |

Step 2.1 in brand mode:
- Shown as `status: 'complete'` always (the auto-client was created at signup)
- CTA replaced by: "Your company profile is set up — [company name]" with a small edit link to `OrgSettingsPage` to update the name or website if needed
- Does not contribute to the required-steps gate (already satisfied)

Steps 2.2–2.5 use `primaryClientId` in their CTAs in place of the first client's ID from the agency flow.

---

### 6.3 Modify: `frontend/src/components/layout/Sidebar.tsx`

Read `org_type` from the organisation store (or derive from the Supabase session metadata).

**For `org_type = 'agency'`:** Existing navigation unchanged.

**For `org_type = 'brand'`:** Apply the following nav changes:

| Current (agency) | Brand variant |
|---|---|
| Clients (list) | Hidden |
| — | My Tracking (→ `/clients/:primaryClientId/tracking`) |
| Data Manager Console | Hidden (agency-plan only feature) |
| All other nav items | Unchanged |

"My Tracking" should appear near the top of the nav, below Dashboard.

**How to get `primaryClientId` for the sidebar link:**

Option A: Read from `onboardingStore.status.primary_client_id` (already fetched on mount by PRD-002)
Option B: Fetch once via `GET /api/organisations/me/primary-client` and cache in org store

Recommendation: Option A — avoids an additional fetch. The onboarding store is loaded on app init regardless.

---

### 6.4 Modify: `frontend/src/store/organisationStore.ts`

Add `orgType: 'agency' | 'brand' | null` to the store, populated from the org profile on auth. This is the canonical source of `org_type` for the Sidebar and other components.

If `orgType` is not already in the store, add it when the org profile is fetched on app init:
```ts
interface OrganisationStore {
  // existing...
  orgType: 'agency' | 'brand' | null
  primaryClientId: string | null
}
```

Populate `primaryClientId` from `organizations.primary_client_id` when the org is fetched.

---

### 6.5 Routing: brand account redirects

For brand accounts, certain routes should redirect to the brand equivalent:

| If brand account visits | Redirect to |
|---|---|
| `/clients` | `/clients/:primaryClientId/tracking` |
| `/clients/new` | Show a friendly message: "Your company is already set up. Visit My Tracking to manage your tagging." |

Implement via a `<BrandRedirectGuard>` wrapper around those routes:
```tsx
function BrandRedirectGuard({ children }: { children: ReactNode }) {
  const { orgType, primaryClientId } = useOrganisationStore()
  if (orgType === 'brand') {
    return <Navigate to={`/clients/${primaryClientId}/tracking`} replace />
  }
  return <>{children}</>
}
```

---

### 6.6 Copy changes across existing components

The following strings need brand variants. Implement by passing `orgType` as a prop or reading from org store:

| Location | Agency copy | Brand copy |
|---|---|---|
| `SetupTrackingHubPage` heading | "How would you like to set up tracking for [Client Name]?" | "How would you like to set up tracking for [Company Name]?" |
| `IntentCard` — Plan from scratch | "…for this client" | "…for your site" |
| `IntentCard` — Audit existing | "your client's site" | "your site" |
| `VerificationCard` | "your client's site" | "your site" |
| `DeliverablesCard` — developer copy | "your client's developer" | "your developer" |
| `OnboardingStep` 2.2 description | "Connect at least one of Google Ads, Meta, or GA4 for this client" | "Connect at least one of Google Ads, Meta, or GA4" |
| `OrgDashboardPage` heading (if it exists) | "Your clients" | "Your workspace" |

Implement copy changes as a utility:
```ts
// frontend/src/lib/copy.ts
export function clientLabel(orgType: 'agency' | 'brand') {
  return orgType === 'brand' ? 'your company' : 'your client'
}
export function siteLabel(orgType: 'agency' | 'brand') {
  return orgType === 'brand' ? 'your site' : "your client's site"
}
```

Call `copy.clientLabel(orgType)` in components. Do not scatter ternaries throughout JSX — centralise through this utility.

---

### 6.7 Modify: `frontend/src/components/onboarding/OnboardingStep.tsx`

Accept optional `brandLabel` and `brandDescription` props that override the default agency-mode strings when `orgType = 'brand'`. The parent `OnboardingChecklist` passes these only for the steps that differ.

---

## 7. Technical Constraints

- `org_type` check must be read from the org store (already loaded) — do not add new API calls to the Sidebar or shared layout components
- All copy changes must go through the `copy.ts` utility — no inline ternaries in JSX
- Brand-mode sidebar variant must not break agency-mode navigation — conditional on `orgType`, not on feature flags
- `BrandRedirectGuard` must use `replace` navigation to avoid adding to browser history
- Auto-client creation must be atomic with org creation — if the client insert fails, the org creation should roll back. Handle this in the backend route (or Supabase transaction if the auth hook is used).
- `noUnusedLocals` / `noUnusedParameters` strict TypeScript throughout

---

## 8. Acceptance Criteria

- [ ] Selecting "My company's in-house marketing team" at signup shows the company website field
- [ ] After brand signup, `organizations.type = 'brand'`, `organizations.primary_client_id` is set, and a `clients` row exists with the org name and signup website URL
- [ ] Brand accounts see "My Tracking" in the sidebar instead of "Clients"; clicking it navigates to `/clients/:primaryClientId/tracking`
- [ ] Brand accounts visiting `/clients` are redirected to `/clients/:primaryClientId/tracking`
- [ ] `OnboardingChecklist` for brand accounts shows Step 2.1 as pre-completed with brand-appropriate copy; it cannot be un-checked
- [ ] Steps 2.2–2.5 for brand accounts use `primaryClientId` in their CTAs and brand-mode copy
- [ ] `SetupTrackingHubPage` heading and intent card copy reads "your site" not "your client's site" for brand accounts
- [ ] `DeliverablesCard` copy reads "your developer" not "your client's developer" for brand accounts
- [ ] Agency accounts are completely unaffected — all agency flows, copy, and navigation work identically to before this PRD
- [ ] `GET /api/organisations/me/primary-client` returns 404 for agency orgs and correct client data for brand orgs
- [ ] Auto-client creation is rolled back if org creation fails (no orphaned clients)
- [ ] All strict TypeScript checks pass; `copy.ts` exports are the only source of agency/brand label strings

---

## 9. Open Decisions

1. **Brand account plan.** Should `org_type = 'brand'` default to the `pro` plan rather than `free` at signup (the assumption being in-house teams have higher intent than solo free-tier users)? Recommendation: start on `free` plan like everyone else — let billing drive upgrades. No change to plan hierarchy.

2. **Business type for the auto-created client.** The auto-client is created at signup with `business_type = null`. The brand onboarding should prompt the user to set this as part of the "Connect your company profile" step (Step 2.1 in brand mode). Since Step 2.1 is auto-completed, add an inline "Complete your profile" CTA in the step row that opens a lightweight modal to capture `business_type` and `industry`. This is analogous to the pre-condition inline fix in PRD-001.

3. **Can a brand account ever become an agency?** If an in-house marketer expands to consulting, they might want to switch. Recommendation: allow `org_type` to be changed via Settings → Account. On change to `'agency'`: clear `primary_client_id`, show the Clients nav, and set the existing client as their first managed client. This is a low-priority edge case — flag it as a future enhancement.

4. **Multiple brand team members.** When a brand account invites a teammate (Step 1.4), the teammate should also see "My Tracking" not "Clients" in the sidebar. This is already handled if `orgType` is read from the org record at login — no special case needed, confirm that the invited user's session resolves the same org record.
