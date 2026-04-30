# CLAUDE.md — Atlas V2

## Project Overview

Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.vimi.digital.

---

## Features

- **Journey Builder** — Multi-step wizard generating WalkerOS event specs and GTM container JSON (client + server-side).
- **AI Planning Mode** — Browserbase/Playwright site scan → Claude analysis → tagging recommendations, PII detection, GTM container + implementation guide export.
- **Conversion Strategy Gate** — Multi-objective strategy wizard at `/planning/strategy`. Users define one or more conversion objectives (business outcome, timing, current event, platforms), Claude evaluates each and produces a CONFIRM/AUGMENT/REPLACE verdict with proxy event guidance. Objectives and briefs are persisted to Supabase; brief must be locked before proceeding to site scan. Dismissible nudge banner on Planning Mode entry. All plan tiers. PDF brief export (pdfkit, stored in Supabase Storage) and web view at `/strategy/briefs/:id`.
- **Crawl Signal Extractor (CSE)** — Subscription-gated automated site scan that discovers and health-scores tracking signals (GTM, GA4, Meta Pixel, CAPI, Google Ads, TikTok, LinkedIn, Snapchat, custom events) across all seeded pages. Supports onboarding and scheduled modes. Pages sourced from ad platform URLs (Google Ads, Meta Ads) or manual seed. Results viewable at `/crawl/:runId` with real-time polling progress and per-page signal breakdown.
- **Usage Logging & Operator Monitoring** — Per-org usage event logging (`scan_cost`, `ai_cost`, `browser_minutes`). Browserbase nightly reconciliation snapshots. Operator alert delivery via email/Slack for threshold violations. Attribution of Browserbase sessions to audit and quick-check runs.
- **Validation Engine** — 26 rules across signal initiation, parameter completeness, and persistence layers. Scores event quality.
- **Audit Engine** — Headless browser journey simulation, gap classification per funnel stage, scored PDF reports. One-off and scheduled.
- **Health Dashboard** — Live health score, alert feed, historical trend.
- **Channel Insights** — Session ingestion + diagnostic engine mapping signal behaviour per channel.
- **Signal Library & Packs** — Per-event specs with platform mappings, composable packs with deployment wizard. Outputs WalkerOS specs and GTM data layer.
- **Consent Integration Hub** — Self-contained JS consent banner + CMP sync (OneTrust, Cookiebot, Usercentrics). Google Consent Mode v2. Consent analytics dashboard.
- **Realtime CAPI** — Meta CAPI, Google Enhanced Conversions (TikTok/LinkedIn stubs). SHA-256 PII hashing, deduplication, consent gating, EMQ monitoring.
- **Offline Conversions** — CSV upload to Google Ads `uploadClickConversions`. Validation pipeline, cross-upload dedup, async Bull queue, per-row error reporting.
- **Organisation & Client Management** — Multi-tenant workspace with org switching, member roles, per-client config.
- **Developer Portal** — Public share link, no-auth report view, quick-check implementation verification.
- **Readiness Scoring** — Org readiness score across dimensions + onboarding checklist.
- **Billing & Subscriptions** — Stripe Checkout + Billing Portal. Plans: `free`, `pro`, `agency`. Gates on backend (`planGuard`) and frontend (`PlanGate`).
- **Super Admin** — `SUPER_ADMIN_EMAILS` env var. Full access, bypasses all plan gates, no Stripe billing.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vite + React 19, TypeScript, Tailwind CSS, shadcn/ui |
| **Routing** | React Router v6 |
| **State** | Zustand |
| **Backend** | Express.js (Node.js), TypeScript |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth (email + OAuth) |
| **Queue** | Bull + Redis |
| **Browser Automation** | Browserbase + Playwright Core |
| **AI** | Anthropic Claude API (`@anthropic-ai/sdk`) — current model: `claude-sonnet-4-6` |
| **Hosting** | Vercel (frontend), Node.js host (backend) |
| **Payments** | Stripe (Checkout Sessions, Billing Portal, Webhooks) |

> **Frontend is Vite + React, not Next.js.** No `app/api/` directory. All API routes are Express.js handlers in `backend/src/api/routes/`.

---

## Repository Structure

```
AtlasV2/
├── frontend/src/
│   ├── components/
│   │   ├── audit/          # AuditHistoryTable, AuditProgressSteps, RunAuditForm, ScheduleModal, ReportPages/*
│   │   ├── capi/           # ProviderList, SetupWizard, CAPIMonitoringDashboard, EMQEstimator
│   │   │   ├── offline/    # OfflineConversionsTab, UploadArea, ValidationReview, UploadHistory
│   │   │   └── steps/      # Realtime wizard steps
│   │   ├── channels/       # ChannelHealthIndicator, ChannelOverviewTable, DiagnosticCard
│   │   ├── common/         # ErrorBoundary, PlanGate, HealthBadge, ScoreCard, SkeletonCard
│   │   ├── consent/        # ConsentSettings, BannerConfigurator, CMPIntegration, ConsentAnalyticsDashboard
│   │   ├── dashboard/      # ActionCard, IntelligentRouter, SummaryBar
│   │   ├── developer/      # CodeSnippet, DeveloperHeader, PageImplementationCard
│   │   ├── health/         # ActiveAlertsFeed, HealthHistoryChart, OverallScoreRing
│   │   ├── journey/        # JourneyWizard, StageCard, Step1–4
│   │   ├── layout/         # AppLayout, ProtectedRoute, Sidebar, TopBar
│   │   ├── organisation/   # ClientCard, ClientSetupWizard, MemberManagement, OrgSwitcher
│   │   ├── planning/       # AnnotatedScreenshot, GTMContainerPreview, RecommendationCard, Step1–7
│   │   ├── crawl/          # CrawlProgress, CrawlResults
│   │   ├── signals/        # SignalCard, PackCard, DeploymentWizard
│   │   ├── strategy/       # StrategyGateBanner, StrategyGateGuard, Step1Define, Step2Verdict,
│   │   │                   # ObjectivesList, BriefLocked
│   │   │                   # (legacy: StrategyWizard, Step1Outcome, Step2EventEval, StrategyBrief)
│   │   └── ui/             # shadcn/ui primitives — button, card, dialog, input, badge, select,
│   │                       # table, tabs, progress, label, textarea, switch, alert, separator
│   ├── lib/
│   │   ├── api/            # adminApi, auditApi, billingApi, capiApi, channelApi, checklistApi,
│   │   │                   # consentApi, crawlApi, dashboardApi, developerApi, exportApi, healthApi,
│   │   │                   # journeyApi, offlineConversionsApi, organisationApi, clientApi,
│   │   │                   # planningApi, readinessApi, scheduleApi, signalApi, strategyApi
│   │   ├── capi/           # adapters/ (meta, google, google-offline, tiktok stub, linkedin stub)
│   │   │                   # hash-pii.ts, dedup.ts, pipeline.ts, queue.ts
│   │   ├── consent/        # banner-generator.ts, cmp-listeners.ts, consent-engine.ts, gcm-mapper.ts
│   │   └── shared/         # crypto.ts
│   ├── pages/              # HomePage, LoginPage, DashboardPage, AuditProgressPage, ReportPage,
│   │                       # JourneyBuilderPage, PlanningDashboard, PlanningModePage,
│   │                       # StrategyPage (view controller — landing + wizard flow),
│   │                       # StrategyBriefPage (/strategy/briefs/:id — web view of locked brief),
│   │                       # CrawlStatusPage (/crawl/:runId — real-time polling + results),
│   │                       # ConsentPage, CAPIPage, HealthDashboardPage, ChannelInsightsPage,
│   │                       # ClientListPage, SettingsPage, BillingSuccessPage, BillingCancelPage
│   ├── store/              # auditStore, billingStore, capiStore, consentStore, crawlStore,
│   │                       # dashboardStore, journeyWizardStore, offlineConversionsStore,
│   │                       # organisationStore, planningStore, signalStore, strategyStore
│   └── types/              # audit, capi, channel, consent, crawl, dashboard, health, journey,
│                           # offline-conversions, organisation, planning, schedule, signal,
│                           # strategy, usage
│
├── backend/src/
│   ├── api/
│   │   ├── middleware/     # authMiddleware, planGuard, rateLimiter, planningLimiter, errorHandler
│   │   └── routes/        # admin, audit, auth, billing, capi, channels, checklist, clients,
│   │                       # consent, crawl, dashboard, developer, exports, health, journeys,
│   │                       # offlineConversions, organisations, planning, readiness,
│   │                       # schedules, signals, strategy
│   └── services/
│       ├── stripe/         # client.ts, subscriptionService.ts
│       ├── audit/          # orchestrator, journeySimulator, gapClassifier, dataCapture
│       ├── browserbase/    # client.ts, journeyConfigs.ts
│       ├── capi/           # credentials.ts, pipeline.ts, googleDelivery.ts, metaDelivery.ts
│       ├── channels/       # sessionIngestion, journeyComputation, diagnosticEngine
│       ├── database/       # supabase.ts + one query module per feature area (18 modules)
│       ├── offline-conversions/ # csvValidator.ts, googleOfflineUpload.ts
│       ├── planning/       # sessionOrchestrator, siteDetectionService, pageCaptureService,
│       │                   # aiAnalysisService, changeDetectionService, piiDetectionService,
│       │                   # generators/ (gtmContainer, dataLayerSpec, output, guide)
│       ├── queue/          # jobQueue.ts (Bull), worker.ts
│       ├── crawl/          # crawlJob.ts (Bull orchestration), pageDiscovery.ts,
│       │                   # signalDetector.ts, signalWriter.ts, crawlHelpers.ts, crawl.ts (types)
│       ├── strategy/       # evaluationPrompt.ts (buildUserPrompt, SYSTEM_PROMPT, parseEvalResponse)
│       │                   # briefPdfGenerator.ts (pdfkit-based PDF generation)
│       ├── usage/          # usageLogger.ts, alertDelivery.ts (email/Slack), claudeClient.ts
│       └── [others]/       # health/, journey/, scoring/, validation/, reporting/,
│                           # signals/, consent/, dashboard/, developer/, export/, email/
│
└── supabase/migrations/
    ├── 20260317_001_consent_and_capi_tables.sql
    ├── 20260325_001_channel_tables.sql
    ├── 20260405_001_fix_user_deletion_cascade.sql
    ├── 20260406_001_offline_conversion_tables.sql
    ├── 20260408_001_offline_conversions_meta_support.sql
    ├── 20260409_001_stripe_subscriptions.sql
    ├── 20260410_001_event_taxonomy.sql
    ├── 20260411_001_planning_rec_taxonomy.sql
    ├── 20260420_001_strategy_briefs.sql
    ├── 20260421_001_strategy_objectives.sql
    ├── 20260427_001_remove_walkeros.sql
    ├── 20260428_001_tracking_plan_versions.sql
    ├── 20260511_001_capi_provider_credentials_v2.sql
    ├── 20260518_001_google_oauth_fields.sql
    ├── 20260519_001_capi_dedup.sql
    ├── 20260520_001_usage_events.sql
    ├── 20260521_001_org_subscriptions.sql
    ├── 20260522_001_browserbase_usage_snapshots.sql
    └── 20260530_001_crawl_signal_extractor.sql
```

---

## Supabase Schema

**RLS enabled on every table. All new tables must use `organization_id = auth.uid()`.**

```sql
-- Core
organizations      (id, name, type, plan, created_at)
profiles           (id, organization_id, full_name, role,
                    stripe_customer_id, stripe_subscription_id,
                    subscription_status, current_period_end, created_at)
clients            (id, organization_id, name, website_url, industry, created_at)
projects           (id, organization_id, client_id, name, status, phase_data, created_by, created_at)
planning_sessions  (id, user_id, site_url, business_type, status, created_at)
planning_pages     (id, session_id, url, page_type, scan_status, page_capture, ai_analysis, created_at)
planning_recommendations (id, session_id, page_id, element_reference, selector, recommendation_type, ...)

-- Consent & CAPI (20260317)
consent_configs    (id, organization_id, mode, categories JSONB, banner_config JSONB, gcm_mapping JSONB, ...)
consent_records    (id, organization_id, visitor_id, categories JSONB, consent_string, ...)
capi_providers     (id, organization_id, provider, credentials JSONB [AES-256-GCM encrypted], status, ...)
capi_events        (id, organization_id, provider_id, event_name, hashed_email, hashed_phone, status, ...)
capi_event_queue   (id, organization_id, provider_id, payload JSONB, status, attempts, next_retry_at)

-- Channels (20260325)
channel_sessions, channel_session_events, channel_journey_maps, channel_diagnostics

-- Offline Conversions (20260406)
offline_conversion_configs  (id, organization_id, capi_provider_id, google_customer_id, column_mapping JSONB, ...)
offline_conversion_uploads  (id, organization_id, config_id, filename, row_count_total, status, ...)
offline_conversion_rows     (id, upload_id, raw_email/phone/gclid [nulled post-upload],
                              hashed_email, hashed_phone, conversion_time, status, ...)

-- Strategy Gate (20260420 + 20260421)
strategy_briefs        (id, organization_id, client_id, project_id, mode ['single'|'multi'],
                         brief_name, version_no, locked_at, superseded_by,
                         -- legacy single-event columns kept for one release:
                         business_outcome, outcome_timing_days, current_event, verdict, proxy_event, rationale)
strategy_objectives    (id, brief_id, organization_id, name, description, platforms TEXT[],
                         current_event, outcome_timing_days,
                         verdict ['CONFIRM'|'AUGMENT'|'REPLACE'], outcome_category,
                         recommended_primary_event, recommended_proxy_event, proxy_event_required,
                         rationale, summary_markdown, locked, locked_at, created_at, updated_at)
strategy_objective_campaigns (id, objective_id, organization_id, platform, campaign_name, budget, created_at)

-- Usage & Billing Infrastructure (20260520 + 20260521 + 20260522)
usage_events           (id, organization_id, event_type ['scan_cost'|'ai_cost'|'browser_minutes'],
                         value, metadata JSONB, created_at)
org_subscriptions      (id, organization_id, plan, status, browserbase_minutes_limit,
                         scan_limit, created_at, updated_at)
browserbase_usage_snapshots (id, organization_id, snapshot_date, minutes_used, minutes_billed,
                              reconciled_at, created_at)

-- Crawl Signal Extractor (20260530)
crawl_runs             (id, organization_id, mode ['onboarding'|'scheduled'], status
                         ['queued'|'running'|'completed'|'failed'|'partial'],
                         pages_total, pages_scanned, started_at, completed_at, created_at)
crawl_pages            (id, run_id, organization_id, url, status, signals_found,
                         signals_healthy, signals_warning, signals_error, created_at)
detected_signals       (id, page_id, run_id, organization_id,
                         signal_type ['gtm_container'|'ga4_base'|'ga4_event'|'meta_pixel'|
                         'meta_capi'|'google_ads_conversion'|'google_ads_remarketing'|
                         'tiktok_pixel'|'linkedin_insight'|'snapchat_pixel'|'custom_event'|...],
                         health_status ['healthy'|'warning'|'error'], issues JSONB,
                         parameters JSONB, created_at)
org_page_scope         (id, organization_id, url, domain, priority, source
                         ['google_ads'|'meta_ads'|'manual'], active, created_at)
```

---

## Backend API Routes

| Route | File | Key endpoints |
|---|---|---|
| `/api/admin` | admin.ts | GET /me, /stats, /users; PATCH /users/:id/plan |
| `/api/audit` | audit.ts | POST /start; GET /:id, /report, /gaps |
| `/api/auth` | auth.ts | POST /signup, /forgot-password |
| `/api/billing` | billing.ts | POST /checkout, /portal, /webhook; GET /status |
| `/api/capi` | capi.ts | CRUD providers + /activate, /test, /process |
| `/api/channels` | channels.ts | GET /sessions, /diagnostics; POST /ingest-session |
| `/api/clients` | clients.ts | Full CRUD + generate/deploy/audit |
| `/api/consent` | consent.ts | GET /config; POST /record, /process; PUT /config |
| `/api/dashboard` | dashboard.ts | GET /summary |
| `/api/developer` | developer.ts | GET /share/:token; POST /quick-check |
| `/api/exports` | exports.ts | POST /audit/:id/pdf; POST /signals/inventory |
| `/api/health` | health.ts | GET /score, /alerts, /history |
| `/api/journeys` | journeys.ts | Full CRUD + spec generation |
| `/api/offline-conversions` | offlineConversions.ts | POST /upload, /upload/:id/confirm; GET /config, /history |
| `/api/organisations` | organisations.ts | Full CRUD + member management |
| `/api/planning` | planning.ts | POST /sessions, /detect, /rescan, /generate; GET /sessions, /:id |
| `/api/readiness` | readiness.ts | GET /score, /breakdown, /checklist |
| `/api/schedules` | schedules.ts | Full CRUD |
| `/api/signals` | signals.ts | Full CRUD + deploy |
| `/api/crawl` | crawl.ts | POST /trigger, /seed-pages; GET /runs, /run/:id, /page-scope |
| `/api/strategy` | strategy.ts | POST /evaluate (legacy); POST/GET /briefs, GET/PATCH/DELETE /briefs/:id, POST /briefs/:id/lock, /briefs/:id/export/pdf; POST /objectives, GET/PUT/DELETE /objectives/:id, POST /objectives/:id/evaluate (heavyLimiter), /objectives/:id/lock, /objectives/:id/campaigns |

---

## Key Technical Decisions

1. **Vite + React 19, not Next.js** — pure SPA, React Router v6, no server components.
2. **Express.js backend** — all API logic in `backend/src/`. Not Supabase Edge Functions.
3. **Bull + Redis** — audits, CAPI delivery, offline uploads run as Bull jobs. Workers in `services/queue/worker.ts`.
4. **Credentials encrypted at rest** — `capi_providers.credentials` uses AES-256-GCM via `@noble/ciphers`. Never log decrypted credentials.
5. **No PII in job payloads** — queue payloads contain only IDs. Raw PII nulled by `purge_raw_pii()` post-upload.
6. **Provider adapter pattern** — `CAPIProviderAdapter` interface in `lib/capi/adapters/types.ts`. Never put provider-specific logic in the core pipeline.
7. **Claude API calls are backend-only** — `ANTHROPIC_API_KEY` never exposed to the browser. Frontend calls backend proxy endpoints which call the Anthropic SDK.
8. **Stripe billing** — Checkout Sessions and Billing Portal only. Webhook handler uses `express.raw()` mounted before `express.json()` in `app.ts`.
9. **Plan hierarchy** — `free < pro < agency`. `planGuard(minPlan)` on backend routes, `<PlanGate minPlan="...">` on frontend. Super admins bypass both.
10. **Super admin** — `SUPER_ADMIN_EMAILS` env var (distinct from `ADMIN_EMAILS`). Sets `req.user.isSuperAdmin = true`. No Stripe billing.
11. **shadcn/ui registry** — `npx shadcn add` may fail if the registry is unreachable. In that case, install the Radix primitive directly (`npm install @radix-ui/react-[component]`) and create the component manually following the existing shadcn pattern in `components/ui/`.

---

## Implementation Rules

1. **New tables** → `supabase/migrations/` as numbered `.sql` files. RLS required.
2. **Credentials** → encrypted with `@noble/ciphers` AES-256-GCM.
3. **No PII in logs or queue payloads.**
4. **Consent-first** — every event carries consent state.
5. **shadcn/ui** — use existing components. See note in Key Technical Decisions #11 if registry fails.
6. **Zod validation** — all backend request bodies validated with Zod.
7. **Error boundaries** — wrap new pages in `SectionErrorBoundary`.
8. **Loading states** — every async op shows a skeleton or spinner.
9. **TypeScript strict** — `noUnusedLocals: true`, `noUnusedParameters: true`. Build command: `tsc && vite build`. Unused imports = build failure.
10. **Functional components only.** No class components. No `'use client'` (not Next.js).
11. **API responses** → `{ data, error, message }` shape.
12. **Zustand for client state.** No React Query or SWR.

---

## Active Development Branch

`claude/update-claude-md-EbzbD`

---

## Sprint 1.6 — Strategy Gate Redesign

Full PRD: `docs/ATLAS_V2_SPRINT_1_6_STRATEGY_GATE_PRD.md`

### Part 1.6a — Multi-objective data foundation ✅ Complete

- ✅ `supabase/migrations/20260421_001_strategy_objectives.sql` — `strategy_objectives` + `strategy_objective_campaigns` tables, extended `strategy_briefs` with `mode`, `brief_name`, `version_no`, `locked_at`, `superseded_by`
- ✅ `backend/src/services/database/strategyObjectivesQueries.ts` — full CRUD for briefs, objectives, campaigns; `createBrief`, `patchBrief`, `lockBrief`, `createObjective`, `updateObjective`, `deleteObjective`, `setObjectiveEvaluation`, `lockObjective`, `addCampaign`
- ✅ `backend/src/services/strategy/evaluationPrompt.ts` — `SYSTEM_PROMPT`, `buildUserPrompt` (includes description/business outcome), `parseEvalResponse`, `enforceProxyRule`
- ✅ `backend/src/api/routes/strategy.ts` — all new endpoints wired up; `POST /evaluate` kept as legacy thin wrapper
- ✅ `frontend/src/types/strategy.ts` — `StrategyBriefRecord`, `StrategyBriefWithObjectives`, `StrategyObjective`, `BriefMode`, `CreateBriefInput`, `UpdateObjectiveInput`, `PatchBriefInput`, `ObjectiveEvalResult`
- ✅ `frontend/src/lib/api/strategyApi.ts` — full `strategyApi` object covering all endpoints
- ✅ `frontend/src/store/strategyStore.ts` — Zustand store: `fetchBriefs`, `fetchBrief`, `createBrief`, `lockBrief`, `deleteBrief`, `createObjective`, `updateObjective`, `deleteObjective`, `evaluateObjective`, `lockObjective`
- ✅ Soft cap: warn at 6th objective; hard cap: reject 11th (422)
- ✅ Supabase Preview CI fixes: `now()` removed from index predicate; missing-table `ALTER TABLE` guards; duplicate migration date prefix conflicts resolved

### Part 1.6b — Wizard redesign ✅ Complete

- ✅ `frontend/src/pages/StrategyPage.tsx` — view-state controller with discriminated union (`landing → define → verdict → objectives → locked`). Landing page has mode selection cards (single / multi).
- ✅ `frontend/src/components/strategy/Step1Define.tsx` — 6-field objective form: name (multi-mode only), business type, business outcome (textarea + collapsible examples), outcome timing, current event (+ "Not sure" checkbox), ad platform chips. Calls `createObjective`/`updateObjective` then `evaluateObjective`.
- ✅ `frontend/src/components/strategy/Step2Verdict.tsx` — verdict display: inputs summary, coloured verdict block (green/amber/red), recommended event cards, summary markdown. "Lock this objective" calls `lockObjective`; single-mode also calls `lockBrief`.
- ✅ `frontend/src/components/strategy/ObjectivesList.tsx` — multi-mode list: per-objective verdict badges + locked state; "Add objective" and "Lock strategy brief" (enabled only when all locked).
- ✅ `frontend/src/components/strategy/BriefLocked.tsx` — success screen with locked objectives summary, CTA to start site scan or create new brief.
- ✅ `frontend/src/components/strategy/StrategyGateGuard.tsx` — updated to require `locked_at !== null` (not just any brief existing).
- ✅ Legacy components (`StrategyWizard`, `Step1Outcome`, `Step2EventEval`, `StrategyBrief`) retained for backward compat, not actively used by the new flow.

### Part 1.6c — Strategy Brief output ✅ Complete

- ✅ `backend/src/services/strategy/briefPdfGenerator.ts` — pdfkit-based PDF generator (~500 lines). Sections: cover (client/org name, date locked, version), summary (objectives + verdict one-liners), per-objective block (inputs table, verdict, event cards, rationale, warnings, campaigns), implementation notes (platform-specific config guidance for Meta/Google/LinkedIn/TikTok), appendix. Verdict colour-coded (CONFIRM=green, AUGMENT=orange, REPLACE=red).
- ✅ `POST /api/strategy/briefs/:id/export/pdf` — generates PDF via `generateBriefPdf()`, uploads to Supabase Storage at `strategy-briefs/{org_id}/{brief_id}/v{n}.pdf` via `uploadStrategyBriefPdf()`, returns 1-hour signed URL. Requires locked brief (403 if not). Rate-limited 10/hr.
- ✅ `frontend/src/pages/StrategyBriefPage.tsx` — web view at `/strategy/briefs/:id`. Displays all objectives with verdicts, event recommendations, rationale, and summary markdown. Download PDF button with loading state.
- ✅ Route `/strategy/briefs/:id` registered in `App.tsx` wrapped in `SectionErrorBoundary`.
- ✅ Supabase Storage bucket `strategy-briefs/` with org-scoped signed URLs.
- ✅ File naming: `Atlas-Strategy-Brief-{clientOrOrgSlug}-v{N}-{YYYY-MM-DD}.pdf`

---

## Crawl Signal Extractor (CSE) — Sprints 1–4 ✅ Complete

### CSE Sprint 1 — Schema & Types ✅

- ✅ `supabase/migrations/20260530_001_crawl_signal_extractor.sql` — `crawl_runs`, `crawl_pages`, `detected_signals`, `org_page_scope` tables with comprehensive indexing on `organization_id`, `status`, `created_at`, `domain`. RLS: service-role-only (not customer-readable via frontend queries).
- ✅ `frontend/src/types/crawl.ts` — `CrawlMode`, `CrawlStatus`, `CrawlPageStatus`, `UrlType`, `SignalType` (13 types: gtm_container, ga4_base, ga4_event, meta_pixel, meta_capi, google_ads_conversion, google_ads_remarketing, tiktok_pixel, linkedin_insight, snapchat_pixel, custom_event, …), `SignalHealthStatus`; interfaces: `OrgPageScope`, `DetectedSignalResult`, `CrawlPageResult`, `CrawlRunSummary`, `CrawlRunDetail`.

### CSE Sprint 2 — Core Backend Services ✅

- ✅ `backend/src/services/crawl/pageDiscovery.ts` — subscription-tier-aware page scope discovery; parses ad platform URLs (Google Ads, Meta Ads); seeds `org_page_scope`.
- ✅ `backend/src/services/crawl/signalDetector.ts` — per-page signal detection via Browserbase/Playwright (GTM, GA4, pixels, CAPI, remarketing, etc.).
- ✅ `backend/src/services/crawl/signalWriter.ts` — persists `detected_signals` to DB with health scoring.
- ✅ `backend/src/services/crawl/crawlHelpers.ts` — URL normalisation, domain extraction utilities.
- ✅ `backend/src/services/crawl/crawl.ts` — shared types for crawl services.

### CSE Sprint 3 — API Routes & Scheduled Trigger ✅

- ✅ `backend/src/api/routes/crawl.ts` — 5 endpoints:
  - `POST /api/crawl/trigger` — initiates crawl (`onboarding` or `scheduled` mode); subscription-gated
  - `POST /api/crawl/seed-pages` — loads URLs into `org_page_scope` from source (`google_ads`, `meta_ads`, `manual`)
  - `GET /api/crawl/runs` — lists last 10 crawl runs for org
  - `GET /api/crawl/run/:id` — single run detail with all pages + detected signals
  - `GET /api/crawl/page-scope` — active seeded pages for org
- ✅ `backend/src/services/crawl/crawlJob.ts` — Bull job orchestration; Browserbase session management; page scan initiation.

### CSE Sprint 4 — Frontend Polling UI & Signal Results ✅

- ✅ `frontend/src/lib/api/crawlApi.ts` — `triggerCrawl`, `seedPages`, `getRun`, `getRuns`, `getPageScope`.
- ✅ `frontend/src/store/crawlStore.ts` — Zustand store with polling: `setCurrentRun`, `startPolling`, `stopPolling`; auto-switches to results tab on completion.
- ✅ `frontend/src/pages/CrawlStatusPage.tsx` — full-screen crawl monitor at `/crawl/:runId`. Progress + Results tabs; real-time polling with spinner; auto-switches on `completed`/`partial` status; error state handling.
- ✅ `frontend/src/components/crawl/CrawlProgress.tsx` — progress visualisation with page count.
- ✅ `frontend/src/components/crawl/CrawlResults.tsx` — per-page signal health summary.
- ✅ Route `/crawl/:runId` registered in `App.tsx`.

---

## Usage Logging & Operator Monitoring — Sprints 2.1–2.4 ✅ Complete

- ✅ `supabase/migrations/20260519_001_capi_dedup.sql` — CAPI deduplication improvements.
- ✅ `supabase/migrations/20260520_001_usage_events.sql` — `usage_events` table: per-org event logging (`scan_cost`, `ai_cost`, `browser_minutes`).
- ✅ `supabase/migrations/20260521_001_org_subscriptions.sql` — `org_subscriptions` table: plan, status, per-org resource limits.
- ✅ `supabase/migrations/20260522_001_browserbase_usage_snapshots.sql` — `browserbase_usage_snapshots` table: nightly reconciliation records.
- ✅ `backend/src/services/usage/usageLogger.ts` — logs usage events to DB.
- ✅ `backend/src/services/usage/alertDelivery.ts` — operator alerts via email and Slack for threshold violations.
- ✅ `backend/src/services/usage/claudeClient.ts` — Anthropic API wrapper with usage tracking.
- ✅ Sprint 2.1: Browserbase session attribution for audit and quick-check runs.
- ✅ Sprint 2.2: Browserbase nightly reconciliation.
- ✅ Sprint 2.3: Operator alert delivery (email + Slack).
- ✅ Sprint 2.4: Browserbase reconciliation panel in admin UI.
- ✅ `frontend/src/types/usage.ts` — `UsageEvent`, `UsagePortfolioRow`, `OrgDailyCost`, `OrgDomainCost`, `OrgAIBreakdown`, `ReconciliationSnapshot`.

---

## Previously Completed Sprints

### Conversion Strategy Gate V1 — ✅ Complete (superseded by Sprint 1.6)
- `POST /api/strategy/evaluate` — legacy single-event Claude proxy (kept for one release)
- `StrategyGateBanner` — dismissible nudge on Planning Mode entry
- `proxyEventRequired` hard-enforced server-side when `outcomeTimingDays > 1`

### Stripe Payments — ✅ Complete
- DB migration, Stripe client, subscriptionService, billing routes, billingStore, SettingsPage, BillingSuccessPage, BillingCancelPage, planGuard, PlanGate, super admin, login page redesign

### Offline Conversions — Sprint 5 Pending
- ✅ Sprints 1–4: DB migration, types, store, backend pipeline (CSV validator, Google upload, Bull worker), frontend wizard (5 steps), upload flow UI
- ⬜ Sprint 5: unit/integration tests + security hardening
- Upload status lifecycle: `pending → validating → validated → confirmed → uploading → completed | partial | failed | cancelled`
