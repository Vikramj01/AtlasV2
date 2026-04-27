# PRD: Usage Logging & Cost Intelligence Infrastructure
**Atlas — Signal Intelligence Platform**
**Module:** Usage Logging & Cost Intelligence
**Status:** Draft v1.0
**Author:** Vikram Jayaram / Spi3l LLC
**Date:** April 2026
**Build sequence:** After Crawl Signal Extractor, before Data Quality Monitor

---

## 1. Overview

Atlas has no current visibility into what each customer actually costs to serve. Every Browserbase scan and every Claude API call consumes real money, and that money is currently untracked at the customer level. This PRD specifies the infrastructure to log, store, and surface per-customer usage data — covering Browserbase browser-minutes and Claude token consumption — so that Atlas can validate its pricing model, alert on margin-negative accounts, and eventually build usage-based billing if needed.

This is foundational infrastructure. It is not a customer-facing feature in its own right, but it powers three downstream capabilities: the internal cost dashboard (built in this PRD), the agency health dashboard (part of Data Quality Monitor), and any future usage-based billing or overage enforcement logic.

---

## 2. Problem Statement

### 2.1 Current state

- Browserbase and Claude API costs are paid centrally with no attribution to individual customers or orgs.
- The pricing model is built on estimated variable costs ($0.025/page-scan, $0.25/AI report). These estimates have never been validated against real usage.
- There is no mechanism to detect if a single customer is consuming a disproportionate share of variable cost — a particular risk on the Agency Scale tier.
- Gross margin per customer is unknown. The business is making pricing decisions without knowing its actual unit economics.

### 2.2 Why this matters now

Atlas is approaching its first real customers. The window to instrument before revenue starts is short. Building this after customers are live is significantly harder — you need to retrofit logging without disrupting running workflows, and you may have already set prices that are structurally wrong.

---

## 3. Goals

- Log every Browserbase page scan and every Claude API call against the `org_id` that triggered it.
- Provide an internal admin dashboard showing per-customer variable cost, gross margin, and usage trends.
- Produce the data needed to validate (or correct) the pricing model within 4–6 weeks of first customer onboarding.
- Lay the schema foundation for overage alerting and, optionally, usage-based billing in a later phase.

## 4. Non-Goals

- Customer-facing usage dashboards (future phase).
- Billing automation or Stripe integration (future phase).
- Logging of fixed platform costs (Render, Redis, Vercel, Supabase) — these are flat and don't vary per customer.
- Real-time cost alerts to customers (future phase).
- Usage-based pricing enforcement in this phase — this PRD observes and reports only.

---

## 5. User Stories

**As the Atlas operator (Vikram),** I want to see each customer's actual variable cost per month so I can confirm the pricing model is generating the expected gross margins.

**As the Atlas operator,** I want to be alerted when a single customer's variable cost exceeds 80% of their monthly subscription price so I can intervene before the account becomes margin-negative.

**As the Atlas operator,** I want to see token consumption broken down by report type (scheduled report vs. on-demand query) so I know which product features are driving AI cost.

**As the Atlas operator,** I want a monthly cost-per-customer export so I can feed real numbers back into the pricing model spreadsheet.

**As a developer building Atlas,** I want a standardised `logUsage()` utility so that logging is consistent across all modules that touch Browserbase or Claude — I don't have to remember to implement it differently each time.

---

## 6. Technical Architecture

### 6.1 System context

Usage events are generated in two places in the Atlas backend (Express / Render):

1. **Crawl Signal Extractor** — fires Browserbase sessions to scan pages; each page scan is a billable browser-minute event.
2. **Claude API wrapper** — fires Claude Sonnet calls for scheduled AI reports (Data Quality Monitor) and on-demand queries (Operations tier, Agency Scale). Each call returns `usage.input_tokens` and `usage.output_tokens` in the response.

Both already exist or are being built. This PRD adds a logging layer on top of both — it does not change their core logic.

### 6.2 Data flow

```
Browserbase scan                    Claude API call
      │                                   │
      ▼                                   ▼
logUsage('page_scan', meta)     logUsage('ai_report' | 'ai_query', meta)
      │                                   │
      └──────────────┬────────────────────┘
                     ▼
            Supabase: usage_events table
                     │
                     ▼
            usage_monthly_summary (materialised view)
                     │
                     ▼
            Internal admin dashboard (React, Atlas frontend)
```

### 6.3 Logging utility

A single shared function in the Express backend, imported by any module that needs to log usage:

```typescript
// src/lib/usageLogger.ts

import { supabase } from './supabaseClient';

type UsageEventType =
  | 'page_scan'
  | 'ai_report_scheduled'
  | 'ai_report_ondemand'
  | 'ai_query_ondemand';

interface UsageEventPayload {
  org_id: string;
  event_type: UsageEventType;
  // Browserbase fields (page_scan only)
  browser_minutes?: number;
  pages_scanned?: number;
  domain?: string;
  // Claude fields (ai_* only)
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  // Computed cost (calculated at log time, stored for convenience)
  cost_usd?: number;
  // Context
  job_id?: string;          // Bull/Redis job ID for traceability
  scan_run_id?: string;     // Groups page scans from a single crawl run
  metadata?: Record<string, unknown>;
}

export async function logUsage(payload: UsageEventPayload): Promise<void> {
  const cost_usd = payload.cost_usd ?? computeCost(payload);

  const { error } = await supabase.from('usage_events').insert({
    org_id: payload.org_id,
    event_type: payload.event_type,
    browser_minutes: payload.browser_minutes ?? null,
    pages_scanned: payload.pages_scanned ?? null,
    domain: payload.domain ?? null,
    input_tokens: payload.input_tokens ?? null,
    output_tokens: payload.output_tokens ?? null,
    model: payload.model ?? null,
    cost_usd,
    job_id: payload.job_id ?? null,
    scan_run_id: payload.scan_run_id ?? null,
    metadata: payload.metadata ?? null,
  });

  if (error) {
    // Non-blocking: log to console but don't throw — usage logging
    // must never crash a customer-facing operation
    console.error('[usageLogger] Failed to log usage event:', error.message);
  }
}

function computeCost(payload: UsageEventPayload): number {
  if (payload.event_type === 'page_scan') {
    // Browserbase pricing: ~$0.025 per page scan
    // Update this constant once real Browserbase invoices are available
    const COST_PER_PAGE_SCAN = 0.025;
    return (payload.pages_scanned ?? 0) * COST_PER_PAGE_SCAN;
  }

  if (payload.event_type?.startsWith('ai_')) {
    // Claude Sonnet pricing (as of April 2026):
    // Input:  $3.00 per 1M tokens
    // Output: $15.00 per 1M tokens
    const INPUT_COST_PER_TOKEN  = 3.00  / 1_000_000;
    const OUTPUT_COST_PER_TOKEN = 15.00 / 1_000_000;
    return (
      (payload.input_tokens  ?? 0) * INPUT_COST_PER_TOKEN +
      (payload.output_tokens ?? 0) * OUTPUT_COST_PER_TOKEN
    );
  }

  return 0;
}
```

**Important design decisions:**

- `logUsage()` is **fire-and-forget from the caller's perspective** — it never throws and never blocks the primary operation. A logging failure should not cause a scan or report to fail.
- `cost_usd` is computed at write time using hardcoded constants. These constants should be reviewed whenever Browserbase or Anthropic changes pricing and updated in a single place.
- `scan_run_id` groups all page scans from a single crawl job, enabling per-run cost attribution rather than just per-page attribution.

---

## 7. Database Schema

### 7.1 `usage_events` table

```sql
CREATE TABLE usage_events (
  id               uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type       text          NOT NULL CHECK (event_type IN (
                     'page_scan',
                     'ai_report_scheduled',
                     'ai_report_ondemand',
                     'ai_query_ondemand'
                   )),

  -- Browserbase fields
  browser_minutes  numeric(8,4)  NULL,
  pages_scanned    integer       NULL,
  domain           text          NULL,

  -- Claude fields
  input_tokens     integer       NULL,
  output_tokens    integer       NULL,
  model            text          NULL,

  -- Cost
  cost_usd         numeric(10,6) NOT NULL DEFAULT 0,

  -- Traceability
  job_id           text          NULL,
  scan_run_id      uuid          NULL,
  metadata         jsonb         NULL,

  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_usage_events_org_id        ON usage_events (org_id);
CREATE INDEX idx_usage_events_created_at    ON usage_events (created_at DESC);
CREATE INDEX idx_usage_events_org_month     ON usage_events (org_id, date_trunc('month', created_at));
CREATE INDEX idx_usage_events_scan_run_id   ON usage_events (scan_run_id) WHERE scan_run_id IS NOT NULL;
```

### 7.2 `usage_monthly_summary` materialised view

Pre-aggregated per org per month. Refreshed nightly via a scheduled job (Bull/Redis cron).

```sql
CREATE MATERIALIZED VIEW usage_monthly_summary AS
SELECT
  org_id,
  date_trunc('month', created_at)                                  AS month,
  COUNT(*) FILTER (WHERE event_type = 'page_scan')                 AS total_page_scans,
  SUM(browser_minutes) FILTER (WHERE event_type = 'page_scan')     AS total_browser_minutes,
  COUNT(*) FILTER (WHERE event_type LIKE 'ai_%')                   AS total_ai_calls,
  SUM(input_tokens)  FILTER (WHERE event_type LIKE 'ai_%')         AS total_input_tokens,
  SUM(output_tokens) FILTER (WHERE event_type LIKE 'ai_%')         AS total_output_tokens,
  SUM(cost_usd)                                                     AS total_variable_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type = 'page_scan')            AS scan_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_%')              AS ai_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_report_%')       AS report_cost_usd,
  SUM(cost_usd) FILTER (WHERE event_type LIKE 'ai_%ondemand')      AS ondemand_cost_usd
FROM usage_events
GROUP BY org_id, date_trunc('month', created_at);

CREATE UNIQUE INDEX ON usage_monthly_summary (org_id, month);
```

Refresh job (Bull cron, runs at 02:00 UTC daily):

```typescript
// src/jobs/refreshUsageSummary.ts
export async function refreshUsageMonthlySummary() {
  await supabase.rpc('refresh_usage_monthly_summary');
}
```

```sql
-- Supabase function to expose refresh to RPC
CREATE OR REPLACE FUNCTION refresh_usage_monthly_summary()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY usage_monthly_summary;
END;
$$;
```

### 7.3 Row-level security

Usage events are internal data — no customer-facing access in this phase.

```sql
-- Only service role can read/write usage_events
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON usage_events
  USING (auth.role() = 'service_role');
```

---

## 8. Integration Points

### 8.1 Crawl Signal Extractor integration

Add `logUsage()` after each page scan completes. Log at the individual page level, grouped by `scan_run_id`:

```typescript
// Inside the page scan loop in crawlSignalExtractor.ts

const scanRunId = crypto.randomUUID(); // Generated once per crawl job

for (const pageUrl of pagesToScan) {
  const scanStart = Date.now();

  const result = await browserbase.scan(pageUrl); // existing logic

  const durationSeconds = (Date.now() - scanStart) / 1000;
  const browserMinutes  = durationSeconds / 60;

  // Log after scan — non-blocking
  logUsage({
    org_id:        job.data.org_id,
    event_type:    'page_scan',
    browser_minutes: browserMinutes,
    pages_scanned: 1,
    domain:        new URL(pageUrl).hostname,
    job_id:        job.id?.toString(),
    scan_run_id:   scanRunId,
  });
}
```

### 8.2 Claude API wrapper integration

All Claude calls in Atlas should go through a single wrapper. If one doesn't exist yet, create it now and route all AI calls through it:

```typescript
// src/lib/claudeClient.ts

import Anthropic from '@anthropic-ai/sdk';
import { logUsage, UsageEventType } from './usageLogger';

const anthropic = new Anthropic();

interface ClaudeCallOptions {
  org_id: string;
  event_type: UsageEventType;
  system: string;
  messages: Anthropic.MessageParam[];
  max_tokens?: number;
  job_id?: string;
}

export async function callClaude(options: ClaudeCallOptions) {
  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5-20251001',
    max_tokens: options.max_tokens ?? 4096,
    system:     options.system,
    messages:   options.messages,
  });

  // Log usage — non-blocking
  logUsage({
    org_id:        options.org_id,
    event_type:    options.event_type,
    input_tokens:  response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    model:         response.model,
    job_id:        options.job_id,
  });

  return response;
}
```

**All existing direct `anthropic.messages.create()` calls should be migrated to `callClaude()`.** This is the single change that captures all AI token costs across Atlas.

---

## 9. Internal Admin Dashboard

A protected route in the Atlas frontend (`/admin/usage`) visible only to `role = 'atlas_admin'`. Not customer-facing.

### 9.1 Views required

**Portfolio overview** — one row per org, current month:

| Column | Source |
|---|---|
| Organisation name | `organisations` |
| Subscription tier | `org_subscriptions` |
| Subscription MRR (USD) | Pricing config |
| Variable cost MTD (USD) | `usage_monthly_summary.total_variable_cost_usd` |
| Gross margin % | `(MRR - variable_cost) / MRR` |
| Scan cost MTD | `usage_monthly_summary.scan_cost_usd` |
| AI cost MTD | `usage_monthly_summary.ai_cost_usd` |
| Status | Green < 15% cost/MRR; Amber 15–30%; Red > 30% |

**Per-org drill-down** — click any row to see:
- Daily cost trend (30-day chart, scan cost vs. AI cost stacked)
- Top domains by scan cost
- AI call breakdown: scheduled reports vs. on-demand queries
- Raw event log (paginated, filterable by event type and date)

**Cost vs. pricing model comparison** — a static reference panel showing assumed vs. actual cost per tier. Pulls from `usage_monthly_summary` grouped by subscription tier.

### 9.2 Margin alert system

A Bull/Redis job runs nightly alongside the summary refresh. For any org where `variable_cost_mtd / monthly_mrr > 0.30`, it sends a Slack or email alert to the Atlas operator:

```
⚠️  MARGIN ALERT — [Org Name]
Tier: Agency Scale ($10,000/mo)
Variable cost MTD: $3,420 (34% of MRR)
Projected month-end cost: $5,130 (51% of MRR)
Action: Review scan frequency or page cap for this account.
```

Threshold is configurable; default is 30% variable cost / MRR.

---

## 10. Pricing Model Validation Protocol

Once 5+ customers have been running for at least 30 days, run the following validation:

1. Export `usage_monthly_summary` for all orgs in their first full billing month.
2. Group by subscription tier.
3. Compare `AVG(total_variable_cost_usd)` per tier against the model's assumed variable cost per tier.
4. If actual > assumed by more than 20%, revise either the pricing (price up) or the fair-use caps (restrict usage) for that tier.
5. Update `computeCost()` constants in `usageLogger.ts` to reflect actual Browserbase per-minute pricing from invoices.

This validation should happen at Month 1, Month 3, and then quarterly thereafter.

---

## 11. Implementation Plan

### Phase 1 — Schema and utility (1–2 days)

- [ ] Create `usage_events` table in Supabase with indexes and RLS
- [ ] Create `usage_monthly_summary` materialised view
- [ ] Write `logUsage()` utility in `src/lib/usageLogger.ts`
- [ ] Write `callClaude()` wrapper in `src/lib/claudeClient.ts`
- [ ] Add nightly Bull job to refresh materialised view

### Phase 2 — Integration (1–2 days)

- [ ] Instrument Crawl Signal Extractor with `logUsage()` on each page scan
- [ ] Migrate all existing `anthropic.messages.create()` calls to `callClaude()`
- [ ] Smoke test with a single org: confirm events appear in `usage_events` table

### Phase 3 — Admin dashboard (2–3 days)

- [ ] Build `/admin/usage` portfolio overview table
- [ ] Build per-org drill-down view with 30-day cost chart
- [ ] Build cost vs. pricing model comparison panel
- [ ] Build nightly margin alert job (Slack or email)

### Phase 4 — Validation (ongoing from first customer)

- [ ] Run pricing model validation at Month 1 post-launch
- [ ] Update pricing model spreadsheet with real numbers
- [ ] Document actual cost-per-tier for use in investor/sales materials

**Total estimated build time: 5–7 days**

---

## 12. Success Metrics

| Metric | Target | Timeline |
|---|---|---|
| Coverage — % of scans logged | 100% | From Day 1 of first customer |
| Coverage — % of AI calls logged | 100% | From Day 1 of first customer |
| Pricing model accuracy | Actual cost within ±20% of model assumption | Validated at Month 1 |
| Margin alerts | Zero margin-negative accounts undetected for > 7 days | Ongoing |
| Admin dashboard availability | Internal use only; no uptime SLA | Available before first paid customer |

---

## 13. Open Questions

| # | Question | Owner | Due |
|---|---|---|---|
| 1 | What is the actual Browserbase billing model — per browser-minute, per session, or per page? Need to confirm against the Browserbase dashboard before `computeCost()` is finalised. | Vikram | Before Phase 1 |
| 2 | Should `scan_run_id` be exposed in the Data Quality Monitor UI so operators can trace a specific scan run to its cost? | Product | Before Phase 3 |
| 3 | At what customer count does the `usage_events` table need partitioning by month? Supabase handles this natively but the partition key should be decided early. | Engineering | Before 50 customers |
| 4 | Does the margin alert go to Slack, email, or both? What is the escalation path if a margin-negative account is detected? | Vikram | Before Phase 3 |

---

## 14. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| Crawl Signal Extractor | In progress (highest priority module) | Phase 2 integration blocked until CSE is at least partially built |
| Supabase `organisations` table | Exists | `org_id` FK references this |
| Bull/Redis (Upstash) | Exists | Used for nightly summary refresh and alert jobs |
| Atlas admin auth (`role = 'atlas_admin'`) | Assumed to exist | Verify before Phase 3 dashboard build |

---

## 15. Related PRDs

- PRD: Crawl Signal Extractor — upstream producer of `page_scan` events
- PRD: Data Quality Monitor — downstream consumer of usage data for agency health dashboard
- PRD: Auto-insight Reporter — downstream consumer; AI report costs logged here feed into per-client cost visibility

---

*Document owner: Vikram Jayaram / Spi3l LLC*
*Last updated: April 2026*
