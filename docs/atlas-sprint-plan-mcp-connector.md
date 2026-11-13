# Atlas Sprint Plan · Atlas MCP Connector

**PRD:** `docs/prd/atlas-mcp-connector.md` (PR #409, branch `claude/atlas-mcp-connector-prd`, not yet merged to `main`; merge it before Sprint 0 so §12 can be updated in place)
**Branch:** `claude/keen-goodall-o32w0l`
**Date:** 2026-11-13
**Scope:** PRD Phases 0–3. Phase 4 (`atlas_generate_fix`, write tools, MCP Apps UI) is out of scope and needs its own PRD.

## Repo findings (2026-11-13)

Checked against `main` at `38ea1e0`:

- **No MCP SDK dependency.** `@modelcontextprotocol/sdk` is not in `backend/package.json`. Sprint 0 pins a version after reading the live package docs (decision §14).
- **No `audits.origin` column.** The PRD's migration guards it with "if not present"; it is not present. Add it with the §9 `DO $$ IF EXISTS` guard.
- **Latest migration is `20260924001`.** The PRD's `20261113001_mcp_connector.sql` sorts correctly, in the 11-digit form (decision §21).
- **`REGISTER_VERSION` is `1.5.0`** (`layers.ts:32`). The PRD never names a number, but `scan_cache` keys and the allowlist stamp must read this constant.
- **`BANNED_TOKENS` is exported** (`outputLint.ts:43`) and is currently six strings. `mcpOutputLint.ts` imports it and does not copy it.
- **Scan Input inference is not shared.** `publicAudit.ts` calls `detectSite()` and sets `declaration_source: 'INFERRED_FROM_SITE'` inline (lines ~69, 150, 166). The PRD requires extracting a shared helper, which is the first piece of Sprint 1 work and touches a live public endpoint, so it needs regression tests.
- **App mount order.** `express.json({ limit: '1mb' })` is at `app.ts:98` and `globalLimiter` covers `/api` only (`app.ts:123`). `/mcp` is outside `/api`, so it escapes the limiter by default. The SDK transport's body-parsing expectation is an open Phase 0 question.
- **Existing building blocks:** `utils/urlValidator.ts` (SSRF), `publicAuditLimiter.ts` (salted IP hash pattern), `adminMiddleware.ts`, `planGuard.ts`, `config/pricing.ts`, `services/usage/alertDelivery.ts`, `services/reporting/withAccessRegistry.ts`, `reporting/outputLint.ts`.
- **PRD wording slip:** §7.1 is titled "Three result types" but defines four (`confirmed`, `likely`, `cannot_verify`, `conflict`). The plan builds four. Fix the heading when the PRD is merged.

## Decisions to settle before or during Sprint 0

| # | Question | Resolved by |
|---|---|---|
| S1 | Does Supabase's OAuth 2.1 server support CIMD, DCR, or both? Can Anthropic-held credentials be used? | Sprint 0 spike |
| S2 | Does `supabaseAdmin.auth.getUser(token)` accept OAuth-server-issued tokens, or is JWKS verification with audience = MCP resource needed? | Sprint 0 spike |
| S3 | Body-parser placement for the SDK transport (pre-parsed JSON vs raw stream). | Sprint 0 spike |
| S4 | Hostname: `mcp.atlas.vimi.digital` needs DNS and a deployment route on the Node host. | Founder / ops, before Sprint 0 ends |
| S5 | Which ViMi Claude organisation submits to the directory, and any plan requirement. | Founder, before Sprint 5 |
| S6 | Benchmark ground truth: who labels 30+ sites. The PRD says ViMi labels them; this is the longest human lead-time item in the plan. | Founder, start during Sprint 0 |

Per the chosen approach, later sprints take the PRD's initial limits (§9.1) as given and list which spike outcomes would change their scope.

## Sprints

Sequenced by dependency, not calendar. Each sprint is one coherent deliverable.

| Sprint | Scope | Exit |
|---|---|---|
| **0** · spike (PRD Phase 0) | Add the SDK. Mount `backend/src/api/routes/mcp.ts` with Streamable HTTP in stateless mode. Return 401 plus `WWW-Authenticate` on unauthenticated calls. Serve `/.well-known/oauth-protected-resource` (`resource` equals the MCP URL, Supabase issuer first). Enable the Supabase OAuth server on a branch. Build the `OAuthConsentPage.tsx` skeleton. Ship one `atlas_ping` tool. Answer S1–S3. Write findings into PRD §12. | `atlas_ping` works as a custom connector from claude.ai and Claude Code with a real email sign-in. S1–S3 recorded. |
| **1** · foundations | Migration `20261113001_mcp_connector.sql` (`audits.origin`, `mcp_scan_requests`, `mcp_finding_disputes`, `mcp_rule_overrides`, `mcp_tool_calls`, `profiles` qualifying fields, RLS on all). Read live CHECK constraints first. `mcpAuth.ts` (token verify, plan and super-admin resolution, audience check). Extract the shared site-inference helper from `publicAudit.ts` with tests proving the public route is unchanged. Shared scan-start helper writing a user-owned audit with `origin = 'mcp'`. `config/mcpLimits.ts`. `signup_source = 'mcp'` and the two optional qualifying questions on the consent page. | Sign-up creates a free org via `handle_new_user()` with `signup_source = 'mcp'`. A scan can be started programmatically through the shared helper. Public audit tests pass unchanged. |
| **2** · response contract | `findingMapper.ts` (verdict × evidence class → `result_type`, per §7.1, including `PRESENCE`/`PRESENCE_INVERSE`, `conflict` from `signal_conflicts`, `cannot_verify` from `could_not_be_assessed` and `with_access`). `presentationRules.ts`. `mcpOutputLint.ts` over every string field of every response. Scan-level fields: `run_quality` (`INSUFFICIENT` returns no findings and no score), withheld-score reason, coverage, `observation_limits_global`, `next_steps`. Evidence redaction (query-string PII, ~2 KB excerpt cap). `impact.estimate` omitted unless a data-backed source exists. Contract snapshot fixtures: one `ReportJSON` per `run_quality` value and per evidence class. | Every verdict/evidence combination has a unit test. Lint test injects each banned token into each string field and asserts rejection. No single-number impact anywhere. |
| **3** · free-tier tools, quotas, cache | `atlas_get_account_status`, `atlas_scan_site` (async, returns `scan_id` within 5 s, SSRF-validated, `confirm_site_relationship` logged not enforced), `atlas_get_scan_result`, `atlas_explain_finding` (static rule metadata, no Browserbase cost). `mcpQuota.ts` with Redis counters for user, IP hash and domain, plus per-minute tool-call limits. `scanCache.ts` (domain + `REGISTER_VERSION` + `site_type`, 72 h, cache hits skip quota and Browserbase, `force_rescan` for paid). Limit-hit results as normal tool results with reset time, scan-specific upgrade copy, Pro checkout URL and Campaign Signal Validator URL. `usageLogger` with `origin = 'mcp'`; `MCP_FREE_WEEKLY_COST_CEILING` operator alert and "temporarily at capacity" fallback. `mcp_tool_calls` telemetry and 180-day cleanup job. Tool titles and annotations. | Phase 1 criteria on quotas, cache, limit responses, `INSUFFICIENT`, annotations and no-PII pass. |
| **4** · accuracy controls | `freeTierAllowlist.ts` (versioned, `MCP_FREE_ALLOWLIST_VERSION` stamped on every response, empty by default so a free user gets only `cannot_verify` until Sprint 4 closes). `scripts/mcpBenchmark.ts` plus the hand-labelled `scripts/mcp-benchmark/ground-truth.json`. Run the benchmark (5% false-positive ceiling, at least 10 applicable sites per rule) and commit the allowlist. `ruleOverrides.ts` (60 s in-process cache), `PATCH /api/admin/mcp/rules/:ruleId` and a minimal admin list view. `atlas_report_incorrect_finding` with PII-stripped notes, a weekly dispute digest through `alertDelivery.ts`, and the 3-disputes-in-7-days alert. Disputes never write `REFUTED`. No accuracy figure published anywhere (decision §20). | Phase 1 acceptance complete. Disabling a rule removes it within 60 s without a deploy. Allowlist committed with a benchmark run on record. |
| **5** · paid read tools (PRD Phase 2) | `atlas_list_clients`, `atlas_get_client_health`, `atlas_get_dqm_alerts`, `atlas_get_reconciliation` (with `platform_discontinuities` annotations), `atlas_get_insights` (structured anomalies and correlations, not `narratorService` text), `atlas_get_portfolio_summary` (agency, sorted by severity then open issue count), `atlas_get_scan_history` (uses `rule_confirmations` and `coverage_fingerprint`). Structured `plan_required` results with upgrade URL. Org resolved per decision §10, no tool takes an org id. Findings from IHC and reconciliation go through the §7 mapper and lint. Two-org isolation test. | Phase 2 criteria pass. |
| **6** · listing (PRD Phase 3) | Settings "Connected AI apps" section with revoke. Docs page content (`vimi.digital/atlas/claude`), privacy policy text, support contact, icon, listing copy ("Atlas by ViMi"). Seeded `pro` demo org with two clients and realistic findings, DQM alerts and a reconciliation run. Custom-connector test in claude.ai, Desktop and Claude Code against the §5 prompts, with transcripts in `docs/prd/atlas-mcp-connector-qa.md`. Run the directory pre-submission checklist, then submit. Update `CLAUDE.md` (Features, routes table, schema, a Key Technical Decision on the response contract and allowlist rule). | Submitted. Review feedback tracked. |

## Process

Order 0→1→2→3→4→5→6. Sprints 2 and 3 can overlap once Sprint 1 lands (the mapper does not need the tools). Sprint 5 does not depend on Sprint 4, so it can run in parallel if capacity allows. Per sprint: typecheck, tests, full backend suite (known 6 unrelated failures), one commit, push to the branch. No PR unless requested.

## Risks

- **Auth is the critical path.** Claude ignores `WWW-Authenticate` on a 200, uses only the first `authorization_servers` entry, and has strict redirect URI and refresh rules. If Supabase's OAuth server cannot meet them (S1/S2), Sprint 1's `mcpAuth.ts` and possibly the issuer choice change. This is the main reason Sprint 0 gates everything.
- **Thin free tier.** If few rules clear the 5% false-positive bar on 30 sites (PRD §16.5), the free scan returns mostly `cannot_verify`. Decide in Sprint 4 whether to widen the benchmark before launch. S6 labelling lead time is the likeliest slip.
- **Browserbase cost exposure.** Cache and quota are the only guard. Sprint 3's cost ceiling alert must ship together with the free scan tool, not after.
- **Narration drift.** The lint gate covers what Atlas sends, not what Claude says. The only check is the manual transcript review in Sprint 6, so budget time to iterate on `presentation_rules` wording.
- **Shared-helper extraction** touches the live public audit path. Keep it a pure refactor with the existing public-audit tests as the guard.
- **Infra:** a new hostname and TLS on the Node host; Anthropic egress range `160.79.104.0/21` allowance and `Origin` validation need confirming in Sprint 0.
- **Unverified third-party specifics** (SDK API, Supabase OAuth server behaviour, directory requirements) were taken from the PRD and not re-checked here. Verify each against live docs in the sprint that uses it.
