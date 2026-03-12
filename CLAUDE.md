# CLAUDE.md — AI Assistant Guide for AtlasV2

## Project Overview

**Atlas** is a **marketing-facing Signal Health Platform** that audits conversion tracking infrastructure on SPAs and headless commerce sites. It uses Browserbase (managed Playwright) to simulate user journeys, validates signal integrity across 26 rules, scores conversion health, and produces executive-ready PDF/JSON reports that non-technical marketers can understand.

It also includes **Planning Mode** — an upstream AI-powered workflow that scans a website, recommends what to track, and generates a ready-to-import GTM container, dataLayer spec, and implementation guide.

**Current status: Fully implemented and deployed.** The monorepo contains a working React 19 frontend (deployed on Vercel) and a Node.js/Express backend (deployed on Render). All three core modes are live.

---

## Repository Structure

```
AtlasV2/
├── CLAUDE.md                          ← This file (AI assistant guide)
├── claude.md                          ← Full implementation guide & sprint roadmap
├── validation-rules.ts                ← 26 validation rules (source of truth)
├── rule-interpretations.ts            ← Business impact mappings (tech → marketing)
├── docs/
│   ├── planning-mode-sprint-plan.md
│   ├── planning-mode-tasks.md
│   ├── planning-mode-migrations.md
│   └── planning-mode-e2e-test-guide.md
├── frontend/                          ← React 19 + Vite + TypeScript (Vercel)
│   └── src/
│       ├── pages/
│       ├── components/
│       ├── store/
│       ├── hooks/
│       ├── lib/api/
│       └── types/
├── backend/                           ← Node.js/Express + TypeScript (Render)
│   └── src/
│       ├── api/routes/
│       ├── api/middleware/
│       ├── services/
│       ├── types/
│       └── config/
├── README.md
└── LICENSE                            ← Apache 2.0
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| State Management | Zustand |
| Styling | Tailwind CSS + shadcn/ui |
| Build / Deploy | Vite → Vercel |
| Backend | Node.js/Express (LTS 20+) → Render |
| Browser Automation | Browserbase API (managed Playwright) |
| Job Queue | Bull on Redis |
| PDF Generation | PDFKit |
| ZIP Export | jszip |
| Database | Supabase PostgreSQL |
| Storage | Supabase Storage (`planning-screenshots` bucket) |
| Auth | Supabase Auth |
| Payments | Stripe |
| AI Analysis | Anthropic Claude API (`claude-haiku-4-5-20251001`) |

---

## The Three Modes

### 1. Planning Mode
AI-powered upstream workflow. Sits *before* Audit Mode.

```
Planning Mode → (developer implements tracking) → Audit Mode
"What should I track?"                            "Is my tracking working?"
```

**User flow (7-step wizard):**
1. Enter site URL, business type, platforms
2. Enter page URLs to scan (max 10)
3. Scanning progress (real-time, polls backend)
4. Review AI recommendations (annotated screenshots)
5. Tracking plan summary
6. Generated outputs (GTM container JSON, dataLayer spec, HTML implementation guide)
7. Download + handoff to Audit Mode (creates a Journey in Journey Builder)

**Rate limits:** Free = 1/month, Pro = 10/month, Agency = unlimited

---

### 2. Journey Builder → Audit Mode
Structured audit workflow. User builds a reusable journey definition, then runs audits against it.

**User flow:**
1. Journey Builder wizard (4 steps): business type → funnel stages → platform selection → review
2. Generate validation spec (`POST /api/journeys/:id/generate`)
3. Run audit from journey (`POST /api/audits/start-from-journey`)
4. View Gap Report (`/journey/:id/audit/:auditId`)

---

### 3. Direct Audit Mode
Quick-start audit without a saved journey.

**User flow:**
1. Enter URL, funnel type, region, URL map
2. Audit runs async (Browserbase job queue)
3. Poll progress (`GET /api/audits/:id`)
4. View 5-page report (`/report/:auditId`)
5. Export PDF/JSON/ZIP

**Rate limits:** Free = 2/month, Pro = 20/month, Agency = unlimited

---

## Frontend — Pages & Routing

| Route | Page | Description |
|-------|------|-------------|
| `/` | → `/home` redirect | |
| `/login` | `LoginPage` | Supabase Auth UI |
| `/home` | `HomePage` | **Landing page** — plan badge, mode-selection cards, recent activity feed |
| `/dashboard` | `DashboardPage` | Audit history table with delete functionality |
| `/journey/new` | `JourneyBuilderPage` | 4-step journey wizard |
| `/journey/:id/spec` | `JourneySpecPage` | Generated GTM/WalkerOS spec viewer |
| `/journey/:id/audit/:auditId` | `GapReportPage` | Journey-specific gap analysis |
| `/audit/:auditId/progress` | `AuditProgressPage` | Full-screen progress tracker (no sidebar) |
| `/report/:auditId` | `ReportPage` | 5-page audit report |
| `/planning` | `PlanningDashboard` | Planning sessions list with delete functionality |
| `/planning/new` | `PlanningModePage` | New planning session wizard (full-screen) |
| `/planning/:sessionId` | `PlanningModePage` | Resume existing session (full-screen) |
| `/settings` | `SettingsPage` | Billing, plan upgrade, preferences |

**Layout:** Most protected routes use `AppLayout` (sidebar + topbar). `AuditProgressPage` and `PlanningModePage` are full-screen (no sidebar).

**Sidebar nav links:** Home → Plan Tracking → New Audit → History → Settings

---

## Frontend — Key Files

```
frontend/src/
├── pages/
│   ├── HomePage.tsx              ← Landing page post-login
│   ├── DashboardPage.tsx         ← Audit history + delete
│   ├── PlanningDashboard.tsx     ← Planning sessions list + delete
│   ├── PlanningModePage.tsx      ← 7-step wizard container
│   ├── JourneyBuilderPage.tsx
│   ├── JourneySpecPage.tsx
│   ├── GapReportPage.tsx
│   ├── AuditProgressPage.tsx
│   ├── ReportPage.tsx
│   ├── SettingsPage.tsx
│   └── LoginPage.tsx
│
├── components/
│   ├── audit/
│   │   ├── AuditHistoryTable.tsx      ← Supports onDelete prop (inline confirm UI)
│   │   ├── AuditProgressSteps.tsx
│   │   ├── ReportNav.tsx
│   │   ├── RunAuditForm.tsx
│   │   └── ReportPages/
│   │       ├── ExecutiveSummary.tsx
│   │       ├── IssuesFixes.tsx
│   │       ├── JourneyBreakdown.tsx
│   │       ├── PlatformImpact.tsx
│   │       └── TechnicalAppendix.tsx
│   ├── planning/
│   │   ├── AnnotatedScreenshot.tsx    ← Desktop-only (≥1024px)
│   │   ├── RecommendationCard.tsx
│   │   ├── CustomElementForm.tsx
│   │   ├── Step1PlanningSetup.tsx
│   │   ├── Step2PageDiscovery.tsx
│   │   ├── Step3ScanningProgress.tsx
│   │   ├── Step4ReviewRecommendations.tsx
│   │   ├── Step5TrackingPlanSummary.tsx
│   │   ├── Step6GeneratedOutputs.tsx
│   │   └── Step7DownloadAndHandoff.tsx
│   ├── journey/
│   │   ├── JourneyWizard.tsx
│   │   ├── Step1BusinessType.tsx
│   │   ├── Step2JourneyEditor.tsx
│   │   ├── Step3PlatformSelector.tsx
│   │   └── Step4Review.tsx
│   ├── layout/
│   │   ├── AppLayout.tsx              ← Fetches user email + plan from Supabase
│   │   ├── Sidebar.tsx                ← Nav: Home, Plan Tracking, New Audit, History, Settings
│   │   ├── TopBar.tsx                 ← Plan badge + sign-out
│   │   └── ProtectedRoute.tsx
│   └── common/
│       ├── HealthBadge.tsx
│       ├── ScoreCard.tsx
│       ├── SeverityBadge.tsx
│       └── StatusBanner.tsx
│
├── store/
│   ├── auditStore.ts              ← currentAudit, report, setAudit, clearAudit
│   ├── planningStore.ts           ← currentStep (1–7), draftSetup, currentSession, pages, recommendations, outputs
│   └── journeyWizardStore.ts
│
├── hooks/
│   ├── useAudit.ts                ← Polls audit status
│   ├── useAuditHistory.ts         ← Fetches audit list
│   └── useReport.ts               ← Report data
│
├── lib/api/
│   ├── auditApi.ts                ← start, getStatus, getReport, list, delete, export, startFromJourney, getGaps
│   ├── planningApi.ts             ← createSession, listSessions, getSession, getRecommendations, updateDecision, generateOutputs, listOutputs, downloadOutput, getScreenshotUrl, handoff, deleteSession
│   └── journeyApi.ts
│
└── types/
    ├── audit.ts
    ├── journey.ts
    └── planning.ts
```

---

## Backend — API Endpoints

### Audits (`/api/audits`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audits` | List user's audits (with report scores joined) |
| `POST` | `/api/audits/start` | Enqueue new audit job. Returns `{ audit_id, status: 'queued' }` |
| `POST` | `/api/audits/start-from-journey` | Enqueue audit from a saved Journey spec |
| `GET` | `/api/audits/:id` | Poll audit status and progress |
| `GET` | `/api/audits/:id/report` | Fetch completed `ReportJSON` |
| `GET` | `/api/audits/:id/gaps` | Journey-specific gap results |
| `POST` | `/api/audits/:id/export` | Download PDF / JSON / ZIP bundle |
| `DELETE` | `/api/audits/:id` | Delete an audit (ownership-checked). Returns `{ deleted: true }` |

### Planning Mode (`/api/planning`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/planning/sessions` | Create session + enqueue scan job |
| `GET` | `/api/planning/sessions` | List user's planning sessions |
| `GET` | `/api/planning/sessions/:id` | Get session with pages + scan progress |
| `DELETE` | `/api/planning/sessions/:id` | Delete a session (ownership-checked). Returns `{ deleted: true }` |
| `GET` | `/api/planning/sessions/:id/recommendations` | Get all AI recommendations (grouped by page) |
| `POST` | `/api/planning/sessions/:id/recommendations` | Add a manual recommendation (auto-approved) |
| `PATCH` | `/api/planning/sessions/:id/recommendations/:recId` | Record user decision: approved / skipped / modified |
| `POST` | `/api/planning/sessions/:id/generate` | Generate GTM container, dataLayer spec, HTML guide |
| `GET` | `/api/planning/sessions/:id/outputs` | List generated outputs |
| `GET` | `/api/planning/sessions/:id/outputs/:id/download` | Download a specific output file |
| `GET` | `/api/planning/sessions/:id/pages/:pageId/screenshot` | Get fresh 30-min signed URL for a page screenshot |
| `POST` | `/api/planning/sessions/:id/handoff` | Create a Journey from approved recommendations |

### Journeys (`/api/journeys`)

CRUD for journey definitions, stages, platforms, and spec generation. See `backend/src/api/routes/journeys.ts`.

---

## Backend — Key Files

```
backend/src/
├── app.ts                         ← Express setup, trust proxy, rate limiters, routes
├── api/
│   ├── middleware/
│   │   ├── authMiddleware.ts      ← Validates Supabase JWT; attaches req.user {id, email, plan}
│   │   ├── auditLimiter.ts        ← DB-based monthly limit by plan (free:2, pro:20, agency:∞)
│   │   └── planningLimiter.ts     ← DB-based monthly limit by plan (free:1, pro:10, agency:∞)
│   └── routes/
│       ├── audits.ts
│       ├── planning.ts
│       └── journeys.ts
│
├── services/
│   ├── audit/
│   │   ├── orchestrator.ts        ← Audit job orchestration
│   │   ├── dataCapture.ts         ← Capture network & dataLayer events
│   │   ├── journeySimulator.ts
│   │   └── stageSimulator.ts
│   ├── validation/
│   │   ├── engine.ts              ← Runs all 26 rules
│   │   ├── signalInitiation.ts    ← Layer 1 (8 rules)
│   │   ├── parameterCompleteness.ts ← Layer 2 (12 rules)
│   │   └── persistence.ts         ← Layer 3 (6 rules)
│   ├── scoring/
│   │   └── engine.ts              ← Calculates 4 scores
│   ├── reporting/
│   │   └── generator.ts           ← JSON → ReportJSON
│   ├── interpretation/
│   │   └── engine.ts              ← Business impact mappings
│   ├── export/
│   │   └── pdfGenerator.ts        ← PDFKit PDF generation
│   ├── planning/
│   │   ├── pageCaptureService.ts  ← Browserbase page capture + screenshot upload
│   │   ├── domSimplifier.ts       ← DOM → ≤15K token simplified tree
│   │   ├── aiAnalysisService.ts   ← Claude API (haiku) prompts + parsing
│   │   ├── sessionOrchestrator.ts ← Multi-page scan orchestration
│   │   └── generators/
│   │       ├── gtmContainerGenerator.ts      ← GTM importable JSON (exportFormatVersion: 2)
│   │       ├── dataLayerSpecGenerator.ts     ← Per-page developer code snippets
│   │       ├── implementationGuideGenerator.ts ← Standalone HTML guide
│   │       └── outputGenerator.ts            ← Orchestrates all generators
│   ├── journey/
│   │   ├── platformSchemas.ts
│   │   ├── actionPrimitives.ts
│   │   └── generators/
│   │       ├── gtmDataLayer.ts
│   │       ├── validationSpec.ts
│   │       └── walkerosFlow.ts
│   ├── browserbase/
│   │   ├── client.ts              ← Browserbase API client (reused by both audit + planning)
│   │   └── journeyConfigs.ts
│   ├── database/
│   │   ├── supabase.ts            ← supabaseAdmin client + getScreenshotSignedUrl()
│   │   ├── queries.ts             ← Audit CRUD: createAudit, getAudit, updateAuditStatus, deleteAudit, listAudits, ...
│   │   ├── journeyQueries.ts
│   │   └── planningQueries.ts     ← Planning CRUD: createSession, getSession, listSessions, deleteSession, createPage, getPageWithSignedUrl, createRecommendations, updateRecommendationDecision, createOutput, ...
│   └── queue/
│       ├── jobQueue.ts            ← Bull queue setup (auditQueue, planningQueue)
│       └── worker.ts              ← Job processors
│
└── config/
    └── env.ts                     ← All environment variable access
```

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User plan: `free \| pro \| agency` |
| `audits` | Audit records (status, progress, website_url, funnel_type) |
| `audit_results` | Per-rule validation results |
| `audit_reports` | Final `ReportJSON` JSONB blob |
| `journeys` | Journey definitions |
| `journey_stages` | Funnel stages per journey |
| `journey_platforms` | Platform selections per journey |
| `journey_specs` | Generated GTM/WalkerOS specs |
| `journey_templates` | Saved templates |
| `journey_audit_results` | Gap analysis results for journey-mode audits |
| `planning_sessions` | Planning Mode sessions |
| `planning_pages` | URLs scanned per session |
| `planning_recommendations` | AI-generated recommendations |
| `planning_outputs` | Generated GTM JSON, dataLayer spec, HTML guide |

### Supabase Storage

**Bucket:** `planning-screenshots`
- Screenshots are uploaded during page capture and stored with path `{user_id}/{session_id}/{page_id}.jpg`
- Only paths are stored in DB (`planning_pages.screenshot_url`); signed URLs are generated on demand via `getScreenshotSignedUrl()`
- **RLS policies required on `storage.objects`:**
  - `Users can upload own screenshots` (INSERT) — `auth.uid()::text = (storage.foldername(name))[1]`
  - `Users can read own screenshots` (SELECT) — same check

---

## Validation Engine — 26 Rules

**Layer 1 — Signal Initiation (8 rules):** Are conversion events firing at all?
- `GA4_PURCHASE_EVENT_FIRED`, `META_PIXEL_PURCHASE_EVENT_FIRED`, `GOOGLE_ADS_CONVERSION_EVENT_FIRED`, `SGTM_SERVER_EVENT_FIRED`, `DATALAYER_POPULATED`, `GTM_CONTAINER_LOADED`, `PAGE_VIEW_EVENT_FIRED`, `ADD_TO_CART_EVENT_FIRED`

**Layer 2 — Parameter Completeness (12 rules):** Are required parameters present?
- `TRANSACTION_ID_PRESENT`, `VALUE_PARAMETER_PRESENT`, `CURRENCY_PARAMETER_PRESENT`, `GCLID_CAPTURED_AT_LANDING`, `FBCLID_CAPTURED_AT_LANDING`, `EVENT_ID_GENERATED`, `EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS`, `PHONE_CAPTURED_FOR_CAPI`, `ITEMS_ARRAY_POPULATED`, `USER_ID_PRESENT`, `COUPON_CAPTURED_IF_USED`, `SHIPPING_CAPTURED`

**Layer 3 — Persistence (6 rules):** Do identifiers survive cross-page navigation?
- `GCLID_PERSISTS_TO_CONVERSION`, `FBCLID_PERSISTS_TO_CONVERSION`, `TRANSACTION_ID_MATCHES_ORDER_SYSTEM`, `EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER`, `USER_DATA_NORMALIZED_CONSISTENTLY`, `PII_PROPERLY_HASHED`

Rules are pure synchronous functions: `(auditData: AuditData) => ValidationResult`. No async logic inside `test()`.

---

## Scoring Engine — 4 Scores

1. **Conversion Signal Health (0–100)** — `(passing rules / 26) * 100`
2. **Attribution Risk** — `'Low' | 'Medium' | 'High' | 'Critical'` based on gclid/fbclid/transaction_id capture
3. **Optimization Strength** — `'Weak' | 'Moderate' | 'Strong'` based on user_data field completeness
4. **Data Consistency Score** — `'Low' | 'Medium' | 'High'` based on event_id deduplication

---

## Report — 5 Pages

1. **Executive Summary** — overall status, 4 scores, business summary (critical/high issues only)
2. **Issues & Fixes** — all failing rules with business impact + recommended owner + effort estimate
3. **Journey Breakdown** — per-stage signal analysis
4. **Platform Impact** — breakdown by GA4, Meta, Google Ads, sGTM
5. **Technical Appendix** — raw validation results, network requests, dataLayer events

Report language always uses `business_impact` from `rule-interpretations.ts`, never raw `technical_details`.

---

## Platforms Audited

| Platform | Signal Type | Key Rules |
|----------|-------------|-----------|
| Google Analytics 4 | Purchase event, dataLayer | `GA4_PURCHASE_EVENT_FIRED`, `DATALAYER_POPULATED` |
| Meta Ads | Pixel, CAPI | `META_PIXEL_PURCHASE_EVENT_FIRED`, `FBCLID_*`, `PHONE_CAPTURED_FOR_CAPI` |
| Google Ads | Conversion event, gclid | `GOOGLE_ADS_CONVERSION_EVENT_FIRED`, `GCLID_*` |
| GTM | Container load | `GTM_CONTAINER_LOADED` |
| Server-side GTM | sGTM event, event_id | `SGTM_SERVER_EVENT_FIRED`, `EVENT_ID_*` |

---

## Supported Funnel Types

- `ecommerce` — Shopping cart → checkout → order confirmation
- `saas` — Trial signup → onboarding → subscription
- `lead_gen` — Landing → form submit → thank you page
- `content`, `marketplace`, `custom` (Journey Builder / Planning Mode)

---

## Environment Variables

### Frontend (`frontend/.env`)
```
VITE_API_URL=https://your-backend.onrender.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_STRIPE_PRICE_PRO=price_xxx
VITE_STRIPE_PRICE_AGENCY=price_xxx
```

### Backend (`backend/.env`)
```
BROWSERBASE_API_KEY=your-browserbase-key
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
FRONTEND_URL=https://your-frontend.vercel.app
```

> Never commit `.env` files. `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are backend-only — never expose in frontend `VITE_*` variables.

---

## Delete Functionality

Both audits and planning sessions can be deleted by the owning user:

- **Audit delete:** `DELETE /api/audits/:id` — checks `user_id` ownership, cascades to `audit_results` and `audit_reports`
- **Planning session delete:** `DELETE /api/planning/sessions/:id` — checks `user_id` ownership
- **Frontend UX:** Trash icon on each table row → inline "Delete? ✓ ✗" confirm → row removed optimistically on success
- Available on: `/dashboard` (DashboardPage) and `/planning` (PlanningDashboard)

---

## Code Conventions

### TypeScript
- Strict mode — no `any`; use proper types from `types/audit.ts`, `types/planning.ts`, `types/journey.ts`
- `as const` for literal type narrowing on severity/validation_layer
- Interfaces over types for object shapes
- Named exports for all rules and utilities (no default exports on rule files)

### API Design
- **Async job pattern**: POST returns immediately with ID; client polls GET until `status === 'completed'`
- Poll interval: 2 seconds from frontend
- All endpoints authenticated via `authMiddleware.ts`
- DELETE endpoints return `{ deleted: true }` (not 204) so `apiFetch` can parse the response

### Frontend Patterns
- API calls only through `src/lib/api/*.ts` — never `fetch()` directly in components
- State via Zustand stores — `auditStore`, `planningStore`, `journeyWizardStore`
- Report sub-pages receive data as props from parent — no direct API calls in sub-pages
- Screenshot signed URLs are generated via `planningApi.getScreenshotUrl()` — never stored as long-lived URLs

### Database
- All DB queries go through `services/database/*.ts` — no raw SQL in route handlers
- Use `supabaseAdmin` (service role) in backend only
- `deleteAudit(auditId, userId)` and `deleteSession(sessionId, userId)` both double-check ownership at the DB layer

### Deployment / Infrastructure
- **Frontend:** Vercel, auto-deploys from `main` branch. TypeScript errors cause build failures — `tsc --noEmit` must pass.
- **Backend:** Render, auto-deploys from feature branch (or `main` after merge). Runs `node dist/index.js`.
- **Trust proxy:** `app.set('trust proxy', 1)` is set in `app.ts`. Rate limiters use `validate: { xForwardedForHeader: false }` to suppress Render's `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning.

---

## Business Rules

| Rule | Detail |
|------|--------|
| Audit rate limit | Free: 2/month, Pro: 20/month, Agency: unlimited. Checked via `auditLimiter.ts` before enqueueing. |
| Planning rate limit | Free: 1/month, Pro: 10/month, Agency: unlimited. Checked via `planningLimiter.ts`. |
| Max pages per planning session | 10 (MVP) |
| AI model | `claude-haiku-4-5-20251001` — cost target ~$0.13/session |
| Screenshot format | JPEG 80% quality, 1280×800 viewport |
| DOM token limit | Hard cap at 15,000 tokens for Claude API input |
| Confidence threshold | Recommendations ≥ 0.8 confidence can be batch-approved |
| GTM export format | `exportFormatVersion: 2` |
| Severity routing | Only `critical` and `high` appear in Executive Summary. All severities in Issues & Fixes. |
| PII handling | Email/phone captured for validation only. Hash before storing. Never log raw PII. |
| Annotated screenshots | Desktop-only (≥1024px). Show warning banner on mobile. |
| Handoff | Auto-created Journey from handoff must be reviewed in Journey Builder before running an audit. |

---

## Common Pitfalls to Avoid

1. **Don't add async logic to validation rule `test()` functions** — all data is passed in via `AuditData`; rules are synchronous.
2. **Don't expose `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` to frontend** — backend only.
3. **Don't render raw `technical_details` to marketers** — always use `business_impact` from `rule-interpretations.ts`.
4. **Don't store screenshots as binary in DB** — upload to Supabase Storage `planning-screenshots` bucket; store only the path.
5. **Don't conflate GTM Container JSON with GTM dataLayer snippets** — container JSON is importable; dataLayer spec is human-readable developer code.
6. **Don't call Claude API synchronously in route handlers** — all page scanning goes through the Bull job queue.
7. **Don't use `dangerouslySetInnerHTML` for user-supplied content** — the implementation guide HTML is Atlas-generated (safe). Never render user-supplied HTML.
8. **Don't skip the handoff journey review step** — auto-created Journey stage types may need correction before running the audit.
9. **Don't return 204 from DELETE endpoints** — `apiFetch` calls `res.json()`, so return `{ deleted: true }` with 200 instead.
10. **Don't push directly to `main`** — all changes go through feature branches (`claude/<description>-<session-id>`) and PRs. Vercel runs a preview build on every PR; TypeScript errors will block the merge.

---

## Git Workflow

- **Main branch:** `main` (deploys to Vercel + Render)
- **Feature branches:** `claude/<description>-<session-id>`
- All changes go through PRs; Vercel preview build must pass before merging
- Run `npx tsc --noEmit` in `frontend/` before pushing to catch TS errors that would fail the Vercel build

---

## Key Reference Points

| What you need | Where to find it |
|---------------|-----------------|
| All 26 validation rules (logic) | `validation-rules.ts` |
| Business impact wording | `rule-interpretations.ts` |
| Full implementation guide | `claude.md` |
| API endpoint contracts | This file (above) + `claude.md` |
| Database schema SQL | `claude.md` → "Database Schema" section |
| Planning Mode migrations | `docs/planning-mode-migrations.md` |
| Planning Mode sprint plan | `docs/planning-mode-sprint-plan.md` |
| Planning Mode task checklist | `docs/planning-mode-tasks.md` |
| E2E test guide | `docs/planning-mode-e2e-test-guide.md` |
| Planning Mode PRD | `ATLAS_Planning_Mode_PRD.md` |
