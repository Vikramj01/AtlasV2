# PRD · Atlas MCP Connector · Distribution through Claude's Connectors Directory

**Intended repo path** · `docs/prd/atlas-mcp-connector.md`
**Status** · Draft for build
**Author** · ViMi Digital
**Date** · 12 November 2026
**Related** · `api/routes/publicAudit.ts`, `services/validation/register/`, `services/reporting/outputLint.ts`, `services/reporting/withAccessRegistry.ts`, `services/dashboard/dashboardSummaryService.ts`, `services/dqm/`, `services/reconciliation/`, `services/air/`, Campaign Signal Validator, `docs/prd/pre-connection-scan-confidence-tiering.md`

---

## 1. Problem

Atlas's growth is held back by two things: distribution (people who would benefit do not find it) and ease of use (getting value means logging in to a dashboard and learning a new surface).

Meanwhile, the people Atlas sells to, agencies and in-house performance teams, increasingly run their ad accounts from inside Claude. Meta ships an official read-write Ads MCP server and Google ships an official read-only Google Ads MCP server. Those tools report performance. None of them can tell the user whether the conversion signal feeding the bidding is correct. When a user asks Claude "why did my CPA jump?", a broken signal is frequently the real answer, and today Atlas is not in that conversation.

An Atlas remote MCP server, listed in Claude's Connectors Directory, puts Atlas at the moment the problem appears and removes the dashboard as a precondition for getting value.

## 2. Goals

- A user in Claude can install Atlas, sign in with an email, and get a useful, honest signal finding about their own site within minutes.
- Paying customers can query portfolio health, DQM alerts, reconciliation gaps and anomaly insights from Claude without opening the dashboard.
- The free tier generates qualified sign-ups and converts to paid without founder follow-up on every account.
- Nothing Atlas returns through the connector asserts more than the scan actually observed, even after the user's Claude has rephrased it.
- The connector passes directory review on first submission.

## 3. Non-goals (v1)

- **No write actions against client systems.** No GTM container publish, no draft workspace deploy, no CAPI provider changes, no audience pushes. These come later under a separate PRD with explicit approval flows.
- No new detection rules. The connector exposes existing Check Register v2 output; it does not add checks.
- No new billing tier. The middle step between free and Pro (starter tier or pay-per-scan) is deliberately deferred until sign-up data exists (§16).
- No MCP Apps UI in v1 (interactive cards inside Claude). Planned for Phase 4.
- No ChatGPT or Cursor specific work. The server is standard MCP and should work there, but v1 is tested and listed only for Claude.

## 4. Decisions already made

| # | Decision | Source |
|---|---|---|
| D1 | Free tier exists: small, rate-limited, requires a verified email sign-in. Anything larger needs a proper paid account. | Founder decision, 12 Nov 2026 |
| D2 | Free scan **detects** (what, how serious, rough cost). Paid **diagnoses and fixes** (root cause, fix plan, generated containers, pre-spend validation). The Campaign Signal Validator becomes the paid upgrade from the free scan, not a competitor to it. | Founder decision |
| D3 | Free suits in-house D2C teams. Agency needs (multi-client, portfolio, per-client access) are paid only. | Founder decision |
| D4 | Founder follow-up is not scaled yet. Capture qualifying data at sign-in, measure sign-ups, decide the middle tier later. | Founder decision |
| D5 | Trust over reach: the free tier only runs checks with proven accuracy; every finding carries its evidence and observation limits; the response contract stops the user's Claude overstating results; users can dispute findings; misfiring rules can be switched off without a release. | Founder decision |
| D6 | Pricing principle: one-off checks can be free; anything continuous (monitoring, reconciliation, alerts, portfolio) is paid. | Founder decision |
| D7 | Read and write tools are always separate tools. v1 ships read tools only (plus one non-destructive dispute tool). | Directory requirement + D5 |

## 5. Users and jobs

| User | Plan | Job in Claude |
|---|---|---|
| In-house D2C or lead-gen marketer, no Atlas account | free | "Is my conversion tracking healthy?", "why don't Meta and GA4 match?", "check my checkout tracking before we scale spend" |
| Freelance media buyer | free → pro | Same as above for a client site, then deeper checks once convinced |
| Agency account lead | agency | "Which of my clients have signal problems this week?", "what changed on client X?", "any DQM alerts I should know about before the Monday call?" |
| Existing Atlas customer (pro) | pro | Ask about their own client's health, reconciliation and anomalies without opening the dashboard |

## 6. Architecture

### 6.1 Placement

- The MCP server is a new Express router inside the existing backend (`backend/src/api/routes/mcp.ts` plus `backend/src/services/mcp/`). It is **not** a separate service. It calls existing services directly (no HTTP hop to `/api/*`).
- Transport: MCP **Streamable HTTP**, stateless mode, using the official TypeScript SDK (`@modelcontextprotocol/sdk`). Verify the current SDK version and its Express integration against the live package docs before coding (Key Technical Decision §14 applies: do not trust training-data assumptions about third-party schemas).
- Public URL: a dedicated hostname, proposed `https://mcp.atlas.vimi.digital/mcp`. The protected resource metadata `resource` value must equal this URL exactly, including the path.
- Mount order in `app.ts`: register `/mcp` and its `/.well-known/oauth-protected-resource` route **outside** the `/api` global limiter and before any router whose path could prefix it (Key Technical Decision §26 hazard class). Confirm how the SDK transport expects the request body (pre-parsed JSON vs raw stream) and place `express.json()` accordingly.
- CORS / Origin: requests come server-to-server from Anthropic's egress range (`160.79.104.0/21`). Validate the `Origin` header if present (directory technical requirement), reject browser origins that are not allowlisted.

### 6.2 Module layout

```
backend/src/
├── api/routes/mcp.ts                  # Express router: /mcp transport + /.well-known/oauth-protected-resource
├── api/middleware/mcpAuth.ts          # Bearer token verification → req.user (reuses authMiddleware's profile/plan lookup)
├── api/middleware/mcpQuota.ts         # per-user / per-IP / per-domain quota checks (§9)
└── services/mcp/
    ├── server.ts                      # builds the McpServer, registers tools
    ├── tools/                         # one file per tool (§8)
    ├── contract/
    │   ├── findingMapper.ts           # ReportJSON → McpFinding[] (§7)
    │   ├── presentationRules.ts       # static narration guidance strings
    │   └── mcpOutputLint.ts           # BANNED_TOKENS gate over every outgoing string (§7.4)
    ├── accuracy/
    │   ├── freeTierAllowlist.ts       # versioned rule allowlist (§10)
    │   └── ruleOverrides.ts           # reads mcp_rule_overrides kill switch (§10.3)
    ├── scanCache.ts                   # per-domain result cache (§9.2)
    └── telemetry.ts                   # mcp_tool_calls writes (§12)
```

### 6.3 Scan execution

- A connector scan reuses the **same pipeline** as the authenticated and public scans: `auditQueue → runAuditOrchestrator → journeySimulator → runRegister()`. No new scan engine.
- The audit row is user-owned (`user_id` set, `is_public` false) with a new `origin = 'mcp'` value (§11). Scan Inputs not supplied by the user are inferred via `siteDetectionService` with `declaration_source: 'INFERRED_FROM_SITE'`, exactly as `publicAudit.ts` does. Extract that inference into a shared helper rather than duplicating it.
- Scans take longer than a tool call should block. Claude allows up to 300 seconds per call, but the tool must not rely on that. `atlas_scan_site` enqueues and returns a `scan_id` immediately; `atlas_get_scan_result` returns status or results. The tool descriptions tell Claude to poll with a short wait.

## 7. Response contract (the honesty layer)

This is the most important section. In a connector, Atlas does not control the final wording: the user's Claude narrates the findings and will tend to state them more confidently than the data supports. The contract makes overstatement structurally hard.

### 7.1 Three result types

Every finding returned through the connector is mapped to exactly one `result_type`:

| `result_type` | Source in Check Register v2 | Meaning |
|---|---|---|
| `confirmed` | verdict `FAIL` with `evidence_class` `DIRECT` | Seen directly in this scan (for example a duplicate purchase event fired in the browser) |
| `likely` | verdict `FAIL` with `evidence_class` `INFERRED` / `DERIVED` | Strong indirect evidence, not directly observed |
| `cannot_verify` | verdict `NOT_OBSERVED` / `INCONCLUSIVE`, any `could_not_be_assessed` entry, any `with_access` entry | Not observable from the browser; needs account access to check |
| `conflict` | verdict `CONFLICT`, any `signal_conflicts` entry | Two detectors disagree; both readings returned, no winner |

`PRESENCE` / `PRESENCE_INVERSE` rules map by verdict the same way. Passing checks are returned only as a count plus a short list, not as findings.

### 7.2 Finding shape

```ts
interface McpFinding {
  finding_id: string;            // stable: `${audit_id}:${rule_id}:${step ?? 'site'}`
  rule_id: string;
  register_version: string;
  result_type: 'confirmed' | 'likely' | 'cannot_verify' | 'conflict';
  severity: 'critical' | 'high' | 'medium' | 'low';   // existing severity ceilings for PARTIAL confidence still apply
  title: string;                 // lint-gated
  what_we_saw: string;           // plain description of the observation, lint-gated
  observation_limits: string[];  // what the scan could NOT see that bears on this finding
  evidence: {
    page_url?: string;
    request_url?: string;        // redacted of query-string PII
    event_name?: string;
    payload_excerpt?: Record<string, unknown>;  // PII-stripped, max ~2KB
    datalayer_excerpt?: Record<string, unknown>;
  };
  impact: {
    category: 'bidding_signal_loss' | 'attribution_loss' | 'duplicate_counting' | 'consent_loss' | 'data_quality' | 'other';
    estimate?: { low: number; high: number; unit: 'percent_of_conversions'; assumptions: string[] };
    // estimate is OMITTED unless an existing, data-backed source produces it (Implementation Rule 12). Never a single point value.
  };
  verify_with_access?: {         // present for cannot_verify, and for likely where access would confirm
    what_access: string;         // e.g. "Connect your Meta Business account"
    plan_required: 'free' | 'pro' | 'agency';
  };
  dispute_hint: string;          // "If this is wrong, call atlas_report_incorrect_finding with finding_id."
}
```

### 7.3 Scan-level fields

Every scan result also returns:

- `run_quality` (`COMPLETE` / `PROVISIONAL` / `INSUFFICIENT`). For `INSUFFICIENT`, return **no findings**, only a statement that the scan could not reach enough of the site, with the reason. Do not return a score.
- `score` only when Check Register v2 produced one; when `score_withheld_reason` is set, return the reason and no number.
- `coverage`: layers assessed out of 13 (`ALL_V2_LAYERS`), pages reached.
- `observation_limits_global`: standing limits of any browser-side scan, at minimum: server-side CAPI is invisible; Google tag gateway can serve tags first-party; consent behaviour varies by visitor region and this scan ran from one location (state which).
- `presentation_rules`: a fixed array of strings for the assistant (§7.5).
- `next_steps`: upgrade and paid diagnostic options (§9.4).

### 7.4 Output lint

- `mcpOutputLint.ts` scans **every string field** of every tool response (not just report narrative) against `outputLint.ts`'s `BANNED_TOKENS`. Reuse the export; do not copy the list.
- A violation in a `cannot_verify` or `likely` finding is a hard failure: the response is replaced by an error result and the violation is logged at `error` level. This mirrors the existing v2 report gate.
- Unit tests must cover every tool's response builder.

### 7.5 Presentation rules sent to the assistant

Returned in `presentation_rules` on every scan result and repeated in the tool descriptions:

1. Only describe `confirmed` findings as problems that exist.
2. Describe `likely` findings as probable, with the stated evidence.
3. Never describe a `cannot_verify` item as missing, broken or absent. Say it could not be checked from outside the site and name the access that would check it.
4. Present `conflict` findings with both readings; do not choose one.
5. Never state a single-number impact. If `impact.estimate` is present, give the range and its assumptions; if absent, describe the impact category only.
6. If `run_quality` is `INSUFFICIENT`, say the scan could not complete and do not list findings.
7. Show the user the evidence for any finding they question, and offer `atlas_report_incorrect_finding`.

## 8. Tools

All tool names are prefixed `atlas_`. Every tool carries a `title` and the applicable `readOnlyHint` / `destructiveHint` annotations (directory requirement). Input schemas are Zod, converted for MCP. All responses include `structuredContent` plus a short text summary.

### 8.1 Free tier (any signed-in user)

| Tool | Annotations | Purpose | Backed by |
|---|---|---|---|
| `atlas_get_account_status` | readOnly | Plan, remaining scans this period, what each paid plan unlocks, upgrade URL | `profiles.plan`, `mcp_scan_requests` |
| `atlas_scan_site` | readOnly: false, destructive: false, idempotent: false | Start a signal scan of a public URL. Returns `scan_id`, `status`, `cached` flag, expected wait | shared scan helper (§6.3), quota (§9), cache (§9.2) |
| `atlas_get_scan_result` | readOnly | Poll status; when complete, return the §7 contract | `getReport` + `findingMapper` |
| `atlas_explain_finding` | readOnly | Plain explanation of a `rule_id`: why it matters for bidding, generic fix direction, what Atlas Pro would add | register rule metadata (static, no scan, no Browserbase cost) |
| `atlas_report_incorrect_finding` | readOnly: false, destructive: false | Log a dispute against a `finding_id` with a reason enum and optional note | `mcp_finding_disputes` (§10.4) |

**`atlas_scan_site` input**

```ts
{
  url: string;                       // validated via utils/urlValidator (SSRF rules as publicAudit)
  site_type?: SiteType;              // optional; inferred if absent
  declared_platforms?: DeclaredPlatform[];
  confirm_site_relationship: 'own_site' | 'client_site' | 'other';  // asked, logged, not enforced
}
```

`confirm_site_relationship` exists to qualify leads and to support abuse review. It does not block the scan.

### 8.2 Paid tier (`pro` and above unless stated)

All paid tools enforce `planGuard` semantics in `mcpAuth`/tool handlers and return a structured `plan_required` error (with upgrade URL) rather than a bare 403, so Claude can explain the upgrade.

| Tool | Plan | Annotations | Purpose | Backed by |
|---|---|---|---|---|
| `atlas_list_clients` | pro | readOnly | Clients in the user's org with computed `health_level` and open issue counts | `getClientSummaries(orgId)` |
| `atlas_get_client_health` | pro | readOnly | One client: open IHC + reconciliation findings, DQM alert severity, CAPI match quality, dedup rate | `dashboardSummaryService`, `ihc` queries, DQM queries |
| `atlas_get_dqm_alerts` | pro | readOnly | Recent DQM alerts for a client or the org, filterable by severity and window | DQM alert tables |
| `atlas_get_reconciliation` | pro | readOnly | Latest reconciliation run findings for a client, with `platform_discontinuities` annotations | `reconciliation_runs` / `reconciliation_findings` |
| `atlas_get_insights` | pro | readOnly | AIR anomalies and correlations as **structured data** (not the narrated text), so the user's Claude narrates | `air_anomalies`, `air_insight_correlations` |
| `atlas_get_portfolio_summary` | agency | readOnly | Cross-client rollup sorted by severity (fixes the alphabetical-only limitation of `ClientHealthList` for this surface) | `getClientSummaries` + sort |
| `atlas_get_scan_history` | pro | readOnly | Previous scans for a domain/client and what changed between them, using `rule_confirmations` and `coverage_fingerprint` to avoid false regressions | audits + register comparator |

Client-scoped tools take `client_id` (or a client name, resolved to an id with a disambiguation error if ambiguous). Every query is scoped by the caller's `organization_id` resolved per Key Technical Decision §10. No tool accepts an org id from the caller.

Paid tools apply the same §7 rules where they return findings (IHC, reconciliation): map to `result_type`, lint every string.

### 8.3 Explicitly deferred (Phase 4, separate PRD)

`atlas_generate_fix` (returns a GTM container / CAPI config for review, no deploy), `atlas_deploy_gtm_draft`, `atlas_hold_junk_conversion`, any CAPI configuration change. Each will be a separate tool with `destructiveHint: true` where it changes client systems.

## 9. Quotas, cost control and upgrade path

### 9.1 Limits (initial values, all config not code)

| Limit | Free | Pro | Agency |
|---|---|---|---|
| New scans per user per calendar month | 3 | 50 | 300 |
| Distinct domains per user per month | 2 | unlimited within scans | unlimited within scans |
| Max pages per scan | existing public scan cap | existing authenticated cap | existing authenticated cap |
| Concurrent scans per user | 1 | 3 | 10 |
| Scans per IP per day (all accounts) | 10 | n/a | n/a |
| Scans per target domain per day (all free accounts) | 5 (cache serves the rest) | n/a | n/a |
| Tool calls per user per minute (all tools) | 30 | 120 | 300 |

Values live in `config/mcpLimits.ts`, overridable by env vars. IP addresses are stored only as salted hashes (same rule as `publicAuditLimiter`). Use the shared Redis for counters, not in-memory windows (the backend may run more than one instance).

### 9.2 Result cache

- Key: normalised registrable domain + `REGISTER_VERSION` + inferred `site_type`.
- TTL: 72 hours (config).
- A cached hit returns the existing result, does **not** consume the user's monthly scan quota, and does not touch Browserbase. Response sets `cached: true` and `scanned_at`.
- Cache is bypassed for paid users who pass `force_rescan: true`.
- Cache scope is across users for public-site scans only. Nothing from a paid, connected-account context is ever cached across orgs.

### 9.3 Cost tracking

- Every non-cached scan logs Browserbase usage via the existing `usageLogger` with `origin = 'mcp'`, so cost per free scan is reportable from existing operator monitoring.
- Operator alert when free-tier Browserbase spend in a rolling 7 days exceeds a configured ceiling (`MCP_FREE_WEEKLY_COST_CEILING`). On breach, free scans return a polite "temporarily at capacity" result and cached results continue to serve.

### 9.4 Limits as the upgrade prompt

When any limit is hit, the tool returns a normal result (not a protocol error) containing:

- which limit was reached and when it resets;
- what a paid account adds, in two or three lines specific to the user's last scan (for example "3 checks on this site could not be verified without account access; Pro connects your Meta and Google accounts to confirm them");
- `next_steps`: Pro plan checkout URL, and the Campaign Signal Validator one-off diagnostic URL (existing Stripe flow) for users who want a single deep check without subscribing.

The same `next_steps` block appears on every free scan result, framed by D2: free detects, paid diagnoses and fixes.

## 10. Accuracy controls

### 10.1 Free-tier rule allowlist

- Only rules on `freeTierAllowlist.ts` may produce `confirmed` or `likely` findings in free-tier responses. Every other rule's failures are returned as `cannot_verify` with `verify_with_access` set, or omitted if they have no meaningful outside reading.
- The allowlist is a versioned constant (`MCP_FREE_ALLOWLIST_VERSION`), stamped on every response, and must be reconsidered whenever `REGISTER_VERSION` bumps.
- Paid tiers use the full register output, still under §7.

### 10.2 How rules get onto the allowlist

- Build a benchmark set: sites where the true setup is known (ViMi client sites and past audits where the client confirmed the setup). Target at least 30 sites spanning ecommerce, lead-gen and PLG SaaS, Shopify and custom stacks, with and without sGTM / GTG / server-side CAPI.
- `scripts/mcpBenchmark.ts`: runs the register against the benchmark set and compares each rule's verdict with a hand-labelled ground-truth file (`scripts/mcp-benchmark/ground-truth.json`, labelled by ViMi, not generated).
- A rule qualifies when its false-positive rate on the benchmark is at or below the threshold in config (initial: 5%) with at least 10 applicable sites. Rules with fewer applicable sites stay off the allowlist.
- Do **not** publish or display an accuracy figure anywhere. Per Key Technical Decision §20, read `pre-connection-scan-confidence-tiering.md` §15 (sample-size reasoning) before computing any accuracy metric from `rule_confirmations`. The benchmark output is an internal gate only.

### 10.3 Kill switch

- Table `mcp_rule_overrides` (§11). A row with `disabled = true` removes that rule from all MCP responses (free and paid) on the next request, without a release.
- Super-admin route: `PATCH /api/admin/mcp/rules/:ruleId` (`adminMiddleware`), plus a minimal list view in the existing admin page.
- Overrides are cached in-process for at most 60 seconds.

### 10.4 Disputes

- `atlas_report_incorrect_finding` writes to `mcp_finding_disputes` with `finding_id`, `rule_id`, `register_version`, domain, reason (`tag_present_server_side`, `tag_present_other_method`, `consent_regional`, `site_changed`, `other`), optional note (max 1,000 chars, PII-stripped before insert).
- Response to the user acknowledges the dispute and states it will be reviewed. It does not promise a timeline.
- Weekly digest of new disputes to the operator alert channel (reuse `services/usage/alertDelivery.ts`).
- A rule with 3+ disputes in 7 days from distinct users triggers an operator alert suggesting the kill switch.
- Disputes never auto-write `REFUTED` to `rule_confirmations` (preserves Key Technical Decision §20's one-directional rule). A human operator may convert a reviewed dispute into an `operator`-source confirmation.

## 11. Data model

Migration: `supabase/migrations/20261113001_mcp_connector.sql` (11-digit version, per Key Technical Decision §21). RLS on every table; service-role access from the backend. Use `org_id` naming to match recent tables.

```sql
-- audits: record where a scan came from (guarded per Key Technical Decision §9)
-- add column audits.origin TEXT CHECK (origin IN ('app','public','mcp')) DEFAULT 'app' if not present

mcp_scan_requests (
  id UUID PK, org_id UUID, user_id UUID, audit_id UUID NULL,
  normalised_domain TEXT, cache_hit BOOLEAN, site_relationship TEXT,
  ip_hash TEXT, client_surface TEXT,            -- 'claude_ai' | 'claude_code' | 'other' (from OAuth client id)
  plan_at_request TEXT, created_at TIMESTAMPTZ
)

mcp_finding_disputes (
  id UUID PK, org_id UUID, user_id UUID, audit_id UUID, finding_id TEXT,
  rule_id TEXT, register_version TEXT, normalised_domain TEXT,
  reason TEXT, note TEXT NULL, status TEXT DEFAULT 'open',   -- open | upheld | rejected
  reviewed_by UUID NULL, reviewed_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ
)

mcp_rule_overrides (
  rule_id TEXT PK, disabled BOOLEAN, reason TEXT,
  updated_by UUID, updated_at TIMESTAMPTZ
)

mcp_tool_calls (
  id BIGSERIAL PK, org_id UUID, user_id UUID, tool TEXT, plan TEXT,
  outcome TEXT,                                  -- ok | quota | plan_required | error
  latency_ms INT, created_at TIMESTAMPTZ
)

profiles: add qualifying fields if not present
  ad_platforms TEXT[] NULL, monthly_ad_spend_band TEXT NULL, signup_source TEXT NULL  -- 'mcp' for connector sign-ups
```

No PII in `mcp_tool_calls`. Retain `mcp_tool_calls` for 180 days (scheduled cleanup job).

## 12. Authentication and sign-up

### 12.1 Approach

Every tool requires an authenticated user (D1: verified email). Lazy authentication (some tools without sign-in) was considered and rejected for v1 because it removes the qualification and abuse controls the free tier depends on.

- Authorisation server: **Supabase Auth's OAuth 2.1 server** on the existing project, so connector users are ordinary Atlas users and every existing plan, org and RLS assumption holds.
- Sign-in: email magic link (verification by construction) or existing Google sign-in. New users get a free org through the existing `handle_new_user()` trigger path, as the Shopify acquisition flow already does.
- After first sign-in from the connector, show two optional qualifying questions (ad platforms used, rough monthly spend band) on the consent page. Never block on them.

### 12.2 Requirements Claude imposes (verify against live docs during Phase 0)

- Unauthenticated `/mcp` requests return **401** with `WWW-Authenticate: Bearer resource_metadata="https://mcp.atlas.vimi.digital/.well-known/oauth-protected-resource"`. Claude ignores this header on a 200.
- Protected resource metadata (RFC 9728): `resource` equals the MCP URL exactly; `authorization_servers` lists the Supabase issuer **first** (Claude uses only the first entry).
- PKCE S256 supported and advertised.
- Redirect URIs: `https://claude.ai/api/mcp/auth_callback` for claude.ai, Desktop, mobile; port-agnostic loopback (`http://localhost/callback`, `http://127.0.0.1/callback`) for Claude Code.
- Token endpoint accepts `application/x-www-form-urlencoded`; refresh failures return `invalid_grant`; refresh tokens rotate for public clients.
- Discovery, registration and token endpoints respond within 10 seconds (30 for refresh).
- Client registration: Claude supports DCR, CIMD and Anthropic-held client credentials. For a high-traffic directory listing, prefer CIMD or Anthropic-held credentials over DCR (DCR registers a new client per connection). Phase 0 decides which of these Supabase supports cleanly; the expected outcome is Anthropic-held credentials for the hosted apps plus DCR (or CIMD if supported) for Claude Code and custom-connector testing.

### 12.3 Consent page

- New frontend route for Supabase's OAuth authorisation UI (exact path from Supabase's getting-started guide), e.g. `frontend/src/pages/OAuthConsentPage.tsx`, wrapped in `SectionErrorBoundary`, using operator console tokens.
- Shows: client name, redirect URI **hostname** (MCP spec requirement), requested scopes in plain English, approve and deny, a link to revoke later.
- Settings page gains a "Connected AI apps" section listing granted OAuth clients with revoke.

### 12.4 Token verification

- `mcpAuth.ts` verifies the bearer token as a Supabase-issued access token (confirm in Phase 0 whether `supabaseAdmin.auth.getUser(token)` accepts OAuth-server-issued tokens or whether JWKS verification with audience = MCP resource is required), then performs the same `profiles.plan` and super-admin resolution as `authMiddleware`.
- Reject tokens whose audience does not match the MCP resource.

## 13. Directory listing

- **Connector name:** "Atlas by ViMi" (avoids the naming collision with unrelated Atlas brands). Tagline and description written around the problems users type: "Is my conversion tracking healthy?", "Why don't Meta and GA4 agree?", "Is broken tracking hurting my bidding?". Neutral cross-platform positioning (Meta, Google, GA4, TikTok, LinkedIn), not single-platform.
- **Use cases** in the listing: pre-spend tracking check; diagnose a sudden CPA rise; agency weekly signal health review.
- **Submission package** (all mandatory per directory review): production deployment; OAuth with PKCE; every tool annotated with title and read-only or destructive hint; read and write separated; public documentation page (`vimi.digital/atlas/claude`) with setup, tools, limits and example prompts; privacy policy URL that covers connector data (what is stored, retention, no use of conversation content beyond the tool call); support contact; icon; a test account on the `pro` plan seeded with a demo org and two demo clients with realistic findings, DQM alerts and a reconciliation run.
- Confirm in Phase 3 which ViMi Claude organisation submits (the portal sits in organisation admin settings; check current plan requirements before submitting).
- Before submission, run the directory's pre-submission checklist and test the server as a custom connector in claude.ai, Desktop and Claude Code.

## 14. Telemetry and success metrics

Funnel, reported weekly from `mcp_scan_requests`, `mcp_tool_calls`, `profiles` and Stripe:

1. Connector sign-ups (`signup_source = 'mcp'`)
2. First scan started, first scan completed with `run_quality` not `INSUFFICIENT`
3. Second session within 14 days
4. Hit a free limit
5. Campaign Signal Validator purchases attributed to MCP users
6. Pro / Agency conversions attributed to MCP users
7. Cost per completed free scan; cache hit rate
8. Disputes per 100 findings, by rule

Initial targets are set after four weeks of data (D4), not in this PRD.

## 15. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Spike** (2 to 3 days) | SDK + Streamable HTTP in Express; Supabase OAuth server enabled on a branch; protected resource metadata; one `atlas_ping` tool; consent page skeleton. Answer: CIMD support, token verification method, body-parser placement. | Ping tool works as a custom connector from claude.ai and Claude Code with a real sign-in. Findings written back into this PRD §12. |
| **1 · Free tier** | §8.1 tools; §7 contract, mapper, lint; §9 quotas, cache, cost tracking, upgrade prompts; §10 allowlist, benchmark script, kill switch, disputes; migration; telemetry. | All §17 Phase 1 criteria pass. Benchmark run complete and allowlist committed. |
| **2 · Paid read tools** | §8.2 tools, plan errors, agency portfolio sort. | All §17 Phase 2 criteria pass. |
| **3 · Listing** | Docs page, privacy policy update, test account, listing copy, submission. | Submitted; review feedback tracked in submissions dashboard. |
| **4 · Later** (separate PRD) | `atlas_generate_fix`, write tools with approval flows, MCP Apps UI cards for scan results and portfolio health. | n/a |

## 16. Open questions

1. **Middle tier.** Starter plan, pay-per-scan, or Campaign Signal Validator as the only step between free and Pro? Deferred until four weeks of sign-up data (D4).
2. **Plan naming.** Code uses `free / pro / agency`; the pricing PRD uses Business / Agency / Enterprise. The connector follows code. Mapping to be settled in the pricing work, not here.
3. **Free limits.** Initial values in §9.1 are a starting point; revisit after the first month of cost and conversion data.
4. **Scan region.** Should paid users choose the scan region (for consent behaviour in EU vs GCC vs SEA)? Out of scope for v1; the region used is always disclosed.
5. **Benchmark size.** Is 30 sites enough to qualify a meaningful share of rules for the free tier? If too few rules qualify, the free scan becomes thin; decide after the first benchmark run whether to widen the set before launch.

## 17. Acceptance criteria

### Phase 1

- [ ] Unauthenticated call to `/mcp` returns 401 with a correct `resource_metadata` pointer; full sign-in completes from claude.ai and Claude Code.
- [ ] New connector sign-up creates a free org via the existing trigger and records `signup_source = 'mcp'`.
- [ ] `atlas_scan_site` returns within 5 seconds with a `scan_id`; scans run through the existing register pipeline with `audits.origin = 'mcp'`.
- [ ] Every finding has exactly one `result_type`, mapped per §7.1; unit tests cover every verdict and evidence class combination.
- [ ] A rule not on the free allowlist never produces `confirmed` or `likely` for a free user.
- [ ] `INSUFFICIENT` runs return no findings and no score; withheld scores return the reason and no number.
- [ ] No impact estimate is ever a single number; no estimate is returned without a data-backed source.
- [ ] `mcpOutputLint` runs on every tool response; a test injects each banned token into each string field and asserts rejection.
- [ ] Quotas enforced from Redis per user, IP hash and target domain; cached results do not consume quota or call Browserbase.
- [ ] Limit responses are normal tool results containing reset time, scan-specific upgrade value, and both upgrade URLs.
- [ ] Disabling a rule via `mcp_rule_overrides` removes it from responses within 60 seconds without a deploy.
- [ ] Disputes persist, trigger the 3-in-7-days alert, and never write `REFUTED` to `rule_confirmations`.
- [ ] Every tool has a title and correct read-only / destructive annotation.
- [ ] No PII in logs, queue payloads or `mcp_tool_calls` (Implementation Rules 3 and Key Technical Decision §5).

### Phase 2

- [ ] Free users calling a paid tool get a structured `plan_required` result with upgrade URL, not a protocol error.
- [ ] Every paid tool is scoped to the caller's resolved org; a test with two orgs proves no cross-org reads.
- [ ] `atlas_get_insights` returns structured anomalies and correlations, not `narratorService` text.
- [ ] `atlas_get_portfolio_summary` sorts by severity, then open issue count.
- [ ] Paid tools returning findings apply §7 mapping and lint.

## 18. Testing

- Vitest unit tests for `findingMapper`, `mcpOutputLint`, quota logic, cache keys, allowlist and override resolution.
- Supertest integration tests for the `/mcp` endpoint: 401 handshake, metadata document, tool listing with annotations, each tool's happy path and error path with mocked services.
- Contract snapshot tests: one fixture `ReportJSON` per `run_quality` value and per evidence class, asserting the exact MCP output.
- Manual: connect as a custom connector in claude.ai, Desktop and Claude Code; run the §5 jobs as prompts; check that Claude's narration follows §7.5 (record transcripts in `docs/prd/atlas-mcp-connector-qa.md`).

## 19. Update CLAUDE.md

On merge of each phase, add the connector to the Features list, the route to the Backend API Routes table, the new tables to the schema section, and a Key Technical Decision covering the §7 response contract and the free-tier allowlist rule.
