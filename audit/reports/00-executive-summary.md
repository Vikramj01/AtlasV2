# Atlas V2 — Audit Executive Summary

**Audit date:** 2026-05-17  
**Phases completed:** Phase 1 (Security), Phase 2 (Requirements Deviation), Phase 3 (Functional + Optimization)  
**Scope:** Static analysis of source, migrations, and bundle config. No production profiling. No live-DB mutations.

---

## Traffic-Light Health Ratings

| Area | Rating | Summary |
|---|---|---|
| **Security** | 🟡 Amber | 1 confirmed P1 IDOR (fixed). No P0 secrets leaked. RLS coverage solid; 1 gap on CSE tables. CORS correct. |
| **Requirements alignment** | 🟡 Amber | Core features shipped. 7 deviations from PRD; mostly stubs/future-work gaps, not regressions. |
| **Functional correctness** | 🟢 Green | 83/83 audit tests pass. 3 P2 functional findings; no P0 regressions. |
| **Optimization headroom** | 🔴 Red | Bundle unsplit, no prompt caching, 7 missing DB indexes. High-gain / low-effort wins available immediately. |

---

## Severity Counts Across All Phases

| Severity | Security | Requirements | Functional | Optimization | **Total** |
|---|---|---|---|---|---|
| P0 | 0 | 0 | 0 | 0 | **0** |
| P1 | 1 (fixed) | 0 | 0 | 2 | **3** |
| P2 | 4 | 7 | 3 | 7 | **21** |
| P3 | 2 | 0 | 0 | 3 | **5** |
| **Total** | **7** | **7** | **3** | **12** | **29** |

> P1 IDOR (journey stage cross-tenant update) was fixed in this audit cycle and merged in PR #230.

---

## Top 10 Prioritised Actions

| Rank | ID | Phase | Finding | Gain | Effort | Status |
|---|---|---|---|---|---|---|
| 1 | SEC-01 | Security | Journey stage IDOR — cross-tenant `PUT /journeys/:id/stages/:stageId` | P1 | S | ✅ Fixed |
| 2 | OPT-01 | Optimization | No Anthropic prompt caching — system prompt re-sent every page scan (~24K extra tokens/session) | L | S | Open |
| 3 | OPT-02 | Optimization | Zero route-level code splitting — 35 pages bundled eagerly | L | M | Open |
| 4 | OPT-03 | Optimization | 7 missing DB indexes on high-traffic tables (strategy_briefs, detected_signals, etc.) | M–L | S | Open |
| 5 | SEC-02 | Security | CSE crawl trigger has no `planGuard` — any authenticated user can trigger Browserbase crawls | P2 | S | Open |
| 6 | FUNC-01 | Functional | Readiness score double-counts CAPI: `server_side_enabled` = `capi_connected` — org scores 40 on CAPI alone | P2 | S | Open (needs product sign-off) |
| 7 | OPT-04 | Optimization | 9 planning components subscribe to entire Zustand store — cascade re-renders on every poll tick | M | M | Open |
| 8 | FUNC-02 | Functional | StrategyGateBanner uses stale verdict labels (`keep/add_proxy/switch`) — always falls through to default | P2 | S | Open |
| 9 | SEC-03 | Security | `strategy_briefs` save endpoint does not verify `client_id` ownership before linking | P2 | S | Open |
| 10 | DEV-01 | Requirements | WalkerOS tag still referenced in detection-side code despite being removed from generation | P2 | S | Open |

---

## Secrets-Rotation List

**No secrets were found leaked in source code or committed files.** All sensitive values (`ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Upstash Redis URL) are referenced only as environment variable names in code. CAPI provider credentials are encrypted at rest with AES-256-GCM before DB storage.

No rotation required.

---

## Phase Summaries

### Phase 1 — Security (7 findings)

| ID | Severity | Finding |
|---|---|---|
| SEC-01 | P1 | Journey stage IDOR — `updateStage` had no journey ownership scope filter (**fixed**) |
| SEC-02 | P2 | Crawl trigger missing `planGuard` — any plan can initiate Browserbase sessions |
| SEC-03 | P2 | `strategy_briefs` save does not verify `client_id` belongs to calling org |
| SEC-04 | P2 | CSV formula injection chars reach the validator (rejected, never stored — medium severity at most) |
| SEC-05 | P2 | CSE `detected_signals` table uses `service_role_only` RLS policy — no row-level org scoping |
| SEC-06 | P3 | CORS allowlist reads `ALLOWED_ORIGINS` correctly but origin is trusted verbatim (no wildcard — fine) |
| SEC-07 | P3 | `crawl.ts:188` returns `browserbase_session_id` in crawl-run API response (internal identifier leak) |

### Phase 2 — Requirements Deviation (7 findings)

| ID | Severity | Finding |
|---|---|---|
| DEV-01 | P2 | WalkerOS tag detection still wired in CSE; generation side clean |
| DEV-02 | P2 | Signal freshness dimension absent from Andromeda readiness score (PRD §4.3) |
| DEV-03 | P2 | TikTok and LinkedIn CAPI adapters are stubs returning `{ success: true }` |
| DEV-04 | P2 | Audit Engine PDF report missing heatmap visualisation (PRD §6.2) |
| DEV-05 | P2 | Channel Insights session ingestion lacks automated channel attribution logic |
| DEV-06 | P2 | Journey Builder timing classifier bands broader than PRD spec (see FUNC-03) |
| DEV-07 | P2 | CLAUDE.md tech stack listed generic "Bull + Redis" — corrected to "Bull + Upstash Redis (TLS, rediss://)" |

### Phase 3.1 — Functional Testing (83/83 tests pass, 3 findings)

| ID | Severity | Finding |
|---|---|---|
| FUNC-01 | P2 | Readiness score: `server_side_enabled` and `capi_connected` are identical checks → org scores 40 on CAPI alone |
| FUNC-02 | P2 | StrategyGateBanner uses old verdict enum values (`keep/add_proxy/switch`) instead of `CONFIRM/AUGMENT/REPLACE` |
| FUNC-03 | P2 | Timing classifier `short_lag` covers 1–7 days; PRD defines it as same-session/24h — 5-day lag shown as marginal |

### Phase 3.2 — Optimization (12 findings)

| ID | Priority | Finding | Gain | Effort |
|---|---|---|---|---|
| OPT-01 | P1 | No Anthropic prompt caching — 8K system prompt re-sent per page scan | L | S |
| OPT-02 | P1 | Zero code splitting — 35 pages eagerly bundled; initial chunk likely 400–600 KB gzipped | L | M |
| OPT-03 | P2 | 7 missing DB indexes (strategy_briefs, objectives, detected_signals, offline_conversion_rows, reconciliation_findings, audit_findings, capi_events) | M–L | S |
| OPT-04 | P2 | 9 planning components subscribe to whole Zustand store — cascade re-renders every 2–5s poll | M | M |
| OPT-05 | P2 | No `manualChunks` in Vite config — vendor libs not separately cached | M | S |
| OPT-06 | P2 | `detected_signals(*)` expanded in crawl detail endpoint — full payloads for 2,000 signals per large run | M | M |
| OPT-07 | P2 | `getBriefWithObjectives` runs two sequential DB queries — should be single join | M | S |
| OPT-08 | P2 | `@noble/ciphers` undeclared in `backend/package.json` — transitive dep, non-deterministic | S | S |
| OPT-09 | P3 | `pino-pretty` and `@types/pdfkit` in production dependencies | S | S |
| OPT-10 | P3 | 16 Bull queues × Redis bclient — monitor Upstash connection count | S | L |
| OPT-11 | P3 | `ImplementationHealthPage.tsx` at 843 lines — maintainability | M | M |
| OPT-12 | P3 | Zustand store files have implicit `any` on state setter parameters | S | S |

---

## Recommended Immediate Actions (next sprint)

1. **OPT-01** — Add `cache_control: { type: 'ephemeral' }` to system prompt in `claudeClient.ts`. 2-line change, high ROI.
2. **OPT-03** — Apply single additive migration for 7 missing DB indexes. No data changes, no RLS changes.
3. **FUNC-02** — Update `StrategyGateBanner.tsx` verdict label mapping to `CONFIRM/AUGMENT/REPLACE`.
4. **SEC-02** — Add `planGuard('pro')` to `POST /api/crawl/trigger`.
5. **OPT-02** — Convert all 35 page imports in `App.tsx` to `React.lazy()` + wrap in `<Suspense>`.

Items 1, 2, 3, and 4 are S-effort, unambiguous, and reversible — they qualify for immediate fix PRs under the audit PR policy.
