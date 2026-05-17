# AtlasV2 — Comprehensive Audit & Test Program

> **Hand this entire document to Claude Code as the opening prompt of a fresh session in the `AtlasV2` repo.**

---

## Your mission

You are running a three-phase audit and test program against this repository (`Vikramj01/AtlasV2`). The phases are sequential — **do not start Phase 2 until I have reviewed Phase 1, and so on.** Stop and wait for explicit approval between phases.

Deliverables per phase:
1. A structured findings report (markdown) written to `/audit/reports/`.
2. Fix PRs **only for P0 issues and clearly-correct P1 bug fixes** (see PR Policy section). Everything else stays in the report.

---

## Operating principles (apply to every phase)

1. **Read first, write last.** Build a complete picture before producing fixes. Do not "fix as you go" during discovery.
2. **Evidence-based findings.** Every finding must cite specific file paths, line numbers, commit SHAs, or migration files. No hand-wavy claims.
3. **Severity grading is mandatory:**
   - **P0** — exploitable security issue, data loss risk, or production-broken core flow.
   - **P1** — significant functional gap vs PRD, broken non-core flow, or serious perf regression.
   - **P2** — meaningful deviation from spec, optimization opportunity with clear ROI.
   - **P3** — minor inconsistency, code smell, doc drift.
4. **No destructive operations.** Read-only on production. Do not run migrations against the live Supabase project (`irirgimsdmnatoxkhcas`). If you need to test a migration, create a Supabase branch.
5. **Never commit secrets.** If you discover a leaked secret, redact it in the report (show the file path and line, not the value), and flag it as P0 for rotation.
6. **Use the actual stack.** Stack of record: React 19 + Vite + React Router (frontend), Express on Render (backend), Supabase Postgres (`irirgimsdmnatoxkhcas`), **Render-managed Redis** (service `red-d7vpjnr7uimc73evp8lg`, **not Upstash** — older docs may say otherwise), Browserbase, Anthropic SDK. If `CLAUDE.md` contradicts the code, the **code wins** and `CLAUDE.md` becomes a Phase 2 finding.
7. **Ask before you assume.** If a PRD is ambiguous or you can't locate a feature spec, pause and ask me. Do not guess intent.

---

## Phase 1 — Security audit

**Goal:** identify every realistic path an attacker could use to (a) steal API keys, secrets, or OAuth tokens, or (b) access another tenant's data, credentials, or session.

This phase is **static analysis + Supabase policy review**. Dynamic exploitation testing is out of scope for this run — flag candidates for a separate Phase 1b session.

### 1.1 Secrets & credentials hygiene

Investigate and report on:

- **Hardcoded secrets in the working tree.** Run `gitleaks`, `trufflehog`, and a manual grep for: `sk-ant-`, `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `BROWSERBASE_API_KEY`, `BB_API_KEY`, `GOOGLE_CLIENT_SECRET`, `META_APP_SECRET`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET`, anything matching `[A-Za-z0-9]{32,}` in non-test files.
- **Hardcoded secrets in git history.** Same scan against full history (`git log -p`). Any historical leak = P0 with rotation instruction in the report.
- **`.env` handling.** Confirm `.env*` is gitignored everywhere it should be. Check `.env.example` exists and contains no real values. Verify no `.env` files are checked in to any subdirectory.
- **Client-side exposure.** Inventory every environment variable read by the frontend (anything imported from `import.meta.env` in `/frontend` or equivalent). Confirm none of them carry a secret value (only `VITE_PUBLIC_*` style keys, Supabase **anon** key, etc. — never service role, never Anthropic key, never Browserbase key).
- **OAuth token storage.** For the Google Ads adapter, Meta CAPI adapter, and any other OAuth flow: where are refresh tokens stored? Are they encrypted at rest in Postgres? Who can decrypt them? Is the encryption key itself in env, KMS, or hardcoded? PRD reference: the six-sprint PRD specifies adapter OAuth lifecycle requirements.
- **Bull/Redis credentials.** Confirm Redis URL is server-only and never reaches the client bundle. Check queue payloads — are any of them serializing secrets (API keys, OAuth tokens) into job data that ends up in Redis?
- **Browserbase session tokens.** When crawl runs spin up a Browserbase session, where does the session token live? Is it ever logged? Is it ever returned to the client?
- **Anthropic API key isolation.** Confirm `ANTHROPIC_API_KEY` is only referenced server-side. Frontend should call your own backend, which proxies to Anthropic. Any direct frontend-to-Anthropic call = P0.
- **Logging.** Grep for `console.log`, `logger.info`, `logger.debug` near auth, secret, token, OAuth code paths. Are secrets being logged? Render logs are persisted — anything sensitive in logs = P0.

### 1.2 User data security, auth, and access control

Investigate and report on:

- **Supabase Row Level Security (RLS).** For every table in the public schema, confirm:
  - RLS is **enabled** (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`).
  - Policies exist for `SELECT`, `INSERT`, `UPDATE`, `DELETE` as appropriate.
  - Policies correctly isolate by `org_id` / tenant — there's no cross-org leakage. Specifically audit: `crawl_runs`, `crawl_pages`, `detected_signals`, `org_page_scope` (Crawl Signal Extractor tables, migration `20260530_001_crawl_signal_extractor.sql`), plus every signal-library, journey, audit, and adapter-config table.
  - No policy uses `USING (true)` or `USING (auth.role() = 'authenticated')` without a tenant check.
- **Service-role key blast radius.** Inventory every code path that uses the Supabase service role key. Each one should be (a) server-only, (b) justified (genuinely needs to bypass RLS), and (c) scoped — does it touch only the rows it needs to?
- **Session and JWT handling.** How are user sessions issued and validated? Token expiry? Refresh strategy? Is there a logout that actually invalidates server-side state, or is it cookie-only?
- **Subscription gating.** The Crawl Signal Extractor and likely other modules are subscription-gated. Test the gating logic: can a free-tier user trigger a gated endpoint by calling the API directly (bypassing the frontend UI gate)? This is an IDOR-class issue.
- **Cross-tenant IDOR.** For every endpoint under `/api/crawl`, `/api/journeys`, `/api/signals`, `/api/adapters`, etc., confirm the server validates that the requested resource belongs to the caller's org — not just that the caller is authenticated. Map every endpoint to its authorization check.
- **CSV upload security.** The Offline Conversion Upload feature accepts CSV files. Check: file size limits, MIME validation, formula injection (cells starting with `=`, `+`, `-`, `@`), path traversal in filenames, content scanning before parsing.
- **CORS configuration.** Express CORS settings — what origins are allowed? Is `*` ever used with `credentials: true`? Are preview Render URLs accidentally permissive?
- **CSRF.** Any state-changing endpoint that relies on cookie auth needs CSRF protection. Inventory.
- **Rate limiting.** Auth endpoints (login, password reset, OAuth callbacks) — are they rate-limited? CSE endpoints — can a user trigger unbounded crawl runs?
- **Webhook signature verification.** Any incoming webhooks (Meta CAPI test events, Stripe if present, Google Ads notifications): are signatures verified before processing?
- **Password / auth provider.** If using Supabase Auth: confirm email confirmation is on, password minimum is enforced, password reset flow doesn't leak account existence.

### Phase 1 deliverables

- `/audit/reports/01-security.md` — one section per finding, with: ID, severity, title, location (file:line or table+policy), evidence, attack scenario, recommended fix, references to relevant PRDs/code.
- For every **P0**: open a fix PR titled `[security][P0] <short description>`. PR body must reference the finding ID and not include any secret values.
- An executive summary table at the top of the report: count by severity, top 3 issues, secrets-rotation list if any.

**Stop. Wait for my review of Phase 1 before continuing.**

---

## Phase 2 — Requirements deviation audit

**Goal:** for every documented PRD, determine what was specified vs what was actually built, and flag every meaningful deviation.

### Source-of-truth hierarchy (in order)

1. **PRDs in `/docs/prd/`** — primary source. Enumerate every file. Known PRDs (verify presence and add any missing from this list):
   - `ANDROMEDA_SIGNAL_HEALTH_PRD.md`
   - Six-sprint PRD (language rewrites, GA4 generator, CAPI adapter contract, Google adapter split with three named adapters + OAuth lifecycle, Consent Mode v2, golden sample CI)
   - Channel Signal Behaviour (CSB) PRD (product + technical)
   - Conversion Strategy Gate PRD
   - Phase 1 Foundation PRD (navigation relabelling, Action Dashboard, contextual guidance, Signal Inventory XLSX export)
   - Offline Conversion Upload PRD
   - Event Taxonomy / Naming Governance PRD
   - GTM Destinations addendum PRD (May 2026 GML response — schema changes, Journey Builder UX, Andromeda scoring dimensions, new Direct Audit checks)
2. **`CLAUDE.md`** — secondary. Note: prior reviews found `CLAUDE.md` described Next.js when the actual stack is Vite + React Router + Express. **Any contradiction between `CLAUDE.md` and the code is itself a P2 finding** (doc drift).
3. **Recent commit history** — tertiary signal for intent. Inspect commits from the last 90 days. Look for: features added without a corresponding PRD update (scope drift), PRD-specified features that don't appear in commits (unbuilt), commits that explicitly contradict a PRD (intentional deviation that should be re-documented).

### What to check per PRD

For each PRD, produce a checklist:

| Spec item | Status | Evidence | Notes |
|---|---|---|---|
| (verbatim feature/behavior from PRD) | ✅ Shipped / ⚠️ Partial / ❌ Missing / 🟡 Diverged | (file path, route, table, commit SHA) | (gap description, severity) |

Specific checks worth calling out:

- **GA4-only output.** PRD says WalkerOS is dropped, standardize on GA4. Confirm no WalkerOS code remains. Confirm GA4 generator output validates against the GA4 measurement protocol schema.
- **Strategy Gate before Planning Mode.** The Conversion Strategy Gate is supposed to be a voluntary nudge banner on Planning Mode entry. Confirm: it exists, it's positioned correctly, it's actually voluntary (not blocking), and the markdown PRD spec for the banner content matches the implementation.
- **Andromeda Readiness Score — five dimensions.** EMQ monitoring, funnel completeness, signal freshness/latency, dedup health, value parameter coverage. Confirm all five are implemented and the composite score formula matches the PRD.
- **Crawl Signal Extractor — already shipped.** Tables: `crawl_runs`, `crawl_pages`, `detected_signals`, `org_page_scope`. Services in `backend/src/services/crawl/`. Routes under `/api/crawl`. UI at `/crawl/:runId` (`CrawlStatusPage`). Validate: subscription gating works, output populates the Signal Library, integration with Journey Builder exists.
- **Google adapter split.** Three named adapters with separate OAuth lifecycle. Confirm the split exists and is not just a single adapter with conditional logic.
- **Consent Mode v2.** Integration scope and behavior per PRD.
- **Golden sample CI.** Is there CI infrastructure for golden samples? Where? Does it run on PRs?
- **Navigation relabelling.** Phase 1 Foundation PRD moved nav from architecture terms to task-oriented language. Confirm in the frontend routing/nav components.
- **Signal Inventory XLSX export.** Endpoint, format, fields per PRD.
- **GTM Destinations PRD addendum.** Schema changes, new Direct Audit checks, Andromeda scoring updates — built? Deferred? In progress?

### Phase 2 deliverables

- `/audit/reports/02-requirements-deviation.md` — one section per PRD with the checklist table above, plus a cross-PRD summary of:
  - Shipped as specified (counts)
  - Partial / diverged (list)
  - Missing (list)
  - Built but not documented in any PRD (scope drift — list with commit SHAs)
  - `CLAUDE.md` contradictions
- No PRs in this phase by default. If you find a **trivially-correct doc fix** (e.g., `CLAUDE.md` says Next.js when it's Vite), open a single doc-fix PR titled `[docs][P2] Correct stack description in CLAUDE.md` etc. Anything requiring a product decision stays in the report.

**Stop. Wait for my review of Phase 2 before continuing.**

---

## Phase 3 — Performance

Two sub-phases run together: **functional performance** (does the system deliver the expected results?) and **optimization** (where can it be faster, cheaper, leaner?).

### 3.1 Functional performance — does it deliver?

For each major feature, define expected outputs from the PRD and verify them against actual outputs. Use a local dev environment with seeded data. Do **not** run this against the production Supabase project.

Test targets (build automated test scripts under `/audit/tests/functional/`):

- **Crawl Signal Extractor** — given a known fixture site, does the crawl return the expected set of detected signals? Are pages scored correctly? Are subscription gates enforced?
- **GA4 generator** — given a journey spec, does the generator produce a valid GA4 config? Validate against GA4 schema. Compare to golden samples if they exist.
- **CAPI adapter** — does the handshake succeed against Meta's test events tool? Are event_id values correctly propagated for dedup? Does the four-layer dedup (GTM beacon → DB event ID check → Redis click signal → Meta platform dedup) actually function end-to-end?
- **Google adapters (three)** — each adapter's OAuth lifecycle, refresh, error handling, scope.
- **Andromeda Readiness Score** — given a synthetic signal-health dataset, does the score match the PRD formula across all five dimensions?
- **Direct Audit checks** — every check listed in the GTM Destinations PRD addendum: does it fire correctly on a known-bad config?
- **Offline Conversion Upload** — CSV with known good rows, known bad rows, edge cases (formula injection, encoding, large file). Does the system accept good, reject bad, and report clearly?
- **Strategy Gate** — appears on Planning Mode entry, dismissable, captures the right state.
- **Journey Builder signal timing** — events classified correctly by lag-from-click, Meta 2h/24h window risks flagged.

Output: pass/fail per scenario, with diff between expected and actual.

### 3.2 Optimization opportunities

Profile and report on:

- **Frontend** — bundle size (per route), Lighthouse scores on key pages, largest contentful paint, time to interactive, unused dependencies, oversized images, render-blocking resources.
- **Backend API** — p50/p95/p99 latency on hot endpoints (CSE start, signal queries, journey load, dashboard data). Identify any > 500ms p95 endpoints.
- **Database** — slow query log from Supabase (Reports → Query Performance). Missing indexes (especially on `org_id`, foreign keys, and any column used in RLS predicates). N+1 query patterns in the API layer. Unbounded `SELECT *` on large tables.
- **Redis / Bull queues** — queue depth over time, job duration distribution, retry storms, stuck jobs. Are crawl jobs appropriately concurrent or serialized?
- **Browserbase usage** — session reuse vs new session per page. Cost-per-crawl trend. Failure rate.
- **LLM calls (Anthropic)** — call volume, token usage per feature, caching opportunities, batching opportunities, prompt size vs output size ratio.
- **Memory** — any long-running processes with growing RSS. Suspected leaks.
- **Cold start** — Render service cold-start time, what can be precomputed or cached.

### Phase 3 deliverables

- `/audit/reports/03-performance-functional.md` — functional test results table, failures with reproduction steps.
- `/audit/reports/03-performance-optimization.md` — optimization findings, each with: measured baseline, proposed change, expected gain, effort estimate (S/M/L).
- `/audit/tests/functional/` — runnable test scripts that I can re-run later.
- Fix PRs **only for**: P0 functional regressions (something specified as shipped is actually broken), and any optimization where the fix is a clearly-correct one-liner (missing index, missing memo, etc.). Bigger optimization work stays in the report for me to prioritize.

---

## Master deliverable

After Phase 3 completes, produce `/audit/reports/00-executive-summary.md` containing:

- One-page summary of the entire audit.
- Severity counts across all three phases.
- Top 10 prioritized actions across all phases.
- Secrets-rotation list (if any).
- A traffic-light health rating per area: Security / Requirements alignment / Functional performance / Optimization headroom.

---

## PR policy (binding)

- **Open a PR only when:** (a) it's a P0 fix, OR (b) it's a P1 fix that is unambiguous and reversible (missing index, typo in a policy, doc correction).
- **Never open a PR that:** modifies pricing logic, modifies subscription gating logic, alters schemas in ways that need data migration, or changes any user-facing copy without my approval.
- **Every PR must:** reference the finding ID from the report, be scoped to one issue, have a descriptive title with `[phase][severity]` prefix, and include a test or reproduction note in the description.
- **Never:** auto-merge, force-push to main, modify protected branches, or commit anything from `/audit/reports/` that contains a secret value.

---

## Kickoff

Start with Phase 1. Begin by:
1. Confirming you've read this document and asking any clarifying questions before you begin.
2. Listing the PRDs you find in `/docs/prd/` so I can confirm completeness.
3. Outlining your Phase 1 plan (tools, scope, estimated work) for my approval before you run any scans.

Do not start scanning until I approve the Phase 1 plan.
