# PRD (reconstructed) · Click-ID Contention, Contradiction Guard & Settle Enforcement

**Status** · Shipped (waves W1–W5, all merged in one commit)
**Type** · Reconstructed retrospective — this document did not previously exist as a checked-in file. It is assembled from the commit message and code comments below (`contradictionGuard.ts`, `clickIdContention.ts`), which is the only surviving record of this PRD's scope. Treat it as traceability, not as the original authored text.
**Reconstructed** · 11 September 2026, as Sprint 0 of the Pre-Connection Scan Confidence Tiering sprint plan (`docs/atlas-sprint-plan-pre-connection-confidence-tiering.md`).
**Commit** `4029a2818` · "Fix click-ID contention, contradiction guard, and settle enforcement" · session `session_01U99e8oFm2D77Kp3DmR8rzn`
**Predecessor** · `docs/ATLAS_REPORT_CORRECTNESS_PROGRAMME_PRD.md` Part A, whose v1 contradiction guard this PRD's W2 rewrote.

---

## Why this existed

Reference audit `7d64f5e9` (birkenstock.com/sg) shipped five `CRITICAL` findings that each argued against themselves in their own evidence. Root cause plus the safety net that should have caught it, five waves:

## W1 — Click-ID contention

**Problem.** `journeySimulator.ts` injects all seven click IDs onto the landing URL in a single pass, so a platform family with more than one member (Google: `gclid`/`gbraid`/`wbraid`) never reflects a realistic single-click visit — a real visit carries exactly one click ID. When the site's own conversion linker is presented with all three simultaneously, it resolves the conflict and writes one, which is correct behaviour on the site's part, not a capture failure.

**Shipped.** New `clickIdContention.ts` (`partitionClickIdContention()`) routes the losing family member(s) — a family member that failed to capture while a sibling in the same family did — to `could_not_be_assessed` with contention evidence, instead of scoring them as `CRITICAL` fails. This was the "minimum option" per this PRD: it only fires when a family has a genuine winner (≥1 captured, ≥1 not); if every member of a contended family failed, that's a real capture failure with nothing to explain it away. Families: `google` (gclid/gbraid/wbraid), `meta` (fbclid), `tiktok` (ttclid), `microsoft` (msclkid), `linkedin` (li_fat_id), `openai` (oppref) — each single-member family is excluded from contention by construction.

## W2 — Contradiction guard rewrite

**Problem, two defects in the Part A v1 guard:**
1. **Wrong comparison** — it paired every click-ID capture rule against the aggregate `CLICK_ID_WRITTEN_TO_DURABLE_STORAGE`, whose own rationale is circular: that rule only evaluates identifiers it saw captured in the first place, so it trivially "passes" whenever nothing was captured to begin with. It fired on every partial capture — exactly the reference audit's situation, five times over.
2. **Wrong destination** — a fired guard appended a visible "⚠ CONTRADICTION:" evidence line onto the still-*failing* result, shipping to the client report as evidence *against* the same finding it was published under.

**Shipped.** Rewrote the pairing to each identifier's own platform linker artefact instead of the circular aggregate: gclid/gbraid/wbraid against `GCL_AW_COOKIE_PRESENT` (`_gcl_aw` can only be populated by resolving one of the three); fbclid against the `_fbc` component *specifically* of `FBP_AND_FBC_COOKIES_PRESENT` (`_fbp` is set unconditionally by the Pixel and proves nothing about fbclid capture — only `_fbc` does). No aggregate pairing exists for ttclid/msclkid/li_fat_id — omitted rather than inventing one. Changed the guard from an in-place annotator to `partitionContradictions()`, which routes a fired result to `could_not_be_assessed` — suppress, don't annotate — with an audit-time assertion guaranteeing a fired guard can never reach the report renderer.

## W3 — Settle enforcement (exclusion-derivation fix — narrower than it sounds)

**Problem.** Exclusion of coverage-degraded results from scoring was previously driven by a 7-entry hardcoded `rule_id` allowlist plus fragile quoted-step-name string matching, which missed the ~30 L4–L7 rules tagged `requires: ['conversion_surface']` entirely.

**Shipped.** `degradationSuppression.ts` now derives exclusion from that same precondition tag (`requires: ['conversion_surface']`) instead of the hand-maintained allowlist, so a rule added later is covered automatically without a matching allowlist edit.

> **Important scope note for the Confidence Tiering PRD (added during Sprint 0 reconciliation, September 2026):** despite the name, this wave is about *deriving which results get excluded from scoring* when a dependency wasn't met — it is not a retry-attempt/settle-timeout state machine, and it does not introduce a `settle_state` enum, a `settle_max_attempts` retry loop, or a run-level `run_quality` (`COMPLETE`/`PROVISIONAL`/`INSUFFICIENT`) field. None of those exist anywhere in the codebase as of this reconciliation (confirmed by exhaustive grep). The new Confidence Tiering PRD's §7 "settle contract" is genuinely new work, not a re-implementation of this wave — there is no naming collision in scope, only in the English word "settle."

## W4 — FBP/FBC scope fix and taxonomy vendor filter

**Shipped.**
- `FBP_AND_FBC_COOKIES_PRESENT`'s fail condition scoped to `_fbp` alone (`_fbc` is only ever populated from a real ad-click referrer, which a crawler-injected fbclid frequently can't reproduce).
- The naming-convention taxonomy rule now filters vendor-emitted events (`gtm.*`, `web-vitals`, `OneTrust*`, `Optanon*`) before evaluating naming-convention violations.

(Referenced elsewhere in code as "W4.1": `contradictionGuard.ts`'s contradicting-fact check for fbclid reads the `_fbc`-specific evidence line rather than `FBP_AND_FBC_COOKIES_PRESENT`'s overall status, precisely because that overall status became `_fbp`-driven from this wave onward.)

## W5 — PDF glyph fix and dataLayer display names

**Shipped.** Replaced a WinAnsi-unsafe glyph in the PDF; derived a real display name for unnamed/array-shaped dataLayer pushes instead of printing blank.

## Methodology note

Regression fixtures for this PRD are grounded in the real `7d64f5e9` audit data (pulled via Supabase) rather than guessed shapes — the same standard the new Confidence Tiering PRD's §14 acceptance criteria set for replaying `c9486929-4f8b-4179-8e09-97f610815fba`.

## What this means for the Confidence Tiering PRD

- **`FBP_COOKIE_PRESENT`/`FBC_COOKIE_PRESENT` split (new PRD §10.4):** this PRD's W4 already scoped `FBP_AND_FBC_COOKIES_PRESENT`'s pass/fail to `_fbp` alone as a fix, but the composite rule itself was not split into two rules. The new PRD's split is still real, additive work — it should build on W4's `_fbp`-only fail logic for the new `FBP_COOKIE_PRESENT` rule, and can reuse the existing `_fbc`-presence evidence check (already used by `contradictionGuard.ts`'s fbclid spec) for `FBC_COOKIE_PRESENT`'s (always-`INCONCLUSIVE`) logic.
- **Cross-signal consistency (new PRD §6):** `clickIdContention.ts` and `contradictionGuard.ts` together are the *entire* existing cross-signal mechanism, and both are narrow, hardcoded spec lists (2 entries in the guard, 6 platform families in contention) that explicitly decline to generalize further ("no aggregate pairing exists for ttclid/msclkid/li_fat_id — omitted rather than inventing one"). Sprint 4 of the new plan should decide whether these get absorbed into the new general `CONF_01`–`CONF_05` engine or kept as pre-filters feeding it — they do not need to be duplicated.
- **`could_not_be_assessed` routing:** both `partitionClickIdContention()` and `partitionContradictions()` already write into the same undifferentiated `UnassessableFinding{rule_id, step, reason}` bucket that `coverageSuppression.ts` and `degradationSuppression.ts` also write into. The new PRD's verdict lattice (`NOT_OBSERVED`/`INCONCLUSIVE`/`CONFLICT`) needs a discriminant field added to this type and all four producers reclassified into it — conceptually, contention/contradiction are `CONFLICT`-shaped and coverage/degradation are `NOT_OBSERVED`-shaped, but this is a judgement call for whoever implements Sprint 2, not a settled fact from this PRD.
