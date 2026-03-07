# Atlas Planning Mode — Flat Task Checklist

Use this file to track implementation progress sprint-by-sprint.
See `docs/planning-mode-sprint-plan.md` for full task descriptions, file paths, and acceptance criteria.

**Status legend:** `[ ]` = not started · `[~]` = in progress · `[x]` = complete · `[!]` = blocked

---

## Sprint PM-1: Page Capture Engine + Claude API Integration (Weeks 1–2)

- [ ] **PM-1.1** — Add `@anthropic-ai/sdk` to backend + `ANTHROPIC_API_KEY` to env config
- [ ] **PM-1.2** — Create `backend/src/types/planning.ts` (all Planning Mode TypeScript interfaces)
- [ ] **PM-1.3** — Build `backend/src/services/planning/pageCaptureService.ts` (Browserbase page capture)
- [ ] **PM-1.4** — Build `backend/src/services/planning/domSimplifier.ts` (DOM → ≤15K token simplified tree)
- [ ] **PM-1.5** — Build `backend/src/services/planning/aiAnalysisService.ts` (Claude API integration)
- [ ] **PM-1.6** — Iterate on AI analysis prompt quality (test against 3 page types)
- [ ] **PM-1.7** — Create `backend/src/scripts/testPageCapture.ts` (dev test script)

**Sprint PM-1 Done When:** `npx ts-node src/scripts/testPageCapture.ts https://example.com ecommerce` runs without errors and prints structured recommendations to console.

---

## Sprint PM-2: Session Orchestration + Backend API (Weeks 3–4)

- [ ] **PM-2.1** — Create `db/migrations/003_create_planning_tables.sql` and run in Supabase
- [ ] **PM-2.2** — Add screenshot upload to Supabase Storage in `pageCaptureService.ts`
- [ ] **PM-2.3** — Build `backend/src/services/database/planningQueries.ts` (all DB CRUD functions)
- [ ] **PM-2.4** — Build `backend/src/services/planning/sessionOrchestrator.ts` (multi-page scan)
- [ ] **PM-2.5** — Add `planningQueue` to `backend/src/services/queue/jobQueue.ts` + worker
- [ ] **PM-2.6** — Build `backend/src/api/routes/planning.ts` (all `/api/planning/*` endpoints)
- [ ] **PM-2.7** — Extend `backend/src/api/middleware/auditLimiter.ts` for planning session limits
- [ ] **PM-2.8** — Integration test: full backend flow via Postman/curl

**Sprint PM-2 Done When:** `POST /api/planning/sessions` → poll status → `review_ready` → `GET recommendations` → `PATCH decisions` all work against real Browserbase + Claude API.

---

## Sprint PM-3: Output Generators (Weeks 5–6)

- [ ] **PM-3.1** — Build `backend/src/services/planning/generators/gtmContainerGenerator.ts` (GTM import JSON)
- [ ] **PM-3.2** — Test GTM container JSON import in real GTM account; fix any schema issues
- [ ] **PM-3.3** — Build `backend/src/services/planning/generators/dataLayerSpecGenerator.ts`
- [ ] **PM-3.4** — Build `backend/src/services/planning/generators/implementationGuideGenerator.ts` (HTML)
- [ ] **PM-3.5** — Build `backend/src/services/planning/generators/outputGenerator.ts` + Supabase Storage upload + download routes
- [ ] **PM-3.6** — *(Optional)* Wrap WalkerOS generator for Planning Mode output
- [ ] **PM-3.7** — Wire `POST /api/planning/sessions/:id/generate` endpoint

**Sprint PM-3 Done When:** Calling generate endpoint returns download URLs for GTM JSON (imports into GTM), dataLayer spec, and HTML guide with no errors.

---

## Sprint PM-4: Frontend — Steps 1–3 (Weeks 7–8)

- [ ] **PM-4.1** — Create `frontend/src/types/planning.ts`
- [ ] **PM-4.2** — Create `frontend/src/store/planningStore.ts` (Zustand)
- [ ] **PM-4.3** — Create `frontend/src/lib/api/planningApi.ts`
- [ ] **PM-4.4** — Add Planning Mode nav to `frontend/src/components/layout/Sidebar.tsx` + routes in `frontend/src/App.tsx`
- [ ] **PM-4.5** — Build `frontend/src/pages/PlanningDashboard.tsx`
- [ ] **PM-4.6** — Build `frontend/src/pages/PlanningModePage.tsx` (wizard container)
- [ ] **PM-4.7** — Build `frontend/src/components/planning/Step1PlanningSetup.tsx`
- [ ] **PM-4.8** — Build `frontend/src/components/planning/Step2PageDiscovery.tsx`
- [ ] **PM-4.9** — Build `frontend/src/components/planning/Step3ScanningProgress.tsx`

**Sprint PM-4 Done When:** A user can navigate Planning Mode in the browser, fill in site details, add pages, start scan, and watch real-time progress screen — without backend errors.

---

## Sprint PM-5: Frontend — Steps 4–7 + Handoff (Weeks 9–10)

- [ ] **PM-5.1** — Build `frontend/src/components/planning/AnnotatedScreenshot.tsx`
- [ ] **PM-5.2** — Build `frontend/src/components/planning/RecommendationCard.tsx`
- [ ] **PM-5.3** — Build `frontend/src/components/planning/Step4ReviewRecommendations.tsx` + `CustomElementForm.tsx`
- [ ] **PM-5.4** — Build `frontend/src/components/planning/Step5TrackingPlanSummary.tsx`
- [ ] **PM-5.5** — Build `frontend/src/components/planning/Step6GeneratedOutputs.tsx`
- [ ] **PM-5.6** — Build `frontend/src/components/planning/Step7DownloadAndHandoff.tsx`
- [ ] **PM-5.7** — Implement `POST /api/planning/sessions/:id/handoff` backend endpoint
- [ ] **PM-5.8** — Error handling + loading states polish across all Planning Mode components
- [ ] **PM-5.9** — End-to-end test: complete user flow against 3 real websites

**Sprint PM-5 Done When:** A non-technical user can complete the full 7-step flow — scan site → review recommendations → download GTM container JSON → start Audit Mode — without any intervention.

---

## Global Checklist (cross-sprint items)

- [ ] `ANTHROPIC_API_KEY` added to backend `.env` and `env.ts` schema
- [ ] `@anthropic-ai/sdk` added to `backend/package.json`
- [ ] `db/migrations/003_create_planning_tables.sql` run in Supabase (prod + dev)
- [ ] `planning-screenshots` Supabase Storage bucket created (private)
- [ ] Planning Mode added to sidebar navigation
- [ ] Planning Mode routes protected by `ProtectedRoute` auth guard
- [ ] Rate limits configured for planning sessions per plan tier
- [ ] GTM container JSON validated against real GTM import
- [ ] AI cost per session measured and within budget (~$0.13 target)
- [ ] Screenshots uploaded to Supabase Storage, not stored in DB as blobs
- [ ] PII handling: no raw email/phone stored outside of planning recommendations (encrypted at rest via Supabase)
- [ ] Mobile warning banner shown on screens <1024px wide (annotated screenshot UI is desktop-only)
- [ ] Audit Mode handoff tested end-to-end (creates Journey, user can run audit)

---

## Total Task Count: 28 tasks across 5 sprints
