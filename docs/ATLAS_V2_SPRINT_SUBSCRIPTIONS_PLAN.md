# Sprint Plan: Subscription Management, Pricing Config & Fair-Use Enforcement
**Atlas V2 — Signal Intelligence Platform**
**PRD:** `docs/atlas-prd-subscriptions-pricing-config.md`
**Branch:** `claude/sprint-plan-subscriptions-tvYHx`
**Estimated total build time:** 3 days

---

## Overview

This sprint implements three tightly coupled components from the PRD:

1. **`ATLAS_PRICING` typed constant** — single source of truth for tier entitlements
2. **`org_subscriptions` table** — canonical subscription record per org
3. **Fair-use cap enforcement job** — nightly check, violation logging, operator alerts
4. **Admin dashboard wiring** — gross margin using live subscription data

### Important codebase context

- The existing `free`/`pro`/`agency` plan tiers (in `planGuard.ts`, `profiles.plan`) are **Stripe billing-gate tiers** — they control feature access. The new `AtlasTier` types are **commercial entitlement tiers** (Monitor, Management, etc.). These are parallel systems; do not conflate them.
- `backend/src/jobs/` does not yet exist — create it in Sprint 2.3.
- `usageQueries.ts` hardcodes `PLAN_MRR` at line 4. Sprint 2.4 replaces this with a join against `org_subscriptions`.
- The existing margin alert in `usageQueries.ts` uses `console.warn`. Sprint 2.3's `sendOperatorAlert()` should follow the same pattern (pluggable, starts as `console.error` for high-severity, `console.warn` for medium).
- The `clients` table exists in Supabase but uses `organisation_id` as its FK column (not `agency_org_id` as the PRD draft assumes). The fair-use client count query must use `organisation_id`.
- The nightly cron at `0 2 * * *` in `worker.ts` already runs `refreshUsageMonthlySummary`. The fair-use job slots in immediately after.

---

## Sprint 2.1 — Pricing Config

**Estimate:** 0.5 days  
**Depends on:** nothing  
**Blocks:** Sprints 2.2, 2.3, 2.4

### Tasks

#### 2.1.1 — Create `backend/src/config/pricing.ts`

Create the file exactly as specified in PRD §5.1. Includes:

- `DirectTier`, `AgencyTier`, `AtlasTier` union types
- `BillingCadence`, `Currency` types
- `DirectTierConfig`, `AgencyTierConfig`, `TierConfig` interfaces
- `ATLAS_PRICING` constant with all 9 tiers
- `BILLING_DISCOUNTS`, `ACCELERATOR_DISCOUNT`, `ATLAS_ADDONS` constants
- Helper functions: `getEffectiveMrrUsd`, `getPageCap`, `getMaxClients`

File: `backend/src/config/pricing.ts`

#### 2.1.2 — Replace hardcoded `PLAN_MRR` references with a placeholder bridge

`usageQueries.ts` line 4 defines `PLAN_MRR` with `{ free: 0, pro: 399, agency: 799 }`. This is used by `getUsagePortfolio()` until Sprint 2.4 wires in `org_subscriptions`. Do not delete it yet — add a `TODO: replace with org_subscriptions join in Sprint 2.4` comment above it so the tech debt is visible.

File: `backend/src/services/database/usageQueries.ts` (comment only, no logic change)

#### 2.1.3 — TypeScript build check

Run `tsc --noEmit` from `backend/` to confirm the new file compiles clean with no unused exports.

### Acceptance criteria

- `tsc --noEmit` passes in `backend/`
- `ATLAS_PRICING['monitor'].page_cap_per_domain === 25`
- `getMaxClients('monitor')` returns `null`
- `getMaxClients('agency_starter')` returns `5`
- `getEffectiveMrrUsd('management', 'annual')` returns `1200` (1500 × 0.8)

---

## Sprint 2.2 — Database Schema

**Estimate:** 0.5 days  
**Depends on:** Sprint 2.1 (for tier type reference in comments)  
**Blocks:** Sprints 2.3, 2.4

### Tasks

#### 2.2.1 — Create migration: `org_subscriptions` + `cap_violations`

File: `supabase/migrations/20260520_002_org_subscriptions.sql`

> Use date `20260520` to sequence after the most recent migration (`20260520_001_usage_events.sql`).

The migration must include, in order:

1. `update_updated_at()` function creation — use `CREATE OR REPLACE FUNCTION` so it is safe to run if already defined.
2. `org_subscriptions` table (schema exactly as in PRD §6.1).
3. Indexes on `org_subscriptions`: `org_id`, `status`, `tier`.
4. `updated_at` trigger on `org_subscriptions`.
5. `org_active_subscriptions` view (PRD §6.3).
6. `cap_violations` table (schema exactly as in PRD §7.2).
7. Indexes on `cap_violations`: `org_id`, partial index on `resolved = false`.
8. RLS policies:
   - Both tables: `ENABLE ROW LEVEL SECURITY`
   - Service-role bypass: `CREATE POLICY "service role full access" ON org_subscriptions TO service_role USING (true) WITH CHECK (true);` — repeat for `cap_violations`.
   - No user-facing policies in this phase (manual operator management only).

#### 2.2.2 — Verify `clients` table column compatibility

Before Phase 3 can query client counts, confirm the `clients` table FK column name. The PRD draft uses `agency_org_id` but the Atlas codebase uses `organisation_id` on the `clients` table (see `backend/src/types/organisation.ts` — `Client.organisation_id`).

**The fair-use query in Sprint 2.3 must use `organisation_id`, not `agency_org_id`.**

No code change needed in this sprint — just document the finding as a note at the top of the migration file so Sprint 2.3 implementer doesn't copy the PRD query verbatim.

#### 2.2.3 — Add `OrgSubscription` and `CapViolation` TypeScript types

File: `backend/src/types/subscription.ts` (new file)

```typescript
// Matches org_subscriptions table
export interface OrgSubscription {
  id: string;
  org_id: string;
  tier: string; // AtlasTier
  currency: 'USD' | 'AED' | 'SGD';
  contracted_price: number;
  mrr_usd: number;
  billing_cadence: 'one_time' | 'monthly' | 'quarterly' | 'annual';
  cadence_discount_pct: number;
  accelerator_partner: boolean;
  custom_discount_pct: number;
  custom_discount_reason: string | null;
  addons: Record<string, boolean | number>;
  started_at: string;
  ends_at: string | null;
  trial_ends_at: string | null;
  status: 'trial' | 'active' | 'paused' | 'cancelled' | 'expired';
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Matches cap_violations table
export interface CapViolation {
  id: string;
  org_id: string;
  cap_type: 'page_scan' | 'domain_count' | 'client_count' | 'query_count';
  domain: string | null;
  cap_value: number;
  actual: number;
  usage_pct: number;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
}
```

### Acceptance criteria

- Migration applies cleanly against local Supabase (no errors).
- `org_active_subscriptions` view returns the most recent active/trial row per org.
- `cap_violations` has the partial index on `resolved = false`.
- `backend/src/types/subscription.ts` compiles with `tsc --noEmit`.

---

## Sprint 2.3 — Fair-Use Enforcement Job

**Estimate:** 1 day  
**Depends on:** Sprints 2.1, 2.2  
**Blocks:** Sprint 2.4 (violations count column)

### Tasks

#### 2.3.1 — Create `backend/src/jobs/` directory and `fairUseCap.ts`

File: `backend/src/jobs/fairUseCap.ts`

Implement `runFairUseCapCheck()` as described in PRD §7.1 with these **codebase-specific adjustments**:

**Client count query — use `organisation_id` not `agency_org_id`:**
```typescript
// The clients table in Atlas uses organisation_id, not agency_org_id (PRD draft was incorrect)
const { count: activeClients } = await supabase
  .from('clients')
  .select('*', { count: 'exact', head: true })
  .eq('organisation_id', org.org_id)
  .eq('status', 'active');
```

**Domain count check (add this — PRD §7.1 mentions it but the code sketch omits it):**
For direct tiers, also count distinct domains in `usage_events` for the current month and compare against `ATLAS_PRICING[tier].domains`. Log a `domain_count` cap violation if exceeded.

**`logCapViolation()` helper:** Upsert into `cap_violations`. Use `supabaseAdmin` (service role) not the user-scoped `supabase` client.

**`sendOperatorAlert()` implementation:** Do not import from a non-existent `lib/alerts`. Implement it inline in `fairUseCap.ts` as:
```typescript
function sendOperatorAlert(message: string, severity: 'medium' | 'high'): void {
  if (severity === 'high') {
    console.error(`[FAIR-USE ALERT] ${message}`);
  } else {
    console.warn(`[FAIR-USE ALERT] ${message}`);
  }
  // TODO: wire to Slack/email when alert delivery mechanism is decided (PRD open question #1)
}
```
This matches the pattern already used by `runMarginAlertCheck()` in `usageQueries.ts`.

**Alert message format** (match PRD §7.3):
```
⚠️  FAIR-USE VIOLATION — {Org Name}
Tier: {tier} (${mrr_usd}/mo)
Cap type: {cap_type}
Domain: {domain or 'N/A'}
Entitlement: {cap_value} {unit}
Actual this month: {actual} ({usage_pct}% of cap)
Severity: {HIGH | MEDIUM}
```

**Severity thresholds** (PRD §7.3):
- 100–149% → `medium`, log only
- 150%+ → `high`, log + alert

#### 2.3.2 — Wire fair-use job into nightly cron in `worker.ts`

File: `backend/src/services/queue/worker.ts`

The existing nightly job handler (around line 415) processes `usage-summary-nightly`. After `refreshUsageMonthlySummary()` completes, call `runFairUseCapCheck()`:

```typescript
// Existing pattern (do not change the job name or schedule):
// { repeat: { cron: '0 2 * * *' }, jobId: 'usage-summary-nightly' }

// In the job handler, after refreshUsageMonthlySummary():
await refreshUsageMonthlySummary();
await runFairUseCapCheck();       // ← add this line
await runMarginAlertCheck();      // ← if this exists separately, keep order
```

If `runMarginAlertCheck` is called inside `refreshUsageMonthlySummary` already (check the function body), add `runFairUseCapCheck()` call after `refreshUsageMonthlySummary()` returns.

#### 2.3.3 — Create `backend/src/services/database/subscriptionQueries.ts`

Centralise all DB queries for subscriptions. Expose:

```typescript
export async function getActiveSubscription(orgId: string): Promise<OrgSubscription | null>
export async function listActiveSubscriptions(): Promise<OrgSubscription[]>
export async function upsertCapViolation(v: Omit<CapViolation, 'id' | 'created_at'>): Promise<void>
export async function listOpenViolations(orgId: string): Promise<CapViolation[]>
export async function resolveViolation(id: string, resolution: string): Promise<void>
```

Use `supabaseAdmin` for all queries (these are operator operations).

#### 2.3.4 — Build and type check

Run `tsc --noEmit` from `backend/`. Zero errors required.

### Acceptance criteria

- `runFairUseCapCheck()` executes without throwing when there are no active subscriptions.
- A synthetic org with `page_cap_per_domain = 25` and `pages_scanned = 40` produces one `page_scan` violation row in `cap_violations` with `usage_pct ≈ 1.6` and `severity = 'high'`.
- The nightly cron sequence in `worker.ts` calls `runFairUseCapCheck()` after `refreshUsageMonthlySummary()`.
- `tsc --noEmit` passes.

---

## Sprint 2.4 — Admin Dashboard Integration

**Estimate:** 0.5 days  
**Depends on:** Sprints 2.1, 2.2, 2.3  
**Blocks:** nothing

### Tasks

#### 2.4.1 — Update `getUsagePortfolio()` to join `org_subscriptions`

File: `backend/src/services/database/usageQueries.ts`

Replace the hardcoded `PLAN_MRR` lookup with a join against `org_active_subscriptions`. The current flow (line ~117) does:

```typescript
const mrr = PLAN_MRR[plan] ?? 0;
```

Replace with a per-org lookup from `org_active_subscriptions`. Options:

**Option A (preferred):** Pre-fetch all active subscriptions before the loop, build a `Map<orgId, mrrUsd>`, then replace the `PLAN_MRR` lookup:
```typescript
const { data: subs } = await supabaseAdmin.from('org_active_subscriptions').select('org_id, mrr_usd');
const mrrByOrg = new Map(subs?.map(s => [s.org_id, s.mrr_usd]) ?? []);
// ...in loop:
const mrr = mrrByOrg.get(orgId) ?? 0;
```

Keep `PLAN_MRR` defined in the file but remove it from the critical path so the function still compiles if no subscriptions exist yet. Add a fallback to `PLAN_MRR` for orgs with no subscription row (`?? PLAN_MRR[plan] ?? 0`).

**Remove the TODO comment added in Sprint 2.1.2.**

#### 2.4.2 — Add `open_violations_count` to `UsagePortfolioRow`

File: `backend/src/services/database/usageQueries.ts`

1. Add `open_violations_count: number` field to the `UsagePortfolioRow` interface.
2. In `getUsagePortfolio()`, after building the `mrrByOrg` map, also pre-fetch open violation counts:
   ```typescript
   const { data: violations } = await supabaseAdmin
     .from('cap_violations')
     .select('org_id')
     .eq('resolved', false);
   const violationsByOrg = new Map<string, number>();
   for (const v of violations ?? []) {
     violationsByOrg.set(v.org_id, (violationsByOrg.get(v.org_id) ?? 0) + 1);
   }
   // ...in loop:
   open_violations_count: violationsByOrg.get(orgId) ?? 0,
   ```

#### 2.4.3 — Expose violations count in admin portfolio API

File: `backend/src/api/routes/admin.ts`

The `GET /api/admin/usage` endpoint returns `UsagePortfolioRow[]`. Since the type now includes `open_violations_count`, it flows through automatically. No route changes needed — verify the field appears in the response.

#### 2.4.4 — Update `AdminPage.tsx` portfolio table

File: `frontend/src/pages/AdminPage.tsx`

Add an "Open Violations" column to the usage portfolio table. If `open_violations_count > 0`, render it as an amber/red badge. If `0`, show a green dash.

Update the frontend type for the portfolio row to include `open_violations_count?: number` (optional so it degrades gracefully before the backend is deployed).

#### 2.4.5 — Add `tier` column to portfolio table (display-only)

The portfolio table currently shows `plan` (the Stripe tier: free/pro/agency). Add a `Subscription Tier` column sourced from `org_active_subscriptions` to show the commercial tier (e.g. "Monitor", "Management"). This requires the admin portfolio query to also return the subscription tier.

In `getUsagePortfolio()`, add `tier: string | null` to `UsagePortfolioRow` and populate it from the `org_active_subscriptions` join (null if no subscription row exists for that org).

In `AdminPage.tsx`, render the tier as a badge next to or replacing the existing plan badge.

### Acceptance criteria

- `GET /api/admin/usage` response includes `open_violations_count` and `tier` on each row.
- Orgs with no `org_subscriptions` row show `mrr_usd: 0`, `tier: null`, `open_violations_count: 0`.
- Portfolio table in `AdminPage.tsx` shows an amber badge for orgs with >0 open violations.
- `tsc --noEmit` passes in both `backend/` and `frontend/`.

---

## Pre-Build Checklist (run before starting Sprint 2.2)

Verify in Supabase SQL editor:

```sql
-- 1. organisations table has uuid id column
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'organisations' AND column_name = 'id';

-- 2. clients table FK column name
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'clients' ORDER BY ordinal_position;

-- 3. usage_events table exists (for fair-use queries)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'usage_events';

-- 4. usage_monthly_summary exists (for sequencing)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'usage_monthly_summary';
```

**Expected:** `clients.organisation_id` (not `agency_org_id`). If the column name differs, update the client-count query in Sprint 2.3.1 accordingly.

---

## Open Questions to Resolve Before Sprint 2.3

| # | Question | Impact | Owner |
|---|---|---|---|
| 1 | Alert delivery: Slack webhook, email, or console-only for now? | Determines `sendOperatorAlert()` implementation depth | Vikram |
| 2 | Operations tier overage ($0.50/page): manual flag for next invoice, or auto-calculated? | Determines whether Sprint 2.4 needs an overage line in the portfolio view | Vikram |

---

## File Change Summary

| File | Sprint | Change |
|---|---|---|
| `backend/src/config/pricing.ts` | 2.1 | **New** — full ATLAS_PRICING constant |
| `backend/src/types/subscription.ts` | 2.2 | **New** — OrgSubscription, CapViolation types |
| `supabase/migrations/20260520_002_org_subscriptions.sql` | 2.2 | **New** — org_subscriptions, cap_violations, view |
| `backend/src/jobs/fairUseCap.ts` | 2.3 | **New** — runFairUseCapCheck() |
| `backend/src/services/database/subscriptionQueries.ts` | 2.3 | **New** — DB helpers for subscriptions |
| `backend/src/services/queue/worker.ts` | 2.3 | **Edit** — add fairUseCap to nightly cron |
| `backend/src/services/database/usageQueries.ts` | 2.1 + 2.4 | **Edit** — TODO comment, then join replacement |
| `backend/src/api/routes/admin.ts` | 2.4 | **Verify** — no changes needed |
| `frontend/src/pages/AdminPage.tsx` | 2.4 | **Edit** — violations badge + tier column |

---

## Out of Scope (future phases per PRD §4)

- Stripe / payment gateway integration for subscription creation
- Customer-facing subscription management UI (`/admin/subscriptions` form)
- Automated overage billing / invoice generation
- Proration for mid-cycle upgrades
