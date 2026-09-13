# L11 Reconciliation — Scoping + Decision

**Status: DECIDED (2026-09-13) — greenlit as disclosure-only. Ready to build; not yet built.**

The product call this document deferred (§5.1) has been made:

1. **Yes** — Check Register v2 should surface a client's reconciliation findings.
2. **Disclosure-only** — L11 findings are rendered in the report but **never enter any
   score**, in either the numerator or the denominator.

Rationale for (2), beyond the audience-blending concern §4 originally raised: scoring L11
would mean the *same site* scores differently depending on whether a client happens to have
connected platforms — directly undercutting the score-comparability work already shipped
(`20260906002_score_comparability`, `REGISTER_VERSION` stamping, `coverage_fingerprint`).
There is also established precedent for the disclosure-only shape: `ValidationResult.confidence`
is "disclosure only, never read by scoring" (Report Honesty sprint).

Sections 1-3 below stand as originally written. §4 and §5 have been rewritten to reflect the
decision; §6 records the verified implementation path.

*(Original status: scoping only, per the Google & Meta Platform Compliance PRD §15, after L11
was parked twice — "not picked up unless asked again", Site Evaluation Coverage & Honesty
Phase 4. The doc existed so the decision would be a product call informed by real constraints
rather than a re-litigation from zero.)*

## 1. What L11 would have to do

Check Register v2's `reconciliation` layer (`ValidationLayerV2` enum, `layers.ts`) already
exists as a label (`L11 · Reconciliation`) and is counted in `ALL_V2_LAYERS` — but it ships
**zero rules**. Every audit today reports it as `not_applicable`, and `scoring.ts` correctly
excludes an empty layer from both the numerator and denominator, so its absence doesn't
distort any score. This is a real gap only in the sense that a whole class of finding
(config/volume/delivery drift against a client's *actually connected* platforms) never
reaches a Check Register report, even when Atlas already has that data sitting in
`reconciliation_findings` for a client with active reconciliation runs.

## 2. Why it's not just "add rule files"

Every other layer's rules evaluate data captured **during a scan** (DOM reads, network
requests, cookie state) — resolved synchronously off `AuditData` before `runRegister()`
runs, per the "resolve outside, read inside" pattern (`connected_gtm_container_id`,
`sgtmVerified`, `product_domain_reachable`, `step_coverage` in `types/audit.ts`).

`reconciliation_findings` is structurally different:

- It's **client-scoped**, not scan-scoped (`reconciliation_findings.client_id NOT NULL`,
  `reconciliation_runs.client_id NOT NULL`) — there's no equivalent for a bare-URL or public
  scan (`audits.client_id` is nullable; the public no-login scan path has no client at all).
- It's **platform-connection-dependent** — a finding only exists when the client has
  connected Google Ads/Meta/GA4/GTM (Platform Connections) and a reconciliation run has
  actually executed (`POST /api/reconciliation/trigger` or its own schedule), which is
  wholly independent of when/whether a Check Register scan runs.
- It's **already a mature, shipped, standalone feature** (Platform Reconciliation
  Phases 1-3) with its own dashboard, tolerance config, and discontinuity annotations
  (`discontinuityDiff.ts`). L11 would not be building reconciliation — only exposing an
  existing client's existing findings inside a different report.

None of Check Register v2's current 95 rules read `reconciliation_findings` — L11 would be
**100% new rules**, not a re-home of existing ones. There is no rule today that would move
layers.

## 3. Candidate data model (sketch, not a commitment)

```
AuditData.reconciliation_summary?: {
  run_id: string;
  run_completed_at: string;
  findings: Array<{
    platform: string;
    dimension: 'delivery' | 'config' | 'alignment' | 'volume' | 'discontinuity';
    severity: 'info' | 'warning' | 'error' | 'critical';
    finding_code: string;
    resolved_at: string | null;
  }>;
} | undefined;
```

Resolved by the orchestrator (same place `connected_gtm_container_id`/`sgtmVerified` are
resolved) as: "does this audit have a `client_id`, does that client have any
`reconciliation_runs`, and if so pull the most recent run's unresolved findings." Undefined
when any of those isn't true — an L11 rule reading it would need `requires:
['client_linked', 'reconciliation_data_available']` (two new precondition tags) so an
audit with no client, or a client who's never connected a platform, gets `skipped`, not
`fail` — the same mechanism that already stops a homepage-only scan from failing
`conversion_surface`-gated rules.

Candidate rules (illustrative, not a final list):
- `RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT` — fails if the most recent run has an
  unresolved `critical`-severity `config` finding.
- `RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT` — fails on unresolved `volume` findings not
  already annotated by `discontinuityDiff.ts`'s known-discontinuity register.
- `RECONCILIATION_RUN_RECENT` — fails/degrades confidence if the client's most recent
  reconciliation run is stale (no run in N days) rather than clean.

## 4. Scoring impact — none, by decision

Because L11 is disclosure-only, **no score changes for any audit, ever.** A client-linked
audit with real unresolved drift scores exactly as it does today; the drift is reported
rather than priced in. This removes the behaviour change §4 originally worried about, and is
what preserves score comparability between a bare-URL scan and a client-linked scan of the
same site.

`ALL_V2_LAYERS` stays fixed at 13 — it is the single source of truth for *how many layers the
rule set defines* and must not shrink (Report Correctness Programme Part D1/D2; shrinking it
is the exact defect that produced "7 of 11" vs "7 of 12"). Scoring instead reads a separate
12-layer scored subset.

**One display consequence that must be handled:** `layerCoverageFromDecisions()` reports
`layers_tested / layers_total` where `layers_total = decisions.length`. If L11 is left in the
scoring decision list but can never be `scored`, every audit forever reports at most 12 of 13
and the Coverage Gate panel reads as permanently incomplete. L11 must therefore be excluded
from the *scoring* layer list, not merely forced to `scored: false` within it.

## 5. Decision

Both open questions from the original §5 are resolved (see the Status block above): L11 is
wanted, and it is disclosure-only. What remains before it ships:

1. **Verify §3's shape against real data** — confirm the precondition-tag approach against a
   live client with active reconciliation findings before writing rule files. Same
   "verify against a live source before generating" discipline applied to the sGTM
   field-name work and the DMA Discovery Document re-fetch. This is the one item from the
   original recommendation that still stands.
2. **Decide rule severities** — with no scoring impact, severity drives only report
   prominence and the Issues/Action Items ordering, so it can be set on presentation
   grounds alone.
3. **`REGISTER_VERSION` bump** — required on any rule addition (Key Technical Decision #17),
   even though these rules never score, since the constant is stamped on every report and
   read by the regression comparator.

## 6. Implementation path (verified against the code, 2026-09-13)

A trap worth recording, because the obvious approach does not work:

**`LAYER_WEIGHT` is not the lever.** It is consumed in exactly one place — `coverageRatio()`
in `scoring.ts` — and never reaches the score itself, which runs through
`weightedSignalHealth(inScoredLayers(scored(results), overallScoredLayers), severityWeights)`
using *severity* weights. Setting `LAYER_WEIGHT.reconciliation = 0` would keep L11 out of the
coverage ratio while still letting its results into the composite score via `inScoredLayers()`,
whose membership comes from `layerScoringDecisions().scored` — a purely rule-count test
(`inLayer.length > 0 && confirmed >= minRequired`). That would silently produce exactly the
scoring behaviour this decision rejects.

The shape that actually holds:

- Add a `SCORED_V2_LAYERS` constant to `layers.ts` = `ALL_V2_LAYERS` minus `reconciliation`.
  `ALL_V2_LAYERS` itself stays at 13 for display/denominator-shape purposes.
- Pass `SCORED_V2_LAYERS` wherever `scoring.ts` currently defaults to `ALL_V2_LAYERS`, so L11
  never enters `layerScoringDecisions`, `coverageRatio`, `inScoredLayers`, or
  `layerCoverageFromDecisions`. Coverage then reads "12 of 12" on a fully-covered run.
- Render L11 findings through the report's existing disclosure surfaces rather than the
  Issues/score path — `could_not_be_assessed` already carries a `kind` discriminator
  (Key Technical Decision #19), so extend that type rather than inventing a parallel bucket.
- Keep the §3 precondition tags regardless: they still decide `skipped` vs `fail`, which
  drives what the report *says* even when nothing is scored.

Add a test asserting L11 never appears in any scored layer set — this is the kind of
invariant that silently regresses, and there is precedent for guarding it (the
`PLATFORM_MATCHER_HOSTS` invariant test).
