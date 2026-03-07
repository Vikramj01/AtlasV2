# CLAUDE.md — AI Assistant Guide for AtlasV2

## Project Overview

**Atlas** is a **marketing-facing Signal Health Platform** that audits conversion tracking infrastructure on SPAs and headless commerce sites. It uses Browserbase (managed Playwright) to simulate user journeys, validates signal integrity across 26 rules, scores conversion health, and produces executive-ready PDF/JSON reports that non-technical marketers can understand.

**Current status:** Specification phase — all validation rules, business impact mappings, architecture, and API contracts are defined. Implementation not yet started.

---

## Repository Structure (Current State)

```
AtlasV2/
├── CLAUDE.md                          ← This file (AI assistant guide)
├── claude.md                          ← Full implementation guide & sprint roadmap
├── validation-rules.ts                ← 26 validation rules (ready to implement)
├── rule-interpretations.ts            ← Business impact mappings (tech → marketing)
├── ATLAS_Validation_Rules_Complete.docx  ← Additional validation documentation
├── README.md                          ← Minimal project title
└── LICENSE                            ← Apache 2.0
```

> **No build system, package.json, or source directories exist yet.** This is a specification repository. All implementation will follow the architecture defined in `claude.md`.

---

## Planned Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript |
| State Management | Zustand |
| Styling | Tailwind CSS |
| Build Tool | Vite (implied) |
| Backend | Node.js/Express (LTS 20+) |
| Browser Automation | Browserbase API (managed Playwright) |
| Job Queue | Bull on Redis |
| PDF Generation | PDFKit or Puppeteer |
| ZIP Export | jszip |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth |
| Payments | Stripe |
| Testing | Vitest + Jest |

### System Components

```
Frontend (React 19)
  → Audit Setup Page
  → Audit Progress (polling)
  → 5-Page Report UI
  → Export Controls (PDF/JSON)

Backend (Node.js/Express)
  → POST /api/audits/start    — Enqueue audit job
  → GET  /api/audits/:id      — Poll status
  → GET  /api/audits/:id/report  — Fetch completed report
  → POST /api/audits/:id/export  — Download PDF/JSON

Browserbase (Managed Playwright)
  → Simulate user journey (landing → product → checkout → confirmation)
  → Capture dataLayer events
  → Intercept network requests (GA4, Meta, Google Ads, sGTM)

Validation Engine
  → 26 rules across 3 layers
  → Pure functions: (AuditData) => ValidationResult

Scoring Engine
  → 4 scores: Conversion Signal Health, Attribution Risk, Optimization Strength, Data Consistency

Interpretation Engine
  → Maps rule failures to marketing-friendly business impact

Report Generator
  → JSON → PDF (5 pages) + JSON export
```

---

## Key Source Files (Read These First)

### `validation-rules.ts` — 26 Validation Rules

Contains all validation logic, organized in 3 layers. Each rule is an exported constant:

```typescript
export const RULE_NAME = {
  rule_id: 'RULE_NAME',
  validation_layer: 'signal_initiation' | 'parameter_completeness' | 'persistence',
  severity: 'critical' | 'high' | 'medium' | 'low',
  affected_platforms: string[],
  business_impact: string,
  recommended_owner: string,
  fix_summary: string,

  test: (auditData: AuditData): ValidationResult => {
    // Pure function — no side effects
    return {
      rule_id,
      validation_layer,
      status: 'pass' | 'fail' | 'warning',
      severity,
      technical_details: { found, expected, evidence: string[] }
    };
  }
};
```

**Layer 1 — Signal Initiation (8 rules):** Are conversion events firing at all?
- `GA4_PURCHASE_EVENT_FIRED`, `META_PIXEL_PURCHASE_EVENT_FIRED`, `GOOGLE_ADS_CONVERSION_EVENT_FIRED`, `SGTM_SERVER_EVENT_FIRED`, `DATALAYER_POPULATED`, `GTM_CONTAINER_LOADED`, `PAGE_VIEW_EVENT_FIRED`, `ADD_TO_CART_EVENT_FIRED`

**Layer 2 — Parameter Completeness (12 rules):** Are required parameters present?
- `TRANSACTION_ID_PRESENT`, `VALUE_PARAMETER_PRESENT`, `CURRENCY_PARAMETER_PRESENT`, `GCLID_CAPTURED_AT_LANDING`, `FBCLID_CAPTURED_AT_LANDING`, `EVENT_ID_GENERATED`, `EMAIL_CAPTURED_FOR_ENHANCED_CONVERSIONS`, `PHONE_CAPTURED_FOR_CAPI`, `ITEMS_ARRAY_POPULATED`, `USER_ID_PRESENT`, `COUPON_CAPTURED_IF_USED`, `SHIPPING_CAPTURED`

**Layer 3 — Persistence (6 rules):** Do identifiers survive cross-page navigation?
- `GCLID_PERSISTS_TO_CONVERSION`, `FBCLID_PERSISTS_TO_CONVERSION`, `TRANSACTION_ID_MATCHES_ORDER_SYSTEM`, `EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER`, `USER_DATA_NORMALIZED_CONSISTENTLY`, `PII_PROPERLY_HASHED`

### `rule-interpretations.ts` — Business Impact Mappings

Exports:
- `RULE_INTERPRETATIONS: Record<string, RuleInterpretation>` — Full mapping
- `getInterpretation(rule_id)` — Single rule lookup
- `getRulesBySeverity(severity)` — Filter by severity
- `getRulesByPlatform(platform)` — Filter by platform
- `generateBusinessSummary(failedRuleIds)` — Marketing-friendly summary
- `determineOverallStatus(failedRuleIds)` — Returns `'healthy' | 'partially_broken' | 'critical'`

The `RuleInterpretation` interface:
```typescript
interface RuleInterpretation {
  rule_id: string;
  business_impact: string;          // Plain English for marketers
  affected_platforms: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommended_owner: 'Frontend Developer' | 'Backend Developer' | 'GTM implementer' | 'Marketing Ops' | 'DevOps' | 'Security';
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
}
```

### `claude.md` — Full Implementation Guide

The canonical reference for implementation. Covers:
- Complete frontend and backend file structure (with `[NEW]`/`[KEEP]`/`[DELETE]` annotations)
- All API endpoint contracts with request/response shapes
- Database schema SQL (ready to run in Supabase)
- 90-day sprint plan with task breakdowns
- Code patterns for validation rules, API endpoints, and React hooks
- Environment variable names
- Launch checklist

---

## Development Workflows

### When Implementation Begins

**Step 1: Set up the monorepo structure**
```
AtlasV2/
├── frontend/   ← React 19 + Vite + TypeScript
├── backend/    ← Node.js/Express + TypeScript
└── shared/     ← Shared types (audit.ts, etc.)
```

**Step 2: Initialize backend**
```bash
cd backend
npm init -y
npm install express typescript @types/express ts-node nodemon
npm install browserbase bull ioredis pdfkit jszip
npm install @supabase/supabase-js stripe
```

**Step 3: Initialize frontend**
```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install zustand @supabase/supabase-js
npm install -D tailwindcss
```

**Step 4: Run database migrations in Supabase**
Apply the SQL schema from `claude.md` (audits, audit_results, audit_reports tables).

### Running the Project (Once Implemented)

```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev

# Tests
npm run test        # Vitest unit tests
npm run test:e2e    # Integration tests
```

---

## Code Conventions

### TypeScript

- **Strict mode** — always use `as const` for literal type narrowing on severity/validation_layer
- **No `any`** — use proper types from `types/audit.ts`
- **Pure functions** for validation rules — no side effects, no external calls
- **Interfaces over types** for object shapes (e.g., `RuleInterpretation`)
- **Named exports** for all rules and utilities (no default exports on rule files)

### Validation Rules

- Each rule lives in `validation-rules.ts` and is a named export (all caps `SNAKE_CASE`)
- Rules are pure functions — `(auditData: AuditData) => ValidationResult`
- `technical_details.evidence` is always a `string[]` for rendering in reports
- Do NOT add side effects or async logic to rule `test()` functions
- Severity must be one of: `'critical' | 'high' | 'medium' | 'low'`

### API Design

- **Async job pattern**: `POST /start` returns immediately with `audit_id`; client polls `GET /:id` until `status === 'completed'`
- Poll interval: 2 seconds from frontend
- All endpoints authenticated via `authMiddleware.ts`
- Request/response shapes must match the contracts in `claude.md` exactly

### Frontend Components

- **Pages** in `src/pages/` — route-level components
- **Components** in `src/components/audit/`, `common/`, `layout/`
- **Hooks** in `src/hooks/` — `useAudit.ts`, `useReport.ts`
- **State** via Zustand in `src/store/auditStore.ts`
- **API calls** only through `src/lib/api/auditApi.ts` (never call fetch directly in components)
- Report pages receive data as props from parent `AuditReport.tsx` — no direct API calls in sub-pages

### Database

- All DB queries go through `src/services/database/queries.ts`
- Never write raw SQL in route handlers
- Use Supabase service role key only in backend (never expose in frontend)
- Store raw validation results in `audit_results` and final formatted report in `audit_reports`

### Scoring

The 4 scores must be calculated exactly as:
1. **Conversion Signal Health (0–100)** — `(passing rules / 26) * 100`
2. **Attribution Risk** — `'Low' | 'Medium' | 'High' | 'Critical'` based on gclid/fbclid/transaction_id capture
3. **Optimization Strength** — `'Weak' | 'Moderate' | 'Strong'` based on user_data field completeness
4. **Data Consistency Score** — `'Low' | 'Medium' | 'High'` based on event_id deduplication

---

## Environment Variables

### Frontend (`frontend/.env`)
```
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
```

> Never commit `.env` files. Never use `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

---

## Testing Strategy

### Unit Tests (Vitest)
- Test each of the 26 validation rules with mock `AuditData`
- Test scoring calculations with known inputs
- Test `rule-interpretations.ts` helper functions

### Integration Tests
- Full audit flow: start → browserbase → validation → scoring → report
- DB persistence: audit records saved correctly
- Export: PDF and JSON are valid and complete

### Manual Testing (Per Sprint)
- Sprint 1: Run audit on a test site, verify Browserbase captures dataLayer + network requests
- Sprint 2: Verify scores are reasonable against a known-broken tracking setup
- Sprint 3: Share PDF report with a non-technical person, verify they understand it

---

## Business Rules to Enforce

- **Rate limits**: Free = 2 audits/month, Pro = 20/month, Agency = custom. Check `profiles.plan` before queuing.
- **Severity routing**: Only `critical` and `high` issues appear in Executive Summary. All appear in Issues & Fixes.
- **PII handling**: Email and phone are captured for validation only. Hash before storing. Never log raw PII.
- **Report language**: All user-facing content must use the `business_impact` from `rule-interpretations.ts`, not raw technical details.
- **Deduplication**: `event_id` must be consistent between client and server events. Flag mismatches under `EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER`.

---

## Common Pitfalls to Avoid

1. **Don't add async logic to validation rule `test()` functions** — all data is passed in via `AuditData`; rules are synchronous.
2. **Don't expose service role key to frontend** — only the anon key belongs in `VITE_*` variables.
3. **Don't render raw `technical_details` to marketers** — always use `business_impact` from `rule-interpretations.ts`.
4. **Don't hardcode platform URLs** — GA4, Meta, Google Ads endpoint patterns are in the validation rules and should be managed there.
5. **Don't skip the interpretation layer** — every failed rule must go through `generateBusinessSummary()` before reaching the report JSON.
6. **Don't use `DashboardPage.tsx`** — it's marked for deletion; the app flow is Audit Setup → Progress → Report.

---

## Platforms Audited

| Platform | Signal Type | Rules |
|----------|-------------|-------|
| Google Analytics 4 | Purchase event, dataLayer | GA4_PURCHASE_EVENT_FIRED, DATALAYER_POPULATED |
| Meta Ads (Facebook) | Pixel, CAPI | META_PIXEL_PURCHASE_EVENT_FIRED, FBCLID_*, PHONE_CAPTURED_FOR_CAPI |
| Google Ads | Conversion event, gclid | GOOGLE_ADS_CONVERSION_EVENT_FIRED, GCLID_* |
| GTM | Container load | GTM_CONTAINER_LOADED |
| Server-side GTM | sGTM event, event_id | SGTM_SERVER_EVENT_FIRED, EVENT_ID_* |

---

## Supported Funnel Types

- `ecommerce` — Shopping cart → checkout → order confirmation
- `saas` — Trial signup → onboarding → subscription
- `lead_gen` — Landing → form submit → thank you page

---

## Git Workflow

- **Main branch:** `master`
- **Feature branches:** `claude/<description>-<session-id>`
- Commit messages should describe the specific feature or fix (not just "update files")
- Push to the designated feature branch; do not push directly to `master`

---

## Planning Mode — Feature Overview

Planning Mode is a new upstream workflow that sits *before* Audit Mode. It scans a user's website via Browserbase, uses the Claude API to analyse page structure and recommend what to track, then generates a complete GTM container JSON, dataLayer spec, and implementation guide.

### How Planning Mode Relates to Audit Mode

```
Planning Mode → (developer implements tracking) → Audit Mode
"What should I track?"                            "Is my tracking working?"
```

### Planning Mode Architecture

```
Frontend (React) — 7-step wizard
  → Step 1: Site URL + business context + platform selection
  → Step 2: Manual page URL entry
  → Step 3: Scanning progress (polls backend)
  → Step 4: Review AI recommendations (annotated screenshots)
  → Step 5: Tracking plan summary
  → Step 6: Generated outputs (preview + download)
  → Step 7: Download + handoff to Audit Mode

Backend (Node.js/Express)
  → POST /api/planning/sessions    — Create session, enqueue scan job
  → GET  /api/planning/sessions/:id — Poll session status
  → GET  /api/planning/sessions/:id/recommendations — Get AI recommendations
  → PATCH /api/planning/sessions/:id/recommendations/:id — Record user decision
  → POST /api/planning/sessions/:id/generate — Generate output files
  → GET  /api/planning/sessions/:id/outputs — List outputs
  → POST /api/planning/sessions/:id/handoff — Create Journey + start Audit

Page Capture Engine (Browserbase)
  → Visit each URL → extract simplified DOM + screenshot
  → Detect existing tracking (from PLATFORM_SCHEMAS)
  → Return PageCapture object to AI layer

AI Analysis Layer (Claude API — claude-haiku-4-5-20251001)
  → Input: screenshot + simplified DOM + business context
  → Output: RecommendedElement[] with selectors, action types, confidence scores

Output Generators
  → GTM Container JSON (importable, exportFormatVersion: 2)
  → DataLayer Spec (per-page code snippets, extends existing gtmDataLayer.ts)
  → Implementation Guide (standalone HTML, readable by non-technical users)
  → WalkerOS flow.json (optional)
```

### Planning Mode Key Files

**Backend:**
- `backend/src/types/planning.ts` — All Planning Mode TypeScript interfaces
- `backend/src/services/planning/pageCaptureService.ts` — Page capture (reuses `browserbase/client.ts`)
- `backend/src/services/planning/domSimplifier.ts` — DOM → ≤15K token simplified tree
- `backend/src/services/planning/aiAnalysisService.ts` — Claude API client + prompts
- `backend/src/services/planning/sessionOrchestrator.ts` — Multi-page scan orchestration
- `backend/src/services/planning/generators/gtmContainerGenerator.ts` — GTM import JSON
- `backend/src/services/planning/generators/dataLayerSpecGenerator.ts` — Developer spec
- `backend/src/services/planning/generators/implementationGuideGenerator.ts` — HTML guide
- `backend/src/services/planning/generators/outputGenerator.ts` — Orchestrates all generators
- `backend/src/services/database/planningQueries.ts` — All Planning Mode DB CRUD
- `backend/src/api/routes/planning.ts` — All `/api/planning/*` endpoints

**Frontend:**
- `frontend/src/types/planning.ts` — Frontend Planning Mode types
- `frontend/src/store/planningStore.ts` — Zustand state (currentSession, pages, recommendations, outputs, currentStep)
- `frontend/src/lib/api/planningApi.ts` — Planning API client
- `frontend/src/pages/PlanningDashboard.tsx` — Session list
- `frontend/src/pages/PlanningModePage.tsx` — 7-step wizard container
- `frontend/src/components/planning/AnnotatedScreenshot.tsx` — Screenshot with numbered highlight overlay
- `frontend/src/components/planning/RecommendationCard.tsx` — Approve/skip/edit card
- `frontend/src/components/planning/Step1PlanningSetup.tsx` — URL + context + platforms
- `frontend/src/components/planning/Step2PageDiscovery.tsx` — Manual URL entry
- `frontend/src/components/planning/Step3ScanningProgress.tsx` — Real-time scan progress
- `frontend/src/components/planning/Step4ReviewRecommendations.tsx` — Review UI
- `frontend/src/components/planning/Step5TrackingPlanSummary.tsx` — Pre-generation summary
- `frontend/src/components/planning/Step6GeneratedOutputs.tsx` — Output preview + download
- `frontend/src/components/planning/Step7DownloadAndHandoff.tsx` — Final screen + audit handoff

**Database:**
- `db/migrations/003_create_planning_tables.sql` — planning_sessions, planning_pages, planning_recommendations, planning_outputs

### What Planning Mode Reuses from Existing Code

| Need | Existing Component | How |
|------|--------------------|-----|
| Browserbase sessions | `services/browserbase/client.ts` | Direct import |
| Platform detection | `services/journey/platformSchemas.ts` | Import PLATFORM_SCHEMAS |
| Action vocabulary | `services/journey/actionPrimitives.ts` | Import ACTION_PRIMITIVES |
| DataLayer snippets | `services/journey/generators/gtmDataLayer.ts` | Extend for Planning output |
| WalkerOS output | `services/journey/generators/walkerosFlow.ts` | Adapt for recommendations input |
| Auth middleware | `api/middleware/authMiddleware.ts` | Direct reuse |
| Rate limiting | `api/middleware/auditLimiter.ts` | Extend with planning limits |
| Supabase client | `services/database/supabase.ts` | Direct reuse |
| Journey creation | `services/database/journeyQueries.ts` | Used in handoff endpoint |
| Sidebar + Layout | `components/layout/` | Extend with Planning nav item |
| Common badges | `components/common/` | Direct reuse |
| Zustand pattern | `store/auditStore.ts` | Mirror for planningStore |
| API client pattern | `lib/api/auditApi.ts` | Mirror for planningApi |

### Planning Mode Environment Variables

**Backend — add to `backend/.env` and `backend/src/config/env.ts`:**
```
ANTHROPIC_API_KEY=sk-ant-xxx
```

### Planning Mode Sprint Reference

| Sprint | Weeks | Focus |
|--------|-------|-------|
| PM-1 | 1–2 | Page Capture Engine + Claude API |
| PM-2 | 3–4 | Session Orchestration + Backend API |
| PM-3 | 5–6 | GTM Container + Output Generators |
| PM-4 | 7–8 | Frontend Steps 1–3 |
| PM-5 | 9–10 | Frontend Steps 4–7 + Audit Handoff |

Full sprint plan: `docs/planning-mode-sprint-plan.md`
Task checklist: `docs/planning-mode-tasks.md`
Migration SQL: `docs/planning-mode-migrations.md`

### Planning Mode Business Rules

- **Rate limits:** Free = 1 planning session/month, Pro = 10/month, Agency = unlimited
- **Max pages per session:** 10 (MVP)
- **AI model:** `claude-haiku-4-5-20251001` (cost target: ~$0.13 per session)
- **Screenshot format:** JPEG at 80% quality, 1280×800 viewport
- **DOM token limit:** Hard cap at 15,000 tokens for Claude API input
- **Confidence threshold:** Recommendations with confidence ≥ 0.8 can be batch-approved
- **GTM format:** `exportFormatVersion: 2` (GTM export format as of 2025)
- **Annotated screenshots UI:** Desktop-only (≥1024px). Show warning banner on mobile.
- **Handoff:** Creates a Journey in the Journey Builder matching the approved recommendations; user reviews before running audit

### Common Planning Mode Pitfalls to Avoid

1. **Don't store screenshots as binary in DB** — upload to Supabase Storage `planning-screenshots` bucket; store only the path
2. **Don't conflate GTM Container JSON with GTM dataLayer snippets** — these are different outputs. The container JSON is the importable file; the dataLayer spec is human-readable code for developers.
3. **Don't call Claude API synchronously in the route handler** — all page scanning is async (Bull job queue). The route returns a session ID immediately; UI polls for status.
4. **Don't use `dangerouslySetInnerHTML` for user-supplied content** — the implementation guide HTML is Atlas-generated (safe). Never render user-supplied HTML.
5. **Don't skip the handoff journey review step** — the auto-created Journey from handoff may have incorrect stage types. Always send users to the Journey Builder to review before running the audit.

---

## Key Reference Points

| What you need | Where to find it |
|---------------|-----------------|
| All 26 validation rules (logic) | `validation-rules.ts` |
| Business impact wording | `rule-interpretations.ts` |
| Full implementation guide | `claude.md` |
| API endpoint contracts | `claude.md` → "API Endpoints" section |
| Database schema SQL | `claude.md` → "Database Schema" section |
| File structure with annotations | `claude.md` → "File Structure" section |
| Sprint-by-sprint task breakdown | `claude.md` → "90-Day Sprint Plan" section |
| Code pattern examples | `claude.md` → "Code Patterns" section |
| Planning Mode sprint plan | `docs/planning-mode-sprint-plan.md` |
| Planning Mode task checklist | `docs/planning-mode-tasks.md` |
| Planning Mode database migrations | `docs/planning-mode-migrations.md` |
| Planning Mode PRD | `ATLAS_Planning_Mode_PRD.md` |
