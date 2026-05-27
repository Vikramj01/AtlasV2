# CLAUDE.md — Atlas V2

## Project Overview

Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.vimi.digital.

---

## Features

- **Journey Builder** — Multi-step wizard generating GTM container JSON (client + server-side). Business types: ecommerce, lead_gen, b2b_saas, marketplace, nonprofit, **b2b_lead_gen** (7-stage B2B template). Journey stages carry `proxy_value_gbp` (monetary value for value-based bidding) and `buyer_intent_level` (problem_aware / solution_aware / vendor_aware).
- **AI Planning Mode** — Browserbase/Playwright site scan → Claude analysis → tagging recommendations, PII detection, GTM container + implementation guide. Implementation guide includes GCLID/UTM cookie capture, hidden form fields, CRM mapping, and Enhanced Conversions for Leads guidance. Approved recommendations save to the Signal Library via `POST /sessions/:id/save-to-library`.
- **Signal Library** — Accessible at `/signals`. `signals` + `signal_packs` tables with system and org-scoped custom signals. Per-event specs, platform mappings, composable packs with deployment wizard.
- **Conversion Strategy Gate** — Multi-objective wizard at `/planning/strategy`. Claude produces CONFIRM/AUGMENT/REPLACE verdicts with measurement governance tier (primary/secondary/suppression), platform-specific action types, and OCI nudge for CRM-stage events. PDF brief export + web view at `/strategy/briefs/:id`. Brief must be locked before site scan.
- **Platform Connections** — OAuth connections to Google Ads (manager/child/standalone), Meta, GA4, and GTM. Encrypted tokens (AES-256-GCM). Supports account discovery under manager connections.
- **Platform Reconciliation** — Config + volume + delivery diff runs against connected platforms. Findings tracking with severity, tolerance config per client, daily event stats time-series. Triggered manually or post-brief-lock.
- **Implementation Health Checks (IHC)** — GTM container snapshots (OAuth or manual upload), tag configuration rule checks, baseline management, drift detection across crawl runs, alert preferences.
- **Data Quality Monitoring (DQM)** — GTG path health probes (HTTP status/latency), DMA poll state tracking, success rate + match rate monitoring.
- **Bid Signal Enricher** — Multi-destination Customer Match audience push (Google DMA). Match-rate telemetry, enricher run history, agency-plan Data Manager Console aggregating DMA state across clients.
- **Signal Tracking Dashboard** — CAPI event log with aggregate cards (volume, match quality, dedup rate), paginated event list with filters, async CSV export via Bull queue.
- **Event Taxonomy** — System + org-custom event tree with platform mappings. Full-text search, nested category structure.
- **Naming Conventions** — Org-level event/param naming rules with real-time validation and preview of how existing signals rename.
- **Crawl Signal Extractor (CSE)** — Subscription-gated automated site scan discovering and health-scoring tracking signals. Results at `/crawl/:runId` with real-time polling. Crawl runs can be promoted to IHC baselines.
- **Usage Logging & Operator Monitoring** — Per-org usage event logging, Browserbase nightly reconciliation, operator alerts via email/Slack.
- **Audit Engine** — Headless browser journey simulation, gap classification, scored PDF reports.
- **Health Dashboard** — Live health score (includes `platform_acceptance_score`, `gtg_active`, `dma_coverage_score`), alert feed, historical trend.
- **Channel Insights** — Session ingestion + diagnostic engine mapping signal behaviour per channel.
- **Consent Integration Hub** — JS consent banner + CMP sync (OneTrust, Cookiebot, Usercentrics). Google Consent Mode v2.
- **Realtime CAPI** — Meta CAPI, Google Enhanced Conversions, LinkedIn CAPI (TikTok stub). SHA-256 PII hashing, deduplication, consent gating. `capi_events` tracks `match_quality_score`, `latency_ms`, `payload`.
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
| **Queue** | Bull + Upstash Redis (TLS, `rediss://`) |
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
│   │   ├── admin/        # Admin panels
│   │   ├── audit/        # AuditHistoryTable, AuditProgressSteps, RunAuditForm, ReportPages/*
│   │   ├── capi/         # ProviderList, SetupWizard, CAPIMonitoringDashboard, EMQEstimator
│   │   │   ├── offline/  # OfflineConversionsTab, UploadArea, ValidationReview, UploadHistory
│   │   │   └── steps/    # Realtime wizard steps
│   │   ├── channels/     # ChannelHealthIndicator, ChannelOverviewTable, DiagnosticCard
│   │   ├── common/       # ErrorBoundary, PlanGate, HealthBadge, ScoreCard, SkeletonCard
│   │   ├── connections/  # ConnectionSetup, OAuthFlow, AccountSelector, ConnectionCard
│   │   ├── consent/      # ConsentSettings, BannerConfigurator, CMPIntegration
│   │   ├── crawl/        # CrawlProgress, CrawlResults
│   │   ├── dashboard/    # Dashboard views
│   │   ├── developer/    # Developer portal components
│   │   ├── health/       # Health dashboard components
│   │   ├── journey/      # JourneyWizard, StageCard, Step1–4
│   │   ├── layout/       # AppLayout, ProtectedRoute, Sidebar, TopBar
│   │   ├── organisation/ # ClientCard, ClientSetupWizard, MemberManagement, OrgSwitcher
│   │   ├── planning/     # AnnotatedScreenshot, GTMContainerPreview, RecommendationCard, Step1–7
│   │   ├── reconciliation/ # ReconciliationFindings, FindingCard, DiffViewer
│   │   ├── signals/      # SignalCard, PackCard, DeploymentWizard
│   │   ├── strategy/     # StrategyGateBanner, StrategyGateGuard, Step1Define, Step2Verdict,
│   │   │                 # ObjectivesList, BriefLocked
│   │   └── ui/           # shadcn/ui primitives
│   ├── lib/
│   │   ├── api/          # adminApi, auditApi, billingApi, capiApi, channelApi, checklistApi,
│   │   │                 # connectionApi, consentApi, crawlApi, dashboardApi, dataManagerApi,
│   │   │                 # developerApi, enricherApi, exportApi, healthApi, ihcApi,
│   │   │                 # journeyApi, offlineConversionsApi, organisationApi, planningApi,
│   │   │                 # proxyEventApi, readinessApi, reconciliationApi, scheduleApi,
│   │   │                 # signalApi, signalEventsApi, strategyApi, taxonomyApi
│   │   ├── capi/         # adapters/ (meta, google, google-offline, linkedin, tiktok stub)
│   │   ├── consent/      # banner-generator.ts, cmp-listeners.ts, consent-engine.ts, gcm-mapper.ts
│   │   └── shared/       # crypto.ts
│   ├── pages/            # HomePage, LoginPage, DashboardPage, AdminPage,
│   │                     # AuditProgressPage, ReportPage, GapReportPage,
│   │                     # JourneyBuilderPage, JourneySpecPage,
│   │                     # PlanningDashboard, PlanningModePage,
│   │                     # SignalLibraryPage, SignalPacksPage, PackDetailPage,
│   │                     # SignalTrackingDashboard,
│   │                     # StrategyPage, StrategyBriefPage (/strategy/briefs/:id),
│   │                     # CrawlStatusPage (/crawl/:runId),
│   │                     # ConnectionsPage, ClientConnectionsPage, ClientDetailPage,
│   │                     # ReconciliationPage, ReconciliationRunDetailPage,
│   │                     # ImplementationHealthPage,
│   │                     # EnricherPage, DataManagerConsolePage,
│   │                     # DeveloperPortalPage, OrgDashboardPage, OrgSettingsPage,
│   │                     # ConsentPage, CAPIPage, HealthDashboardPage,
│   │                     # ChannelInsightsPage, ClientListPage,
│   │                     # SettingsPage, BillingSuccessPage, BillingCancelPage, ResetPasswordPage
│   ├── store/            # auditStore, billingStore, capiStore, connectionStore, consentStore,
│   │                     # crawlStore, dashboardStore, journeyWizardStore,
│   │                     # offlineConversionsStore, organisationStore, planningStore,
│   │                     # reconciliationStore, signalStore, strategyStore, taxonomyStore
│   └── types/            # audit, capi, channel, connections, consent, crawl, dashboard,
│                         # health, ihc, journey, offline-conversions, organisation, planning,
│                         # schedule, signal, signal-tracking, strategy, taxonomy, usage
│
├── backend/src/
│   ├── api/
│   │   ├── middleware/   # authMiddleware, planGuard, rateLimiter, planningLimiter, errorHandler
│   │   └── routes/       # admin, audits, auth, billing, capi, channels, checklist, clients,
│   │                     # connections, consent, crawl, dashboard, dataManager, developer,
│   │                     # dqm, enricher, exports, gtm, health, ihc, journeys,
│   │                     # namingConventions, offlineConversions, organisations, planning,
│   │                     # readiness, reconciliation, schedules, signalEvents, signals,
│   │                     # strategy, taxonomy
│   └── services/
│       ├── database/     # supabase.ts + one query module per feature area (28 modules)
│       ├── planning/     # sessionOrchestrator, siteDetectionService, pageCaptureService,
│       │                 # aiAnalysisService, piiDetectionService, changeDetectionService,
│       │                 # generators/ (prompts, renderer, validator)
│       ├── reconciliation/ # reconciliationRunner; engine/ (configDiff, volumeDiff,
│       │                   # deliveryDiff, alignmentDiff, findingWriter);
│       │                   # sync/ (ga4Sync, googleAdsSync, metaSync + stats syncs)
│       ├── connections/  # connectionTester, tokenManager, connectionLifecycle;
│       │                 # discovery/ (ga4, meta, googleAds); oauthFlows/ (ga4, meta, googleAds)
│       ├── ihc/          # tagConfigurationRules, ruleInterpretations, alertService,
│       │                 # baselineManager, findingsWriter
│       ├── dqm/          # dqmOrchestrator, dmaPolling
│       ├── enricher/     # enricherService
│       ├── scoring/      # scoring engine
│       ├── strategy/     # evaluationPrompt.ts, briefPdfGenerator.ts
│       ├── crawl/        # crawlJob.ts, pageDiscovery.ts, signalDetector.ts, signalWriter.ts
│       ├── usage/        # usageLogger.ts, alertDelivery.ts, claudeClient.ts
│       ├── capi/         # credentials.ts, pipeline.ts, googleDelivery.ts, metaDelivery.ts,
│       │                 # linkedinDelivery.ts, dedupStore.ts, customerMatch.ts
│       ├── gtm/          # GTM container ingestion services
│       ├── queue/        # jobQueue.ts (Bull), worker.ts
│       └── [others]/     # audit/, browserbase/, channels/, health/, journey/, stripe/,
│                         # signals/, export/, reporting/, developer/
│
└── supabase/migrations/  # 47 migrations (20260317 → 20260620)
```

---

## Supabase Schema

**RLS enabled on every table. New tables use `organization_id = auth.uid()`. Some newer tables use `org_id` — match the column name to the pattern in that migration file.**

```sql
-- Core
organizations      (id, name, type, plan, created_at)
profiles           (id, organization_id, full_name, role,
                    stripe_customer_id, stripe_subscription_id,
                    subscription_status, current_period_end, created_at)
clients            (id, organization_id, name, website_url, industry, created_at)
organisation_members (id, organisation_id, user_id, role, ...)
planning_sessions  (id, user_id, site_url, business_type, status, created_at)
planning_pages     (id, session_id, url, page_type, scan_status, page_capture, ai_analysis, created_at)
planning_recommendations (id, session_id, page_id, element_reference, selector,
                           recommendation_type, event_name, action_type, approved, ...)

-- Consent & CAPI (20260317)
consent_configs, consent_records
capi_providers     (credentials JSONB — AES-256-GCM encrypted)
capi_events        (+ match_quality_score, latency_ms, payload added in 20260620)
capi_event_queue

-- Channels (20260325)
channel_sessions, channel_session_events, channel_journey_maps, channel_diagnostics

-- Offline Conversions (20260406 + 20260408)
offline_conversion_configs, offline_conversion_uploads
offline_conversion_rows  (raw PII nulled post-upload, hashed_email, hashed_phone, gclid, ...)

-- Event Taxonomy (20260410)
event_taxonomy     (id, slug, name, description, category, platform_mappings JSONB, is_system, ...)

-- Strategy Gate (20260420 + 20260421 + 20260605)
strategy_briefs        (id, organization_id, client_id, mode ['single'|'multi'],
                         brief_name, version_no, locked_at, superseded_by, ...)
strategy_objectives    (id, brief_id, organization_id, name, platforms TEXT[],
                         verdict ['CONFIRM'|'AUGMENT'|'REPLACE'],
                         recommended_primary_event, recommended_proxy_event,
                         conversion_tier ['primary'|'secondary'|'suppression'],
                         platform_action_types JSONB, locked, locked_at, ...)
strategy_objective_campaigns (id, objective_id, platform, campaign_name, budget, ...)

-- Journey Builder (20260602–20260604 + 20260613)
journey_stages     (..., proxy_value_gbp numeric, buyer_intent_level text,
                    timing_metadata JSONB)
journey_client_link (journey_id, client_id)

-- Usage & Billing (20260520–20260522)
usage_events       (event_type: page_scan | ai_report_* | ai_query_* | dma_ingest_event | dma_enricher_event)
org_subscriptions, browserbase_usage_snapshots

-- Crawl Signal Extractor (20260530)
crawl_runs         (+ is_baseline bool for IHC)
crawl_pages, detected_signals, org_page_scope

-- Proxy Event Library (20260601)
proxy_event_library (id, organization_id, event_name, proxy_value_gbp, ...)

-- Platform Connections (20260606 + 20260607 + 20260608)
platform_connections   (id, organization_id, client_id, platform ['google_ads'|'meta'|'ga4'|'gtm_destinations'],
                         connection_type ['manager'|'child'|'standalone'],
                         parent_connection_id, account_id, account_label,
                         oauth_tokens TEXT (AES-256-GCM encrypted), status, last_synced_at, metadata)
platform_state_cache   (connection_id, cache_key, data JSONB, ...)
platform_event_stats_daily (connection_id, date, event_name, platform_count,
                              atlas_count, delta_pct, quality_signals JSONB)
volume_tolerance_configs   (client_id, platform, event_name, tolerance_pct, ...)

-- Reconciliation (20260607)
reconciliation_runs    (id, organization_id, client_id, brief_id, run_type, status,
                         platforms_run TEXT[], total_findings, ...)
reconciliation_findings (id, run_id, dimension ['config'|'volume'|'delivery'|'alignment'],
                          severity, event_name, platform, description, resolved_at, ...)

-- Implementation Health (20260610)
gtm_container_connections  (id, organization_id, client_id, property_id, container_id,
                              auth_method ['oauth'|'manual_upload'],
                              oauth_credentials_encrypted TEXT, last_synced_at, ...)
gtm_container_snapshots    (id, connection_id, container_json JSONB, snapshot_at, ...)
ihc_alert_preferences      (org_id, severity_threshold, notification_channels JSONB, ...)
audit_findings             (id, organization_id, run_id, rule_id, severity, event_name,
                              description, ihc_drift_count, ...)

-- DQM (20260615)
dqm_gtg_checks     (org_id, gtag_url, http_status, response_ms, check_status, checked_at)
dqm_dma_poll_state (org_id UNIQUE, last_polled_at, upload_success_rate, avg_match_rate,
                     total_members_30d, destination_count, error_categories JSONB, backoff_until)

-- Enricher / Customer Match (20260611 + 20260612)
audience_member_uploads (org_id, customer_id, operation_type, status, record_count,
                          matched_count, dma_response JSONB, ...)
enricher_runs           (org_id, ingest_type, destinations JSONB, operation_type, status,
                          record_count, matched_count, match_rate, dma_response JSONB, ...)

-- Signal Library (20260619)
signals            (id, organisation_id, key, name, category, is_system, is_custom,
                    required_params JSONB, optional_params JSONB, platform_mappings JSONB,
                    taxonomy_event_id, version, ...)
signal_packs       (id, organisation_id, name, description, is_system, ...)
signal_pack_signals (pack_id, signal_id)
deployments        (id, organisation_id, signal_id, client_id, status, ...)

-- Signal Tracking Dashboard (20260620)
mv_signal_aggregates_daily  (materialized view — org/provider/event aggregates)
signal_export_jobs  (id, organization_id, status, filters JSONB, storage_path,
                     download_url, expires_at, ...)

-- Health (extended across phases)
health_scores      (+ platform_acceptance_score, gtg_active, dma_coverage_score)
health_snapshots   (+ platform_acceptance_score)
```

---

## Backend API Routes

| Route | File | Key endpoints |
|---|---|---|
| `/api/admin` | admin.ts | GET /me, /stats, /users; PATCH /users/:id/plan |
| `/api/audit` | audits.ts | POST /start; GET /:id, /report, /gaps |
| `/api/billing` | billing.ts | POST /checkout, /portal, /webhook; GET /status |
| `/api/capi` | capi.ts | CRUD providers + /activate, /test, /process |
| `/api/channels` | channels.ts | GET /sessions, /diagnostics; POST /ingest-session |
| `/api/clients` | clients.ts | Full CRUD + generate/deploy/audit |
| `/api/connections` | connections.ts | GET /; OAuth start+callback; POST /:id/discover, /connect, /disconnect, /test; DELETE /:id |
| `/api/consent` | consent.ts | GET /config; POST /record, /process; PUT /config |
| `/api/crawl` | crawl.ts | POST /trigger, /seed-pages; GET /runs, /run/:id, /page-scope |
| `/api/data-manager` | dataManager.ts | GET /clients-summary (agency only) |
| `/api/dqm` | dqm.ts | GET /status |
| `/api/enricher` | enricher.ts | POST /runs; GET /runs |
| `/api/exports` | exports.ts | POST /audit/:id/pdf; POST /signals/inventory |
| `/api/gtm` | gtm.ts | POST /connect, /upload; GET /callback, /containers; DELETE /containers/:id |
| `/api/health` | health.ts | GET /score, /alerts, /history |
| `/api/ihc` | ihc.ts | GET /findings, /findings/summary, /baseline; POST /baseline |
| `/api/journeys` | journeys.ts | Full CRUD + spec generation |
| `/api/naming-convention` | namingConventions.ts | GET/PUT /; POST /validate, /preview |
| `/api/offline-conversions` | offlineConversions.ts | POST /upload, /upload/:id/confirm; GET /config, /history |
| `/api/organisations` | organisations.ts | Full CRUD + member management |
| `/api/planning` | planning.ts | POST /sessions, /detect, /rescan, /generate; GET /sessions, /:id; POST /sessions/:id/save-to-library |
| `/api/reconciliation` | reconciliation.ts | GET /runs, /runs/:id, /runs/:id/findings, /tolerance, /stats; PATCH /findings/:id/resolve; POST /trigger; PUT /tolerance |
| `/api/signal-events` | signalEvents.ts | GET /, /aggregates, /:event_id; POST /export; GET /export/:job_id |
| `/api/signals` | signals.ts | Full CRUD + deploy |
| `/api/strategy` | strategy.ts | POST/GET /briefs; CRUD /briefs/:id + /lock, /export/pdf; CRUD /objectives/:id + /evaluate, /lock, /campaigns |
| `/api/taxonomy` | taxonomy.ts | GET /tree, /events, /search, /platform-mapping/:id/:platform, /:id; POST /event, /category; PUT/DELETE /:id |

---

## Key Technical Decisions

1. **Vite + React 19, not Next.js** — pure SPA, React Router v6, no server components.
2. **Express.js backend** — all API logic in `backend/src/`. Not Supabase Edge Functions.
3. **Bull + Redis** — audits, CAPI delivery, offline uploads, signal CSV exports run as Bull jobs.
4. **Credentials encrypted at rest** — `capi_providers.credentials`, `platform_connections.oauth_tokens`, and `gtm_container_connections.oauth_credentials_encrypted` all use AES-256-GCM via `@noble/ciphers`. Never log decrypted credentials.
5. **No PII in job payloads** — queue payloads contain only IDs. Raw PII nulled post-upload.
6. **Claude API calls are backend-only** — `ANTHROPIC_API_KEY` never exposed to the browser.
7. **Stripe billing** — Checkout Sessions and Billing Portal only. Webhook handler uses `express.raw()` mounted before `express.json()`.
8. **Plan hierarchy** — `free < pro < agency`. `planGuard(minPlan)` on backend, `<PlanGate minPlan="...">` on frontend. Super admins bypass both.
9. **Migration guards** — `ALTER TABLE` on optional tables must be wrapped in `DO $$ IF EXISTS (SELECT FROM pg_tables ...) THEN ... END IF; END $$` to survive Supabase preview environments.
10. **org_id resolution** — `req.user` carries only `id`, `email`, `plan`, `isSuperAdmin`. Resolve `organization_id` via `supabaseAdmin.from('profiles').select('organization_id').eq('id', userId)`. Note: some newer tables use `org_id` column (enricher_runs, dqm_*, audience_member_uploads) — match the column name used in that migration.
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

`claude/eager-johnson-883G1`

---

## Completed Sprints (summary)

| Sprint | What shipped |
|---|---|
| Stripe Payments | DB migration, Stripe client, billing routes, planGuard, PlanGate, super admin |
| Offline Conversions | DB migration, CSV validator, Google upload pipeline, Bull worker, 5-step UI wizard, Meta support |
| Strategy Gate 1.6 | Multi-objective data model, Claude eval, PDF brief, governance tier + platform action types, OCI nudge |
| CSE 1–4 | crawl_runs/pages/detected_signals schema, Browserbase signal detector, crawl API, CrawlStatusPage |
| Usage & Monitoring | usage_events, org_subscriptions, browserbase_usage_snapshots, operator alerts |
| B2B Journey Template | b2b_lead_gen type, 7-stage template, proxy_value_gbp + buyer_intent_level, timing metadata |
| GCLID Capture | GCLID/UTM cookie script, hidden form fields, CRM field mapping, Enhanced Conversions for Leads in implementation guide |
| Signal Library | signals/signal_packs/deployments tables, system events, Planning Mode save-to-library bridge |
| Platform Connections | platform_connections table, OAuth flows (Google Ads/Meta/GA4), manager/child/standalone, account discovery |
| Platform Reconciliation | reconciliation_runs/findings, config+volume+delivery+alignment diffs, tolerance config, daily stats sync |
| GTM Integration | gtm_container_connections, OAuth + manual upload, container snapshots |
| IHC | tag config rules, baseline promotion (crawl_runs.is_baseline), drift detection, alert preferences |
| DQM | dqm_gtg_checks, dqm_dma_poll_state, GTG path probes, DMA poll state monitoring |
| Bid Signal Enricher | Customer Match push, audience_member_uploads, enricher_runs, match-rate telemetry, Data Manager Console (agency) |
| Signal Tracking Dashboard | CAPI event log + aggregates, capi_events extensions, mv_signal_aggregates_daily, async CSV export |
| Event Taxonomy | event_taxonomy tree, system + custom events, platform mappings, full-text search |
| Naming Conventions | org naming rules, real-time validation, rename preview |
| LinkedIn CAPI | Full LinkedIn delivery (previously stub) |
| Integration Tests | Backend route integration test suite (37 routes × test files) |
