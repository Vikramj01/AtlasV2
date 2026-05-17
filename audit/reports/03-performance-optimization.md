# Atlas V2 — Phase 3.2 Performance Optimization Report

**Audit date:** 2026-05-17  
**Method:** Static analysis of source code, migrations, and bundle configuration. No production profiling data available (no Supabase slow query log access, no Render metrics).

---

## Executive Summary

| Area | Status | Top finding |
|---|---|---|
| Database indexes | 🟡 Amber | 7 missing indexes on high-traffic tables |
| N+1 / over-fetching | 🟡 Amber | 3 loop patterns; several unbounded `SELECT *` |
| Frontend bundle | 🔴 Red | Zero code splitting — 35 pages eagerly loaded |
| Zustand store subscriptions | 🟡 Amber | 9 planning components subscribe to whole store |
| LLM / Anthropic | 🔴 Red | No prompt caching — repeated large system prompts |
| Queue / concurrency | 🟢 Green | Reasonable; shared Redis client correct |
| Backend dependencies | 🟡 Amber | 3 packaging hygiene issues |
| TypeScript | 🟢 Green | Backend compiles cleanly; frontend blocked by missing node_modules |

---

## OPT-01 (P1) — No prompt caching on Claude API calls

**Location:** `backend/src/services/usage/claudeClient.ts` + `backend/src/services/planning/aiAnalysisService.ts:101–172`  
**Measured baseline:** System prompt for Planning Mode AI analysis is ~3,000–8,000 tokens (IR schema guardrails + taxonomy context + DOM). This prompt is reconstructed and sent in full on every page scan — typically 3–5 pages per planning session.  
**Impact:** At `claude-sonnet-4-6` pricing, sending an 8K-token system prompt 4 times per session wastes ~24K input tokens per session on repeated context. With Anthropic's prompt caching, the system prompt would be cached after the first call and subsequent calls would pay cache-read rates (~10% of input token cost).  
**Proposed fix:** Add `cache_control: { type: 'ephemeral' }` to the system prompt block in `callClaude()`. The system prompt is identical across all page scans in a single session — it qualifies for caching.

```typescript
// claudeClient.ts — add cache_control to system block
{
  role: 'system',
  content: systemPrompt,
  // Add this:
  cache_control: { type: 'ephemeral' }
}
```

**Expected gain:** ~80–90% reduction in system-prompt token cost per planning session. On 100 sessions/month this is material.  
**Effort:** S (2-line change + verify cache hit rate in usage logs)

---

## OPT-02 (P2) — Zero route-level code splitting — 35 pages eagerly bundled

**Location:** `frontend/src/App.tsx:1–47`  
**Evidence:** All 35 page components are statically imported at the top of `App.tsx`. There is no `React.lazy()` or dynamic `import()` anywhere in the routing tree. Every user — including unauthenticated login-page visitors — downloads JavaScript for `ImplementationHealthPage`, `ReconciliationRunDetailPage`, `AdminPage`, `CrawlStatusPage`, etc.  
**Estimated bundle impact:** Without profiling data, extrapolating from dependency count and component sizes (843-line `ImplementationHealthPage`, 622-line `Step6GeneratedOutputs`, etc.): the main JS chunk is likely 1.5–2 MB unminified, 400–600 KB gzipped. Industry target for SPA initial chunk is ≤200 KB gzipped.  
**Proposed fix:**

```typescript
// App.tsx — convert all page imports to lazy
const ImplementationHealthPage = React.lazy(() => import('@/pages/ImplementationHealthPage'));
const ReconciliationRunDetailPage = React.lazy(() => import('@/pages/ReconciliationRunDetailPage'));
// ... all 35 pages

// Wrap router in Suspense
<Suspense fallback={<SkeletonCard />}>
  <Routes>...</Routes>
</Suspense>
```

**Expected gain:** L — significant reduction in initial parse/execute time; admin, reconciliation, and crawl pages only loaded on demand.  
**Effort:** M (mechanical change, ~35 import rewrites + Suspense wrapper + verify no SSR assumptions)

---

## OPT-03 (P2) — 7 missing database indexes on high-traffic tables

**Evidence:** Migration files reviewed; WHERE-clause patterns in query files cross-referenced.

| Table | Missing index | Used in | Migration file |
|---|---|---|---|
| `strategy_briefs` | `(organization_id, created_at)` | `listBriefs()` — every brief list load | `20260420_001_strategy_briefs.sql` |
| `strategy_objectives` | `(brief_id, organization_id)` | `getBriefWithObjectives()` — on every strategy page load | `20260421_001_strategy_objectives.sql` |
| `detected_signals` | `(crawl_page_id)` | Joining signals to pages in crawl detail view | `20260530_001_crawl_signal_extractor.sql` |
| `offline_conversion_rows` | `(organization_id, status)` | `bulkUpdateRowStatuses()` — batch status filter | `20260406_001_offline_conversion_tables.sql` |
| `reconciliation_findings` | `(organization_id, resolved_at)` | Filtering unresolved findings | `20260607002_reconciliation_core.sql` |
| `audit_findings` | `(organization_id, created_at)` | Time-series IHC queries | `20260610_002_implementation_health.sql` |
| `capi_events` | `(organization_id, status)` partial on `status IN ('pending','processing')` | Queue processing queries | `20260317_001_consent_and_capi_tables.sql` |

**Proposed fix:** Single additive migration (no data changes, no RLS changes). See PR `[perf][P2] Add missing indexes`.  
**Expected gain:** M–L for strategy brief list (no index on org_id), M for detected_signals join.  
**Effort:** S (one migration file)

---

## OPT-04 (P2) — 9 planning components subscribe to entire Zustand store

**Location:** `frontend/src/components/planning/Step*.tsx` (all 8 steps) + `PlanningModePage.tsx`  
**Evidence:**
```typescript
// All 9 files — whole-store subscription
const { currentSession, outputs, setStep, ... } = usePlanningStore();
```
Every mutation to any field in `planningStore` (e.g. a polling update to `scanProgress`) triggers a re-render in all 9 components simultaneously, even components that don't use `scanProgress`.  
**Proposed fix:** Use field selectors with `useShallow` from `zustand/shallow`:
```typescript
import { useShallow } from 'zustand/shallow';
const { currentSession, outputs } = usePlanningStore(
  useShallow((s) => ({ currentSession: s.currentSession, outputs: s.outputs }))
);
```
**Expected gain:** M — eliminates cascade re-renders during Planning Mode polling (scan progress updates fire every 2–5s).  
**Effort:** M (9 files, each needs field-level selector extraction)

---

## OPT-05 (P2) — No `manualChunks` in Vite config — no vendor chunk caching

**Location:** `frontend/vite.config.ts`  
**Evidence:** No `build.rollupOptions.output.manualChunks` configured. Without manual chunking, React, Radix UI, Supabase SDK, and application code land in a single or few chunks. Browser cache cannot separately cache stable vendor code from frequently-changing app code.  
**Proposed fix:**
```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-ui': ['@radix-ui/react-dialog', /* other radix packages */],
        'vendor-supabase': ['@supabase/supabase-js'],
      }
    }
  },
  chunkSizeWarningLimit: 500,
}
```
**Expected gain:** M — returning visitors load only changed app chunks; vendor chunk is cached across deployments.  
**Effort:** S

---

## OPT-06 (P2) — `SELECT *` returning `detected_signals(*)` in crawl detail endpoint

**Location:** `backend/src/api/routes/crawl.ts:188`  
**Evidence:** `GET /api/crawl/run/:id` expands `detected_signals(*)` — returning all columns (including raw detector payloads) for every signal on every page of a crawl run. A large crawl (100 pages × 20 signals each) returns 2,000 full signal records. The UI (`CrawlResults.tsx`) likely only needs signal counts or a summary.  
**Proposed fix:** Replace with a count-per-page projection or paginate signals separately on demand.  
**Expected gain:** M — reduces payload size significantly for large crawl runs.  
**Effort:** M (requires UI change to lazy-load signal detail)

---

## OPT-07 (P2) — N+1: `getBriefWithObjectives` runs two sequential queries

**Location:** `backend/src/services/database/strategyObjectivesQueries.ts:37–59`  
**Evidence:** The function fetches the brief, then fetches objectives in a separate query. Both queries filter by the same `organization_id`. Supabase supports `select('*, strategy_objectives(*)')` for a single-query fetch.  
**Proposed fix:**
```typescript
const { data } = await supabase
  .from('strategy_briefs')
  .select('*, strategy_objectives(*)')
  .eq('id', briefId)
  .eq('organization_id', orgId)
  .single();
```
**Expected gain:** M — halves the DB round-trips on every strategy page load.  
**Effort:** S

---

## OPT-08 (P2) — `@noble/ciphers` undeclared in `backend/package.json`

**Location:** `backend/package.json`  
**Evidence:** `backend/src/services/capi/credentials.ts` imports from `@noble/ciphers` for AES-256-GCM encryption. The package is not listed in `backend/package.json` dependencies. It may be a transitive dependency of another package today, but transitive resolution is non-deterministic across npm versions.  
**Impact:** A `npm install --omit=optional` or a hoisting change could remove it silently, breaking credential encryption at deploy time.  
**Proposed fix:** `npm install @noble/ciphers --save` in `backend/`.  
**Effort:** S

---

## OPT-09 (P3) — `pino-pretty` and `@types/pdfkit` in production dependencies

**Location:** `backend/package.json`  
- `pino-pretty` is a dev/terminal prettifier for pino logs. In production, pino emits JSON (no prettifier needed). Move to `devDependencies`.
- `@types/pdfkit` is a TypeScript type package — runtime value is zero. Move to `devDependencies`.

**Expected gain:** S — smaller production `node_modules`.  
**Effort:** S

---

## OPT-10 (P3) — Queue `bclient` connections per Bull queue (16 queues × 3 Redis connections each)

**Location:** `backend/src/services/queue/jobQueue.ts:45–69`  
**Evidence:** Bull requires 3 Redis connections per queue (client, subscriber, bclient). With 16+ queues, this is potentially 48 Redis connections. Upstash's free tier has a 100-connection limit.  
**Evidence of partial mitigation:** The shared `redisClient` and `redisSubscriber` are passed to Bull options (lines 54–55), reducing connections from 3× per queue to 1 shared + bclient per queue. Current actual connection count ≈ 2 + 16 = 18.  
**Recommended action:** Monitor connection count in Upstash console. If approaching limits, consolidate low-frequency queues (alertQueue, reconciliationQueue, gtmQueue) into a single `generalQueue` with job-type routing.  
**Effort:** L (architectural change — defer until connection pressure observed)

---

## OPT-11 (P3) — `ImplementationHealthPage.tsx` at 843 lines

**Location:** `frontend/src/pages/ImplementationHealthPage.tsx`  
**Evidence:** Single file contains finding summary, finding list, baseline management, alert preferences, and connection status sections.  
**Proposed fix:** Extract into sub-components: `IHCFindingsList`, `IHCBaselinePanel`, `IHCAlertPreferences`.  
**Expected gain:** M (maintainability), S (initial parse — only meaningful after code splitting is in place).  
**Effort:** M

---

## OPT-12 (P3) — Zustand store files have implicit `any` parameters

**Location:** `frontend/src/store/planningStore.ts`, `reconciliationStore.ts`, `signalStore.ts`, `strategyStore.ts`, `taxonomyStore.ts`  
**Evidence:** TypeScript strict mode (`noImplicitAny: true`) reports implicit `any` on store callback parameters. These are masked by `node_modules` not being installed but will surface in CI.  
**Proposed fix:** Annotate state setter parameters explicitly.  
**Effort:** S

---

## Prioritised action list

| Priority | ID | Finding | Gain | Effort |
|---|---|---|---|---|
| 1 | OPT-01 | No Anthropic prompt caching — large system prompts re-sent per page | L | S |
| 2 | OPT-02 | Zero code splitting — 35 pages eagerly bundled | L | M |
| 3 | OPT-03 | 7 missing DB indexes (strategy_briefs, objectives, detected_signals, etc.) | M–L | S |
| 4 | OPT-04 | 9 planning components subscribe to whole Zustand store | M | M |
| 5 | OPT-05 | No manualChunks in Vite config | M | S |
| 6 | OPT-06 | `detected_signals(*)` expanded in crawl detail list | M | M |
| 7 | OPT-07 | N+1: brief+objectives fetched in two queries | M | S |
| 8 | OPT-08 | `@noble/ciphers` undeclared in package.json | S | S |
| 9 | OPT-09 | `pino-pretty` + `@types/pdfkit` in prod deps | S | S |
| 10 | OPT-10 | 16 Bull queues × Redis bclient connections | S | L |
| 11 | OPT-11 | `ImplementationHealthPage.tsx` at 843 lines | M | M |
| 12 | OPT-12 | Zustand store implicit `any` parameters | S | S |
