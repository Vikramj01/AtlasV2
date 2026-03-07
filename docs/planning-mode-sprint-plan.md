# Atlas Planning Mode — Integration Sprint Plan

**Document Type:** Implementation Sprint Plan
**Created:** 2026-03-07
**Feature:** Planning Mode (ATLAS_Planning_Mode_PRD.md)
**Assigned Developer:** Vikram (+ Claude Code)
**Target:** 5 x 2-week sprints (10 weeks total)

---

## Executive Summary

Planning Mode is a new upstream workflow in Atlas that sits *before* the existing Audit Mode. It uses an AI agent (Claude API via Browserbase page analysis) to help non-technical users plan their tracking implementation from scratch, then generates a complete dataLayer specification, GTM container JSON (importable), and implementation guide.

This sprint plan integrates Planning Mode into the substantially-complete Atlas v2 codebase. Sprints 1–4 of the original Atlas roadmap are complete. The Journey Builder (which shares Action Primitives, Platform Schemas, and the GTM dataLayer spec generator with Planning Mode) is fully implemented.

---

## Codebase Snapshot (as of Sprint Plan creation)

### What's Already Built

The following existing components can be **directly reused** by Planning Mode:

| Component | File Path | Reuse |
|-----------|-----------|-------|
| Browserbase session manager | `backend/src/services/browserbase/client.ts` | Direct — `createBrowserbaseSession()` + `getCDPUrl()` |
| Platform detection schemas | `backend/src/services/journey/platformSchemas.ts` | Direct — `PLATFORM_SCHEMAS` for detecting existing tracking |
| Action primitives | `backend/src/services/journey/actionPrimitives.ts` | Direct — event/action definitions for recommendations |
| GTM dataLayer snippets | `backend/src/services/journey/generators/gtmDataLayer.ts` | Extend — reuse per-event code snippets for spec output |
| WalkerOS flow generator | `backend/src/services/journey/generators/walkerosFlow.ts` | Direct — optional output format |
| Auth middleware | `backend/src/api/middleware/authMiddleware.ts` | Direct reuse on all new routes |
| Rate limit middleware | `backend/src/api/middleware/auditLimiter.ts` | Extend — add planning session limits per plan tier |
| Supabase client | `backend/src/services/database/supabase.ts` | Direct reuse |
| Bull/Redis job queue | `backend/src/services/queue/jobQueue.ts` | Extend — add `planning-session` queue |
| Pino logger | `backend/src/utils/logger.ts` | Direct reuse |
| AppLayout + Sidebar | `frontend/src/components/layout/` | Extend — add Planning Mode nav item |
| ScoreCard, HealthBadge | `frontend/src/components/common/` | Direct reuse |
| Zustand store pattern | `frontend/src/store/auditStore.ts` | Mirror pattern for `planningStore.ts` |
| API client pattern | `frontend/src/lib/api/auditApi.ts` | Mirror pattern for `planningApi.ts` |
| Supabase frontend client | `frontend/src/lib/supabase.ts` | Direct reuse |
| TypeScript types for Journey | `backend/src/types/journey.ts` | Extend — add Planning Mode types |

### What Needs to be Built New

**Backend:**
- Page Capture Engine (DOM extraction, screenshots, form detection, existing tracking detection)
- DOM simplifier (reduce raw DOM to ~15,000 tokens for Claude API)
- Claude API client + AI analysis layer (prompt engineering, response parsing)
- Planning Mode session orchestrator
- GTM Container JSON generator (the importable GTM file — distinct from the existing dataLayer snippet generator)
- Implementation guide generator (HTML)
- Planning Mode API routes (`/api/planning/*`)
- Planning Mode database queries
- Planning Mode job queue worker

**Frontend:**
- Planning Mode multi-step wizard (7 steps)
- Annotated screenshot component (key visual — numbered highlight boxes over screenshots)
- Recommendation review UI (approve/skip/edit per element)
- Generated outputs viewer
- Download screen with Audit Mode handoff
- Planning Mode Zustand store
- Planning Mode API client

**Database (Supabase migrations):**
- `planning_sessions` table
- `planning_pages` table
- `planning_recommendations` table
- `planning_outputs` table

**Infrastructure:**
- `ANTHROPIC_API_KEY` environment variable
- `@anthropic-ai/sdk` npm package in backend

---

## Dependency Map

```
Page Capture Engine
  └── Claude API Integration (AI Analysis Layer)
        └── Planning Session Orchestrator
              ├── Planning DB schema
              ├── Recommendation storage
              └── User Decision recording
                    └── Output Generators
                          ├── GTM Container JSON Generator
                          ├── DataLayer Spec (extend existing)
                          └── Implementation Guide Generator
                                └── Download routes
                                      └── Audit Mode handoff
```

**Frontend dependency chain:**
```
planningStore.ts + planningApi.ts
  └── PlanningDashboard (session list)
        └── Step 1: PlanningSetup
              └── Step 2: PageDiscovery
                    └── Step 3: ScanningProgress (polling)
                          └── Step 4: ReviewRecommendations + AnnotatedScreenshot
                                └── Step 5: TrackingPlanSummary
                                      └── Step 6: GeneratedOutputs
                                            └── Step 7: DownloadScreen (+ handoff)
```

---

## Sprint PM-1: Page Capture Engine + Claude API Integration (Weeks 1–2)

### Sprint Goal
By end of sprint: run a Node.js script that visits a URL via Browserbase, extracts a simplified DOM + screenshot, sends it to Claude API, and receives structured tracking recommendations in JSON — verifiable in the console.

### Prerequisites
- Access to Browserbase API key (already in `.env`)
- Anthropic API key
- Existing Browserbase client (`backend/src/services/browserbase/client.ts`) is working

### Tasks

- [ ] **PM-1.1 — Add `@anthropic-ai/sdk` dependency**
  - Files to modify: `backend/package.json`
  - Command: `cd backend && npm install @anthropic-ai/sdk`
  - Also add `ANTHROPIC_API_KEY` to `backend/src/config/env.ts` (required field) and backend `.env`
  - Estimate: 1 hour
  - Acceptance criteria: `import Anthropic from '@anthropic-ai/sdk'` compiles without error

- [ ] **PM-1.2 — Add Planning Mode types to backend types**
  - Files to create: `backend/src/types/planning.ts`
  - Define interfaces: `PlanningSession`, `PlanningPage`, `PageCapture`, `SimplifiedDOMNode`, `InteractiveElement`, `FormCapture`, `ExistingTracking`, `AIAnalysisRequest`, `AIAnalysisResponse`, `RecommendedElement`, `UserDecision`, `PlanningOutput`
  - Mirror the interface shapes from `ATLAS_Planning_Mode_PRD.md` Section 3 exactly
  - Estimate: 2 hours
  - Acceptance criteria: All interfaces compile; no `any` types

- [ ] **PM-1.3 — Build Page Capture Engine**
  - Files to create: `backend/src/services/planning/pageCaptureService.ts`
  - Reuse: `createBrowserbaseSession()` + `getCDPUrl()` from `backend/src/services/browserbase/client.ts`
  - Functionality:
    - Connect to Browserbase via CDP (reuse pattern from `stageSimulator.ts`)
    - Navigate to provided URL
    - Take full-page screenshot (`page.screenshot({ fullPage: false, type: 'jpeg', quality: 80 })`)
    - Extract page title, meta description, h1/h2 text (first 5 of each)
    - Detect existing tracking scripts by checking `PLATFORM_SCHEMAS[*].detection.script_patterns` against page source (reuse `platformSchemas.ts`)
    - Detect existing tracking network calls (monitor requests, match against `PLATFORM_SCHEMAS[*].detection.network_patterns`)
    - Extract interactive elements: buttons with text, links with text, input fields (type, placeholder, label)
    - Extract forms: form elements with their fields
    - Return a `PageCapture` object
  - Estimate: 8 hours
  - Acceptance criteria: Call `capturePage('https://example.com')` → returns `PageCapture` with screenshot buffer, title, existing tracking detected, interactive elements list

- [ ] **PM-1.4 — Build DOM Simplifier**
  - Files to create: `backend/src/services/planning/domSimplifier.ts`
  - Input: `playwright.Page` object
  - Output: `SimplifiedDOMNode[]` array (≤15,000 tokens when JSON-serialised)
  - Rules (from PRD Section 3):
    - Include: headings (h1–h3), navigation links, buttons, form elements, elements with `data-*` attributes, elements with GTM-style `id`s
    - Exclude: `<style>`, `<script>`, `<svg>`, `<!-- comments -->`, deeply nested identical elements
    - Deduplicate: if >3 sibling nodes with same tag + same class structure, keep 1 with a note `(×N more)`
    - Truncate text content to 80 characters
    - Strip inline styles and non-semantic attributes (keep: `id`, `class`, `href`, `type`, `name`, `placeholder`, `data-*`)
  - Estimate: 5 hours
  - Acceptance criteria: Output JSON for a mid-sized ecommerce page stays under 15,000 tokens

- [ ] **PM-1.5 — Build Claude API Analysis Layer**
  - Files to create: `backend/src/services/planning/aiAnalysisService.ts`
  - Set up Anthropic client using `env.ANTHROPIC_API_KEY`
  - Write system prompt: instructs Claude to act as a conversion tracking expert analyzing site pages, output structured JSON recommendations
  - Write user prompt template: includes page URL, page type guess, business type, existing tracking found, simplified DOM tree, screenshot (base64)
  - Call `anthropic.messages.create()` with model `claude-haiku-4-5-20251001` (cost-efficient for analysis)
  - Parse the JSON response into `AIAnalysisResponse` type
  - Add retry logic: up to 3 retries on API errors with 2s backoff
  - Add cost tracking: log input/output token counts per call
  - Estimate: 6 hours
  - Acceptance criteria: Send a real page capture to Claude API → receive structured `RecommendedElement[]` array with selector, action_type, business_justification, confidence_score

- [ ] **PM-1.6 — Write AI analysis prompt (iterate until high quality)**
  - Files to modify: `backend/src/services/planning/aiAnalysisService.ts` (the prompts)
  - Test against 3 different page types: ecommerce product page, SaaS pricing page, lead gen contact form
  - Expected output quality: recommendations match what a senior tracking engineer would suggest (purchase event on checkout, sign_up on form submit, etc.)
  - Tune prompt if results are too generic or miss obvious elements
  - Estimate: 4 hours
  - Acceptance criteria: For a standard ecommerce checkout page, Claude recommends a `purchase` event with all required fields (transaction_id, value, currency, items) and rates confidence ≥ 0.8

- [ ] **PM-1.7 — Create dev test script**
  - Files to create: `backend/src/scripts/testPageCapture.ts`
  - A standalone script (not a unit test) that: creates a Browserbase session → captures a page → runs DOM simplifier → calls Claude API → logs the recommendations
  - Run with: `npx ts-node src/scripts/testPageCapture.ts https://example.com ecommerce`
  - Estimate: 2 hours
  - Acceptance criteria: Running the script prints structured recommendations to console with no errors

### Sprint Deliverable
A runnable script that given a URL and business type: visits the page via Browserbase, extracts a simplified DOM + screenshot, sends to Claude API, and returns structured element recommendations — all verifiable in the console/logs.

### Technical Decisions to Make During This Sprint
1. **Claude model choice**: `claude-haiku-4-5-20251001` (fast/cheap) vs `claude-sonnet-4-6` (higher quality). Start with Haiku; upgrade to Sonnet if recommendation quality is insufficient. The PRD budgets ~$0.13/session.
2. **Screenshot format**: JPEG at 80% quality vs PNG. JPEG is smaller (important for API token limits); PNG is lossless. Use JPEG.
3. **How to handle SPAs**: Some sites use client-side routing. The page capture should wait for `networkidle` state before extracting DOM. Test against a Next.js site.
4. **Screenshot in prompt**: Claude's vision via base64 or URL. Use base64 (simpler, no storage needed at this stage); store screenshots to Supabase Storage in PM-2.

### Risks
- **Browserbase CDP session drops**: The existing audit engine has this same risk; handle with the same timeout/retry pattern from `stageSimulator.ts`
- **Claude API response not valid JSON**: Wrap in a try/catch and ask Claude to retry with a stricter prompt if parsing fails
- **DOM still too large after simplification**: Add a secondary truncation pass targeting 12,000 tokens as a hard cap

---

## Sprint PM-2: Session Orchestration + Backend API (Weeks 3–4)

### Sprint Goal
By end of sprint: a complete backend API for Planning Mode — create session → pages are scanned → recommendations returned via polling — fully testable via Postman or curl with a real Supabase + Browserbase connection.

### Prerequisites
- Sprint PM-1 complete (Page Capture Engine + Claude API integration working)
- `ANTHROPIC_API_KEY` added to backend `.env`

### Tasks

- [ ] **PM-2.1 — Database migration: Planning Mode tables**
  - Files to create: `db/migrations/003_create_planning_tables.sql`
  - Tables (match PRD Section 5 schema exactly):
    - `planning_sessions` — session metadata, status, context
    - `planning_pages` — pages within a session (URL, page_type, status, screenshot_url)
    - `planning_recommendations` — per-element recommendations + user decisions
    - `planning_outputs` — generated output files (type, content JSONB, download_url)
  - Include RLS policies: users can only read/write their own sessions
  - Include indexes: `idx_planning_sessions_user_id`, `idx_planning_pages_session_id`, `idx_planning_recommendations_page_id`, `idx_planning_outputs_session_id`
  - Full migration SQL is detailed in `docs/planning-mode-migrations.md`
  - Estimate: 3 hours
  - Acceptance criteria: Migration runs in Supabase SQL Editor without errors; all RLS policies pass the `EXPLAIN` check

- [ ] **PM-2.2 — Upload screenshots to Supabase Storage**
  - Files to modify: `backend/src/services/planning/pageCaptureService.ts`
  - After capture, upload screenshot buffer to Supabase Storage bucket `planning-screenshots`
  - Create bucket via Supabase dashboard (storage, new bucket, private)
  - Add `uploadScreenshot(sessionId: string, pageId: string, buffer: Buffer): Promise<string>` util to `backend/src/services/database/supabase.ts`
  - Estimate: 2 hours
  - Acceptance criteria: Screenshot URLs stored in `planning_pages.screenshot_url`, accessible via signed URL

- [ ] **PM-2.3 — Build Planning Mode database queries**
  - Files to create: `backend/src/services/database/planningQueries.ts`
  - Functions: `createSession`, `getSession`, `listSessions`, `updateSessionStatus`, `createPage`, `updatePage`, `createRecommendations`, `updateRecommendationDecision`, `createOutput`, `getOutputs`
  - Follow the same pattern as `backend/src/services/database/journeyQueries.ts`
  - Estimate: 4 hours
  - Acceptance criteria: All CRUD functions have TypeScript types; no raw SQL in route handlers

- [ ] **PM-2.4 — Build Planning Session Orchestrator**
  - Files to create: `backend/src/services/planning/sessionOrchestrator.ts`
  - Inputs: `sessionId`, user's page URLs, `businessType`, `businessDescription`, `platforms[]`
  - Flow:
    1. Update session status to `scanning`
    2. For each URL: `capturePage()` → `simplifyDOM()` → `analyzeWithAI()` → `createRecommendations()` → update page status
    3. After all pages: update session status to `review_ready`
    4. On any error: update session status to `failed` with error message
  - Parallel page scanning: process up to 3 pages concurrently (Promise.allSettled)
  - Estimate: 5 hours
  - Acceptance criteria: Orchestrator processes a 3-page session and stores all recommendations in DB; failed pages don't abort the whole session

- [ ] **PM-2.5 — Add Planning Mode job queue**
  - Files to modify: `backend/src/services/queue/jobQueue.ts`
  - Add a second Bull queue: `planningQueue` (alongside existing `auditQueue`)
  - Files to modify: `backend/src/services/queue/worker.ts`
  - Add planning job processor: pulls `sessionId` from job data → calls `sessionOrchestrator`
  - Estimate: 3 hours
  - Acceptance criteria: `planningQueue.add({ sessionId })` → orchestrator runs → session status updates in DB

- [ ] **PM-2.6 — Build Planning Mode API routes**
  - Files to create: `backend/src/api/routes/planning.ts`
  - Mount in `backend/src/app.ts` at `/api/planning`
  - Endpoints (all protected by `authMiddleware`):
    - `POST /api/planning/sessions` — Create session, enqueue job, return `{ session_id, status }`
    - `GET /api/planning/sessions` — List user's sessions
    - `GET /api/planning/sessions/:id` — Get session with pages + status
    - `GET /api/planning/sessions/:id/recommendations` — Get all recommendations for a session
    - `PATCH /api/planning/sessions/:id/recommendations/:recId` — Record user decision (approve/skip/modify)
    - `POST /api/planning/sessions/:id/generate` — Generate outputs (GTM JSON, dataLayer spec, guide)
    - `GET /api/planning/sessions/:id/outputs` — List generated outputs
    - `GET /api/planning/sessions/:id/outputs/:outputId/download` — Download a specific output file
    - `POST /api/planning/sessions/:id/handoff` — Create Journey + Audit from Planning session
  - Follow `backend/src/api/routes/journeys.ts` route structure patterns
  - Estimate: 6 hours
  - Acceptance criteria: All endpoints return correct status codes and shapes; auth is enforced (401 without token)

- [ ] **PM-2.7 — Extend rate limiter for Planning Mode**
  - Files to modify: `backend/src/api/middleware/auditLimiter.ts`
  - Add planning session limits: Free = 1 planning session/month, Pro = 10/month, Agency = unlimited
  - Apply limiter middleware to `POST /api/planning/sessions`
  - Estimate: 2 hours
  - Acceptance criteria: Free user cannot create a 2nd planning session in the same month

- [ ] **PM-2.8 — Integration test: full backend flow**
  - Method: curl/Postman sequence against dev server
  - Test flow: create session → poll status → verify `review_ready` → get recommendations → approve 3 recs → skip 1 → verify decisions saved
  - Estimate: 3 hours
  - Acceptance criteria: Full backend flow works end-to-end with real Browserbase + real Claude API calls

### Sprint Deliverable
A complete, working REST API for Planning Mode. Create a session via `POST /api/planning/sessions`, poll until `review_ready`, retrieve recommendations, record decisions. Verifiable via Postman.

### Technical Decisions to Make During This Sprint
1. **Screenshot storage**: Private Supabase Storage bucket with signed URLs (30-min expiry) vs public bucket. Use private with signed URLs — screenshots may contain sensitive site content.
2. **Job queue timeout**: Planning sessions take longer than audits (multiple pages + AI calls). Set Bull job timeout to 10 minutes vs audit's 5 minutes.
3. **Concurrent page scanning**: 3 pages in parallel is safe with Browserbase. Increase if session takes >3 minutes for 5+ pages.
4. **Recommendation auto-approval**: The PRD mentions auto-approving high-confidence (≥0.9) recommendations. Implement as a flag in the session creation body (`auto_approve_high_confidence: boolean`). Default false for MVP.

### Risks
- **Browserbase concurrency**: Running 3 simultaneous sessions may require a Pro/Enterprise Browserbase plan. Check account limits.
- **Claude API latency**: If each page analysis takes 5–8 seconds, a 5-page session could take 40+ seconds. This is fine for async jobs but should be communicated in the UI with a progress bar.

---

## Sprint PM-3: Output Generators — GTM Container + DataLayer Spec + Guide (Weeks 5–6)

### Sprint Goal
By end of sprint: given a set of approved recommendations, generate a valid GTM container JSON that can be imported into a real GTM account, a developer-ready dataLayer spec, and an HTML implementation guide — all downloadable via the API.

### Prerequisites
- Sprint PM-2 complete (session orchestration + API working)
- Access to a test GTM account to verify import
- At least 5 approved recommendations in DB to use as generator input

### Tasks

- [ ] **PM-3.1 — Build GTM Container JSON Generator**
  - Files to create: `backend/src/services/planning/generators/gtmContainerGenerator.ts`
  - Input: `approved_recommendations[]`, `session.platforms[]`, `session.business_type`
  - Output: `GTMContainerJSON` (GTM export format, `exportFormatVersion: 2`)
  - What to generate per approved event recommendation:
    - **Trigger**: Custom Event trigger matching the event name (e.g., `purchase`)
    - **Variables**: Data Layer Variable for each required parameter (`transaction_id`, `value`, `currency`, `items`, `user_data.email`)
    - **Tags** (platform-specific):
      - GA4: GA4 Event Tag wired to the trigger + variables
      - Google Ads: Google Ads Conversion Tag with enhanced conversions
      - Meta: Meta Pixel Custom Event Tag
      - TikTok: TikTok Pixel Event Tag
      - LinkedIn: LinkedIn Insight Tag event
  - Also generate: Consent Mode v2 initialization tag, GTM Self-hosted noscript fallback
  - Folder structure in GTM container: `[Atlas] Triggers`, `[Atlas] Variables`, `[Atlas] Tags`
  - Naming convention: `[Atlas] Purchase — GA4 Event`, `[Atlas] DLV — transaction_id`, etc.
  - Reference: PRD Section 7 for exact GTM JSON structure
  - **Note**: This is distinct from the existing `gtmDataLayer.ts` generator which produces human-readable code snippets. This generator produces machine-readable GTM import JSON.
  - Estimate: 10 hours
  - Acceptance criteria: Generated JSON imports into a real GTM account without errors; all tags appear in correct folders with correct names

- [ ] **PM-3.2 — GTM Container import validation**
  - Manually test the generated JSON in a GTM sandbox account
  - Verify: all tags, triggers, variables appear correctly; trigger → tag wiring is correct; tags fire in GTM preview mode against the correct event names
  - Fix any schema issues found
  - Estimate: 4 hours (testing + iteration)
  - Acceptance criteria: Zero import errors; GTM preview mode shows tags firing when test events are pushed

- [ ] **PM-3.3 — Build DataLayer Specification Generator**
  - Files to create: `backend/src/services/planning/generators/dataLayerSpecGenerator.ts`
  - Input: `approved_recommendations[]`, `session.business_type`, `session.platforms[]`
  - Output: structured spec object with per-page, per-event code snippets
  - Reuse: extend/adapt `backend/src/services/journey/generators/gtmDataLayer.ts` — the existing generator creates snippets from action primitives; this generator creates them from AI recommendations with the specific elements identified on real pages
  - Key difference: include the actual CSS selectors/element descriptions found by the AI, not just generic event templates
  - Group by page URL (from `planning_pages`)
  - Include: installation snippet (GTM container tag), per-page dataLayer.push() examples, variable naming guide
  - Format: JSON object with embedded code strings (same pattern as existing `GTMDataLayerOutput` type)
  - Estimate: 5 hours
  - Acceptance criteria: Spec output for a purchase event includes the actual selector found on the page (e.g., `#checkout-button`) and all required parameters

- [ ] **PM-3.4 — Build Implementation Guide Generator (HTML)**
  - Files to create: `backend/src/services/planning/generators/implementationGuideGenerator.ts`
  - Input: `approved_recommendations[]`, `session`, `generated_outputs`
  - Output: HTML string (rendered as a file for download)
  - Sections:
    1. Executive summary: what tracking was found, what's being added
    2. For your developer: GTM installation, dataLayer push code per page
    3. For your GTM implementer: how to import the GTM container JSON
    4. Platform-by-platform setup: GA4 property ID, Google Ads conversion label, Meta pixel ID — what to fill in
    5. Testing checklist: how to verify each event is firing
    6. What's next: link to Atlas Audit Mode to verify
  - Use inline CSS (no external dependencies) — this file must be self-contained
  - Estimate: 6 hours
  - Acceptance criteria: The HTML file opens in a browser and is readable by a non-technical marketer without any broken styles

- [ ] **PM-3.5 — Build output storage + download routes**
  - Files to modify: `backend/src/services/planning/generators/outputGenerator.ts` (create this as orchestrator)
  - `outputGenerator.ts` calls all three generators in sequence, then:
    - Stores GTM container JSON as JSONB in `planning_outputs` table (`type: 'gtm_container'`)
    - Stores dataLayer spec as JSONB in `planning_outputs` table (`type: 'datalayer_spec'`)
    - Stores implementation guide HTML as text in `planning_outputs` table (`type: 'implementation_guide'`)
    - Uploads GTM JSON to Supabase Storage as `{sessionId}/gtm-container.json` (for direct download)
    - Uploads HTML guide to Supabase Storage as `{sessionId}/implementation-guide.html`
  - Wire up download endpoint: `GET /api/planning/sessions/:id/outputs/:outputId/download` — returns the file with correct `Content-Type` and `Content-Disposition: attachment` headers
  - Estimate: 4 hours
  - Acceptance criteria: Download endpoints return valid files with correct MIME types; GTM container JSON is valid JSON; HTML guide renders in browser

- [ ] **PM-3.6 — WalkerOS flow output (optional, if time allows)**
  - Files to modify: wrap the existing `backend/src/services/journey/generators/walkerosFlow.ts`
  - Adapt to accept `approved_recommendations[]` as input instead of journey stages
  - Store as `planning_outputs` entry with `type: 'walkeros_flow'`
  - Estimate: 3 hours
  - Acceptance criteria: WalkerOS flow JSON is generated when platforms include `walkeros` in session context

- [ ] **PM-3.7 — Wire generate endpoint**
  - Files to modify: `backend/src/api/routes/planning.ts`
  - `POST /api/planning/sessions/:id/generate` — call `outputGenerator.ts`, store results, update session status to `outputs_ready`
  - Return: `{ session_id, outputs: [{ id, type, download_url }] }`
  - Estimate: 2 hours
  - Acceptance criteria: Calling the endpoint with approved recommendations → all output files stored → session status `outputs_ready`

### Sprint Deliverable
A fully working output generation pipeline. POST to `/api/planning/sessions/:id/generate` returns download URLs for a GTM container JSON (that imports into GTM), a dataLayer spec, and an HTML implementation guide.

### Technical Decisions to Make During This Sprint
1. **GTM container format version**: Use `exportFormatVersion: 2` (current GTM export format as of 2025).
2. **WalkerOS in Sprint 3 or later**: Implement if time allows (task PM-3.6 is optional). It's a nice-to-have for the MVP.
3. **Spec format**: Return spec as downloadable JSON file or inline JSON in the API response? Do both — inline for the preview UI, download for the file.
4. **Guide format**: HTML only for MVP vs PDF. HTML only (avoid PDFKit dependency complexity for this output; the existing `pdfGenerator.ts` is for audit reports).

### Risks
- **GTM JSON schema changes**: The GTM container export format could change. Pin the `exportFormatVersion: 2` spec and note it in comments.
- **GTM import failures**: The most likely cause is incorrect trigger/tag account references. Test with a fresh GTM workspace, not one with existing containers, to avoid ID collisions.
- **Output generation time**: Generating all 3 outputs might take 2–4 seconds. This is acceptable for synchronous generation (unlike page scanning which must be async). Make the generate endpoint synchronous for simplicity.

---

## Sprint PM-4: Frontend — Setup, Discovery, and Scanning Screens (Weeks 7–8)

### Sprint Goal
By end of sprint: a non-technical user can open Atlas, navigate to Planning Mode, enter their website URL and business context, add pages manually, trigger a scan, and watch a real-time progress screen — without touching the backend directly.

### Prerequisites
- Sprints PM-1 through PM-3 complete (full backend API working)
- Backend dev server running at `http://localhost:3001`
- At least one planning session in DB with `review_ready` status (for testing)

### Tasks

- [ ] **PM-4.1 — Add Planning Mode types to frontend**
  - Files to create: `frontend/src/types/planning.ts`
  - Mirror the backend types from `backend/src/types/planning.ts` (adapt for frontend use — no Node.js-specific types)
  - Types: `PlanningSession`, `PlanningPage`, `RecommendedElement`, `UserDecision`, `PlanningOutput`
  - Estimate: 2 hours
  - Acceptance criteria: All components in subsequent tasks can import types without errors

- [ ] **PM-4.2 — Create Planning Mode Zustand store**
  - Files to create: `frontend/src/store/planningStore.ts`
  - State shape:
    ```typescript
    {
      currentSession: PlanningSession | null;
      pages: PlanningPage[];
      recommendations: RecommendedElement[];
      outputs: PlanningOutput[];
      currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      isScanning: boolean;
      error: string | null;
    }
    ```
  - Actions: `setSession`, `setPages`, `setRecommendations`, `setOutputs`, `nextStep`, `prevStep`, `setError`, `reset`
  - Mirror the pattern in `frontend/src/store/auditStore.ts`
  - Estimate: 2 hours
  - Acceptance criteria: Store can be imported and used in any component; state is reset on route change

- [ ] **PM-4.3 — Create Planning Mode API client**
  - Files to create: `frontend/src/lib/api/planningApi.ts`
  - Functions: `createSession`, `listSessions`, `getSession`, `getRecommendations`, `updateDecision`, `generateOutputs`, `getOutputs`, `downloadOutput`, `createHandoff`
  - Mirror the pattern in `frontend/src/lib/api/auditApi.ts` (fetch with auth headers from Supabase session)
  - Estimate: 3 hours
  - Acceptance criteria: All functions call correct API endpoints and return typed responses

- [ ] **PM-4.4 — Add Planning Mode navigation**
  - Files to modify: `frontend/src/components/layout/Sidebar.tsx`
  - Add "Planning Mode" nav item with an appropriate icon (e.g., a map/plan icon)
  - Position it above "Audit" in the sidebar (Planning → Audit is the logical flow)
  - Files to modify: `frontend/src/App.tsx`
  - Add routes:
    - `/planning` → `PlanningDashboard` (protected)
    - `/planning/new` → `PlanningModePage` (wizard, protected)
    - `/planning/:sessionId` → `PlanningModePage` (resume session, protected)
  - Estimate: 2 hours
  - Acceptance criteria: Clicking "Planning Mode" in sidebar navigates to `/planning`; route is protected (redirects to login if unauthenticated)

- [ ] **PM-4.5 — Build PlanningDashboard page**
  - Files to create: `frontend/src/pages/PlanningDashboard.tsx`
  - Show a list of the user's planning sessions (from `GET /api/planning/sessions`)
  - Each session card: site URL, business type, status badge, number of pages, date created, CTA ("Continue" or "View Results")
  - Empty state: "No planning sessions yet" with a "Start Planning" button → `/planning/new`
  - Reuse: `HealthBadge` component for session status, `StatusBanner` for errors, `AuditHistoryTable` layout as inspiration
  - Estimate: 4 hours
  - Acceptance criteria: Page loads, shows session list from API, clicking "Start Planning" navigates to wizard

- [ ] **PM-4.6 — Build PlanningModePage (wizard container)**
  - Files to create: `frontend/src/pages/PlanningModePage.tsx`
  - 7-step wizard controlled by `planningStore.currentStep`
  - Renders the correct step component based on `currentStep`
  - Shows a step progress bar (reuse pattern from `WizardProgress.tsx` in journey builder)
  - Handles session loading if a `sessionId` param is in the URL (resume flow)
  - Estimate: 3 hours
  - Acceptance criteria: Navigating forward/back through steps works; refreshing the page resumes at the correct step if session exists

- [ ] **PM-4.7 — Build Step 1: PlanningSetup component**
  - Files to create: `frontend/src/components/planning/Step1PlanningSetup.tsx`
  - Fields:
    - Website URL (required, with validation)
    - Business type (dropdown: ecommerce, saas, lead_gen, content, marketplace)
    - Business description (textarea, optional — helps AI give better recommendations)
    - Platform toggles (GA4, Google Ads, Meta, TikTok, LinkedIn — multi-select, default GA4 + Meta)
  - On submit: `POST /api/planning/sessions` → store session in `planningStore` → advance to step 2
  - Reuse: `Step1BusinessType.tsx` from journey builder for business type selection pattern; `Step3PlatformSelector.tsx` for platform toggles
  - Estimate: 4 hours
  - Acceptance criteria: Form validates required fields; submitting creates a session and advances the wizard; platform icons match the journey builder's platform selector

- [ ] **PM-4.8 — Build Step 2: PageDiscovery component**
  - Files to create: `frontend/src/components/planning/Step2PageDiscovery.tsx`
  - For MVP: **manual URL entry only** (no auto-crawl — see PRD scope notes)
  - Allow user to add up to 10 page URLs with optional page type label (dropdown: landing, product, cart, checkout, confirmation, pricing, form, etc.)
  - Pre-populate with the base URL from step 1 as the first entry
  - Show suggested page types based on business type (e.g., for ecommerce: landing, product, checkout, confirmation)
  - "Add another page" button to add URL input rows
  - On submit: save URLs to local store state; advance to step 3 (scanning)
  - Note: Pages are saved to DB when scanning starts, not at this step
  - Estimate: 4 hours
  - Acceptance criteria: User can add/remove URL rows; at least 1 URL required to proceed; page type is optional but suggested

- [ ] **PM-4.9 — Build Step 3: ScanningProgress component**
  - Files to create: `frontend/src/components/planning/Step3ScanningProgress.tsx`
  - On mount: submit all pages to `POST /api/planning/sessions/:id` (or the session creation endpoint that accepts pages), kick off scanning job
  - Poll `GET /api/planning/sessions/:id` every 3 seconds (similar to `useAudit.ts` polling pattern)
  - Show per-page status: pending → scanning → done / failed
  - Show overall progress bar
  - Estimated time display: "~2 minutes remaining" (based on pages remaining × avg time per page)
  - When session status = `review_ready`: automatically advance to step 4
  - On error: show `StatusBanner` with error message + "Try Again" option
  - Reuse: `AuditProgressSteps.tsx` layout pattern for the progress display
  - Estimate: 5 hours
  - Acceptance criteria: Progress screen shows real-time page scanning status; auto-advances to step 4 when complete; polling stops when session is complete or failed

### Sprint Deliverable
A user can navigate to Planning Mode, fill in their site details, add pages, start a scan, and watch real-time progress — all wired to the real backend. The first 3 steps of the 7-step wizard are fully functional.

### Technical Decisions to Make During This Sprint
1. **Step state persistence**: If the user refreshes mid-wizard, do they lose progress? For step 1–2, store state in `sessionStorage` (not just Zustand) to survive refresh. Once a session is created (step 2→3), use the `sessionId` in the URL to reload from API.
2. **URL for session during wizard**: After step 1 creates the session, update the URL to `/planning/{sessionId}` so users can bookmark/share and resume.
3. **Platform selection default**: Default GA4 + Meta selected (most common combo). Users can deselect.
4. **Page type suggestions**: Auto-detect based on URL patterns (e.g., `/checkout` → `checkout`, `/product/` → `product`) as a UX enhancement.

### Risks
- **Polling performance**: 3-second polling for 10 minutes (worst case) = 200 requests per session. This is acceptable but monitor Supabase request quotas.
- **Browserbase session cost**: Each page scan uses one Browserbase session. 10 pages = 10 Browserbase sessions. This may need to be batched or a single session with multiple navigations to reduce cost.

---

## Sprint PM-5: Frontend — Review UI, Outputs, and Audit Mode Handoff (Weeks 9–10)

### Sprint Goal
By end of sprint: the complete Planning Mode flow is shippable — from site URL entry to downloading a GTM container JSON. A non-technical marketer can use it end-to-end without assistance.

### Prerequisites
- Sprint PM-4 complete (steps 1–3 working)
- At least one session in `review_ready` status with real recommendations
- Output generation working (Sprint PM-3)

### Tasks

- [ ] **PM-5.1 — Build AnnotatedScreenshot component**
  - Files to create: `frontend/src/components/planning/AnnotatedScreenshot.tsx`
  - Props: `screenshotUrl: string`, `recommendations: RecommendedElement[]`, `onHighlightClick: (rec: RecommendedElement) => void`
  - Render the page screenshot as a `<img>` filling its container
  - Overlay: for each recommendation with a bounding box (`{ x, y, width, height }` in the PRD's `RecommendedElement` type), render a numbered highlight box (yellow border, number badge in top-left corner)
  - Clicking a highlight selects that recommendation in the sidebar list
  - The highlights are absolutely positioned as percentage-based offsets relative to the screenshot's display size (to handle responsive scaling)
  - This is the most complex UI component — take time to get the coordinate math right
  - Estimate: 6 hours
  - Acceptance criteria: Screenshot displays at full container width; numbered boxes appear at correct positions; clicking a box scrolls the recommendation list to that item

- [ ] **PM-5.2 — Build RecommendationCard component**
  - Files to create: `frontend/src/components/planning/RecommendationCard.tsx`
  - Props: `recommendation: RecommendedElement`, `isSelected: boolean`, `onDecision: (decision: UserDecision) => void`
  - Display: element type icon, what was found (element text / selector), action type (e.g., `purchase event`), confidence badge (high/medium/low), business justification (from Claude's response)
  - Actions: Approve button (green), Skip button (gray), Edit button (pencil → opens inline form to modify the recommendation)
  - Inline edit form: allows changing the event name, adding/removing required parameters
  - On decision: call `PATCH /api/planning/sessions/:id/recommendations/:recId` → update local store
  - Reuse: `SeverityBadge` component for confidence level display; `HealthBadge` for approval status
  - Estimate: 5 hours
  - Acceptance criteria: All 3 decision states (approve/skip/edit) work; decisions are persisted to API; selected card is visually highlighted

- [ ] **PM-5.3 — Build Step 4: ReviewRecommendations component**
  - Files to create: `frontend/src/components/planning/Step4ReviewRecommendations.tsx`
  - Layout: 2-column (annotated screenshot left, recommendation list right)
  - Page selector tabs at top (one tab per scanned page)
  - "Approve All High-Confidence" button (batch-approves recommendations with confidence ≥ 0.8)
  - "Add Custom Element" button → `CustomElementForm` modal for manually adding a tracking element not detected by AI
  - Progress indicator: "X of Y recommendations reviewed"
  - "Continue to Summary" button (enabled when all recommendations have a decision)
  - Files to create: `frontend/src/components/planning/CustomElementForm.tsx` — modal form to add a custom tracking recommendation manually
  - Estimate: 8 hours
  - Acceptance criteria: User can review all recommendations, approve/skip/edit each; custom elements can be added; "Continue" is only active when all decisions are recorded

- [ ] **PM-5.4 — Build Step 5: TrackingPlanSummary component**
  - Files to create: `frontend/src/components/planning/Step5TrackingPlanSummary.tsx`
  - Show summary before generation:
    - Platforms being tracked: icons for each selected platform
    - Events being captured: list of approved events with page they fire on
    - Items being skipped
    - Estimated implementation effort (count events × rough hours)
  - "Generate Implementation Files" CTA button → calls `POST /api/planning/sessions/:id/generate` → shows spinner → advance to step 6
  - Estimate: 3 hours
  - Acceptance criteria: Summary accurately reflects approved recommendations; clicking generate calls the API and advances to step 6 after success

- [ ] **PM-5.5 — Build Step 6: GeneratedOutputs component**
  - Files to create: `frontend/src/components/planning/Step6GeneratedOutputs.tsx`
  - Show 3 output cards (GTM Container JSON, DataLayer Spec, Implementation Guide)
  - Each card: output type icon, description, file size, preview button (opens modal), download button
  - GTM Container preview: show the JSON in a code block with syntax highlighting (use a `<pre>` + `JSON.stringify` for MVP — no external code highlight library needed)
  - DataLayer Spec preview: show the code snippets per page in expandable sections
  - Implementation Guide preview: render the HTML in an `<iframe>` with `srcdoc`
  - "Download All" ZIP button: calls download for each file (or implement a `/download-all` endpoint that returns a ZIP — use existing `jszip` from backend dependencies)
  - Estimate: 6 hours
  - Acceptance criteria: All 3 outputs are previewed and downloadable; the GTM JSON file downloads with `.json` extension; the guide downloads as `.html`

- [ ] **PM-5.6 — Build Step 7: DownloadScreen + Audit Mode handoff**
  - Files to create: `frontend/src/components/planning/Step7DownloadAndHandoff.tsx`
  - Show: "Your tracking plan is ready" success state
  - Download section: quick links to all outputs
  - Next steps section: "Once your developer has implemented the tracking, verify it with Atlas Audit Mode"
  - "Start Audit" button: calls `POST /api/planning/sessions/:id/handoff` which:
    - Creates a Journey using the approved events/pages as stages
    - Returns a `journey_id`
    - Frontend navigates to `/journey-builder/{journey_id}` to review the auto-created journey before running the audit
  - "Return to Dashboard" link
  - Estimate: 4 hours
  - Acceptance criteria: Handoff creates a real Journey in DB; navigating to the journey builder shows the auto-created journey with correct stages; user can then run an audit

- [ ] **PM-5.7 — Implement Audit Mode handoff backend endpoint**
  - Files to modify: `backend/src/api/routes/planning.ts`
  - `POST /api/planning/sessions/:id/handoff`:
    - Load approved recommendations from DB
    - Map each unique page URL → journey stage (`page_type` from `planning_pages`, actions from approved recommendations)
    - Call `createJourney()` from `backend/src/services/database/journeyQueries.ts`
    - Call `upsertStage()` for each page
    - Call `upsertPlatforms()` with the session's platform list
    - Return `{ journey_id }`
  - This reuses the existing Journey Builder DB layer — no new tables needed
  - Estimate: 4 hours
  - Acceptance criteria: Calling the endpoint creates a complete Journey with stages matching the planning session; the Journey appears in the Journey Builder

- [ ] **PM-5.8 — Error handling + loading states polish**
  - Files to modify: All Planning Mode components
  - Ensure every API call has: loading spinner, error state with retry, empty state
  - Handle: session not found (404), API errors (500), network timeout
  - Add `StatusBanner` to `PlanningDashboard` for plan-tier upgrade prompt (free users who hit limit)
  - Estimate: 3 hours
  - Acceptance criteria: No API call leaves the UI in an ambiguous state; all errors show actionable messages

- [ ] **PM-5.9 — End-to-end test: full user flow**
  - Manual test: open browser → navigate to Planning Mode → complete all 7 steps with a real website
  - Test sites: use a real ecommerce site (Shopify demo), SaaS site (a public demo), and a lead gen site
  - Verify: recommendations are sensible, GTM JSON imports correctly, implementation guide is readable
  - Fix any bugs found
  - Estimate: 4 hours
  - Acceptance criteria: A non-technical user (or Vikram playing the role) can complete the full flow without needing to consult documentation

### Sprint Deliverable
The complete Planning Mode feature — all 7 steps functional, GTM container importable, implementation guide readable, and Audit Mode handoff working. The feature is demo-ready.

### Technical Decisions to Make During This Sprint
1. **Annotated screenshot coordinate system**: Screenshot dimensions from the backend (e.g., 1280×800) vs display size on screen. Use percentage-based positioning (x%, y%) so the overlay scales correctly with the rendered image.
2. **Step 6 preview**: Loading HTML in `<iframe srcdoc>` might trigger CSP issues. Use `sandbox="allow-same-origin"` attribute. If that fails, render as a simple `<div dangerouslySetInnerHTML>` (acceptable since the HTML is Atlas-generated, not user input).
3. **Download All ZIP**: If time-constrained, skip the ZIP endpoint and just provide 3 individual download links. ZIP is a nice-to-have.
4. **Mobile responsiveness**: Planning Mode's annotated screenshot + recommendation list layout requires ≥1024px width to work well. Add a `<StatusBanner>` for screens under 1024px advising to use a desktop browser, rather than attempting a full mobile layout.

### Risks
- **Annotated screenshot coordinates**: The most likely source of visual bugs. The AI needs to return accurate bounding boxes for this to work. If Claude's bounding box coordinates are unreliable, fall back to a numbered list without position overlay (just highlight the recommendation card, no screenshot overlay).
- **GTM JSON correctness**: Mistakes here directly affect the user's tracking setup. Add a JSON schema validator against the GTM export format spec before storing the output.
- **Handoff journey quality**: The auto-created Journey's stages depend on Planning Mode's page type classification. If page types are wrong, the Journey stages will be wrong. Add a review step in the Journey Builder before the user runs the audit.

---

## Summary: All Sprints

| Sprint | Weeks | Focus | Key Deliverable |
|--------|-------|-------|-----------------|
| PM-1 | 1–2 | Page Capture + Claude API | Console: URL → recommendations JSON |
| PM-2 | 3–4 | Session Orchestration + API | Postman: full backend flow working |
| PM-3 | 5–6 | Output Generators | API: GTM JSON + spec + guide downloadable |
| PM-4 | 7–8 | Frontend Steps 1–3 | UI: setup → page discovery → scanning |
| PM-5 | 9–10 | Frontend Steps 4–7 + Handoff | Full end-to-end demo ready |

**Total estimate:** 10 weeks, ~200 hours of productive work (at 20 hrs/week)

---

## New Files Summary

### Backend (`backend/src/`)
```
config/env.ts                          — MODIFIED: add ANTHROPIC_API_KEY
types/planning.ts                      — NEW: all Planning Mode TypeScript interfaces
services/planning/
  pageCaptureService.ts               — NEW: Browserbase page visit + DOM extraction
  domSimplifier.ts                    — NEW: reduce DOM to ~15K tokens
  aiAnalysisService.ts                — NEW: Claude API integration + prompts
  sessionOrchestrator.ts             — NEW: multi-page scan orchestration
  generators/
    gtmContainerGenerator.ts         — NEW: GTM container JSON (importable)
    dataLayerSpecGenerator.ts        — NEW: developer-ready dataLayer spec
    implementationGuideGenerator.ts  — NEW: HTML implementation guide
    outputGenerator.ts               — NEW: orchestrates all generators
services/database/
  planningQueries.ts                 — NEW: all Planning Mode DB operations
services/queue/
  jobQueue.ts                        — MODIFIED: add planningQueue
  worker.ts                          — MODIFIED: add planning job processor
api/routes/
  planning.ts                        — NEW: all /api/planning/* endpoints
app.ts                               — MODIFIED: mount planning routes
scripts/
  testPageCapture.ts                 — NEW: dev test script (not production)
```

### Frontend (`frontend/src/`)
```
types/planning.ts                     — NEW: frontend Planning Mode types
store/planningStore.ts               — NEW: Zustand store for Planning Mode
lib/api/planningApi.ts               — NEW: Planning Mode API client
pages/
  PlanningDashboard.tsx              — NEW: session list + start planning
  PlanningModePage.tsx               — NEW: 7-step wizard container
components/planning/
  Step1PlanningSetup.tsx             — NEW: URL + business context + platforms
  Step2PageDiscovery.tsx             — NEW: manual URL entry
  Step3ScanningProgress.tsx          — NEW: real-time scan progress
  Step4ReviewRecommendations.tsx     — NEW: annotated screenshot + review cards
  Step5TrackingPlanSummary.tsx       — NEW: pre-generation summary
  Step6GeneratedOutputs.tsx          — NEW: output preview + download
  Step7DownloadAndHandoff.tsx        — NEW: final screen + audit handoff
  AnnotatedScreenshot.tsx            — NEW: screenshot with highlight overlay
  RecommendationCard.tsx             — NEW: approve/skip/edit card
  CustomElementForm.tsx              — NEW: modal to add custom tracking element
components/layout/
  Sidebar.tsx                        — MODIFIED: add Planning Mode nav item
App.tsx                              — MODIFIED: add /planning/* routes
```

### Database
```
db/migrations/003_create_planning_tables.sql  — NEW
```

### Documentation
```
docs/planning-mode-sprint-plan.md            — NEW (this file)
docs/planning-mode-tasks.md                  — NEW: flat checklist
docs/planning-mode-migrations.md             — NEW: migration SQL
CLAUDE.md                                    — MODIFIED: Planning Mode section added
```

---

## Conflicts with Existing Codebase

None found. The Planning Mode feature is additive — it does not modify any existing audit or journey builder code, only extends it. Specific integration points:

1. **`backend/src/app.ts`**: Add `app.use('/api/planning', planningRouter)` — additive, no conflict.
2. **`frontend/src/App.tsx`**: Add new routes — additive, no conflict.
3. **`frontend/src/components/layout/Sidebar.tsx`**: Add new nav item — additive, no conflict.
4. **`backend/src/services/queue/jobQueue.ts`**: Add second queue — additive, no conflict.
5. **`backend/src/config/env.ts`**: Add `ANTHROPIC_API_KEY` — additive, no conflict.
6. **`backend/package.json`**: Add `@anthropic-ai/sdk` — additive, no conflict.

---

## Appendix A: Environment Variables to Add

### Backend (`backend/.env`)
```
ANTHROPIC_API_KEY=sk-ant-xxx
```

### Backend (`backend/src/config/env.ts`)
Add to the schema:
```typescript
ANTHROPIC_API_KEY: z.string().min(1, 'Anthropic API key required'),
```

---

## Appendix B: New npm Dependencies

### Backend
```bash
cd backend && npm install @anthropic-ai/sdk
```

No additional frontend dependencies required — all UI is built with existing React + Tailwind stack.

---

## Appendix C: Reused Components Checklist

| Planning Mode Need | Reused From | How |
|--------------------|-------------|-----|
| Browserbase sessions | `browserbase/client.ts` | Direct import of `createBrowserbaseSession()`, `getCDPUrl()` |
| Platform detection | `journey/platformSchemas.ts` | Import `PLATFORM_SCHEMAS`, check against detected scripts |
| Action type vocabulary | `journey/actionPrimitives.ts` | Import `ACTION_PRIMITIVES` — Claude recommendations use these action keys |
| dataLayer code snippets | `journey/generators/gtmDataLayer.ts` | Import `generateGTMDataLayer()`, extend for Planning Mode output |
| WalkerOS output | `journey/generators/walkerosFlow.ts` | Import `generateWalkerOSFlow()`, adapt for Planning recommendations input |
| Auth middleware | `api/middleware/authMiddleware.ts` | Direct reuse on all new routes |
| Rate limiting | `api/middleware/auditLimiter.ts` | Extend with planning session limits |
| Supabase client | `services/database/supabase.ts` | Direct reuse |
| Job queue | `services/queue/jobQueue.ts` | Extend with planning queue |
| DB query pattern | `services/database/journeyQueries.ts` | Mirror pattern for `planningQueries.ts` |
| Journey creation | `services/database/journeyQueries.ts` | Call directly from handoff endpoint |
| Sidebar nav | `components/layout/Sidebar.tsx` | Modify to add Planning Mode item |
| Progress wizard | `components/journey/WizardProgress.tsx` | Reuse for Planning Mode step indicator |
| Business type selection | `components/journey/Step1BusinessType.tsx` | Reuse/adapt for Step 1 |
| Platform toggles | `components/journey/Step3PlatformSelector.tsx` | Reuse for platform selection |
| Status badge | `components/common/HealthBadge.tsx` | Reuse for session status + confidence display |
| Severity badge | `components/common/SeverityBadge.tsx` | Reuse for recommendation confidence levels |
| Alert banner | `components/common/StatusBanner.tsx` | Reuse for errors + plan limits |
| Zustand pattern | `store/auditStore.ts` | Mirror for `planningStore.ts` |
| API client pattern | `lib/api/auditApi.ts` | Mirror for `planningApi.ts` |
| Journey → Audit | `services/database/journeyQueries.ts` | Call from handoff endpoint to create Journey |
