# Sprint Plan · Google Stack Alignment

**Source** · `ATLAS_GOOGLE_STACK_ALIGNMENT_PRD.md` (**not in this repo** — held externally by the product owner) and its review workbook `Atlas_Google_Stack_PRD_Review_Summary1.xlsx` (12 exec-summary findings, 10 recommended changes C1–C10, a target-architecture table and a 13-item priority roadmap).

**Status** · Nothing in this plan is built. Two items are partially done from prior sprints (C8, C10 — see "Already shipped" below). Sprint 1 is urgent: it repairs live production breakage, not a future risk.

**Related, already-shipped prior work** (read before touching the generators) · `docs/ATLAS_REPORT_CORRECTNESS_PROGRAMME_PRD.md`, `docs/atlas-sprint-plan-site-eval-coverage.md`, `docs/ATLAS_L11_RECONCILIATION_SCOPING.md`. CLAUDE.md's "Key Technical Decisions" §14 and §22 are directly load-bearing here.

---

## Corrections to the review workbook

The workbook is accurate on architecture but its evidence was read against a tree that has since moved, and one finding is materially understated. Apply these before using it as a spec.

**1. The Google Ads API situation is breakage, not drift.** The workbook says call sites are "hard-coded to old versions (v17/v18)." Both versions are *already sunset*: v17 on 4 June 2025, v18 on 20 August 2025. Every Google Ads API request Atlas makes has been failing for 12–15 months. This reframes C1 from "upgrade before it bites" to "several shipped features do not work." It also means the Sept 2026 auth change — the thing C1 leads with — is the *smaller* half of that item.

**2. There are seven Google Ads call sites, not the "several modules" the workbook implies.** Full list in Sprint 1.

**3. `submitGoogleConversionAdjustment()` was built against a dead endpoint.** Shipped in the Google & Meta Platform Compliance sprint (`cb26ac8`) pinned to `GOOGLE_ADS_API_VERSION = 'v17'`. CLAUDE.md records that sprint as "spike confirmed viable, `uploadConversionAdjustments` unaffected by either 2026 Google Ads API migration wave." The *method* is unaffected; the *version* it targets is dead. That feature has most likely never succeeded against live Google. Verify against production logs in Sprint 1 rather than assuming it works.

**4. C8 (sGTM) is partially shipped and the workbook's evidence is stale.** It says "generated GA4 config disables server-container routing." Not true since `b94eacd`: `gtmContainerGenerator.ts:934-937` emits real `enableSendToServerContainer` + `serverContainerUrl`, wired end-to-end via `outputGenerator.ts:83` off a verified `client_platforms` sGTM row. What remains of C8 is the rest of its scope — server-container generation, separate web/server linker rules — and note it is built on the legacy `gaawc` tag, so Sprint 4 will have to carry it across.

**5. C10 is half shipped.** CLAUDE.md already documents Data Manager `events:ingest` and flags `uploadClickConversions` as migrated off. Only the explicit API-responsibility-boundary documentation remains.

**6. C3 is worse than "two generation paths that could drift."** `composableOutputGenerator.ts:48-105` does not emit valid GTM. It uses `type: 'flc'` — a **Floodlight Counter** — for a tag named "Atlas — Conversion Linker" (line 81); `firingRuleId: ['{{All Pages}}']` where GTM's field is `firingTriggerId` with numeric IDs; and types the whole container `unknown[]`, bypassing the `GTMTagDef` types the Planning path uses. Treat C3 as "one path is broken and needs replacing," not "unify two working renderers." Confirm by attempting a real GTM import before scoping.

**7. A discontinuity the workbook does not mention will fire the moment Sprint 1 lands.** Google finished removing the first-click, linear, time-decay and position-based attribution models in **September 2026**; every conversion action still on one was force-migrated to data-driven. Only data-driven and last-click remain. `configDiff.ts:108-125` diffs stored expected `attribution_model` against observed and raises a config-drift finding on mismatch — so repairing the sync will produce a wave of findings that are Google's forced migration, not client misconfiguration. Sprint 1 must seed a `platform_discontinuities` row alongside the version fix.

### Verification caveat — read this before trusting the version facts

`developers.google.com`, `ads-developers.googleblog.com` and the trade sources are **egress-blocked in the Claude Code sandbox**. Every version, sunset date and field-removal fact in this plan was triangulated from search summaries across independent outlets, consistent across all of them, but **not read off Google's primary release notes**. This repo has been burned by exactly this before (CLAUDE.md §14 — the DMA schema drift). Before relying on Sprint 1's GAQL conclusions, run one live `googleAds:search` against v24 from an environment with egress and confirm query #1 returns rows. That live call is also the seed for Sprint 2's fixtures.

---

## Already shipped (do not rebuild)

| Item | State | Evidence |
|---|---|---|
| C8 sGTM browser→server routing | Partial | `gtmContainerGenerator.ts:934-937`, `outputGenerator.ts:83` |
| C10 Data Manager doc correction | Half | CLAUDE.md Offline Conversions entry |
| Offline conversion ingestion on DMA | Done | `googleOfflineUpload.ts`, `dmaClient.ts` — unaffected by the Ads API breakage |

---

## Sprint 1 — Restore Google Ads API connectivity (C1) · P0, urgent

Repairs live breakage. Nothing else in this plan matters while every Ads API call 404s. Target **v24** (sunsets May 2027; v25 is current but sunsets Aug 2027 and buys nothing here).

### 1.1 Centralise the version

Seven call sites, five of them on `v18` and two on a `v17` constant:

| File | Line | Current | Feature it breaks |
|---|---|---|---|
| `reconciliation/sync/googleAdsSync.ts` | 6 | `v18` | Config reconciliation |
| `reconciliation/sync/googleAdsStatsSync.ts` | 5 | `v18` | Volume/delivery diffs |
| `connections/connectionTester.ts` | 6 | `v18` | "Test connection" |
| `connections/discovery/googleAdsDiscovery.ts` | 4 | `v18` | Post-OAuth account discovery |
| `air/ingestion/googleAdsConnector.ts` | 18 | `v18` | AIR nightly ingestion |
| `offline-conversions/googleOfflineUpload.ts` | 54 | `v17` | `fetchConversionActions()` |
| `capi/refundDelivery.ts` | 299 | `v17` (imported) | Conversion adjustments |

Replace with one exported constant. Put it next to the existing `GOOGLE_ADS_API_BASE` in `googleOfflineUpload.ts` or, better, a new `backend/src/integrations/google/adsApiVersion.ts` — `refundDelivery.ts` already imports the version across a module boundary, so a shared home is cleaner than a re-export chain. Add a comment recording the sunset date so the next drift is visible.

### 1.2 GAQL compatibility — verified clean

All seven queries were checked field-by-field against v24's removals (`campaign.video_brand_safety_suitability`, `segments.ad_sub_network_type` on `campaign_budget`, the `KeywordPlanIdeaService` forecast fields, the `InsightsAudience` redefinitions, `LOYALTY_SIGN_UPS`). **None are touched.** Customer Match runs through Data Manager `audiencemembers:ingest`, not the Ads API user-list service, so that removal misses Atlas too. `searchStream` and `search` both still exist.

One field to clean up: **`conversion_action.include_in_conversions_metric`** (`googleAdsSync.ts:61`), deprecated in favour of `primary_for_goal`, which the same query already selects. Still selectable, so it will not fail — but its value lands in `platform_state_cache.include_in_conversions` and **nothing reads that column** (`configDiff.ts:65` does not select it). Drop the field from the query and the write at `googleAdsSync.ts:99`. Leave the column in place; dropping it is a migration for no benefit.

### 1.3 Seed the attribution-model discontinuity

New migration seeding `platform_discontinuities` for Google Ads' September 2026 removal of first-click / linear / time-decay / position-based. Follow `20260915001_meta_attribution_window_discontinuity.sql` exactly — same shape, same prose register. `discontinuityDiff.ts` already runs first in `reconciliationRunner.ts`'s `executeRun()`, so a seeded row is all that is needed for the annotation to appear.

Per the register's existing precedent, if the exact effective date cannot be confirmed against a primary Google source, **leave `effective_date` null** rather than asserting false precision.

### 1.4 The 2026 auth/access model — audit, not code

Developer tokens sunset **9 September 2026**. Access levels now attach to the **Google Cloud project** used to generate the OAuth credentials, not the token. Google auto-transferred existing access by inspecting the last 90 days of call logs — **Atlas's calls were all failing during that window**, so there may be no recent successful activity for Google to have attributed access from. Check this in the Cloud Console before assuming the transfer landed.

Developer-token headers are now optional and ignored; Google will reject them in an unnamed future major version. `buildGoogleAdsHeaders()` (`googleOfflineUpload.ts:82-92`) still sends one. **Leave it for now** — removing it is a separate change with its own risk and no current benefit. Record the decision in the file.

This sub-sprint is ops work: verify the Cloud project's access level, confirm Basic vs Standard, confirm the OAuth client in `GOOGLE_OAUTH_CLIENT_ID` belongs to that project. No code change expected.

### 1.5 Verify, don't assume

Before closing: confirm against production logs whether these paths were failing silently. `googleAdsConnector.ts` and the reconciliation syncs most likely return empty rather than erroring loudly, which would explain quiet zeros in AIR and reconciliation. Specifically check whether `submitGoogleConversionAdjustment()` has ever succeeded (see Correction 3) and say so plainly in the sprint writeup either way.

**Acceptance** · All seven call sites on one v24 constant. A live `googleAds:search` returns rows for query #1. The attribution discontinuity is seeded and annotates a real reconciliation run. The conversion-adjustment path's true historical status is stated, not assumed.

---

## Sprint 2 — Golden fixtures before generator surgery (C9) · P1, sequenced early

The workbook puts C9 eighth. Move it second: it is the only safety net for Sprints 3–6, and the roadmap's own note says "add before risky generator changes where possible." Building it after the migration tests nothing.

Fixtures must encode **architectural scenarios**, not raw snapshots (C9's stated gap): legacy `gaawc`, `googtag`, mixed migration, cross-domain, enhanced conversions, sGTM-enabled. Land them against current (pre-migration) output so Sprints 3–6 have a real before/after diff.

Target `backend/src/services/planning/generators/__tests__/` alongside the existing `nlcs.integration.test.ts` / `renderer.test.ts` / `validator.test.ts`, which are behavioural assertions with no fixtures today.

Seed at least one fixture from a **real GTM export**, not generated output — the whole point is catching drift between what Atlas emits and what GTM accepts.

**Acceptance** · Fixture suite fails when a tag type, parameter name or firing shape changes. At least one fixture is real GTM export data.

---

## Sprint 3 — Canonical Google tag architecture + shared renderer (C2 design, C3) · P0

Design before migration. C2's real content is not "swap `gaawc` for `googtag`" — it is defining the Google tag as the canonical sitewide Google configuration layer serving explicit destinations, which is a different mental model from GA4-config-first.

Deliver a shared renderer/schema both generators consume. Read Correction 6 first: `composableOutputGenerator.ts` is not a working second implementation to unify with, it is broken output to replace. Confirm that by attempting a real GTM import of its output before scoping the work.

Note the existing relationship: `gtm.renderer.ts` is already consumed *by* `gtmContainerGenerator.ts` (it is not an independent path). The genuine divergence is Planning vs. Composable Signals, not Planning vs. renderer.

**Acceptance** · Equivalent inputs produce equivalent Google infrastructure across Planning and Composable Signals. Exactly one sitewide Google tag architecture. Destination IDs explicit and testable. Composable output imports into GTM without error.

---

## Sprint 4 — `gaawc` → `googtag` migration + cross-domain rewrite (C2 execution, C5) · P0

**These two ship together — this is a hard coupling, not a convenience.** `GA4_CROSS_DOMAIN_LINKING_MISSING` (`tagConfiguration.ts:745`) filters on `t.type === 'gaawc'` and returns `skipped` when none is found. Migrate the generator without rewriting the rule and the check does not fail loudly — it silently passes on every migrated container. Shipping C2 alone actively creates a blind spot.

Preserve legacy `gaawc` read support for auditing existing client containers (roadmap item 9). Migration changes what Atlas *generates*; it must not change what Atlas can *read*.

C5's own scope: model cross-domain measurement as its own capability, validated across container config, domain decoration and GA4 Admin state — explicitly separate from whether a Conversion Linker is needed.

Carry Sprint 1's sGTM routing (`enableSendToServerContainer` / `serverContainerUrl`) across to the new tag type. Verify the parameter names against a live GTM export — the existing in-file comment at `gtmContainerGenerator.ts:915-923` already flags that they were confirmed via secondary sources only.

**Acceptance** · No duplicate GA4 config path. Cross-domain tests verify expected domains and mismatch states independently of linker presence, and fail loudly on a `googtag` container. Legacy containers still audit correctly. sGTM routing survives the migration.

---

## Sprint 5 — Attribution infrastructure decision engine (C4) · P0

Replace the blanket rule at `gtmContainerGenerator.ts:963` — currently `if (hasGoogleAds)` → unconditional `gclidw` on All Pages — with a decision engine keyed on Google tag presence/firing, sGTM, cross-domain need, and Ads/Floodlight. Web linker, cross-domain linking and server-side linker are three different concerns; the current single boolean conflates them.

Depends on Sprint 4: linker necessity is partly a function of what the sitewide Google tag already does.

**Acceptance** · Fixtures cover single-domain web, cross-domain web, no-sitewide-tag, and sGTM cases. No redundant linker emitted where the Google tag already covers it; attribution preserved in every case.

---

## Sprint 6 — User-Provided Data + SHA-256 removal (C6, C7) · P0 / P1

**C6** · `gtm.renderer.ts:210-212` sets `enhancedConversionsEnabled` on each `awct` event tag and maps email + phone only. Move to User-Provided Data at the Google tag architecture level, with event overrides where genuinely needed, supporting available identity and address fields. `client_identity_configs` already carries first/last name, postal code, country and external ID — the mapping exists, the renderer just ignores it.

Must be consent-aware and must not require fields a client does not have.

**C7** · Delete the `CJS - SHA256 Hash` variable (`gtmContainerGenerator.ts:352-366`). It normalises input and returns it **unhashed** behind `return input; // TODO: implement SHA-256 hashing`, and nothing generated consumes it. Prefer supported Google/GTM hashing and normalisation mechanisms. Only implement custom hashing if a concrete generated path needs pre-hashed input — and if so, implement it properly rather than shipping the stub.

Grouped because both touch how user data reaches Google, and C7 is a deletion that becomes trivially safe once C6 settles what actually does the hashing.

**Acceptance** · Email, phone and available address fields supported; consent-aware; no misleading plaintext SHA256 variable ships.

---

## Sprint 7 — sGTM as first-class generated architecture (C8 remainder) · P1

Sprint 1 shipped browser→sGTM routing. Remaining: server-container generation (Google destinations inside sGTM), separate web/server linker rules, and turning `SGTM_ROUTING_NOT_CONFIGURED` from a diagnosis into a remediation.

Live schema verification is a hard prerequisite — the existing routing parameters were confirmed via secondary sources only. Do not extend this surface on training-data assumptions (CLAUDE.md §14).

**Acceptance** · An sGTM-enabled setup routes successfully and passes DQM reachability and routing checks.

---

## Sprint 8 — Delivery confirmation & DQM alerts · P1

Neither Google delivery path confirms delivery. `googleDelivery.ts:219-231` and `googleOfflineUpload.ts:192-208` both document this explicitly: `events:ingest` returns `{requestId, fieldWarnings}` — submission acknowledgement, not per-event confirmation — and both return `delivered` / `uploaded` on a 2xx.

Implement bounded async `requestStatus:retrieve` polling, persist warnings and failures, surface deduplicated DQM alerts through the existing `dqmAlertDelivery.ts` path.

Independent of all GTM work — can run in parallel with Sprints 3–7 if there is capacity.

**Acceptance** · Per-event delivery truth distinguishable from submission acknowledgement. Warnings persisted and surfaced once, not per-poll.

---

## Sprint 9 — Documentation boundaries (C10 remainder) · P1

Half done (Correction 5). Remaining: document the API responsibility split explicitly — **Google Ads API for account, read and config operations; Data Manager API for offline conversion ingestion and delivery**. Update CLAUDE.md and the module headers.

Fold in whatever Sprint 1 learns about the dead-endpoint period; that history is worth recording so the next person does not re-derive it.

Finish after implementation, per the roadmap.

---

## Backlog (P2, unscheduled)

- **Match-rate instrumentation** — exists for the Enricher/DMA audience path (`enricherService.ts:188`), nothing for enhanced-conversion user-data richness. Sequence after C6 or it measures nothing.
- **Offline source configuration** — `eventSource: 'OTHER'` hardcoded at `googleOfflineUpload.ts:151`. Independent improvement.

---

## Sequencing summary

```
1 (urgent, unblocks everything)
  └─ 2 (safety net)
       └─ 3 (design)
            └─ 4 (migration + cross-domain, coupled)
                 └─ 5 (linker)
                      └─ 6 (user data + SHA256 removal)
                           └─ 7 (sGTM remainder)
8 ──────────────────────────── parallel, independent
9 ──────────────────────────── last
```

Sprint 1 stands alone and should ship immediately. Sprints 3–7 are a single architectural thread and should not be interleaved with other generator work. Sprint 8 is genuinely independent.

## Open questions for the product owner

1. **Does the external `ATLAS_GOOGLE_STACK_ALIGNMENT_PRD.md` belong in `docs/`?** Every other programme in this repo has its PRD committed. This plan is written against a workbook summarising a document nobody in the repo can read.
2. **Is the conversion-adjustment feature believed to be working in production?** If yes, that belief needs reconciling with Correction 3 before Sprint 1 closes.
3. **How much legacy `gaawc` generation support is required after Sprint 4?** The roadmap says maintain read support for auditing. Confirm no client still needs legacy *generation*.
