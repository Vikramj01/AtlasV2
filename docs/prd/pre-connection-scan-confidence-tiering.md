# PRD · Pre-Connection Scan · Confidence Tiering and Observation Reporting

**Intended repo path** · `docs/prd/pre-connection-scan-confidence-tiering.md`
**Status** · Draft for review
**Author** · ViMi Digital
**Date** · 11 September 2026
**Related** · `backend/src/services/crawl/`, `backend/src/services/ihc/`, `backend/src/services/audit/`, Platform Reconciliation PRD, Campaign Signal Validator

---

## 1. Problem

Atlas can run a Direct Audit against a prospect's site before any ad platform or analytics account is connected. This is the wedge for the whole commercial motion: it is what gets a first meeting and what justifies the access request. It currently carries an unacceptable failure mode.

A client-side crawl cannot report a tag that is not there. What it does, routinely, is fail to see a tag that is. Every credibility failure therefore runs in one direction: Atlas asserts an absence, the prospect's engineer demonstrates presence, and every other finding in the report is discredited by association. There is no partial credit in that meeting.

This is not hypothetical. Audit `c9486929-4f8b-4179-8e09-97f610815fba` (openart.ai, 9 September 2026) shipped three internal contradictions in a single report:

1. **GA4** rendered as `Not Detected` in the tag inventory while the same report's dataLayer inventory recorded a `config(G-QYRJB9TLG7)` gtag call on the signup page. The report asserted an absence its own evidence contradicted.
2. **Google Ads** rendered as `Not Detected` in the inventory and as `tag present` in the evidence block of `DECLARED_PLATFORM_HAS_TAG`, while `GOOGLE_GLOBAL_SITE_TAG_PRESENT` failed. The rule is named for the gtag loader but tests for an `AW-` conversion ID, so two different questions resolve to one verdict.
3. **Reddit** appeared in the evidence for `UNDECLARED_PLATFORM_TAG_DETECTED` but was absent from the tag inventory table, meaning the finding and the renderer read different sources.

Alongside these, the run emitted a headline score of **76/100 computed across 5 of 13 layers**, and 10 checks were unassessable because the landing step never settled. The score was presented as a number rather than as withheld.

Every one of these is the same root defect: **the system does not distinguish between what it observed, what it failed to observe, and what it could not look at.**

## 2. Goals

- No rendered Atlas output asserts an absence that the run's coverage does not support.
- Contradictions between independent detectors surface as conflicts rather than as findings.
- A headline score is emitted only when coverage supports one, and its absence is presented as rigour rather than as a gap.
- A pre-connection report demonstrates the depth of the method and makes the access request concrete, without fabricating findings or teasing locked content.
- Atlas accumulates measured accuracy data on its own absence claims over time.

### Non-goals

- Changing the connected (post-access) scoring model. This PRD covers pre-connection runs and the shared rule metadata they depend on.
- Building new detection capability. Detection coverage is out of scope except where the settle contract in §7 affects it.

## 3. Core principle

> **Any verdict that asserts an absence requires coverage. Any verdict that asserts a presence does not.**

Everything below is derived from that sentence.

This is deliberately not "negative rules are risky". The gated direction depends on which verdict is the absence claim, and for inverse rules the risky direction is the **pass**. `NO_DUPLICATE_CONTAINER` passing means "we did not see a second container", which is an absence claim and must be coverage-gated. The same rule failing means "we saw two", which is positive evidence and needs no gate.

## 4. Model

Two orthogonal axes. Collapsing them into a single `PASS | FAIL | WARNING` enum is the present bug.

### 4.1 Evidence class · static, declared at rule definition

| Class | Meaning | Gated direction |
|---|---|---|
| `DIRECT` | Verdict rests on positively observed evidence in both directions (e.g. UTM present in URL, absent from storage · both sides observed) | None |
| `PRESENCE` | "Is X there" · pass is positive evidence, fail is an absence claim | Fail |
| `PRESENCE_INVERSE` | "X must not be there" · fail is positive evidence, pass is an absence claim | Pass |
| `DERIVED` | Computed from other rules or from scope configuration | Inherits the weakest confidence of its inputs |
| `INFERRED` | Heuristic shape match, never authoritative (e.g. sGTM hostname detection) | Both · may never emit `FAIL` |

### 4.2 Observation confidence · computed per run, per rule

| Confidence | Condition |
|---|---|
| `CONFIRMED` | Every page in the rule's scope was reached and reached `SETTLED`, and the evidence channels the rule reads were captured |
| `PARTIAL` | Some but not all in-scope pages met that bar |
| `UNSUPPORTED` | The step the rule depends on was not reached, did not settle, or its evidence channel was not captured |
| `CONFLICTED` | Two or more independent detectors disagree about the entity this rule evaluates (see §6) |

### 4.3 Verdict lattice

`verdict = f(evidence_class, observation_confidence, raw_result)`

| Situation | Emitted verdict |
|---|---|
| Non-gated direction, any confidence ≥ `PARTIAL` | `PASS` or `FAIL` as raw |
| Gated direction, `CONFIRMED` | `PASS` or `FAIL` as raw |
| Gated direction, `PARTIAL` | `NOT_OBSERVED` · never `FAIL`, never `PASS` |
| Any rule, `UNSUPPORTED` | `INCONCLUSIVE` |
| Any rule, `CONFLICTED` | `CONFLICT` |
| `INFERRED` class, gated direction, any confidence | `NOT_OBSERVED` · `FAIL` is unreachable for this class |

`NOT_OBSERVED`, `INCONCLUSIVE` and `CONFLICT` are excluded from pass/fail counts and from scoring. They are **not** rendered as failures, and they are **not** silently dropped: each is reported in its own section with its reason.

### 4.4 Severity ceiling by confidence

A rule's declared severity is a ceiling, not a constant.

| Confidence | Severity ceiling |
|---|---|
| `CONFIRMED` | Declared severity |
| `PARTIAL` | Capped at `HIGH`, labelled provisional |
| `UNSUPPORTED` | No severity · excluded |
| `CONFLICTED` | No severity · routed to conflicts |

Additionally, `DERIVED` rules whose inputs include a client-supplied declaration are capped by `declaration_source` (§8).

## 5. Output vocabulary binding

Each verdict maps to exactly one permitted phrase family, enforced at render time. This is the mechanism that makes the principle in §3 hold in the artefact the client actually reads.

| Verdict | Permitted phrasing |
|---|---|
| `PASS` (presence) | "Observed on all N pages scanned" |
| `FAIL` (direct evidence of a defect) | "Observed <evidence>, which <defect>" |
| `FAIL` (absence, `CONFIRMED`) | "Not observed on any of the N pages scanned" |
| `NOT_OBSERVED` | "Not observed on the M of N pages that settled" |
| `INCONCLUSIVE` | "Could not be assessed · <reason>" |
| `CONFLICT` | "Signals disagree · <source A> reports <a>, <source B> reports <b>" |

### 5.1 Banned output tokens

The following must never appear in rendered pre-connection output, in any casing, in rule titles, summaries, evidence lines or platform verdicts:

```
Not Detected
Missing
Broken
is not installed
you have no
zero measurement
```

**Implementation** · `backend/src/services/audit/outputLint.ts`. Runs over the fully assembled report payload immediately before render and before PDF export. A banned token, or a verdict rendered with phrasing outside its permitted family, fails the render with a named rule and token. This is a hard failure, not a warning · a report that cannot be phrased safely must not ship.

The platform verdict labels change accordingly:

| Current | Replacement |
|---|---|
| `Broken` | `No signal observed` |
| `At Risk` | `Partial signal observed` |
| `Healthy` | `Signal observed` |
| `Not Included` | `Not in scope` |

## 6. Cross-signal consistency checker

A post-pass that runs after all rules resolve and before scoring. For each platform entity, it compares independent detection sources and asserts agreement.

**Sources**

| ID | Source | Origin |
|---|---|---|
| `NET` | Network request detector | `detected_signals` |
| `DL` | dataLayer inventory | captured `window.dataLayer` events |
| `DOM` | Script src and inline snippet scan | crawl page payload |
| `GTM` | Container snapshot, when available | `gtm_container_snapshots` |

**Assertions** (initial set · extend as detectors are added)

| ID | Assertion |
|---|---|
| `CONF_01` | A `config(G-*)` call in `DL` implies GA4 present. Conflicts with a GA4 absence verdict from `NET`. |
| `CONF_02` | A `set(developer_id.*)` or any `gtag` call in `DL` implies a gtag loader ran. Conflicts with a gtag-loader absence verdict. |
| `CONF_03` | Any platform named in a finding's evidence must appear in the tag inventory with the same status. Source divergence is itself the conflict. |
| `CONF_04` | A `config(AW-*)` in `DL` implies a Google Ads conversion ID is registered. Conflicts with `GOOGLE_ADS_AW_ID_PRESENT` failing. |
| `CONF_05` | A cookie set exclusively by platform X implies X's tag ran, even where `NET` missed the request. |

**Behaviour** · every rule evaluating the conflicted entity moves to `CONFLICTED`, is excluded from scoring and counts, and is rendered in a **Signals in conflict** section stating both readings and which is more likely, without picking a winner.

**Storage** · new table `signal_conflicts` · `id, run_id, assertion_id, entity, source_a, reading_a, source_b, reading_b, affected_rule_ids jsonb, created_at`. RLS required.

> Shipping a scanner that reports when it disagrees with itself is a credibility asset, not an embarrassment. It is also close to unfakeable by a competitor running a single-detector crawl.

## 7. Run quality and the settle contract

The OpenArt run's ten unassessable checks all trace to one page that never settled. Settle reliability is therefore a scoring input, not an implementation detail.

### 7.1 Per-page settle state

Recorded on `crawl_pages`:

| State | Condition |
|---|---|
| `SETTLED` | Network idle sustained for `settle_idle_ms` (default 2000) within `settle_max_ms` (default 15000), and dataLayer capture completed |
| `TIMEOUT` | `settle_max_ms` reached without idle |
| `ERROR` | Navigation or script error prevented capture |
| `NOT_REACHED` | URL not resolved or not in the discovered set |

### 7.2 Retry policy

Up to `settle_max_attempts` (default 2) additional attempts per page, each with `settle_idle_ms` and `settle_max_ms` increased by 50 per cent. Attempts and final state are persisted.

### 7.3 Run quality

Recorded on the audit run:

| Quality | Condition |
|---|---|
| `COMPLETE` | Every in-scope page `SETTLED` |
| `PROVISIONAL` | Any in-scope page not `SETTLED` |
| `INSUFFICIENT` | The declared conversion surface not `SETTLED`, or fewer than two pages `SETTLED` |

`INSUFFICIENT` runs do not render a client-facing report. They render an internal run-quality summary and a prompt to re-run with corrected seed URLs. This is the single highest-leverage change in this document: the OpenArt report should never have reached a client in the state it did.

Run quality is stated in the report header, not in a footnote.

## 8. Scope declaration integrity

`DECLARED_PLATFORM_HAS_TAG` produced a CRITICAL for Pinterest on openart.ai. That severity rests entirely on an operator-entered declaration that may simply be wrong.

Add `declaration_source` to each declared platform in scope configuration:

| Source | Severity ceiling for derived findings |
|---|---|
| `CLIENT_CONFIRMED` | Declared severity |
| `OPERATOR_ASSUMED` | `MEDIUM`, and the finding renders as an open question rather than a defect |
| `INFERRED_FROM_SITE` | `LOW` |

Pre-connection runs default to `OPERATOR_ASSUMED` unless the prospect has answered the scope questions.

## 9. Scoring and coverage gating

### 9.1 Rules

1. Score is computed **only** over rules at `CONFIRMED` confidence.
2. Each layer declares `min_confirmed_rules` and `layer_weight`. A layer below its threshold is **not scored** and is reported as not assessed. It is never scored as zero and never silently averaged away.
3. `coverage_ratio = Σ(weight of scored layers) / Σ(weight of all layers)`.
4. If `coverage_ratio < 0.60`, the overall score is withheld: `score: null`, `score_withheld_reason: 'INSUFFICIENT_LAYER_COVERAGE'`.
5. A withheld score renders as a **Coverage Gate** panel, not a number and not a blank.

### 9.2 Coverage Gate panel copy

> **Signal Health score withheld.** This scan assessed 5 of 13 signal layers, below the 60 per cent coverage this score requires. A partial score would imply confidence the run does not support. The layers assessed are reported individually below.

### 9.3 Sub-scores

Sub-scores (Attribution Risk, Optimisation Strength, Data Consistency) follow the same gate at their own layer level. The present behaviour of rendering `Moderate` for a dimension with **0 of 2 layers scanned** is removed entirely · a dimension with no scored layers renders as `Not assessed`.

## 10. Rule classification

Full classification of the current rule set. `Gated` names the direction requiring `CONFIRMED` coverage. `Synth` marks rules whose evidence depends on synthetic parameter injection and which therefore may not be cited as evidence of real-world behaviour.

### 10.1 Scope configuration

| Rule | Class | Gated | Synth | Notes |
|---|---|---|---|---|
| `DECLARED_PLATFORM_HAS_TAG` | `DERIVED` | Fail | | Severity capped by `declaration_source` (§8) |
| `UNDECLARED_PLATFORM_TAG_DETECTED` | `DIRECT` | None | | Positive observation · strongest rule in the set |
| `CONVERSION_SURFACE_IDENTIFIED` | `DIRECT` | None | | |

### 10.2 Foundation tags

| Rule | Class | Gated | Synth | Notes |
|---|---|---|---|---|
| `GTM_CONTAINER_LOADED` | `PRESENCE` | Fail | | |
| `DATALAYER_INITIALISED` | `PRESENCE` | Fail | | |
| `GTAG_LOADER_PRESENT` | `PRESENCE` | Fail | | **New** · split from `GOOGLE_GLOBAL_SITE_TAG_PRESENT` |
| `GOOGLE_ADS_AW_ID_PRESENT` | `PRESENCE` | Fail | | **New** · split · may only evaluate when `GTAG_LOADER_PRESENT` resolves |
| `CONVERSION_LINKER_ENABLED` | `PRESENCE` | Fail | | |
| `META_PIXEL_PRESENT` | `PRESENCE` | Fail | | |
| `TIKTOK_PIXEL_PRESENT` | `PRESENCE` | Fail | | |
| `NO_DUPLICATE_CONTAINER` | `PRESENCE_INVERSE` | **Pass** | | Pass is the absence claim |
| `NO_DUPLICATE_BASE_TAG` | `PRESENCE_INVERSE` | **Pass** | | |
| `TAGS_PRESENT_ACROSS_SAMPLED_PAGES` | `DERIVED` | Fail | | Inherently coverage-bound · requires all in-scope pages `SETTLED` |
| `SERVER_CONTAINER_ENDPOINT_CONFIGURED` | `INFERRED` | Both | | **May never emit `FAIL`.** See §10.6 |
| `NO_TAG_LOAD_ERRORS` | `PRESENCE_INVERSE` | **Pass** | | |

### 10.3 Click ID capture

| Rule | Class | Gated | Synth | Notes |
|---|---|---|---|---|
| `GCLID_CAPTURED_AT_LANDING` | `DIRECT` | None | ✓ | |
| `GBRAID_CAPTURED_AT_LANDING` | `DIRECT` | None | ✓ | |
| `WBRAID_CAPTURED_AT_LANDING` | `DIRECT` | None | ✓ | |
| `FBCLID_CAPTURED_AT_LANDING` | `DIRECT` | None | ✓ | |
| `TTCLID_CAPTURED_AT_LANDING` | `DIRECT` | None | ✓ | |
| `UTM_PARAMETERS_CAPTURED` | `DIRECT` | None | ✓ | Both sides observed · strong rule |
| `LANDING_REDIRECT_PRESERVES_QUERY_STRING` | `DIRECT` | None | ✓ | |

All synthetic rules render with a standing note that the parameter was injected by the scanner, and may not be cited as evidence that live campaign traffic behaves identically.

### 10.4 Storage durability

| Rule | Class | Gated | Synth | Notes |
|---|---|---|---|---|
| `CLICK_ID_WRITTEN_TO_DURABLE_STORAGE` | `DIRECT` | None | ✓ | |
| `GCL_AW_COOKIE_PRESENT` | `PRESENCE` | Fail | | |
| `FBP_COOKIE_PRESENT` | `PRESENCE` | Fail | | **New** · split from `FBP_AND_FBC_COOKIES_PRESENT` |
| `FBC_COOKIE_PRESENT` | `PRESENCE` | n/a | | **New** · **disabled in crawl context.** Always `INCONCLUSIVE`: only a genuine Meta-click referrer populates it, which a synthetic crawl cannot reproduce |
| `COOKIE_ATTRIBUTES_CORRECT` | `DIRECT` | None | | |

Splitting the composite is required. The current rule fails on `_fbp` alone while carrying `_fbc` in its evidence, and the evidence line already concedes `_fbc` is not counted. One rule should not both count and not count its own evidence.

### 10.5 Hygiene integrity

| Rule | Class | Gated | Synth | Notes |
|---|---|---|---|---|
| `NO_STAGING_OR_TEST_CONTAINER_IN_PRODUCTION` | `PRESENCE_INVERSE` | **Pass** | | |
| `NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE` | `PRESENCE_INVERSE` | **Pass** | | |
| `TAG_LOAD_DOES_NOT_MATERIALLY_DELAY_PAGE` | `DIRECT` | None | | Measured, not inferred |

### 10.6 Conversion surface and event rules

These are the ten that returned unassessable on the OpenArt run. Classification matters most here, because these are the rules that would carry the commercial argument if they ran.

| Rule | Class | Gated | Notes |
|---|---|---|---|
| `CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS` | `DIRECT` | None | Requires conversion page `SETTLED` |
| `GA4_CONFIG_TAG_PRESENT` | `PRESENCE` | Fail | Subject to `CONF_01` |
| `REFERRER_PRESERVED_THROUGH_ENTRY` | `DIRECT` | None | Synthetic |
| `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW` | `DIRECT` | None | |
| `GOOGLE_ADS_CONVERSION_EVENT_FIRES` | `PRESENCE` | Fail | Requires conversion page `SETTLED` |
| `META_CONVERSION_EVENT_FIRES` | `PRESENCE` | Fail | Requires conversion page `SETTLED` |
| `TIKTOK_CONVERSION_EVENT_FIRES` | `PRESENCE` | Fail | Requires conversion page `SETTLED` |
| `PAGE_VIEW_FIRES_ON_EVERY_ROUTE` | `PRESENCE` | Fail | |
| `NO_PLAINTEXT_PII_IN_NETWORK_REQUEST` | `PRESENCE_INVERSE` | **Pass** | A clean pass on partial coverage is a liability claim Atlas should not make |
| `NO_PII_IN_URLS_OR_QUERY_STRINGS` | `PRESENCE_INVERSE` | **Pass** | As above |

**On `SERVER_CONTAINER_ENDPOINT_CONFIGURED`** · this rule currently emits `FAIL · HIGH` on a hostname-shape heuristic. A backend that posts conversions directly to each platform's API needs no server-side container and is entirely invisible to a browser crawl, so the rule's failing verdict asserts something the method cannot establish. Reclassified `INFERRED`, it emits `NOT_OBSERVED` with an accompanying open question and no severity. The commercial argument it supports (governance of per-platform integrations) belongs in the with-access section, not in a failing check.

## 11. Report structure

### 11.1 Rename

Pre-connection output is renamed **Signal Observation Report**. The scored **Signal Health Report** name is reserved for connected runs. This makes score withholding structural rather than a special case, and sets the reader's expectation before the first finding.

### 11.2 Section order

| # | Section | Notes |
|---|---|---|
| 1 | Run quality and coverage | First, not buried. States pages reached, settle states, layers assessed |
| 2 | What we observed | Confirmed findings only, grouped by cause |
| 3 | Signals in conflict | From §6 · empty section omitted |
| 4 | Questions for your team | Auto-generated · see §11.3 |
| 5 | Not assessed, and why | `INCONCLUSIVE` rules with per-rule reasons |
| 6 | With access · what a connected scan adds | See §12 |
| 7 | Technical appendix | Full rule table with class, confidence and coverage per rule |

### 11.3 Auto-generated questions

Each rule declares an optional `open_question` template. A question is emitted when the rule resolves to `NOT_OBSERVED`, `INCONCLUSIVE`, `CONFLICT`, or to a `DERIVED` finding whose `declaration_source` is not `CLIENT_CONFIRMED`.

This turns the weakest part of the report into its most consultative section, and it is the artefact that actually earns the access request. Questions are numbered and exportable as a standalone list, since in practice they are sent ahead of the report.

## 12. With-access section

A dedicated section, populated from the rule registry rather than written by hand.

### 12.1 Rules of construction

- Every entry must reference a rule or module that **exists in the product**. No aspirational checks.
- No locked, blurred, redacted or partially revealed findings. No fabricated numbers. The section states capability, not teased results.
- Each entry links to the specific observational finding or open question it would resolve. An entry resolving nothing in this run is omitted.

### 12.2 Registry fields

Connected-tier rules and modules declare:

```ts
requires_connection: ('google_ads' | 'meta' | 'tiktok' | 'ga4' | 'linkedin')[]
answers_question_for: string[]   // rule IDs or open-question IDs in this run
reveals: string                   // one line, what the check returns
```

### 12.3 Rendered shape

| Check | Needs | What it answers | Resolves |
|---|---|---|---|
| Platform reconciliation | Ad account read | Whether platform-reported conversions match site-observed conversions | `META_PIXEL_PRESENT`, `GOOGLE_ADS_AW_ID_PRESENT` |
| CAPI delivery and dedup audit | Meta, TikTok | Whether events arrive server-side and deduplicate against browser events | `SERVER_CONTAINER_ENDPOINT_CONFIGURED` |
| Match rate and EMQ | Meta, Google | Identity match quality on current traffic | `FBP_COOKIE_PRESENT` |
| Attribution window integrity | Ad account read | Whether storage lifetime supports the configured window | `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW` |

The section closes by naming the connection scopes required and the fact that they are read-only. A prospect deciding whether to grant access wants that answer without asking.

## 13. Data model changes

**Migration** · `supabase/migrations/20260911_001_rule_confidence_tiering.sql`. RLS required on new tables. `ALTER TABLE` on optional tables wrapped per repo convention.

### 13.1 `audit_findings` · new columns

| Column | Type | Notes |
|---|---|---|
| `evidence_class` | text | `DIRECT \| PRESENCE \| PRESENCE_INVERSE \| DERIVED \| INFERRED` |
| `observation_confidence` | text | `CONFIRMED \| PARTIAL \| UNSUPPORTED \| CONFLICTED` |
| `verdict` | text | `PASS \| FAIL \| NOT_OBSERVED \| INCONCLUSIVE \| CONFLICT` |
| `pages_evaluated` | int | |
| `pages_in_scope` | int | |
| `excluded_from_score` | boolean | Default false |
| `exclusion_reason` | text | Nullable |
| `severity_capped_from` | text | Nullable · records the declared severity when a ceiling applied |
| `synthetic_evidence` | boolean | Default false |

`severity` retains its meaning but now holds the **effective** severity after ceilings.

### 13.2 New tables

`signal_conflicts` · per §6.

`rule_confirmations` · per §15 · `id, organization_id, run_id, rule_id, finding_id, outcome ('CONFIRMED' | 'REFUTED' | 'UNKNOWN'), source ('client_answer' | 'rescan' | 'operator'), note, created_at`.

### 13.3 Run-level

On the audit run and on `crawl_runs`: `run_quality`, `coverage_ratio`, `score_withheld_reason`. On `crawl_pages`: `settle_state`, `settle_attempts`, `settle_ms`.

### 13.4 Rule registry

Rule metadata (class, gated direction, layer, weight, synthetic flag, `open_question`, connected-tier fields) lives in code, not the database: `backend/src/services/ihc/ruleRegistry.ts`. Only per-finding resolved values are persisted. A registry unit test asserts every rule in the evaluator has a registry entry and vice versa, so a new rule cannot ship unclassified.

> **Note (added during sprint scoping, September 2026):** the codebase's actual v2 rule registry lives at `backend/src/services/validation/register/engine.ts` (`runRegister()`), not at the `backend/src/services/ihc/ruleRegistry.ts` path this section assumes — that directory only holds IHC drift-check services and has no rule registry. All work against this PRD targets the real path. See `docs/atlas-sprint-plan-pre-connection-confidence-tiering.md` for the corrected sprint plan and full gap analysis against already-shipped work (`ATLAS_REPORT_CORRECTNESS_PROGRAMME_PRD.md`, `ATLAS_CLICKID_CONTENTION_CONTRADICTION_GUARD_PRD.md`).

## 14. Acceptance criteria

Replay audit `c9486929-4f8b-4179-8e09-97f610815fba` through the new pipeline. All of the following must hold.

1. `GA4_CONFIG_TAG_PRESENT` resolves `CONFLICT` via `CONF_01`, is excluded from scoring, and renders in Signals in conflict.
2. `GOOGLE_GLOBAL_SITE_TAG_PRESENT` no longer exists. `GTAG_LOADER_PRESENT` and `GOOGLE_ADS_AW_ID_PRESENT` resolve independently, and `CONF_02` fires against the observed `set(developer_id.*)` calls.
3. The Reddit inventory divergence resolves `CONFLICT` via `CONF_03`.
4. `SERVER_CONTAINER_ENDPOINT_CONFIGURED` resolves `NOT_OBSERVED` with no severity, and emits its open question.
5. `FBC_COOKIE_PRESENT` resolves `INCONCLUSIVE`. `FBP_COOKIE_PRESENT` resolves independently.
6. Overall score is withheld with `INSUFFICIENT_LAYER_COVERAGE` (5 of 13 layers). Optimisation Strength renders `Not assessed`, not `Moderate`.
7. Run quality resolves `PROVISIONAL`, stated in the report header.
8. All ten previously unassessable rules resolve `INCONCLUSIVE` with per-rule reasons, and none contributes to the failed count.
9. `outputLint` passes with zero banned tokens across the rendered payload and the PDF export.
10. The open-questions section generates at least the seven questions currently produced by hand for this account.

A regression fixture is committed from this run so the acceptance set runs in CI.

## 15. Measured accuracy

The long-term answer to "why should we believe your scan" is data, not method description.

Every open question answered by a client, and every re-scan after remediation, writes a row to `rule_confirmations` marking the original finding `CONFIRMED` or `REFUTED`. This yields a per-rule false-negative rate over time.

Two uses:

- **Internal** · rules whose absence claims are refuted repeatedly get their gated direction tightened or their detector fixed. The registry test can eventually enforce a minimum measured accuracy before a rule is allowed to emit `FAIL`.
- **External** · once the sample is meaningful, the report can state the measured confirmation rate for its own absence claims. That is a defensible, evidence-backed accuracy claim, and it is the strongest possible answer to a sceptical engineer in a prospect meeting.

Until the sample is meaningful, no accuracy figure is published. Publishing one early would be the same error this document exists to fix.

## 16. Sequencing

| Phase | Contents | Blocking |
|---|---|---|
| 1 | Settle contract, retry policy, `run_quality`, `INSUFFICIENT` runs blocked from client render (§7) | Highest priority · stops bad reports shipping today |
| 2 | Rule registry, evidence classes, verdict lattice, severity ceilings (§4, §10) | Depends on 1 for confidence computation |
| 3 | Output vocabulary binding and `outputLint` (§5) | Depends on 2 |
| 4 | Consistency checker and `signal_conflicts` (§6) | Depends on 2 |
| 5 | Scoring and coverage gate (§9) | Depends on 2 |
| 6 | Report restructure, auto-generated questions, with-access section (§11, §12) | Depends on 3, 4, 5 |
| 7 | `rule_confirmations` and measured accuracy (§15) | Independent · can start any time |

Phase 1 alone would have prevented the OpenArt report from reaching a client. It should ship before the next prospect scan.

## 17. Open questions for the build

1. Should `PROVISIONAL` runs render a client-facing report at all, or only `COMPLETE` ones? Current proposal allows `PROVISIONAL` with a header statement. The stricter alternative costs turnaround time on sites that are genuinely slow to settle.
   - **Resolved for sprint scoping (September 2026):** PROVISIONAL renders with the header statement, per the proposal above.
2. Is 0.60 the right coverage threshold for score emission, or should it vary by layer weight profile?
   - **Resolved for sprint scoping:** ship the fixed 0.60 threshold; revisit only if it misbehaves against a real layer-weight profile.
3. Should the connected scan reuse the same rule IDs with a higher confidence ceiling, or maintain a separate connected rule set? Reuse keeps the with-access mapping trivial but complicates the registry.
   - **Resolved for sprint scoping:** reuse the same rule IDs at a higher confidence ceiling. No separate connected registry.
4. Does the Campaign Signal Validator paid diagnostic use this pipeline directly, or a stricter configuration that refuses to run at all without a settled conversion surface?
   - **Resolved for sprint scoping:** out of scope for this sprint plan. Revisit as a separate follow-up once this PRD ships.
