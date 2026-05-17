# Atlas V2 — Phase 2 Requirements Deviation Audit

**Audit date:** 2026-05-17  
**Branch audited:** `claude/atlas-v2-test-plan-6eb1g` (HEAD `9331ded`)  
**Scope:** All PRDs in `/docs/`, CLAUDE.md vs code, recent 90-day commit history

---

## Executive Summary

| Category | Count |
|---|---|
| Shipped as specified | **~85 spec items across 13 PRDs** |
| Partial / diverged | **5** |
| Missing | **2** |
| Built but undocumented (scope drift) | **4 features** |
| CLAUDE.md contradictions | **2** |

**Top deviations:**
1. **DEV-02 (P2)** — WalkerOS detection logic remains active in the planning and channel backend despite the DB migration removing WalkerOS from schema constraints.
2. **DEV-03 (P2)** — Andromeda Readiness Score implements a 6-item tracking-maturity model; the referenced PRD specifies five named dimensions (EMQ monitoring, funnel completeness, signal freshness/latency, dedup health, value parameter coverage) — dimensions do not match.
3. **DEV-07 (P2)** — No CI/CD infrastructure found; golden sample CI required by the six-sprint PRD is absent.

**CLAUDE.md doc fixes:** Two clear errors found — Redis provider misidentified as Render-managed (it is Upstash), and active development branch is stale. Single doc-fix PR opened (see bottom of report).

---

## Cross-PRD Summary

### Shipped as specified

| PRD | Coverage |
|---|---|
| Strategy Gate (Sprint 1.6a/b/c + B2B) | ✅ ~99% |
| Phase 1 Foundation (nav, dashboard, XLSX export) | ✅ 100% |
| Offline Conversion Upload | ✅ 100% |
| Event Taxonomy / Naming Governance | ✅ 99% (WalkerOS schema removed; detection code gap — DEV-02) |
| UX Clarity Layer | ✅ 100% |
| Output Quality (IR pipeline + GenerationValidator) | ✅ 100% |
| Signal Timing Guidance (Journey Builder) | ✅ 100% |
| Subscriptions & Pricing Config | ✅ 100% |
| Usage Logging & Cost Intelligence | ✅ 100% |
| Crawl Signal Extractor | ✅ ~92% (Journey Builder integration gap — DEV-05) |
| Platform Reconciliation | ✅ ~93% (Andromeda 6th-dimension hookup unconfirmed — DEV-06) |
| Implementation Health Checks | ✅ 100% |
| Dedup Engine | ✅ ~95% (browser-event rate limiter missing — DEV-04) |

### Partial / diverged

| ID | Severity | Item |
|---|---|---|
| DEV-01 | P3 | StrategyGateBanner has no dismiss button |
| DEV-02 | P2 | WalkerOS detection code persists in active planning/channel paths |
| DEV-03 | P2 | Andromeda Readiness Score dimensions diverge from PRD spec |
| DEV-04 | P2 | CAPI `/browser-event` endpoint missing rate-limiter middleware |
| DEV-06 | P2 | Reconciliation findings not demonstrably wired to Andromeda score |

### Missing

| ID | Severity | Item |
|---|---|---|
| DEV-07 | P2 | Golden sample CI pipeline absent (no `.github/workflows/`) |
| DEV-05 | P2 | CSE output → Journey Builder signal map integration absent |

### Built but not documented in any PRD (scope drift)

| Feature | First commit approx. | Notes |
|---|---|---|
| Platform Reconciliation engine | ~20260607 | Substantive feature; no standalone PRD file |
| Implementation Health Checks (IHC) | ~20260610 | In IMPLEMENTATION_HEALTH_CHECKS_PRD.md — but that doc was created alongside the code |
| Andromeda readiness / EMQ monitoring | N/A | Referenced in CLAUDE.md; no ANDROMEDA_SIGNAL_HEALTH_PRD.md |
| Channel Signal Behaviour / channel_sessions | ~20260325 | No CSB PRD in `/docs/` |

---

## Per-PRD Checklists

### PRD: Strategy Gate (ATLAS_V2_SPRINT_1_6_STRATEGY_GATE_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| `strategy_briefs` table — mode, brief_name, version_no, locked_at, superseded_by | ✅ Shipped | `20260421_001_strategy_objectives.sql:15–21` | All fields, correct constraints |
| `strategy_objectives` — verdict CHECK (CONFIRM/AUGMENT/REPLACE) | ✅ Shipped | `20260421_001_strategy_objectives.sql:34` | Correctly mapped from prior keep/add_proxy/switch |
| `conversion_tier` + `platform_action_types` on objectives | ✅ Shipped | `20260605_001_strategy_objective_governance_tier.sql:6–7` | Added in follow-on migration |
| Multi-objective CRUD (11+ endpoints) | ✅ Shipped | `backend/src/api/routes/strategy.ts` | Full CRUD, campaigns, evaluate, lock |
| Claude evaluation with structured response | ✅ Shipped | `backend/src/services/strategy/evaluationPrompt.ts` | Prompt + Zod-parsed response |
| OCI nudge for CRM-stage events | ⚠️ Partial | `frontend/src/components/strategy/BriefLocked.tsx` | CRM keyword detection present; no explicit labelled OCI nudge message |
| PDF brief generator | ✅ Shipped | `backend/src/services/strategy/briefPdfGenerator.ts` (500 lines) | Rate-limited (10 req/hr) |
| Web view at `/strategy/briefs/:id` | ✅ Shipped | `frontend/src/pages/StrategyBriefPage.tsx` + `App.tsx:72` | Route registered |
| Brief locking + versioning (edit locked → v2, v1 readable) | ✅ Shipped | `strategyObjectivesQueries.ts` — `createBriefVersion` | Correct superseded_by chain |
| Supabase Storage for PDF (`strategy-briefs/{org}/{brief}/v{N}.pdf`) | ✅ Shipped | `20260425_001_strategy_briefs_storage.sql` | RLS on bucket |
| StrategyGateBanner — voluntary, dismissible | ⚠️ Partial | `frontend/src/components/strategy/StrategyGateBanner.tsx` | **No dismiss/close button** — DEV-01 |
| Step1Define (6 fields), Step2Verdict (colour-coded cards), ObjectivesList, BriefLocked | ✅ Shipped | All four component files confirmed | Correct field set |
| RLS — org isolation on all strategy tables | ✅ Shipped | Migration policies `auth.uid()` | Verified in Phase 1 |

---

### PRD: Phase 1 Foundation (ATLAS_Phase1_Foundation_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| Navigation relabelled to task-oriented language | ✅ Shipped | `frontend/src/lib/ui-copy.ts:1–98` — SECTION_LABELS | Primary: "Site Scan & Recommendations", "Server-Side Tracking", "Tag Library", etc. |
| Technical labels preserved as secondary subtext | ✅ Shipped | `frontend/src/components/layout/Sidebar.tsx:30–44` | `technicalLabel` rendered as 10px grey |
| Action Dashboard at home/root | ✅ Shipped | `frontend/src/pages/HomePage.tsx` | Replaces static landing page |
| SummaryBar (4 metrics: health, CAPI, coverage, audit) | ✅ Shipped | `frontend/src/components/dashboard/SummaryBar.tsx` (167 lines) | |
| ActionCard with severity-based left border | ✅ Shipped | `frontend/src/components/dashboard/ActionCard.tsx` | 4 severity levels |
| Dashboard auto-refresh every 5 minutes | ✅ Shipped | `HomePage.tsx` useEffect + setInterval | |
| IntelligentRouter (3 task-oriented buttons) | ✅ Shipped | `frontend/src/components/dashboard/IntelligentRouter.tsx` | |
| MetricGuidance — reusable tooltip/expandable for 7 metric types | ✅ Shipped | `frontend/src/lib/guidance/metricGuidance.ts` | Integrated across 7+ pages |
| Signal Inventory XLSX export — 3 worksheets | ✅ Shipped | `backend/src/api/routes/exports.ts:23–43` + `signalInventoryExport.ts` (463 lines) | Conditional formatting, correct filename |
| GET `/api/exports/signal-inventory?org_id=` endpoint | ✅ Shipped | `exports.ts:23` | Returns `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Frontend export button on Signal Library page | ✅ Shipped | `frontend/src/lib/api/exportApi.ts` — `downloadSignalInventory()` | Content-Disposition filename extraction |

---

### PRD: Offline Conversion Upload (ATLAS_Offline_Conversion_Upload_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| 3 DB tables (configs, uploads, rows) with RLS | ✅ Shipped | `20260406_001_offline_conversion_tables.sql` | `purge_raw_pii()` SQL function defined |
| CSV validator: 7 fields, E.164 phone, ISO date, 90-day lookback | ✅ Shipped | `csvValidator.ts` (509 lines) | Full validation per spec |
| Within-upload + cross-upload dedup | ✅ Shipped | `csvValidator.ts:183–189` + `findCrossUploadDuplicates` | Both modes |
| Google Ads upload: SHA-256 hash, 2000-row batches, retry | ✅ Shipped | `googleOfflineUpload.ts` (500+ lines) | Exponential backoff |
| 7 API endpoints (template, config, actions, upload, confirm, status, history) | ✅ Shipped | `backend/src/api/routes/offlineConversions.ts` | All present |
| Bull queue for async upload | ✅ Shipped | Worker job wired to offlineConversionsRouter | |
| 5-step setup wizard (connect, select action, map columns, defaults, done) | ✅ Shipped | `frontend/src/components/offline-conversions/` | |
| PII purge post-upload | ✅ Shipped | `purge_raw_pii()` called after completion | |
| planGuard('agency') on all endpoints | ✅ Shipped | Both authMiddleware + planGuard applied | |
| CSV never written to disk (memoryStorage) | ✅ Shipped | Multer memoryStorage | Also confirmed in SEC audit |

---

### PRD: Event Taxonomy / Naming Governance (ATLAS_Event_Taxonomy_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| `event_taxonomy` table — slug, node_type, parameter_schema, platform_mappings, funnel_stage | ✅ Shipped | `20260410_001_event_taxonomy.sql` | Hierarchical with parent_id, path, depth |
| `naming_conventions` table | ✅ Shipped | `20260410_001_event_taxonomy.sql` | event_case, param_case, prefix rules, reserved words |
| Platform mappings: GA4, Meta, Google Ads, TikTok, LinkedIn, Snapchat | ✅ Shipped | Migration JSONB schema | 6 platforms |
| System taxonomy (is_system, org_id = NULL) vs custom (org-specific) | ✅ Shipped | RLS policy scoping | |
| Taxonomy FK on signals table | ✅ Shipped | `20260410_001_event_taxonomy.sql:275–276` | taxonomy_event_id, taxonomy_path |
| WalkerOS removed from DB schema | ✅ Shipped | `20260427_001_remove_walkeros.sql` | journeys.implementation_format, planning_outputs.output_type updated |
| WalkerOS removed from detection code | ❌ Missing | `sessionOrchestrator.ts:492–493`, `pageCaptureService.ts:208,257–259`, `diagnosticEngine.ts:80,193,252` | **DEV-02** — active WalkerOS detection paths remain |
| GA4 generator produces valid GA4 output | ✅ Shipped | `gtmContainerGenerator.ts` — exportFormatVersion 2, GA4 naming | Confirmed GA4-standard |

---

### PRD: UX Clarity (ATLAS_UX_CLARITY_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| Central `ui-copy.ts` with SECTION_LABELS + TOOLTIPS | ✅ Shipped | `frontend/src/lib/ui-copy.ts` | 15+ section labels, 10+ tooltip definitions |
| Reusable InfoTooltip component | ✅ Shipped | Referenced across HealthDashboardPage.tsx, others | |
| Summary-first views with drill-down | ✅ Shipped | Dashboard + Health pages pattern | |
| Status language consistent across platform | ✅ Shipped | TOOLTIPS.signalHealthy/Warning/Error defined | |

---

### PRD: Output Quality / Generation Validator (atlas-output-quality-prd.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| IR schema (IREvent, IRParameter, IRTrigger, IRAttribution, BusinessType) | ✅ Shipped | `generators/ir.types.ts` | Full typed IR |
| DeterministicRenderer — dataLayerSpec, gtmContainer, implementationGuide | ✅ Shipped | `generators/renderer/` — 3 files | |
| GenerationValidator — 10 named rules | ✅ Shipped | `generators/validator/generation.validator.ts` | All 10: VARIABLE_RESOLUTION, TAG_NAME_UNIQUENESS, CONSENT_SETTINGS_PRESENT, EVENT_PARAMETERS_COMPLETENESS, SCHEMA_SNIPPET_CONSISTENCY, SELECTOR_VALIDITY, BUSINESS_TYPE_ISOLATION, METADATA_ACCURACY, PLACEHOLDER_GUIDE_CONSISTENCY, PER_EVENT_CONVERSION_LABELS |
| CRITICAL errors block delivery; HIGH = warnings | ✅ Shipped | `outputGenerator.ts` | |
| Implementation guide includes GCLID/UTM capture, hidden form fields, CRM mapping, Enhanced Conversions | ✅ Shipped | `implementationGuide.ts` generator | Per CLAUDE.md sprint notes |

---

### PRD: Signal Timing Guidance / Journey Builder (PRD_Signal_Timing_Guidance_JourneyBuilder.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| Journey duration selector (4 options: immediate, 1–7d, 1–4w, 30+d) | ✅ Shipped | `BusinessModelContextSelector.tsx` + `journey.ts` JOURNEY_DURATION_OPTIONS | |
| LagClass type (immediate, short_lag, long_lag, deep_lag) | ✅ Shipped | `frontend/src/types/journey.ts` | |
| `classifyEvent()` function | ✅ Shipped | `frontend/src/lib/journey/classifyEvent.ts` | |
| TimingAssessmentPanel with platform status rows | ✅ Shipped | `TimingAssessmentPanel.tsx` + `PlatformStatusRow.tsx` | Meta 24h + Google 90d windows |
| TimingBadge (Optimal / Timing Risk: Meta / Critical) | ✅ Shipped | `TimingBadge.tsx` | Colour-coded per lag class |
| Proxy event library in Supabase | ✅ Shipped | `20260601_001_proxy_event_library.sql` | lag_class, platform_benefit, rationale, verticals |
| ProxyRecommendationList + "Add to Journey" button | ✅ Shipped | `ProxyRecommendationList.tsx`, `ProxyEventCard.tsx` | is_proxy=true on add |
| `conversion_event_metadata` JSONB on journey_stages | ✅ Shipped | `20260602_001_journey_stage_timing_metadata.sql` | |
| Multi-event TimingAssessmentSummary | ✅ Shipped | `TimingAssessmentSummary.tsx` | Renders for 2+ events |
| POST `/api/journeys/:id/proxy-recommendations` endpoint | ✅ Shipped | `backend/src/api/routes/journeys.ts` + `proxyEventQueries.ts` | |

---

### PRD: Subscriptions & Pricing (atlas-prd-subscriptions-pricing-config.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| `ATLAS_PRICING` typed constant with tier entitlements | ✅ Shipped | `backend/src/config/pricing.ts` | Direct tiers (diagnostic/monitor/management/operations/enterprise) + Agency tiers |
| `org_subscriptions` table | ✅ Shipped | `20260521_001_org_subscriptions.sql` | org_id, plan, mrr, renewal_date, billing_cadence |
| planGuard middleware | ✅ Shipped | `backend/src/api/middleware/planGuard.ts` | Used on planning, CAPI, schedules, connections, reconciliation, IHC |
| PlanGate frontend component | ✅ Shipped | `frontend/src/components/common/PlanGate.tsx` | |
| Stripe Checkout + Billing Portal | ✅ Shipped | `backend/src/api/routes/billing.ts` | POST /checkout, /portal |
| Stripe webhook — HMAC-SHA256 verified | ✅ Shipped | `billing.ts:119–143` | Confirmed in Phase 1 |
| Fair-use cap enforcement job (nightly) | ✅ Shipped | `backend/src/jobs/fairUseCap.ts` | |
| Super admin bypass (SUPER_ADMIN_EMAILS) | ✅ Shipped | planGuard checks isSuperAdmin | |

---

### PRD: Usage Logging (atlas-prd-usage-logging.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| `usage_events` table (org_id, event_type, browser_minutes, tokens, cost_usd) | ✅ Shipped | `20260520_001_usage_events.sql` | All fields |
| `usageLogger.ts` — `logUsage()` non-blocking | ✅ Shipped | `backend/src/services/usage/usageLogger.ts` | Promise.catch; never throws |
| Event types: page_scan, ai_report_scheduled, ai_report_ondemand, ai_query_ondemand | ✅ Shipped | UsageEventType enum | |
| Operator alerts (email + Slack) for margin/fair-use breaches | ✅ Shipped | `backend/src/services/usage/alertDelivery.ts` | AlertSeverity: medium/high |
| Browserbase reconciliation job (nightly) | ✅ Shipped | `backend/src/jobs/browserbaseReconciliation.ts` | |
| `browserbase_usage_snapshots` table | ✅ Shipped | `20260522_001_browserbase_usage_snapshots.sql` | |
| `computeGrossMargin()` + `detectFairUseBreach()` | ✅ Shipped | `backend/src/services/database/usageQueries.ts` | |

---

### PRD: Crawl Signal Extractor (atlas-prd-crawl-signal-extractor.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| crawl_runs, crawl_pages, detected_signals, org_page_scope tables | ✅ Shipped | `20260530_001_crawl_signal_extractor.sql` | RLS service_role_only on all 4 |
| crawlJob.ts, pageDiscovery.ts, signalDetector.ts, signalWriter.ts | ✅ Shipped | `backend/src/services/crawl/` | All 5 service files present |
| POST /trigger, GET /runs, GET /run/:id, GET /page-scope, POST /seed-pages | ✅ Shipped | `backend/src/api/routes/crawl.ts` | All 5 endpoints |
| CrawlStatusPage at `/crawl/:runId` with real-time polling | ✅ Shipped | `frontend/src/pages/CrawlStatusPage.tsx` | CrawlProgress + CrawlResults |
| Signal Library population (`writeSignalsToLibrary`) | ✅ Shipped | `signalWriter.ts` imported by crawlJob.ts | detected_signals written on completion |
| Subscription gating | ⚠️ Partial | `crawl.ts:51–55` — `getActiveSubscription(org_id)` | Functional but uses service-level check, not planGuard middleware — inconsistent; also flagged in SEC-05 |
| Journey Builder integration (signal map surfaced to JB) | ❌ Missing | No cross-service wiring found | **DEV-05** — PRD implies CSE output should feed Journey Builder signal map; no implementation |

---

### PRD: Platform Reconciliation (PLATFORM_RECONCILIATION_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| platform_connections table (OAuth, connection_type: manager/child/standalone) | ✅ Shipped | `20260606_001_platform_connections.sql` | Self-referential FK |
| Sync workers for Meta, GA4, Google Ads (6 workers + orchestrator) | ✅ Shipped | `backend/src/services/reconciliation/sync/` — 7 files | |
| 4 diff engines (config, alignment, delivery, volume) | ✅ Shipped | `backend/src/services/reconciliation/engine/` | |
| 15 finding codes across 4 dimensions | ✅ Shipped | `findingCodes.ts` | Delivery (4), Config (5), Alignment (3), Volume (2) |
| All 8 API endpoints planGuard('pro') | ✅ Shipped | `backend/src/api/routes/reconciliation.ts` | GET runs, findings, stats; PATCH resolve; POST trigger, tolerance |
| ReconciliationPage + RunDetailPage | ✅ Shipped | Two frontend pages confirmed | |
| Reconciliation findings → Andromeda score (6th dimension) | ⚠️ Partial | No evidence of recalculation hook | **DEV-06** — PRD specifies this integration; findings exist but no score recalc |
| Reconciliation findings → Health Dashboard alert feed | ⚠️ Partial | No explicit export mechanism found | May be implicit via findings table; not confirmed |

---

### PRD: Implementation Health Checks (IMPLEMENTATION_HEALTH_CHECKS_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| gtm_container_connections, gtm_container_snapshots tables | ✅ Shipped | `20260610_002_implementation_health.sql:14–73` | OAuth + manual upload; versioned snapshots |
| audit_findings table (rule_id, validation_layer, severity, evidence JSONB) | ✅ Shipped | Migration lines 154–175 | |
| ihc_alert_preferences + ihc_alert_log | ✅ Shipped | `20260610` + `20260615_001_ihc_alerts.sql` | Batching, digest dedup |
| 11 tag_configuration rules | ✅ Shipped | `backend/src/services/validation/tagConfiguration.ts` | |
| 3 implementation_drift rules | ✅ Shipped | `backend/src/services/validation/implementationDrift.ts` | Compares against baseline |
| Rule contract (rule_id, layer, severity, affected_platforms, fix_summary, test) | ✅ Shipped | Both rule files | |
| GET /ihc/findings/summary (free-tier upsell) | ✅ Shipped | `ihc.ts:41` | Severity counts only |
| GET /ihc/findings (planGuard pro) | ✅ Shipped | `ihc.ts:71` | Full evidence detail |
| alertService.ts — critical batching + digest + dedup | ✅ Shipped | `backend/src/services/ihc/alertService.ts` | |
| baselineManager.ts + findingsWriter.ts | ✅ Shipped | Both service files confirmed | |

---

### PRD: Dedup Engine (ATLAS_DEDUP_ENGINE_PRD.md)

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| event_id, dedup_key, dedup_status on capi_events | ✅ Shipped | `20260519_001_capi_dedup.sql:7–14` | |
| capi_browser_events table + TTL | ✅ Shipped | Migration lines 20–32 | |
| capi_providers.provider_token (UUID, unique) | ✅ Shipped | Migration lines 47–56 | |
| POST /api/capi/browser-event (provider_token auth, 204 response) | ✅ Shipped | `capi.ts:51–121` | Zod-validated, writes to Redis + DB |
| dedupStore.ts — Redis TTLs (48h Meta, 90d Google) | ✅ Shipped | `backend/src/services/capi/dedupStore.ts` | |
| Meta delivery: event_id from Redis fbclid lookup, dedup_status stored | ✅ Shipped | `metaDelivery.ts:145–197` | |
| Google delivery: transaction_id / orderId injection | ✅ Shipped | `googleDelivery.ts:289–295` | |
| Four-layer dedup model (GTM beacon → DB event_id → Redis → platform) | ✅ Shipped | All four layers present | |
| Rate-limiter on `/api/capi/browser-event` | ❌ Missing | No rateLimiter middleware on route | **DEV-04** — PRD specifies "Apply rateLimiter middleware"; absent |

---

## Detailed Deviation Findings

### DEV-01 (P3) — StrategyGateBanner has no dismiss button

**PRD:** The banner should be voluntary and dismissible.  
**Location:** `frontend/src/components/strategy/StrategyGateBanner.tsx`  
**Evidence:** Banner renders status and a "Update" navigation CTA but has no close/dismiss button. The `BriefLocked` next-steps panel does implement dismissal via `localStorage` key `atlas_brief_nextsteps_dismissed` — the pattern exists but was not applied to the banner itself.  
**Impact:** Low UX friction only; Planning Mode is not blocked.  
**Recommended fix:** Add a dismiss callback prop and render an `×` icon that sets a localStorage key (mirroring BriefLocked pattern).

---

### DEV-02 (P2) — WalkerOS detection code persists in active planning and channel paths

**PRD:** Event Taxonomy PRD and migration `20260427_001_remove_walkeros.sql` state WalkerOS is dropped; standardise on GA4.  
**Locations:**
- `backend/src/services/planning/sessionOrchestrator.ts:492–493` — pushes `platform: 'walkeros'` to analysis results
- `backend/src/services/planning/pageCaptureService.ts:208, 257–259` — active WalkerOS script tag detection
- `backend/src/services/channels/diagnosticEngine.ts:80, 193, 252` — diagnostic copy recommends "Verify that WalkerOS events are firing correctly"
- `backend/src/api/routes/channels.ts:8, 108` — route doc references WalkerOS batch ingestion
- `backend/src/types/planning.ts:70` — `walkeros_detected: boolean` active field
- `frontend/src/lib/consent/cmp-listeners.ts:5` — "WalkerOS integration layer" comment
- `frontend/src/types/capi.ts:174` — "from WalkerOS pipeline" comment  

**Evidence of correct removal:** DB schema constraints removed (`20260427`), GTM container generator produces pure GA4.  
**Impact:** WalkerOS detection results can surface in Planning Mode AI analysis output. Diagnostic copy recommends WalkerOS verification on customer dashboards — misleading for customers who have never deployed WalkerOS.  
**Recommended fix:** Remove the `walkeros_detected` field from `PlanningTypes`, strip the detection branch from `sessionOrchestrator.ts` and `pageCaptureService.ts`, update diagnostic copy in `diagnosticEngine.ts` and `channels.ts`. Comments in capi/consent files can remain (they're informational, not functional).  
**Note:** Requires a product call to confirm WalkerOS detection is intentionally dropped rather than being kept for legacy-customer reporting.

---

### DEV-03 (P2) — Andromeda Readiness Score dimensions diverge from PRD specification

**PRD:** The Andromeda Signal Health PRD (document not present in `/docs/`) is referenced in the test plan as specifying five dimensions: EMQ monitoring, funnel completeness, signal freshness/latency, dedup health, value parameter coverage.  
**Location:** `backend/src/api/routes/readiness.ts:1–188`  
**Evidence:** GET `/api/readiness-score` returns a composite 0–100 score built from 6 items:
1. Consent configured (+20)
2. Server-side tracking enabled (+20)
3. CAPI connected to platform (+20)
4. Click ID capture (+15)
5. Enhanced conversions enabled (+15)
6. Data Health Score > 80 (+10)

None of these map to the five named PRD dimensions. EMQ exists as a separate metric (`capi.ts:240` — `emq_estimate`, `dashboard.ts:9,42` — `capi_emq`), but is not a readiness dimension. There is no funnel completeness, signal freshness, dedup health, or value coverage dimension in the readiness endpoint.  
**Impact:** The readiness score serves a useful purpose but does not match its PRD specification. This is likely intentional drift — the score was redesigned around tracking maturity rather than signal health dimensions — but it is undocumented.  
**Recommended fix:** Either (a) update the ANDROMEDA_SIGNAL_HEALTH_PRD to reflect the current 6-item model, or (b) add the five named dimensions to the readiness endpoint as a parallel scoring axis and document the composite formula. Do not change without product sign-off.

---

### DEV-04 (P2) — CAPI `/browser-event` endpoint missing rate-limiter middleware

**PRD:** Dedup Engine PRD specifies "Apply rateLimiter middleware" on `POST /api/capi/browser-event`.  
**Location:** `backend/src/api/routes/capi.ts:51–121`  
**Evidence:** The route has no `rateLimiter` or `rateLimit` middleware applied. The global limiter (200 req/15 min/IP) applies, but the PRD calls for a tighter dedicated limit given this endpoint receives automated browser beacon traffic.  
**Impact:** Without a specific limit, a misconfigured GTM tag could flood the endpoint, filling the `capi_browser_events` table and Redis keyspace.  
**Recommended fix:** Add a `browserEventLimiter` (e.g., 500 req/15 min keyed on provider_token) before the route handler.

---

### DEV-05 (P2) — CSE output → Journey Builder signal map integration absent

**PRD:** The Crawl Signal Extractor PRD implies that CSE output should populate a signal map accessible from Journey Builder ("Journey Builder has no signal map to work from").  
**Evidence:** `signalWriter.ts` writes detected signals to `detected_signals` table; Journey Builder queries from `journey_stages` and `proxy_event_library`. No service or query function cross-references CSE output into Journey Builder recommendations.  
**Impact:** Journey Builder cannot suggest stages or signals based on what was actually detected on the customer's site, missing a key use case.  
**Recommended fix:** Requires a product scoping decision on how signal detection maps to journey stages. Could be implemented as a new endpoint `GET /api/crawl/detected-signals?for_journey_builder=true` that returns detected events shaped as stage candidates.

---

### DEV-06 (P2) — Reconciliation findings not demonstrably wired to Andromeda score recalculation

**PRD:** Platform Reconciliation PRD specifies that reconciliation results extend the Andromeda Readiness Score with a sixth dimension.  
**Evidence:** Reconciliation findings are persisted to `reconciliation_findings` table. The readiness endpoint (`readiness.ts`) does not query `reconciliation_findings` or `reconciliation_runs`. No recalculation trigger found.  
**Impact:** Reconciliation results are siloed — they do not elevate or depress the Andromeda score when platform misalignment is detected.  
**Note:** This gap may be intentional if the reconciliation-to-Andromeda hookup was deferred. Requires product confirmation.

---

### DEV-07 (P2) — Golden sample CI pipeline absent

**PRD:** The six-sprint PRD (not present in `/docs/`) is referenced in the test plan as specifying a golden sample CI pipeline.  
**Evidence:** No `.github/` directory exists in the repository. No CI/CD workflows (GitHub Actions, CircleCI, etc.) were found anywhere in the working tree. The repository has no automated test runner on PR.  
**Impact:** No regression protection on output generators, validation rules, or dedup logic. Changes to `gtmContainerGenerator.ts`, `GenerationValidator`, or `evaluationPrompt.ts` have no automated check.  
**Recommended fix:** Create `.github/workflows/ci.yml` with at minimum: TypeScript compile check (`tsc --noEmit`), unit test runner (`vitest`), and golden sample diff for the GA4 generator and GenerationValidator. The vitest config already exists at `backend/vitest.config.ts` — the test runner infrastructure is present but no CI harness invokes it.

---

## CLAUDE.md Contradictions

### CLAUDE-01 (P2) — Redis provider misidentified as Render-managed

**CLAUDE.md claim:** Tech Stack table lists `Render-managed Redis` as the queue technology.  
**Actual:** `render.yaml` lines 44–47 explicitly configure **Upstash Redis** (TLS, `rediss://` URL from Upstash console). The comment reads: `"Use the rediss:// (TLS) URL from your Upstash console"`.  
**Impact:** Meaningful operational difference — Upstash and Render Redis have different availability, pricing, connection limits, and failover behaviour. Incorrect documentation could mislead ops/infra decisions.  
**Fix:** See doc-fix PR below.

### CLAUDE-02 (P3) — Active development branch is stale

**CLAUDE.md claim (line ~244):** `Active Development Branch: claude/map-b2b-advertiser-journey-UEDDw`  
**Actual:** That branch was merged via PRs #209–211 (commit `554e402`). Current working branch is `claude/atlas-v2-test-plan-6eb1g`.  
**Impact:** Low — cosmetic stale reference, but can confuse onboarding.  
**Fix:** See doc-fix PR below.

---

## Missing PRDs — Features Built Without Spec Documents

| Expected PRD | In `/docs/`? | Feature status | Action |
|---|---|---|---|
| ANDROMEDA_SIGNAL_HEALTH_PRD.md | ❌ | Readiness score + EMQ built; dimensions diverge from test-plan spec — DEV-03 | Create spec doc reflecting current 6-item model |
| Six-sprint PRD (GA4 gen, CAPI adapter, Google adapter split, Consent Mode v2, golden sample CI) | ❌ | All features built except golden sample CI — DEV-07 | Create CI workflow; create spec doc |
| Channel Signal Behaviour (CSB) PRD | ❌ | Channel Insights page + `channel_sessions` tables + diagnosticEngine fully built | Create spec doc |
| GTM Destinations addendum PRD | ❌ | GTM merge utility, GTM schema validator, GA4/Google Ads/Meta destinations all built | Create spec doc |

---

## Scope Drift (Built but not in any PRD)

| Feature | Evidence | Commits |
|---|---|---|
| Platform Reconciliation engine (7 sync workers, 4 diff engines, 15 finding codes) | `backend/src/services/reconciliation/` | ~20260607 |
| Implementation Health Checks (14 validation rules, alert system, baselines) | `backend/src/services/ihc/`, `backend/src/services/validation/` | ~20260610–20260615 |
| `ATLAS_PRICING` multi-tier pricing config (Direct + Agency tiers beyond free/pro/agency) | `backend/src/config/pricing.ts` | N/A |
| GTM container merge utility + schema validator | `backend/src/services/planning/generators/gtmMerge.ts`, `gtmSchemaValidator.ts` | N/A |

All scope-drift items appear to be deliberate product expansions. None contradict existing PRDs. No rollback recommended.
