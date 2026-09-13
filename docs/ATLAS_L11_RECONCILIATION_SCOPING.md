# L11 Reconciliation — Scoping (not a build plan)

**Status:** Scoping only, per the Google & Meta Platform Compliance PRD §15. L11 has been
explicitly parked twice already ("not picked up unless asked again" — Site Evaluation
Coverage & Honesty Phase 4). This document exists so the next time it comes up, the
decision is a product call informed by real constraints, not a re-litigation from zero.

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

## 4. Denominator impact

`ALL_V2_LAYERS` is fixed at 13 regardless of what ships — adding real L11 rules doesn't
change the denominator's *shape*, only what fills it in. The open question is coverage
gating: `MIN_CONFIRMED_RATIO` (0.5) is computed off *this run's applicable* rules, so for
every audit with no client or no connected platforms, L11 is simply inapplicable
(0 applicable rules) and excluded from scoring, same as `not_applicable` today. The
meaningful behavior change only appears for a client-linked audit whose client **has**
reconciliation data — for that (likely minority) case, L11 rules would newly enter the
denominator, and a client with real unresolved drift would see their score reflect it for
the first time. Whether that's a wanted behavior change (vs. keeping reconciliation
strictly siloed in its own dashboard) is exactly the product call this scoping doc defers.

## 5. Recommendation

Don't build against this doc yet. Before any engineering:

1. **Product decision**: should Check Register v2 (a per-scan report, often run with no
   client or no connected platforms) ever surface a *client-scoped, connection-dependent*
   finding? This blends two features with different audiences (a marketer with no
   platform access yet vs. an agency operator with live connections) in one score.
2. If yes: confirm the precondition-tag approach in §3 against a real client with active
   reconciliation findings before writing rule files — same "verify against a live export
   before generating" discipline already applied to the sGTM field-name work.
3. Given this has been parked twice already, re-confirm it's actually wanted now, not
   just theoretically completable, before it's picked up a third time.
