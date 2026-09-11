# PRD (reconstructed) · Report Correctness Programme

**Status** · Shipped (Parts A–D, all merged)
**Type** · Reconstructed retrospective — this document did not previously exist as a checked-in file. It is assembled from the commit messages and code comments below, which is the only surviving record of this PRD's scope and reasoning. Treat it as traceability, not as the original authored text.
**Reconstructed** · 11 September 2026, as Sprint 0 of the Pre-Connection Scan Confidence Tiering sprint plan (`docs/atlas-sprint-plan-pre-connection-confidence-tiering.md`), because the new PRD's confidence/evidence-class work directly extends primitives this programme shipped (`could_not_be_assessed`, the v1 `confidence` disclosure flag, `REGISTER_VERSION`), and there was no doc to diff against.
**Primary session** · `session_01QihQCSiqD2jB2JzaB1ZeF7`

---

## Why this existed

Two real audits (Birkenstock `13795830`, and a later run referenced as `7d64f5e9` for birkenstock.com/sg) shipped Check Register v2 findings that contradicted their own evidence — a rule failed while a logically-dependent sibling rule's evidence proved the failure couldn't be true. This programme is four parts (A–D) fixing that class of defect and the reporting mechanics around it, landed 6 September 2026. It was followed the next day by a related but separately-named PRD, the **Click-ID Contention, Contradiction Guard & Settle Enforcement PRD** (see `docs/ATLAS_CLICKID_CONTENTION_CONTRADICTION_GUARD_PRD.md`), which rewrote and extended Part A's contradiction guard.

## Part A — L2 delimited-value capture tier and contradiction guard (v1)

**Commit** `5696dda3` · "Add L2 delimited-value capture tier and contradiction guard"

**Problem.** Birkenstock audit `13795830` reported all 5 click-ID capture rules as `FAIL` while `GCL_AW_COOKIE_PRESENT`, `FBP_AND_FBC_COOKIES_PRESENT`, and `CLICK_ID_WRITTEN_TO_DURABLE_STORAGE` all `PASS`ed on the same run. Those cookies can only be populated by capturing the click ID they store — Atlas was missing the single most common capture mechanism on the web: Google's and Meta's own conversion-linker cookies store the click ID as one delimited segment inside a larger string (`_gcl_aw = "GCL.<timestamp>.<gclid>"`, `_fbc = "fb.1.<timestamp>.<fbclid>"`), and the capture check only looked for an exact key match.

**Shipped.**
- `checkParamCapture()` (`L2.ts`) gained a third tier searching localStorage, sessionStorage, cookies, and the dataLayer for the synthetic target as a substring, guarded by a minimum target length so it can't degenerate into a coincidental match. Evidence names the container, key, and full raw value found.
- New `contradictionGuard.ts` (v1): flagged a `FAIL` result that a passing sibling rule logically ruled out (any click-ID capture rule failing while its cookie-presence or durable-storage rule passes) — appended a visible evidence line and logged for operator visibility. Wired into `runRegister()` (`engine.ts`).

**Known defect in this version, fixed in Part A3 / the successor PRD's W2:** the guard annotated the still-*failing* result in place rather than suppressing it — a self-contradicting finding still shipped to the client, just with an extra line inside it arguing against itself.

## Part B — Report rendering defects: prose leaking into labels, mismatched effort, wrong CNBA preamble

**Commit** `2a69d0535` · same session

**Problem.** All five defects traced to one root cause: several v2 Check Register `rule_id`s (`GCLID_CAPTURED_AT_LANDING`, `FBCLID_CAPTURED_AT_LANDING`) happen to name-collide with entries in the v1-era `RULE_INTERPRETATIONS` dict, while siblings from the same factory (`GBRAID`/`WBRAID`/`TTCLID_CAPTURED_AT_LANDING`) don't. A lookup silently borrowed the v1 entry when present and fell back to generic text otherwise, producing inconsistent rendering across one rule family depending on an accident of naming.

**Shipped.**
- **B1** — `register/reporting.ts`'s `failed_rule_details` now reads `technical_details.found` (the actual observed defect) instead of `.expected` (the rule's ideal-state description) for its impact field; `pdfGenerator.ts`'s Platform Health "Failed: ..." line always renders the rule name instead of a v1-dict headline lookup that mixed prose and raw rule_ids in the same line.
- **B2** — new `v2Heading()` in `interpretation/engine.ts` derives every v2 result's action-item heading from the rule's own authored `check` label, never a same-named v1 dict entry or a raw "Validation failed: RULE_ID" fallback. `pdfGenerator.ts`'s issue cards (Configuration Health and Runtime Action Items) now render `why_it_matters` as an impact sentence beneath the heading, before the fix summary.
- **B3** — `ValidationRule` gained an optional `estimated_effort` field, set once inside L2's `makeClickIdCaptureRule()` factory so every rule it produces shares identical effort by construction; `interpretResults()` reads it for v2 results instead of falling through to the v1 dict/generic default.
- **B4** — the Could Not Be Assessed preamble made generic (the section has two distinct exclusion causes — unreached pages and unsettled steps — and each item already states its own reason); fixed a "used the landing page for instead" typo.
- **B5** — verified already resolved in an earlier sprint: the funnel pipeline diagram had already been removed from `pdfGenerator.ts`.

## Part C — Scan trustworthiness: verify guessed steps, all-or-nothing settle suppression, frame-origin error filtering

**Commit** `b78a742f` · same session

- **C1** — `StepCoverage` gained `http_status` (`Response.status()` from `gotoAndSettle`, `dataCapture.ts`), and `ConsoleError` gained `frame_url` (the originating script's `location().url`, `interceptConsoleErrors`) — prerequisite data for C2 and C5.
- **C2** *(decision: verify)* — a `step_coverage` entry with `source: 'heuristic'` (a `stepUrlResolver.ts` path guess) must now be verified — HTTP 2xx, plus its declared confirmation signal (`wait_for_outcome`) if one exists — before it counts toward the conversion surface. New `isVerifiedStep()` (`L0.ts`) gates both `conversionSurfaceReached()` (the `engine.ts` `'conversion_surface'` precondition every L4.3/L4.4/L5–L7 rule depends on) and `CONVERSION_SURFACE_IDENTIFIED` (L0.3) itself, so an unverified guess can no longer make L0.3 pass or unlock the rules gated behind it.
- **C3** *(decision: all-or-nothing)* — `degradationSuppression.ts`'s `partitionDegradedRuns()` now also suppresses any result whose own evidence names a degraded step by its quoted name (the same convention `coverageSuppression.ts` already uses for `fallback_landing`), on top of the existing `ABSENCE_SENSITIVE_RULE_IDS` allowlist — generalizing coverage past a hand-maintained rule_id list, which is what let `CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS` (L12.8) survive Birkenstock's unsettled confirmation step and produce a 15-error finding.
- **C4** *(decision: accept now)* — already covered by C2: an unverified conversion step no longer satisfies the `conversion_surface` precondition, so dependent L5/L12 rules correctly report skipped/inconclusive rather than running against an unconfirmed page. No new Scan Input added.
- **C5** *(decision: filter by frame)* — L12's `NO_CONSOLE_ERRORS_FROM_MEASUREMENT_CODE` and `CONVERSION_SURFACE_REACHABLE_WITHOUT_JS_ERRORS` now both filter `consoleErrors` to the top document (`isTopDocumentError`, comparing `frame_url`'s origin against `website_url`) before applying their own logic — excluding sandboxed/cross-origin iframe noise by origin, never by matching error text.

## Part D — Score comparability: fixed 13-layer denominator, not-applicable/not-scanned distinction, register_version

**Commit** `29985c28` · same session

**Problem.** The header composite score's denominator (`layers_total`) previously shrank silently whenever a layer was entirely excluded by `applies_to`/`platform_scope` (contributing zero results, not even `skipped`) — producing "7 of 11" for one audit and "7 of 12" for another of the exact same fixed rule set.

**Shipped.**
- **D1** — the denominator is now always **13** — `ALL_V2_LAYERS.length`, `register/layers.ts`'s new single source of truth for the full layer enum — never however many layers happened to produce a result this run.
- **D2** — `coverage.ts`'s layer classification now covers all 13 layers, labelling each untested one `not_applicable` (this site's declared configuration means the layer has nothing to check, or it isn't built yet — L11 Reconciliation) or `not_scanned` (in scope, but this run's crawl never reached what it needed) — visibly distinct in both the PDF and web report.
- **D3** — `AuditScores` gained `conversion_signal_health_numerator`/`_denominator` (the raw severity-weighted units behind the composite score), persisted on the audit row. `GET /api/audits/:id/report`'s comparison object now flags `denominator_changed`/`register_version_changed` when the current and previous audit for the same site used a different denominator or register version.
- **D4** — new `REGISTER_VERSION` constant (`register/layers.ts`, `'1.0.0'` at time of writing), stamped on every v2 report and audit row. Wired into the scheduled-audit regression comparator (`queue/regressionComparability.ts`) alongside the existing `rule_set_version`/`coverage_fingerprint` checks — an unset `register_version` (pre-existing audit history) is treated as compatible rather than blocking.
- **D5** *(decided: stand as issued)* — no recomputation pipeline; a historical score keeps whatever `register_version` it was issued under; the comparison flags let the report explain a jump without rewriting it.

## What this means for the Confidence Tiering PRD

- `REGISTER_VERSION` must be bumped by the Confidence Tiering sprints per its own documented contract (Part D4) whenever rule shape changes (new `evidence_class`/`requires` fields, split rules, etc.).
- The `not_applicable`/`not_scanned` distinction (Part D2) is close kin to — but not the same as — the new PRD's `NOT_OBSERVED`/`INCONCLUSIVE` verdicts. D2 operates at layer granularity for coverage display; the new PRD operates at rule/verdict granularity for scoring exclusion. Both should compose, not duplicate.
- Part B's lesson (name-collision-driven inconsistent rendering) is a direct precedent for why the new PRD's `outputLint.ts` needs to scan the *fully assembled* payload rather than trust any single rendering code path to be consistent.
