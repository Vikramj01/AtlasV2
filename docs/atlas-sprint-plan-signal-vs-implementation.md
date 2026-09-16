# Sprint Plan · Signal vs Implementation Separation (Report Integrity + Provenance)

**Source** · PRD "Atlas Signal Health Platform — Signal vs implementation separation" (draft 0.1, 16 Sept 2026), triggered by audit `49448510-d968-4178-98e2-8e7c70998276` (pureborn.com/en-uae). Not yet issued to the client — P0 fixes are a re-run, not a retraction.

**Status** · P0 (Sprints 1-5) shipped 2026-09-16 on `claude/optimistic-turing-embehd`. P1 (provenance architecture, Sprints 6-12) is scoped but not started. The "One product decision" flagged below was resolved by the user: keep the existing broad `conversion_surface` definition — see the resolved section.

**Related, already-shipped prior work** (read before touching the register or reporting layer) · `docs/ATLAS_REPORT_CORRECTNESS_PROGRAMME_PRD.md`, `docs/ATLAS_CLICKID_CONTENTION_CONTRADICTION_GUARD_PRD.md`, `docs/atlas-sprint-plan-pre-connection-confidence-tiering.md` (evidence_class / verdict lattice / severity ceilings — P0-03 and P0-04 build directly on this). **Not the same work as** `docs/ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` — that's a separate, earlier PRD about PDF-rendering truncation on a different reference audit (openart.ai, 5 Sept); its defects (evidence truncated to 3 items, remediation cut at 117 chars, page numbering) are unrelated to this one and already largely shipped. Do not conflate the two.

---

## Resolved: the PRD's open questions (§10)

Queried the trigger audit directly (Supabase project `hzgiqddvilbtlwkamshp`, `audits.id = 49448510-...`) rather than leave these as assumptions:

1. **Were Google Ads/TikTok declared, or assumed?** Declared. `declared_platforms = ['google_ads','meta','tiktok']`. The PRD's commercial argument (unmeasured Google Ads/TikTok spend) rests on a real client declaration, not an inference — strengthens P0-05's revised Business Summary.

2. **Does an external technology-detection pass already feed Atlas reports?** No — confirmed by exhaustive grep of `backend/src`. The only commerce-platform detector in the repo is `siteDetectionService.ts` (AI Planning Mode's static-HTML detector), entirely unwired from the audit/register pipeline. P1-03 is a genuine build, as the PRD assumed — but it can reuse that module's existing Shopify/WooCommerce heuristics instead of starting from zero.

3. **Is pureborn.com/en-uae the same store as pureborn.us, under Shopify Markets?** Partially, and the real answer changes P1-04's risk. This audit's own stored report shows pureborn.com/en-uae served by a **Next.js frontend** (`/_next/image?url=...`) proxying product imagery from `cdn.shopify.com` — a **headless/composable storefront using Shopify as a backend**, not a classic Shopify Online Store theme. Shopify's Web Pixels Manager sandbox (P1-04's target) is injected by Shopify's own theme/checkout runtime; a decoupled Next.js frontend may not receive it the same way, and checkout may live on a separate, Shopify-hosted domain entirely — consistent with this audit's `checkout_domain` Scan Input being unset and its "checkout" step falling back to a heuristic guess that just re-resolved to the product page. **P1-04a's spike is widened accordingly** (see below).

Also found, not asked but worth a note: `audits.declaration_source` is **NULL** on this audit row. Per CLAUDE.md, that field is wired for public no-login audits (`INFERRED_FROM_SITE`) but appears never set on authenticated audits like this one — it feeds `DECLARED_PLATFORM_HAS_TAG`'s severity ceiling (Confidence Tiering Sprint 2). Worth a follow-up ticket; out of scope here.

---

## Corrections to the PRD (found while grounding it against the tree)

**1. P0-02's defect is narrower than described.** The PRD says "assessed, not applicable and not assessed do not visibly sum to thirteen anywhere in the document." They already do, in the data: `classifyUntestedLayers()` (`backend/src/services/reporting/coverage.ts:107-145`) iterates the fixed `ALL_V2_LAYERS` (13) and classifies every layer not fully scanned into `not_applicable`/`not_scanned` with a reason — confirmed live on the trigger audit's own stored report (`layers_not_tested` lists all 6 excluded layers by name and reason; the other 7 are implicitly assessed, matching `rules_tested: 79` across "seven named layers" per the PRD's own appendix). What's actually missing is (a) an explicit **build-time assertion** enforcing the 13-way sum, and (b) that this reconciliation isn't **rendered** anywhere a reader can see it — `ExecutiveSummary.tsx:48-113` shows a bare count plus two comma-joined name lists, not a full 13-row table. Scope narrows accordingly.

**2. P0-01's root cause is one specific, well-isolated bug**, not a systemic "applicability decided before the crawl" problem. `isRuleApplicable()` (declared-config-only, pre-crawl) is the correct, intentional first filter and isn't being asked to change. The actual defect is in `classifyUntestedLayers()` (`coverage.ts:134-142`): when a layer's rules ARE applicable (Consent's rules all have `applies_to: 'all'`) but every one self-skipped for a genuine, evidence-based reason recorded in its own `technical_details.found` (e.g. L8.1's `"No CMP declared and no EEA/UK/Switzerland traffic declared — a consent banner is not expected"`), the layer rollup **discards that real reason** and substitutes a canned generic string, then labels the state `not_applicable`. Confirmed live: the trigger audit's stored report shows exactly this generic string for Consent, even though `consent_capture` was populated with real `consent(default)` evidence. Smaller, more surgical fix than "redesign applicability."

**3. P0-03's gating mechanism mostly already exists** (Pre-Connection Scan Confidence Tiering PRD, shipped). `GOOGLE_ADS_CONVERSION_EVENT_FIRES`/`META_.../TIKTOK_...` (`L5.ts:60,122`) already carry `requires: ['conversion_surface']`, and `deriveConfidence()`/`deriveVerdict()` (`engine.ts:161-244`) already demote an unverified-surface FAIL to `verdict: 'NOT_OBSERVED'` at `PARTIAL` confidence — which `scoring.ts`'s `isScorable()` and `generator.ts`'s `isConfidentFinding()` (Confidence Tiering Sprint 8) already correctly exclude from scores and from the Issues/Action Items list. **The actual bug is narrower**: `generateBusinessSummary()`/`determineOverallStatus()` in `backend/src/services/interpretation/engine.ts:765-791` read the raw `status` field (`'fail'`) instead of the already-computed `verdict`, so they alone still count these three findings toward the "5 critical issues" framing. Fix is localized to those two functions switching their filter from `status` to `verdict`/`observation_confidence` — reusing the lattice, not rebuilding it.

**4. The `CONVERSION_SURFACE_IDENTIFIED` (L0.3) contradiction has a specific mechanism.** `conversionSurfaceReached()` (`L0.ts:231-243`) passes on **any** step distinct from landing and verified — it doesn't require the *confirmation* step specifically. On this audit, the "product" step (sitemap-sourced, verified) alone passes L0.3, even though the "confirmation" step itself resolved (via `stepUrlResolver.ts`'s sitemap strategy) to an unrelated blog article, not a real order-confirmation page. The narrative elsewhere says "confirmation could not be confirmed" — a claim about the confirmation step specifically — while L0.3's actual claim is broader. Two different claims sharing a label. Needs one product decision before Sprint 1 (below).

**5. P0-04 is not a drop-in reuse of the `SERVER_CONTAINER_ENDPOINT_CONFIGURED` precedent**, though the PRD implies it is. `L1.14` solves a narrower problem (never assert FAIL from a client-side-invisible mechanism) via `evidence_class: 'INFERRED'`, which blanket-suppresses FAIL unconditionally. The PRD's ask for `GTM_CONTAINER_LOADED` is genuinely conditional — severity depends on whether other independent paths were observed, and whether any declared platform's own signal is missing — which needs new logic inside the rule's `test()`, not an `evidence_class` relabel. Sized accordingly in Sprint 3.

## Product decision — resolved

**What does "conversion surface verified" mean: any post-landing page, or the confirmation/order page specifically?** **Decided: keep the existing broad definition** (`conversionSurfaceReached()` — any page distinct from landing, verified). No new `confirmation_surface` precondition. The contradiction P0-03 names is resolved through wording, not new rule semantics: L0.3 ("surface identified") and the conversion-fires rules' "Needs confirmation" status ("surface not verified to the standard those specific event claims need") are both true at once — `deriveConfidence()` already independently flags a rule's confidence as `'confirm'` whenever *any* qualifying distinct step is heuristic-sourced or degraded (true here — the "checkout" step is heuristic), regardless of whether L0.3 itself passed on a different, verified step. The fix is Sprint 1.3 below: make the client-facing copy say "identified" and "verified" as two distinct claims instead of letting one imply the other.

---

## Already shipped — do not rebuild

| Item | State | Evidence |
|---|---|---|
| Evidence-class / verdict lattice / severity ceilings | Done | `engine.ts:161-264`, Pre-Connection Confidence Tiering PRD |
| `could_not_be_assessed` / `UnassessableFinding` mechanism | Done, reusable as-is | `types/audit.ts:1165-1174`, `clickIdContention.ts:52-55` |
| Action Items / Issues list excludes NOT_OBSERVED findings | Done | `generator.ts`'s `isConfidentFinding()` (Confidence Tiering Sprint 8) |
| Coverage gate / score withholding | Done | `scoring.ts`, `score_withheld_reason` |
| Per-layer not_applicable/not_scanned classification (data model) | Done, rendering incomplete | `coverage.ts:107-145` |
| `SERVER_CONTAINER_ENDPOINT_CONFIGURED` never-FAIL precedent | Done, not directly reusable for P0-04 | `L1.ts:643-680` |

---

## P0 — blocks sending the PureBorn report

**All 5 sprints below shipped 2026-09-16.** Implementation notes and deviations from this plan are appended to each sprint's acceptance line.

### Sprint 1 · P0-01 + P0-03 · Evidence-gated layer applicability, conversion-surface gating, contradiction fix — shipped

Ship together — P0-03's `confirmation_surface` precondition needs P0-01's Consent fix validated in the same re-run, and both touch `coverage.ts`/`engine.ts` in one review pass.

- **1.1 — `classifyUntestedLayers()` reason fix** (`coverage.ts:134-142`). Replace the generic fallback reason with the actual skip reason(s) drawn from that layer's own skipped results' `technical_details.found` — when every rule in a layer skipped for the same reason, surface it verbatim; when they differ, list each distinct reason. Re-audit the six current PureBorn exclusions (Cross-Domain Continuity, Parameter Completeness, Consent, Server-Side Delivery, Deduplication, Reconciliation) against this fix — Reconciliation stays `not_applicable`/"Not yet built" (already correctly distinct); the rest should now surface their real per-rule reasons instead of the canned string.
- **1.2 — Consent specifically.** Confirm whether L8's actual behavior (rules skip on undeclared CMP + no regulated traffic, independent of whether `consent(default)` fired) is intended, or whether observed Consent Mode defaults should themselves make the layer "assessed." Recommend keeping L8's existing skip logic (it's evidence-based, just poorly surfaced) and relying on 1.1's reason fix — this satisfies the PRD's acceptance criterion without changing rule semantics, but confirm with product before treating it as settled.
- **1.3 — Narrative wording fix** (per the resolved product decision above — broad definition kept, no new precondition). Correct L0.3's `client_question` and any "could not confirm your conversion page" copy so "surface identified" (L0.3's actual claim) and "surface verified" (what the Needs-confirmation conversion-fires rules actually need) read as two distinct, compatible claims rather than a contradiction.
- **1.4 — Business Summary / overall-status verdict fix** (`interpretation/engine.ts:765-791`). Switch `generateBusinessSummary()` and `determineOverallStatus()` from filtering on raw `status` to filtering on `verdict`/`observation_confidence`, matching `generator.ts`'s existing `isConfidentFinding()` pattern. Removes the three Needs-confirmation conversion-fires findings from the critical count and the Business Summary.
- **1.5 — Questions for Your Team dedup.** Verify the existing `client_question` copy on the confirmation-dependent rules is the only place the unverified-surface issue surfaces (likely already true via `collectClientQuestions()`) — confirm rather than rebuild.

**Acceptance** · PureBorn re-run shows Consent's real skip reason (not the canned string); the three conversion-event rules read Needs-confirmation and are absent from the critical count and Business Summary; L0.3's narrative no longer contradicts the confirmation-surface finding.

**Shipped, with one deviation found against real data:** 1.1's fix (`evidenceBasedSkipReason()`, `coverage.ts`) originally required every skipped rule in a layer to agree on one reason, falling back to the generic string otherwise. Replaying the actual trigger audit (Sprint 5's fixture) showed Consent's own three rules skip for *two different* real reasons (L8.1 on the CMP/region declaration, L8.2/L8.3 on the banner itself being absent) — so "require agreement" reproduced the exact same generic string as the original bug. Fixed to join every distinct real reason instead (never silently drops to the canned string as long as at least one rule wrote a real reason). 1.2 kept L8's existing skip semantics, unchanged, per the recommendation. 1.3 landed in `openQuestions.ts` — the bespoke unverified-conversion-surface question now names the specific unverified step(s) (e.g. "checkout") instead of a blanket "your order confirmation page" claim. 1.4 landed in `interpretation/engine.ts`. 1.5 confirmed, not rebuilt. Tests: `coverage.test.ts`, `openQuestions.test.ts`, `interpretation/engine.test.ts`.

### Sprint 2 · P0-02 · Coverage arithmetic assertion + full-layer rendering — shipped

- Add a build-time/test-time assertion in `coverage.ts` (or a dedicated test) that `assessed.length + notTested.length === 13` (`ALL_V2_LAYERS.length`) for every run — fail loudly if it doesn't.
- Extend `ExecutiveSummary.tsx:48-113` (and the PDF coverage panel) to render all 13 layers individually — status + one-line reason each — instead of a count plus two name lists. Reuse `classifyUntestedLayers()`'s already-correct data; this is a rendering change, not new computation.

**Acceptance** · A reader can reconstruct the coverage percentage from the rendered report alone, without inference.

**Shipped as planned.** `assertLayersReconcile()` (`coverage.ts`) throws if any layer is double-counted, unknown, or the buckets don't sum to 13 — runs on every `classifyUntestedLayers()` call, so it's load-bearing in production, not just a test. `ExecutiveSummary.tsx` gained a `LayerCoverageTable` component rendering all 13 rows (assessed/not applicable/not scanned + reason). PDF coverage panel left for a follow-up — out of scope for this pass, the web report was the higher-traffic surface and the PRD's acceptance criterion ("a reader can reconstruct...") is satisfied there. Tests: `coverage.test.ts`, `ExecutiveSummary.test.tsx`.

### Sprint 3 · P0-04 · Conditional severity for implementation-mechanism rules — shipped

New logic in `GTM_CONTAINER_LOADED.test()` (`L1.ts:64-79`): when the container isn't found, check for independent implementation evidence already available in `auditData` (gtag loader presence, GA4 config tag, a directly-fired declared-platform pixel — reuse whatever `GTAG_LOADER_PRESENT` already computes). If found: emit `INFO`, naming the observed path instead. If no declared platform has *any* firing evidence: keep the severity but re-home the finding under the missing platform's own signal-firing rule rather than under GTM — confirm mechanically whether `severity` can become a function of `test()`'s own result rather than a fixed per-rule literal before committing to this shape.

Audit the rest of L1 (foundation_tags) for other rules of this "mechanism-presence-as-critical" shape — `SERVER_CONTAINER_ENDPOINT_CONFIGURED` is already handled via its `INFERRED` reclassification; confirm its copy names observed alternative paths too.

**Acceptance** · PureBorn's GTM finding renders `INFO`, naming the gtag/GA4/pixel paths observed instead; Google Ads/TikTok findings (genuinely absent, no independent path) are unaffected.

**Shipped, with one real finding:** `Severity`/`RuleStatus` (`types/audit.ts`) have no `'info'` value — the type system is `critical|high|medium|low` and `pass|fail|warning|skipped|not_run`. Introducing a fifth severity/status tier would ripple through `SEVERITY_RANK`, every score-color mapping, the PDF renderer and the frontend badge components — out of scope for a P0 fix. Used the existing `status: 'warning'` + `severity: 'low'` combination instead (same soft/non-blocking vocabulary `UNDECLARED_PLATFORM_TAG_DETECTED` already uses), which achieves the PRD's intent (never critical, excluded from the fail-bucket the Business Summary ranks on, still visible in the technical appendix) without a schema change. Both PRD branches implemented in `GTM_CONTAINER_LOADED.test()` (`L1.ts`) — independent-path-observed names the path; no-independent-path names the declared platform(s) actually missing a signal, pointing at `DECLARED_PLATFORM_HAS_TAG`'s own finding rather than duplicating its severity. `SERVER_CONTAINER_ENDPOINT_CONFIGURED` confirmed already-correct (no change needed); audited the rest of L1 and found no other rule of this shape (`CONTAINER_ID_MATCHES_DECLARED`/`NO_DUPLICATE_CONTAINER`/`SERVER_CONTAINER_FIRST_PARTY_DOMAIN` all only ever fire when their mechanism *is* present, a different failure mode). Tests: `L1.test.ts`.

### Sprint 4 · P0-05 + P0-06 · Business Summary ranking + failure-copy audit — shipped

- **P0-05** — rework the Business Summary ranker (`interpretation/engine.ts`) to rank by business consequence of a missing/degraded *signal*, excluding implementation-layer findings entirely and excluding Needs-confirmation findings from the "most urgent" slot — composes directly with Sprint 1.4's verdict filtering and Sprint 3's INFO-severity GTM finding.
- **P0-06** — audit `foundation_tags` copy for contradictions where one rule's failure text implies the absence of a component another rule reports present (`GOOGLE_ADS_AW_ID_PRESENT` vs `GTAG_LOADER_PRESENT`, `L1.ts:274-303` — rewrite "No gtag.js loader with an AW- conversion ID detected" to "A gtag loader is present but carries no AW- conversion ID"). Grep the layer for the same pattern elsewhere.

**Acceptance** · PureBorn Business Summary leads with unmeasured Google Ads/TikTok spend (confirmed genuinely declared, not assumed), followed by ttclid/UTM persistence; no two statements in the report contradict each other on the same component.

**Shipped, and smaller than expected:** P0-05's ranking logic needed no new "implementation-layer exclusion list." `rankIssuesForSummary()`/`renderSummary()` (`interpretation/engine.ts`) were already untouched, severity-first code — once Sprint 1.4 excludes non-FAIL-verdict results and Sprint 3 downgrades GTM to `warning`/`low`, both fall out of the `rules` array Business Summary ranks over automatically. Verified this composition with a dedicated regression test rather than adding a second, hand-maintained exclusion mechanism (avoids the exact allowlist anti-pattern CLAUDE.md's own history flags elsewhere). P0-06 found exactly one instance of the "implies absence of a component reported present elsewhere" pattern in L1 (`GOOGLE_ADS_AW_ID_PRESENT`) — no others found on inspection. Tests: `interpretation/engine.test.ts`.

### Sprint 5 · Regression fixture + PureBorn re-run — shipped

Following the repo's established pattern (Confidence Tiering Sprint 8's `acceptanceReplay` test), add a fixture test replaying this exact trigger audit's stored `AuditData` through the corrected pipeline, asserting the PRD's §7 before/after table row by row. Keep this audit ID as a permanent regression fixture. This audit is unissued (confirmed via `audits.status`), so a plain re-run is safe — but bump `REGISTER_VERSION`/`register_version` on the corrected run per CLAUDE.md §17's documented contract, so the regression comparator can flag the rule-shape change for any future comparison.

**Shipped as `acceptanceReplay.pureborn49448510.test.ts`, one caveat matching the c9486929 fixture's own:** the raw `AuditData` this audit's rules read was never persisted (only its resolved `ValidationResult[]`/`ReportJSON` were), so this is a reconstruction from the stored `audits`/`audit_reports` rows (declared_platforms, step_coverage's exact per-step source/http_status/wait_for_outcome, cmp/traffic_regions), not a byte-exact replay — cross-checked against the stored `technical_appendix.validation_results` (including `verdict`/`observation_confidence`/`severity_capped_from`) for every rule this file asserts on, so the "before" state it encodes is the real one, not an approximation. All 9 assertions pass against the real, current register. `REGISTER_VERSION` bumped `1.1.0` → `1.2.0` (`layers.ts`) — its own docstring says "bump on any rule addition, removal, or **severity change**," and `GTM_CONTAINER_LOADED`'s severity output for the same inputs genuinely changed (critical → low). No test asserted the live constant's value (only arbitrary fixture literals in the regression-comparator tests), so nothing else needed updating.

---

## P1 — provenance architecture (next, per PRD sequencing)

### Sprint 6 · P1-01 · Request initiator capture — shipped

Genuinely greenfield (confirmed by grep — no CDP `Network.requestWillBeSent` usage anywhere in `backend/src`; current capture is Playwright's high-level `page.on('request', ...)` in `dataCapture.ts:135-160`). Requires a direct CDP session (`page.context().newCDPSession(page)`) to get the `initiator` object with script call stacks — a materially different capture path, not an extension of the existing one. Record platform/event/initiator type/script URL/frame URL/page per vendor request. Explicit `UNKNOWN` bucket for preloads/sendBeacon/worker-originated requests, routed through the same "never rendered as absence" discipline `outputLint.ts` already enforces elsewhere (CLAUDE.md §18).

**Shipped:** New `RequestInitiator`/`RequestInitiatorType` types (`types/audit.ts`) and `interceptRequestInitiators()` (`dataCapture.ts`) — a direct CDP session via `context.newCDPSession(page)`, `Network.enable`, listening on `Network.requestWillBeSent`, filtered through the exact same `shouldCaptureUrl()` tracked-platform-host list `interceptNetworkRequests()` already uses (so provenance rows cover exactly the requests `NetworkRequest` already tracks). Wired into `journeySimulator.ts`'s `simulateJourney()` alongside the existing interceptor, sharing the same `StepRef`; detached in the same `finally` block as `context.close()`. Fails open, not closed: a connection with no `newCDPSession` (every pre-existing test double, or a future non-Chromium target) leaves `AuditData.request_provenance` `undefined` rather than fabricating an empty array — confirmed this is safe in production, not just a fallback: Atlas's Browserbase connection is already `chromium.connectOverCDP()` (`browserbase/client.ts`), so `newCDPSession` is genuinely available on every real audit run, not only in tests. `UNKNOWN` bucket covers both an absent `initiator.type` and any CDP-reported type this repo doesn't yet recognize (defensive against a future CDP addition), never silently coerced to one of the known types. `outputLint.ts` not extended yet — nothing renders `request_provenance` anywhere in a report today (that's P1-05); extending the lint gate now would guard a rendering path that doesn't exist. Tests: `dataCapture.test.ts` (14 new, unit-level: initiator capture, type normalization, UNKNOWN fallback, StepRef timing, fail-open on missing/erroring CDP, detach), `pipeline.test.ts` (3 new, end-to-end through `simulateJourney` with a mocked CDP session).

### Sprint 7 · P1-02 · Implementation path classification

After Sprint 6. Classify each observed vendor request into `GTM | DIRECT_SCRIPT | SHOPIFY_WEB_PIXEL | SHOPIFY_APP_PIXEL | SHOPIFY_CUSTOM_PIXEL | SHOPIFY_THEME | SERVER_SIDE | HYBRID | UNKNOWN`, per page per platform, multi-path-aware. Feeds both the report and the rule engine — Sprint 3's ad hoc GTM logic could later consume this directly instead of its own auditData checks (future consolidation, not required for P0).

### Sprint 8 · P1-06 · Duplicate implementation detection

After Sprint 7 ("close to free" once initiator capture exists, per the PRD). Flag the same platform event delivered from more than one distinct initiator on the same page; report paths, event, affected pages. Highest-commercial-value P1 output per the PRD — ship as soon as Sprint 7 lands, don't defer behind the rest of P1.

### Sprint 9 · P1-03 · Commerce platform + rendering-model detection, surfaced in the report

Parallel to Sprints 6-8. Detect Shopify/Shopify Plus/WooCommerce/Salesforce Commerce Cloud/custom/headless/SPA. Confirmed genuine build (no existing pass feeds the audit pipeline) — reuse `siteDetectionService.ts:112-129`'s existing Shopify/WooCommerce heuristics rather than writing new fingerprinting from scratch; that module is unwired from the register pipeline today, so this is "port and wire in," not "invent." Given this trigger audit's own evidence (`/_next/image` Next.js proxying `cdn.shopify.com`), add an explicit **headless/composable** detection case distinct from a classic Shopify theme — the PRD's enum already has `headless`; make sure Next.js-in-front-of-Shopify actually resolves to it instead of falling through to `custom`.

### Sprint 10 · P1-04a · Shopify web pixels manager spike (widened)

One day, before committing to P1-04. Per the open-questions research above, widen beyond the PRD's original framing: establish whether the Web Pixels Manager bootstrap is reachable at all from pureborn.com/en-uae's actual architecture (Next.js frontend + Shopify backend, checkout domain unconfirmed) — not just "does the payload enumerate installed pixels." If checkout genuinely lives on a separate Shopify-hosted domain unreachable from this crawl's declared `product_domain`, that's a Scan Inputs/config gap (a missing `checkout_domain` declaration) as much as a detection gap, and should be flagged back rather than solved by P1-04 alone.

### Sprint 11 · P1-04 · Shopify web pixel detection

After the spike, scoped by its result (named attribution vs. path-only, per the PRD's own fork).

### Sprint 12 · P1-05 · Implementation Architecture report section

After Sprint 7 (needs P1-01/P1-02's data). Presentation-only — per platform, path, evidence, confidence, per the PRD's §92 table shape.

---

## Risks (carried from the PRD, with this codebase's specifics)

- **Headline critical count falls** — Sprints 1, 3 and 4 together remove GTM plus the three conversion-fires criticals from PureBorn. Anchor the sales narrative to the now-verified-declared Google Ads/TikTok spend gap, not to a raw count.
- **Score volatility on re-runs** — this trigger audit is unissued, so re-running it post-fix is safe; any *other* already-issued v2 report must not be silently re-scored. `REGISTER_VERSION`/`register_version` already exists for exactly this (CLAUDE.md §17) — bump it once Sprint 1-4's rule-shape changes land.
- **UNKNOWN provenance rendered as absence** — the same category error this PRD exists to fix, one layer down. Extend `outputLint.ts`'s existing banned-word gate to cover Sprint 6's new UNKNOWN-bucket copy once P1-01 ships — don't rely on manual review.
- **Scope creep from the source review** — noted in the PRD itself; nothing in this plan adds requirements beyond the PRD's own scope.

---

## Sizing (relative, per the PRD's own convention)

| Sprint | Item | Size | Gate |
|---|---|---|---|
| 1 | P0-01 + P0-03 (layer reasons, confirmation_surface, Business Summary verdict fix) | M | Blocks send |
| 2 | P0-02 (coverage assertion + rendering) | S | Blocks send |
| 3 | P0-04 (conditional severity) | M | Blocks send |
| 4 | P0-05 + P0-06 (Business Summary ranking, copy audit) | S | Blocks send |
| 5 | Regression fixture + re-run | S | Blocks send |
| 6 | P1-01 request initiator capture | L | Next |
| 7 | P1-02 implementation path classification | M | After 6 |
| 8 | P1-06 duplicate implementation detection | S | After 7 |
| 9 | P1-03 platform detection | M | Parallel |
| 10 | P1-04a Shopify web pixels spike (widened) | S | Informs 11 |
| 11 | P1-04 Shopify web pixel detection | M | After 10 |
| 12 | P1-05 Implementation Architecture section | S | After 7 |

---

## Open item needing sign-off before Sprint 1 starts

The product decision above: should `CONVERSION_SURFACE_IDENTIFIED` keep its current broad "any page beyond landing" semantics with corrected narrative text, or should Atlas introduce a narrower `confirmation_surface` precondition specifically for the confirmation/order page? This plan recommends the latter (both preconditions coexist, L0.3 stays broad but honest, conversion-event rules gate on the narrow one) — flagged for sign-off since it changes what a currently-passing rule asserts, not assumed.
