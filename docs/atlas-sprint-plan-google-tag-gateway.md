# Atlas Sprint Plan · Google Tag Gateway

**PRD:** `docs/prd/google-tag-gateway.md`
**Branch:** `claude/admiring-goldberg-q3qxce`
**Date:** 2026-11-08

## Repo findings (2026-11-08, re-checked against the PRD's §1.3)

- Defect 1 live: `scoreEngine.ts` `fetchGTGActive()` (L89) is fed from `gtm_container_connections`. `gtg_active` is also read in `types/health.ts`, `healthQueries.ts`, `api/routes/dataManager.ts`, `KeyMetricsRow.tsx`, `DataManagerConsolePage.tsx` and `dataManagerApi.ts`.
- Defect 3 live: `KeyMetricsRow.tsx:145` shows `'+11% signal uplift'`, and `Step2_6GTGPreflight.tsx:70` repeats the "~11%" claim.
- Defect 4 live: hostname-keyed Google detection at `siteDetectionService.ts:171-177`, `pageCaptureService.ts:251`, `quickCheckService.ts:141-147` and `gapClassifier.ts:219-220`. `googleTagTopology.ts` and the L1/consistency call sites are not re-grepped; confirm them in Sprint 2.
- `gtgProbe.ts` exists and probes Google's CDN, not the client's domain (Defect 2).
- `services/gtg/` does not exist yet (new `cdnConfigGenerator.ts` goes there). `services/google/` already holds the topology classifier, topology and split modules.
- Latest migration is `20260924001`, so new migrations start at `20260925001` (`YYYYMMDDNNN_name.sql`, decision §21). `REGISTER_VERSION` is `1.5.0`; bump to `1.6.0` if Sprint 2 changes any rule's shape or outcome.
- Gateway-specific items in the PRD's depends-on list (`client_gtg_endpoints`, `googleEndpointMatcher.ts`) are green-field.

## Decisions

Sprint 0 is replaced (live verification is not possible from this sandbox, which blocks developers.google.com). This is the same call made for Google Tag Topology.

| # | Resolved as | Note |
|---|---|---|
| D1 | PRD default: keep the 85 cap, apply only when `not_detected` and applicable; `broken` caps; `unknown` and `not_applicable` never cap | |
| D2 | New `client_gtg_endpoints` table | |
| D3 | In-UI / automatic setup treated as unknown; shape-based detection should still work | Carried as a risk |
| D4 | Detect the legacy `/gtag/js` proxy as `legacy` with an info finding | Legacy shape is unverified; carried as a risk |
| D5 | Generated CDN config gated at Journey Builder's tier; verify and probe on all tiers | |

**Re-verify gate.** Each sprint below must re-read the Google setup page (updated 2026-11-06) before its output reaches a real client. Fixtures in Sprint 2 start synthetic and are replaced by real captures when someone with network access records them.

## Sprints

| Sprint | Scope | Exit |
|---|---|---|
| **0** (replaced) | Save this plan; record D1–D5 and the UNVERIFIED registry (PRD §13) as risks below. Add a "§17-style" decisions note to the PRD. | Decisions committed |
| **1 · Honest status (WS-A)** | Migration `20260925001`: per-client GTG status columns (`gtg_status`, `gtg_went_live_at`) and the status enum, read live CHECKs first. New `services/gtg/gtgStatus.ts` (pure): the nine-state model from PRD §5.1 and applicability from §5.2. Re-source `fetchGTGActive()` and `dataManager.ts` from status (`verified` / `verified_no_geo`), never `gtm_container_connections`. `computeOverallScore()` cap per D1. `computeNeedsAction()`: `gtg_not_deployed` only for applicable `not_detected`; new `gtg_broken`, `gtg_geo_missing`, `gtg_partial`. Copy: remove "+11%" from `KeyMetricsRow.tsx` and `Step2_6GTGPreflight.tsx` (replace with the PRD §5.3 wording); frontend types and `DataManagerConsolePage.tsx`. Back-fill script from latest CSE run, logging the before/after distribution, with the "status recomputed" note on affected clients. Initially every client resolves `unknown` (no matcher yet), so the cap lifts everywhere that was based on the old boolean. | AC 1, 10; no UI or score reads GTG from `gtm_container_connections` |
| **2 · Matcher + callers (WS-A/B foundation)** | `services/google/googleEndpointMatcher.ts` (pure) per PRD §4.1, including the ambiguous bare-`/path/` rule. Switch callers: `siteDetectionService` (script-`src` scan), `pageCaptureService`, `quickCheckService`, `gapClassifier`, `googleTagTopology` (`GTAG_JS`, `destinationOfHit`), `register/L1.ts`, `platformDetection.ts`, `signalConsistency.ts`, `dataCapture.ts` (`shouldCaptureUrl`), `siteSetupDetector.ts` heuristic 2 (GTG no longer evidence of sGTM; `unknown_first_party` widened wording). Fixtures: synthetic GTG-with-GTM, GTG-with-standalone-gtag, GTG plus sGTM; existing `openartAiC9486929` and `pureborn49448510` must give identical findings (regression gate). Wire status inputs from captures (`detected_unverified`, `not_detected`, `partial`, `legacy`). Check `GOOGLE_ADS_AW_ID_PRESENT` and `CONF_01–05` on the GTG fixture. | AC 4–7; GTG fixture produces no false "not detected", "base tag missing" or AW-missing findings |
| **3 · Registry, probing, alerts (WS-B)** | Migration `20260925002`: `client_gtg_endpoints` (PRD §6.1, RLS required), `dqm_gtg_checks` gains `client_id`/`endpoint_id`/`geo_status`; widen `health_alerts.alert_type` and `dqm_run_log.check_type` only after reading live definitions, with an explicit insert test (the `dqm_sgtm` lesson). Discovery upserts from CSE and Direct Audit captures (`source='detected'`). `gtgProbe.ts` rewrite: per endpoint, `/healthy` and `?validate_geo=healthy`, body must equal `ok` (a catch-all 200 must not pass), Atlas User-Agent, back off on 403/429, never probe an unregistered path, treat a body change as `error` not `fail`. `evaluateGTGAlert()` in `dqmAlertEvaluator.ts`: `broken` high, `verified_no_geo` medium, `partial` low; one rolled-up alert per org (health_alerts has no client dimension, sGTM precedent); `worstDqmSeverity()` / `getClientSummaries()` escalate-only. Routes: `GET /api/clients/:id/gtg`, `POST .../gtg/endpoints` (Zod), `POST .../gtg/verify`. Operator endpoint entry next to the sGTM URL capture in client setup. | AC 2, 3; `dqm_gtg` alerts fire on a deliberately broken path and on missing location headers (mocked HTTP) |
| **4 · Generator (WS-C)** | `dataLayerSpecGenerator.ts` and `journey/generators/gtmDataLayer.ts`: optional `gtg: { reservedPath }`, GTM `j.src='{path}/?id='+i+dl`, gtag `src="{path}/"`, `<noscript>` stays on Google with an explanatory comment; default to the GTG variant when status is `verified` / `verified_no_geo` / `detected_unverified`; `developerHandoffDoc.ts` states which variant and why. New `services/gtg/cdnConfigGenerator.ts` (Cloudflare, CloudFront, Fastly, Akamai, GCP, Other) from one template file embedding source URL and "last updated" date. Path suggester: random 5–6 char lowercase alphanumeric, readable override allowed, reject `/`, over 100 chars, or any `crawl_pages` URL under the path. `POST /api/clients/:id/gtg/config` (D5 tier). `Step2_6GTGPreflight.tsx` rewrite: real status line, CloudFront and Other tabs, "Verify now" runs the on-demand probe and only a pass sets `gtg_preflight_dismissed`. Topology guidance (`ihc/googleTagSplitGuidance.ts`, planner output): prefer splitting inside the GTM container for GTG clients; list extra paths and CDN config for new standalone tags. | AC 8, 9; a test domain configured only from Atlas output passes both Google checks (manual) |
| **5 · Uplift measurement (WS-D, optional)** | Record `gtg_went_live_at` on first `verified` transition (column added in Sprint 1). Pure `gtgUplift.ts`: fixed 28-day before/after windows excluding 7 days around go-live; ratio of platform-observed to backend-observed conversions with sample sizes; "insufficient evidence" below the sample floor or when `platform_discontinuities` or tracking-change rows fall in the window. Consumes L11 reconciliation inputs. Surfaces: AIR insight, KeyMetrics tile (replaces the placeholder copy from Sprint 1), Data Manager Console "GTG coverage and measured uplift" column. No fabricated chart; skip visuals without a real series (Implementation Rule 12). | One real client reports a figure with sample sizes. Deferrable without affecting Sprints 1–4 |

## Process

Order 0→1→2→3→4→5. Sprints 1 and 2 are independent and can run in either order; 3 depends on 2's matcher and 1's status; 4 depends on 3's registry; 5 depends on 1 and on L11 data. Per sprint: typecheck, tests, full backend and frontend suites (known pre-existing failures only), update CLAUDE.md, one commit, push to the branch. No PR unless requested. Migrations are written but not applied unless asked; any applied through the Supabase tool get their ledger version corrected (decision §22).

## Acceptance coverage

| AC | Sprint |
|---|---|
| 1, 10 | 1 |
| 4, 5, 6, 7 | 2 |
| 2, 3 | 1 (status model), 3 (probe inputs) |
| 8, 9 | 4 |
| 11 | every sprint |

## Risks

- **Matcher built from documented shapes, not captures** (PRD §13 registry: `/g/collect` suffix under a reserved path, which `pagead` requests move, whether bare `/path/` loads expose a tag ID). Mitigation: the matcher is shape-based and host-agnostic; replace the synthetic fixtures with real captures before reaching a client.
- **Legacy and In-UI setups unverified (D3, D4).** The `legacy` status is built on the PRD's description of the old `/gtag/js` proxy pattern; keep it an info finding until verified.
- **CDN templates can drift from Google's page.** Embedded source date, re-read before each release of Sprint 4 output.
- **Back-fill lifts many score caps at once.** Changelog note plus a per-client "status recomputed" note for one cycle.
- **Two CHECK constraints widened in Sprint 3.** Read live constraints and add explicit insert tests.
- **Probing a client's domain.** Two light GETs per endpoint per run, identified User-Agent, back-off on 403/429, only registered or detected paths.
- **Sprint 5 has no data to run on.** Production holds no reconciliation data; build and unit-test it, but the exit needs a real client.
