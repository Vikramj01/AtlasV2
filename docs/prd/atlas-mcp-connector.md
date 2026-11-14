# PRD · Atlas MCP Connector · The Atlas Method inside Claude

**Intended repo path** · `docs/prd/atlas-mcp-connector.md`
**Status** · Draft for build (revision 2)
**Author** · ViMi Digital
**Date** · 14 November 2026
**Related** · `api/routes/publicAudit.ts`, `services/validation/register/`, `services/attribution/`, `services/reporting/outputLint.ts`, `services/reporting/withAccessRegistry.ts`, `services/dashboard/dashboardSummaryService.ts`, `services/dqm/`, `services/reconciliation/`, `services/air/`, Campaign Signal Validator, `docs/prd/pre-connection-scan-confidence-tiering.md`, `docs/prd/attribution-chain-check.md`

**Revision 2 changes** · The connector is now organised around one question, "are my conversions firing properly?", answered with a defined method (§5). Adds per-conversion results, bidding implications, proactive ad-account checks the user's own Claude can run through their other connectors (§8), and a consented route for the user to ask ViMi consulting for help, with a choice of free review, call or paid diagnostic (§9). Scope is both ecommerce and lead-gen.

---

## 1. Problem

Atlas's growth is held back by distribution (people who would benefit do not find it) and ease of use (getting value means logging in to a dashboard and learning a new surface).

The people Atlas serves increasingly run their ad accounts from inside Claude. Meta ships an official read-write Ads MCP server and Google an official read-only Google Ads MCP server. Those tools report performance. None of them tells the user whether the conversions feeding the bidding are real, counted once, valued correctly and matchable. When a user asks "why did my CPA jump?", a broken signal is often the answer, and Atlas is not in that conversation.

Today a prospect who would benefit from ViMi's signal engineering work has no contact with ViMi at all. The connector must create that first contact.

## 2. Goals

- A user in Claude can ask "are my conversions firing properly?" and get a clear, honest answer against a defined standard (the Atlas method, §5) for both purchases and lead forms.
- Every result explains what it means for the user's bidding, not just what is technically wrong.
- Atlas proactively tells the user which checks to run inside their ad accounts, so their Claude can complete the picture using the Meta, Google Ads or GA4 tools they already have connected, without Atlas needing account access.
- Users whose problems need specialist work have an easy, consented way to reach ViMi consulting, with a choice of free review, a call, or the paid Campaign Signal Validator.
- Paying Atlas customers can query portfolio health, DQM alerts, reconciliation and anomalies from Claude.
- Nothing Atlas returns asserts more than the scan observed, even after the user's Claude has rephrased it.
- Passes Connectors Directory review on first submission.

## 3. Non-goals (v1)

- **No write actions.** No GTM publish or draft deploy, no CAPI changes, no audience pushes. Later, separate PRD.
- **Atlas does not read the user's ad accounts in the free tier.** Account-side checks are run by the user's own Claude through connectors the user already has (§8). Atlas never receives those connectors' credentials.
- **No real purchases.** The scan never completes a paid order (§5.3).
- No new detection rules beyond the static mappings in §6.4 and §9.2. The connector exposes Check Register v2 and Attribution Chain Check output.
- No new billing tier. The middle step between free and Pro is deferred until sign-up data exists.
- No MCP Apps UI in v1 (planned for Phase 4).
- No ChatGPT or Cursor specific work; v1 is tested and listed for Claude only.

## 4. Decisions already made

| # | Decision | Source |
|---|---|---|
| D1 | Free tier: small, rate-limited, requires a verified email sign-in. Larger use needs a paid account. | Founder, 12 Nov 2026 |
| D2 | Free **detects** (what, how serious, what it means for bidding). Paid and ViMi consulting **diagnose and fix**. The Campaign Signal Validator is an upgrade from the free scan, not a competitor to it. | Founder |
| D3 | Agency needs (multi-client, portfolio) are paid only. | Founder |
| D4 | Measure sign-ups first, then decide the middle tier. | Founder |
| D5 | Trust over reach: free-tier allowlist, evidence on every finding, response contract that stops overstatement, disputes, per-rule kill switch. | Founder |
| D6 | One-off checks can be free; anything continuous is paid. | Founder |
| D7 | Read and write tools are always separate; v1 ships read tools plus two non-destructive tools (dispute, review request). | Directory requirement + D5 |
| D8 | Scope covers both ecommerce purchases and lead-gen forms. | Founder, 14 Nov 2026 |
| D9 | When the user wants help, they choose: free review of their scan, a booked call, or the paid Campaign Signal Validator. | Founder, 14 Nov 2026 |
| D10 | Help requests go to ViMi consulting. | Founder, 14 Nov 2026 |
| D11 | Atlas is proactive: every scan result includes specific account-side checks for the user's Claude to run with the user's own ad platform connectors. | Founder, 14 Nov 2026 |

## 5. The Atlas method · what "firing properly" means

A conversion fires properly when the ad platform receives a signal it can use for bidding. The method is six tests applied to each conversion, in order. A failure early in the chain makes everything after it unreliable, and results say so.

### 5.1 The six tests (checked from the website)

| # | Test | Question | Register coverage (examples, not exhaustive) |
|---|---|---|---|
| T1 | **Right action** | Does it fire on the real conversion, not on intent, a page load or a refreshable thank-you page? | L1 tags present (`GTM_CONTAINER_LOADED`, `META_PIXEL_PRESENT`, ...), L5 `PRIMARY_CONVERSION_EVENT_FIRES`, platform `*_CONVERSION_EVENT_FIRES`, `FIRES_ON_COMPLETION_NOT_ON_INTENT`, `NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES` |
| T2 | **Counted once** | Is it counted exactly once across pixel, CAPI, duplicate containers and duplicate tags? | L5 `EVENT_FIRES_EXACTLY_ONCE`, L6 `TRANSACTION_ID_PRESENT`/`EVENT_ID_PRESENT`, L10 `EVENT_ID_CONSISTENT_CLIENT_TO_SERVER`/`EVENT_ID_FORWARDED_TO_PLATFORM_REQUESTS`, L12 duplicate container/base tag rules |
| T3 | **Right value** | Does it carry a plausible value and valid currency that reflect what happened? | L6 `CONVERSION_VALUE_PRESENT`, `VALUE_NON_ZERO_AND_PLAUSIBLE`, `VALUE_DIFFERENTIATES_OUTCOMES`, `CURRENCY_PRESENT_AND_VALID`, `LEAD_QUALITY_INDICATOR` |
| T4 | **Matchable** | Can the platform tie it to a click and a person? Click IDs captured on arrival, persisted, carried to the conversion; customer data normalised and hashed. | L2 click-ID capture rules, L2.14 `CLICK_ID_CARRIED_IN_FORM_SUBMIT`, L3 persistence rules, L7 identity rules; Attribution Chain Check links 1 to 3 for lead-gen |
| T5 | **Consent-correct** | Does it fire when it should, stop when it should, with Consent Mode signalled so platforms can model the gaps? | L8 consent rules |
| T6 | **Survives the journey** | Does the chain hold across checkout or booking domains, iframes and SPA routes? | L4 cross-domain rules, `PAGE_VIEW_FIRES_ON_EVERY_ROUTE`, iframe/shadow-DOM capture |

L9 (server-side delivery) and L0 (scope) results feed T2 and T4 where relevant and are also reported in the scan-level summary. L11 is disclosure-only and never appears in the free tier.

The authoritative rule-to-test mapping lives in code (`services/mcp/method/testMap.ts`), not in this table. Every rule in `REGISTER` must map to exactly one test or to `not_in_method` (enforced by a unit test, so a new rule cannot be added without a decision).

### 5.2 The seventh test (checked in the ad account)

**T7 · Received and used.** Did the platform actually receive and attribute the conversion, and is it the conversion the account optimises for? This cannot be seen from the website. Atlas does not read the account in the free tier; instead it hands the user's Claude a specific list of account checks (§8).

### 5.3 What the scan can and cannot do per conversion type

| Conversion type | How it is exercised | Limits stated in every result |
|---|---|---|
| **Lead form** (lead_gen sites) | The existing lead-gen form fill and submit, using the fixed test identity `info@vimi.digital` (config `MCP_TEST_SUBMISSION_EMAIL`), a name field of "Atlas test submission" and a synthetic click ID per platform. Only with the user's explicit `allow_test_submission: true`. | A test lead will reach their form handler or CRM, clearly labelled. Without permission, lead tests that need a submit are `not_verified`. |
| **Purchase** (ecommerce sites) | The journey runs to product, cart and checkout. **No order is ever placed.** | T1 to T3 for the purchase event itself are `not_verified` from the website; checks up to checkout are reported. The purchase event is covered by T7 account checks (compare platform-reported purchases with real orders). |
| **Sign-up / trial** (plg_saas) | Runs as today where a sign-up surface is reachable without real credentials. | Same honesty rules. |

### 5.4 Test status

Each (conversion × platform × test) cell resolves to one status:

| Status | Rule |
|---|---|
| `pass` | Every applicable rule in the test resolved `PASS`, and at least one with `DIRECT` or `PRESENCE` evidence. |
| `fail` | At least one rule `FAIL` with `DIRECT` evidence (a `confirmed` finding). |
| `at_risk` | At least one `likely` finding and no confirmed one. |
| `not_verified` | Not enough resolved to say either way, or the step was not exercised (§5.3). |
| `not_applicable` | No rule in the test applies to this platform or site type. |

A test is never shown as `pass` when most of it was not verified. If an earlier test is `fail`, later tests on the same conversion carry `depends_on_failed_test: "T1"` so the user's Claude explains the chain, mirroring the Attribution Chain Check cascade rule.

## 6. Response contract (the honesty layer)

In a connector, Atlas does not control the final wording. The contract makes overstatement structurally hard.

### 6.1 Finding result types

| `result_type` | Source in Check Register v2 | Meaning |
|---|---|---|
| `confirmed` | verdict `FAIL`, `evidence_class` `DIRECT` | Seen directly in this scan |
| `likely` | verdict `FAIL`, `evidence_class` `INFERRED`/`DERIVED` | Strong indirect evidence |
| `cannot_verify` | `NOT_OBSERVED`/`INCONCLUSIVE`, any `could_not_be_assessed`, any `with_access` entry | Not observable from the website |
| `conflict` | `CONFLICT`, any `signal_conflicts` entry | Two detectors disagree; both readings returned |

`PRESENCE`/`PRESENCE_INVERSE` rules map by verdict the same way.

### 6.2 Scan result shape

```ts
interface McpScanResult {
  scan_id: string;
  site: { url: string; site_type: SiteType; site_type_source: 'declared' | 'inferred' };
  run_quality: 'COMPLETE' | 'PROVISIONAL' | 'INSUFFICIENT';
  method_version: string;                 // MCP_METHOD_VERSION, bumped with testMap/biddingImpact changes
  register_version: string;
  free_allowlist_version?: string;

  headline: {                             // one-paragraph answer to "are my conversions firing properly?"
    verdict: 'healthy' | 'issues_found' | 'serious_issues' | 'could_not_complete';
    summary: string;                      // lint-gated, no numbers that are not in the data
  };

  conversions: Array<{
    conversion: 'purchase' | 'lead' | 'sign_up' | 'other';
    exercised: 'fully' | 'up_to_checkout' | 'not_exercised';
    platforms: Array<{
      platform: DeclaredPlatform;         // google_ads, ga4, meta, tiktok, linkedin, microsoft, openai, ...
      detected: boolean;
      tests: Array<{
        test: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
        status: 'pass' | 'fail' | 'at_risk' | 'not_verified' | 'not_applicable';
        depends_on_failed_test?: string;
        finding_ids: string[];
      }>;
    }>;
  }>;

  findings: McpFinding[];                 // §6.3
  account_checks: AccountCheck[];         // §8
  observation_limits_global: string[];    // server-side CAPI invisible; GTG first-party serving; consent varies by region (scan region named); no real purchase placed
  presentation_rules: string[];           // §6.6
  help: HelpOffer;                        // §9
}
```

### 6.3 Finding shape

```ts
interface McpFinding {
  finding_id: string;                    // `${audit_id}:${rule_id}:${step ?? 'site'}`
  rule_id: string;
  test: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
  platforms: DeclaredPlatform[];
  result_type: 'confirmed' | 'likely' | 'cannot_verify' | 'conflict';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  what_we_saw: string;
  observation_limits: string[];
  evidence: {
    page_url?: string;
    request_url?: string;                 // query-string PII redacted
    event_name?: string;
    payload_excerpt?: Record<string, unknown>;   // PII-stripped, max ~2KB
    datalayer_excerpt?: Record<string, unknown>;
  };
  bidding_impact: {                       // §6.4
    effect: 'overstated_conversions' | 'understated_conversions' | 'wrong_value' | 'unmatched_conversions'
          | 'consent_loss' | 'journey_break' | 'wrong_optimisation_target' | 'data_quality';
    explanation: string;                  // plain English, what this does to Smart Bidding / Advantage+ / tCPA / tROAS
    what_not_to_do?: string;              // e.g. "Don't raise budgets based on reported ROAS until this is fixed."
  };
  fix: {
    complexity: 'settings_change' | 'tag_change' | 'implementation' | 'specialist';   // §9.2
    diy_guidance?: string;                // only for settings_change and tag_change
  };
  verify_in_account?: string[];           // account_check ids that would confirm or refute this finding
  dispute_hint: string;
}
```

### 6.4 Bidding implications

- `services/mcp/method/biddingImpact.ts`: a static, versioned map from `rule_id` (or rule family) to `effect`, `explanation` template and optional `what_not_to_do`. Written by ViMi, reviewed like copy, linted.
- Examples of the register this should take:
  - T2 fail: "Purchases are counted more than once, so Smart Bidding sees more conversions and higher ROAS than you really have. Don't scale budgets on reported ROAS until this is fixed."
  - T4 fail (lead-gen): "Click IDs are lost before the form is submitted, so Google cannot link leads back to clicks. tCPA and Maximise Conversions campaigns are optimising on partial data."
  - T3 at risk: "Every lead carries the same value, so value-based bidding cannot tell a good lead from a poor one."
- No numeric impact is ever stated unless an existing data-backed source produces it, and then only as a range with assumptions (Implementation Rule 12).

### 6.5 Output lint

- `mcpOutputLint.ts` scans every string field of every tool response against `outputLint.ts`'s `BANNED_TOKENS` (reuse the export).
- A violation in a `cannot_verify` or `likely` finding, a `not_verified` test, or any `bidding_impact.explanation` is a hard failure: the response is replaced by an error result and logged at `error`.

### 6.6 Presentation rules sent to the assistant

Returned in `presentation_rules` and repeated in tool descriptions:

1. Lead with `headline.summary`, then walk through each conversion by test, in order T1 to T6.
2. Only describe `confirmed` findings and `fail` tests as problems that exist. Describe `likely` and `at_risk` as probable.
3. Never describe `cannot_verify` or `not_verified` as missing, broken or absent. Say it could not be checked from the website and name the account check that would check it.
4. When a test depends on an earlier failed test, explain that fixing the earlier one comes first.
5. Always include the `bidding_impact` for each problem. Never state a single-number impact.
6. Present `conflict` findings with both readings.
7. After the results, offer the `account_checks` (§8). Ask the user before using any of their other connectors.
8. Mention the `help` offer once, after the results, only if `help.offer_shown` is true. Do not repeat it or press it.
9. If `run_quality` is `INSUFFICIENT`, say the scan could not complete and list no findings.

## 7. Architecture

### 7.1 Placement

- New Express router inside the existing backend (`backend/src/api/routes/mcp.ts` plus `backend/src/services/mcp/`). Calls existing services directly.
- Transport: MCP Streamable HTTP, stateless, official TypeScript SDK (`@modelcontextprotocol/sdk`). Verify the current SDK version and Express integration against live docs before coding (Key Technical Decision §14).
- Public URL: proposed `https://mcp.atlas.vimi.digital/mcp`; protected resource metadata `resource` must equal it exactly.
- Mount `/mcp` and `/.well-known/oauth-protected-resource` outside the `/api` global limiter and before any router whose path could prefix them (Key Technical Decision §26). Confirm the SDK's body-parsing expectation and place `express.json()` accordingly.
- Validate the `Origin` header if present; traffic arrives from Anthropic's egress range (`160.79.104.0/21`).

### 7.2 Module layout

```
backend/src/
├── api/routes/mcp.ts
├── api/middleware/mcpAuth.ts
├── api/middleware/mcpQuota.ts
└── services/mcp/
    ├── server.ts
    ├── tools/                       # one file per tool (§10)
    ├── method/
    │   ├── testMap.ts               # rule_id → T1..T6 | not_in_method (§5.1)
    │   ├── testStatus.ts            # rollup to pass/fail/at_risk/not_verified (§5.4)
    │   ├── biddingImpact.ts         # §6.4
    │   ├── fixComplexity.ts         # §9.2
    │   └── accountChecks.ts         # §8 catalogue + selector
    ├── contract/
    │   ├── resultBuilder.ts         # ReportJSON (+ AttributionChainResult) → McpScanResult
    │   ├── presentationRules.ts
    │   └── mcpOutputLint.ts
    ├── help/
    │   ├── offerSelector.ts         # §9.2
    │   └── reviewRequest.ts         # §9.3, lead routing to ViMi consulting
    ├── accuracy/
    │   ├── freeTierAllowlist.ts
    │   └── ruleOverrides.ts
    ├── scanCache.ts
    └── telemetry.ts
```

### 7.3 Scan execution

- Reuse `auditQueue → runAuditOrchestrator → journeySimulator → runRegister()`. Audit row user-owned with `origin = 'mcp'`. Inferred Scan Inputs via `siteDetectionService` (`declaration_source: 'INFERRED_FROM_SITE'`); extract `publicAudit.ts`'s inference into a shared helper.
- For lead-gen sites with `allow_test_submission: true`, pass the synthetic test email/phone so the existing form fill and Attribution Chain Check (`chainOrchestration.ts`'s `deriveAttributionChain()`) run, and include the chain in the result (it populates T4 for the `lead` conversion).
- Ecommerce journeys never submit payment. Confirm `journeySimulator.ts`'s ecommerce template stops before any payment submit; add a hard guard if not.
- `atlas_scan_site` enqueues and returns a `scan_id`; `atlas_get_scan_result` polls.

## 8. Proactive account checks (the bridge to the ad account)

### 8.1 Concept

Many users have Meta, Google Ads or GA4 tools connected in the same Claude conversation. Atlas cannot see those accounts, but it knows exactly what to look for given the scan. Every scan result therefore includes `account_checks`: specific, prioritised checks the user's Claude can run with the user's own tools, or the user can do by hand.

Atlas never names or depends on a particular third-party connector or tool name. It describes the check, the platform, where it lives and what a good or bad answer looks like. The user's Claude decides whether it has a tool that can answer it, and asks the user first (presentation rule 7).

### 8.2 Shape

```ts
interface AccountCheck {
  check_id: string;                       // stable, e.g. 'META_EMQ_PURCHASE'
  platform: 'meta' | 'google_ads' | 'ga4' | 'tiktok' | 'linkedin' | 'microsoft';
  priority: 'high' | 'medium' | 'low';
  question: string;                       // "What is the Event Match Quality for the Purchase event?"
  why: string;                            // tied to this scan's findings
  where: string;                          // "Meta Events Manager > Data sources > [dataset] > Overview"
  good_answer: string;                    // "6.0 or higher"
  bad_answer_means: string;               // "Meta is struggling to match purchases to people; see finding X"
  linked_finding_ids: string[];
  completes_test: 'T7' | 'T2' | 'T3' | 'T4';  // which test this check confirms or refutes
}
```

### 8.3 Catalogue (v1, maintained by ViMi in `accountChecks.ts`)

Selected per scan by platform detected, conversion type and findings. Initial set:

| Platform | Check | Selected when |
|---|---|---|
| Google Ads | Is the conversion action for this event set as **primary** and included in the bid strategy's goal? | Google Ads detected (always) |
| Google Ads | Lead actions counted **one per click**, purchases **every**? | Lead or purchase conversion present |
| Google Ads | Conversion action **status** and diagnostics (recording, no recent conversions, unverified) | Always |
| Google Ads | **Enhanced conversions** status and coverage for the action | T4 finding on identity, or lead-gen |
| Google Ads | Platform-reported conversions vs real orders/leads for the last 7 days roughly match | T2 fail/at_risk, or purchase `up_to_checkout` |
| Google Ads | Auto-tagging enabled | T4 click-ID finding |
| Meta | **Event Match Quality** for the main conversion event | Meta detected |
| Meta | Browser and server events **deduplicated** (Events Manager shows both, with dedup) | CAPI suspected or T2 finding |
| Meta | Ad sets **optimise for** the event Atlas checked, not a proxy | Meta detected |
| Meta | Diagnostics tab warnings for the dataset | Always |
| GA4 | Event marked as a **key event** | GA4 detected |
| GA4 | Google Ads **link** present and the key event imported to Ads | GA4 + Google Ads detected |
| GA4 | Unwanted referrals / cross-domain configured for the checkout or booking domain | T6 finding |
| TikTok / LinkedIn / Microsoft | Event received in the platform's events tool and used for optimisation | Platform detected |

### 8.4 Bringing results back

`atlas_record_account_check` (non-destructive) lets the user's Claude store what it found against a `scan_id`: `check_id`, `outcome` (`good` / `bad` / `unclear`), short note. No account IDs beyond the platform name, no PII, no copied report data beyond the answer. Stored results:

- update the scan's T7 status per conversion and platform, and
- are attached to any later review request (§9), so ViMi sees the full picture.

Notes are length-limited (500 chars) and PII-stripped before insert.

## 9. Help route to ViMi consulting

### 9.1 Principle

The connector exists to put Atlas in front of people who would never otherwise contact ViMi. Contact must be easy, consented and never pushy. The scan answers the question fully on its own; the offer is a clearly labelled option after the results.

### 9.2 When the offer appears

`offerSelector.ts` sets `help.offer_shown = true` when any of these hold:

- any `confirmed` or `likely` finding with `fix.complexity` of `implementation` or `specialist`;
- a lead-gen Attribution Chain break at Tier 3 or above;
- two or more tests `fail` on the same conversion;
- the user explicitly asks how to fix something or asks for help (the tool is always callable).

`fixComplexity.ts` maps each rule to `settings_change` (a toggle in a platform or CMP), `tag_change` (GTM edit), `implementation` (developer work: dataLayer, CAPI, form changes) or `specialist` (cross-domain, CRM click-ID carriage, server-side, consent architecture). Self-serve findings get `diy_guidance` and no offer unless other conditions hold.

### 9.3 The choice (D9)

```ts
interface HelpOffer {
  offer_shown: boolean;
  reason?: string;                       // "2 issues need implementation work (T2, T4)"
  options: Array<
    | { kind: 'free_review'; label: string; description: string; turnaround_text: string }   // turnaround from config, not promised in code
    | { kind: 'call';        label: string; description: string; booking_url: string }
    | { kind: 'validator';   label: string; description: string; price_text: string; checkout_url: string }
  >;
}
```

- **Free review**: a ViMi signal engineer reviews the scan (plus any recorded account checks) and replies with a prioritised fix plan. Turnaround text comes from config (`MCP_REVIEW_TURNAROUND_TEXT`, initial value "within 24 hours") so ViMi controls the promise.
- **Call**: ViMi's Google Calendar appointment booking page (`MCP_BOOKING_URL` = `https://calendar.app.google/XYtLkuYZHGXvu7jv6`). The booking form has a **Scan ID** field, but Google Calendar appointment schedules do not document pre-filling booking-form fields from the URL, so Atlas does not rely on it. Instead:
  1. `atlas_request_review` with `choice: 'call'` is the primary link: it logs the request with the scan ID and the user's email and notifies ViMi **before** the user books, so the booking can be matched to the scan by email.
  2. The tool result returns the booking URL together with a short `scan_reference` (the first 8 characters of the scan ID, uppercase) and tells the assistant to show it and ask the user to paste it into the Scan ID field.
  3. If ViMi later moves to a booking tool that supports URL pre-fill (Calendly, Cal.com), set `MCP_BOOKING_SCAN_ID_PARAM` and Atlas appends `?<param>=<scan_reference>` automatically. Leave it unset for Google Calendar.
- **Campaign Signal Validator**: the existing paid diagnostic via the existing Stripe Checkout flow, pre-filled with the scanned URL.

### 9.4 `atlas_request_review`

Non-destructive tool. Inputs:

```ts
{
  scan_id: string;
  choice: 'free_review' | 'call';        // validator returns a checkout link via the help block, no lead form needed
  name: string;
  email?: string;                         // defaults to the signed-in email
  company?: string;
  role?: string;
  phone?: string;
  message?: string;                       // what they want help with, max 1,000 chars
  consent_to_contact: true;               // required literal; the tool refuses without it
}
```

Behaviour:

- Refuses unless `consent_to_contact` is `true`. The tool description tells the assistant to ask the user for consent in plain words and never to set it on the user's behalf.
- Writes `mcp_review_requests` (§12) with the scan, recorded account checks, qualifying profile fields and the user's choice.
- Notifies **ViMi consulting** (D10) via a dedicated destination: email to `VIMI_CONSULTING_LEADS_EMAIL` (initial value `vikram@vimi.digital`) and optional Slack webhook `VIMI_CONSULTING_LEADS_SLACK_WEBHOOK`, reusing `services/usage/alertDelivery.ts` / `emailService` patterns. The notification includes a link to the scan in Atlas's admin view, the headline, failed tests, bidding impacts, account check outcomes and the user's message. Never the raw evidence payloads.
- Sends the user a confirmation email (existing email service) restating what they asked for and that ViMi will respond.
- For `call`, returns the booking URL as well, so the user can book immediately.
- One open request per user per scan; repeat calls update the existing request.

### 9.5 Lead handling in Atlas

- Super-admin list at `GET /api/admin/mcp/review-requests` with status (`new`, `contacted`, `qualified`, `closed`), assignee and notes; minimal table in the admin page.
- `PATCH /api/admin/mcp/review-requests/:id` to update status.
- Leads are ViMi consulting's; no automatic sync to any CRM in v1.

## 10. Tools

All names prefixed `atlas_`. Every tool has a `title` and `readOnlyHint` / `destructiveHint` annotations. Zod input schemas. Responses include `structuredContent` plus a short text summary.

### 10.1 Free tier

| Tool | Annotations | Purpose |
|---|---|---|
| `atlas_get_account_status` | readOnly | Plan, remaining scans, what paid adds |
| `atlas_check_conversions` (alias of scan start) | readOnly: false, destructive: false | Start a scan of a URL against the Atlas method. Inputs: `url`, optional `site_type`, `declared_platforms`, `conversions_of_interest` (`purchase`/`lead`/`sign_up`), `allow_test_submission` (default false, explained in description), `site_relationship`. Returns `scan_id`. |
| `atlas_get_scan_result` | readOnly | Poll; when complete returns `McpScanResult` (§6.2) |
| `atlas_explain_finding` | readOnly | Plain explanation of a finding or test, why it matters for bidding, DIY guidance where applicable |
| `atlas_record_account_check` | readOnly: false, destructive: false | Store the outcome of an account check (§8.4) |
| `atlas_request_review` | readOnly: false, destructive: false | Send a consented help request to ViMi consulting (§9.4) |
| `atlas_report_incorrect_finding` | readOnly: false, destructive: false | Dispute a finding (§11.4) |

`atlas_check_conversions` is the primary tool name because it matches how users phrase the question. Its description is written around "are my conversions firing properly / is my tracking working / why don't Meta and GA4 agree".

### 10.2 Paid tier (`pro`+ unless stated)

| Tool | Plan | Purpose | Backed by |
|---|---|---|---|
| `atlas_list_clients` | pro | Clients with health level and open issue counts | `getClientSummaries(orgId)` |
| `atlas_get_client_health` | pro | One client's findings, DQM severity, match quality, dedup rate, mapped to the Atlas method tests | dashboard, IHC, DQM queries |
| `atlas_get_dqm_alerts` | pro | Recent DQM alerts | DQM tables |
| `atlas_get_reconciliation` | pro | Platform vs GA4 vs outcome gaps; answers T7 from real data for connected clients | reconciliation tables |
| `atlas_get_insights` | pro | AIR anomalies and correlations as structured data | `air_anomalies`, `air_insight_correlations` |
| `atlas_get_portfolio_summary` | agency | Cross-client rollup sorted by severity | `getClientSummaries` + sort |
| `atlas_get_scan_history` | pro | What changed between scans, using `rule_confirmations` and `coverage_fingerprint` | audits + comparator |

Paid tools return a structured `plan_required` result with upgrade URL to free users. Every query is scoped to the caller's resolved org (Key Technical Decision §10). Paid findings follow §6.

### 10.3 Deferred (Phase 4, separate PRD)

`atlas_get_connect_link` (deep link into Atlas Platform Connections), `atlas_generate_fix`, write tools with approval flows, MCP Apps cards.

## 11. Quotas, cost and accuracy

### 11.1 Limits (config, `config/mcpLimits.ts`)

| Limit | Free | Pro | Agency |
|---|---|---|---|
| New scans per user per month | 3 | 50 | 300 |
| Distinct domains per user per month | 2 | unlimited within scans | unlimited within scans |
| Concurrent scans per user | 1 | 3 | 10 |
| Scans per IP per day | 10 | n/a | n/a |
| Scans per target domain per day (free, all accounts) | 5 (cache serves the rest) | n/a | n/a |
| Test submissions per target domain per day | 2 | 5 | 10 |
| Review requests per user per day | 3 | 3 | 3 |
| Tool calls per user per minute | 30 | 120 | 300 |

Counters in Redis; IPs stored only as salted hashes.

### 11.2 Cache

Key: registrable domain + `REGISTER_VERSION` + `MCP_METHOD_VERSION` + site_type + `allow_test_submission`. TTL 72 hours. Cached hits cost no quota and no Browserbase. Paid users may `force_rescan`. Account check results are per user and never cached across users.

### 11.3 Cost

Non-cached scans logged via `usageLogger` with `origin = 'mcp'`. Operator alert and graceful "at capacity" response when free-tier Browserbase spend over 7 days exceeds `MCP_FREE_WEEKLY_COST_CEILING`.

### 11.4 Accuracy controls

- **Free-tier allowlist** (`freeTierAllowlist.ts`, versioned): only listed rules can produce `confirmed`/`likely` for free users; others return `cannot_verify`. Qualification via `scripts/mcpBenchmark.ts` against a hand-labelled ground-truth set of at least 30 sites (both ecommerce and lead-gen, mixed stacks), false-positive rate at or below 5% with at least 10 applicable sites. No accuracy figure is ever published (Key Technical Decision §20).
- **Kill switch**: `mcp_rule_overrides`; disabled rules disappear from responses within 60 seconds. `PATCH /api/admin/mcp/rules/:ruleId`.
- **Disputes**: `mcp_finding_disputes`; weekly digest; 3+ disputes from distinct users in 7 days triggers an operator alert. Never auto-writes `REFUTED` to `rule_confirmations`.

## 12. Data model

Migration `supabase/migrations/20261115001_mcp_connector.sql` (11-digit version, Key Technical Decision §21). RLS on every table; `org_id` naming.

```sql
-- audits.origin TEXT CHECK (origin IN ('app','public','mcp')) DEFAULT 'app'  (guarded, KTD §9)

mcp_scan_requests (id, org_id, user_id, audit_id NULL, normalised_domain, cache_hit,
                   site_relationship, allow_test_submission BOOLEAN, conversions_of_interest TEXT[],
                   ip_hash, client_surface, plan_at_request, created_at)

mcp_account_check_results (id, org_id, user_id, audit_id, check_id, platform,
                           outcome ['good'|'bad'|'unclear'], note TEXT NULL, created_at,
                           UNIQUE (user_id, audit_id, check_id))

mcp_review_requests (id, org_id, user_id, audit_id, choice ['free_review'|'call'],
                     name, email, company NULL, role NULL, phone NULL, message NULL,
                     consent_to_contact BOOLEAN NOT NULL CHECK (consent_to_contact),
                     consent_text_version TEXT, status ['new'|'contacted'|'qualified'|'closed'] DEFAULT 'new',
                     assignee UUID NULL, internal_notes TEXT NULL,
                     created_at, updated_at, UNIQUE (user_id, audit_id))

mcp_finding_disputes (id, org_id, user_id, audit_id, finding_id, rule_id, register_version,
                      normalised_domain, reason, note NULL, status DEFAULT 'open',
                      reviewed_by NULL, reviewed_at NULL, created_at)

mcp_rule_overrides (rule_id PK, disabled, reason, updated_by, updated_at)

mcp_tool_calls (id, org_id, user_id, tool, plan, outcome, latency_ms, created_at)   -- no PII, 180-day retention

profiles: ad_platforms TEXT[] NULL, monthly_ad_spend_band TEXT NULL, signup_source TEXT NULL
```

`mcp_review_requests` holds contact data the user chose to give. Readable only by super-admins and the requesting user; excluded from every analytics export; included in the privacy policy and deletion flow.

## 13. Authentication and sign-up

Unchanged from revision 1, summarised:

- Every tool requires sign-in (D1). Supabase Auth OAuth 2.1 server on the existing project; magic link or Google sign-in; new users get a free org via `handle_new_user()`; `signup_source = 'mcp'`.
- Optional qualifying questions on the consent page (ad platforms, spend band). Never blocking.
- Claude requirements: 401 with `WWW-Authenticate: Bearer resource_metadata=...`; protected resource metadata with `resource` equal to the MCP URL and the Supabase issuer first in `authorization_servers`; PKCE S256; redirect URIs `https://claude.ai/api/mcp/auth_callback` plus port-agnostic loopback for Claude Code; form-urlencoded token endpoint, `invalid_grant` on dead refresh tokens, rotation for public clients; endpoints under 10 s (30 s refresh).
- Registration: prefer CIMD or Anthropic-held credentials over DCR for a high-traffic listing. Phase 0 confirms what Supabase supports and how to verify its tokens (`supabaseAdmin.auth.getUser` vs JWKS with audience check).
- Consent page (`OAuthConsentPage.tsx`): client name, redirect URI hostname, scopes in plain English, approve/deny, revocation link; Settings gains "Connected AI apps".

## 14. Directory listing

- **Name**: "Atlas by ViMi". **Tagline** built on the user's question: "Check whether your ad conversions are firing properly."
- **Description** names the method in plain words: fires on the right action, counted once, right value, matchable, consent-correct, survives the journey, plus the account checks to confirm it was received. Cross-platform: Google Ads, GA4, Meta, TikTok, LinkedIn, Microsoft.
- **Use cases**: pre-spend tracking check; "why did my CPA jump?"; lead-gen click-ID check; agency weekly signal health review.
- **Submission package**: production deployment, OAuth with PKCE, annotations on every tool, public docs page (`vimi.digital/atlas/claude`) with the method, tools, limits, example prompts and an explanation of test submissions; privacy policy covering scan data, account check notes and review requests; support contact; icon; test account on `pro` with a demo org, two demo clients (one ecommerce, one lead-gen) with realistic findings, DQM alerts and a reconciliation run.
- Test as a custom connector in claude.ai, Desktop and Claude Code before submitting; run the directory's pre-submission checklist.

## 15. Telemetry and success metrics

Weekly, from the MCP tables, `profiles` and Stripe:

1. Connector sign-ups
2. First scan completed (not `INSUFFICIENT`), split by ecommerce / lead-gen
3. Scans with at least one `fail` test
4. Account checks recorded (shows the bridge is used), by platform
5. Help offers shown
6. Review requests by choice (free review / call), and Validator checkouts from the help block
7. Review requests that ViMi marks `qualified`
8. Pro / Agency conversions from MCP users
9. Cost per completed free scan; cache hit rate
10. Disputes per 100 findings, by rule

The headline metric for this connector is **qualified review requests per 100 completed scans**. Targets set after four weeks of data.

## 16. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Spike** | SDK + Streamable HTTP; Supabase OAuth on a branch; metadata; `atlas_ping`; consent page skeleton. | Ping works as a custom connector from claude.ai and Claude Code with real sign-in; §13 open points answered in this PRD. |
| **1a · Method and contract** | `testMap`, `testStatus`, `biddingImpact`, `fixComplexity`, `resultBuilder`, lint; benchmark script and allowlist. | Every register rule mapped; contract snapshot tests pass for ecommerce and lead-gen fixtures. ViMi has reviewed all bidding-impact copy. |
| **1b · Free tools** | Free tools except review; quotas, cache, cost; disputes, kill switch; migration; telemetry. | §18 Phase 1 criteria pass. |
| **1c · Account checks and help** | `accountChecks` catalogue and selector, `atlas_record_account_check`, `offerSelector`, `atlas_request_review`, lead notifications, admin list, confirmation email. | A test lead reaches ViMi consulting's inbox and Slack with the full context; consent refusal path tested. |
| **2 · Paid tools** | §10.2. | §18 Phase 2 criteria pass. |
| **3 · Listing** | Docs page, privacy policy, test account, listing copy, submission. | Submitted. |
| **4 · Later** | Connect links, fix generation, write tools, MCP Apps. | Separate PRD. |

## 17. Open questions

1. **Middle tier**: deferred until four weeks of data (D4).
2. **Plan naming**: code uses `free/pro/agency`; pricing PRD uses Business/Agency/Enterprise. Connector follows code.
3. ~~Booking link~~ resolved: Google Calendar appointment page; Scan ID matched by email and a pasted `scan_reference` (§9.3), since Google Calendar booking forms are not known to support URL pre-fill. Re-check if the booking tool changes.
4. **Turnaround basis**: whether "within 24 hours" means calendar hours or working hours; the config text should say which.
5. ~~Test email~~ resolved: `info@vimi.digital`. ~~Lead inbox~~ resolved: `vikram@vimi.digital`.
6. **Benchmark size**: whether 30 sites qualify enough rules for a useful free result; decide after the first run.
7. **Scan region**: disclosed always; region choice for paid users is out of scope for v1.

## 18. Acceptance criteria

### Phase 1

- [ ] Unauthenticated `/mcp` returns 401 with a correct `resource_metadata` pointer; full sign-in completes from claude.ai and Claude Code.
- [ ] Every rule in `REGISTER` maps to exactly one of T1 to T6 or `not_in_method` (unit test fails on an unmapped rule).
- [ ] Test status rollup follows §5.4; a test is never `pass` when its applicable rules are mostly unresolved.
- [ ] Ecommerce scans never submit payment; purchase tests that need an order are `not_verified` and say why.
- [ ] Lead-gen test submissions only happen with `allow_test_submission: true`, use the configured synthetic identity, and respect the per-domain daily limit.
- [ ] Every finding has a `bidding_impact`; none states a single-number impact.
- [ ] `mcpOutputLint` runs on every tool response; injected banned tokens in any string field are rejected.
- [ ] `INSUFFICIENT` runs return no findings, no tests and no score.
- [ ] Every result includes `account_checks` selected per §8.3, each with `where`, `good_answer` and `bad_answer_means`.
- [ ] `atlas_record_account_check` updates T7 status and rejects notes over 500 chars; PII is stripped.
- [ ] `help.offer_shown` follows §9.2; self-serve-only results show DIY guidance and no offer.
- [ ] `atlas_request_review` refuses without `consent_to_contact: true`, writes one request per user per scan, notifies ViMi consulting by email (and Slack if configured) without raw evidence payloads, and sends the user a confirmation.
- [ ] Quotas, cache, kill switch and disputes behave as in revision 1.
- [ ] No PII in logs, queue payloads or `mcp_tool_calls`.

### Phase 2

- [ ] Free users calling paid tools get a structured `plan_required` result.
- [ ] No cross-org reads (two-org test).
- [ ] `atlas_get_reconciliation` reports T7 from real data for connected clients.
- [ ] `atlas_get_portfolio_summary` sorts by severity, then open issue count.

## 19. Testing

- Unit: `testMap` coverage, `testStatus` rollup matrix, `biddingImpact`/`fixComplexity` coverage, `offerSelector` conditions, account-check selection, lint, quotas, cache keys, allowlist/override resolution, consent refusal.
- Integration (Supertest): 401 handshake, metadata, tool listing with annotations, each tool's happy and error paths.
- Contract snapshots: ecommerce fixture (`up_to_checkout`), lead-gen fixture with an Attribution Chain break, `INSUFFICIENT` fixture.
- Manual: connect in claude.ai, Desktop and Claude Code; with and without Meta/Google connectors present; confirm Claude follows §6.6, asks before using other connectors, and shows the help offer once. Record transcripts in `docs/prd/atlas-mcp-connector-qa.md`.

## 20. Update CLAUDE.md

On merge of each phase: add the connector to Features, the route to Backend API Routes, new tables to the schema section, and a Key Technical Decision covering the Atlas method mapping, the response contract and the consent rule for review requests.
