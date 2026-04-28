# PRD: Subscription Management, Pricing Config & Fair-Use Enforcement
**Atlas — Signal Intelligence Platform**
**Module:** Subscription Management & Pricing Config
**Status:** Draft v1.0
**Author:** Vikram Jayaram / Spi3l LLC
**Date:** April 2026
**Build sequence:** Parallel to Usage Logging infrastructure; required before Admin Dashboard

---

## 1. Overview

The usage logging infrastructure (PRD: Usage Logging & Cost Intelligence) can record what each customer consumes, but it cannot compute gross margin without knowing what each customer pays. This PRD closes that gap by defining three tightly coupled components:

1. **`org_subscriptions` table** — the canonical record of what tier each customer is on, what they pay, and when their subscription runs.
2. **`ATLAS_PRICING` typed constant** — the single source of truth for tier entitlements (page caps, domain limits, scan cadence, included clients) that lives in the backend codebase and is referenced by all modules that need to know what a customer is entitled to.
3. **Fair-use cap enforcement job** — a nightly check that flags any org exceeding their tier entitlements, feeding the admin dashboard and triggering operator alerts before a customer becomes a cost problem.

These three components together form the connective tissue between the pricing model (currently in a spreadsheet) and the live system.

---

## 2. Problem Statement

### 2.1 Current state

- There is no database record of what any customer is paying or which tier they are on. This information exists only in the pricing spreadsheet and in the founder's head.
- The admin dashboard (defined in the Usage Logging PRD) cannot compute gross margin because it has no MRR figure to compare against variable cost.
- Nothing in Atlas knows whether a customer is within their fair-use entitlement. A Monitor customer could theoretically trigger scans on 500 pages and Atlas would not detect or flag it.
- Pricing entitlements (page caps, domain limits, client counts) are not codified anywhere in the codebase. If they change, there is no single file to update.

### 2.2 Why this matters now

The first paying customer makes all three of these gaps immediately painful. You cannot invoice confidently without a subscription record. You cannot know if you are making or losing money on that customer without margin visibility. And you cannot enforce the fair-use caps that the pricing model depends on for its cost assumptions.

---

## 3. Goals

- Create a structured, queryable subscription record for every Atlas customer.
- Codify all tier entitlements in a single typed constant that every backend module imports — no hardcoded tier logic scattered across the codebase.
- Run a nightly check that detects fair-use violations and surfaces them in the admin dashboard before they compound into a billing problem.
- Enable the admin dashboard to show per-customer gross margin in real time.

## 4. Non-Goals

- Stripe or payment gateway integration (future phase — subscriptions are manually managed in this phase).
- Customer-facing subscription management UI (future phase).
- Automated overage billing or invoice generation (future phase).
- Proration calculations for mid-cycle upgrades (future phase — handle manually for now).

---

## 5. Component 1: `ATLAS_PRICING` Typed Constant

This is the first thing to build because everything else references it. It lives in the backend at `src/config/pricing.ts` and is the single source of truth for all tier entitlements.

### 5.1 Structure

```typescript
// src/config/pricing.ts

export type DirectTier =
  | 'diagnostic'
  | 'monitor'
  | 'management'
  | 'operations'
  | 'enterprise';

export type AgencyTier =
  | 'agency_starter'
  | 'agency_growth'
  | 'agency_scale'
  | 'agency_enterprise';

export type AtlasTier = DirectTier | AgencyTier;

export type BillingCadence = 'one_time' | 'monthly' | 'quarterly' | 'annual';

export type Currency = 'USD' | 'AED' | 'SGD';

interface DirectTierConfig {
  type: 'direct';
  mrr_usd: number;
  mrr_aed: number;
  mrr_sgd: number;
  domains: number;
  page_cap_per_domain: number;
  scans_per_month: number;
  ai_reports_per_month: number;
  ondemand_queries_per_month: number;
  scan_cadence: 'weekly' | 'daily' | 'daily_plus_ondemand';
}

interface AgencyTierConfig {
  type: 'agency';
  mrr_usd: number;
  mrr_aed: number;
  mrr_sgd: number;
  max_clients: number;
  domains_per_client: number;
  page_cap_per_domain: number;
  scans_per_month: number;
  ai_reports_per_month_per_client: number;
  ondemand_queries_per_month_per_client: number;
  scan_cadence: 'weekly' | 'daily' | 'daily_plus_ondemand';
  white_label_included: boolean;
}

export type TierConfig = DirectTierConfig | AgencyTierConfig;

export const ATLAS_PRICING: Record<AtlasTier, TierConfig> = {

  // ─── Direct tiers ────────────────────────────────────────────────

  diagnostic: {
    type:                         'direct',
    mrr_usd:                      750,    // one-time, not MRR
    mrr_aed:                      2750,
    mrr_sgd:                      900,
    domains:                      1,
    page_cap_per_domain:          25,
    scans_per_month:              1,      // single audit run
    ai_reports_per_month:         1,
    ondemand_queries_per_month:   0,
    scan_cadence:                 'weekly',
  },

  monitor: {
    type:                         'direct',
    mrr_usd:                      800,
    mrr_aed:                      2950,
    mrr_sgd:                      950,
    domains:                      1,
    page_cap_per_domain:          25,
    scans_per_month:              4,      // weekly
    ai_reports_per_month:         1,
    ondemand_queries_per_month:   0,
    scan_cadence:                 'weekly',
  },

  management: {
    type:                         'direct',
    mrr_usd:                      1500,
    mrr_aed:                      5500,
    mrr_sgd:                      1800,
    domains:                      3,
    page_cap_per_domain:          100,
    scans_per_month:              30,     // daily
    ai_reports_per_month:         4,
    ondemand_queries_per_month:   0,
    scan_cadence:                 'daily',
  },

  operations: {
    type:                         'direct',
    mrr_usd:                      2700,
    mrr_aed:                      9900,
    mrr_sgd:                      3200,
    domains:                      10,
    page_cap_per_domain:          100,
    scans_per_month:              30,     // daily
    ai_reports_per_month:         4,
    ondemand_queries_per_month:   100,
    scan_cadence:                 'daily_plus_ondemand',
  },

  enterprise: {
    type:                         'direct',
    mrr_usd:                      0,      // custom — set on org_subscriptions directly
    mrr_aed:                      0,
    mrr_sgd:                      0,
    domains:                      999,    // effectively unlimited
    page_cap_per_domain:          999,
    scans_per_month:              999,
    ai_reports_per_month:         999,
    ondemand_queries_per_month:   999,
    scan_cadence:                 'daily_plus_ondemand',
  },

  // ─── Agency tiers ────────────────────────────────────────────────

  agency_starter: {
    type:                                 'agency',
    mrr_usd:                              2500,
    mrr_aed:                              9200,
    mrr_sgd:                              2950,
    max_clients:                          5,
    domains_per_client:                   3,
    page_cap_per_domain:                  25,
    scans_per_month:                      4,
    ai_reports_per_month_per_client:      1,
    ondemand_queries_per_month_per_client: 0,
    scan_cadence:                         'weekly',
    white_label_included:                 false,
  },

  agency_growth: {
    type:                                 'agency',
    mrr_usd:                              5500,
    mrr_aed:                              20200,
    mrr_sgd:                              6500,
    max_clients:                          15,
    domains_per_client:                   3,
    page_cap_per_domain:                  50,
    scans_per_month:                      30,
    ai_reports_per_month_per_client:      4,
    ondemand_queries_per_month_per_client: 0,
    scan_cadence:                         'daily',
    white_label_included:                 false,  // available as add-on
  },

  agency_scale: {
    type:                                 'agency',
    mrr_usd:                              10000,
    mrr_aed:                              36750,
    mrr_sgd:                              11800,
    max_clients:                          40,
    domains_per_client:                   3,
    page_cap_per_domain:                  50,
    scans_per_month:                      30,
    ai_reports_per_month_per_client:      4,
    ondemand_queries_per_month_per_client: 30,
    scan_cadence:                         'daily_plus_ondemand',
    white_label_included:                 true,
  },

  agency_enterprise: {
    type:                                 'agency',
    mrr_usd:                              0,      // custom
    mrr_aed:                              0,
    mrr_sgd:                              0,
    max_clients:                          999,
    domains_per_client:                   999,
    page_cap_per_domain:                  999,
    scans_per_month:                      999,
    ai_reports_per_month_per_client:      999,
    ondemand_queries_per_month_per_client: 999,
    scan_cadence:                         'daily_plus_ondemand',
    white_label_included:                 true,
  },
};

// ─── Billing discounts ───────────────────────────────────────────────────────

export const BILLING_DISCOUNTS: Record<BillingCadence, number> = {
  one_time:  0,
  monthly:   0,
  quarterly: 0.10,   // 10% discount
  annual:    0.20,   // 20% discount
};

// Accelerator partner discount — applied on top of cadence discount
export const ACCELERATOR_DISCOUNT = 0.25;  // 25% off Management tier for 12 months

// ─── Add-on pricing (USD) ────────────────────────────────────────────────────

export const ATLAS_ADDONS = {
  extra_domain_direct:        150,   // per domain per month
  extra_domain_agency:        100,   // per additional domain per client per month
  ondemand_query_pack:        250,   // 100 extra queries per month
  dedicated_signal_operator:  950,   // human expert, per month
  white_label_branding:       500,   // agency-only, per month
} as const;

// ─── Helper utilities ────────────────────────────────────────────────────────

/**
 * Returns the effective MRR for an org in USD, accounting for
 * billing cadence discount and any custom price override.
 */
export function getEffectiveMrrUsd(
  tier: AtlasTier,
  cadence: BillingCadence,
  customPriceUsd?: number,
  isAcceleratorPartner?: boolean,
): number {
  const baseMrr = customPriceUsd ?? ATLAS_PRICING[tier].mrr_usd;
  const cadenceDiscount = BILLING_DISCOUNTS[cadence];
  const acceleratorDiscount = isAcceleratorPartner ? ACCELERATOR_DISCOUNT : 0;
  // Discounts don't stack multiplicatively — take the larger one
  const effectiveDiscount = Math.max(cadenceDiscount, acceleratorDiscount);
  return baseMrr * (1 - effectiveDiscount);
}

/**
 * Returns the page cap for a given tier and domain,
 * accounting for any add-on domain overrides.
 */
export function getPageCap(tier: AtlasTier): number {
  return ATLAS_PRICING[tier].page_cap_per_domain;
}

/**
 * Returns the max clients for an agency tier.
 * Returns null for direct tiers (not applicable).
 */
export function getMaxClients(tier: AtlasTier): number | null {
  const config = ATLAS_PRICING[tier];
  if (config.type === 'agency') return config.max_clients;
  return null;
}
```

### 5.2 Usage across modules

Every backend module that needs to check entitlements imports from this file — never hardcodes a number:

```typescript
// ✅ Correct — single source of truth
import { ATLAS_PRICING, getPageCap } from '../config/pricing';
const pageCap = getPageCap(org.tier);

// ❌ Wrong — hardcoded, will drift
if (org.tier === 'monitor' && pageCount > 25) { ... }
```

---

## 6. Component 2: `org_subscriptions` Table

### 6.1 Schema

```sql
CREATE TABLE org_subscriptions (
  id                      uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                  uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  -- Tier and pricing
  tier                    text          NOT NULL,   -- must match AtlasTier keys
  currency                text          NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'AED', 'SGD')),
  contracted_price        numeric(10,2) NOT NULL,   -- actual agreed price in the currency above
  mrr_usd                 numeric(10,2) NOT NULL,   -- always in USD for margin calculations
  billing_cadence         text          NOT NULL DEFAULT 'monthly'
                            CHECK (billing_cadence IN ('one_time', 'monthly', 'quarterly', 'annual')),

  -- Discounts
  cadence_discount_pct    numeric(5,2)  NOT NULL DEFAULT 0,
  accelerator_partner     boolean       NOT NULL DEFAULT false,
  custom_discount_pct     numeric(5,2)  NOT NULL DEFAULT 0,   -- for any bespoke deals
  custom_discount_reason  text          NULL,

  -- Add-ons (stored as a JSONB for flexibility)
  addons                  jsonb         NOT NULL DEFAULT '{}',
  -- Example: { "extra_domains": 2, "white_label": true, "signal_operator": true }

  -- Subscription window
  started_at              timestamptz   NOT NULL,
  ends_at                 timestamptz   NULL,       -- null = open-ended
  trial_ends_at           timestamptz   NULL,       -- null = not on trial

  -- Status
  status                  text          NOT NULL DEFAULT 'active'
                            CHECK (status IN ('trial', 'active', 'paused', 'cancelled', 'expired')),
  cancellation_reason     text          NULL,

  -- Atlas-internal notes (not customer-visible)
  notes                   text          NULL,

  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

-- One active subscription per org (enforced at application layer;
-- allow multiple rows for history)
CREATE INDEX idx_org_subscriptions_org_id     ON org_subscriptions (org_id);
CREATE INDEX idx_org_subscriptions_status     ON org_subscriptions (status);
CREATE INDEX idx_org_subscriptions_tier       ON org_subscriptions (tier);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER org_subscriptions_updated_at
  BEFORE UPDATE ON org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 6.2 Key design decisions

**Why store `mrr_usd` separately from `contracted_price`?**
A UAE customer pays AED 5,500/month. The admin dashboard needs USD to compute blended margin across markets. Rather than converting at query time (FX rates change), we store the USD equivalent at the time of subscription creation and update it only when the contract is renewed or renegotiated.

**Why JSONB for add-ons?**
Add-ons will evolve — new types will be added without requiring schema migrations. Each add-on is a boolean or numeric quantity. The `ATLAS_ADDONS` config in `pricing.ts` defines the price; the `addons` column records whether the customer has it.

**Why allow multiple rows per org?**
Subscription history matters — if a customer upgrades from Monitor to Management, you want a record of both periods for accurate MRR tracking and churn analysis. The active subscription is always the most recent `status = 'active'` row.

### 6.3 Helper query — active subscription per org

```sql
-- View for convenience — always returns the current active subscription per org
CREATE VIEW org_active_subscriptions AS
SELECT DISTINCT ON (org_id) *
FROM org_subscriptions
WHERE status IN ('trial', 'active')
ORDER BY org_id, started_at DESC;
```

### 6.4 Subscription management (manual phase)

In this phase, subscriptions are created and updated manually by the Atlas operator via the Supabase dashboard or a simple admin form. No automation, no Stripe. The process:

1. Customer agrees to terms and tier.
2. Operator inserts a row into `org_subscriptions` with the agreed tier, price, currency, and cadence.
3. Atlas picks up the subscription on the next nightly job run and begins enforcing entitlements.
4. Invoice is sent manually (or via a simple email template).

A lightweight admin form in the Atlas frontend (`/admin/subscriptions`) can wrap this with a UI so the operator doesn't need to touch Supabase directly — but that is a Phase 2 UI concern, not a blocker for launch.

---

## 7. Component 3: Fair-Use Cap Enforcement

### 7.1 What is checked nightly

After `refreshUsageMonthlySummary()` runs, the enforcement job checks three caps for every active org:

| Cap | Direct tiers | Agency tiers |
|---|---|---|
| Page scans per domain | `page_cap_per_domain` | `page_cap_per_domain` per client domain |
| Domain count | `domains` | `domains_per_client × max_clients` |
| Client count | N/A | `max_clients` |

```typescript
// src/jobs/fairUseCap.ts

import { supabase } from '../lib/supabaseClient';
import { ATLAS_PRICING, getPageCap, getMaxClients } from '../config/pricing';
import { sendOperatorAlert } from '../lib/alerts';

export async function runFairUseCapCheck(): Promise<void> {
  // Pull all active subscriptions with their current month usage
  const { data: orgs } = await supabase
    .from('org_active_subscriptions')
    .select(`
      org_id,
      tier,
      mrr_usd,
      org_id,
      organisations ( name )
    `);

  if (!orgs) return;

  const currentMonth = new Date();
  currentMonth.setDate(1);
  currentMonth.setHours(0, 0, 0, 0);

  for (const org of orgs) {
    const config = ATLAS_PRICING[org.tier as keyof typeof ATLAS_PRICING];

    // ── Check 1: Page scan cap ───────────────────────────────────────
    const { data: scanUsage } = await supabase
      .from('usage_events')
      .select('domain, pages_scanned.sum()')
      .eq('org_id', org.org_id)
      .eq('event_type', 'page_scan')
      .gte('created_at', currentMonth.toISOString());

    for (const domainRow of scanUsage ?? []) {
      const pageCap = getPageCap(org.tier as keyof typeof ATLAS_PRICING);
      const usage = domainRow.pages_scanned ?? 0;
      const usagePct = usage / pageCap;

      if (usagePct > 1.0) {
        await logCapViolation({
          org_id:     org.org_id,
          cap_type:   'page_scan',
          domain:     domainRow.domain,
          cap_value:  pageCap,
          actual:     usage,
          usage_pct:  usagePct,
          severity:   usagePct > 1.5 ? 'high' : 'medium',
        });
      }
    }

    // ── Check 2: Client count (agency tiers only) ────────────────────
    const maxClients = getMaxClients(org.tier as keyof typeof ATLAS_PRICING);
    if (maxClients !== null) {
      const { count: activeClients } = await supabase
        .from('org_clients')
        .select('*', { count: 'exact', head: true })
        .eq('agency_org_id', org.org_id)
        .eq('status', 'active');

      if ((activeClients ?? 0) > maxClients) {
        await logCapViolation({
          org_id:     org.org_id,
          cap_type:   'client_count',
          cap_value:  maxClients,
          actual:     activeClients ?? 0,
          usage_pct:  (activeClients ?? 0) / maxClients,
          severity:   'high',
        });
      }
    }
  }
}
```

### 7.2 `cap_violations` table

```sql
CREATE TABLE cap_violations (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id        uuid          NOT NULL REFERENCES organisations(id),
  cap_type      text          NOT NULL CHECK (cap_type IN (
                  'page_scan', 'domain_count', 'client_count', 'query_count'
                )),
  domain        text          NULL,       -- populated for page_scan violations
  cap_value     numeric       NOT NULL,   -- the entitlement
  actual        numeric       NOT NULL,   -- what was consumed
  usage_pct     numeric       NOT NULL,   -- actual / cap_value
  severity      text          NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  resolved      boolean       NOT NULL DEFAULT false,
  resolved_at   timestamptz   NULL,
  resolution    text          NULL,       -- 'upgraded', 'warned', 'ignored', etc.
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_cap_violations_org_id    ON cap_violations (org_id);
CREATE INDEX idx_cap_violations_resolved  ON cap_violations (resolved) WHERE resolved = false;
```

### 7.3 Alert logic

Violations trigger an operator alert via the same alert mechanism as the margin alerts defined in the usage logging PRD:

```
⚠️  FAIR-USE VIOLATION — [Org Name]
Tier: Management ($1,500/mo)
Cap type: Page scans
Domain: checkout.clientsite.com
Entitlement: 100 pages/domain/month
Actual this month: 187 pages (187% of cap)
Severity: HIGH

Recommended action: Contact customer, offer upgrade to Operations tier.
```

**Severity thresholds:**

| Usage % of cap | Severity | Action |
|---|---|---|
| 100–149% | Medium | Log violation, include in weekly operator review |
| 150%+ | High | Immediate alert, contact customer within 48 hours |

### 7.4 Resolution workflow

Violations are resolved manually in this phase. The operator marks them as resolved in the admin dashboard with one of four outcomes:

- **Upgraded** — customer moved to a higher tier; violation resolved commercially.
- **Warned** — customer notified, agreed to stay within caps.
- **Overage charged** — customer billed for excess (Operations tier only: $0.50/page over cap).
- **Ignored** — one-off spike, no commercial action taken.

---

## 8. How the Three Components Connect at Runtime

```
Nightly job sequence (02:00 UTC):
  1. refreshUsageMonthlySummary()        ← from Usage Logging PRD
  2. runFairUseCapCheck()                ← this PRD
  3. runMarginAlertCheck()               ← from Usage Logging PRD

Admin dashboard query for one org:
  SELECT
    s.tier,
    s.mrr_usd,
    u.total_variable_cost_usd,
    (s.mrr_usd - u.total_variable_cost_usd) / s.mrr_usd AS gross_margin_pct,
    COUNT(v.id) AS open_violations
  FROM org_active_subscriptions s
  JOIN usage_monthly_summary u
    ON u.org_id = s.org_id AND u.month = date_trunc('month', now())
  LEFT JOIN cap_violations v
    ON v.org_id = s.org_id AND v.resolved = false
  WHERE s.org_id = $1
  GROUP BY s.tier, s.mrr_usd, u.total_variable_cost_usd;
```

This is the query that makes the admin dashboard's per-customer gross margin row work end-to-end.

---

## 9. Pre-Build Checklist

Before any code is written, the following must be verified in the Supabase dashboard. These are not assumptions — they are hard dependencies that will block specific phases if unresolved.

### 9.1 `org_clients` table

The fair-use client count check in Phase 3 queries `org_clients` to count how many active clients an agency org has. This table may or may not exist in the current schema.

**Check:** Run the following in the Supabase SQL editor:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'org_clients';
```

**If the table exists:** Confirm it has at minimum the following columns before Phase 3 begins:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'org_clients'
ORDER BY ordinal_position;
```

Required columns: `agency_org_id` (uuid), `status` (text). If either is missing or named differently, update the `runFairUseCapCheck()` query in Phase 3 to match the actual schema before running.

**If the table does not exist:** Create it as part of Phase 2 alongside the `org_subscriptions` and `cap_violations` tables:

```sql
CREATE TABLE org_clients (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_org_id    uuid        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  client_name      text        NOT NULL,
  client_domain    text        NULL,
  status           text        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paused', 'offboarded')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_clients_agency_org_id ON org_clients (agency_org_id);
CREATE INDEX idx_org_clients_status        ON org_clients (status);

CREATE TRIGGER org_clients_updated_at
  BEFORE UPDATE ON org_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

> **Note:** `update_updated_at()` is defined in the `org_subscriptions` migration above. If running migrations in a different order, ensure the function exists before this trigger is created.

### 9.2 `organisations` table structure

Confirm the `organisations` table exists and has an `id` column of type `uuid`. All FK references in this PRD depend on it:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'organisations'
AND column_name = 'id';
```

### 9.3 Alert delivery mechanism

Confirm before Phase 3 whether operator alerts go to Slack, email, or both. The `sendOperatorAlert()` utility referenced in the fair-use job must be implemented before the job can run. This is the same utility used by the margin alert in the Usage Logging PRD — decide once, implement once.

---

## 10. Implementation Plan

### Phase 1 — Pricing config (half a day)
- [ ] Create `src/config/pricing.ts` with `ATLAS_PRICING`, `BILLING_DISCOUNTS`, `ATLAS_ADDONS`, and helper utilities
- [ ] Replace any hardcoded tier logic elsewhere in the codebase with imports from this file
- [ ] Add to version control — this file is the canonical pricing record

### Phase 2 — Schema (half a day)
- [ ] Create `org_subscriptions` table with indexes and `updated_at` trigger
- [ ] Create `org_active_subscriptions` view
- [ ] Create `cap_violations` table with indexes
- [ ] Apply RLS: service role only for both tables

### Phase 3 — Fair-use enforcement job (1 day)
- [ ] Write `runFairUseCapCheck()` job in `src/jobs/fairUseCap.ts`
- [ ] Add to nightly Bull/Redis cron sequence after `refreshUsageMonthlySummary()`
- [ ] Test with a synthetic org that has usage events exceeding the cap
- [ ] Confirm violation is logged to `cap_violations` and alert fires

### Phase 4 — Admin dashboard integration (0.5 days)
- [ ] Wire the gross margin query into the admin dashboard portfolio table
- [ ] Add open violations count as a column in the portfolio view
- [ ] Add cap violations drill-down to the per-org view

**Total estimated build time: 3 days**

---

## 11. Success Metrics

| Metric | Target | Timeline |
|---|---|---|
| Every active org has a subscription record | 100% | Before first invoice |
| Gross margin computable for every org | 100% | Day 1 of admin dashboard |
| Fair-use violations detected within 24 hours | 100% | From first nightly job run |
| No high-severity violations unresolved > 48 hours | 0 | Ongoing |

---

## 12. Open Questions

| # | Question | Owner | Due |
|---|---|---|---|
| 1 | What is the alert delivery mechanism — Slack, email, or both? Same decision as the margin alert from Usage Logging PRD; should be decided once and applied consistently. See Pre-Build Checklist §9.3. | Vikram | Before Phase 3 |
| 2 | For the Operations tier overage charge ($0.50/page over cap), does this need to be calculated and added to the next invoice automatically, or flagged for manual addition? | Vikram | Before Phase 4 |

---

## 13. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `organisations` table | Exists | `org_id` FK references this throughout |
| Usage Logging PRD (usage_events, usage_monthly_summary) | Defined, to be built | Fair-use job runs after usage summary refresh |
| Bull/Redis nightly cron | Exists | Enforcement job added to existing sequence |
| Atlas admin auth | Assumed to exist | Required for admin dashboard views |

---

## 14. Related PRDs

- PRD: Usage Logging & Cost Intelligence — upstream dependency; provides `usage_monthly_summary` that fair-use job reads from
- PRD: Crawl Signal Extractor — produces the `page_scan` events that fair-use cap checks against
- PRD: Data Quality Monitor — downstream consumer; agency health dashboard reads `cap_violations` to surface client-level issues

---

*Document owner: Vikram Jayaram / Spi3l LLC*
*Last updated: April 2026*
