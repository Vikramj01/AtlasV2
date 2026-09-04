# Sprint Plan: Site Evaluation Engine — Coverage & Honesty

**Status:** Draft — ready for implementation
**Source PRD:** [`docs/atlas-prd-site-evaluation-coverage.md`](https://github.com/Vikramj01/AtlasV2/blob/claude/site-eval-tool-coverage-gnmrj7/docs/atlas-prd-site-evaluation-coverage.md) (`claude/site-eval-tool-coverage-gnmrj7`)
**Owner:** Vikram / Spi3l

---

## How to read this plan

This is a **build sequence**, not a calendar. Each sprint is one self-contained unit of Claude Code work — scoped so it can be implemented, tested, and merged in a single focused session without leaving the codebase in a half-finished state. There are no story points or dates; "depends on" is the only scheduling constraint that matters. Sprints within a phase are ordered; sprints across phases marked independent can run in any order or in parallel once their phase's prerequisites land.

Two hard sequencing rules carried over from the PRD (§5):

1. **Phase 1 must fully land before Phase 2 starts.** Building page discovery before the score stops lying about coverage means coverage rises while the report still misrepresents it — no honest before/after measurement.
2. **Phase 3 is independent of Phases 2 and 4** and can be built in parallel with either, at any point after Phase 1.

Phase 4 is the PRD's own "roadmap, sized not specified" section (§11). It's sprint-planned here in the same shape as the rest, but each sprint should be re-scoped against the codebase at the time it's picked up — more time will have passed and assumptions may have drifted.

---

## Dependency graph

```
Phase 1 (Sprints 1-6, strictly ordered)
  1 → 2 → 3 → 4 → 5 → 6
                          \
                           ├── Phase 2 (Sprints 7-9, ordered)   7 → 8 → 9
                           └── Phase 3 (Sprints 10-13, any order, parallelizable)

Phase 4 (Sprints 14-21) — each depends on Phase 1 (consent_capture / coverage data);
  14 also unblocks 18's cmp wiring. Otherwise independent of each other.
```

---

## Phase 1 — Honest scoring

*Closes Gap A (partial), Gap B, Gap C, and defects #1 and #7. Ships on its own — the score stops lying with zero new crawling.*

### Sprint 1 — Step coverage data model + recording

**Depends on:** none (starting point)

**Scope**
- `backend/src/types/audit.ts`: add `StepUrlSource`, `StepCoverage`, `AuditData.step_coverage?`.
- `frontend/src/types/audit.ts`: mirror the same types (per the file's own header comment — it's a mirror, not a separate source of truth).
- `backend/src/services/audit/journeySimulator.ts`:
  - Resolve and record each step's URL provenance into `StepCoverage` (source is only ever `user_supplied` or `fallback_landing` in this phase — Phase 2 populates the rest).
  - `distinct_from_landing` computed on a normalised comparison (lowercase origin + pathname, trailing slash stripped, hash/query removed, `final_url` preferred over `requested_url` when a redirect occurred).
  - Wrap the step-loop body (`journeySimulator.ts:222-325`) in try/catch mirroring `stageSimulator.ts:139-165` — a failed step records `navigation_success: false` + `error` and `continue`s rather than aborting the run.
  - Explicit per-step navigation timeout: 20s networkidle, 10s domcontentloaded fallback.

**Acceptance criteria**
- `services/audit/__tests__/pipeline.test.ts` (which already pins step counts at `:259,272`) extended, not rewritten, to assert `step_coverage` is populated correctly for a homepage-only run and a distinct-URL run.
- New test: a run whose `confirmation` step 404s still completes with the other three steps successful (defect #1's fix, directly testable).
- URL-normalisation unit tests: trailing slash, hash, injected synthetic query params, protocol-relative URLs.

---

### Sprint 2 — L0.3 rewrite (`CONVERSION_SURFACE_IDENTIFIED`)

**Depends on:** Sprint 1 (`step_coverage` must exist)

**Scope**
- `backend/src/services/validation/register/L0.ts`: rewrite the rule to compare `step_coverage` URLs instead of step labels.
  - Pass: at least one non-landing step has `distinct_from_landing && navigation_success`.
  - Fail: `step_coverage` present and no step qualifies; evidence keeps the "unanchored" wording and lists which steps fell back.
  - Fallback: retain the current label-based logic **only** when `step_coverage` is absent (Journey-Builder mode, replayed historical `AuditData`).

**Acceptance criteria**
- L0.3 truth table test: all-fallback → fail; one-distinct → pass; redirect-to-homepage → fail; missing `step_coverage` → falls back to label logic and behaves as today.
- This is the PRD's single highest-leverage change (§6.2) and its own success metric (§14): "Zero audits where `L0.3 = pass` while `pages_distinct == 1`" should be assertable as a test here, not just monitored later.

---

### Sprint 3 — Precondition engine + L4-L7 tagging

**Depends on:** Sprint 1

**Scope**
- `backend/src/types/audit.ts`: add `RulePrecondition` and `ValidationRule.requires?`.
- `backend/src/services/validation/register/engine.ts`: evaluate preconditions in `runRegister()`, after the existing applicability filter and before `rule.test()`. Unmet precondition → `status: 'skipped'` with the evidence shape specified in PRD §6.3 (do not invent a new status — `scoring.ts`'s `scored()` already excludes `skipped` from every denominator).
- Tag `requires: ['conversion_surface']` on all of L5, L6, L7, and L4.3/L4.4. Do **not** tag L4.1/L4.2 (answerable from landing-page links alone).

**Acceptance criteria**
- Unit test: an untested L6 rule lands `skipped`, and `calculateV2Scores` denominators drop accordingly (no separate scoring-code change should be needed — this test is what proves that).
- Integration test extension on `pipeline.test.ts`: homepage-only ecommerce run yields `pages_distinct: 1`, L0.3 `fail`, ~42 `skipped` results; four-distinct-URL run yields L0.3 `pass` and zero precondition skips.
- No test-body changes to any L4-L7 rule file — `requires` tags only, verified by diff review.

---

### Sprint 4 — Consent banner handling

**Depends on:** Sprint 1 (needs the step loop's landing-step hook point; independent of Sprints 2-3)

**Scope**
- New `backend/src/services/detection/consentBanner.ts`: `CMP_SELECTORS`/`CMP_TEXT_MATCHERS` moved verbatim from `publicAuditRunner.ts:122-171`; export `detectConsentBanner(page)` and `dismissConsentBanner(page, opts)`.
- Refactor `backend/src/services/publicAudit/publicAuditRunner.ts` to import from the new module instead of keeping its own copy — this is a required step, not optional cleanup, or the two paths drift again.
- `journeySimulator.ts`: on the landing step only, after `waitForSelector` and before step actions — snapshot pre-consent state (flush dataLayer + network/cookies), try the declared `cmp` selector first then the full list, dismiss, settle 3500ms (matching `publicAuditRunner.ts:232-235`), continue.
- `backend/src/types/audit.ts` (+ frontend mirror): `AuditData.consent_capture?` per the PRD §6.5 shape (`banner_present`, `vendor`, `dismissed`, `declared_cmp`, `tags_before`, `tags_after`).
- Confirm the PRD's stated default: **accept** consent (§6.5, §15.1). This is a product decision the PRD already made explicitly for this build — flag to the user only if evidence during implementation suggests otherwise.

**Acceptance criteria**
- Unit tests on `consentBanner.ts` in isolation (selector matching, text matching, vendor priority when `cmp` is declared).
- E2E (can be deferred to a manual pass, not blocking merge): run against a live Cookiebot or OneTrust storefront, confirm `tags_before ⊂ tags_after`.
- `publicAuditRunner.ts` behavior unchanged after the refactor — its own existing tests must still pass.

---

### Sprint 5 — Report coverage surfacing

**Depends on:** Sprints 1-4 (needs `step_coverage`, skipped-rule data, and `consent_capture` to render something real)

**Scope**
- `backend/src/types/audit.ts`: `ReportJSON.executive_summary.coverage?` per the PRD §6.4 shape (`pages_requested`, `pages_distinct`, `steps`, `layers_not_tested`, `rules_tested`, `rules_not_tested`).
- Populate it wherever `ReportJSON` is assembled from `AuditData` + register results.
- `frontend/src/components/audit/ExecutiveSummary.tsx`: coverage banner, shown only when `pages_distinct < pages_requested`, plain wording per PRD example copy.
- `backend/src/services/export/pdfGenerator.ts`: `Scan Coverage` PDF section, placed directly after `Scores at a Glance`.
- Per CLAUDE.md rule 12 (no fabricated UI data): both the banner and the PDF section render only from real `step_coverage` data and are omitted entirely when `coverage` is absent (old audits, Journey-Builder mode).

**Acceptance criteria**
- Frontend renders correctly for: full coverage (banner absent), partial coverage (banner present with correct copy), and legacy audits with no `coverage` field (section omitted, no crash).
- PDF generation smoke test with and without `coverage` present.

---

### Sprint 6 — Scheduled re-scans routed through v2

**Depends on:** none within Phase 1 strictly, but should land last since it closes out Phase 1's defect list (§6.7) and touches the regression comparator that Phase 2 will also need (§9's `coverage_fingerprint` builds on this)

**Scope**
- `backend/src/services/queue/worker.ts:166-175`: persist the originating audit's v2 Scan Inputs on the schedule and pass them through `createAudit` + `auditQueue.add`, so a scheduled re-run of a v2 audit is scored by the v2 engine, not v1.
- Regression comparator (`worker.ts:40-86`): skip the regression alert when the two runs' `rule_set_version` differ (the `coverage_fingerprint` half of this guard lands in Sprint 9 — this sprint only needs the `rule_set_version` check to close defect #7).
- Likely needs a small schema addition to persist Scan Inputs on the schedule record — check the existing scheduled-audit table structure before assuming a new column vs. reusing an existing JSONB field.

**Acceptance criteria**
- Test: a schedule created from a v2 audit produces a v2-scored re-run.
- Test: regression comparator does not fire when `rule_set_version` differs between the compared runs.
- **Phase 1 exit check:** re-score a stored historical `AuditData` fixture through the new engine and diff the result — the score is expected to move (denominator changed), and the diff must be explainable line by line. This is the PRD's own regression-guard test (§13) and doubles as the go/no-go gate before starting Phase 2.

---

## Phase 2 — Page discovery

*Closes Gap A. Raises coverage; only meaningful because Phase 1 makes it measurable.*

### Sprint 7 — `stepUrlResolver.ts`

**Depends on:** Phase 1 complete (Sprint 6)

**Scope**
- New `backend/src/services/audit/stepUrlResolver.ts` implementing the four strategies in cheapest-first order, short-circuiting once every step key is filled:
  1. `robots.txt` → `Sitemap:` directives.
  2. `sitemap.xml` (+ one level of sitemap-index recursion).
  3. Landing-page same-origin link harvest (reuse the DOM-read pattern at `journeySimulator.ts:268-271`).
  4. Path heuristics — reuse `crawl/pageDiscovery.ts:64-72`'s existing list rather than defining a second one; verify each candidate with a HEAD request before accepting.
- Candidate scoring: keyword table per funnel step key (PRD §7 examples: `product` ← `/product`,`/p/`,`/shop`,`/item`; `checkout` ← `/checkout`,`/cart`,`/basket`). Highest-scoring same-origin candidate wins; ties break on shortest path.
- Every candidate passes the existing SSRF validator (`utils/urlValidator.ts`) before any fetch — this is non-negotiable, same code path protecting `POST /start`.
- Hard budget: max 25 HTTP fetches, max 15s wall clock for the whole resolver. On exhaustion, return what was found; unresolved keys stay `fallback_landing`.
- Same-origin only, except an explicitly declared `product_domain`/`checkout_domain`.
- Per PRD §15.6 (open question, resolved in-spec): the resolver must only fill **gaps** in a partially-filled Advanced form — never override a user-supplied URL, quick-card or advanced.

**Acceptance criteria**
- Fully unit-testable without a browser — mock the HTTP layer per PRD §12 item 8.
- Fixture tests: sitemap with all step keys resolvable; sitemap-index recursion; robots.txt pointing to sitemap; link-harvest fallback when no sitemap exists; path-heuristic fallback when neither exists; budget exhaustion returns partial results without hanging.
- Negative test: a cross-origin candidate is never selected even if it scores highest, unless it matches a declared `product_domain`/`checkout_domain`.
- Negative test: SSRF validator rejection is respected — a candidate that fails validation is never fetched.

---

### Sprint 8 — Orchestrator wiring

**Depends on:** Sprint 7

**Scope**
- `backend/src/services/audit/orchestrator.ts`: call the resolver before `simulateJourney`, filling `url_map` gaps only.
- Thread the resolved `StepUrlSource` (`sitemap`, `nav_link`, `heuristic`, in addition to Phase 1's `user_supplied`/`fallback_landing`) into `StepCoverage.source`.
- Coverage section (Sprint 5's banner/PDF) should now render real source labels like *"checkout — found via sitemap"* vs *"confirmation — not found"* with no further frontend changes needed, since it already reads `StepCoverage.source`.

**Acceptance criteria**
- Integration test: a bare-URL ecommerce run against a fixture site with a sitemap resolves `product` and `checkout` to distinct URLs; `confirmation` correctly stays `fallback_landing` (no real transaction available) and downstream L5-L7 rules skip via Phase 1's precondition gate, not fail.
- E2E (manual, non-blocking): run against a real ecommerce site from a bare URL, confirm `product`/`checkout` resolve.

---

### Sprint 9 — Coverage migration + regression suppression

**Depends on:** Sprint 8

**Scope**
- New migration `supabase/migrations/<ts>_audit_coverage.sql`: `audits.coverage_fingerprint TEXT`, `audits.pages_distinct INT`, both `ADD COLUMN IF NOT EXISTS`, wrapped in the `DO $$ IF EXISTS ... END $$` guard per CLAUDE.md rule 9. Check the existing `audits` table's `org_id` vs `organization_id` convention before writing the migration — per CLAUDE.md rule 10, do not assume.
- `coverage_fingerprint`: stable hash of the sorted set of normalised URLs actually visited.
- `worker.ts:40-86` regression comparator: extend Sprint 6's `rule_set_version` guard to also suppress the alert when `coverage_fingerprint` differs between the compared runs — otherwise Phase 2 fires false "score dropped 15 points" alerts across the estate the moment discovery starts finding real checkout pages that were previously scored as homepages.
- Same migration (or a companion one) persists the v2 Scan Inputs on scheduled audits if Sprint 6 didn't already fully close that gap.

**Acceptance criteria**
- Migration applies cleanly against a Supabase preview environment (guard survives a missing-table scenario).
- `pages_distinct` is queryable directly — this is what makes PRD success metric §14 ("share of quick scans resolving ≥2 distinct pages") a one-line query instead of requiring a report-blob unpack.
- Test: regression alert suppressed when `coverage_fingerprint` changes between two runs of the same schedule, fires normally when it's stable and the score actually regressed.

---

## Phase 3 — Reliability & detection fixes

*Independent of Phase 2. Can start any time after Phase 1 lands; sprints within this phase can also run in any order relative to each other.*

### Sprint 10 — Queue timeout + UA override removal

**Depends on:** none beyond Phase 1

**Scope**
- `backend/src/services/queue/jobQueue.ts:90-95`: add `timeout: 8 * 60 * 1000` to `auditQueue` (8 minutes covers 4 steps × (20s nav + settle) plus Phase 2's 15s resolver with headroom). Correct the stale "5 min for audits" comment at `:117`.
- Delete the forced Linux Chrome UA override at `journeySimulator.ts:196-197` and `stageSimulator.ts:82-83` — per the reasoning already documented at `planning/pageCaptureService.ts:59-61` (it fights Browserbase's own stealth fingerprint).

**Acceptance criteria**
- Config test asserting the queue timeout value.
- Manual/smoke check that Browserbase sessions still identify with a coherent fingerprint post-removal (no mixed Linux-UA + Windows-stealth signals in captured request headers).

---

### Sprint 11 — Tracked-host fix + invariant test

**Depends on:** none beyond Phase 1

**Scope**
- `backend/src/services/audit/dataCapture.ts:10-27` (`TRACKED_URL_PATTERNS`): add `alb.reddit.com`, `ct.pinterest.com`, `s.pinimg.com/ct/core.js`, `px.ads.linkedin.com`.
- Factor the matcher host strings out of `register/platformDetection.ts:28-38` into a shared constant both `dataCapture.ts` and `platformDetection.ts` consume, so they can't drift apart again.
- Export `shouldCaptureUrl` from `dataCapture.ts` for the invariant test.
- Add the invariant test itself (the important half of this sprint, per PRD §8.3):
  ```ts
  it.each(ALL_DECLARED_PLATFORMS)('%s tag requests are captured', (platform) => {
    for (const host of MATCHER_HOSTS[platform]) {
      expect(shouldCaptureUrl(`https://${host}/whatever`)).toBe(true);
    }
  });
  ```

**Acceptance criteria**
- Invariant test passes for all currently-declared platforms including Reddit, Pinterest, LinkedIn.
- This test is the actual deliverable — it's what prevents this exact defect class (a declared platform matcher with no corresponding capture pattern) from recurring, per PRD success metric §14 ("Platforms declared but structurally undetectable: 2 today → 0").

---

### Sprint 12 — L2 three-tier capture matching

**Depends on:** none beyond Phase 1

**Scope**
- `backend/src/services/validation/register/L2.ts:42-51`: replace the exact-key/exact-value check with the three-tier result specified in PRD §8.4:
  1. Exact key + exact value → pass.
  2. Value found under a differently-named key (any storage/cookie/dataLayer key whose value equals the synthetic value), or one level of JSON-parsing a string value → pass, with the actual key name in evidence.
  3. Not found → fail (unchanged).
- Match on the synthetic *value* (unique per run, `test_gclid_${ts}`), never the key name — this is what makes tier 2 safe from accidental false positives.

**Acceptance criteria**
- Unit tests: exact match (tier 1); renamed key e.g. `_atlas_gclid` (tier 2); value nested inside a JSON-stringified blob (tier 2); genuinely absent value (tier 3/fail).
- Negative test proving tier 2 cannot false-positive — e.g. two different synthetic values present, matcher doesn't cross-match them.

---

### Sprint 13 — Scroll on all steps

**Depends on:** none beyond Phase 1

**Scope**
- `backend/src/services/browserbase/journeyConfigs.ts:20-93`: add `{ type: 'scroll_bottom' }, { type: 'wait', ms: 500 }` to every step in all three templates, not just the ecommerce `product` step.

**Acceptance criteria**
- Template snapshot/config test confirming scroll+wait is present on every step across all three templates.
- Manual check on a lazy-load-heavy fixture page: a below-fold tag that was previously missed on a non-`product` step now fires.

---

## Phase 4 — Coverage expansion

*Roadmap-scale per the PRD (§11) — sized, not fully specified. Each sprint here should be re-validated against the codebase when picked up, since more time will have passed since this plan was written. All depend on Phase 1's `consent_capture` and coverage data existing; otherwise independent of each other unless noted.*

### Sprint 14 — L8 consent (register layer)

**Depends on:** Phase 1 Sprint 4 (`consent_capture`)

**Scope**
- Author the first scored rules for the currently-empty L8 `consent` layer, reading `AuditData.consent_capture` (banner presence, vendor detection accuracy, `tags_before`/`tags_after` delta as a proxy for consent-gating correctness).
- This is called out in the PRD (§11) as the highest-value Phase 4 item specifically because its data dependency already exists after Phase 1 — no new capture work needed, only rule authorship + scoring integration.

**Acceptance criteria**
- New L8 rule files following the existing L0-L7 register pattern (applicability filter, `requires` tags where relevant, test bodies).
- Unit tests per new rule; register engine test confirming L8 rules now execute (currently zero rules ship, per PRD §1.2 defect #8).

---

### Sprint 15 — L9 server-side delivery (register layer)

**Depends on:** Phase 1

**Scope**
- Promote the existing `siteSetupDetector.ts:78-141` sGTM heuristic from informational to scored rules under L9.
- Reuse rather than re-derive the sGTM detection logic already shipped for DQM (`services/dqm/sgtmProbe.ts`) where applicable — check for overlap before writing new detection code.

**Acceptance criteria**
- New L9 rule files + tests.
- No duplicate sGTM-detection logic introduced where the DQM module's already covers the case.

---

### Sprint 16 — L10 deduplication (register layer)

**Depends on:** Phase 1

**Scope**
- Author L10 rules correlating `event_id` across client-side and server-side hits, overlapping with `services/capi/dedupStore.ts`.
- Needs the audit engine to have visibility into whether a corresponding server-side (CAPI) event exists for a captured client-side event — check whether this cross-reference is feasible from audit-time data alone or requires a new data source before committing to rule design.

**Acceptance criteria**
- New L10 rule files + tests.
- Explicit test/fixture proving `event_id` correlation logic against both a deduplicated and a non-deduplicated fixture pair.

---

### Sprint 17 — L11 reconciliation (register layer)

**Depends on:** Phase 1; **also depends on Platform Reconciliation feature surfaces** (largest item in Phase 4 per PRD §11 — needs platform connectors, not crawl data)

**Scope**
- This is explicitly flagged in the PRD as belonging with Platform Reconciliation rather than the crawl engine. Before starting, confirm scope with whoever owns the Platform Reconciliation feature area (`backend/src/services/reconciliation/`) — this sprint may need to be re-split or handed off rather than implemented as originally scoped here.

**Acceptance criteria**
- Scoping note/design doc produced first if the cross-feature dependency turns out to be nontrivial, before any rule code is written.
- If scoped as originally planned: new L11 rule files + tests reading reconciliation findings for the audited client.

---

### Sprint 18 — Wire the unused Scan Inputs

**Depends on:** Phase 1; benefits from Sprint 14 (L8) for the `cmp` half, but not blocked by it

**Scope**
- `cmp` → already load-bearing after Phase 1 Sprint 4 and Sprint 14; confirm no further wiring needed.
- `checkout_domain` → navigate as `product_domain` already does (check how `product_domain` is currently threaded through and mirror it).
- `additional_properties` → additional origins for the resolver/capture logic to consider.
- `test_email`/`test_phone` → real form fill on `lead_gen` template, using the `fill`/`click` step actions already implemented at `journeySimulator.ts:257-261` but currently used by no template.

**Acceptance criteria**
- Each of the four previously-dead Scan Inputs has a test proving it now affects behavior (e.g. a `lead_gen` run with `test_email` set actually fills a form field).
- No regression to templates that don't declare these inputs.

---

### Sprint 19 — Mobile viewport pass

**Depends on:** Phase 1

**Scope**
- **Cost-model first, build second** — per PRD §11, this doubles Browserbase minutes. Before writing any capture code, model the cost against `usageLogger`'s `page_scan` events and plan a gating strategy (e.g. plan-tier gated, or opt-in rather than default-on).
- Only after cost/gating is agreed: add a second capture pass at a mobile viewport size, threaded through the existing capture pipeline.

**Acceptance criteria**
- A cost-model note/estimate exists and is reviewed before implementation starts.
- Mobile capture reuses the existing `dataCapture.ts` pipeline rather than forking it.
- Gating mechanism (plan tier, opt-in flag, or similar) has a test proving it's actually enforced.

---

### Sprint 20 — iframe + shadow DOM traversal

**Depends on:** Phase 1

**Scope**
- `page.frames()` iteration in the two existing DOM-read call sites, plus shadow-root piercing.
- Unblocks hosted checkout widgets (Stripe, Shopify) that are currently wholly invisible to the capture layer.

**Acceptance criteria**
- Fixture test: a page embedding a same-origin-policy-compliant iframe with a tag fires correctly captures that tag.
- Fixture test: a shadow-DOM-encapsulated form element is discoverable by the existing DOM-read logic.
- No performance regression on pages with zero iframes/shadow roots (traversal should short-circuit cheaply).

---

### Sprint 21 — Per-site-type templates

**Depends on:** Phase 1 (and ideally Phase 2, since richer templates benefit most from discovery filling more step keys)

**Scope**
- `backend/src/api/routes/audits.ts:64-71`: give `marketplace`, `app_install`, `subscription_media` their own step-key shapes instead of borrowing from the three existing templates.

**Acceptance criteria**
- Three new/extended template definitions in `journeyConfigs.ts`.
- Existing `pipeline.test.ts` step-count assertions extended to cover the new templates without breaking the existing three.

---

## Cross-cutting test plan (applies across all phases)

Carried directly from PRD §13 — call out explicitly since it spans sprint boundaries:

- **Unit:** L0.3 truth table; precondition gating; URL normalisation; L2 three-tier matcher (incl. negative case); resolver scoring against fixture sitemaps/link sets.
- **Invariant:** every host in `PLATFORM_MATCHERS` passes `shouldCaptureUrl` (Sprint 11).
- **Integration:** `pipeline.test.ts` extended for homepage-only vs. distinct-URL runs, and for a single-bad-step-URL run that still completes (Sprints 1, 3).
- **End-to-end (manual, non-blocking for merge):** live consent-gated site run (Sprint 4); real ecommerce site from a bare URL (Sprint 8).
- **Regression guard:** re-score a stored historical `AuditData` fixture through the new engine, diff must be explainable line by line (Sprint 6 exit check).

## Success metrics to track post-rollout (PRD §14)

| Metric | Baseline | Target | Landed by |
|---|---|---|---|
| Audits where `L0.3 = pass` while `pages_distinct == 1` | present (the core defect) | zero, assertable in test | Sprint 2 |
| Quick scans resolving ≥2 distinct pages | 0% | ≥70% | Sprint 8-9 |
| Runs failing wholly on one bad step URL | current baseline | ~0 | Sprint 1 |
| Platforms declared but structurally undetectable | 2 (Reddit, Pinterest) | 0 | Sprint 11 |
| Skipped-for-precondition rules visible in every applicable report | no | yes, always | Sprint 3, 5 |

## Open decisions carried forward from the PRD

These are specified with a stated default in the PRD, not blocking, but worth re-confirming at the sprint they land in rather than assuming silently:

- **§15.1 / §13.1 — accept-consent as default.** Sprint 4 implements "accept" per the PRD's explicit choice (L1-L7 are written against intended configuration). Revisit only if implementation surfaces a reason the assumption doesn't hold.
- **§15.6 — discovery fills gaps only, never overrides user input, including in the Advanced form.** Specified as in-scope behavior for Sprint 7; called out there as a hard constraint, not a nice-to-have.
- **§15.3 — discovery may pick the wrong page.** Sprint 7's minimum-candidate-score threshold (below which a key stays unresolved) is the mitigation; tune it empirically once Sprint 8's E2E pass runs against real sites.
