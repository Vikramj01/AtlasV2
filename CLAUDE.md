# CLAUDE.md — Atlas V2

## Project Overview

Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.vimi.digital.

---

## Features

- **Journey Builder** — Multi-step wizard generating WalkerOS event specs and GTM container JSON (client + server-side).
- **AI Planning Mode** — Browserbase/Playwright site scan → Claude analysis → tagging recommendations, PII detection, GTM container + implementation guide export.
- **Conversion Strategy Gate** — Standalone pre-scan wizard at `/planning/strategy`. Collects business outcome and current optimisation event, calls Claude to produce a CONFIRM/AUGMENT/REPLACE verdict with proxy event guidance. Dismissible nudge banner on Planning Mode entry. No DB persistence (V1); all plan tiers.
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
│   │   ├── signals/        # SignalCard, PackCard, DeploymentWizard
│   │   ├── strategy/       # StrategyGateBanner, StrategyWizard, Step1Outcome, Step2EventEval, StrategyBrief
│   │   └── ui/             # shadcn/ui primitives — button, card, dialog, input, badge, select,
│   │                       # table, tabs, progress, label, textarea, switch, alert, separator
│   ├── lib/
│   │   ├── api/            # adminApi, auditApi, billingApi, capiApi, channelApi, checklistApi,
│   │   │                   # consentApi, dashboardApi, developerApi, exportApi, healthApi,
│   │   │                   # journeyApi, offlineConversionsApi, organisationApi, clientApi,
│   │   │                   # planningApi, readinessApi, scheduleApi, signalApi, strategyApi
│   │   ├── capi/           # adapters/ (meta, google, google-offline, tiktok stub, linkedin stub)
│   │   │                   # hash-pii.ts, dedup.ts, pipeline.ts, queue.ts
│   │   ├── consent/        # banner-generator.ts, cmp-listeners.ts, consent-engine.ts, gcm-mapper.ts
│   │   └── shared/         # crypto.ts
│   ├── pages/              # HomePage, LoginPage, DashboardPage, AuditProgressPage, ReportPage,
│   │                       # JourneyBuilderPage, PlanningDashboard, PlanningModePage, StrategyPage,
│   │                       # ConsentPage, CAPIPage, HealthDashboardPage, ChannelInsightsPage,
│   │                       # ClientListPage, SettingsPage, BillingSuccessPage, BillingCancelPage
│   ├── store/              # auditStore, billingStore, capiStore, consentStore, dashboardStore,
│   │                       # journeyWizardStore, offlineConversionsStore, organisationStore,
│   │                       # planningStore, signalStore
│   └── types/              # audit, capi, channel, consent, dashboard, health, journey,
│                           # offline-conversions, organisation, planning, schedule, signal, strategy
│
├── backend/src/
│   ├── api/
│   │   ├── middleware/     # authMiddleware, planGuard, rateLimiter, planningLimiter, errorHandler
│   │   └── routes/        # admin, audit, auth, billing, capi, channels, checklist, clients,
│   │                       # consent, dashboard, developer, exports, health, journeys,
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
│       └── [others]/       # health/, journey/, scoring/, validation/, reporting/,
│                           # signals/, consent/, dashboard/, developer/, export/, email/
│
└── supabase/migrations/
    ├── 20260317_001_consent_and_capi_tables.sql
    ├── 20260325_001_channel_tables.sql
    ├── 20260405_001_fix_user_deletion_cascade.sql
    ├── 20260406_001_offline_conversion_tables.sql
    └── 20260409_001_stripe_subscriptions.sql
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
| `/api/strategy` | strategy.ts | POST /evaluate — Claude proxy, authMiddleware, heavyLimiter |

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

`claude/atlas-planning-sprint-KQi7C`

### Conversion Strategy Gate — ✅ Complete
- ✅ `POST /api/strategy/evaluate` — backend Claude proxy (API key server-side, `heavyLimiter`)
- ✅ `frontend/src/components/strategy/` — StrategyGateBanner, StrategyWizard, Step1Outcome, Step2EventEval, StrategyBrief
- ✅ `frontend/src/lib/api/strategyApi.ts` — evaluateStrategy()
- ✅ `frontend/src/types/strategy.ts` — all strategy types
- ✅ Route `/planning/strategy` registered in App.tsx (no PlanGate — all plans)
- ✅ Banner injected into PlanningDashboard (localStorage dismissal)
- ✅ `proxyEventRequired` hard-enforced server-side when `outcomeTimingDays > 1`
- ⬜ V2 backlog: persist briefs to Supabase, pre-fill from prior session, pass context into Planning scan

### Stripe Payments — ✅ Complete
- DB migration, Stripe client, subscriptionService, billing routes, billingStore, SettingsPage, BillingSuccessPage, BillingCancelPage, planGuard, PlanGate, super admin, login page redesign

### Offline Conversions — Sprint 5 Pending
- ✅ Sprints 1–4: DB migration, types, store, backend pipeline (CSV validator, Google upload, Bull worker), frontend wizard (5 steps), upload flow UI
- ⬜ Sprint 5: unit/integration tests + security hardening
- Upload status lifecycle: `pending → validating → validated → confirmed → uploading → completed | partial | failed | cancelled`
