# Sprint Plan: Signal Health Report — Accuracy & Output Fixes

**Status:** All 7 sprints done. Sprints 1-5 and 7 (Issues 1, 2, 3, 4, 6, 7) implemented and merged into `claude/sprint-plan-prd-pu51h6`. Sprint 6 (Issue 5) was folded into `ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` as that PRD's W3 and implemented there with a different resolution than this doc had proposed — see Sprint 6's note below.
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
Sprint 1 (Issue 3 + 6)         — DONE
Sprint 2 (Issue 2)             — DONE
Sprint 3 (shared v2 remediation data model)  — DONE
  → Sprint 4 (Issue 1: wire fix copy)        — DONE (shipped inside Sprint 3)
  → Sprint 5 (Issue 4: narrator fix + placeholder guard) — DONE
Sprint 6 (Issue 5)             — DONE (implemented as ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md's W3, "suppress" not "label-and-include")
Sprint 7 (Issue 7, stretch)    — DONE (weights + rollout confirmed in-session)
```

Sprints 1-5 and 7 are implemented and merged into `claude/sprint-plan-prd-pu51h6` as of this writing (485 backend tests passing, clean `tsc --noEmit` on both backend and frontend). Sprint 3 shipped without a separate `failure_narrative` field — see that sprint's "what actually shipped" note — which meant Sprint 4 and 5's narrator fix landed in the same pass as Sprint 3, with only the placeholder guard itself picked up as a distinct follow-on (also now done). Sprint 6 is now also done — the product decision this doc left open was made (differently than proposed here) in `ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` §5, and implemented as that PRD's W3.

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

**Status: implemented and merged into this branch** — see commit history on `claude/sprint-plan-prd-pu51h6`.

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

## Sprint 3 — Structural fix: co-locate remediation copy with each v2 rule — DONE

**Priority:** enables P0 Issues 1 and 4
**Status:** implemented and merged.

**Why this shape, not "add 90 entries to `RULE_INTERPRETATIONS`":** the v1 dict already drifted 90 rules out of sync with the register once, silently, with no test catching it until a human read a report. A separate lookup table keyed by string `rule_id` has no compiler-enforced link to the register that defines those same `rule_id`s. Putting remediation copy directly on each `ValidationRule` object in `L0.ts`–`L12.ts` (next to `check`, `severity`, `owner` — fields that already live there) means a new rule literally cannot ship without the field the report needs, and `register.integrity.test.ts` enforces it with a single "every rule has non-empty remediation" assertion.

**What actually shipped (leaner than the original plan, in a good way):**

The `failure_narrative` field turned out to be unnecessary. For nearly every rule in the register, `technical_details.found` already reads as a correct, evidence-grounded description of the actual observed state — for both pass and fail — because that's what the field is *for*. The narrator's bug (Issue 4) was never "missing narrative content," it was "reading the wrong existing field" (`.expected`, the ideal-state text, instead of `.found`). Adding a whole second authored field per rule to fix a one-line field-selection bug would have been unjustified scope. So Sprint 3 shipped as:

- `backend/src/types/audit.ts` — `ValidationRule` gained one new field: `remediation: string | ((result: ValidationResult) => string)`. A plain string for a rule whose fix doesn't vary by evidence; a function for a rule whose fix names something that varies per audit (a platform, a cookie, an endpoint) — those read `technical_details.found`/`evidence` to interpolate the real value.
- Authored `remediation` for all 90 rules across `L0.ts`–`L12.ts`, including through the register's shared rule-factories (`makeClickIdCaptureRule`, `makePixelPresenceRule`, `makeConversionFiresRule`, `makeCandidateKeyRule`, `makeEmailCapturedRule`) where a single generic, closure-based remediation covers every rule the factory produces.
- `register.integrity.test.ts` — new invariant test asserting every rule in `REGISTER` has non-empty `remediation`, and that calling it (function or string) against a real `test()` result never throws or returns an empty string. 472 backend tests green, clean `tsc --noEmit`.
- This closed Issue 1 and Issue 4 together, ahead of the plan's schedule — see below.

---

## Sprint 4 — Wire fix copy into the report (Issue 1) — DONE (shipped inside Sprint 3)

**Priority:** P0

`backend/src/services/interpretation/engine.ts` — `interpretResults()` now resolves a `rule_id → ValidationRule` map from `REGISTER` (`REGISTER_RULE_BY_RULE_ID`) and an `isV2Result()` helper (rule_id **and** validation_layer both match a register entry — see Sprint 2's collision finding for why layer alone isn't enough). For any v2-originated result — whether or not a same-named v1 `RULE_INTERPRETATIONS` entry exists — `fix_summary` now comes from that rule's own `remediation`, evaluated against the live result, instead of the placeholder string. `recommended_owner`/`estimated_effort` still borrow the v1 entry when one happens to exist (that content isn't evidence, so it has no staleness risk), but v1's fix_summary is never used for a v2 result even for the three collision rule_ids (`GTM_CONTAINER_LOADED`, `GCLID_CAPTURED_AT_LANDING`, `FBCLID_CAPTURED_AT_LANDING`) — the v2 rule's own remediation is more specific.

**Acceptance criteria — met**
- No issue in a generated report renders `'Contact support for details on this rule.'` for any v2 rule (only the true fallback path — a rule_id matching neither the v1 dict nor the register — can still produce it, and that can't happen for a real v2 audit).
- Fix copy exists for all 90 register rules (exceeds the PRD's 41-rule minimum).
- `interpretation/__tests__/engine.test.ts` extended with the collision-case tests from Sprint 2 plus assertions proving `fix_summary` matches the rule's own `remediation()` output.

---

## Sprint 5 — Narrator failure-state fix + placeholder guard — DONE

**Priority:** P0
**Status:** implemented and merged.

**Narrator fix (shipped inside Sprint 3):** `toSummaryInput()` reads `technical_details.found` unconditionally for any result without a provably-v1-originated `RULE_INTERPRETATIONS` entry (same `isV2Result()` discriminator as Sprint 4) — never `.expected`. Regression tests reproduce the PRD's exact two examples (`DECLARED_PLATFORM_HAS_TAG`'s "every declared platform has its base tag" pass-state sentence, `GA4_CONFIG_TAG_PRESENT`'s `G-XXXXXXXXXX` placeholder) and assert neither ever renders for a FAIL result.

**Placeholder guard (this sprint):** a defense-in-depth net against a *future* rule's copy making the same mistake — not a fix for a currently-reproducing bug.
- `backend/src/services/reporting/placeholderGuard.ts` — `scanReportForPlaceholders(report)` scans every narrative field (`executive_summary.business_summary`, each `issues[].problem`/`why_it_matters`/`fix_summary`, `journey_stages[].issues[].label`, `platform_breakdown[].risk_explanation`/`failed_rule_details[].impact`) against 4 patterns (`G-X{6,}`, `AW-X{6,}`, unresolved `{{template}}`, a generic `X{4,}` run) and returns which fields matched. Deliberately excludes `technical_appendix.validation_results` — raw rule evidence can legitimately contain an X-shaped string (a genuinely malformed hash, say) without it being an authoring mistake.
- `ReportJSON` gained `content_quality_warning?: { flagged_fields: string[] }` (backend + frontend type mirror), set by `generateReport()` when the scan finds anything. **Default implemented: flag, not block** (PRD Open Question 3's recommended default — still not formally confirmed by product, flagging here as a call to revisit if the answer comes back differently).
- Frontend: `ContentQualityWarningBanner` renders whenever `report.content_quality_warning` is present, shown above all report pages in `ReportPage.tsx` — non-fatal, the rest of the report still renders in full below it.
- Tests: `placeholderGuard.test.ts` (8 tests — clean report, each field type, plus a negative case proving ordinary evidence like a malformed-hash string doesn't false-positive) plus `generateReport()` wiring tests. 480 backend tests passing; clean `tsc --noEmit` on both backend and frontend.

---

## Sprint 6 — Substituted/fallback route labelling (Issue 5) — DONE, superseded

**Status: implemented, but not as this section originally scoped it.** The
`docs/ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` PRD ("Signal Health Report:
Evidence Integrity & Presentation") folded this sprint in as its W3 and made
the product decision this section had left open: **suppress, do not
annotate** — the opposite of the "label-and-include" default proposed
below. A result whose evidence names a step that resolved to
`fallback_landing` is excluded entirely from issues, scores, and journey/
platform breakdowns, and listed separately under a new "Could Not Be
Assessed" section instead of being labelled and kept. See
`backend/src/services/reporting/coverageSuppression.ts` and
`ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` §5 for the rationale. The
"label-and-include" plan below is kept for history; it was not implemented.

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

## Sprint 7 (stretch) — Severity-weighted scoring (Issue 7) — DONE

**Priority:** P2 · stretch
**Status:** implemented and merged, per explicit user sign-off on the weight table and rollout approach (see below) — product's formal sign-off on the PRD's own Open Question 2 is still worth a final confirm, but engineering proceeded on direction given in this session rather than staying blocked.

**Decisions made (in this session, not by the PRD itself):**
- Weight table: `critical: 4, high: 2, medium: 1, low: 0.5` — the PRD's own proposed default, confirmed.
- Rollout: **replaces** `conversion_signal_health` directly rather than shipping alongside it as a second field — confirmed. Setting all weights equal reproduces the exact old number, so this was treated as a safe drop-in rather than a breaking change.

**What shipped**
- `backend/src/config/scoringWeights.ts` — new config module exporting `DEFAULT_SEVERITY_WEIGHTS`. Configuration, not hardcoded per rule (the PRD's explicit requirement) — tuning the score's severity sensitivity is a one-file edit, no rule touched.
- `backend/src/services/validation/register/scoring.ts` — `calculateV2Scores(results, severityWeights = DEFAULT_SEVERITY_WEIGHTS)` now takes an optional weight table; `conversion_signal_health` is computed by a new `weightedSignalHealth()` (each non-skipped result contributes its severity's weight to the denominator, and that weight to the numerator only if it passed — `fail`/`warning` both contribute zero credit, same treatment the old flat formula gave both). The three categorical scores (`attribution_risk_level`/`optimization_strength`/`data_consistency_score`) are untouched — Issue 7 is specifically about the headline number, not those.
- `frontend/src/lib/ui-copy.ts` — updated the Conversion Signal Health tooltip copy to describe the weighted formula instead of "the percentage of tracking checks that passed," so the UI doesn't quietly misdescribe its own number.
- Tests (`scoring.test.ts`): a mixed-severity fixture shaped like the PRD's own openart.ai example (9 critical fails, 7 low-severity passes) proving the weighted score drags down harder than a flat pass rate would; equal-weights-reproduces-flat-exactly on that same mixed fixture (not just the pre-existing uniform-severity fixture, which couldn't have caught a real regression here); a warning contributing zero credit like a fail; two different weight tables producing two different scores from the *same* stored `ValidationResult[]` with no re-scan (satisfies the "historical audit re-scoring" AC directly, since `calculateV2Scores` is already a pure function over exactly the shape `audit_results` persists — no new recompute endpoint was needed to prove this). 485 backend tests passing; clean `tsc --noEmit` on both backend and frontend.
- Checked `worker.ts`'s scheduled-audit regression comparator (alerts when score drops ≥5 points between runs) — unaffected structurally, since it only ever compares two scores computed by the same current formula; a real regression still shows as a drop, just possibly a larger one now that a single critical rule flipping status moves the score more than it used to. Left the ≥5 threshold as-is — retuning it is a product call this PRD didn't ask for.

**Acceptance criteria — met**
- Scoring function accepts a per-severity weight table as configuration. ✓
- Setting all weights equal reproduces the flat pass-rate score exactly, including on a mixed-severity fixture. ✓
- A historical audit's stored results can be re-scored against a new weight table without re-running the scan. ✓ (proven directly — `calculateV2Scores` is pure over `ValidationResult[]`, which is exactly what `audit_results` persists; no new endpoint required to satisfy this, though a "re-score this old audit" UI/API action would need one if product wants it as a feature.)

---

## Cross-cutting: PRD §7 testing note

The regression fixture built in Sprint 2 (full-taxonomy synthetic `AuditData` run through the whole pipeline) should be extended, not rebuilt, as each subsequent sprint lands — Sprint 3/4/5's placeholder guard and Sprint 6's label check are both naturally expressed as assertions over that same fixture's rendered output. Re-run the openart.ai audit (or a fixture derived from it) after each sprint and confirm the specific before/after change in that issue's PRD acceptance criteria, per PRD §7.

---

## Open product decisions carried into this plan (PRD §5)

| # | Question | Default proposed here | Status |
|---|---|---|---|
| 1 | Exclude substituted routes from route-level findings, or label and keep them? | **Label and keep** (Sprint 6) | **Decided differently** — `ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` §5 decided **suppress, do not annotate** instead, and that's what shipped (Sprint 6 / that PRD's W3) |
| 2 | Severity weighting for Issue 7? | critical×4 / high×2 / medium×1 / low×0.5 | **Confirmed in-session** — implemented, replacing the flat score directly (also confirmed, see Sprint 7) |
| 3 | Should the Issue 4 placeholder guard block delivery, or flag + ship with a warning banner? | **Flag + banner** | Implemented per this default — not separately re-confirmed with product, worth a final check |

Row 2 (Issue 7's weight table, plus the flat-vs-weighted rollout question raised alongside it) is now implemented per explicit confirmation in this session. Row 3 (Issue 4's guard behaviour) was implemented per the recommended default without a separate confirmation round — flag before shipping if product wants block-instead-of-flag reconsidered. Row 1 (Issue 5, Sprint 6) is done, but landed on the opposite answer this doc had proposed as a default — see `ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` §5 for the rationale (a false finding costs more credibility than an omitted true one).
