# Atlas PRD — Attribution Chain Check (B2B lead-gen extension to Campaign Signal Validator)

**Target path in repo:** `docs/prd/attribution-chain-check.md`
**Status:** Ready to build
**Sequencing:** Between Phase 1 and Phase 2 of `docs/prd/universal-outcome-ingestion.md`. Scanner-side only · touches no ingestion code, so the two tracks do not block each other.
**Owner:** Vikram

---

## 1. Why this exists

Every outcome path Atlas supports — HubSpot connector, webhook, sheet sync, CSV — depends on one upstream condition it cannot control: **a click ID has to be in the client's lead record in the first place.**

A CRM holds no `gclid` unless something put it there. A spreadsheet only works if it has a click ID column that something populates. Every transport in the Universal Outcome Ingestion PRD is downstream of this, and adding transports makes the problem easier to hide, not easier to solve.

Today Atlas discovers the break *after* a client has connected a source, through `readinessCheck.ts`'s sample verdict. That is too late in two ways. Commercially, the client has already bought and is now being told their data is unusable. Operationally, it means Atlas cannot qualify a prospect before onboarding them.

This PRD moves the diagnosis upstream, to a URL-only pre-connection scan, and turns the finding into a scoped consulting remedy.

### 1.1 Why a chain, not a checklist

A checklist implies partial credit. Attribution capture does not work that way. If the click ID lands on the page, persists in a cookie, but never reaches the form's hidden field, it does not matter that two other checks passed — the outcome is identical to capturing nothing at all.

So a report that says "7 of 9 passed, 78%" actively misleads. The client reads it as mostly working while it produces zero attributable outcomes.

**The output is one named break, not a score.** First failing link, one named fix, one scoped remedy. That is also what makes it sellable: "your click ID is captured but never reaches your CRM, here are the three hours to fix it" converts far better than a percentage.

---

## 2. The five links

| Link | What must be true | Observable pre-connection? |
|---|---|---|
| **L1 · Arrival** | Click ID param reaches the landing page — auto-tagging on, params surviving redirects, CDN and consent-gate rewrites | Yes |
| **L2 · Persistence** | It is read into cookie, storage or dataLayer and survives navigation to the form page | Yes |
| **L3 · Form carriage** | It is written into the form submission payload — hidden field populated at submit | Yes, but not currently checked |
| **L4 · CRM arrival** | The form tool maps that field to a CRM property that exists | No — requires source access |
| **L5 · Real population** | Live records actually carry it, not just a test submission | No — requires real records |

Links 3 and 4 are where it breaks most often, because that is the seam between the website and the CRM, usually owned by two different people or vendors. Link 3 is the last one Atlas can see without access, which makes it the highest-value addition in this PRD.

### 2.1 Two gates, not one

Atlas cannot confirm the chain works from a pre-connection scan. It can only confirm whether connecting is worth doing.

- **Pre-connection gate** (this PRD): L1 to L3, from a URL-only scan. Produces the diagnostic that is sold against.
- **Post-connection gate** (already built): L4 and L5, via `readinessCheck.ts`'s sample-based verdict, including the `PROPERTIES_PRESENT_NO_DATA` state.

Neither is sufficient alone, and the product must say so rather than implying the first proves anything. A clean L1 to L3 result is a *necessary* condition, not a sufficient one, and the report copy must be written that way.

---

## 3. What already exists

Most of this is assembly, not invention.

| Need | Already in repo |
|---|---|
| L1 and L2 detection | Check Register v2 L2 rules `L2.1` to `L2.13`, `makeClickIdCaptureRule()`, layer `click_id_capture` |
| Synthetic click-ID injection | `test_gclid_<13-digit-timestamp>` pattern, never shared across params |
| Value-not-name matching | `L2.ts` already matches on the injected *value* as a substring, handling `_gcl_aw` = `GCL.<ts>.<gclid>` and JSON-blob storage |
| Form fill and submit | `journeySimulator.ts` lines 481 to 489 — fills `test_email` / `test_phone`, clicks submit, on the `lead_gen` landing step |
| POST body capture | `dataCapture.ts` line 153 `page.on('request')`, already captures `req.postData()` into `body` |
| Productised diagnostic wrapper | `campaignSignalValidator/` — `orchestrator.ts`, `eventVerdict.ts`, `checkoutService.ts`, `pdfGenerator.ts`, public landing and result pages |
| Absence-assertion discipline | `outputLint.ts` |

**The only genuinely new detection work is link 3**, and it is small: run the existing form submit inside the existing network capture window, and check whether the injected click-ID value appears in the captured request body.

---

## 4. The chain model

New `backend/src/services/attribution/chainModel.ts`. Pure function, no I/O, fully unit-testable.

```ts
export type LinkVerdict = 'PASS' | 'FAIL' | 'NOT_OBSERVED';

export type ChainLink =
  | 'arrival' | 'persistence' | 'form_carriage' | 'crm_arrival' | 'real_population';

export interface AttributionChainResult {
  links: Record<ChainLink, LinkVerdict>;
  /** First failing link, or null if nothing failed. The headline. */
  break_at: ChainLink | null;
  /** Why the break was called, in evidence terms. */
  break_evidence: string;
  /** Which remedy tier the break maps to (§7). Null when break_at is null. */
  remedy_tier: RemedyTier | null;
  /** True when no click ID could be observed at all — see §6. */
  not_observed_reason: 'no_paid_traffic' | 'no_conversion_surface' | null;
  /** Explicit: a clean pre-connection result does not prove the chain works. */
  scope: 'pre_connection' | 'post_connection';
}
```

**Cascade rule.** Links after a break resolve to `NOT_OBSERVED`, never `FAIL`. You cannot observe whether a CRM property would have been populated by a click ID that never reached the form. Asserting `FAIL` there would be an absence-as-certainty claim of exactly the kind `outputLint.ts` exists to prevent.

**No score.** Nothing in this type can produce a percentage. That is deliberate and should not be "improved" later.

---

## 5. Link 3 detection

### 5.1 Mechanism

Wrap the existing lead-gen form submit in the existing network capture, then match on value.

1. The scan already navigates to the landing page with synthetic click IDs injected as URL params (`test_gclid_<ts>` etc.).
2. `journeySimulator.ts` already fills and submits the form when `funnel_type === 'lead_gen'` and `test_email` or `test_phone` is set.
3. Attach `interceptNetworkRequests()` (or the equivalent capture already active on the page) around the submit click, so the outbound request and its `postData()` body are captured.
4. Check whether the injected click-ID **value** appears anywhere in the captured request — body, URL query, or headers.

Match on the value, not a field name. This is the same technique L2 already uses and the reason it works is that Atlas controls the injected value and it is unique by construction. A field called `gclid` that is empty must not pass; a field called `utm_ref_7` carrying the value must.

### 5.2 Edge cases that must be handled

- **Multi-step forms.** The submit may not be the first interaction. Capture across the whole step, not a single click.
- **Client-side SPA submits.** The payload may be a `fetch` rather than a form POST. `page.on('request')` catches both.
- **Third-party embedded forms** (HubSpot, Marketo, Typeform iframes). The request originates from the iframe's origin. Capture must not be scoped to the top-level frame only. Where the iframe is cross-origin and opaque, the honest verdict is `NOT_OBSERVED`, not `FAIL`.
- **Submit never fires.** Validation blocked it, or no form was found. `NOT_OBSERVED` with `no_conversion_surface`, never `FAIL`.
- **Test submissions reaching the client's real CRM.** The existing form fill already has this property and it is accepted behaviour. Document it in the scan inputs UI so a prospect is not surprised by a junk lead, and keep using the existing synthetic `test_email` so the record is identifiable.

### 5.3 Register rule

New rule in `backend/src/services/validation/register/L2.ts`.

- **Rule ID:** the ID sequence in L2 currently runs `L2.1` to `L2.11` plus `L2.13`, so `L2.12` appears free. **Verify this before using it** — do not assume from this document.
- **`rule_id`:** `CLICK_ID_CARRIED_IN_FORM_SUBMIT`
- **Layer:** `click_id_capture`. No new layer — `ALL_V2_LAYERS` stays at 13 and the report denominator is unchanged in shape.
- **Severity:** `critical`. A break here produces zero attributable B2B outcomes.
- **`requires`:** `['conversion_surface']`, so a scan that never reached a form is `skipped`, not `fail`.
- **`why`:** the click ID reaching the form submission is the only route by which it can ever reach a CRM record.

**Bump `REGISTER_VERSION` 1.2.0 → 1.3.0** in `layers.ts`. Per the Report Correctness Programme's D5 decision, historical audits are never rescored on a bump — they stand as issued, tagged with the version that produced them, with display noting that two versions are not directly comparable.

### 5.4 Scoring versus the chain verdict

These are two separate outputs and must not be conflated.

- The **rule** contributes to L2's layer score normally, like every other register rule. That is correct and expected.
- The **chain verdict** is rendered as a break, never as a score. It reads the rule results but produces its own output type.

Do not surface the chain as a percentage anywhere, and do not let the chain verdict feed back into scoring as a separate weighted item.

---

## 6. `NOT_OBSERVED` is the case to get right

A prospect running no paid campaigns has no click ID to capture. Every link will find nothing.

Reporting that as broken would be both factually wrong and a poor first impression on someone who has not started spending yet. The same absence-is-not-certainty discipline that governs report copy applies here, and `outputLint.ts` must be run over the new copy.

Distinguish two reasons and say which:

- `no_paid_traffic` — the scan found no evidence of paid click parameters in any observed traffic. The correct message is that the chain could not be exercised, with a note that it should be re-run once campaigns are live.
- `no_conversion_surface` — no lead-gen form was reachable. Different problem, different conversation, and arguably a more urgent one.

Neither is a failure. Neither should render in the same visual register as a break.

---

## 7. Break-to-remedy mapping

The consulting offer is triggered by the specific link, because the work and the price differ substantially. A single "attribution setup" line item would be both less honest and harder to say yes to.

| Break | Typical cause | Remedy tier | Notes |
|---|---|---|---|
| **L1 Arrival** | Auto-tagging off; a redirect or CDN rule stripping params; consent gate rewriting the URL | Tier 1 · smallest | The best possible first engagement — dramatic effect, minimal effort |
| **L2 Persistence** | No capture tag deployed | Tier 2 · small | Atlas already generates the GTM click-ID capture tag and can deploy it as a draft workspace. Mostly an approval conversation |
| **L3 Form carriage** | Hidden field absent or not populated at submit | Tier 3 · **variable** | Effort depends entirely on the form vendor. A HubSpot or Marketo form is straightforward; a custom React form or opaque third-party embed can be real work. **Scope after identifying the vendor, never quote blind** |
| **L4 CRM arrival** | Property missing, or field mapping absent in the form tool | Tier 4 · moderate | Predictable. Post-connection finding only |
| **L5 Real population** | Fix applied but never deployed, or applied to one form of several | Tier 5 · diagnostic | Cheap to find, worth catching — looks like success from both ends |

The report should name the tier's *shape* of work, not a price. Pricing is a commercial decision made per engagement, and a number in an automated PDF will be wrong.

### 7.1 Vendor detection improves the L3 quote

The scan can usually identify the form vendor from the submit request's destination host. Surface it in `break_evidence` when detected. It is the single piece of information that turns an unscopeable L3 break into a quotable one, and it costs nothing to capture since the request is already intercepted.

---

## 8. Product surface

**Do not build a new product.** `campaignSignalValidator/` already has Stripe checkout, a public landing page, a result page and PDF output, and its stated premise is scoring whether tracking can validate a campaign. The attribution chain check is its B2B lead-gen verdict path.

- `orchestrator.ts` — add a lead-gen branch that runs `chainModel` over the scan and journey results.
- `eventVerdict.ts` — the existing `VerdictRating` (`strong` / `moderate` / `weak`) and `AIMaxRisk` stay for ecommerce. Lead-gen gets the chain result *alongside* them, not instead of them. Note the existing branch at line 118 already special-cases `inferred_business_type === 'lead_gen'` with no primary stage — the chain result slots in around that logic.
- `pdfGenerator.ts` — chain section rendering the break, the evidence, and the remedy shape.
- Public result page — the break as the headline, links as supporting detail, no percentage anywhere.

### 8.1 Feeding the delivery gate

The chain result is a natural input to the Universal Outcome Ingestion PRD's delivery gate (§6.3 of that document): a source whose pre-connection chain broke at L1, L2 or L3 should not have delivery enabled without the break being addressed or explicitly overridden.

**Build the link, keep it advisory in v1.** The pre-connection scan and the connected source may be months apart and the client may have fixed things in between. Surface the prior chain result at the point of enabling delivery; do not hard-block on a stale scan.

---

## 9. Sprints

| Sprint | Scope | Exit |
|---|---|---|
| **1** | `chainModel.ts` — types, cascade rule, `break_at` derivation, remedy mapping. Pure function, no I/O | Unit tests cover every link-break permutation including both `NOT_OBSERVED` reasons |
| **2** | Link 3 detection — network capture around the existing lead-gen submit, value matching, iframe and SPA handling, vendor detection from destination host | Correctly distinguishes a form carrying the click ID from one that does not, on at least three real sites with different form vendors |
| **3** | Register rule `L2.12` / `CLICK_ID_CARRIED_IN_FORM_SUBMIT`, `requires: ['conversion_surface']`, `REGISTER_VERSION` → 1.3.0 | Rule returns `skipped` when no form was reached; existing register tests green |
| **4** | Campaign Signal Validator lead-gen path — orchestrator branch, result page, PDF section, `outputLint` over all new copy | A URL-only scan of a real B2B site produces a correct, sellable chain verdict end to end |
| **5** | Advisory link into the delivery gate; surface prior chain result at source connection | Prior result shows at connection time without hard-blocking |

Sprint 2 is the only one with real uncertainty in it. Everything else is assembly.

---

## 10. Acceptance criteria

1. A site with auto-tagging off and no click ID reaching the page breaks at `arrival`; `persistence`, `form_carriage`, `crm_arrival` and `real_population` all return `NOT_OBSERVED`, never `FAIL`.
2. A site capturing the click ID into a cookie but omitting it from the form payload breaks at `form_carriage`, with the form vendor named in `break_evidence` where detectable.
3. A site carrying the click ID through to the submit payload returns `break_at: null` for the pre-connection scope, and the copy states explicitly that L4 and L5 remain unverified.
4. A prospect with no paid traffic returns `not_observed_reason: 'no_paid_traffic'` and renders in a distinct visual register from a break.
5. A scan reaching no lead-gen form returns `no_conversion_surface`; the register rule returns `skipped`, not `fail`.
6. A cross-origin opaque embedded form returns `NOT_OBSERVED` for `form_carriage`, not `FAIL`.
7. Value matching passes on a field named arbitrarily that carries the injected value, and fails on a field named `gclid` that is empty.
8. No output of this feature — report, PDF, API response or UI — contains a chain completion percentage.
9. `outputLint.ts` passes over all new report copy with no absence-as-certainty violations.
10. `REGISTER_VERSION` is 1.3.0 and no historical audit's stored score is recomputed.
11. The chain verdict does not feed back into layer scoring as a separate weighted item.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Link 3 detection produces false `FAIL` on embedded or SPA forms, damaging trust in the exact diagnostic being sold | `NOT_OBSERVED` is the default for anything unobservable; §5.2 enumerates the cases; Sprint 2 exit requires three real sites with different vendors |
| A clean pre-connection result is read as proof the chain works | Scope is a field on the result type, not a footnote; result copy states L4 and L5 are unverified |
| The chain gets "improved" into a score by a later contributor | No percentage is representable in the output type; acceptance criterion 8 makes it testable |
| Test submissions create junk leads in a prospect's CRM | Existing accepted behaviour; document in scan inputs and keep the identifiable synthetic `test_email` |
| Rule ID `L2.12` collides with something not visible in the current grep | Sprint 3 verifies against the live register before assigning |
| L3 remedy quoted blind and under-scoped | Remedy tier 3 is explicitly marked variable; vendor detection exists to make it quotable; no price rendered in the PDF |

---

## 12. Implementation notes (added post-build)

Recorded here rather than editing the sections above, so this document still reads as the plan that was approved — deviations and how each sprint actually closed are what matters going forward.

- **`L2.12` was not used.** Sprint 3 verified the register live (per this document's own §5.3/§11 instruction) and found `L2.12` isn't merely unassigned — `L2.ts`'s own file header reserves it for a distinct, not-yet-built consent-gating rule (the same situation `L2.13`/`OPPREF_CAPTURED_AT_LANDING` had already navigated, with its own in-file comment explaining the choice). `CLICK_ID_CARRIED_IN_FORM_SUBMIT` shipped as **`L2.14`**, following that exact precedent rather than reusing a slot documented for something else.
- **`requires: ['conversion_surface']` was not used on the register rule.** That precondition (`conversionSurfaceReached()`, `L0.ts`) answers a more general question — did the crawl reach *any* distinct, verified step beyond the landing page — which doesn't line up precisely with "was the lead-gen form's own submit control reachable." The rule instead gates directly on `AuditData.attribution_form_carriage` (undefined or `NOT_OBSERVED` → `skipped`; `PASS`/`FAIL` → `pass`/`fail`), a purpose-built, more precise signal for exactly this decision. The net behavior this document's Sprint 3 exit criterion asks for ("skipped when no form was reached") holds either way.
- **Sprint 4's real gap: Campaign Signal Validator had no browser automation at all.** `orchestrator.ts`'s existing scan (`detectSite()`) is a zero-cost HTTP fetch+parse, deliberately built with no Browserbase/Playwright dependency. Links 1-3 cannot be produced without a real browser (synthetic click-id injection, cookie/storage capture, an actual form submit). Resolved by adding a narrow, lead-gen-only Browserbase scan (`runLeadGenAttributionScan()`) that runs `journeySimulator.ts` for exactly this purpose — reusing the same synthetic-injection/form-submit/L2-rule machinery this document assembles, not a new pipeline. This is a real product-cost change (a real Browserbase session per lead-gen diagnostic run), justified because the standalone flow only ever reaches it after a completed Stripe purchase, and the in-app flow is authenticated/org-scoped at the same trust level Atlas's full Audit Engine already extends to a logged-in user.
- **Which platform's click id represents "the" arrival/persistence link** wasn't specified by this document (the chain model has one verdict per link, not one per platform). Resolved in `chainOrchestration.ts`: "arrival" reuses `L2.9` directly (already a single, non-platform-specific check); "persistence" takes the worst case across every ad platform this run's *real, unprompted* traffic actually shows running (`platformTagDetected`), not every platform Atlas happened to inject a synthetic value for (which is all of them, unconditionally, regardless of whether the site runs that platform).
- **All 5 sprints shipped in one pass** rather than sequenced separately, since Sprints 1 and 3 in particular are, per this document's own §9 note, closer to assembly than to open design work.

See `CLAUDE.md`'s Completed Sprints table for the shipped file list and test counts.
