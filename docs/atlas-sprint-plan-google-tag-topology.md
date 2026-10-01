# Atlas Sprint Plan · Google Tag Topology

**PRD:** `docs/prd/google-tag-topology.md` (§17 records Sprint 0's outcome and the UNVERIFIED registry)
**Branch:** `claude/epic-brahmagupta-oz081v`
**Date:** 2026-10-01

## Repo findings (2026-10-01)

- Defect 1 live: `googleTagArchitecture.ts:152` passes `hasGoogleTagFiring: Boolean(destinations.ga4)`; no Ads Google tag is ever emitted.
- Defect 2 live: `tagConfiguration.ts` `GA4_CONFIG_TAG_TYPES` (uses at ~770, ~1002) and `REQUIRED_CONSENT_TYPES` (~453); `consent.renderer.ts` `ANALYTICS_TAG_TYPES`; `gtmSchemaValidator.ts:91`. `implementationDrift.ts` and `generation.validator.ts` reference `googtag` (grep to confirm in Sprint 1).
- `anomalyDetector.ts` does not read `platform_discontinuities` (only `discontinuityDiff.ts` does): Sprint 5 AIR wiring is real work.
- Latest migration `20260920002`; new migrations start `20260921001` (`YYYYMMDDNNN_name.sql`, decision §21). `REGISTER_VERSION` `1.3.0` → `1.4.0` in Sprint 3.

## Decisions

Sprint 0 was skipped as live verification (no Google sandbox access); D1–D5 resolved to PRD defaults. See PRD §17.

## Sprints

| Sprint | Scope | Exit |
|---|---|---|
| **0** (replaced) | PRD saved to repo; §17 records D1–D5 and the UNVERIFIED registry (U1–U10). | Decisions + registry committed |
| **1** · classifier + live-audit fix (ships first, independent) | `services/google/googleTagClassifier.ts` (ID-prefix classification, CONST variable resolution, `gaawc`→`ga4`). Replace type-based checks: `tagConfiguration.ts` (`GA4_CONFIG_TAG_TYPES` both uses; `REQUIRED_CONSENT_TYPES` → `requiredConsentTypes()`), `consent.renderer.ts`, `gtmSchemaValidator.ts`, `generation.validator.ts`, `implementationDrift.ts` as grep shows. `unknown`/`GT-` findings carry `confidence: 'confirm'`. Tests per call site + GA4 regression fixture. | AC 1–3 |
| **2** · generator | Ads `googtag` in `buildGoogleTagInfrastructure()` on the GA4 tag's trigger; linker input renamed `hasAdsGoogleTagFiring` + reason strings + 7 tests; per-destination consent; Composable parity; golden fixtures + 5 scenarios; drift proof by reverting §5.2. Ads `googtag` shape marked `UNVERIFIED` (U1). | AC 4–6 |
| **3** · topology + detection | Migration `20260921001_google_tag_topology.sql` (read live CHECKs first; widen `detected_signals`); CSE capture of loaded tag IDs/destinations; verdict function; operator declaration; GTM API source spike (D1); 4 new rules + 2 modified; interpretations + `client_question`s; `REGISTER_VERSION` 1.4.0; check AW_ID_PRESENT/CONF_01–05 on a combined fixture; back-scan script; topology GET/declare routes. | AC 7–10 + back-scan list |
| **4** · remediation | `googleTagSplitPlanner.ts` (delta only, stop on conflict, `validateGTMContainer()`); migration `20260921002_google_tag_split_plans.sql`; split-plan/deploy/verify/download routes (draft only, never publish); guidance content; frontend topology card + split flow. E2E against mocked GTM API. | AC 11–13 |
| **5** · reconciliation/AIR/DQM/consent | Migration `20260921003` (`platform_discontinuities.client_id`, `kind`); `discontinuityDiff.ts` client scoping; `anomalyDetector.ts` reads discontinuities; L11 scoping doc section; `google_tag_topology` DQM check (24h/client) + `dqm_google_tag_topology` alert (widen both CHECKs, explicit insert test) + `topologySeverity()`; Consent Hub note. | AC 14–16 |

## Process

Order 0→1→2→3→4→5 (1 and 2 independent; 3→4→5 sequential). Per sprint: typecheck, tests, full backend suite (known 6 unrelated failures), CLAUDE.md update, one commit, push to the branch. No PR unless requested.

## Risks

- Sprint 2's Ads `googtag` shape is guessed (U1): must be checked against a real GTM export before any client sees generated output.
- GTM API may expose no grouping (U8): fallback is runtime + declared.
- Two migrations widen CHECK constraints: read live constraints and add insert tests.
