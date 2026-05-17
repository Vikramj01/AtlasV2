# Atlas V2 — Phase 1 Security Audit Report

**Audit date:** 2026-05-17  
**Branch audited:** `main` (HEAD `9c86e84`)  
**Auditor:** Claude Code (automated static analysis)  
**Scope:** Static analysis + Supabase RLS policy review. No dynamic exploitation.

---

## Executive Summary

| Severity | Count |
|---|---|
| P0 — Exploitable / data-loss / production-broken | **0** |
| P1 — Significant functional gap / serious security flaw | **1** |
| P2 — Meaningful deviation / defense-in-depth gap | **4** |
| P3 — Minor inconsistency / code smell | **2** |

**Top 3 issues:**
1. **SEC-01 (P1)** — IDOR on `PUT /api/journeys/:id/stages/:stageId`: any authenticated user can overwrite another user's journey stage by supplying their own valid `journeyId` and a victim's `stageId`.
2. **SEC-03 (P2)** — Strategy brief creation (`POST /api/strategy/briefs`) does not verify that a user-supplied `client_id` belongs to the caller's organisation.
3. **SEC-04 (P2)** — CSV upload validator has no formula-injection protection; cells starting with `=`, `+`, `-`, `@` are passed through to the database without sanitisation.

**Secrets rotation required:** None. Working tree and full git history (111 commits) are clean.

**Traffic-light summary:**

| Area | Status |
|---|---|
| Secrets hygiene | 🟢 Green |
| Auth & session handling | 🟢 Green |
| Tenant isolation (RLS) | 🟢 Green |
| API-layer IDOR protection | 🟡 Amber — one confirmed P1, one P2 pattern |
| CSV upload security | 🟡 Amber — formula injection gap |
| CORS / CSRF / rate limiting | 🟢 Green |
| Webhook integrity | 🟢 Green |

---

## 1.1 Secrets & Credentials Hygiene

### Finding SEC-GIT-01 — No secrets in working tree or git history
**Severity:** ✅ PASS  
**Evidence:** Grep across all `.ts`, `.tsx`, `.js`, `.json`, `.env*`, `.yaml` files for `sk-ant-`, `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `BROWSERBASE_API_KEY`, `BB_API_KEY`, `GOOGLE_CLIENT_SECRET`, `META_APP_SECRET`, `JWT_SECRET`, `REDIS_URL`, `DATABASE_URL`, 32+ char alphanumeric strings. All 111 git commits scanned with `git log -p --all`. **Zero real secret values found in any location.**

`backend/.env.example` and `frontend/.env.example` contain placeholder values only (e.g., `sk-ant-xxx`, `your-service-role-key`).

### Finding SEC-GIT-02 — `.gitignore` correctly excludes all `.env` files
**Severity:** ✅ PASS  
**Evidence:** Root `.gitignore` lines 12–16 exclude `.env`, `.env.local`, `.env.*.local`, `backend/.env`, `frontend/.env`. No `.env` files tracked in git history.

### Finding SEC-GIT-03 — Frontend only exposes public variables
**Severity:** ✅ PASS  
**Evidence:** All `import.meta.env` references in `frontend/src/` use `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_STRIPE_PRICE_*`. The Supabase **anon key** is intentionally public. No `ANTHROPIC_API_KEY`, `BROWSERBASE_API_KEY`, or `service_role` key appears anywhere in frontend code.

### Finding SEC-GIT-04 — Anthropic API key backend-only
**Severity:** ✅ PASS  
**Evidence:** `grep -rn "ANTHROPIC\|sk-ant" frontend/src/` returns nothing. The key is consumed exclusively by `backend/src/services/usage/claudeClient.ts` via `env.ANTHROPIC_API_KEY`.

### Finding SEC-GIT-05 — Bull queue payloads contain no secrets
**Severity:** ✅ PASS  
**Evidence:** All `JobData` types in `backend/src/services/queue/jobQueue.ts` carry only IDs. The files contain explicit comments: `"PII is intentionally NOT included in the job payload"`, `"credentials are loaded from DB inside the worker — NOT in the payload"`. Workers load credentials from the database by ID inside the job execution.

### Finding SEC-GIT-06 — CAPI credentials encrypted at rest
**Severity:** ✅ PASS  
**Evidence:** `backend/src/services/capi/credentials.ts` uses AES-256-GCM with a per-record 12-byte random IV via `@noble/ciphers`. The encryption key is sourced from `env.CAPI_ENCRYPTION_KEY` (64-char hex). In production, a missing key throws; in dev it warns and uses a zero-key. Never logged.

### Finding SEC-GIT-07 — Browserbase CDP URL construction embeds API key in string
**Severity:** P3  
**Location:** `backend/src/services/browserbase/client.ts:58–60`  
**Evidence:**
```typescript
export function getCDPUrl(sessionId: string): string {
  return `wss://connect.browserbase.com?apiKey=${env.BROWSERBASE_API_KEY}&sessionId=${sessionId}`;
}
```
The URL string is passed only to `chromium.connectOverCDP()` locally within the worker process and never returned to a client. However, if this string were inadvertently logged (e.g., by Playwright internals), the API key would appear in Render logs.  
**Risk:** Low — no log statement currently captures it.  
**Recommended fix:** Pass the key and session ID separately to `connectOverCDP` if the Playwright API supports it; if not, add a note that this URL must never be logged.

### Finding SEC-GIT-08 — Load test files use environment variables for tokens
**Severity:** ✅ PASS  
**Evidence:** `load-tests/smoke.js` line 22 reads `const TOKEN = __ENV.AUTH_TOKEN`. The comment on line 7 shows the expected invocation (`AUTH_TOKEN=eyJ... k6 run ...`). No hardcoded JWT tokens in any load test file.

### Finding SEC-LOG-01 — No secrets in log statements
**Severity:** ✅ PASS  
**Evidence:** Grep for `console.log|logger.info|logger.debug` near `token|secret|key|password|oauth|credential` in `backend/src/`. All matches log only IDs, emails, or error messages — no secret values.

---

## 1.2 User Data Security, Auth & Access Control

### Finding SEC-01 (P1) — IDOR: Journey stage update ignores stage ownership
**Severity:** **P1**  
**Location:** `backend/src/api/routes/journeys.ts:208–218`, `backend/src/services/database/journeyQueries.ts:131–141`  
**Attack scenario:**  
1. Attacker (User A) authenticates normally and obtains their own valid `journeyId`.  
2. Attacker learns a victim's `stageId` (e.g., via timing or leaked URLs).  
3. Attacker sends `PUT /api/journeys/<attacker_journeyId>/stages/<victim_stageId>` with any body.  
4. The route first calls `getJourney(req.params.id, req.user!.id)` — this passes because `attacker_journeyId` is attacker-owned.  
5. It then calls `updateStage(req.params.stageId, req.body)` which executes `.eq('id', stageId)` with **no journey_id or user_id filter**.  
6. The victim's stage is overwritten.

**Evidence:**
```typescript
// journeys.ts:207–218
router.put('/:id/stages/:stageId', async (req: Request, res: Response) => {
  const journey = await getJourney(req.params.id, req.user!.id);  // ← checks attacker's own journey
  if (!journey) return res.status(404).json({ error: 'Journey not found' });

  const stage = await updateStage(req.params.stageId, req.body);  // ← updates by stageId alone
  res.json(stage);
});

// journeyQueries.ts:131–141
export async function updateStage(stageId: string, data: ...): Promise<JourneyStage> {
  const { data: stage } = await supabase
    .from('journey_stages')
    .update({ ...data })
    .eq('id', stageId)          // ← no .eq('journey_id', ...) filter
    .select().single();
  return stage;
}
```
**Recommended fix:** Pass `journeyId` through the call and add it to the filter:
```typescript
// journeys.ts
const stage = await updateStage(req.params.stageId, req.params.id, req.body);

// journeyQueries.ts
export async function updateStage(stageId: string, journeyId: string, data: ...) {
  await supabase.from('journey_stages')
    .update({ ...data })
    .eq('id', stageId)
    .eq('journey_id', journeyId);  // ← add this
}
```
**Note:** `deleteStage` already passes `journeyId` and filters correctly (`journeyQueries.ts:143–148`). This is the correct pattern; `updateStage` should match it.

**PR:** See `[security][P1] Fix IDOR in journey stage update endpoint`.

---

### Finding SEC-02 (P2) — Browserbase `session_id` returned to client via `SELECT *`
**Severity:** P2  
**Location:** `backend/src/api/routes/crawl.ts` (GET `/api/crawl/runs` and GET `/api/crawl/run/:id`)  
**Evidence:** Both endpoints query `crawl_runs` with `.select('*')` and return the full row via `res.json(data)`. The `crawl_runs` table includes `browserbase_session_id text NULL` (migration `20260530_001_crawl_signal_extractor.sql:22`). Authenticated users receive their own Browserbase session IDs in every crawl-run response.  
**Attack scenario:** A session ID is not a long-term secret, but returning it unnecessarily widens the attack surface: a compromised client could attempt to reconnect to an in-progress session or enumerate session metadata via the Browserbase API.  
**Recommended fix:** Replace `.select('*')` with an explicit column list that excludes `browserbase_session_id` and `browser_minutes_raw`:
```typescript
.select('id,mode,status,triggered_by,total_pages,pages_completed,pages_failed,browser_minutes_used,started_at,completed_at,created_at')
```

---

### Finding SEC-03 (P2) — Strategy brief creation does not verify `client_id` ownership
**Severity:** P2  
**Location:** `backend/src/api/routes/strategy.ts` — `POST /api/strategy/briefs`  
**Evidence:** The brief-creation handler inserts `client_id` directly from `req.body` without verifying that the client belongs to the caller's organisation:
```typescript
.insert({
  organization_id: userId,
  client_id: client_id ?? null,   // ← no ownership check
  ...
})
```
**Attack scenario:** User A can link their strategy brief to User B's `client_id` by supplying B's UUID in the request body. This creates a cross-tenant data association: A's brief appears to reference B's client record, which could surface in joins or reports.  
**Recommended fix:** Before inserting, verify the `client_id` belongs to the caller's org:
```typescript
if (client_id) {
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', client_id)
    .eq('organisation_id', orgId)
    .maybeSingle();
  if (!clientRow) return res.status(400).json({ error: 'client_id not found in your organisation' });
}
```

---

### Finding SEC-04 (P2) — CSV upload lacks formula-injection sanitisation
**Severity:** P2  
**Location:** `backend/src/services/offline-conversions/csvValidator.ts`  
**Evidence:** The CSV validator correctly enforces file-size limits (10 MB), MIME type checks, and field-level format validation. However, it does not strip or prefix cell values that begin with `=`, `+`, `-`, `@`, `\t`, or `\r` — the classic formula-injection prefixes.  
**Attack scenario:** A user uploads a CSV with a field value like `=HYPERLINK("http://evil.example","click me")`. The value passes validation and is stored in the database. If an Atlas operator later exports rows to Excel or Google Sheets (e.g., for support debugging), the formula executes in the spreadsheet client. The data goes to Google Ads, not directly back to a spreadsheet — risk is moderate, not critical.  
**Recommended fix:** Add a sanitisation step in the parsing loop:
```typescript
function sanitizeFormulaInjection(value: string): string {
  if (/^[=+\-@\t\r]/.test(value.trimStart())) return `'${value}`;
  return value;
}
```
Apply before storing any free-text field (email, name, custom parameters).

---

### Finding SEC-05 (P2) — Crawl trigger subscription gating inconsistent with other plan-gated endpoints
**Severity:** P2  
**Location:** `backend/src/api/routes/crawl.ts:39–54`  
**Evidence:** `POST /api/crawl/trigger` checks for an active subscription via `getActiveSubscription(org_id)` at the service level, returning HTTP 402 if none exists. Other compute-heavy endpoints (offline conversions, audits, planning sessions) use the `planGuard` middleware applied at the router level. The crawl endpoint's subscription check is functionally correct but is:
- Not visible in `app.ts` route registration (no middleware annotation)
- Not tied to the plan hierarchy (`free`/`pro`/`agency`) — it only checks subscription presence, not tier
- Not consistent with how `planGuard` reports errors (status code and message format differ)

**Recommended fix:** Either add `planGuard('pro')` to the crawl router, or document the intentional divergence with a comment.

---

### Finding SEC-06 (P3) — CAPI mutation functions lack `org_id` filter (defense-in-depth gap)
**Severity:** P3  
**Location:** `backend/src/services/database/capiQueries.ts` — `updateProviderStatus`, `updateProviderCredentials`, `updateGoogleToken`, `updateProviderConfig`, `incrementProviderCounters`, `updateCAPIEventStatus`  
**Evidence:** Each of these functions updates by `provider_id` only, without an `organization_id` filter. Example:
```typescript
await supabase.from('capi_providers')
  .update({ status, ... })
  .eq('id', providerId);   // ← no .eq('organization_id', organizationId)
```
**Why not exploitable in practice:** Every API route that calls these functions first calls `getProvider(req.params.id, req.user.id)` which verifies ownership. If ownership fails, the route returns 404 before the mutation is reached. Both `getProvider` and `deleteProvider` already include org_id filters — the mutation functions should match for consistency and defense-in-depth.  
**Recommended fix:** Add `organizationId: string` parameter to each mutation function and add `.eq('organization_id', organizationId)` to the query — matching the pattern already used in `deleteProvider`.

---

### Finding SEC-07 (P3) — `crawl_pages` query in single-run endpoint not filtered by `org_id`
**Severity:** P3  
**Location:** `backend/src/api/routes/crawl.ts:186–192`  
**Evidence:** `GET /api/crawl/run/:crawl_run_id` fetches the parent `crawl_run` filtered by both `id` and `org_id` (correct), then fetches child `crawl_pages` filtered only by `crawl_run_id` (no explicit `org_id`). Because the parent check already scopes the `crawl_run_id` to the caller's org, this is not directly exploitable — but it is not defence-in-depth.  
**Recommended fix:** Add `.eq('org_id', org_id)` to the `crawl_pages` query.

---

### Finding SEC-RLS-01 — Supabase RLS properly configured on all tables
**Severity:** ✅ PASS  
**Evidence:** Every table in every migration has `ENABLE ROW LEVEL SECURITY`. Policies reviewed:
- **Service-role-only tables** (`crawl_runs`, `crawl_pages`, `detected_signals`, `org_page_scope`): `USING (auth.role() = 'service_role')` — correct; direct client reads are impossible.
- **Tenant-isolated tables** (all offline-conversion, consent, CAPI, channel, strategy, planning, taxonomy tables): `USING (organization_id = auth.uid())` or `USING (user_id = auth.uid())`.
- **`proxy_event_library`**: `USING (true) TO authenticated` — intentional; system-owned reference data, read-only.
- **`event_taxonomy`**: system events visible to all authenticated users; org-specific events scoped to owner. INSERT/UPDATE/DELETE restricted to `organization_id = auth.uid()`.
- No table uses `USING (true)` without a tenant predicate except the intentional reference-data table.

---

### Finding SEC-AUTH-01 — Auth uses Bearer tokens; no CSRF risk
**Severity:** ✅ PASS  
**Evidence:** `backend/src/api/middleware/authMiddleware.ts:7–9` requires `Authorization: Bearer <token>`. Browsers do not automatically attach Bearer tokens in cross-origin requests, so CSRF token middleware is not required. No `csurf` package is used (correctly omitted).

### Finding SEC-AUTH-02 — Session tokens validated server-side via Supabase
**Severity:** ✅ PASS  
**Evidence:** `supabaseAdmin.auth.getUser(token)` validates the JWT and checks expiry on every request. `req.user.id` and `req.user.plan` are populated from the validated token and the `profiles` table — never from client-supplied parameters.

### Finding SEC-CORS-01 — CORS correctly locked to explicit origins
**Severity:** ✅ PASS  
**Evidence:** `backend/src/app.ts:50–72`. Origins come from `env.ALLOWED_ORIGINS` (parsed from `FRONTEND_URL` env var). Wildcard patterns (e.g., `https://*-vikramj01s-projects.vercel.app`) are supported but must be explicitly added to the env. `credentials: true` is set — safe because there is no `*` wildcard. Requests with no `Origin` header (server-to-server) are allowed — acceptable.

### Finding SEC-WEBHOOK-01 — Stripe webhook signature verified
**Severity:** ✅ PASS  
**Evidence:** `backend/src/api/routes/billing.ts:119–143`. The webhook handler: (1) requires `STRIPE_WEBHOOK_SECRET`, (2) reads raw body via `express.raw()` registered before `express.json()` in `app.ts:47`, (3) calls `stripe.webhooks.constructEvent()` to verify HMAC-SHA256 signature. No other incoming webhooks detected.

### Finding SEC-RATE-01 — Rate limiting in place on auth and compute endpoints
**Severity:** ✅ PASS  
**Evidence:**  
- Global: 200 req / 15 min / IP on all `/api/*` (`app.ts:79–98`)  
- Heavy: 20 req / 15 min on generation/evaluation endpoints  
- Auth: dedicated `signupLimiter` and `resetLimiter` on `POST /auth/signup` and `POST /auth/forgot-password`  
- Planning / Audit: monthly quota limiters keyed per user  
- Offline conversions: per-user upload rate limiter

### Finding SEC-CSV-01 — CSV upload file handling is secure against path traversal
**Severity:** ✅ PASS  
**Evidence:** Multer uses `memoryStorage()` (no disk writes). `originalname` is stored in DB only. File size capped at 10 MB. MIME type allowlist in place.

---

## Secrets Rotation List

**None required.** No secrets found in working tree or git history.

---

## Appendix: Files Examined

| Area | Files |
|---|---|
| Secret scanning | All `.ts`, `.tsx`, `.js`, `.json`, `.env*` in repo (excl. `node_modules`, `dist`) |
| Git history | 111 commits via `git log -p --all` |
| Auth middleware | `backend/src/api/middleware/authMiddleware.ts`, `planGuard.ts` |
| Route IDOR review | `journeys.ts`, `crawl.ts`, `signals.ts`, `strategy.ts`, `planning.ts`, `clients.ts`, `capi.ts`, `audit.ts`, `admin.ts` |
| DB query review | `journeyQueries.ts`, `capiQueries.ts` |
| Credential handling | `backend/src/services/capi/credentials.ts`, `claudeClient.ts`, `queue/jobQueue.ts`, `queue/worker.ts` |
| Browserbase | `backend/src/services/browserbase/client.ts`, `crawl/crawlJob.ts` |
| CSV upload | `offlineConversions.ts`, `services/offline-conversions/csvValidator.ts` |
| CORS / rate limiting | `backend/src/app.ts` |
| Webhooks | `billing.ts` |
| RLS policies | All 33 migration files in `supabase/migrations/` |
