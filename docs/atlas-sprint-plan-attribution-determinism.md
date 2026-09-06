# Sprint Plan: Platform Attribution Correctness & Scan Determinism

**Status:** Implemented (this branch)
**Source PRD:** `ATLAS_PLATFORM_ATTRIBUTION_DETERMINISM_PRD.md` (2026-09-06)
**Owner:** Vikram Jeet Singh
**Priority:** P0 — both defects are visible to clients in delivered reports

---

## How to read this plan

Two independent defects, found by running the same site three times in two days. Part A
(platform attribution) is small and self-contained. Part B (scan determinism) is larger
and is instrumented before it is fixed, per the PRD's own sequencing rule. They ship
together on this branch, but Part A does not depend on Part B, and never waited on it.

```
Part A (self-contained)
  A-W1 → A-W2 → A-W3 → A-W4

Part B (instrument first, then fix)
  B-W1 (instrumentation)
    → B-W2 (deterministic settle)
    → B-W3 (partial-run flag)
    → B-W4 (absence vs. failure)
  B-W5 (NO_TAG_LOAD_ERRORS downgrade) — independent, any time after B-W1
  B-W6 (variance harness) — depends on B-W2/B-W4 existing to have something to regression-test
```

---

## Part A — Platform attribution

**Defect:** `buildV2PlatformBreakdown()` blamed every platform in a multi-platform rule's
scope for that rule's single scalar `fail` status, including platforms whose own evidence
said they passed. Audit `14ab28ae` rated TikTok "At Risk" on a rule TikTok itself passed.

### A-W1 — Structured per-platform outcomes

**Files:** `backend/src/types/audit.ts`, `backend/src/services/validation/register/L0.ts`,
`backend/src/services/validation/register/L7.ts`

- `ValidationResult.platform_outcomes?: Partial<Record<DeclaredPlatform, RuleStatus>>` —
  additive, optional. `status` stays the rule's overall verdict; `platform_outcomes` is the
  disaggregation.
- Populated in every rule scoped `'declared'` or a multi-element `platform_scope` array:
  `DECLARED_PLATFORM_HAS_TAG` (L0.1 — genuinely differs per platform, computed from its own
  per-platform tag-presence check), `EMAIL_CAPTURED_FOR_CAPI` (L7.2), `PHONE_CAPTURED_WHERE_
  COLLECTED` (L7.3), `NAME_AND_ADDRESS_CAPTURED_WHERE_COLLECTED` (L7.4) — the latter three
  broadcast one shared status to every scoped platform via `broadcastPlatformOutcome()`,
  since their underlying check (a field's presence on the shared conversion event) doesn't
  itself vary by platform; still populated so the integrity guard (A-W3) sees them
  accounted for.

### A-W2 — Consume it in the platform breakdown

**File:** `backend/src/services/validation/register/reporting.ts`

`buildV2PlatformBreakdown()`'s `failedRules` computation reads `r.platform_outcomes?.
[platform] ?? r.status` instead of the bare scalar — a rule not yet migrated, or scoped to
a single platform, falls back to the scalar unchanged.

### A-W3 — Register integrity guard

**File:** `backend/src/services/validation/register/__tests__/register.integrity.test.ts`

New test: every rule whose `platform_scope` is `'declared'` or a multi-element array
populates `platform_outcomes` for a non-skipped result, evaluated against a realistic
multi-platform fixture (not the register's own minimal/mostly-skipped fixture, which would
let a rule's `platform_outcomes` branch go untested). Caught `EMAIL_CAPTURED_FOR_CAPI`
missing this the first time this test was written.

### A-W4 — Tests

**File:** `backend/src/services/validation/register/__tests__/reporting.test.ts`

- L0.1 fails for Meta only → Meta lists it, Google Ads/TikTok don't, TikTok's total drops
  to 0 of 3 failed with status `healthy` (the exact `14ab28ae` shape).
- A single-platform rule with no `platform_outcomes` behaves exactly as before (scalar
  fallback).
- A `'declared'`-scope rule with `platform_outcomes` absent (not-yet-migrated) falls back
  to the scalar for every platform — proves the fallback path, not just the new path.

**Status:** Done. Re-running audit `14ab28ae`'s exact evidence shape now reports TikTok
healthy at 0 of N failed; no platform lists a rule its own evidence says it passed.

---

## Part B — Scan determinism

**Defect:** three scans of the same unchanged site (`openart.ai`) produced materially
different reports — failed tag requests 13/39/10, four rules flipping verdict — traced to
`journeySimulator.ts`'s binary navigation strategy (`networkidle` for 20s, silently retry
`domcontentloaded` on failure/timeout). Nothing in the audit record said which path was
taken, so a fast degraded run and a complete run were indistinguishable in the output.

### B-W1 — Instrument first

**Files:** `backend/src/types/audit.ts`, `backend/src/services/audit/dataCapture.ts`,
`backend/src/services/audit/journeySimulator.ts`

- `StepCoverage` gains `settle_outcome` (`'settled' | 'quiet_period_cap_reached' |
  'navigation_failed'`), `settle_ms`, `wait_for_outcome` (`'matched' | 'timed_out' |
  'not_declared'`), `requests_in_flight_at_snapshot`, and the derived `degraded: boolean`.
- `interceptNetworkRequests()` now returns an `InFlightTracker` — a live count of tracked
  (`shouldCaptureUrl`) requests with neither a response nor a failure recorded yet.
- Recorded per step in `journeySimulator.ts`'s step loop, unconditionally (even on a
  failed/thrown step), before Part B-W2's behaviour change — so the hypothesis in the PRD
  is a fact, not an assumption, from the same commit that changes behaviour.

### B-W2 — Deterministic settle

**Files:** `backend/src/services/audit/dataCapture.ts` (`gotoAndSettle`,
`waitForNetworkQuiet`, `DEFAULT_SETTLE_CONFIG`), `backend/src/services/audit/
journeySimulator.ts`

Replaced the binary strategy with a bounded, explicit, always-applied sequence: one
`page.goto()` waiting only for `domcontentloaded` (a page always reaches this — no silent
retry), then a fixed quiet-period wait (no tracked request in flight for `quietPeriodMs`,
capped at `maxSettleMs` total). Production defaults (`navigationTimeoutMs: 15s,
quietPeriodMs: 1s, maxSettleMs: 8s, pollIntervalMs: 200ms`) are conservative but bounded,
unlike the `networkidle` they replace. `SimulatorOptions.settleConfig` lets tests override
the timings without touching the logic under test.

Scope note: only the per-step navigation loop changed (the PRD's own line-number citation).
The separate boundary-domain probe (`product_domain`/`checkout_domain`, L4.3/L4.4) still
uses its pre-existing `networkidle`-then-`domcontentloaded` fallback — not named in the
PRD's defect, and left alone to keep this change's blast radius to the path actually shown
to be non-deterministic.

### B-W3 — Degraded runs must declare themselves

**Files:** `backend/src/types/audit.ts` (`ReportCoverage.partial` / `.degraded_steps`),
`backend/src/services/reporting/coverage.ts`, `backend/src/services/export/
pdfGenerator.ts`, `frontend/src/components/audit/ReportPages/ExecutiveSummary.tsx`

A step is `degraded` when its settle sequence hit its cap, navigation failed outright, or a
declared `waitFor` timed out. `buildCoverageSummary()` surfaces `partial`/`degraded_steps`
on `ReportCoverage` — the same field the `fallback_landing` coverage banner already uses —
so a run that didn't fully settle is visibly flagged in both the PDF ("Scan Coverage"
section) and the web report's "Limited scan coverage" banner, even when every page was
technically reached.

### B-W4 — Separate absence from failure

**File:** `backend/src/services/reporting/degradationSuppression.ts` (new), wired into
`backend/src/services/audit/orchestrator.ts` alongside the existing `coverageSuppression.ts`

A fixed set of absence-sensitive rules (`GOOGLE_ADS_CONVERSION_EVENT_FIRES`,
`META_CONVERSION_EVENT_FIRES`, `TIKTOK_CONVERSION_EVENT_FIRES`, `GA4_CONVERSION_EVENT_
FIRES`, `GA4_CONFIG_TAG_PRESENT`, `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW`,
`REFERRER_PRESERVED_THROUGH_ENTRY`) — every rule the PRD names, whose verdict is really an
assertion about whether a request/cookie was observed at all — has its result moved to
`could_not_be_assessed` whenever any step in the run degraded. This reuses the existing
`could_not_be_assessed` section (`coverageSuppression.ts`'s "suppress, do not annotate"
pattern) rather than adding a genuine `inconclusive` `RuleStatus`, per the PRD's own
fallback: a new status would touch `scoring.ts`'s `scored()`/`layerCoverage()`,
`reporting.ts`'s `worstStatus`, and the frontend's separate `RuleStatus` mirror — exactly
the "disturbing scoring" the PRD says to avoid.

### B-W5 — Downgrade `NO_TAG_LOAD_ERRORS`

**File:** `backend/src/services/validation/register/L1.ts`

Took the PRD's first-preference option: only a confirmed HTTP 4xx/5xx counts as a
violation now. A bare network-level failure (no HTTP status — DNS error, connection
refused, blocked by an ad blocker/CSP) is excluded from the counted/failing set, since it's
plausibly caused by the scan environment rather than the site, but is still surfaced in the
evidence as a `Caveat:` line rather than silently dropped. Severity stays `high` — a
confirmed 4xx/5xx is still a real, verified broken endpoint.

### B-W6 — Variance regression harness

**File:** `backend/src/services/validation/register/__tests__/variance.test.ts` (new)

Two things, not one: (1) `runRegister()` run 20× on the same fixed `AuditData` (a settled
fixture and a degraded fixture) must produce byte-identical results every time — catches
the register itself ever regressing into non-determinism (wall-clock reads, iteration
order, etc.). (2) the exact `openart.ai` correlated-failure shape — one degraded step
(landing) producing both a false-fail (`TIKTOK_CONVERSION_EVENT_FIRES`) and a false-pass
(`STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW`) — run end-to-end through `runRegister` +
`partitionCoverageAffected` + `partitionDegradedRuns`, asserting both move to
`could_not_be_assessed` while an unrelated rule (`GTM_CONTAINER_LOADED`) is untouched. The
three OpenArt audits (`6e3b260d`, `5338c1dc`, `14ab28ae`) remain the PRD's own recommended
fixtures for a future live-scan regression pass; this harness is the code-level analogue
runnable in CI today.

**Status:** Done, validated against unit/fixture tests. Real-world validation against a
live re-scan of `openart.ai` (or another heavy-SPA site) is the natural next step, on
infra this session doesn't have — the PRD's own acceptance criteria ("three consecutive
scans of the same site produce identical rule statuses") is exactly what to check there.

---

## What this branch does not do

- No live Browserbase re-scan of `openart.ai` was performed — this session has no browser
  automation infra. `docs/` and the PRD both note the three existing OpenArt audits should
  be retained as determinism fixtures; nothing here touches or replaces those DB rows.
- The client-facing OpenArt report itself is unchanged — per the PRD's own note, don't send
  it until Part B lands and a fresh scan is run against the fixed pipeline.
- No `inconclusive` `RuleStatus` was added (see B-W4) — the existing `could_not_be_assessed`
  mechanism was judged sufficient and lower-risk, per the PRD's own stated fallback.
- The boundary-domain probe's own `networkidle` usage (L4.3/L4.4) was left unchanged — see
  B-W2's scope note.
