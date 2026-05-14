# CLAUDE.md — Atlas V2

## Project Overview

Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.vimi.digital.

---

## Features

- **Journey Builder** — Multi-step wizard generating GTM container JSON (client + server-side). Business types: ecommerce, lead_gen, b2b_saas, marketplace, nonprofit, **b2b_lead_gen** (7-stage B2B template). Journey stages carry `proxy_value_gbp` (monetary value for value-based bidding) and `buyer_intent_level` (problem_aware / solution_aware / vendor_aware).
- **AI Planning Mode** — Browserbase/Playwright site scan → Claude analysis → tagging recommendations, PII detection, GTM container + implementation guide. Implementation guide includes GCLID/UTM cookie capture, hidden form fields, CRM mapping, and Enhanced Conversions for Leads guidance for lead-gen + Google Ads sites. Approved recommendations can be saved to the Tag Library via `POST /sessions/:id/save-to-library`.
- **Tag Library** — Signal Library accessible from main sidebar at `/signals`. Per-event specs with platform mappings. Composable packs with deployment wizard. Planning Mode can save approved events directly here.
- **Conversion Strategy Gate** — Multi-objective wizard at `/planning/strategy`. Claude produces CONFIRM/AUGMENT/REPLACE verdicts with: proxy event guidance, measurement governance tier (primary/secondary/suppression conversion), platform-specific action types (Google primary_action/secondary_action, Meta optimization_event/custom_event, etc.), and OCI nudge when the recommended event is a CRM-stage (SQL, MQL, Opportunity, Closed-Won). PDF brief export + web view at `/strategy/briefs/:id`. Brief must be locked before site scan.
- **Crawl Signal Extractor (CSE)** — Subscription-gated automated site scan discovering and health-scoring tracking signals across seeded pages. Results at `/crawl/:runId` with real-time polling.
- **Usage Logging & Operator Monitoring** — Per-org usage event logging, Browserbase nightly reconciliation, operator alerts via email/Slack.
- **Validation Engine** — 26 rules across signal initiation, parameter completeness, and persistence layers.
- **Audit Engine** — Headless browser journey simulation, gap classification, scored PDF reports.
- **Health Dashboard** — Live health score, alert feed, historical trend.
- **Channel Insights** — Session ingestion + diagnostic engine mapping signal behaviour per channel.
- **Consent Integration Hub** — JS consent banner + CMP sync (OneTrust, Cookiebot, Usercentrics). Google Consent Mode v2.
- **Realtime CAPI** — Meta CAPI, Google Enhanced Conversions (TikTok/LinkedIn stubs). SHA-256 PII hashing, deduplication, consent gating.
- **Offline Conversions** — CSV upload to Google Ads `uploadClickConversions`. Validation pipeline, async Bull queue, per-row error reporting.
- **Organisation & Client Management** — Multi-tenant workspace with org switching, member roles, per-client config.
- **Billing & Subscriptions** — Stripe Checkout + Billing Portal. Plans: `free`, `pro`, `agency`. `planGuard` (backend) + `<PlanGate>` (frontend). Super admin via `SUPER_ADMIN_EMAILS`.

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
| **AI** | Anthropic Claude API (`@anthropic-ai/sdk`) — model: `claude-sonnet-4-6` |
| **Hosting** | Vercel (frontend), Node.js host (backend) |
| **Payments** | Stripe (Checkout Sessions, Billing Portal, Webhooks) |

> **Frontend is Vite + React, not Next.js.** No `app/api/` directory. All API routes are Express.js handlers in `backend/src/api/routes/`.

---

## Repository Structure

```
AtlasV2/
├── frontend/src/
│   ├── components/
│   │   ├── audit/        # AuditHistoryTable, AuditProgressSteps, RunAuditForm, ScheduleModal, ReportPages/*
│   │   ├── capi/         # ProviderList, SetupWizard, CAPIMonitoringDashboard, EMQEstimator
│   │   │   ├── offline/  # OfflineConversionsTab, UploadArea, ValidationReview, UploadHistory
│   │   │   └── steps/    # Realtime wizard steps
│   │   ├── channels/     # ChannelHealthIndicator, ChannelOverviewTable, DiagnosticCard
│   │   ├── common/       # ErrorBoundary, PlanGate, HealthBadge, ScoreCard, SkeletonCard
│   │   ├── consent/      # ConsentSettings, BannerConfigurator, CMPIntegration, ConsentAnalyticsDashboard
│   │   ├── crawl/        # CrawlProgress, CrawlResults
│   │   ├── journey/      # JourneyWizard, StageCard, Step1–4
│   │   ├── layout/       # AppLayout, ProtectedRoute, Sidebar, TopBar
│   │   ├── organisation/ # ClientCard, ClientSetupWizard, MemberManagement, OrgSwitcher
│   │   ├── planning/     # AnnotatedScreenshot, GTMContainerPreview, RecommendationCard, Step1–7
│   │   ├── signals/      # SignalCard, PackCard, DeploymentWizard
│   │   ├── strategy/     # StrategyGateBanner, StrategyGateGuard, Step1Define, Step2Verdict,
│   │   │                 # ObjectivesList, BriefLocked
│   │   └── ui/           # shadcn/ui primitives
│   ├── lib/
│   │   ├── api/          # adminApi, auditApi, billingApi, capiApi, channelApi, consentApi,
│   │   │                 # crawlApi, dashboardApi, developerApi, exportApi, healthApi,
│   │   │                 # journeyApi, offlineConversionsApi, organisationApi, clientApi,
│   │   │                 # planningApi (incl. saveToLibrary), readinessApi, scheduleApi,
│   │   │                 # signalApi, strategyApi
│   │   ├── capi/         # adapters/ (meta, google, google-offline, tiktok stub, linkedin stub)
│   │   ├── consent/      # banner-generator.ts, cmp-listeners.ts, consent-engine.ts, gcm-mapper.ts
│   │   └── shared/       # crypto.ts
│   ├── pages/            # HomePage, LoginPage, DashboardPage, AuditProgressPage, ReportPage,
│   │                     # JourneyBuilderPage, PlanningDashboard, PlanningModePage,
│   │                     # SignalLibraryPage (/signals + /org/:orgId/signals),
│   │                     # StrategyPage, StrategyBriefPage (/strategy/briefs/:id),
│   │                     # CrawlStatusPage (/crawl/:runId), ConsentPage, CAPIPage,
│   │                     # HealthDashboardPage, ChannelInsightsPage, ClientListPage,
│   │                     # SettingsPage, BillingSuccessPage, BillingCancelPage
│   ├── store/            # auditStore, billingStore, capiStore, consentStore, crawlStore,
│   │                     # dashboardStore, journeyWizardStore, offlineConversionsStore,
│   │                     # organisationStore, planningStore, signalStore, strategyStore
│   └── types/            # audit, capi, channel, consent, crawl, dashboard, health, journey,
│                         # offline-conversions, organisation, planning, schedule, signal,
│                         # strategy, usage
│
├── backend/src/
│   ├── api/
│   │   ├── middleware/   # authMiddleware, planGuard, rateLimiter, planningLimiter, errorHandler
│   │   └── routes/       # admin, audit, auth, billing, capi, channels, checklist, clients,
│   │                     # consent, crawl, dashboard, developer, exports, health, journeys,
│   │                     # offlineConversions, organisations, planning, readiness,
│   │                     # schedules, signals, strategy
│   └── services/
│       ├── database/     # supabase.ts + one query module per feature area
│       ├── planning/     # sessionOrchestrator, siteDetectionService, pageCaptureService,
│       │                 # aiAnalysisService, piiDetectionService,
│       │                 # generators/ (gtmContainer, dataLayerSpec, output, implementationGuide)
│       ├── strategy/     # evaluationPrompt.ts, briefPdfGenerator.ts
│       ├── crawl/        # crawlJob.ts, pageDiscovery.ts, signalDetector.ts, signalWriter.ts
│       ├── usage/        # usageLogger.ts, alertDelivery.ts, claudeClient.ts
│       ├── capi/         # credentials.ts, pipeline.ts, googleDelivery.ts, metaDelivery.ts
│       ├── queue/        # jobQueue.ts (Bull), worker.ts
│       └── [others]/     # audit/, browserbase/, channels/, health/, journey/, stripe/
│
└── supabase/migrations/
    ├── 20260317_001_consent_and_capi_tables.sql
    ├── 20260325_001_channel_tables.sql
    ├── 20260406_001_offline_conversion_tables.sql
    ├── 20260409_001_stripe_subscriptions.sql
    ├── 20260410_001_event_taxonomy.sql
    ├── 20260411_001_planning_rec_taxonomy.sql
    ├── 20260420_001_strategy_briefs.sql
    ├── 20260421_001_strategy_objectives.sql
    ├── 20260428_001_tracking_plan_versions.sql
    ├── 20260511_001_capi_provider_credentials_v2.sql
    ├── 20260519_001_capi_dedup.sql
    ├── 20260520_001_usage_events.sql
    ├── 20260521_001_org_subscriptions.sql
    ├── 20260522_001_browserbase_usage_snapshots.sql
    ├── 20260530_001_crawl_signal_extractor.sql
    ├── 20260604_001_journey_stage_b2b_fields.sql      ← proxy_value_gbp, buyer_intent_level
    └── 20260605_001_strategy_objective_governance_tier.sql  ← conversion_tier, platform_action_types
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
planning_sessions  (id, user_id, site_url, business_type, status, created_at)
planning_pages     (id, session_id, url, page_type, scan_status, page_capture, ai_analysis, created_at)
planning_recommendations (id, session_id, page_id, element_reference, selector,
                           recommendation_type, event_name, action_type, approved, ...)

-- Consent & CAPI (20260317)
consent_configs, consent_records
capi_providers     (credentials JSONB — AES-256-GCM encrypted)
capi_events, capi_event_queue

-- Channels (20260325)
channel_sessions, channel_session_events, channel_journey_maps, channel_diagnostics

-- Offline Conversions (20260406)
offline_conversion_configs, offline_conversion_uploads
offline_conversion_rows  (raw PII nulled post-upload, hashed_email, hashed_phone, gclid, ...)

-- Strategy Gate (20260420 + 20260421 + 20260605)
strategy_briefs        (id, organization_id, client_id, mode ['single'|'multi'],
                         brief_name, version_no, locked_at, superseded_by, ...)
strategy_objectives    (id, brief_id, organization_id, name, description, platforms TEXT[],
                         current_event, outcome_timing_days,
                         verdict ['CONFIRM'|'AUGMENT'|'REPLACE'], outcome_category,
                         recommended_primary_event, recommended_proxy_event, proxy_event_required,
                         rationale, summary_markdown, locked, locked_at,
                         conversion_tier ['primary'|'secondary'|'suppression'],
                         platform_action_types JSONB)
strategy_objective_campaigns (id, objective_id, platform, campaign_name, budget, ...)

-- Journey Builder (20260604)
journey_stages     (...existing fields...,
                    proxy_value_gbp numeric,           -- monetary value for value-based bidding
                    buyer_intent_level text)            -- problem_aware | solution_aware | vendor_aware

-- Usage & Billing (20260520–20260522)
usage_events, org_subscriptions, browserbase_usage_snapshots

-- Crawl Signal Extractor (20260530)
crawl_runs, crawl_pages, detected_signals, org_page_scope
```

---

## Backend API Routes

| Route | File | Key endpoints |
|---|---|---|
| `/api/admin` | admin.ts | GET /me, /stats, /users; PATCH /users/:id/plan |
| `/api/audit` | audit.ts | POST /start; GET /:id, /report, /gaps |
| `/api/billing` | billing.ts | POST /checkout, /portal, /webhook; GET /status |
| `/api/capi` | capi.ts | CRUD providers + /activate, /test, /process |
| `/api/channels` | channels.ts | GET /sessions, /diagnostics; POST /ingest-session |
| `/api/clients` | clients.ts | Full CRUD + generate/deploy/audit |
| `/api/consent` | consent.ts | GET /config; POST /record, /process; PUT /config |
| `/api/exports` | exports.ts | POST /audit/:id/pdf; POST /signals/inventory |
| `/api/health` | health.ts | GET /score, /alerts, /history |
| `/api/journeys` | journeys.ts | Full CRUD + spec generation |
| `/api/offline-conversions` | offlineConversions.ts | POST /upload, /upload/:id/confirm; GET /config, /history |
| `/api/organisations` | organisations.ts | Full CRUD + member management |
| `/api/planning` | planning.ts | POST /sessions, /detect, /rescan, /generate; GET /sessions, /:id; POST /sessions/:id/save-to-library |
| `/api/signals` | signals.ts | Full CRUD + deploy |
| `/api/crawl` | crawl.ts | POST /trigger, /seed-pages; GET /runs, /run/:id, /page-scope |
| `/api/strategy` | strategy.ts | POST/GET /briefs; GET/PATCH/DELETE /briefs/:id; POST /briefs/:id/lock, /export/pdf; POST /objectives; GET/PUT/DELETE /objectives/:id; POST /objectives/:id/evaluate, /lock, /campaigns |

---

## Key Technical Decisions

1. **Vite + React 19, not Next.js** — pure SPA, React Router v6, no server components.
2. **Express.js backend** — all API logic in `backend/src/`. Not Supabase Edge Functions.
3. **Bull + Redis** — audits, CAPI delivery, offline uploads run as Bull jobs.
4. **Credentials encrypted at rest** — `capi_providers.credentials` uses AES-256-GCM via `@noble/ciphers`. Never log decrypted credentials.
5. **No PII in job payloads** — queue payloads contain only IDs. Raw PII nulled post-upload.
6. **Claude API calls are backend-only** — `ANTHROPIC_API_KEY` never exposed to the browser.
7. **Stripe billing** — Checkout Sessions and Billing Portal only. Webhook handler uses `express.raw()` mounted before `express.json()`.
8. **Plan hierarchy** — `free < pro < agency`. `planGuard(minPlan)` on backend, `<PlanGate minPlan="...">` on frontend. Super admins bypass both.
9. **Migration guards** — `ALTER TABLE` on optional tables must be wrapped in `DO $$ IF EXISTS (SELECT FROM pg_tables ...) THEN ... END IF; END $$` to survive Supabase preview environments.
10. **org_id resolution** — `req.user` carries only `id`, `email`, `plan`, `isSuperAdmin`. Resolve `organization_id` via `supabaseAdmin.from('profiles').select('organization_id').eq('id', userId)`.
11. **shadcn/ui registry** — if `npx shadcn add` fails, install the Radix primitive directly and create the component manually.

---

## Implementation Rules

1. **New tables** → `supabase/migrations/` as numbered `.sql` files. RLS required.
2. **Credentials** → encrypted with `@noble/ciphers` AES-256-GCM.
3. **No PII in logs or queue payloads.**
4. **Consent-first** — every event carries consent state.
5. **Zod validation** — all backend request bodies validated with Zod.
6. **Error boundaries** — wrap new pages in `SectionErrorBoundary`.
7. **Loading states** — every async op shows a skeleton or spinner.
8. **TypeScript strict** — `noUnusedLocals: true`, `noUnusedParameters: true`. Unused imports = build failure.
9. **Functional components only.** No class components. No `'use client'`.
10. **API responses** → `{ data, error, message }` shape.
11. **Zustand for client state.** No React Query or SWR.

---

## Active Development Branch

`claude/map-b2b-advertiser-journey-UEDDw`

---

## Completed Sprints (summary)

| Sprint | What shipped |
|---|---|
| Stripe Payments | DB migration, Stripe client, billing routes, planGuard, PlanGate, super admin |
| Offline Conversions 1–4 | DB migration, CSV validator, Google upload pipeline, Bull worker, 5-step UI wizard |
| Strategy Gate V1 | Legacy single-event Claude proxy, StrategyGateBanner nudge |
| Strategy Gate 1.6a | Multi-objective data model (strategy_briefs, strategy_objectives, campaigns), full CRUD + Claude eval endpoints |
| Strategy Gate 1.6b | Wizard redesign: Step1Define, Step2Verdict, ObjectivesList, BriefLocked, StrategyGateGuard |
| Strategy Gate 1.6c | PDF brief generator (pdfkit), Supabase Storage upload, StrategyBriefPage web view |
| Strategy Gate B2B | Measurement governance tier (primary/secondary/suppression) + platform action types on objectives; OCI nudge for CRM-stage events in verdict + locked brief |
| CSE 1–4 | crawl_runs/pages/detected_signals schema, Browserbase signal detector, crawl API routes, CrawlStatusPage with real-time polling |
| Usage & Monitoring 2.1–2.4 | usage_events, org_subscriptions, browserbase_usage_snapshots, Browserbase reconciliation, operator alerts |
| B2B Journey Template | b2b_lead_gen business type, 7-stage template, proxy_value_gbp + buyer_intent_level on stages |
| GCLID Capture | Implementation guide: GCLID/UTM cookie script, hidden form fields, CRM field mapping, Enhanced Conversions for Leads |
| Tag Library Bridge | Planning Mode Step 5 "Save to Tag Library" CTA → POST /sessions/:id/save-to-library; "In library" chip on Step 4 recommendations |
| Tag Library Nav | /signals top-level route; Tag Library nav item in sidebar SET UP group |
