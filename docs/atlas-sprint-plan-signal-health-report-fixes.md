# Sprint Plan: Signal Health Report — Accuracy & Output Fixes

**Status:** Draft — ready for implementation
**Source PRD:** `docs/atlas-signal-health-report-fixes-prd.md` (uploaded PRD, "Atlas Signal Health Report · Accuracy and Output Fixes")
**Owner:** Vikram
**Branch:** `claude/sprint-plan-prd-pu51h6`

---

## How to read this plan

Same convention as `docs/atlas-sprint-plan-site-eval-coverage.md`: this is a **build sequence**, not a calendar. Each sprint is one self-contained unit of Claude Code work — scoped so it can be implemented, tested, and merged in a single focused session. "Depends on" is the only scheduling constraint that matters.

Before writing this plan, I read the actual code behind all seven issues rather than taking the PRD's "Likely component" guesses at face value. Two of those guesses turned out to be wrong in a way that changes the fix, and two of the PRD's issues (1 and 4) turned out to share one root cause. Both are called out below because they change the sequencing from the PRD's own §6 suggested order.

---

## Key investigation findings (read before starting Sprint 3+)

**Issues 1 and 4 share a root cause — plan them together, not separately.**
`backend/src/services/interpretation/engine.ts` holds `RULE_INTERPRETATIONS`, a hand-authored dict of 43 entries keyed by `rule_id` — headline, business impact, fix copy — built for the **v1** rule engine. The Signal Health Report now runs on the **Check Register v2** (`backend/src/services/validation/register/`, 90 rules across 12 layers, per `CLAUDE.md`'s Key Technical Decisions #16). None of the v2 rule_ids (`STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW`, `DECLARED_PLATFORM_HAS_TAG`, `GA4_CONFIG_TAG_PRESENT`, etc.) exist in that dict — confirmed by grep. Two independent functions fall back when a `rule_id` has no dict entry:
- `interpretResults()` (→ `ReportIssue.fix_summary`) falls back to the literal string `'Contact support for details on this rule.'` — **this is Issue 1**, and it fires for every v2 rule, unconditionally, which is exactly the "all 17 items, no exceptions" behaviour in the test report.
- `toSummaryInput()` (→ `generateBusinessSummary()`'s narrator) falls back to `business_impact: result.technical_details.expected` — **this is Issue 4**. `expected` is written throughout the v2 register as the rule's *ideal/pass-state* description, not a failure narrative. Confirmed directly: `L1.ts`'s `GA4_CONFIG_TAG_PRESENT.expected` is literally `'GA4 config fires and a measurement ID (G-XXXXXXXXXX) resolves'` (the PRD's exact quoted bug, "G-XXXXXXXXXX" included — it's not an unfilled template variable, it's a hardcoded illustrative ID string in the rule's own source, being misused as narrative copy), and `L0.ts`'s `DECLARED_PLATFORM_HAS_TAG.expected` is literally `'Every declared platform has its base tag/pixel firing on the site'` (the PRD's other exact quoted bug).

Because both bugs are "v2 rules have no entry in a v1-shaped dict," fixing them with two separate patches (author 90 dict entries, then separately branch the narrator) re-does the same wiring twice and leaves the same drift risk that caused this in the first place — the v1 dict already silently fell 90 rules out of date once. Sprint 3 below proposes a structural fix that closes both at once and can't silently drift again.

**Issue 3 is not the comparison operator — it's the day calculation.**
The PRD guesses `actual <= required` where it should be `actual < required`. The actual code (`L3.ts`, `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW.test()`) already uses `c.days < c.required` — strictly less-than, already "correct" as PRD frames it. The real bug is in `maxAgeDays()`:
```ts
function maxAgeDays(cookie: DetailedCookie, nowSeconds: number): number {
  if (cookie.expires < 0) return 0;
  return (cookie.expires - nowSeconds) / SECONDS_PER_DAY;
}
```
This computes **days remaining until expiry at scan time**, not the cookie's original Max-Age duration. A cookie set with exactly a 90-day Max-Age will always read as *slightly under* 90 days by the time the scan evaluates it (any elapsed time between the browser setting the cookie and the rule running subtracts from the remaining-days figure) — so `89.9997 < 90` fails the check. The displayed evidence string rounds for readability (`Math.round(v.days)` → `"90d, needs 90d"`), which is exactly the PRD's observed symptom: a cookie that *displays* as meeting its window is failing anyway. There is also no existing test at the exact boundary — `L3.test.ts`'s "passes when the Google cookie meets the 90-day window" test uses 91 days, not 90, so it doesn't catch this. The fix has to address the measurement (compare against the cookie's original Max-Age / round before comparing / add a tolerance), not just the operator.

**Issue 5's data model already exists — mostly a wiring gap, not new modeling.**
`StepCoverage.source` already has a `'fallback_landing'` value (`backend/src/types/audit.ts`), populated by `journeySimulator.ts` from the earlier Site Evaluation Coverage & Honesty work, and the PDF's Scan Coverage section already renders it (`'not found — used the landing page'`, `pdfGenerator.ts`). What's missing is that **rule-level evidence strings that cite a step by name** (route-level `page_view` checks, the conversion-surface JS-error attribution the PRD mentions) don't cross-reference `step_coverage` to know the step they're citing was a substitution. This is a smaller, more contained fix than the PRD's "Likely component" implies — no new metadata field needed, just wiring the existing field through to the places that currently only know a step's label.

**Issue 2 needs one more investigation step before a fix can be scoped.**
Both known render paths — `reporting.ts`'s `buildV2LayerStages()` (funnel/L3 breakdown) and `interpretation/engine.ts`'s `interpretResults()` (Issues & Fixes page) — read the same `technical_details.found` string off the same `ValidationResult` object for a given rule_id. Structurally, within one report-generation call, these can't diverge from each other. That means the contradiction the PRD documents (gclid/gbraid/wbraid/_gcl_au/_gcl_aw/ttclid vs. gclid/fbclid/msclkid) most likely comes from **two different points in time or two different code paths producing two different `ValidationResult` objects for the same rule_id** — e.g. a persisted `audit_findings`/stored-report row from one run being read by one section while a re-computed or re-rendered section (PDF export vs. live web view) reads a different run's data. Sprint 2 below starts with confirming which before writing the fix, per the PRD's own instruction that this "needs investigation."

---

## Dependency graph

```
Sprint 1 (Issue 3 + 6)         — independent, ships first
Sprint 2 (Issue 2)             — independent of 1, but should land before the
                                  taxonomy-wide regression fixture is trusted
Sprint 3 (shared v2 remediation/narrative data model)
  → Sprint 4 (Issue 1: author + wire fix copy)
  → Sprint 5 (Issue 4: narrator failure-state branching + placeholder guard)
Sprint 6 (Issue 5)             — independent, pending product decision (default proposed)
Sprint 7 (Issue 7, stretch)    — independent, pending product sign-off on weights
```

Sprints 1 and 2 have no dependencies and can run in parallel or in either order. Sprint 3 is a prerequisite for both 4 and 5 — building it once avoids doing the v1→v2 wiring twice (see finding above). Sprints 6 and 7 are each gated on a product decision from the PRD's Open Questions (§5); a recommended default is proposed for each so engineering isn't blocked, but implementation should get an explicit go-ahead on the default before merging.

---

## Sprint 1 — Storage-lifetime measurement fix + pluralisation (Issues 3, 6)

**Priority:** P0 (Issue 3), P3 (Issue 6, bundled per PRD §6.7)
**Depends on:** none

**Scope**
- `backend/src/services/validation/register/L3.ts` — `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW` (`maxAgeDays`/violation check, ~lines 39-42 and 127-144):
  - Round each cookie's remaining lifetime to whole days *before* comparing against `required`, so a cookie whose evidence displays as "90d" can never fail a "needs 90d" check purely from sub-second measurement drift: `const days = Math.round(maxAgeDays(cookie, nowSeconds));` then compare the rounded value.
  - Keep the session-cookie special case (`expires < 0` → `0` days, always fails) unchanged.
- `backend/src/services/export/pdfGenerator.ts` line ~304 — pluralise `warnings` the same way `computeRuleOverviewStats`'s `failed`/`passed` counts already read elsewhere in the codebase (`${warnings} warning${warnings === 1 ? '' : 's'}`).

**Acceptance criteria (from PRD §4 Issue 3 + Issue 6)**
- Unit test: cookie with `expires = now + 90*86400` exactly → `PASS` (this is the case the existing test suite doesn't cover — `L3.test.ts`'s current 90-day test uses 91 days).
- Unit test: cookie with `expires = now + 89*86400` (one day short) → `FAIL`.
- Unit test: re-running the fix against fixture data equivalent to the openart.ai audit flips gclid/gbraid/wbraid/_gcl_au/_gcl_aw to `PASS`; only `ttclid` (1d actual vs. 7d required) remains `FAIL`.
- Unit test: `computeRuleOverviewStats` pluralisation — 0 warnings → "0 warnings", 1 → "1 warning", 2+ → "N warnings" (extend `pdfGenerator.test.ts`, which already has a regression test for the adjacent "N rules validated" bug).

**Note:** this sprint is scoped for implementation in this same session (see below).

---

## Sprint 2 — Evidence-consistency investigation + fix (Issue 2) — DONE

**Priority:** P0
**Depends on:** none
**Status:** implemented and merged into this branch.

**What the investigation found**

1. **Live-code trace (no DB access):** `orchestrator.ts` builds `issues` (`interpretResults(validationResults)`) and `customJourneyStages` (`buildV2LayerStages(validationResults)`) from the *same* `validationResults` array in the same synchronous block, upserts both into one `audit_reports.report_json` blob (`saveReport`), and both the web view (`GET /:audit_id/report`) and the PDF export (`generatePDF(report)`) read that one stored blob with no recomputation. The frontend (`ReportPage.tsx`) fetches the report once and passes the identical object to both `JourneyBreakdown` and `IssuesFixes`. Structurally, these two sections cannot diverge for a freshly-generated report.
2. **Live-data check (once the Supabase connector was pointed at the right project, `AtlasV2` / `hzgiqddvilbtlwkamshp`):** queried `audit_reports` directly for `audit_id = 9d95cf3f-b94a-4487-8ce1-c771907e8b54`. The stored report's L3 layer-breakdown evidence and its Issues & Fixes evidence for `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW` are **byte-identical strings** — no fbclid/msclkid anywhere. **The PRD's Issue 2 example, as described, does not reproduce against the real stored report for that audit_id.** (The report was generated the same day as this investigation, so it isn't stale data either — and it does independently confirm Issue 3's rounding bug and Issue 1's placeholder, both live in that exact report.)
3. **The regression fixture (built as part of this sprint, see below) found a real, different instance of the same defect *shape* anyway.** Three rule_ids exist in both the v1 `RULE_INTERPRETATIONS` dict (`interpretation/engine.ts`) and the v2 Check Register, with different implementations: `GTM_CONTAINER_LOADED`, `GCLID_CAPTURED_AT_LANDING`, `FBCLID_CAPTURED_AT_LANDING`. Before the fix, a v2-originated result for one of these rule_ids silently got the v1 dict's static, generic `business_impact` text as `why_it_matters`, while `buildV2LayerStages` (which has no dict lookup) always showed that same result's real `technical_details.found` — producing exactly the "two sections disagree for one rule_id" shape the PRD describes, just not with the PRD's specific cookie names.

**Fix implemented**
- `backend/src/services/interpretation/engine.ts` — `interpretResults()` now only uses the v1 `RULE_INTERPRETATIONS` entry's `why_it_matters`/`problem` when the result's `rule_id` **and** `validation_layer` both match that same rule's declaration in the v2 `REGISTER` — i.e. only when the result is provably v1-originated (a v2 result for a colliding rule_id always fails that match, since its real layer differs from the v1 layer the dict assumes). `fix_summary`/`recommended_owner`/`estimated_effort` still come from the v1 entry when present — that's authored content, not evidence, so it doesn't have a staleness risk. (An earlier version of this fix used a blanket "is this layer name one of v2's 13 layers" check; that was wrong — `parameter_completeness` is deliberately the same literal in both `ValidationLayerV1` and `ValidationLayerV2`, so a per-rule register lookup is the only sound discriminator.)
- New regression fixture: `backend/src/services/reporting/__tests__/evidenceConsistency.test.ts` — a sparse multi-platform `AuditData` run through the full v2 pipeline (`runRegister` → `buildV2LayerStages` + `interpretResults`), asserting every rule_id appearing in both sections has identical evidence text, plus a meta-test proving the comparison itself catches a deliberately mismatched fixture (so the guard isn't vacuously green). This is the standing regression net PRD §7 asks for — a future rule change that reintroduces a second evidence source for the same rule_id will trip it immediately.
- Targeted unit tests added to `interpretation/__tests__/engine.test.ts` covering the exact collision case both ways (v2-layer result → live evidence; v1-layer result on the same rule_id → still gets the v1 dict's business_impact).

**Note for whoever reviews this:** since Issue 2 didn't reproduce as originally described, if you have the original openart.ai report screenshots, it's worth a quick look to confirm they match what's in the DB today — it's possible the screenshot was from a different audit_id, an earlier state of that report, or a since-fixed transient issue. Nothing found here contradicts that possibility; it just means this sprint's fix targets a confirmed *equivalent* bug rather than the literal cited example.

---

## Sprint 3 — Structural fix: co-locate remediation + failure-narrative copy with each v2 rule

**Priority:** enables P0 Issues 1 and 4
**Depends on:** none, but should land before Sprints 4 and 5

**Why this shape, not "add 90 entries to `RULE_INTERPRETATIONS`":** the v1 dict already drifted 90 rules out of sync with the register once, silently, with no test catching it until a human read a report. A separate lookup table keyed by string `rule_id` has no compiler-enforced link to the register that defines those same `rule_id`s. Putting remediation and failure-narrative copy directly on each `ValidationRule` object in `L0.ts`–`L12.ts` (next to `check`, `severity`, `owner` — fields that already live there) means a new rule literally cannot ship without the fields the report needs, and `register.integrity.test.ts` (which already asserts structural invariants across the register — see its existing evidence-shape checks) can enforce it with a single "every rule has non-empty remediation/failure_narrative" assertion.

**Scope**
- `backend/src/types/audit.ts` — extend `ValidationRule` with two new required fields:
  - `remediation: (result: ValidationResult) => string` — rule-specific fix copy, written as a function of the result so it can interpolate the offending value (platform name, cookie name, missing endpoint — per PRD Issue 1 AC) directly from `technical_details`/`evidence`, rather than a static string.
  - `failure_narrative: (result: ValidationResult) => string` — one-sentence description of what actually happened, for narrator consumption (this is what Sprint 5 wires into `generateBusinessSummary`'s fallback instead of `technical_details.expected`).
- Author these two fields for all 90 rules across `L0.ts`–`L12.ts`. This is the bulk of the work in this sprint — plan for it as content authoring, not just type plumbing, same caveat the PRD raises for Issue 1 ("may need content authoring alongside engineering").
- `register.integrity.test.ts` — add an invariant test asserting every rule in `REGISTER` has both fields defined and that calling them against a representative fail-state result never returns an empty string.
- Add a placeholder-pattern guard here too (shared with Sprint 5's Issue 4 guard) since this is where the copy is authored: a test scanning every rule's `remediation`/`failure_narrative` output (against fixture fail results) for literal placeholder patterns (`G-XXXXXXXXXX`, unresolved `{{...}}`, `XXXXXXXX`-style stand-ins) — catches new rules that copy-paste a placeholder-style example into narrative copy the way `GA4_CONFIG_TAG_PRESENT.expected` did.

**Acceptance criteria**
- `REGISTER` (all 90 rules) has `remediation` and `failure_narrative` defined; integrity test enforces this for any future rule.
- Fix-copy content review: for a sample of rules with evidence carrying a specific value (a platform name, cookie name, missing endpoint), the rendered `remediation` string names that value — not a generic sentence.

---

## Sprint 4 — Wire fix copy into the report (Issue 1)

**Priority:** P0
**Depends on:** Sprint 3

**Scope**
- `backend/src/services/interpretation/engine.ts` — `interpretResults()`: when a `rule_id` has no `RULE_INTERPRETATIONS` entry (i.e. every v2 rule), call the register rule's own `remediation(result)` instead of returning the hardcoded `'Contact support for details on this rule.'` string. Requires threading the matching `ValidationRule` (from `REGISTER`) alongside each `ValidationResult` — a `rule_id → ValidationRule` map built once from `REGISTER` is the simplest approach.
- Leave the 43-entry v1 `RULE_INTERPRETATIONS` dict as-is for the v1 rule set (still used by whatever older audits or Journey Builder flows still run v1) — no need to migrate it, just make sure v2 no longer falls through to the placeholder.

**Acceptance criteria (PRD §4 Issue 1)**
- No issue in a generated report renders the literal string `'Contact support for details on this rule.'` for any v2 rule.
- Fix copy exists (via Sprint 3) for all 41 applicable rules in the openart.ai audit's rule set (16 fails + 1 warning minimum, per PRD).
- Extend `interpretation/__tests__/engine.test.ts`'s existing placeholder-string assertion (currently `expect(issue.fix_summary).toBe('Contact support for details on this rule.')` — flip this to a negative assertion once the fix lands, and add a positive case proving a v2 rule's `fix_summary` matches its rule's `remediation()` output).

---

## Sprint 5 — Narrator failure-state branching + placeholder guard (Issue 4)

**Priority:** P0
**Depends on:** Sprint 3

**Scope**
- `backend/src/services/interpretation/engine.ts` — `toSummaryInput()`: when a `rule_id` has no `RULE_INTERPRETATIONS` entry, use the register rule's `failure_narrative(result)` (Sprint 3) instead of `result.technical_details.expected`.
- Pre-render placeholder guard (PRD §4 Issue 4 AC): add a check that runs over the fully-assembled `business_summary` string (and, while touching this, the assembled `ReportIssue[]` text fields too, since Issue 1's copy is exposed to the same risk) before a report is considered complete. Recommended default behaviour — **flag internally and ship with a visible warning banner**, not a hard block, because blocking entirely would mean *no* report ships until every one of the 90 rules' copy is verified placeholder-free; flagging surfaces the defect immediately (satisfying the PRD's real goal — nothing ships silently broken) without an all-or-nothing gate. This is one of the PRD's explicit Open Questions (§5) — confirm this default before merging, or implement whichever alternative is chosen.
- Guard pattern list: `/G-X{6,}/`, `/\{\{.*?\}\}/`, and a generic `X{4,}` run — extendable as new placeholder styles are found in authored copy.

**Acceptance criteria (PRD §4 Issue 4)**
- For every `FAIL` rule surfaced in the business summary, the sentence describes the actual observed failure (asserted via the two exact PRD examples — `DECLARED_PLATFORM_HAS_TAG` and `GA4_CONFIG_TAG_PRESENT` — as regression tests).
- No literal placeholder tokens ever render in a shipped report — test asserts the guard fires on a fixture deliberately containing `G-XXXXXXXXXX`-style text and passes clean on the fixed copy.
- Guard behaviour (flag+banner vs. hard block) implemented per whichever answer Open Question 3 receives.

---

## Sprint 6 — Substituted/fallback route labelling (Issue 5)

**Priority:** P1
**Depends on:** none (data model already exists — see investigation findings above)

**Scope**
- Recommended default for the PRD's Open Question ("exclude vs. label-and-include"): **label-and-include**. The data (`StepCoverage.source === 'fallback_landing'`) and precedent (PDF Scan Coverage section) already exist; excluding would require new suppression logic in every downstream consumer (route-level `page_view` checks, JS-error attribution) whereas labelling only requires those consumers to look up one existing field. Confirm with product before merging — this is PRD Open Question 1.
- Thread `step_coverage` lookups into whichever rule-evidence/narrator code paths currently cite a step by name without checking its source — likely candidates: route-level page_view rules in `L1.ts`/`L5.ts` that iterate per-step results, and the outbound cross-domain link / JS-error attribution logic the PRD references (`journeySimulator.ts`/`dataCapture.ts` callers). Where a cited step's `step_coverage` entry has `source === 'fallback_landing'`, append the label the PRD specifies verbatim: `"onboarding · using landing page data, page not found"`.
- Frontend: any report component rendering a per-route/per-step finding (Issues & Fixes page, Platform Impact page) needs the same label surfaced — check `ReportIssue`/`JourneyStageIssue` types for whether step provenance is currently threaded that far; if not, extend them (mirroring the existing `frontend/src/types/audit.ts` "mirror, not separate source of truth" pattern).

**Acceptance criteria (PRD §4 Issue 5)**
- Page metadata (`step_coverage`) is available to every downstream consumer that cites a step by name — audited via a codemod/grep pass over rules and narrator code that reference step labels directly.
- Any report line item referencing a substituted route carries the visible label.
- Implements whichever product decision Open Question 1 lands on (label-and-include proposed as default above).

---

## Sprint 7 (stretch) — Severity-weighted scoring (Issue 7)

**Priority:** P2 · stretch, pending product sign-off (PRD §4 explicitly gates engineering start on this)
**Depends on:** none

**Scope**
- `backend/src/services/validation/register/scoring.ts` — add a configurable per-severity weight table (not hardcoded per rule — PRD requirement) feeding a new weighted-score calculation alongside (not replacing, until sign-off) `calculateV2Scores`'s existing flat pass-rate `conversion_signal_health`.
- Recommended default weight table for product sign-off, taken directly from the PRD's own example (§5 Open Questions): `critical: 4, high: 2, medium: 1, low: 0.5, warning: 0.25` (warning added since the current model already distinguishes `fail`/`warning` status). This is a proposal, not an engineering decision — confirm before implementing (PRD Open Question 2 explicitly calls this out as needing "an actual decision, not an engineering guess").
- Weight table as configuration (JSON in a new `backend/src/config/` module, or a DB-backed table if per-org tuning is ever wanted — DB is over-scoped for this PRD's stated need, recommend a static config file unless product asks for per-org tuning).
- Recompute path: since `audit_findings` already persists rule-level results (per PRD AC), a weighted score for a historical audit should be derivable from stored findings without re-running the scan — build the weighted calculation as a pure function over `ValidationResult[]` (same shape `calculateV2Scores` already takes) so it can run against either a fresh register run or a stored `audit_findings` read.

**Acceptance criteria (PRD §4 Issue 7)**
- Scoring function accepts a per-severity weight table as configuration.
- Setting all weights equal reproduces the current flat pass-rate score exactly (regression/rollback test).
- A historical audit's stored `audit_findings` can be re-scored against a new weight table without re-running the scan (test: same fixture, two weight tables, two different scores, no crawl invoked).

---

## Cross-cutting: PRD §7 testing note

The regression fixture built in Sprint 2 (full-taxonomy synthetic `AuditData` run through the whole pipeline) should be extended, not rebuilt, as each subsequent sprint lands — Sprint 3/4/5's placeholder guard and Sprint 6's label check are both naturally expressed as assertions over that same fixture's rendered output. Re-run the openart.ai audit (or a fixture derived from it) after each sprint and confirm the specific before/after change in that issue's PRD acceptance criteria, per PRD §7.

---

## Open product decisions carried into this plan (PRD §5)

| # | Question | Default proposed here | Where it's gated |
|---|---|---|---|
| 1 | Exclude substituted routes from route-level findings, or label and keep them? | **Label and keep** (Sprint 6) | Sprint 6, before merge |
| 2 | Severity weighting for Issue 7? | critical×4 / high×2 / medium×1 / low×0.5 / warning×0.25 (Sprint 7) | Sprint 7, before implementation starts |
| 3 | Should the Issue 4 placeholder guard block delivery, or flag + ship with a warning banner? | **Flag + banner** (Sprint 5) | Sprint 5, before merge |

None of these defaults should be treated as decided — they're proposed so Sprints 5-7 aren't blocked on a meeting before they can even be scoped, per the PRD's own framing that engineering shouldn't guess on Issue 7's weights specifically. Confirm each before the sprint that depends on it merges.
