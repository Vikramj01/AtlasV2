# CLAUDE.md — Atlas V2

## Project Overview

Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.vimi.digital.

---

## Features

- **Journey Builder** — Multi-step wizard generating GTM container JSON. Business types incl. `b2b_lead_gen` (7-stage template); stages carry `proxy_value_gbp` + `buyer_intent_level`.
- **AI Planning Mode** — Browserbase/Playwright scan → Claude analysis → tagging recommendations, PII detection, GTM container + implementation guide (GCLID/UTM capture, CRM mapping, Enhanced Conversions for Leads). Approved recommendations save to the Signal Library.
- **Signal Library** (`/signals`) — System + org-custom signals, composable packs, deployment wizard.
- **Signal Enrichment Configuration** — Per-client identity mapping + per-deployment signal field mapping, composite 0–100 score, 12-rule validation engine, injected into the CAPI pipeline (non-fatal). Configured via `IdentityConfigStep` (ClientSetupWizard/ClientDetailPage) and `SignalEnrichmentStep` (DeploymentWizard).
- **Conversion Strategy Gate** (`/planning/strategy`) — Multi-objective wizard; Claude verdicts (CONFIRM/AUGMENT/REPLACE) with governance tier + platform action types. PDF/web brief. Enforced as a dismissible frontend nudge (`StrategyGateGuard`) — the backend `strategyGate` middleware is a pass-through.
- **Platform Connections** — OAuth to Google Ads/Meta/GA4/GTM (manager/child/standalone), AES-256-GCM encrypted tokens, account discovery.
- **Platform Reconciliation** — Config/volume/delivery diffs against connected platforms, severity-tracked findings, per-client tolerance config.
- **Implementation Health Checks (IHC)** — GTM container snapshots, tag config rule checks, baseline + drift detection, alert preferences.
- **Data Quality Monitoring (DQM)** — GTG path health probes, DMA poll state, success/match rate monitoring.
- **Bid Signal Enricher** — Customer Match audience push (Google DMA), match-rate telemetry, agency-plan Data Manager Console.
- **Shopify Acquisition Channel** — Public Shopify App; install with no prior Atlas account, shadow Supabase Auth user provisioning auto-creates a full org via the existing `handle_new_user()` trigger; storefront ScriptTag auto-captures gclid/fbclid/wbraid/gbraid into order `note_attributes`; order/refund webhooks staged (`shopify_webhook_events`) then routed through a consent-gate-free `processServerSourcedEvent()` CAPI path (no live browser session to have captured real consent from); unauthenticated `/shopify/welcome` claim-your-account page.
- **Refund/Return Feedback** — `refund_events` tracking (Shopify webhook or manual `POST /api/refunds`); Google Ads gets automatic Customer Match audience removal plus a manual Conversion Adjustments CSV (`RESTATEMENT` w/ absolute `new_conversion_value` for partial refunds, `RETRACTION` for full); Meta is logged-only (no reversal API exists). `RefundsTab` in the CAPI Monitoring Dashboard.
- **Server-Side GTM (sGTM) Detection & Monitoring** — endpoint reachability verification (`client_platforms.is_verified`), per-client DQM health probe (`dqm_sgtm_checks`), IHC drift rule `SGTM_ROUTING_NOT_CONFIGURED`. Tag generation (routing GA4 traffic through the container) explicitly deferred pending GTM field-name verification.
- **Signal Tracking Dashboard** (`/signal-tracking`) — CAPI event log, filterable table, async CSV export, aggregate stat-card row (Total Signals / Avg Match Quality / Dedup Hit Rate / P95 Latency with period-over-period deltas).
- **Event Taxonomy** — System + org-custom event tree, platform mappings, full-text search. *(Backend route only — no frontend page yet.)*
- **Naming Conventions** — Org event/param naming rules, real-time validation + rename preview. *(Backend route only — no frontend page yet.)*
- **Crawl Signal Extractor (CSE)** — Subscription-gated site scan (`/crawl/:runId`); runs can be promoted to IHC baselines.
- **Usage Logging & Operator Monitoring** — Per-org usage logging, Browserbase nightly reconciliation, operator alerts (email/Slack).
- **Audit Engine** — Headless journey simulation, gap classification, scored PDF reports. Entry point is `EvaluateSiteCard` (Home + Dashboard); a bare-URL run can be linked to a client afterward (`audits.client_id` nullable).
- **Home Page** (`/`) — Branches on org existence: `FirstTimeSetup` vs `ReturningUserLanding` (`EvaluateSiteCard` / `QuickClientIntake`, `StatsRow`, `RecentActivityFeed`).
- **Operator Console Design System** — Orbitron/Rajdhani/JetBrains Mono type (`font-display`/`font-heading`/`font-mono`) + `console.*` Tailwind palette layered onto navy/severity tokens. Live across Sidebar, TopBar, OrgSwitcher, Home, main Dashboard, Signal Tracking Dashboard, and Planning Wizard Step 1. Sidebar nav is grouped into 7 sections (Workspace/Engine/Library/Implementation/Tracking/Advanced/Privacy); sidebar header is a plain "ATLAS" text wordmark — no icon mark (illegible at sidebar scale).
- **Health Dashboard** — Live health score, alert feed, historical trend.
- **Channel Insights** — Session ingestion + diagnostic engine.
- **Consent Integration Hub** — JS banner + CMP sync (OneTrust/Cookiebot/Usercentrics), Google Consent Mode v2.
- **Realtime CAPI** — Meta/Google/LinkedIn/TikTok CAPI, SHA-256 hashing, dedup, consent gating; new-vs-returning customer signal (Google Ads/GA4 via DMA `userProperties.customerType`, sourced from GTM cookie/dataLayer or Shopify `customer.orders_count`). TikTok Events API delivery (`tiktokDelivery.ts`) is wired into the pipeline, credential validation, and test-event flow; matches on hashed PII plus `ttclid` (captured alongside gclid/fbclid/wbraid/gbraid).
- **Offline Conversions** — CSV upload → Google Ads `uploadClickConversions`, async Bull queue, per-row error reporting.
- **Organisation & Client Management** — Multi-tenant workspace, org switching, member roles.
- **Billing & Subscriptions** — Stripe Checkout + Billing Portal. Plans: `free`/`pro`/`agency` via `planGuard`/`<PlanGate>`.

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
│   │   ├── admin/, audit/, capi/ (offline/, steps/, RefundsTab), channels/, connections/,
│   │   │   consent/, crawl/, developer/, health/, journey/, reconciliation/,
│   │   │   enrichment/, signals/, strategy/  — one folder per feature area
│   │   ├── common/       # ErrorBoundary, PlanGate, HealthBadge, ScoreCard, SkeletonCard, WizardStepper
│   │   ├── dashboard/    # DeltaHeader, OrgMetricsStrip, AlertFeed, ClientHealthList, RecentActivityFeed
│   │   ├── home/         # EvaluateSiteCard, NewClientCard, StatsRow, ReturningUserLanding, FirstTimeSetup
│   │   ├── layout/       # AppLayout, ProtectedRoute, Sidebar, TopBar
│   │   ├── organisation/ # ClientCard, ClientSetupWizard, MemberManagement, OrgSwitcher,
│   │   │                 # CreateOrgForm, QuickClientIntake
│   │   ├── planning/     # AnnotatedScreenshot, GTMContainerPreview, RecommendationCard, Step1–7
│   │   ├── signals/      # SignalCard, PackCard, DeploymentWizard, SignalFlowTable,
│   │   │                 # SignalFilterBar, SignalAggregateCards
│   │   └── ui/           # shadcn/ui primitives (incl. checkbox.tsx)
│   ├── lib/
│   │   ├── api/          # one *Api.ts module per feature area (adminApi, auditApi, capiApi,
│   │   │                 # signalEventsApi, strategyApi, enrichmentApi, ...)
│   │   ├── capi/         # adapters/ (meta, google, google-offline, linkedin, tiktok)
│   │   ├── consent/      # banner-generator.ts, cmp-listeners.ts, consent-engine.ts, gcm-mapper.ts
│   │   └── shared/       # crypto.ts
│   ├── hooks/            # useOrganisations
│   ├── pages/            # one *Page.tsx per route — Home, Dashboard, Audit/Report/Gap, Journey*,
│   │                     # Planning*, Signal*, Strategy*, Crawl*, Connections/Client*, Reconciliation*,
│   │                     # ImplementationHealth, Enricher, DataManagerConsole, Consent, CAPI,
│   │                     # HealthDashboard, ChannelInsights, Settings, Billing*, ResetPassword,
│   │                     # ShopifyWelcomePage
│   ├── store/            # one Zustand store per feature area
│   └── types/            # one .ts per feature area
│
├── backend/src/
│   ├── api/
│   │   ├── middleware/   # authMiddleware, planGuard, rateLimiter, planningLimiter, errorHandler
│   │   └── routes/       # one file per feature area — see Backend API Routes below
│   └── services/
│       ├── database/     # supabase.ts + one query module per feature area (28 modules)
│       ├── planning/     # sessionOrchestrator, siteDetectionService, pageCaptureService,
│       │                 # aiAnalysisService, piiDetectionService, changeDetectionService, generators/
│       ├── reconciliation/ # reconciliationRunner; engine/ (config/volume/delivery/alignmentDiff); sync/
│       ├── connections/  # connectionTester, tokenManager, connectionLifecycle; discovery/; oauthFlows/
│       │                 # (incl. shopifyOAuth.ts); shopify/ (shopifyClient.ts, shopifyProvisioning.ts,
│       │                 # shopifyCaptureScript.ts, shopifyWebhookVerify.ts)
│       ├── ihc/          # tagConfigurationRules, ruleInterpretations, alertService, baselineManager
│       ├── dqm/          # dqmOrchestrator, dmaPolling, sgtmProbe.ts
│       ├── enricher/     # enricherService
│       ├── enrichment/   # enrichmentConfigService.ts, enrichmentValidationRules.ts, __tests__/
│       ├── strategy/     # evaluationPrompt.ts, briefPdfGenerator.ts
│       ├── crawl/        # crawlJob.ts, pageDiscovery.ts, signalDetector.ts, signalWriter.ts
│       ├── usage/        # usageLogger.ts, alertDelivery.ts, claudeClient.ts
│       ├── capi/         # credentials.ts, pipeline.ts, googleDelivery.ts, metaDelivery.ts,
│       │                 # linkedinDelivery.ts, dedupStore.ts, customerMatch.ts, refundDelivery.ts,
│       │                 # shopifyOrderMapper.ts, shopifyRefundMapper.ts, shopifyCapiDelivery.ts,
│       │                 # shopifyWebhookIngest.ts
│       ├── gtm/, queue/ (jobQueue.ts, worker.ts), scoring/
│       └── [others]/     # audit/, browserbase/, channels/, health/, journey/, stripe/,
│                         # signals/, export/, reporting/, developer/
│
├── backend/src/integrations/google/  # dmaTypes.ts, dmaClient.ts, dmaEventBuilder.ts — Data
│                                      # Manager API client + schema. Verify against the live
│                                      # Discovery Document before trusting these types further
│                                      # (see Key Technical Decisions) — the schema has drifted
│                                      # materially from assumptions before.
│
└── supabase/migrations/  # 83 migrations (20260317 → 20260901)
```

---

## Supabase Schema

**RLS enabled on every table. New tables use `organization_id = auth.uid()`. Some newer tables use `org_id` — match the column name to the pattern in that migration file.**

Core: `organizations`, `profiles` (+ Stripe fields), `clients`, `organisation_members`, `planning_sessions`/`planning_pages`/`planning_recommendations`. `audits` predates `supabase/migrations/`; `client_id` (nullable FK) added 20260818 for after-the-fact linking.

Stable feature-area tables (one line each — see migration files for exact columns):
- **Consent & CAPI** (20260317): `consent_configs`, `consent_records`, `capi_providers` (encrypted credentials), `capi_events` (+ `match_quality_score`/`latency_ms`/`payload`), `capi_event_queue`.
- **Channels** (20260325): `channel_sessions`, `channel_session_events`, `channel_journey_maps`, `channel_diagnostics`.
- **Offline Conversions** (20260406/408): `offline_conversion_configs`, `offline_conversion_uploads`, `offline_conversion_rows` (raw PII nulled post-upload).
- **Event Taxonomy** (20260410): `event_taxonomy`.
- **Strategy Gate** (20260420/421/605): `strategy_briefs`, `strategy_objectives` (verdict/tier/action-types), `strategy_objective_campaigns`.
- **Journey Builder** (20260602–613): `journey_stages` (`proxy_value_gbp`, `buyer_intent_level`, `timing_metadata`), `journey_client_link`.
- **Usage & Billing** (20260520/522): `usage_events`, `org_subscriptions`, `browserbase_usage_snapshots`.
- **CSE** (20260530): `crawl_runs` (+ `is_baseline` for IHC), `crawl_pages`, `detected_signals`, `org_page_scope`.
- **Proxy Event Library** (20260601): `proxy_event_library`.
- **Health** (extended across phases): `health_scores`/`health_snapshots` (+ `platform_acceptance_score`, `gtg_active`, `dma_coverage_score`).

Actively-touched tables (fuller detail):
```sql
-- Platform Connections (20260606-608)
platform_connections   (id, organization_id, client_id, platform ['google_ads'|'meta'|'ga4'|'gtm_destinations'],
                         connection_type ['manager'|'child'|'standalone'], parent_connection_id, account_id,
                         oauth_tokens TEXT (AES-256-GCM encrypted), status, last_synced_at, metadata)
platform_state_cache, platform_event_stats_daily, volume_tolerance_configs

-- Reconciliation (20260607)
reconciliation_runs     (id, organization_id, client_id, brief_id, run_type, status, platforms_run TEXT[], ...)
reconciliation_findings (id, run_id, dimension ['config'|'volume'|'delivery'|'alignment'], severity, ...)

-- Implementation Health (20260610)
gtm_container_connections (auth_method ['oauth'|'manual_upload'], oauth_credentials_encrypted TEXT, ...)
gtm_container_snapshots, ihc_alert_preferences, audit_findings

-- DQM (20260615)
dqm_gtg_checks (org_id, gtag_url, http_status, response_ms, check_status, checked_at)
dqm_dma_poll_state (org_id UNIQUE, upload_success_rate, avg_match_rate, total_members_30d, backoff_until)

-- Enricher / Customer Match (20260611/612)
audience_member_uploads, enricher_runs (org_id, ingest_type, destinations JSONB, match_rate, dma_response JSONB)

-- Signal Library (20260619)
signals (id, organisation_id, key, name, category, is_system, required_params JSONB, platform_mappings JSONB, ...)
signal_packs, signal_pack_signals, deployments

-- Signal Tracking Dashboard (20260620)
mv_signal_aggregates_daily (materialized view), signal_export_jobs

-- Signal Enrichment (20260703)
signal_enrichment_configs (id, deployment_id, signal_key, value/currency/dedup/content_config JSONB,
                            meta/google/linkedin_enabled, validation_score, UNIQUE(deployment_id, signal_key))
client_identity_configs   (id, client_id UNIQUE, email/phone/name/postal/country/external_id_field,
                            fbc/fbp/gclid/wbraid/gbraid_field, auto_capture_ip/ua, enabled_identifiers TEXT[])
-- capi_providers extended: identity_config_id, enrichment_score, enrichment_validated_at

-- Refunds (20260831)
refund_events (org_id, client_id, original_transaction_id, refund_amount, currency, is_partial,
               new_conversion_value, hashed_email, hashed_phone,
               google_removal_status ['pending'|'removed'|'failed'|'skipped'], google_removal_error,
               adjustment_csv_generated_at, meta_status)

-- sGTM Detection & Monitoring (20260831)
client_platforms: is_verified BOOLEAN, verified_at added
dqm_sgtm_checks (org_id, client_id, transport_url, http_status, response_ms,
                  check_status ['pass'|'degraded'|'fail'|'timeout'|'error'], checked_at)

-- Shopify Acquisition Channel (20260901)
platform_connections.platform: widened to include 'shopify'
profiles: provisioning_source, claimed_at added
shopify_webhook_events (staging table, service-role-only RLS — keeps PII out of Bull job payloads)
shopify_compliance_requests (GDPR mandatory-webhook audit log, service-role-only RLS)

-- TikTok ttclid Capture (20260902)
client_identity_configs: ttclid_field TEXT NOT NULL DEFAULT 'ttclid' added
```

---

## Backend API Routes

| Route | File | Key endpoints |
|---|---|---|
| `/api/admin` | admin.ts | GET /me, /stats, /users; PATCH /users/:id/plan |
| `/api/audit` | audits.ts | POST /start (optional `client_id`); GET /:id, /report, /gaps; PATCH /:audit_id/link-client |
| `/api/billing` | billing.ts | POST /checkout, /portal, /webhook; GET /status |
| `/api/capi` | capi.ts | CRUD providers + /activate, /test, /process |
| `/api/channels` | channels.ts | GET /sessions, /diagnostics; POST /ingest-session |
| `/api/clients` *(actually mounted at `/api/organisations`, see below)* | clients.ts | Full CRUD + generate/deploy/audit + POST `/:orgId/clients/:clientId/platforms/sgtm/verify` |
| `/api/connections` | connections.ts | GET /; OAuth start+callback; POST /:id/discover, /connect, /disconnect, /test; DELETE /:id |
| `/api/consent` | consent.ts | GET /config; POST /record, /process; PUT /config |
| `/api/crawl` | crawl.ts | POST /trigger, /seed-pages; GET /runs, /run/:id, /page-scope |
| `/api/data-manager` | dataManager.ts | GET /clients-summary (agency only) |
| `/api/dqm` | dqm.ts | GET /status |
| `/api/enricher` | enricher.ts | POST /runs; GET /runs |
| `/api/enrichment` | enrichment.ts | GET /clients/:id/identity, /clients/:id/score; PUT /clients/:id/identity; POST /clients/:id/identity/validate, /deployments/:id/signals, /deployments/:id/signals/validate, /validate-field-path; GET /deployments/:id/signals |
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
| `/api/refunds` | refunds.ts | POST /; GET /; GET /:id/adjustment.csv |
| `/api/shopify` | shopifyApp.ts | Public, no authMiddleware — GET /install, /callback, /capture.js; POST /webhooks/orders-paid, /refunds-create, /app-uninstalled, /customers-data-request, /customers-redact, /shop-redact |
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
11. **shadcn/ui registry** — if `npx shadcn add` fails, install the Radix primitive directly and create the component manually (the Radix package is often already a dependency even when the wrapper isn't — check `package.json` first).
12. **Strategy Gate is a frontend nudge, not a backend block** — the `strategyGate` middleware (`backend/src/api/middleware/strategyGate.ts`) is a pass-through on its existing routes (`POST /api/planning/sessions`, client deploy); the brief requirement is enforced only via the dismissible `StrategyGateGuard` banner in the frontend.
13. **Operator console tokens over hardcoded hex** — new/touched frontend UI should use `console.*`/`severity.*`/`navy.*` Tailwind tokens and `font-display`/`font-heading`/`font-mono` (defined in `tailwind.config.js`) rather than raw hex literals or default shadcn muted-foreground/border tokens. Several pages (Dashboard, Signal Tracking Dashboard, Planning Wizard) still had hex literals until the operator-console rollout — grep for `#[0-9A-Fa-f]{3,6}` in a file before styling it to catch leftovers.
14. **Verify third-party API schemas against their live source before trusting existing types** — Atlas's Google Data Manager API integration had drifted materially from the live schema (wrong event shape, consent enum values, destination structure, audience-endpoint URL casing) until a fix shipped alongside the Shopify click-ID/new-customer signal work. Verified by fetching `https://datamanager.googleapis.com/$discovery/rest?version=v1` directly rather than relying on training-data assumptions. Re-verify before extending `dmaTypes.ts`/`dmaEventBuilder.ts` further.
15. **Server-sourced CAPI events use `processServerSourcedEvent()`** (`backend/src/services/capi/pipeline.ts`) — a narrow, explicit exception to the consent gate for integrations with no live browser session to have captured a real consent decision from (e.g. Shopify order/refund webhooks). Never default `consent_state` to `'granted'` for a live-browser pipeline call; this path is only for genuinely server-sourced events.

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
12. **No fabricated UI data** — don't add charts, IDs, or status text that isn't backed by a real data source (e.g. a trend chart with no time-series endpoint behind it). Skip the visual rather than fake it, and note the gap.

---

## Active Development Branch

`claude/atlas-cross-domain-tracking-ywpmrz`

---

## Completed Sprints (summary)

Early sprints (Stripe Payments, Offline Conversions, Strategy Gate 1.6, CSE 1–4, Usage & Monitoring, B2B Journey Template, GCLID Capture, Signal Library, Platform Connections, Platform Reconciliation, GTM Integration, IHC, DQM, Bid Signal Enricher, Signal Tracking Dashboard, Event Taxonomy, Naming Conventions, LinkedIn CAPI, Integration Tests) shipped the core feature set and backend routes/schema described above — see git history for detail on any of these.

| Sprint | What shipped |
|---|---|
| Signal Enrichment Configuration | `signal_enrichment_configs`/`client_identity_configs` tables, `enrichmentConfigService` (field resolution + scoring), 12-rule validation engine, enrichment route/API/store, `IdentityConfigStep`/`SignalEnrichmentStep`/`FieldMappingRow`/`EnrichmentScoreBadge` components wired into ClientSetupWizard/ClientDetailPage/DeploymentWizard, CAPI pipeline injection, GTM identity DLV vars, 40 unit tests |
| Home Redesign + Audit Engine Entry Point | Two-option HomePage (`FirstTimeSetup`/`ReturningUserLanding`) via `useOrganisations`; `EvaluateSiteCard` as Audit Engine entry point + `LinkToClientButton`; `audits.client_id` migration; `QuickClientIntake`; strategy gate softened to a pass-through; introduced the "operator console" design-token system (`console.*`, Orbitron/Rajdhani/JetBrains Mono) on Sidebar/TopBar/OrgSwitcher/Home |
| Operator Console UI Rollout | Extended the console design system to the remaining major surfaces: Sidebar nav regrouped from flat Workspace/Tools into 7 semantic groups (Workspace/Engine/Library/Implementation/Tracking/Advanced/Privacy), surfacing Signal Tracking/Reconciliation/Implementation Health links that had no prior nav entry; OrgSwitcher dropdown restyled off shadcn defaults; main Dashboard (`DeltaHeader`/`OrgMetricsStrip`/`AlertFeed`/`ClientHealthList`) restyled; Signal Tracking Dashboard restyled + new real aggregate stat-card row (`SignalAggregateCards`, backed by the existing `/aggregates` endpoint); Planning Wizard Step 1 restyled, wizard stepper extracted into a reusable `WizardStepper`, added the missing shadcn `Checkbox` primitive, added a live "Configuration Draft" preview panel; sidebar header simplified to a plain "ATLAS" text wordmark after an icon-mark version proved illegible at sidebar scale |
| Ecommerce Signals 1: GA4-as-DMA-destination + new-vs-returning signal | `buildGoogleDestinations()` appends a GA4 destination alongside Google Ads on every DMA call when `ga4_property_id` is configured; Journey Builder + `gtmContainerGenerator.ts` gained a `new_customer` GTM primitive (cookie tag + CJS variable, dataLayer-first with cookie fallback) feeding GA4 purchase events |
| Ecommerce Signals 2: Refund/return feedback | `refund_events` table + `refundDelivery.ts`; Google Ads gets automatic Customer Match audience removal (`removeFromGoogleAudience`) plus a manual Conversion Adjustments CSV export (RESTATEMENT for partial refunds w/ absolute `new_conversion_value`, RETRACTION for full — Google Ads' own adjustment-type terms); Meta is logged-only (no reversal API exists); `RefundsTab` in the CAPI Monitoring Dashboard; `/api/refunds` route |
| Ecommerce Signals 3: sGTM detection + monitoring | `client_platforms.is_verified`/`verified_at` + a URL-reachability verify endpoint; new `dqm_sgtm_checks` table + `sgtmProbe.ts` health probe wired into `dqmOrchestrator`; new IHC drift rule `SGTM_ROUTING_NOT_CONFIGURED`. Tag generation (routing GA4 traffic through the container) deferred pending GTM field-name verification against a live export |
| Ecommerce Signals 4: Shopify acquisition channel | Public Shopify App — install with no prior Atlas account; shadow Supabase Auth user provisioning auto-creates a full org via `handle_new_user()`; `platform_connections` gains `platform='shopify'`; order/refund webhooks staged (`shopify_webhook_events`) then routed through a new consent-gate-free `processServerSourcedEvent()` CAPI path (`pipeline.ts`); 3 mandatory GDPR compliance webhooks logged to `shopify_compliance_requests`; unauthenticated `/shopify/welcome` claim-your-account page |
| Ecommerce Signals 5: Google DMA schema fix + Shopify click-ID/new-customer signal | Corrected a major schema drift between Atlas's DMA integration and the live Data Manager API (verified via its Discovery Document) affecting every existing Google Ads/GA4 delivery — missing required `eventTimestamp`, wrong user-identifier/consent/address nesting, conversion action moved to `Destination.productDestinationId`, wrong Audience Match URL casing, a missing `removeAudienceMembers()` REMOVE method (refund audience removal had likely never worked); consolidated event/audience-member building into a shared `dmaEventBuilder.ts`. Shopify storefront ScriptTag now captures gclid/fbclid/wbraid/gbraid into order `note_attributes`; `customer.orders_count` feeds a real `userProperties.customerType` new-customer signal (Google Ads/GA4 only — no Meta CAPI equivalent) |
| TikTok ttclid capture + delivery test coverage | Closed the gap left by the earlier TikTok CAPI backend delivery work (`tiktokDelivery.ts`, shipped Phase 2 but never marked done in this file — corrected the stale "TikTok stub" line above). Added `ttclid` end-to-end following the existing gclid/fbclid/wbraid/gbraid pattern: `IdentifierType`/`AtlasEvent.user_data` (both frontend/backend), raw passthrough in `pipeline.ts`'s `buildHashedIdentifiers()`, `TikTokTrackEvent.user.ttclid` in `tiktokDelivery.ts`/the frontend TikTok adapter, GTM `Atlas - Click ID Cookie Capture` tag + `URL Query - ttclid` variable, Shopify `shopifyCaptureScript.ts`/`shopifyOrderMapper.ts` (`_atlas_ttclid` cookie → `atlas_ttclid` note attribute), `client_identity_configs.ttclid_field` (+ `applyIdentityConfig()`), and `ATTRIBUTION_PARAMS` in the AI Planning Mode's IR schema. Added `tiktokDelivery.test.ts` (26 tests covering formatting, dedup status, batch failure semantics, test-event routing, credential validation) plus new `applyIdentityConfig()`/`formatTikTokEvent()` ttclid cases in existing suites |
