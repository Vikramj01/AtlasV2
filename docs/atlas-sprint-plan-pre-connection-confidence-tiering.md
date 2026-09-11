# Sprint Plan · Pre-Connection Scan Confidence Tiering

**Source PRD** · `docs/prd/pre-connection-scan-confidence-tiering.md`
**Status** · Sprints 0–1 complete. Sprints 2–8 not started.
**Related, already-shipped prior work** (read before touching the register) · `docs/ATLAS_REPORT_CORRECTNESS_PROGRAMME_PRD.md` (Parts A–D), `docs/ATLAS_CLICKID_CONTENTION_CONTRADICTION_GUARD_PRD.md` (waves W1–W5), `docs/ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` (W1–W10), `docs/atlas-sprint-plan-attribution-determinism.md`, `docs/atlas-sprint-plan-site-eval-coverage.md`.

**Decisions locked in for this plan:**
- PROVISIONAL runs render a client-facing report with the run quality stated in the header (PRD §17.1, stricter "COMPLETE only" alternative rejected — costs turnaround time on genuinely slow-to-settle sites).
- The connected (post-access) scan reuses the same rule IDs at a higher confidence ceiling — no separate connected rule registry (PRD §17.3).
- Campaign Signal Validator integration is out of scope for this plan (PRD §17.4) — a separate follow-up decision once this ships.
- The 0.60 coverage threshold (PRD §9.1.4) ships as a fixed constant; revisit only if it misbehaves against a real layer-weight profile (PRD §17.2).

**Correction to the source PRD's target path:** the PRD's §13.4 names `backend/src/services/ihc/ruleRegistry.ts` as the rule registry location. That path does not exist and that directory (`alertService.ts`, `baselineManager.ts`, `findingsWriter.ts`, `ruleInterpretations.ts`, `tagConfigurationRules.ts`) is IHC drift-check services, unrelated to the Check Register. The real v2 rule registry — already substantially built — is `backend/src/services/validation/register/engine.ts` (`REGISTER`, `runRegister()`), alongside `L0.ts`–`L12.ts`, `layers.ts`, `scoring.ts`, `reporting.ts`, `contradictionGuard.ts`, `clickIdContention.ts`. All sprints below target that path.

---

## Sprint 0 — Reconstruct the undocumented prior PRDs (done)

Two PRDs are referenced pervasively in code comments but had no doc file under `docs/`: "Report Correctness Programme" (Parts A–D, commits `5696dda3`/`2a69d053`/`b78a742f`/`29985c28`, 6 September 2026) and "Click-ID Contention, Contradiction Guard & Settle Enforcement" (waves W1–W5, commit `4029a281`, 7 September 2026). Both are now reconstructed from commit messages and code comments as `docs/ATLAS_REPORT_CORRECTNESS_PROGRAMME_PRD.md` and `docs/ATLAS_CLICKID_CONTENTION_CONTRADICTION_GUARD_PRD.md`, each ending with a "what this means for the Confidence Tiering PRD" section calling out precedent and open judgement calls for the sprints below. The new PRD itself is committed to `docs/prd/pre-connection-scan-confidence-tiering.md` per its own header.

**Resolved open question:** whether "Settle Enforcement" (W3 of the click-ID PRD) already covers this PRD's §7 settle contract. It does not — W3 is about *deriving scoring exclusion* from a rule's `requires: ['conversion_surface']` precondition tag, not a retry-policy/run-quality state machine. Exhaustive grep confirms zero hits for `settle_state`, `run_quality`, `PROVISIONAL`, `INSUFFICIENT`, `settle_max_attempts` anywhere in the repo. Sprint 1 below is genuinely green-field.

## Sprint 1 — Settle contract & run quality (PRD §7, Phase 1 — highest priority) — DONE
Shipped in commit `46af9dd`. Scoping decisions made during implementation, differing from the PRD's literal text:
- **No `crawl_pages`/`crawl_runs` changes.** The PRD's §7.1 names `crawl_pages`, but that table belongs to the unrelated Crawl Signal Extractor (CSE) feature (`services/crawl/`). The Direct Audit incidents this PRD exists to fix (OpenArt, Birkenstock) all run through the Audit Engine (`services/audit/journeySimulator.ts`, the `audits` table, per-run `StepCoverage[]` — not a per-page DB row), so all Sprint 1 work targets that path instead.
- **No new `settle_state` enum.** Reused the existing `SettleOutcome` (`'settled'|'quiet_period_cap_reached'|'navigation_failed'`, already load-bearing across L3/L5/`degradationSuppression.ts`/`coverageSuppression.ts`) rather than introducing a parallel `SETTLED|TIMEOUT|ERROR|NOT_REACHED` enum that would have meant a second source of truth for the same fact.
- **Retry policy**: `gotoAndSettleWithRetries()` (`dataCapture.ts`) — up to `settle_max_attempts` (default 2) additional attempts, escalating `navigationTimeoutMs`/`maxSettleMs` by 1.5x each retry; `StepCoverage` gains `settle_attempts`. Wired into `journeySimulator.ts`'s step loop in place of the old single-attempt `gotoAndSettle()` call.
- **`computeRunQuality()`** (`coverage.ts`) — `COMPLETE|PROVISIONAL|INSUFFICIENT` derived from `StepCoverage[]`: INSUFFICIENT when the declared conversion surface (a step distinct from landing that navigated successfully) never settled, or fewer than two steps settled overall. One implementation, reused by both `ReportCoverage.run_quality` (report header display) and a new durable `audits.run_quality` column (migration `20260911001_settle_contract_run_quality.sql`) — the export gate reads the column, never re-derives it.
- **Where "blocks client-facing render" landed**: not the `GET /:audit_id/report` read endpoint (still shows the operator the run internally, with run_quality stated in the header) — the actual gate is `POST /:audit_id/export`, which returns 409 for `INSUFFICIENT` before ever calling `getReport`/`generatePDF`. That endpoint is the real "client-facing artifact" boundary; the in-app report view is not.
- Frontend: run-quality badge in the `ReportPage.tsx` header, a distinct INSUFFICIENT banner in `ExecutiveSummary.tsx` ahead of the existing partial-coverage banner, export buttons disabled with an explanatory tooltip. Also fixed a latent bug in `auditApi.export()` — it never checked `r.ok`, so a blocked export would have silently downloaded a "PDF" containing the JSON error body.

## Sprint 2 — Evidence class, verdict lattice, severity ceilings (PRD §4, §8, §10)
Extends, doesn't duplicate: the existing binary `confidence: 'high'|'confirm'` field (`audit.ts`, derived by `deriveConfidence()` in `engine.ts`) and the existing undifferentiated `UnassessableFinding{rule_id, step, reason}` bucket that four producers already write into (`clickIdContention.ts`, `contradictionGuard.ts`, `coverageSuppression.ts`, `degradationSuppression.ts`).
- Add static `evidence_class` (`DIRECT|PRESENCE|PRESENCE_INVERSE|DERIVED|INFERRED`) + gated direction to each rule definition in the register.
- Generalize `deriveConfidence()` into the full `observation_confidence` computation (`CONFIRMED|PARTIAL|UNSUPPORTED|CONFLICTED`), replacing the binary flag.
- Add a `verdict` field distinct from `status` (`PASS|FAIL|NOT_OBSERVED|INCONCLUSIVE|CONFLICT`) per the §4.3 lattice.
- Add a `kind` discriminant (`NOT_OBSERVED|INCONCLUSIVE|CONFLICT`) to `UnassessableFinding` and reclassify the four existing producers into it (coverage/degradation → `NOT_OBSERVED`; contradiction/contention → `CONFLICT`) — see the open judgement call flagged in `ATLAS_CLICKID_CONTENTION_CONTRADICTION_GUARD_PRD.md`'s closing section.
- Severity-ceiling logic (§4.4): cap `PARTIAL` at `HIGH`/provisional-labelled, zero out `UNSUPPORTED`/`CONFLICTED`.
- Rule reclassification per §10: split `GOOGLE_GLOBAL_SITE_TAG_PRESENT` → `GTAG_LOADER_PRESENT` + `GOOGLE_ADS_AW_ID_PRESENT`; split `FBP_AND_FBC_COOKIES_PRESENT` → `FBP_COOKIE_PRESENT` + `FBC_COOKIE_PRESENT` (build on the click-ID PRD's W4 `_fbp`-only fail logic for the former; reuse the existing `_fbc`-presence evidence check for the latter's always-`INCONCLUSIVE` logic); reclassify `SERVER_CONTAINER_ENDPOINT_CONFIGURED` as `INFERRED` (never `FAIL`).
- `declaration_source` (`CLIENT_CONFIRMED|OPERATOR_ASSUMED|INFERRED_FROM_SITE`) on scope config, capping `DECLARED_PLATFORM_HAS_TAG`'s derived severity.
- Registry unit test: every rule has full classification metadata (mirrors the existing "every rule has a registry entry" pattern).
- Migration: `audit_findings` gains `evidence_class, observation_confidence, verdict, pages_evaluated, pages_in_scope, excluded_from_score, exclusion_reason, severity_capped_from, synthetic_evidence`. Bump `REGISTER_VERSION` per its documented contract (Report Correctness Programme Part D4).

## Sprint 3 — Output vocabulary binding & `outputLint` (PRD §5)
Fully new, and invasive — banned tokens are currently live in rendered strings: `pdfGenerator.ts` (literal `'Not Detected'` pills), `reporting.ts`/`generator.ts` (literal `'broken'` status), `parameterCompleteness.ts` (literal `'Missing'`).
- `backend/src/services/audit/outputLint.ts` — hard-fails render/PDF export on a banned token or an out-of-family phrasing, per §5/§5.1.
- Rewrite the identified literal strings to their permitted phrase family (depends on Sprint 2's `verdict` field to pick the right family).
- Platform verdict label remap: `Broken→No signal observed`, `At Risk→Partial signal observed`, `Healthy→Signal observed`, `Not Included→Not in scope`.
- Report Correctness Programme Part B is the direct precedent for why this needs to scan the *fully assembled* payload rather than trust any one render path to stay consistent (name-collision-driven inconsistent rendering was exactly that failure mode).

## Sprint 4 — Cross-signal consistency checker + `signal_conflicts` (PRD §6)
Partially shipped, narrow: `contradictionGuard.ts` has exactly 2 hardcoded specs and explicitly declines to generalize further; `clickIdContention.ts` covers only multi-click-ID injection artifacts. Neither touches GA4/dataLayer-vs-network conflicts or tag-inventory-vs-evidence divergence — the exact bugs in the OpenArt incident (PRD §1.1, §1.3).
- Generalize into a rule-driven consistency-assertion engine covering `CONF_01`–`CONF_05`.
- New: cross-reference `SiteSetupSummary.tags`/dataLayer inventory against register rule evidence (`CONF_03`) — the Reddit-inventory-divergence bug class; this pairing doesn't exist today.
- New `signal_conflicts` table (`id, run_id, assertion_id, entity, source_a, reading_a, source_b, reading_b, affected_rule_ids, created_at`), RLS required.
- Route conflicted rules to `verdict: CONFLICT` (Sprint 2), rendered in a "Signals in conflict" section (Sprint 6).
- Decide whether `clickIdContention.ts`/`contradictionGuard.ts` get absorbed into this engine or stay as pre-filters feeding it — recommend absorption to avoid two parallel conflict mechanisms.

## Sprint 5 — Scoring & coverage gate (PRD §9)
Extends shipped coverage measurement, doesn't rebuild it: `scoring.ts`'s `calculateV2Scores()` already computes `ScoreCoverage{layers_tested, layers_total}` via `layerCoverage()` (and Report Correctness Programme Part D already fixed the denominator itself), but today "whatever ran, scores" — no floor exists.
- Add `min_confirmed_rules` + `layer_weight` to layer declarations; compute `coverage_ratio` from them.
- Score withheld (`score: null`, `score_withheld_reason: 'INSUFFICIENT_LAYER_COVERAGE'`) below the 0.60 threshold; render the Coverage Gate panel copy from PRD §9.2.
- Sub-scores follow the same gate; remove the current "renders `Moderate` on 0-of-2 layers" behavior → `Not assessed`.
- Wire Sprint 1's `run_quality` into this computation.
- Keep this distinct from Report Correctness Programme Part D2's `not_applicable`/`not_scanned` layer-display labels — that's layer-granularity coverage *display*; this is rule-granularity scoring *exclusion*. They compose, they don't merge.

## Sprint 6 — Report restructure, auto-questions, with-access section (PRD §11, §12) — highest collision risk
`reporting.ts`/`generator.ts` are mid-refactor across multiple already-shipped PRDs (`ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md` W1–W10, the Report Correctness Programme Parts A–D, `atlas-sprint-plan-attribution-determinism.md`). `ReportJSON` already has `coverage`, `could_not_be_assessed`, `open_questions`, `register_version`.
- **First:** diff this sprint's scope against `ATLAS_REPORT_EVIDENCE_INTEGRITY_PRD.md`'s acceptance criteria so this doesn't rebuild shipped sections.
- Rename pre-connection output to "Signal Observation Report" (reserve "Signal Health Report" for connected runs).
- Reorder sections per PRD §11.2, composing with existing `coverage`/`open_questions` fields rather than replacing them.
- Extend the existing `open_question` mechanism to also fire for `NOT_OBSERVED`/`INCONCLUSIVE`/`CONFLICT` verdicts and non-`CLIENT_CONFIRMED` `DERIVED` findings.
- New with-access section: `requires_connection`/`answers_question_for`/`reveals` registry fields on connected-tier rules/modules, rendered per PRD §12.3. Every entry must resolve a real finding/question in the run — none aspirational.

## Sprint 7 — `rule_confirmations` & measured accuracy (PRD §15) — independent, can run in parallel with any sprint above
Fully new. No accuracy figure is published until the sample is meaningful (explicitly deferred per the PRD).
- New `rule_confirmations` table (`organization_id, run_id, rule_id, finding_id, outcome, source, note, created_at`), RLS required.
- Write path: a client answering an open question, or a re-scan after remediation, writes a `CONFIRMED`/`REFUTED` row.

## Sprint 8 — Acceptance replay & regression fixture (PRD §14)
- Replay audit `c9486929-4f8b-4179-8e09-97f610815fba` through the full new pipeline; assert all 10 criteria in PRD §14.
- Commit the fixture, wire into CI so it runs on every future register change — the same standard the click-ID PRD held itself to with the real `7d64f5e9` audit data.

---

**Sequencing:** 0 → 1 → 2 → {3, 4, 5 in parallel once 2 lands} → 6 (needs 3+4+5) → 8. Sprint 7 has no dependency and can start anytime.
