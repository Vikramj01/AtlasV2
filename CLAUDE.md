# CLAUDE.md — Atlas V2

## Project Overview

Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.spi3l.com.

---

## What Atlas Does (Current Capabilities)

### Core Features
- **Journey Builder** — Guided multi-step wizard for defining customer journeys. Generates composable tracking tags, WalkerOS event specs, and GTM container JSON (client-side + server-side).
- **AI Planning Mode** — Agent that scans sites using Browserbase/Playwright, captures DOM, runs AI analysis (Claude API), recommends tagging, detects PII, and produces full implementation guides + GTM container exports.
- **Validation Engine** — 26 rules across 3 layers: signal initiation, parameter completeness, and persistence. Scores event quality.
- **Audit Engine** — Runs a headless browser journey simulation, classifies gaps per funnel stage, generates scored audit reports (PDF export). Supports one-off and scheduled audits.
- **Health Dashboard** — Live health score, alert feed, and historical trend for signal quality across all journeys.
- **Channel Insights** — Session ingestion + diagnostic engine that maps signal behaviour per channel, compares journeys, surfaces anomalies.
- **Signal Library & Packs** — Signal inventory (per-event specs with platform mappings), composable signal packs with deployment wizard. Outputs WalkerOS specs and composable GTM data layer.
- **Consent Integration Hub** — Built-in consent banner (self-contained JS snippet) + bidirectional sync with external CMPs (OneTrust, Cookiebot, Usercentrics). Google Consent Mode v2 signal generation. Consent analytics dashboard.
- **Realtime CAPI Module** — Server-side Conversions API integrations: Meta CAPI, Google Enhanced Conversions (TikTok and LinkedIn stubs ready). SHA-256 PII hashing, event deduplication, consent gating, EMQ monitoring, delivery dashboard.
- **Offline Conversions** — CSV upload of closed CRM deals to Google Ads `uploadClickConversions`. Full validation pipeline, cross-upload dedup, async processing via Bull queue, per-row error reporting.
- **Organisation & Client Management** — Multi-tenant workspace with org switching, member management (roles), and per-client configuration.
- **Developer Portal** — Public share link with no-auth report view, quick-check implementation verification.
- **Readiness Scoring** — Scores org readiness across dimensions; onboarding checklist.
- **Audit Scheduling** — Cron-based scheduled audits.
- **PDF/CSV Exports** — Audit reports and signal inventory exported as PDF or Excel.
- **Billing & Subscriptions** — Stripe-powered checkout, billing portal, and webhook-driven subscription sync. Three plans: `free`, `pro`, `agency`. Plan gates enforced on backend (middleware) and frontend (PlanGate component).
- **Super Admin Accounts** — 2–3 trusted accounts declared via `SUPER_ADMIN_EMAILS` env var. Full platform access, bypass all plan gates, not connected to Stripe billing.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vite + React 19, TypeScript, Tailwind CSS, shadcn/ui (Radix UI primitives) |
| **Routing** | React Router v6 |
| **State** | Zustand |
| **Backend** | Express.js (Node.js), TypeScript |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth (email + OAuth) |
| **Queue** | Bull + Redis (async job processing) |
| **Browser Automation** | Browserbase + Playwright Core |
| **AI** | Anthropic Claude API (`@anthropic-ai/sdk`) |
| **Hosting** | Vercel (frontend), separate Node.js host (backend) |
| **Payments** | Stripe (Checkout Sessions, Billing Portal, Webhooks — fully integrated) |

> **IMPORTANT**: The frontend is **Vite + React** (not Next.js). There is no `app/api/` directory and no Next.js App Router. All API routes are Express.js route handlers in `backend/src/api/routes/`.

---

## Repository Structure

```
AtlasV2/
├── frontend/
│   └── src/
│       ├── app/                        # React Router page components
│       │   └── (dashboard)/            # Authenticated routes
│       │       ├── integrations/
│       │       │   └── capi/page.tsx   # CAPI + Offline Conversions tab page
│       │       └── consent/page.tsx    # Consent settings page
│       ├── components/
│       │   ├── audit/                  # AuditHistoryTable, AuditProgressSteps, RunAuditForm,
│       │   │                           # ScheduleModal, ReportNav, ReportPages/*
│       │   ├── capi/                   # ProviderList, SetupWizard, CAPIMonitoringDashboard,
│       │   │   │                       # EMQEstimator, DeliveryTimeline, ErrorLog
│       │   │   ├── offline/            # OfflineConversionsTab, UploadArea, ValidationReview,
│       │   │   │   │                   # UploadProgress, UploadResults, UploadHistory,
│       │   │   │   │                   # SetupWizard (offline), GCLIDCapturePanel
│       │   │   │   └── steps/          # Step1–5 for offline setup wizard
│       │   │   └── steps/              # ConnectAccount, MapEvents, ConfigureIdentifiers,
│       │   │                           # TestVerify, Activate (realtime wizard)
│       │   ├── channels/               # ChannelHealthIndicator, ChannelOverviewTable,
│       │   │                           # DiagnosticCard, JourneyFlowComparison, JourneyStep
│       │   ├── common/                 # EducationTooltip, EmptyState, ErrorBoundary,
│       │   │                           # HealthBadge, ScoreCard, SeverityBadge, StatusBanner,
│       │   │                           # PlanGate (plan-enforcement wrapper component)
│       │   ├── consent/                # ConsentSettings, BannerConfigurator, BannerPreview,
│       │   │                           # CMPIntegration, CategoryEditor, ConsentAnalyticsDashboard
│       │   ├── dashboard/              # ActionCard, IntelligentRouter, SummaryBar
│       │   ├── developer/              # CodeSnippet, DeveloperHeader, PageImplementationCard
│       │   ├── health/                 # ActiveAlertsFeed, HealthHistoryChart, OverallScoreRing
│       │   ├── journey/                # JourneyWizard, StageCard, Step1–4, WizardProgress
│       │   ├── layout/                 # AppLayout, ProtectedRoute, Sidebar, TopBar
│       │   ├── organisation/           # ClientCard, ClientSetupWizard, MemberManagement, OrgSwitcher
│       │   ├── planning/               # AnnotatedScreenshot, GTMContainerPreview, RecommendationCard,
│       │   │                           # Step1–7 (full planning wizard)
│       │   ├── signals/                # SignalCard, SignalEditor, PackCard, PackEditor,
│       │   │                           # DeploymentWizard, WalkerOSAdvantageCard
│       │   └── ui/                     # shadcn/ui primitives (button, card, dialog, input,
│       │                               # badge, select, table, tabs, progress, etc.)
│       ├── lib/
│       │   ├── api/                    # One client module per feature area:
│       │   │                           # adminApi, auditApi, billingApi, capiApi, channelApi,
│       │   │                           # checklistApi, consentApi, dashboardApi, developerApi,
│       │   │                           # exportApi, healthApi, journeyApi, offlineConversionsApi,
│       │   │                           # organisationApi, clientApi, planningApi,
│       │   │                           # readinessApi, scheduleApi, signalApi
│       │   ├── capi/
│       │   │   ├── adapters/           # types.ts (CAPIProviderAdapter interface),
│       │   │   │                       # meta.ts, google.ts, google-offline.ts,
│       │   │   │                       # tiktok.ts (stub), linkedin.ts (stub)
│       │   │   ├── hash-pii.ts         # SHA-256 PII hashing
│       │   │   ├── dedup.ts            # Event deduplication
│       │   │   ├── pipeline.ts         # Event transformation pipeline
│       │   │   └── queue.ts            # Client-side event queue
│       │   ├── consent/
│       │   │   ├── banner-generator.ts # Self-contained JS banner snippet
│       │   │   ├── cmp-listeners.ts    # OneTrust / Cookiebot / Usercentrics bridges
│       │   │   ├── consent-engine.ts   # Consent state management
│       │   │   └── gcm-mapper.ts       # Google Consent Mode v2 mapping
│       │   └── shared/
│       │       └── crypto.ts           # Shared hashing utilities
│       ├── pages/                      # React Router page-level components
│       │   # (HomePage, LoginPage [split-screen redesign], DashboardPage,
│       │   #  AuditProgressPage, ReportPage, JourneyBuilderPage, PlanningDashboard,
│       │   #  ConsentPage, CAPIPage, HealthDashboardPage, ChannelInsightsPage,
│       │   #  ClientListPage, SettingsPage [billing UI],
│       │   #  BillingSuccessPage, BillingCancelPage)
│       ├── store/
│       │   ├── auditStore.ts
│       │   ├── billingStore.ts         # Stripe billing state (plan, status, checkout/portal actions)
│       │   ├── capiStore.ts
│       │   ├── consentStore.ts
│       │   ├── dashboardStore.ts
│       │   ├── journeyWizardStore.ts
│       │   ├── offlineConversionsStore.ts
│       │   ├── organisationStore.ts
│       │   ├── planningStore.ts
│       │   └── signalStore.ts
│       └── types/
│           # audit.ts, capi.ts, channel.ts, consent.ts, dashboard.ts,
│           # health.ts, journey.ts, offline-conversions.ts,
│           # organisation.ts, planning.ts, schedule.ts, signal.ts
│
├── backend/
│   └── src/
│       ├── api/
│       │   ├── middleware/             # authMiddleware, rateLimiter, errorHandler,
│       │   │                          # planGuard (plan-enforcement middleware)
│       │   └── routes/
│       │       # admin.ts, audit.ts, auth.ts, billing.ts, capi.ts, channels.ts,
│       │       # checklist.ts, clients.ts, consent.ts, dashboard.ts,
│       │       # developer.ts, exports.ts, health.ts, journeys.ts,
│       │       # offlineConversions.ts, organisations.ts, planning.ts,
│       │       # readiness.ts, schedules.ts, signals.ts
│       ├── services/
│       │   ├── stripe/                 # client.ts (lazy singleton), subscriptionService.ts
│       │   ├── audit/                  # orchestrator, journeySimulator, gapClassifier, dataCapture
│       │   ├── browserbase/            # client.ts, journeyConfigs.ts
│       │   ├── capi/                   # credentials.ts, pipeline.ts, googleDelivery.ts, metaDelivery.ts
│       │   ├── channels/               # sessionIngestion, journeyComputation, diagnosticEngine
│       │   ├── consent/                # gcmMapper.ts
│       │   ├── dashboard/              # dashboardService.ts
│       │   ├── database/               # One query module per feature area (17 modules)
│       │   │                           # + supabase.ts client
│       │   ├── developer/              # quickCheckService, shareService
│       │   ├── email/                  # emailService.ts
│       │   ├── export/                 # pdfGenerator.ts, signalInventoryExport.ts
│       │   ├── health/                 # scoreEngine, alertEngine, healthOrchestrator
│       │   ├── interpretation/         # engine.ts (Claude API — AI audit interpretation)
│       │   ├── journey/                # specOrchestrator, platformSchemas, actionPrimitives,
│       │   │                           # generators/ (gtmDataLayer, validationSpec, walkerosFlow)
│       │   ├── offline-conversions/    # csvValidator.ts, googleOfflineUpload.ts
│       │   ├── planning/               # sessionOrchestrator, siteDetectionService,
│       │   │                           # pageCaptureService, aiAnalysisService,
│       │   │                           # changeDetectionService, piiDetectionService,
│       │   │                           # generators/ (gtmContainer, dataLayerSpec, output, guide)
│       │   ├── queue/                  # jobQueue.ts (Bull), worker.ts
│       │   ├── reporting/              # generator.ts
│       │   ├── scoring/                # engine.ts
│       │   ├── signals/                # composableOutputGenerator, walkerosComposableGenerator
│       │   └── validation/             # engine.ts, signalInitiation, parameterCompleteness, persistence
│       ├── types/                      # Backend-scoped mirror types (offline-conversions.ts, etc.)
│       └── app.ts                      # Express app setup + route mounting
│
├── supabase/
│   └── migrations/
│       ├── 20260317_001_consent_and_capi_tables.sql    # consent_configs, consent_records,
│       │                                               # capi_providers, capi_events, capi_event_queue
│       ├── 20260325_001_channel_tables.sql             # channel_sessions, channel_session_events,
│       │                                               # channel_journey_maps, channel_diagnostics
│       ├── 20260405_001_fix_user_deletion_cascade.sql  # CASCADE fixes for user deletion
│       ├── 20260406_001_offline_conversion_tables.sql  # offline_conversion_configs,
│       │                                               # offline_conversion_uploads,
│       │                                               # offline_conversion_rows
│       └── 20260409_001_stripe_subscriptions.sql       # Adds stripe_customer_id, stripe_subscription_id,
│                                                       # subscription_status, current_period_end to profiles
│
└── docs/
    ├── atlas-prd-consent-capi.docx
    └── ATLAS_Offline_Conversion_Upload_PRD.md
```

---

## Supabase Schema (Do Not Modify Without Migration)

### Original tables (in use, never alter)
```sql
organizations      (id, name, type, plan, created_at)
profiles           (id [FK auth.users], organization_id, full_name, role, created_at)
clients            (id, organization_id, name, website_url, industry, created_at)
projects           (id, organization_id, client_id, name, status, phase_data, created_by, created_at, updated_at)
planning_sessions  (id, user_id, site_url, business_type, business_context, platforms,
                    implementation_format, status, created_at, updated_at)
planning_pages     (id, session_id, url, label, page_type, scan_status, is_selected,
                    page_capture, ai_analysis, error, created_at)
planning_recommendations (id, session_id, page_id, element_reference, selector,
                          recommendation_type, ...)
```

### Consent & CAPI tables (migration 20260317)
```sql
consent_configs    (id, organization_id, mode, categories JSONB, banner_config JSONB,
                    gcm_mapping JSONB, cmp_provider, cmp_config JSONB, ...)
consent_records    (id, organization_id, project_id, visitor_id, categories JSONB,
                    consent_string, ip_country, user_agent, ...)
capi_providers     (id, organization_id, provider, name, credentials JSONB [encrypted],
                    status, last_tested_at, ...)
capi_events        (id, organization_id, provider_id, event_name, event_time,
                    hashed_email, hashed_phone, gclid, fbclid, value, currency,
                    consent_state, status, ...)
capi_event_queue   (id, organization_id, provider_id, payload JSONB, status,
                    attempts, last_error, next_retry_at, ...)
```

### Channel tables (migration 20260325)
```sql
channel_sessions        (id, organization_id, session_id, channel, utm_source, ...)
channel_session_events  (id, session_id, event_name, event_data JSONB, ...)
channel_journey_maps    (id, organization_id, channel, journey_id, ...)
channel_diagnostics     (id, organization_id, diagnostic_type, severity, ...)
```

### Stripe subscription columns (migration 20260409)
Added to `profiles` table:
```sql
stripe_customer_id      TEXT UNIQUE
stripe_subscription_id  TEXT UNIQUE
subscription_status     TEXT DEFAULT 'inactive'  -- inactive | active | past_due | canceled | unpaid
current_period_end      TIMESTAMPTZ
```

### Offline conversion tables (migration 20260406)
```sql
offline_conversion_configs  (id, organization_id [UNIQUE], capi_provider_id [FK capi_providers],
                              google_customer_id, conversion_action_id, conversion_action_name,
                              column_mapping JSONB, default_currency, default_conversion_value,
                              status, error_message, created_at, updated_at)

offline_conversion_uploads  (id, organization_id, config_id, filename, file_size_bytes,
                              row_count_total, status, row_count_valid, row_count_invalid,
                              row_count_duplicate, row_count_uploaded, row_count_rejected,
                              validation_summary JSONB, upload_result JSONB, error_message,
                              uploaded_by, created_at, validated_at, confirmed_at,
                              processing_started_at, completed_at, updated_at)

offline_conversion_rows     (id, upload_id, organization_id, row_index,
                              raw_email, raw_phone, raw_gclid,    -- nulled by purge_raw_pii() post-upload
                              hashed_email, hashed_phone,         -- retained permanently
                              conversion_time, conversion_value, currency, order_id,
                              status, validation_errors JSONB, validation_warnings JSONB,
                              google_error_code, google_error_message, uploaded_at, created_at)
```

**RLS is enabled on every table.** All new tables MUST use the `organization_id = auth.uid()` pattern.

---

## Backend API Routes

| Route prefix | File | Key endpoints |
|---|---|---|
| `/api/admin` | admin.ts | GET /me, /stats, /users, /alerts; PATCH /users/:id/plan |
| `/api/audit` | audit.ts | POST /start, /start-from-journey; GET /:id, /report, /gaps; POST /:id/export |
| `/api/auth` | auth.ts | POST /signup, /forgot-password |
| `/api/billing` | billing.ts | POST /checkout, /portal, /webhook; GET /status |
| `/api/capi` | capi.ts | GET /providers, /:id; POST /providers, /:id/activate, /:id/test, /process; DELETE /:id |
| `/api/channels` | channels.ts | GET /sessions, /diagnostics; POST /ingest-session |
| `/api/checklist` | checklist.ts | GET /checklist; POST /mark-complete |
| `/api/clients` | clients.ts | Full CRUD + generate/deploy/audit |
| `/api/consent` | consent.ts | GET /config; POST /record, /process; PUT /config |
| `/api/dashboard` | dashboard.ts | GET /summary |
| `/api/developer` | developer.ts | GET /share/:token; POST /quick-check, /page-summary |
| `/api/exports` | exports.ts | POST /audit/:auditId/pdf; POST /signals/inventory |
| `/api/health` | health.ts | GET /score, /alerts, /history |
| `/api/journeys` | journeys.ts | Full CRUD + spec generation |
| `/api/offline-conversions` | offlineConversions.ts | GET /config, /history, /upload/:id; POST /upload, /upload/:id/confirm, /upload/:id/cancel; GET /conversion-actions, /template |
| `/api/organisations` | organisations.ts | Full CRUD + member management |
| `/api/planning` | planning.ts | POST /sessions, /detect, /rescan, /generate; GET /sessions, /:id, /outputs |
| `/api/readiness` | readiness.ts | GET /score, /breakdown, /checklist |
| `/api/schedules` | schedules.ts | Full CRUD for scheduled audits |
| `/api/signals` | signals.ts | Full CRUD for signals and packs + deploy |

---

## Key Technical Decisions

1. **Vite + React 19, not Next.js** — frontend is a pure SPA with React Router v6. No server components. No `app/api/` directory.
2. **Express.js backend** — all API logic lives in `backend/src/`. Not Supabase Edge Functions.
3. **Bull + Redis for async jobs** — audit simulation, CAPI event delivery, and offline conversion uploads all run as Bull jobs. Workers are in `backend/src/services/queue/worker.ts`.
4. **Credentials encrypted at rest** — `capi_providers.credentials` uses AES-256-GCM via `@noble/ciphers`. Never log or expose decrypted credentials.
5. **No PII in job payloads** — Bull queue payloads contain only IDs (e.g. `upload_id`, `organization_id`). Raw PII is only in the DB during the validation review window, then nulled by `purge_raw_pii()`.
6. **Provider adapter pattern** — `CAPIProviderAdapter` interface in `frontend/src/lib/capi/adapters/types.ts`. All providers implement it. Never put Meta-specific or Google-specific logic in the core pipeline.
7. **Cross-upload dedup** — `offline_conversion_rows` has indexes on `hashed_email` and `order_id` for fast cross-upload duplicate detection.
8. **Google Offline CAPI** — uses `uploadClickConversions` endpoint (not `conversionAdjustments`). 2,000-row batches, 1s inter-batch delay, 3 retries with exponential backoff (30s/60s/120s). Reuses `capi_providers` Google OAuth credentials.
9. **Supabase for everything** — no separate DuckDB. All tables in Supabase PostgreSQL.
10. **Claude API for AI features** — planning mode AI analysis and audit interpretation use `@anthropic-ai/sdk`. Default to the latest capable model (currently `claude-sonnet-4-6`).
11. **Stripe billing** — Checkout Sessions and Billing Portal only (no Elements). Frontend sends `{ plan: 'pro'|'agency' }`, backend resolves price ID from `STRIPE_PRICE_PRO`/`STRIPE_PRICE_AGENCY` env vars. Webhook handler mounted with `express.raw()` **before** `express.json()` in `app.ts`.
12. **Plan hierarchy** — `free (0) < pro (1) < agency (2)`. Enforced by `planGuard(minPlan)` middleware on backend routes and `<PlanGate minPlan="...">` wrapper on frontend. Super admins bypass both.
13. **Super admin** — declared via `SUPER_ADMIN_EMAILS` (comma-separated, distinct from `ADMIN_EMAILS` which gates the `/api/admin` panel). Sets `req.user.isSuperAdmin = true` in `authMiddleware`. No Stripe customer created.
14. **Login page** — split-screen enterprise layout (left 7/12 navy gradient panel, right 5/12 white form). Uses Material Symbols Outlined font. Three modes: signin / signup / forgot. All auth logic via Supabase `signInWithPassword` and `/api/auth/*` endpoints.

---

## Implementation Rules

### Must Follow
1. **New tables** → `supabase/migrations/` as numbered `.sql` files. RLS required on every table.
2. **Credentials encryption** — provider tokens encrypted. Use `@noble/ciphers` AES-256-GCM.
3. **No PII in logs or queue payloads** — never log unhashed email, phone, or personal data.
4. **Consent-first** — every event must carry consent state. No data processing without consent validation.
5. **shadcn/ui** — use existing Radix UI / shadcn components. Add new ones via `npx shadcn add [component]`.
6. **Zod validation** — all API request/response bodies validated with Zod schemas in the backend.
7. **Error boundaries** — wrap new pages in React error boundaries.
8. **Loading states** — every async operation shows a loading indicator (shadcn Skeleton or spinner).

### Code Style
- TypeScript strict mode (`noUnusedLocals: true`, `noUnusedParameters: true` — enforced by Vercel build)
- Build command: `tsc && vite build` — `tsc` runs first. Unused imports = build failure.
- Functional React components only. No class components.
- `'use client'` not applicable (not Next.js) — all components are client-side by default.
- Database queries via Supabase JS client in `backend/src/services/database/` query modules.
- Zustand for client state. No React Query or SWR currently.
- API responses follow consistent `{ data, error, message }` shape.

### Testing
- Unit tests: PII hashing, provider adapter payload formatting (critical path)
- Integration tests: consent → CAPI pipeline, CSV validation pipeline
- E2E: setup wizard flows, upload flow
- Test runner: Vitest (both frontend and backend)

---

## Active Development Branch

Current feature branch: `claude/integrate-stripe-payments-TQKdo`

### Stripe Payments — Implementation Status
- ✅ **Sprint 1** — DB migration, Stripe client singleton, subscriptionService, billing routes
- ✅ **Sprint 2** — Frontend billingApi, billingStore, SettingsPage billing UI, BillingSuccessPage, BillingCancelPage
- ✅ **Sprint 3** — planGuard middleware, PlanGate component, plan gates applied to planning/schedules/CAPI/offline conversions routes
- ✅ **Super Admin** — SUPER_ADMIN_EMAILS env var, isSuperAdmin flag in authMiddleware, billing-exempt full access
- ✅ **Login page redesign** — split-screen enterprise layout with Material Symbols, glass-panel CSS, fixed accent stripe

### Offline Conversions — Implementation Status
- ✅ **Sprint 1** — DB migration, TypeScript types, Zustand store, adapter utilities
- ✅ **Sprint 2** — Backend pipeline: CSV validator, Google upload service, API routes, Bull worker
- ✅ **Sprint 3** — Frontend wizard (5 steps), `OfflineConversionsTab`, CAPI page two-tab layout
- ✅ **Sprint 4** — Upload flow UI: `UploadArea`, `ValidationReview`, `UploadProgress`, `UploadResults`, `UploadHistory`
- ⬜ **Sprint 5** — Unit/integration tests + security hardening (pending)

### Offline Conversions Upload Status Lifecycle
```
pending → validating → validated → confirmed → uploading → completed
                                                          → partial
                                                          → failed
                                                          → cancelled
```

---

## Reference Documents

- `docs/ATLAS_Offline_Conversion_Upload_PRD.md` — Offline conversions feature PRD
- `docs/atlas-prd-consent-capi.docx` — Consent + Realtime CAPI PRD (Sections 6, 7, 13, 14 for data models and API specs)
