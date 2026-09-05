# Atlas V2 — Signal Health Report: Evidence Integrity & Presentation PRD

**For:** Claude Code
**Repo:** `AtlasV2` (new branch `claude/report-evidence-integrity`)
**Owner:** Vikram Jeet Singh
**Date:** 2026-09-05
**Baseline commit:** `756722b` (PR #370)
**Reference report:** audit `6e3b260d-ea13-4543-b68a-3af01f0afb22` (openart.ai, 5 Sep 2026)

---

## 1. Goal

Make the client-facing Signal Health Report trustworthy to a technical reader.

The measurement engine is not the problem. Check Register v2 produced correct
findings for the reference audit. The problem is that `pdfGenerator.ts` truncates,
mislabels and over-claims on the way to the page, in ways that make a correct report
look self-contradictory.

This is a credibility change, not a feature. Every item below was found by reading one
generated report as a sceptical buyer would.

## 2. Relationship to existing work

`docs/atlas-sprint-plan-signal-health-report-fixes.md` covers seven earlier issues.
Sprints 1 to 5 and 7 are merged and verified present on `main` (the `Math.round`
lifetime fix is live in `L3.ts`, and the "Contact support for details on this rule."
fallback no longer appears in generated copy).

**Sprint 6 of that plan is still open and is folded into this PRD as W3.** Do not
implement it twice. The product decision it was gated on is made in §5 below.

Everything else here is new and was not in that plan.

---

## 3. Root causes, verified against the tree

### 3.1 Evidence is silently truncated to three items · this is the headline defect

`pdfGenerator.ts` line 551:

```ts
const evidenceItems = (vr?.technical_details?.evidence ?? []).slice(0, 3);
```

No overflow indicator, and no guarantee that the items driving the failure are among
the three shown. In the reference report this produced what looks like a
self-contradicting document:

- Item #11 `STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW` states in its message that
  `ttclid` is the violating cookie (1d, needs 7d), then lists evidence for gclid,
  fbclid and msclkid only. `ttclid` is the fourth cookie and was cut.
- Item #9 `UTM_PARAMETERS_CAPTURED` says 0 of 5 captured, then lists three.

A reader who checks the evidence against the claim concludes the tool is broken. It is
not. It is discarding its own proof.

Line 601 compounds this by truncating each evidence string at 130 characters.

### 3.2 Remediation copy is truncated mid-sentence

Lines 582 and 589 (and 513, 516 on the summary path):

```ts
? issue.fix_summary.slice(0, 117) + '…'
```

Sprints 3 and 4 existed to author real remediation copy for the v2 register. The
renderer then cuts it at 117 characters, producing output like
"verify with GTM Preview mode or the platform's own pixel-helper extension that …".
This is the most valuable content in the report and most of it never reaches the page.

### 3.3 Page labels are hardcoded strings

Lines 316, 375, 413, 422, 530, 557, 625, 650 each pass a literal such as
`'Page 2 / 5'` to `pageHeader()`. Continuation pages reprint the same label, so the
reference report shows "Page 2 / 5" twice and "Page 4 / 5" three times while actually
running to eight pages.

### 3.4 The journey breakdown graphic renders no information

Lines 341 and 361 truncate each stage label to fit its box. At the current box width
every one of the eleven labels collapsed to an ellipsis, producing a row of
`' … ›' … ›' … ›'`. The graphic occupies a third of page two and communicates nothing.

### 3.5 The same quantity is reported three different ways

- Business Summary: "9 critical issues"
- Rule Overview (line 303, `computeRuleOverviewStats`): "40 rules validated · 23 passed
  · 16 failed · 1 warning"
- Runtime Action Items (line 535): "17 issues found"

All three are internally correct · 17 is failures plus warnings, 9 is the
critical-severity subset. Nothing on the page says so, so they read as three
conflicting counts of the same thing.

### 3.6 Composite scores are layer-scoped but presented as global qualities

`scoring.ts` scopes each score to a narrow layer set:

| Score | Layers |
|-------|--------|
| Attribution Risk | L2 click_id_capture, L3 storage_durability |
| Optimization Strength | L6 parameter_completeness, L7 identity_match_quality |
| Data Consistency | L12 hygiene_integrity |

In the reference audit **L6 was excluded from the scan entirely** and L7 passed all its
checks. `scored()` drops skipped results, so Optimization Strength was computed from L7
alone, hit `passRate >= 1`, and rendered as **"Strong · sufficient signals for smart
bidding"** on a report that also declares Meta "Broken" with no pixel and no conversion
event anywhere on the site.

`strengthLevel()` handles `applicableCount === 0` but has no notion of *partial*
coverage. A confident label computed from one of two constituent layers is
indistinguishable on the page from one computed from both.

Attribution Risk has the same shape of problem in reverse: Meta having no pixel at all
is not in L2 or L3, so it does not move the score.

### 3.7 Findings are attributed to pages that were never visited

The reference scan reached 2 of 3 requested pages. `onboarding` resolved to
`fallback_landing` and the landing page was substituted. The report then states, as a
finding, "2 JavaScript error(s) on the conversion surface ("onboarding")".

That is a claim about a page nobody visited, presented with the same confidence as
every other finding. It is the single most damaging line in the document. `StepCoverage.source`
already carries `'fallback_landing'` and `pdfGenerator.ts` already renders it in the
Scan Coverage block; what is missing is any cross-reference from rule evidence back to it.

### 3.8 Minor

- Line 680: the Impact Level column needs a footnote explaining that a CRITICAL check
  showing PASS is good news. A column requiring a paragraph of disambiguation is the
  wrong column.
- The footer reads `atlas.io`, which is not the product's domain.
- Business Summary sentences are concatenated without terminal punctuation:
  "...missing a base tag Also affecting results: No GA4 collect request detected Fix
  this first...".

---

## 4. Scope

**In scope:** `backend/src/services/export/pdfGenerator.ts`,
`backend/src/services/validation/register/scoring.ts`, the business summary narrator,
and the rule-evidence-to-`step_coverage` cross-reference.

**Out of scope:** any change to rule logic in `register/L*.ts` (except the L2/L3
investigation in W9, which is diagnostic only), the web report view, and re-running or
re-storing historical audits. Do not regenerate `CLAUDE.md` in this PR.

---

## 5. Product decision (previously blocking Sprint 6)

**Decided: suppress, do not annotate.**

When a step resolves to `fallback_landing`, any rule result whose evidence cites that
step by name is removed from the client-facing findings and listed under a new
**"Could not be assessed"** heading, with the reason. It does not appear in Action
Items, does not count toward any issue total, and does not contribute to any score.

Rationale: one false finding costs more credibility with a technical buyer than ten
omitted true ones. An annotated-but-present finding still reads as a finding.

---

## 6. Work items

Sequenced by damage done. W1 to W3 are the ones that change whether the report can be
sent to a client.

### W1 · P0 · Stop truncating evidence

`pdfGenerator.ts` ~551, ~601.

- Order evidence so that items referenced by the rule's failure message come first.
  Where the rule exposes violating items distinctly, render those before the rest.
- Raise the cap and render an explicit `+ N more` line when items are omitted. Never
  omit silently.
- Where the evidence list flows past the page break, continue it on the next page
  rather than cutting.
- Line 601's 130-character per-item cut should wrap rather than truncate. Truncate only
  the genuinely unbounded case (URLs), and when doing so keep the informative end of
  the string, not the first 127 characters of a query string.

### W2 · P0 · Stop truncating remediation copy

`pdfGenerator.ts` ~513, ~516, ~582, ~589, and `~99`.

Wrap and flow `fix_summary` and `problem` to their natural length. Both already render
inside a bounded content width; height is the only constraint and pages are cheap.
If a hard ceiling is still wanted, set it well above the longest authored string in the
remediation data rather than at 117 characters.

### W3 · P0 · Coverage suppression (Sprint 6)

Implement §5. Cross-reference rule evidence against `StepCoverage.source`; route
affected results to a "Could not be assessed" section; exclude them from issue counts
and from `scoring.ts`.

### W4 · P1 · Reconcile the counts

Derive all three from one source and make the relationship explicit on the page.
Suggested wording: `40 checks · 23 passed · 16 failed · 1 warning` in the Rule
Overview, and `17 action items, 9 of them critical` as the Action Items heading, with
the Business Summary using the same two numbers.

### W5 · P1 · Coverage-aware composite scores

`scoring.ts` and `pdfGenerator.ts` ~214 to ~246.

- Each score must know how many of its constituent layers actually ran. If any is
  skipped, the score is rendered as indicative and labelled with its coverage, or
  suppressed. Do not print a confident qualitative label computed from a partial layer set.
- Gate the qualitative wording on critical failures: nothing renders as "Strong" or
  "Low risk" while a declared platform is Broken.
- Rename the labels to match their actual scope, or widen the layer sets so the names
  are true. Either is acceptable; the present state, where the name promises more than
  the computation covers, is not.
- Header composite (62/100) should state its coverage: `62/100 across 7 of 11 stages scanned`.

### W6 · P1 · Real page numbering

Replace the eight hardcoded `'Page N / 5'` literals with a computed label. Section name
stays; the number comes from actual page count, resolved after layout.

### W7 · P2 · Journey breakdown graphic

`pdfGenerator.ts` ~341, ~361. Either render `L0`…`L12` with a legend beneath, rotate
the labels, widen the boxes, or remove the graphic. A row of ellipses is worse than
nothing because it looks like a rendering failure.

### W8 · P2 · Appendix column and footer

Show severity only on failing rows; leave passes unadorned and delete the footnote at
line 680. Correct the footer domain.

### W9 · P2 · Investigate the L2/L3 ttclid disagreement

Diagnostic only, no fix in this PR unless it proves trivial.

`TTCLID_CAPTURED_AT_LANDING` reported `cookie["ttclid"]: false` while
`STORAGE_LIFETIME_MEETS_ATTRIBUTION_WINDOW` found a `ttclid` cookie with a 1-day
lifetime, in the same audit. Working hypothesis: the two rules observe at different
points in the page lifecycle, and the TikTok pixel sets its own `ttclid` cookie after
the landing check has run. If confirmed, both results are correct and the report needs
to say when each observation was taken. Write up the finding; do not change rule
semantics on a guess.

### W10 · P2 · Business summary punctuation

Terminate sentences in the narrator's assembled output.

---

## 7. Acceptance criteria

- Regenerating the reference audit produces a report in which **every failure message's
  claim is supported by evidence visible on the page**, or is explicitly marked as
  having more items than shown.
- No remediation instruction ends mid-word.
- No finding names a step that resolved to `fallback_landing`.
- No two numbers on the page describe the same quantity without their relationship
  being stated.
- No qualitative score reads "Strong" or "Low" while any platform is rated Broken.
- Page labels match the document's real length.
- `npm run build` passes in both workspaces; existing `pdfGenerator.test.ts` and
  `scoring.test.ts` suites pass or are updated deliberately.

## 8. Tests

- Evidence with 8 items renders all or renders `+5 more`; never 3 silently.
- A rule whose violating item is 6th in the evidence array renders that item.
- A `fix_summary` of 400 characters renders complete.
- An audit with one step at `fallback_landing` excludes that step's rules from Action
  Items and from scores, and lists them under "Could not be assessed".
- A score whose constituent layers are partly skipped does not render a confident label.
- A report spanning 8 pages numbers them 1 to 8.

## 9. Notes

- Historical stored reports are not regenerated. Their PDFs remain as issued.
- W5 changes published scores. Any client who has seen an earlier report may see a
  different number for the same site. That is correct, but note it in the PR so support
  is not surprised.
- The reference audit is worth keeping as a regression fixture. Nearly every defect in
  this PRD is visible in that single output.
