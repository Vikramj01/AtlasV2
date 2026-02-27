# Atlas Sprint Plan — 90-Day Development Roadmap

**Product:** Atlas Signal Integrity Auditor
**Timeline:** 6 × 2-week sprints (12 weeks / ~90 days)
**Stack:** React 19 + Node.js/Express + Supabase + Browserbase
**Goal:** Working MVP that a non-technical marketer can use to audit their conversion tracking

---

## Sprint Overview

| Sprint | Weeks | Focus | Deliverable |
|--------|-------|-------|-------------|
| 1 | 1–2 | Project foundation & infrastructure | Monorepo running, DB live, auth working |
| 2 | 3–4 | Browserbase integration & data capture | End-to-end journey simulation captures raw data |
| 3 | 5–6 | Validation engine (26 rules) | All rules running against captured data |
| 4 | 7–8 | Scoring & interpretation engine | 4 scores calculated, business impact mapped |
| 5 | 9–10 | Frontend audit flow | Audit Setup → Progress → Report skeleton |
| 6 | 11–12 | Report UI, export, rate limiting | Full 5-page report, PDF/JSON export, launch-ready |

---

## Sprint 1 — Foundation & Infrastructure (Weeks 1–2)

**Goal:** Get the skeleton running. Auth, database, and job queue live before any feature work.

### Backend Tasks

#### S1-B1: Initialize monorepo structure
- Create `frontend/` and `backend/` directories
- Add root `package.json` with workspaces
- Configure `tsconfig.json` for both packages (strict mode, `esModuleInterop`, `paths`)
- Add `.gitignore` (node_modules, dist, .env files)

#### S1-B2: Express server setup
- Scaffold `backend/src/app.ts`, `server.ts`, `index.ts`
- Add middleware: `cors`, `express.json()`, `helmet`
- Add basic health check: `GET /health → { status: 'ok' }`
- Configure `nodemon` for dev reload

#### S1-B3: Supabase database setup
- Create Supabase project
- Run migration SQL from `claude.md` (audits, audit_results, audit_reports tables)
- Add indexes on `audits.user_id`, `audit_results.audit_id`
- Configure Row Level Security (RLS) on all tables — users can only read their own rows
- Create `backend/src/services/database/supabase.ts` client singleton

#### S1-B4: Supabase Auth middleware
- Create `backend/src/api/middleware/authMiddleware.ts`
- Verify Supabase JWT on every protected route
- Attach `req.user` (user_id, email, plan) for downstream use
- Return `401` if token missing or invalid

#### S1-B5: Redis + Bull job queue
- Spin up Redis instance (local Docker for dev, managed for prod)
- Create `backend/src/services/queue/jobQueue.ts`
- Define `audit` queue with Bull
- Add placeholder worker that logs job receipt
- Test: enqueue a dummy job and confirm worker processes it

#### S1-B6: Rate limiter middleware
- Create `backend/src/api/middleware/auditLimiter.ts`
- Query `audits` table to count audits this month per user
- Enforce: Free = 2/month, Pro = 20/month
- Return `429` with clear message when limit exceeded

#### S1-B7: Config & environment setup
- Create `backend/src/config/env.ts` — validate all required env vars on startup, crash fast if missing
- Create `backend/.env.example` with all required keys documented
- Create `frontend/.env.example`

#### S1-B8: Logger utility
- Create `backend/src/utils/logger.ts` using `pino` or similar
- Structured JSON logging (level, message, context)
- Never log PII (email, phone, raw user data)

### Frontend Tasks

#### S1-F1: Initialize React 19 + Vite + TypeScript
- Scaffold with `npm create vite@latest frontend -- --template react-ts`
- Configure `tsconfig.json` (strict, path aliases `@/` → `src/`)
- Install and configure Tailwind CSS
- Install Zustand and Supabase JS client

#### S1-F2: Supabase Auth integration
- Configure Supabase client in `src/lib/supabase.ts`
- Add login/signup pages (reuse from existing build if available)
- Protect all audit routes — redirect unauthenticated users to login
- Store session in Zustand or Supabase's built-in session management

#### S1-F3: Basic routing
- Set up React Router with routes: `/`, `/audit`, `/report/:auditId`, `/settings`
- Add `Navigation.tsx` with simplified header (no Phase 0–4 items)
- Delete or disable `DashboardPage.tsx` and all Phase 0–4 components

#### S1-F4: API client foundation
- Create `src/lib/api/auditApi.ts`
- Add typed fetch wrapper that attaches auth token to every request
- Export: `startAudit()`, `getAuditStatus()`, `getAuditReport()`, `exportAudit()`
- All functions return typed responses matching the contracts in `claude.md`

### Sprint 1 Acceptance Criteria

- [ ] `GET /health` returns `200 { status: 'ok' }`
- [ ] Authenticated user can hit a protected route; unauthenticated gets `401`
- [ ] Database tables exist in Supabase with RLS enabled
- [ ] Bull worker starts and processes a test job
- [ ] Rate limiter rejects a user who has exceeded their monthly limit
- [ ] Frontend builds without errors (`npm run build`)
- [ ] Login → redirect to `/audit` works end-to-end

---

## Sprint 2 — Browserbase Integration & Data Capture (Weeks 3–4)

**Goal:** Simulate a user journey and capture all raw tracking data needed for validation.

### Backend Tasks

#### S2-B1: Browserbase client setup
- Install `browserbase` npm package
- Create `backend/src/services/browserbase/client.ts`
- Initialize with `BROWSERBASE_API_KEY`
- Test: create a session, navigate to a URL, close session

#### S2-B2: Journey configuration
- Create `backend/src/services/browserbase/journeyConfigs.ts`
- Define journey steps per funnel type:
  ```
  ecommerce:  landing → product → cart → checkout → confirmation
  saas:       landing → signup → onboarding → dashboard
  lead_gen:   landing → form → thank-you
  ```
- Each step includes: URL pattern, wait conditions, actions (click add-to-cart, fill form, etc.)
- For MVP: user provides explicit URLs for each step (no auto-detection)

#### S2-B3: Synthetic click ID injection
- On landing page navigation, inject synthetic `gclid` and `fbclid` into the URL
- Store injected values in session context for later persistence validation
- Format: `gclid=test_gclid_<timestamp>`, `fbclid=test_fbclid_<timestamp>`

#### S2-B4: dataLayer event capture
- Intercept `window.dataLayer.push` calls via Browserbase page evaluation
- Collect all events across every journey step
- Store as array of `{ event, timestamp, step, payload }` objects

#### S2-B5: Network request interception
- Configure Browserbase to intercept all outbound network requests
- Filter and capture requests matching:
  - `analytics.google.com` (GA4)
  - `facebook.com/tr` (Meta Pixel)
  - `googleads.g.doubleclick.net`, `google.com/pagead` (Google Ads)
  - sGTM server URL (user-configurable)
  - `gtm.js` (GTM container load)
- For each request, capture: `{ url, method, body, headers, timestamp, step }`

#### S2-B6: Cookie & localStorage capture
- After each journey step, capture:
  - Cookies: `_ga`, `_fbp`, `_fbc`, `gclid` storage, `fbclid` storage
  - localStorage keys related to tracking (configurable list)
- Store snapshot per step for persistence validation

#### S2-B7: Audit orchestrator
- Create `backend/src/services/audit/orchestrator.ts`
- Bull worker that runs when a job is dequeued:
  1. Update audit status to `'running'`
  2. Create Browserbase session
  3. Run journey simulator (S2-B8)
  4. Capture all data (dataLayer, network, cookies)
  5. Store raw `AuditData` in audit record
  6. Trigger validation (Sprint 3)
  7. Update status to `'completed'` or `'failed'`
- Wrap in try/catch — on error, save `error_message` and set status `'failed'`

#### S2-B8: Journey simulator
- Create `backend/src/services/audit/journeySimulator.ts`
- Accepts: Browserbase session, funnel type, URL map
- Executes each step in sequence with configurable wait times
- Returns assembled `AuditData` object ready for validation

#### S2-B9: Audit routes (start + status)
- Create `backend/src/api/routes/audits.ts`
- `POST /api/audits/start`:
  - Validate request body (website_url, funnel_type, region, test_email, test_phone)
  - Check rate limit
  - Insert row in `audits` table with status `'queued'`
  - Enqueue Bull job with `audit_id`
  - Return `{ audit_id, status: 'queued', created_at }`
- `GET /api/audits/:audit_id`:
  - Verify audit belongs to authenticated user
  - Return `{ audit_id, status, progress, created_at, completed_at, error }`

### Sprint 2 Acceptance Criteria

- [ ] Running an audit on a test site creates a Browserbase session and navigates all steps
- [ ] `dataLayer` events from the test site are captured (at minimum: `purchase`, `page_view`)
- [ ] GA4 and Meta Pixel network requests are captured in the raw data
- [ ] Synthetic `gclid` and `fbclid` are injected on landing and appear in captured cookies
- [ ] `POST /api/audits/start` returns `audit_id` within 200ms (async)
- [ ] `GET /api/audits/:audit_id` returns correct status while job is running
- [ ] Audit record updated to `'completed'` or `'failed'` after job finishes

---

## Sprint 3 — Validation Engine (Weeks 5–6)

**Goal:** Run all 26 rules against captured `AuditData` and store structured results.

### Backend Tasks

#### S3-B1: Port validation rules to backend
- Copy `validation-rules.ts` (root) into `backend/src/services/validation/`
- Create `backend/src/types/audit.ts` with `AuditData` and `ValidationResult` interfaces
- Ensure imports resolve (remove references to `'../types/audit'` from root-level file)
- No logic changes — rules are already correct

**`AuditData` interface:**
```typescript
interface AuditData {
  audit_id: string;
  website_url: string;
  funnel_type: 'ecommerce' | 'saas' | 'lead_gen';
  region: string;
  dataLayer: DataLayerEvent[];
  networkRequests: NetworkRequest[];
  cookies: Record<string, CookieSnapshot[]>;   // per step
  localStorage: Record<string, LocalStorageSnapshot[]>;
  injected: { gclid: string; fbclid: string };
  test_email?: string;
  test_phone?: string;
}
```

#### S3-B2: Validation engine orchestrator
- Create `backend/src/services/validation/engine.ts`
- Import all 26 rule constants from validation rules file
- `runAllRules(auditData: AuditData): ValidationResult[]` — runs every rule, returns results array
- `runLayer(layer, auditData)` — runs only rules for a given layer
- Handle exceptions per rule — a throwing rule returns `status: 'warning'` with error in evidence

#### S3-B3: Layer-specific modules
- Create separate files for clarity:
  - `backend/src/services/validation/signalInitiation.ts` — Layer 1 rules (8)
  - `backend/src/services/validation/parameterCompleteness.ts` — Layer 2 rules (12)
  - `backend/src/services/validation/persistence.ts` — Layer 3 rules (6)
- Each file exports an array of rule objects for its layer

#### S3-B4: Persist validation results
- Create `backend/src/services/database/queries.ts`
- After validation engine runs, bulk-insert results into `audit_results` table
- Each row: `{ audit_id, validation_layer, rule_id, status, severity, technical_details, business_impact }`

#### S3-B5: Wire validation into orchestrator
- After journey simulation completes (S2-B7), call `runAllRules(auditData)`
- Persist all 26 results
- Update `audits.status` to `'completed'` with `completed_at` timestamp

### Test Tasks

#### S3-T1: Unit tests for all 26 rules
- Create `backend/src/services/validation/__tests__/`
- For each rule, write at minimum:
  - **Pass case:** `AuditData` that satisfies the rule
  - **Fail case:** `AuditData` that fails the rule
  - **Edge case:** empty/missing data
- Use Vitest with typed mock `AuditData` factory

#### S3-T2: Validation engine integration test
- Create a complete mock `AuditData` with known pass/fail mix
- Run `runAllRules()` and assert expected counts per layer
- Verify results shape matches `ValidationResult` interface exactly

### Sprint 3 Acceptance Criteria

- [ ] All 26 rules run without throwing on valid `AuditData`
- [ ] Pass and fail cases verified for every rule via unit tests
- [ ] Results bulk-inserted into `audit_results` table after audit completes
- [ ] Validation engine completes in < 500ms on mock data
- [ ] Malformed or missing fields in `AuditData` don't crash the engine

---

## Sprint 4 — Scoring & Interpretation Engine (Weeks 7–8)

**Goal:** Turn raw validation results into the 4 business scores and marketing-friendly report JSON.

### Backend Tasks

#### S4-B1: Scoring engine
- Create `backend/src/services/scoring/engine.ts`
- Accepts: `ValidationResult[]`
- Returns:
```typescript
interface AuditScores {
  conversion_signal_health: number;           // 0–100
  attribution_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  optimization_strength: 'Weak' | 'Moderate' | 'Strong';
  data_consistency_score: 'Low' | 'Medium' | 'High';
}
```

**Score calculation logic:**
- `conversion_signal_health` = `(passing rules / 26) * 100` rounded to integer
- `attribution_risk_level`:
  - Critical: GCLID_CAPTURED_AT_LANDING **and** FBCLID_CAPTURED_AT_LANDING **and** TRANSACTION_ID_PRESENT all fail
  - High: 2 of the 3 fail
  - Medium: 1 of the 3 fails
  - Low: all 3 pass
- `optimization_strength`:
  - Strong: EMAIL, PHONE, USER_ID, ITEMS_ARRAY all pass
  - Moderate: 2–3 pass
  - Weak: 0–1 pass
- `data_consistency_score`:
  - High: EVENT_ID_GENERATED **and** EVENT_ID_CONSISTENCY_CLIENT_TO_SERVER both pass
  - Medium: one passes
  - Low: both fail

#### S4-B2: Port interpretation engine
- Copy `rule-interpretations.ts` (root) into `backend/src/services/interpretation/`
- Create `backend/src/services/interpretation/engine.ts`
- `interpretResults(results: ValidationResult[]): InterpretedResult[]`:
  - For each failed/warning result, look up `RULE_INTERPRETATIONS[rule_id]`
  - Return enriched result with `business_impact`, `recommended_owner`, `estimated_effort`
- `generateExecutiveSummary(failedRuleIds: string[]): string` — delegates to `generateBusinessSummary()`
- `determineStatus(failedRuleIds: string[])` — delegates to `determineOverallStatus()`

#### S4-B3: Report JSON generator
- Create `backend/src/services/reporting/generator.ts`
- `generateReport(auditData, scores, interpretedResults): ReportJSON`
- Assemble the full report structure:
```typescript
interface ReportJSON {
  audit_id: string;
  generated_at: string;
  executive_summary: {
    overall_status: 'healthy' | 'partially_broken' | 'critical';
    business_summary: string;
    scores: AuditScores;
  };
  journey_stages: Array<{
    stage: string;
    status: 'pass' | 'fail' | 'warning';
    issues: string[];
  }>;
  platform_breakdown: Array<{
    platform: string;
    status: 'healthy' | 'at_risk' | 'broken';
    risk_explanation: string;
    failed_rules: string[];
  }>;
  issues: Array<{
    rule_id: string;
    severity: string;
    problem: string;
    why_it_matters: string;
    recommended_owner: string;
    fix_summary: string;
    estimated_effort: string;
  }>;
  technical_appendix: {
    validation_results: ValidationResult[];
    raw_network_requests: NetworkRequest[];
    raw_datalayer_events: DataLayerEvent[];
  };
}
```

#### S4-B4: Persist report JSON
- After generating report, insert into `audit_reports` table
- `{ audit_id, report_json }` (audit_id is UNIQUE — one report per audit)

#### S4-B5: Report API endpoint
- Add `GET /api/audits/:audit_id/report` to routes
- Verify audit belongs to authenticated user
- If `status !== 'completed'`, return `{ error: 'Audit not yet complete' }` with `409`
- Otherwise return `report_json` from `audit_reports` table

#### S4-B6: Wire scoring + interpretation into orchestrator
- After validation results are persisted:
  1. Run scoring engine
  2. Run interpretation engine
  3. Generate report JSON
  4. Persist to `audit_reports`
  5. Update `audits.status = 'completed'`

### Test Tasks

#### S4-T1: Scoring engine unit tests
- Test all boundary conditions for each score
- Test with all-pass input, all-fail input, and mixed
- Assert exact score values for known inputs

#### S4-T2: Interpretation engine unit tests
- Verify every rule_id maps to a non-empty business_impact
- Test `generateBusinessSummary()` with known failed rule sets
- Test `determineOverallStatus()` with critical vs. low-severity failures

#### S4-T3: Full pipeline integration test
- Mock AuditData → validate → score → interpret → generate report
- Assert report has all required top-level keys
- Assert `issues` array length matches failed rule count

### Sprint 4 Acceptance Criteria

- [ ] All 4 scores calculate correctly for known pass/fail inputs
- [ ] Every failed rule ID maps to a non-empty business impact string
- [ ] Report JSON persisted to `audit_reports` after audit completes
- [ ] `GET /api/audits/:audit_id/report` returns full report JSON
- [ ] Report contains no raw technical jargon at the top level (only in `technical_appendix`)
- [ ] End-to-end: trigger audit → wait for completion → fetch report → report has valid structure

---

## Sprint 5 — Frontend Audit Flow (Weeks 9–10)

**Goal:** Users can submit an audit, watch it run, and see the report skeleton.

### Frontend Tasks

#### S5-F1: Zustand audit store
- Create `src/store/auditStore.ts`
```typescript
interface AuditStore {
  currentAudit: { id: string; status: string; progress: number } | null;
  report: ReportJSON | null;
  setAudit: (audit) => void;
  setReport: (report) => void;
  clearAudit: () => void;
}
```

#### S5-F2: Audit Setup page
- Create `src/pages/AuditPage.tsx` and `src/components/audit/AuditSetup.tsx`
- Form fields:
  - Website URL (required, validated)
  - Funnel type: ecommerce / saas / lead_gen (radio/select)
  - Region: us / eu / global
  - Test email (optional)
  - Test phone (optional)
  - For ecommerce: landing URL, product URL, checkout URL, confirmation URL
- On submit: call `auditApi.start()`, store `audit_id`, navigate to progress page

#### S5-F3: `useAudit` hook
- Create `src/hooks/useAudit.ts`
- Encapsulates audit start + status polling
- Polls `GET /api/audits/:id` every 2 seconds while status is `'running'` or `'queued'`
- On `status === 'completed'`: stops polling, triggers report fetch
- On `status === 'failed'`: stops polling, surfaces error to user
- Exposes: `{ startAudit, isLoading, progress, status, error }`

#### S5-F4: Audit Progress page
- Create `src/components/audit/AuditProgress.tsx`
- Show: animated progress indicator, current status text, estimated time
- Display journey steps as they complete (e.g., "Visiting product page... ✓")
- On completion: auto-navigate to `/report/:auditId`
- On failure: show error message with retry option

#### S5-F5: `useReport` hook
- Create `src/hooks/useReport.ts`
- Fetches `GET /api/audits/:id/report` once (no polling — report is static after completion)
- Handles loading and error states
- Returns typed `ReportJSON`

#### S5-F6: Report page skeleton
- Create `src/pages/ReportPage.tsx`
- Fetch report via `useReport()` on mount
- Render placeholder sections for all 5 pages (styled cards/tabs)
- Pass `report` as props to `AuditReport.tsx` → individual page components
- Add export button (disabled, wired in Sprint 6)

#### S5-F7: Type definitions
- Create `src/types/audit.ts` with all shared frontend types
- Mirror backend `ReportJSON` interface exactly
- Export: `AuditStatus`, `FunnelType`, `Severity`, `ReportJSON`, `AuditScores`

### Sprint 5 Acceptance Criteria

- [ ] User can fill out Audit Setup form and submit
- [ ] Progress page polls correctly and shows live status
- [ ] On completion, user is automatically navigated to report page
- [ ] Report page loads and renders without crashing (even with placeholder content)
- [ ] Failed audits surface the error message clearly
- [ ] Auth is enforced — `/audit` and `/report/*` redirect unauthenticated users to login

---

## Sprint 6 — Report UI, Export & Launch Readiness (Weeks 11–12)

**Goal:** Full 5-page report, PDF/JSON export, rate limiting enforced, launch checklist complete.

### Frontend Tasks

#### S6-F1: Executive Summary page
- `src/components/audit/ReportPages/ExecutiveSummary.tsx`
- Display: overall status badge (healthy / partially broken / critical)
- 4 metric cards: Conversion Signal Health (with gauge), Attribution Risk, Optimization Strength, Data Consistency
- 1–2 sentence business summary (from `executive_summary.business_summary`)
- Color coding: green (pass), amber (warning), red (critical)

#### S6-F2: Journey Breakdown page
- `src/components/audit/ReportPages/JourneyBreakdown.tsx`
- Visual funnel: each stage as a card (Landing → Product → Checkout → Confirmation)
- Each stage shows: status icon, # issues, key failures
- Tap/click to expand details per stage

#### S6-F3: Platform Impact page
- `src/components/audit/ReportPages/PlatformImpact.tsx`
- One section per platform: GA4, Meta Ads, Google Ads, GTM, sGTM
- Show: health status, risk explanation, list of failed rules in plain English

#### S6-F4: Issues & Fixes page
- `src/components/audit/ReportPages/IssuesAndFixes.tsx`
- List all issues from `report.issues` sorted by severity (critical first)
- Each issue card: severity badge, problem statement, why it matters, recommended owner, fix summary, effort badge
- Filter by severity and platform

#### S6-F5: Technical Details page
- `src/components/audit/ReportPages/TechnicalDetails.tsx`
- Collapsed by default (accordion)
- Show: raw validation results table, network request log, dataLayer event log
- This section is for developers, not marketers — can use monospace/code formatting

#### S6-F6: Common components
- `src/components/common/StatusBadge.tsx` — colored badge for healthy/warning/critical
- `src/components/common/MetricCard.tsx` — metric display with label and visual
- `src/components/common/SeverityBadge.tsx` — low/medium/high/critical badge
- `src/components/common/ExportButton.tsx` — triggers export (wired to API)

### Backend Tasks

#### S6-B1: PDF export
- Create `backend/src/services/reporting/exportHandler.ts`
- Use Puppeteer: render the ReportPage React route to PDF
  - Alternative: use PDFKit to build PDF programmatically from report JSON
- 5-page layout matching the frontend report structure
- Include Atlas branding/header on each page

#### S6-B2: JSON export
- Serialize full `report_json` from `audit_reports` table
- Include `technical_appendix` (raw payloads)
- Return with `Content-Disposition: attachment; filename=atlas-report-<audit_id>.json`

#### S6-B3: Export API endpoint
- Add `POST /api/audits/:audit_id/export`
- Accept `{ format: 'pdf' | 'json' | 'both' }`
- For `'both'`: bundle PDF + JSON into ZIP using `jszip`
- Return file download with correct `Content-Type` and `Content-Disposition`

#### S6-B4: Progress tracking
- Add real-time progress updates (0–100%) during audit orchestration
- Update `audits.progress` column at each stage:
  - 10%: Session created
  - 25%: Journey step 1 complete
  - 50%: Journey step 2 complete
  - 75%: Validation running
  - 90%: Scoring + report generation
  - 100%: Complete
- Frontend `useAudit` hook already polls this — just needs the column populated

### QA & Launch Tasks

#### S6-Q1: End-to-end test
- Run a full audit on a real test site with known tracking issues
- Verify at least 3 specific rules fail that are expected to fail
- Verify scores are in expected ranges
- Verify PDF exports and is readable

#### S6-Q2: Non-technical user test
- Share PDF report with one person who is not a developer
- They should be able to identify: what's broken, which platform is affected, and what action to take
- No developer explanation allowed

#### S6-Q3: Rate limiting smoke test
- Create Free tier user, run 2 audits, verify 3rd is rejected with clear message
- Verify Pro tier allows 20 audits

#### S6-Q4: Security review
- Confirm RLS prevents user A from accessing user B's audits
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is never exposed to frontend
- Confirm PII (email, phone) is hashed before storage
- Confirm raw test credentials are not logged

#### S6-Q5: Launch checklist
- [ ] Browserbase account configured with production API key
- [ ] Redis instance running (managed, not local)
- [ ] Supabase migrations applied to production project
- [ ] All env vars set in production environment
- [ ] Rate limiting tested against production DB
- [ ] PDF export tested on production server
- [ ] Error monitoring set up (Sentry or equivalent)
- [ ] Browserbase cost monitoring enabled ($0.30/min — set budget alert)
- [ ] End-to-end audit on production domain passes

### Sprint 6 Acceptance Criteria

- [ ] All 5 report pages render with real data from a completed audit
- [ ] PDF export downloads a readable, formatted report
- [ ] JSON export downloads the full report including technical_appendix
- [ ] ZIP export bundles both PDF and JSON
- [ ] Rate limits enforced correctly per tier
- [ ] Non-technical user can read the report without developer help
- [ ] Security review items all resolved
- [ ] Launch checklist complete

---

## Post-MVP Backlog (v1.5+)

These are explicitly out of scope for the 90-day MVP. Do not implement during sprints above.

| Feature | Notes |
|---------|-------|
| AI-driven journey detection | Auto-detect funnel URLs without user input |
| Transmission validation layer | 2 additional validation layers |
| Compliance validation layer | GDPR/CCPA signal checks |
| Ongoing monitoring | Scheduled recurring audits |
| Benchmarking dashboard | Compare scores vs. industry average |
| WalkerOS integration | Additional event tracking layer |
| Self-hosted Playwright | Alternative to Browserbase for cost control |
| Team/agency features | Multi-user accounts, shared reports |
| Audit history & trending | Score changes over time |

---

## Dependencies Map

```
Sprint 1 (infra)
  └── Sprint 2 (Browserbase + data capture)
        └── Sprint 3 (validation engine)
              └── Sprint 4 (scoring + interpretation + report JSON)
                    ├── Sprint 5 (frontend, uses API from S4)
                    └── Sprint 6 (export, uses report JSON from S4)
```

Sprints 5 and 6 can begin once Sprint 4's `GET /api/audits/:id/report` endpoint is working. Frontend development for Sprint 5 can start in parallel with Sprint 4 backend work using mocked API responses.

---

## Key Files to Create Per Sprint

| Sprint | Key new files |
|--------|--------------|
| 1 | `backend/src/app.ts`, `server.ts`, `config/env.ts`, `middleware/authMiddleware.ts`, `middleware/auditLimiter.ts`, `services/database/supabase.ts`, `services/queue/jobQueue.ts` |
| 2 | `services/browserbase/client.ts`, `journeyConfigs.ts`, `services/audit/orchestrator.ts`, `journeySimulator.ts`, `dataCapture.ts`, `api/routes/audits.ts` |
| 3 | `services/validation/engine.ts`, `signalInitiation.ts`, `parameterCompleteness.ts`, `persistence.ts`, `types/audit.ts` |
| 4 | `services/scoring/engine.ts`, `services/interpretation/engine.ts`, `services/reporting/generator.ts` |
| 5 | `src/store/auditStore.ts`, `src/pages/AuditPage.tsx`, `src/hooks/useAudit.ts`, `src/hooks/useReport.ts`, `src/pages/ReportPage.tsx`, `src/types/audit.ts` |
| 6 | All 5 `ReportPages/*.tsx`, `common/*.tsx`, `services/reporting/exportHandler.ts` |
