# PRD: Site Evaluation Engine — Coverage & Honesty

**Status:** Draft — ready for implementation
**Owner:** Vikram / Spi3l
**Related docs:** `CLAUDE.md`, `docs/atlas-prd-crawl-signal-extractor.md` (CSE shares the page-discovery problem and already solves part of it), `docs/atlas-prd-dqm-completion.md` (same "close the gaps in a shipped feature" shape)
**Depends on:** Existing Audit Engine (`backend/src/services/audit/`), Check Register v2 (`backend/src/services/validation/register/`), Browserbase session layer, `backend/src/services/publicAudit/publicAuditRunner.ts` (source of the consent-banner logic Phase 1 ports)

---

## 1. Background — current state (audited)

`EvaluateSiteCard` (Home + Dashboard) is Atlas's front door: URL + site type + declared platforms + regions → a scored conversion-signal audit. Any request carrying `site_type` sets `rule_set_version='v2'`, so this entry point runs the **Check Register v2** path.

What is built and working:

| Layer | Status |
|---|---|
| Entry point, Zod schema, SSRF-validated URLs, plan-based rate limiting (`api/routes/audits.ts`, `middleware/auditLimiter.ts`) | ✅ |
| Browserbase session + CDP connect, usage logging (`orchestrator.ts`) | ✅ |
| Capture: dataLayer hook, network, cookies (full attrs), localStorage, sessionStorage, console errors (`audit/dataCapture.ts`) | ✅ |
| Synthetic click-ID + UTM injection, Google referrer spoof (`journeySimulator.ts:35-63`) | ✅ |
| Check Register v2 — 83 rules, two-axis applicability filter (`register/engine.ts`) | ✅ |
| Layer-based scoring (`register/scoring.ts`) | ✅ |
| 6-section report + PDF export | ✅ |

The applicability engine is the best-built part of the system: rules non-applicable by `site_type` or `platform_scope` are **excluded from results entirely rather than failed**, which keeps the denominator honest. This PRD extends that same principle to a case it does not yet cover.

### 1.1 The three structural gaps

**Gap A — the scan never leaves the homepage, and nothing says so.**

There is no page discovery anywhere in the Audit Engine. No sitemap.xml, no robots.txt, no link-following, no path probing (`grep -rni "sitemap\|robots\.txt"` over `backend/src` and `frontend/src` returns zero hits). It runs a fixed 2–4 step template (`browserbase/journeyConfigs.ts:20-93`) whose URLs must all be user-supplied. `EvaluateSiteCard.tsx:58` supplies exactly one:

```ts
url_map: { landing: websiteUrl },
```

and `journeySimulator.ts:225` silently substitutes the homepage for everything else:

```ts
let url = opts.url_map[step.urlKey] ?? opts.website_url;
```

A default ecommerce quick scan therefore performs **four navigations to the same homepage URL**, labelled `landing`, `product`, `checkout`, `confirmation`. `steps_visited` reports all four names as though four pages were visited.

**Gap B — 42 of 83 rules are unanswerable on that scan, and the gate meant to catch it passes.**

L4 (4 rules), L5 (12), L6 (15) and L7 (11) all require a real conversion surface — a purchase/lead event carrying parameters and identity. A homepage fires no such event, so those 42 rules fail by construction, deflating `conversion_signal_health` and pinning `optimization_strength` to Weak on correctly-instrumented sites.

`L0.3 CONVERSION_SURFACE_IDENTIFIED` exists precisely to detect this — its own evidence string reads *"The crawl never progressed past the landing page — the rest of this audit is unanchored."* But it tests **step labels, not URLs** (`register/L0.ts:118-123`):

```ts
const nonLandingSteps = new Set(
  [...auditData.dataLayer.map((e) => e.step), ...auditData.networkRequests.map((r) => r.step)]
    .filter((s) => s && s !== 'landing' && s !== 'init'),
);
```

`journeySimulator.ts:224` sets `stepRef.current = step.name` on every iteration regardless of whether the URL changed, so homepage requests get labelled `product`/`checkout`/`confirmation` and **L0.3 passes**. It is `severity: 'critical'`, so this false-pass is load-bearing for the whole report.

**Gap C — consent-gated sites read as untracked.**

The engine never clicks a cookie banner. Any tag gated behind a CMP simply never fires and is scored absent — a systematic false-fail for EU/UK traffic, i.e. a large share of the target market. The capability exists and is proven elsewhere: `publicAudit/publicAuditRunner.ts:122-171` has a 14-selector CMP list plus multilingual text matching and clicks it at `:232-235`. It was never ported. The `cmp` Scan Input is collected, stored, and read by no rule.

### 1.2 Secondary defects found in the same audit

| # | Defect | Location |
|---|---|---|
| 1 | One failed navigation aborts the entire run — `try/finally` with no `catch`; every step already scanned is discarded and Bull retries the whole job | `journeySimulator.ts:222-325` |
| 2 | `auditQueue` has **no `timeout`**; the comment claiming "5 min for audits" is stale. Worker concurrency is 2, so one hung session holds half the pool | `queue/jobQueue.ts:90-95`, stale comment at `:117`, `config/env.ts:120` |
| 3 | Linux UA override fights Browserbase's windows/macos stealth fingerprint — `planning/pageCaptureService.ts:59-61` documents why not to do this | `journeySimulator.ts:196-197`, `stageSimulator.ts:82-83` |
| 4 | **Reddit and Pinterest can never be detected.** `register/platformDetection.ts:36-37` matches `alb.reddit.com` / `ct.pinterest.com`, but neither host is in `TRACKED_URL_PATTERNS`, so no request is ever captured → guaranteed L0.1/L0.2 fail for anyone declaring them. Same for `px.ads.linkedin.com` | `audit/dataCapture.ts:10-27` |
| 5 | L2's capture check is exact-key, exact-value — a site storing gclid as `_atlas_gclid` or inside a JSON blob reads as "not captured" | `register/L2.ts:42-51` |
| 6 | Scroll fires only on the ecommerce `product` step; lazy-loaded tags elsewhere are missed | `journeyConfigs.ts:32` |
| 7 | **Scheduled re-scans run the v1 legacy path** — `createAudit` there passes no `site_type`/`rule_set_version`, so a scheduled re-run of a v2 audit is scored by a different engine than the original | `queue/worker.ts:166-175` |
| 8 | Four of thirteen Check Register layers ship zero rules: L8 consent, L9 server_side_delivery, L10 deduplication, L11 reconciliation — type-declared at `types/audit.ts:32-35`, no rule files | `register/engine.ts:45-48` |
| 9 | `cmp`, `additional_properties`, `checkout_domain`, `test_email`, `test_phone` are all collected, stored, threaded through, and read by nothing | multiple |
| 10 | No mobile viewport (fixed 1280×800), no iframe traversal, no shadow-DOM piercing — hosted checkout widgets are invisible | `browserbase/client.ts:41-45`; all `page.evaluate` is main-frame |
| 11 | 6 site types collapse onto 3 crawl templates; `marketplace`/`app_install`/`subscription_media` borrow one | `api/routes/audits.ts:64-71` |

---

## 2. Problem statement

The site evaluation tool reports a confident, precise-looking score derived from a single page, while telling the reader it examined a funnel. The number is not merely incomplete — it is **wrong in a knowable direction**, and the one check designed to flag that condition reports the opposite.

Two things have to be true before anything else is worth building: the score must never claim coverage it does not have, and the scan must actually reach the pages the score depends on.

## 3. Goals

- **The score never lies about coverage.** A layer that could not be tested is reported as untested and excluded from the denominator — not failed.
- **The scan finds its own funnel pages** from a bare URL, with per-step provenance visible in the report.
- **Consent-gated sites are measured correctly**, and the consent decision itself becomes observable data rather than a silent failure mode.
- **A single bad URL degrades one step, not the whole run.**
- **A declared platform is always detectable** — no platform can be declared but structurally unmeasurable.
- Coverage and provenance are durable enough that scheduled re-scans compare like with like.

## 4. Non-goals

- No change to the report's 6-section information architecture or the `AuditScores` shape the frontend consumes. New data is additive.
- No authenticated-session support (login walls) in any phase — several deferred register rules depend on it and stay deferred.
- No second-pass / re-crawl comparison rules (L2.12, L3.7–3.9, L5.9, L12.5). Phase 1's consent snapshot makes some of these cheaper later, but they are not built here.
- No new report surface, no LLM summarisation of audit results (the v1 `renderSummary` template stays template-based).
- Journey-Builder mode (`stageSimulator.ts`) is touched only where it shares code; its own coverage model is out of scope.

## 5. Phasing

| Phase | Theme | Closes | Shippable on its own |
|---|---|---|---|
| **1** | Honest scoring | Gaps A(partial), B, C + defects 1, 7 | Yes — the score stops lying without any new crawling |
| **2** | Page discovery | Gap A | Yes — coverage rises; Phase 1 makes it measurable |
| **3** | Reliability & detection | Defects 2–6 | Yes |
| **4** | Coverage expansion | Defects 8–11 | Roadmap-scale; sub-items ship independently |

Phase 1 must land before Phase 2. Building discovery first would raise coverage while the report still misrepresents it, and there would be no honest before/after measurement. Phases 3 and 4 are independent of both.

---

## 6. Phase 1 — Honest scoring

### 6.1 Record what was actually visited

**Current state:** nothing in `AuditData` distinguishes a step that reached its own URL from one that fell back to the homepage.

**Design.** In `journeySimulator.ts`, resolve each step's URL once and record provenance:

```ts
// backend/src/types/audit.ts
export type StepUrlSource = 'user_supplied' | 'sitemap' | 'nav_link' | 'heuristic' | 'fallback_landing';

export interface StepCoverage {
  step: string;
  requested_url: string;
  final_url?: string;        // after redirects
  source: StepUrlSource;
  distinct_from_landing: boolean;
  navigation_success: boolean;
  error?: string;
}

// added to AuditData
step_coverage?: StepCoverage[];
```

`distinct_from_landing` is computed on a **normalised** comparison — lowercase origin + pathname, trailing slash stripped, hash and query removed. Query must be dropped because the landing URL carries injected synthetic params; `final_url` is used when available so a redirect to the homepage is caught.

In Phase 1 `source` is only ever `user_supplied` or `fallback_landing`; Phase 2 populates the rest.

### 6.2 Fix L0.3 to compare URLs, not labels

**Design.** Rewrite `CONVERSION_SURFACE_IDENTIFIED` (`register/L0.ts`) against `step_coverage`:

- **pass** — at least one non-landing step has `distinct_from_landing && navigation_success`.
- **fail** — `step_coverage` is present and no step qualifies. Evidence keeps the existing "unanchored" wording and now lists which steps fell back.
- Retain the current label-based logic **only** as a fallback when `step_coverage` is absent, so Journey-Builder-mode and any replayed historical `AuditData` keep working.

This is the highest-leverage change in the PRD: every downstream layer's credibility rests on it, and it is roughly a 30-line rule rewrite.

### 6.3 Skip, don't fail, what could not be tested

**Design.** Add a declarative precondition to the rule contract rather than editing 42 rules:

```ts
// backend/src/types/audit.ts
export type RulePrecondition = 'conversion_surface' | 'distinct_product_domain';

export interface ValidationRule {
  // ...existing fields
  requires?: RulePrecondition[];
}
```

`register/engine.ts` `runRegister()` evaluates preconditions **after** the existing applicability filter and **before** `rule.test()`. An unmet precondition returns:

```ts
{
  rule_id, validation_layer: rule.layer,
  status: 'skipped',
  severity: rule.severity,
  technical_details: {
    found: 'Not tested — the crawl never reached a page distinct from the landing page',
    expected: rule.check,
    evidence: ['Steps that fell back to the landing URL: product, checkout, confirmation'],
  },
}
```

`'skipped'` is deliberate, not `'excluded'`. `register/scoring.ts:20-22`'s `scored()` **already** filters skipped out of every denominator, so no scoring change is required — and unlike exclusion, a skipped rule still appears in the report, so the reader sees what was not tested rather than a silently shorter list.

Tag `requires: ['conversion_surface']` on all L5, L6 and L7 rules and on L4.3/L4.4. Do **not** tag L4.1/L4.2 (they scan landing-page links and are answerable without a conversion surface).

**Consequence to expect and accept:** a homepage-only scan will produce a `conversion_signal_health` computed over ~41 rules instead of 83. The number will move — usually upward — and that is the correction, not a regression.

### 6.4 Surface coverage in the report

**Design.** Extend `ReportJSON.executive_summary` with an additive `coverage` block:

```ts
coverage: {
  pages_requested: number;
  pages_distinct: number;          // unique normalised URLs actually visited
  steps: StepCoverage[];
  layers_not_tested: Array<{ layer: ValidationLayerV2; label: string; reason: string }>;
  rules_tested: number;
  rules_not_tested: number;
}
```

Frontend: a coverage banner at the top of `ExecutiveSummary.tsx` whenever `pages_distinct < pages_requested` — plain wording, e.g. *"This scan examined 1 page. Event firing, parameter completeness and identity checks could not be tested because no conversion surface was reached."* Add the same as a `Scan Coverage` section in the PDF (`export/pdfGenerator.ts`), placed directly after `Scores at a Glance`.

Per implementation rule 12 (no fabricated UI data), this section renders only from real `step_coverage` data and is omitted entirely when absent.

### 6.5 Consent banner handling

**Design.** Extract the proven public-audit logic into one shared module — do not fork a second copy:

`backend/src/services/detection/consentBanner.ts`
- `CMP_SELECTORS` and `CMP_TEXT_MATCHERS` — moved verbatim from `publicAuditRunner.ts:122-171`.
- `detectConsentBanner(page): Promise<{ present: boolean; vendor?: CMP; selector?: string }>`
- `dismissConsentBanner(page, opts): Promise<boolean>`

`publicAuditRunner.ts` is refactored to import from it, so both paths stay in sync.

In `journeySimulator.ts`, on the **landing step only**, after `waitForSelector` and before step actions:

1. `flushDataLayer` + snapshot network/cookies → this is the **pre-consent** state.
2. If the user declared a `cmp`, try that vendor's selector first, then fall back to the full list.
3. Dismiss; wait a fixed settle (3500 ms, matching `publicAuditRunner.ts:232-235`).
4. Continue normally — all subsequent steps are post-consent.

New `AuditData` field:

```ts
consent_capture?: {
  banner_present: boolean;
  vendor?: CMP;
  dismissed: boolean;
  declared_cmp?: CMP;                  // from Scan Inputs
  tags_before: string[];               // platforms detected pre-dismiss
  tags_after: string[];                // platforms detected post-dismiss
};
```

This makes the `cmp` Scan Input load-bearing for the first time, and is the data dependency L8 (Phase 4) needs. It also removes the largest single source of false "no tags present" results.

**Open decision (§13.1):** whether accepting consent should be the default. Accepting measures the site's intended configuration; not accepting measures the median EU visitor's experience. This PRD specifies **accept**, because every rule in L1–L7 is written against intended configuration.

### 6.6 Per-step failure isolation

**Design.** Wrap the body of the step loop (`journeySimulator.ts:222-325`) in try/catch, mirroring the pattern `stageSimulator.ts:139-165` already uses:

- On navigation or step failure: record `navigation_success: false` and `error` on that step's `StepCoverage`, then `continue`.
- Add an explicit per-step navigation timeout (**20 s** networkidle, **10 s** domcontentloaded fallback) rather than relying on Playwright's 30 s default, so a 4-step run has a bounded worst case.
- Only an infrastructure failure (Browserbase session lost, CDP disconnect) aborts the run.

This matters most for the ecommerce `confirmation` step, whose URL is typically unreachable without a real order — today the most likely cause of a wholly failed audit.

### 6.7 Route scheduled re-scans through v2

**Design.** `queue/worker.ts:166-175` creates scheduled audits with no `site_type`/`rule_set_version`, so a scheduled re-run of a v2 audit is scored by the v1 engine — the regression detector at `worker.ts:40-86` is therefore comparing two different scoring systems.

- Persist the originating audit's v2 Scan Inputs on the schedule (see §9) and pass them through `createAudit` + `auditQueue.add`.
- In the regression comparator, skip the alert when the two runs' `rule_set_version` differ or their coverage fingerprints differ (§9), rather than reporting a phantom score drop.

---

## 7. Phase 2 — Page discovery

**Goal:** from a bare URL, resolve the template's step keys to real pages, with provenance, inside a bounded budget.

**New service:** `backend/src/services/audit/stepUrlResolver.ts`, run in the orchestrator **before** `simulateJourney`, returning a filled `url_map` plus a `StepUrlSource` per key. User-supplied URLs are never overridden.

**Strategy, cheapest first, short-circuiting once every key is filled:**

1. **`robots.txt`** → `Sitemap:` directives.
2. **`sitemap.xml`** (+ sitemap-index recursion, one level) — plain HTTP, no browser cost.
3. **Landing-page link harvest** — same-origin `a[href]` from the already-open landing page. Nearly free; reuses the existing DOM-read pattern at `journeySimulator.ts:268-271`.
4. **Path heuristics** — reuse the existing list at `crawl/pageDiscovery.ts:64-72` (`/cart`, `/basket`, `/checkout`, `/pricing`, `/plans`, `/signup`, `/register`, `/demo`, `/trial`, `/thank-you`, `/order-confirmation`, `/success`, …) rather than defining a second one. Verify by HEAD request before accepting.

**Candidate scoring:** a keyword table per funnel step key (e.g. `product` ← `/product`, `/p/`, `/shop`, `/item`; `checkout` ← `/checkout`, `/cart`, `/basket`). Highest-scoring same-origin candidate wins; ties break on shortest path.

**Constraints:**
- Every candidate URL passes the existing SSRF validator (`utils/urlValidator.ts`) before any fetch — non-negotiable, this is the same code path that protects `POST /start`.
- Budget: **max 25 HTTP fetches, max 15 s wall clock** for the whole resolver. On budget exhaustion, return what was found; unresolved keys stay `fallback_landing` and Phase 1's machinery reports them honestly.
- Same-origin only. Cross-origin candidates are ignored except an explicitly declared `product_domain`/`checkout_domain`.

**Expected outcome, stated plainly:** `confirmation` / `thank_you` will usually remain unresolvable without a real transaction. That is the correct result — those steps become `not_run`, and L5–L7 skip via §6.3. Discovery raises coverage for `product`, `checkout`, `pricing` and `signup`, which is where most of the value sits.

**Report:** `StepCoverage.source` renders in the coverage section, so the user can see *"checkout — found via sitemap"* vs *"confirmation — not found"*, and correct it in the Advanced form.

**Out of scope for Phase 2:** enlarging the step templates beyond their current 2–4 keys. Discovery fills the existing shape.

---

## 8. Phase 3 — Reliability & detection fixes

Small, independent, each individually testable.

**8.1 Queue timeout.** Add `timeout: 8 * 60 * 1000` to `auditQueue` (`jobQueue.ts:90-95`) and correct the stale "5 min for audits" comment at `:117`. 8 minutes accommodates 4 steps × (20 s nav + settle) plus Phase 2's 15 s resolver with ample headroom.

**8.2 Remove the UA override.** Delete the forced Linux Chrome UA at `journeySimulator.ts:196-197` and `stageSimulator.ts:82-83`; let Browserbase's configured fingerprint stand, per the reasoning already documented at `planning/pageCaptureService.ts:59-61`.

**8.3 Close the platform-detection dead-end.** Add `alb.reddit.com`, `ct.pinterest.com`, `s.pinimg.com/ct/core.js` and `px.ads.linkedin.com` to `TRACKED_URL_PATTERNS` (`dataCapture.ts:10-27`).

Then add the invariant test that prevents recurrence — this is the important half:

```ts
// every host any PLATFORM_MATCHER looks for must be capturable
it.each(ALL_DECLARED_PLATFORMS)('%s tag requests are captured', (platform) => {
  for (const host of MATCHER_HOSTS[platform]) {
    expect(shouldCaptureUrl(`https://${host}/whatever`)).toBe(true);
  }
});
```

This requires exporting `shouldCaptureUrl` and factoring the matcher host strings out of `platformDetection.ts:28-38` into a shared constant both files consume.

**8.4 Loosen L2 capture matching.** Replace the exact-key/exact-value check (`register/L2.ts:42-51`) with a three-tier result:

1. Exact key + exact value → **pass**.
2. Value found under a differently-named key (any storage/cookie/dataLayer key whose value equals the synthetic value), or one level of JSON parsing of a string value → **pass**, with the actual key name in evidence.
3. Not found → **fail** (unchanged).

Matching on the *synthetic value* rather than the key name keeps this safe: the values are unique per run (`test_gclid_${ts}`), so a value match cannot collide by accident.

**8.5 Scroll every step.** Add `{ type: 'scroll_bottom' }, { type: 'wait', ms: 500 }` to every step in all three templates (`journeyConfigs.ts:20-93`), not just ecommerce `product`. Lazy-loaded tags below the fold are otherwise invisible on every other page.

---

## 9. Data model changes

**Phases 1 and 3: no migration.** `StepCoverage`, `consent_capture` and the report `coverage` block live inside the existing `audits.report` JSONB.

**Phase 2 adds one migration**, for two reasons — the regression comparator needs to know whether two runs are comparable, and coverage is worth querying without unpacking the report blob:

```sql
-- supabase/migrations/<ts>_audit_coverage.sql
ALTER TABLE audits ADD COLUMN IF NOT EXISTS coverage_fingerprint TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pages_distinct INT;
```

`coverage_fingerprint` is a stable hash of the sorted set of normalised URLs actually visited. `worker.ts:40-86` compares it between runs and suppresses the regression alert when it differs — otherwise Phase 2 will fire "score dropped 15 points" alerts across the estate the moment discovery starts finding checkout pages that were previously scored as homepages.

Scheduled audits also need the v2 Scan Inputs persisted (§6.7). Follow the existing `audits` v2 columns and match the `org_id` vs `organization_id` convention used by the neighbouring migration — per `CLAUDE.md` rule 10, check the file, do not assume. Wrap `ALTER TABLE` in the `DO $$ IF EXISTS ... END $$` guard per rule 9. RLS is inherited; no new tables.

## 10. API & type changes

No route signatures change. All additions are additive fields on existing response bodies, so the `{ data, error, message }` contract and the frontend's `AuditScores` shape are untouched.

| File | Change |
|---|---|
| `backend/src/types/audit.ts` | `StepCoverage`, `StepUrlSource`, `RulePrecondition`, `ValidationRule.requires?`, `AuditData.step_coverage?`, `AuditData.consent_capture?`, `ReportJSON.executive_summary.coverage?` |
| `frontend/src/types/audit.ts` | Mirror the above (this file is explicitly a mirror — see its header comment) |
| `backend/src/services/validation/register/engine.ts` | Precondition evaluation in `runRegister()` |
| `backend/src/services/validation/register/L0.ts` | L0.3 rewrite |
| `backend/src/services/validation/register/L4–L7` | `requires` tags only; no test-body changes |
| `backend/src/services/audit/journeySimulator.ts` | Step coverage recording, per-step try/catch, explicit timeouts, consent dismissal, scroll on all steps |
| `backend/src/services/detection/consentBanner.ts` | **New** — shared CMP module |
| `backend/src/services/audit/stepUrlResolver.ts` | **New** — Phase 2 |
| `backend/src/services/audit/orchestrator.ts` | Call resolver before `simulateJourney`; thread coverage into the report |
| `frontend/src/components/audit/ExecutiveSummary.tsx` | Coverage banner |
| `backend/src/services/export/pdfGenerator.ts` | `Scan Coverage` section |

## 11. Phase 4 — Coverage expansion (roadmap)

Sized, not specified. Each is an independent follow-up PRD.

| Item | Notes | Rough size |
|---|---|---|
| **L8 consent** (0 rules today) | Directly unblocked by §6.5's `consent_capture`. Highest value of the four, and the only one with its data dependency already built | M |
| **L9 server-side delivery** | Partially served by the existing `siteSetupDetector.ts:78-141` sGTM heuristic; needs promoting from informational to scored | M |
| **L10 deduplication** | Overlaps `services/capi/dedupStore.ts`; needs `event_id` correlation across client and server hits | M |
| **L11 reconciliation** | Needs platform connectors, not crawl data. Largest of the four; belongs with Platform Reconciliation, not here | L |
| **Wire the unused Scan Inputs** | `cmp` → L8; `checkout_domain` → navigate as `product_domain` already is; `additional_properties` → additional origins; `test_email`/`test_phone` → real form fill on `lead_gen` (needs `fill`/`click` step actions, which are implemented at `journeySimulator.ts:257-261` but used by no template) | M |
| **Mobile viewport pass** | Doubles Browserbase minutes — model the cost against `usageLogger`'s `page_scan` events and plan gating before building | M |
| **iframe + shadow DOM traversal** | `page.frames()` iteration plus shadow-root piercing in the two DOM reads. Unblocks hosted checkout widgets (Stripe/Shopify), currently wholly invisible | M |
| **Per-site-type templates** | Give `marketplace`, `app_install`, `subscription_media` their own step shapes instead of borrowing (`api/routes/audits.ts:64-71`) | S |

## 12. Build sequence

**Phase 1 — Honest scoring**
1. Types: `StepCoverage`, `RulePrecondition`, `AuditData`/`ReportJSON` additions (backend + frontend mirror).
2. `journeySimulator.ts`: step-coverage recording, per-step try/catch, explicit timeouts. Unit tests first — `services/audit/__tests__/pipeline.test.ts` already pins step counts at `:259,272` and will need extending, not rewriting.
3. L0.3 rewrite + tests, including the label-based fallback path.
4. Precondition evaluation in `runRegister()`; tag L4.3/L4.4 and all of L5–L7.
5. `consentBanner.ts` extraction; refactor `publicAuditRunner.ts` onto it; wire into the landing step.
6. Report `coverage` block → `ExecutiveSummary.tsx` banner → PDF section.
7. Scheduled-audit v2 routing + regression-comparator guard.

**Phase 2 — Discovery**
8. `stepUrlResolver.ts` with the four strategies, SSRF validation, and budget caps. Unit-testable in full without a browser — mock the HTTP layer.
9. Orchestrator wiring; provenance into `StepCoverage.source`.
10. Coverage migration + fingerprint; regression suppression.

**Phase 3 — Reliability** (independent; can run in parallel with Phase 2)
11. Queue timeout + stale comment. 12. UA override removal. 13. Tracked-host fix **plus the invariant test**. 14. L2 three-tier matching. 15. Scroll on all steps.

## 13. Test plan

- **Unit.** L0.3 truth table (all-fallback / one-distinct / redirect-to-homepage / missing `step_coverage`). Precondition gating: assert an untested L6 rule lands `skipped` and that `calculateV2Scores` denominators drop accordingly. URL normalisation (trailing slash, hash, injected synthetic query params, protocol-relative). L2 three-tier matcher, including a negative case proving tier 2 cannot false-positive. Resolver scoring against fixture sitemaps and link sets.
- **Invariant.** Every host in `PLATFORM_MATCHERS` passes `shouldCaptureUrl` (§8.3).
- **Integration.** Extend `services/audit/__tests__/pipeline.test.ts`: a homepage-only ecommerce run must yield `pages_distinct: 1`, L0.3 `fail`, and ~42 `skipped` results; a four-distinct-URL run must yield L0.3 `pass` and zero precondition skips. A run whose `confirmation` step 404s must still complete with three successful steps.
- **End-to-end.** Run against a live consent-gated site (a Cookiebot or OneTrust storefront) and confirm `tags_before` ⊂ `tags_after`. Run against a real ecommerce site from a bare URL and confirm Phase 2 resolves `product` and `checkout`.
- **Regression guard.** Re-score a stored historical `AuditData` fixture through the new engine and diff the result — the score is expected to move; the diff must be explainable line by line.

## 14. Success metrics

- **Zero** audits where `L0.3 = pass` while `pages_distinct == 1`. This is the defect this PRD exists to remove; it should be assertable in a test, not merely monitored.
- Share of quick scans resolving ≥ 2 distinct pages: **0% today → target ≥ 70%** after Phase 2 (`pages_distinct` column makes this a one-line query).
- Share of runs failing wholly on a single bad step URL: **→ ~0** after §6.6.
- Platforms declared but structurally undetectable: **2 today (Reddit, Pinterest) → 0**.
- Rules skipped-for-precondition are visible in every report where they apply — a reader can always tell tested from untested.

## 15. Risks & open questions

**15.1 Accept-consent is a measurement choice, not just a bug fix (§6.5).** Accepting measures intended configuration; declining measures the median EU visitor's reality. This PRD specifies accept because L1–L7 are written against intended configuration, but it is a product decision worth confirming — and capturing both states (which §6.5 does) is what makes L8 and the deferred L2.12 buildable later.

**15.2 Published scores will move.** Phase 1 changes the denominator and Phase 2 changes what is measured. Any customer-visible score history spanning the change is not comparable. Mitigation: `coverage_fingerprint` (§9) plus suppressing regression alerts across a fingerprint change — but customer communication is a separate call, not a code change.

**15.3 Discovery may pick the wrong page.** A `/pricing` page scored as `checkout` produces a confidently wrong result — arguably worse than an honest `not_run`. Mitigation: provenance is always shown, the Advanced form always overrides, and the resolver prefers `fallback_landing` over a low-confidence guess. Recommend a minimum candidate score below which a key is left unresolved.

**15.4 Phase 2 adds latency and Browserbase cost.** Budget caps (25 fetches / 15 s) bound it, and strategies 1, 2 and 4 are plain HTTP outside the browser session. Watch `usage_events` `page_scan` volume after rollout.

**15.5 Dismissing a banner changes what the rest of the run observes.** Post-consent steps are no longer directly comparable to pre-consent landing captures. `consent_capture.tags_before/after` records the boundary explicitly; any future rule reading across it must account for that.

**15.6 Open — should discovery apply to the Advanced form?** Today a partially-filled Advanced form falls back to the homepage exactly like the quick card. The resolver should probably fill only the gaps, never overriding user input. Specified that way in §7; confirm before build.
