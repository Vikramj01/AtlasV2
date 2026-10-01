# Atlas PRD · Google Tag Topology (combined tag detection, per-destination Google tags, split remediation)

**Target path in repo:** `docs/prd/google-tag-topology.md`
**Status:** Sprint 0 complete (by-default resolution, no live verification) · Sprint 1 next
**Owner:** Vikram
**Date:** 2026-10-01
**Depends on:** `googleTagArchitecture.ts`, `linkerDecisionEngine.ts`, `consent.renderer.ts`, `services/validation/tagConfiguration.ts` (IHC tag-config rules), `gtmSchemaValidator.ts`, `generation.validator.ts`, `implementationDrift.ts`, `gtmDeployService.ts` + `POST /api/gtm/deploy`, GTM OAuth (`tagmanager.edit.containers`), CSE (`crawl_runs`, `detected_signals`), `register/engine.ts` confidence model (`evidence_class`, `observation_confidence`, `confidence`, `client_question`), `platform_discontinuities` + `discontinuityDiff.ts`, DQM orchestrator + `dqmAlertEvaluator.ts`, `getClientSummaries()`, L11 scoping doc (`docs/ATLAS_L11_RECONCILIATION_SCOPING.md`)

---

## 0. Summary

Google lets one Google tag carry several destinations (for example a GA4 `G-` ID and a Google Ads `AW-` ID). This is called combining. Combination lives in Google's tag admin layer, not in the GTM container JSON, so two containers that look identical can behave very differently.

Atlas currently has no model of this, and a repo review on 2026-10-01 found that several shipped components implicitly assume every client's tags are combined, or that every `googtag` is a GA4 tag. The consequences range from a silently broken Google Ads attribution path in containers Atlas generates, to false findings in IHC audits of real client containers today.

This PRD does four things:

1. **Generator** · emit one Google tag per destination, rebase the Conversion Linker decision on the Google Ads tag, and render consent per destination.
2. **Detection** · build a Google tag topology model per client, with honest evidence classes, and new IHC rules on top of it.
3. **Remediation** · when combination is detected, flag it, give step-by-step split guidance, and generate a split-ready container delta deployable as a GTM draft.
4. **Reconciliation, DQM, consent** · treat a split as a client-scoped discontinuity, give L11 the topology as context, monitor topology drift, and close the consent gap.

---

## 1. Context and problem

### 1.1 What combining does

When destinations share one Google tag, loading that tag initialises every destination on it. Settings configured on the Google tag (cross-domain, internal traffic, consent-related overrides, enhanced measurement behaviour) are shared. One ID is the tag's primary ID, and when combining, the operator chooses which configuration survives.

Google's case for combining is mostly about hardcoded `gtag.js` installs (one snippet, one settings surface). Under GTM, which already deploys tags sitewide, most of that benefit disappears and the costs remain.

### 1.2 Claims we rely on versus claims we do not

This PRD was prompted by a practitioner post. Claims are split by evidence level. **Only Verified claims may appear in client-facing copy without a confidence qualifier** (Report Honesty precedent).

| Claim | Status | Source / action |
|---|---|---|
| A combined tag sends data to every destination when it loads | Verified | Google gtag routing docs (combined tag example sends pageviews to Analytics and conversions to Ads) |
| Splitting is done via Manage Google tag, then the split icon next to the tag ID | Verified | Google Ads / Analytics help, "Google tag management" (answer 12329709) |
| GTM setups need a Google tag for every ads product, in addition to Conversion Linker and conversion tags | Verified | Same help article, "Google tag overview in Google Tag Manager" |
| With an `AW-` ID as primary, GA4 cross-domain settings become non-editable in the GA4 UI | Practitioner-reported, reproducible | Stape community thread (screenshots). Reproduce in Sprint 0 |
| "Only the first config counts; whichever tag fires first sets settings for both" | Unverified, likely overstated | Combination asks which configuration to keep at combine time. Runtime precedence of later `config` calls is a separate question. Sprint 0 test. Never state as fact in copy |
| Splitting requires admin on the Google tag itself; GA4 admin is not enough | Plausible, unverified | Google tag has its own user list. Sprint 0 confirm |
| Combination status is visible on the GTM container overview screen | Plausible, unverified | Sprint 0 confirm in a live container |
| A `googtag` firing only for a `G-` ID captures Google Ads click IDs for Ads conversions | **Unverified, and Atlas currently depends on it** | See §1.3 defect 1. Sprint 0 test |

### 1.3 Defects found in Atlas (repo review, 2026-10-01)

**Defect 1 · Linker decision assumes combination (severity: high, generated containers)**

`googleTagArchitecture.ts` emits a `googtag` for GA4 only. No Google tag is ever emitted for the `AW-` ID. The linker decision is then called with `hasGoogleTagFiring: Boolean(destinations.ga4)`. On a single-domain, non-sGTM, non-Floodlight client, `decideConversionLinker()` therefore skips the Conversion Linker, reasoning that the sitewide Google tag "auto-captures Google click IDs for its own destinations".

The GA4 tag's own destination is GA4. That reasoning only holds if the client's `G-` and `AW-` IDs happen to be combined. On a client whose tags are split (the configuration this PRD recommends), Atlas may be generating a container with no Google Ads Google tag and no Conversion Linker, which also breaches Google's stated GTM requirement in §1.2.

**Defect 2 · `googtag` is hard-classified as GA4 everywhere (severity: high, live audits)**

`googtag` is the unified Google tag type and can carry an `AW-`, `G-`, `DC-` or `GT-` ID. Atlas treats it as GA4 in at least:

- `consent.renderer.ts` · `ANALYTICS_TAG_TYPES` contains `googtag`, so `consentPurposeForTag('googtag', …)` always returns `analytics`.
- `tagConfiguration.ts` · `REQUIRED_CONSENT_TYPES.googtag = ['analytics_storage']`, so `CONSENT_TYPE_MISMATCH` demands analytics consent on an Ads Google tag and never demands `ad_storage` / `ad_user_data`.
- `tagConfiguration.ts` · `GA4_CONFIG_TAG_TYPES = {'gaawc', 'googtag'}`, so `GA4_CROSS_DOMAIN_LINKING_MISSING` and `SGTM_ROUTING_NOT_CONFIGURED` treat a client's `AW-` Google tag as a GA4 Config tag and can raise false "GA4 tag missing linked_domains" findings.
- `MARKETING_TAG_TYPES` comment describes `googtag` as "unified GA4/Ads config", which is correct, but no code path uses the tag ID to tell them apart.
- Also to audit by grep in Sprint 1: `gtmSchemaValidator.ts` (line ~91 GA4 config detection), `generation.validator.ts`, `implementationDrift.ts` (`TAG_TYPE_TO_SIGNAL_TYPES`).

This affects any client container already containing an `AW-` Google tag, which is exactly what correctly split clients have. Atlas is currently most wrong about the clients who are set up best.

**Defect 3 · IHC is blind to combination (severity: medium)**

Every IHC rule reads container JSON. Combination is not in container JSON. `GA4_CROSS_DOMAIN_LINKING_MISSING` can pass because `linked_domains` is set in the tag while the client is locked out of GA4 cross-domain settings by an `AW-` primary ID. The rule gives false comfort in the case where cross-domain is most likely broken.

**Defect 4 · Reconciliation, AIR and consent have no topology context (severity: medium)**

Combined tags send pageviews, enhanced measurement and remarketing hits to Ads that nobody configured, a common cause of GA4 versus Ads discrepancies. L11 (greenlit, not built) has no way to cite this. A split changes data mid-stream, and AIR will read the step change as an anomaly. Consent settings on a combined tag govern every destination on it.

---

## 2. Non-goals

- Performing the split in Google's tag admin via API. Unless Sprint 0 finds a supported API for it, the split stays a manual operator action that Atlas guides and verifies.
- Publishing GTM containers. Atlas's OAuth scope is `tagmanager.edit.containers` (edit, no publish). Remediation deploys a draft workspace only. This PRD does not widen scope.
- Floodlight generation. `GoogleTagDestinations.floodlight` stays a forward-looking hook. The classifier recognises `DC-` IDs for audit purposes only.
- Hardcoded `gtag.js` installs. Topology detection may observe them via CSE, but split-ready output is GTM-only.
- Re-scoring past audits. Corrected rules apply from the next run; historical findings are not rewritten.

---

## 3. Open decisions · resolve in Sprint 0

| ID | Decision | Default if unresolved |
|---|---|---|
| **D1** | Primary topology source: GTM API (if it exposes Google tag to destination grouping), runtime observation via CSE, or operator declaration. | All three, ranked by evidence class (§5.1). The rule engine must work with whichever is available |
| **D2** | Split sequencing: split in Google admin first then publish the Atlas draft, or deploy and publish first then split. | Decided by the Sprint 0 sandbox test that measures the Ads coverage gap and double-load risk for each order |
| **D3** | Plan gating for remediation (delta container + draft deploy). | Same gate as `POST /api/gtm/deploy` today. Detection and guidance ungated wherever IHC is available |
| **D4** | Back-scan of existing clients after Sprint 1/2 ship (§6.6): internal list only, or proactive notification. | Internal list only. Client comms are an operator decision per account |
| **D5** | When topology is unknown, does `GOOGLE_ADS_GOOGLE_TAG_MISSING` fire at full severity with `confidence: 'confirm'`, or capped? | Fire at `high` with `confidence: 'confirm'` and a `client_question`. Missing Ads coverage is the expensive failure; a confirm chip is cheap |

---

## 4. Core concept · the Google tag classifier

### 4.1 Classification by tag ID, never by tag type

New module `backend/src/services/google/googleTagClassifier.ts` (pure, no I/O).

```ts
type GoogleDestinationKind = 'ga4' | 'google_ads' | 'floodlight' | 'google_tag' | 'unknown';

interface ClassifiedGoogleTag {
  gtmTagId: string;            // GTM's internal tag id
  rawTagId: string;            // as written in the tag, may be a {{variable}}
  resolvedTagId: string | null;
  kind: GoogleDestinationKind; // from the resolved ID prefix
  resolution: 'literal' | 'constant_variable' | 'unresolvable';
}

classifyGoogleTag(tag, container): ClassifiedGoogleTag
```

Prefix mapping: `G-` → `ga4`, `AW-` → `google_ads`, `DC-` → `floodlight`, `GT-` → `google_tag` (a Google tag ID not tied to one product, which is itself a combination candidate), anything else → `unknown`.

Resolution rules:

- Atlas's own generator writes the ID through `{{CONST - GA4 Measurement ID}}`-style constant variables. The classifier must resolve constant (`c`) variables from the same container JSON. This is not optional; without it every Atlas-generated tag classifies as `unknown`.
- A tag ID sourced from a lookup table, dataLayer variable or anything non-constant resolves to `unresolvable` and `kind: 'unknown'`. Never guess from the tag name.
- `gaawc` (legacy) classifies as `ga4` without resolution, since that type is GA4-only.

### 4.2 Replace type-based checks everywhere

Every place listed in §1.3 defect 2 switches from `tag.type` membership to `classifyGoogleTag(...).kind`:

- GA4-only rules (`GA4_CROSS_DOMAIN_LINKING_MISSING`, `SGTM_ROUTING_NOT_CONFIGURED`) consider `gaawc` tags plus `googtag` tags whose kind is `ga4`. A `googtag` of kind `unknown` or `google_tag` is considered too, but any finding raised from it carries `confidence: 'confirm'`.
- `REQUIRED_CONSENT_TYPES` becomes a function `requiredConsentTypes(tag, container)`: `ga4` → `analytics_storage`; `google_ads` / `floodlight` → `ad_storage`, `ad_user_data`; `google_tag` / `unknown` → union of both, with `confidence: 'confirm'`.
- `consentPurposeForTag` gains an optional resolved ID argument. Callers in the generator always pass it. Audit-path callers pass it when resolvable.

Rationale for doing this first (Sprint 1): it fixes live audit inaccuracy on real clients independent of everything else in this PRD.

---

## 5. Workstream A · Generator

### 5.1 One Google tag per destination

`buildGoogleTagInfrastructure()` changes:

- When `destinations.googleAds` is present, emit a second `googtag` named `Google Tag - Google Ads`, `tagId` = `{{CONST - Google Ads Conversion ID}}` (the CONST variable already exists and is already decoupled from the linker tag), firing on the same sitewide trigger as the GA4 Google tag (Initialization - All Pages if that is what the GA4 tag uses; match it exactly, do not introduce a second trigger convention).
- Parameter shape: `tagId` only, plus `sendPageView` behaviour to be confirmed in Sprint 0. This tag carries the same in-file caveat as Sprint 4 of Google Stack Alignment: **best-effort reconstruction, re-verify against a genuine GTM export containing an Ads `googtag` before it reaches a real client.** Sprint 0 must obtain that export (§13).
- The GA4 Google tag is unchanged apart from consent (§5.3).
- Cross-domain: `linked_domains` currently lives on the GA4 tag and auto-link domains on the Conversion Linker. Whether the Ads Google tag also needs `linked_domains` is a Sprint 0 verification item. Until verified, the linker decision engine's existing rule keeps the Conversion Linker whenever cross-domain is configured, so attribution is protected either way.

### 5.2 Rebase the Conversion Linker decision

In `googleTagArchitecture.ts`, `hasGoogleTagFiring` becomes "a sitewide Google tag whose classified kind is `google_ads` is present", not `Boolean(destinations.ga4)`.

`decideConversionLinker()` itself stays a pure function. Rename its input to `hasAdsGoogleTagFiring` so the semantics are explicit, update the reason strings (the current skip reason says "auto-captures Google click IDs for its own destinations"; it must name the Ads Google tag), and update the existing 7 unit tests.

Net behaviour: the skip case now matches Google's own guidance (a site with the Google tag for its Ads ID on every page does not need a separate Conversion Linker), instead of depending on undocumented combination.

If Sprint 0 shows a GA4-only `googtag` does write usable Ads click-ID cookies, record that finding in the engine's header but **do not** revert to GA4-based skipping. Depending on behaviour Google does not document is the bug class this PRD exists to remove.

### 5.3 Consent per destination

`consentSettingsForTag` is called with the resolved ID. The Ads Google tag renders `ads` purpose, the GA4 Google tag renders `analytics`. Confirm the generated GTM `consentSettings` shape lists the correct consent types per purpose (today `renderConsentSettings` returns only `consentStatus: 'needed'` for both purposes; check whether GTM's built-in consent checks already differ by tag, and if additional consent types need to be declared on the Ads Google tag, add them).

### 5.4 Composable parity

`composableOutputGenerator.ts` consumes the same `buildGoogleTagInfrastructure()`. The Google Stack Alignment Sprint 3 parity test (Planning versus Composable produce byte-identical Google infrastructure) must be extended to cover the Ads Google tag.

### 5.5 Fixtures

Update `googleStackFixtures.test.ts` golden fixtures. The fixture diff is the documented before/after record, as with the `gaawc`→`googtag` migration. Add scenarios: GA4 + Ads single-domain (Ads Google tag present, linker skipped), Ads-only (no GA4), GA4-only (no Ads tag, no linker), cross-domain (both tags, linker kept), sGTM (both tags, linker kept). Verify the suite catches drift by temporarily reverting §5.2, as Sprint 2 of Google Stack Alignment did.

---

## 6. Workstream B · Detection

### 6.1 Topology sources and evidence classes

| Source | What it can show | Evidence class | Notes |
|---|---|---|---|
| **GTM API** (connected container) | Destinations linked to the container, possibly the Google tag grouping | Highest, if grouping is exposed | Sprint 0: verify what the Tag Manager API v2 destination resources actually return. `platform_connections.platform` already allows `'gtm_destinations'`; find what, if anything, populates it, before designing around it |
| **Runtime observation** (CSE / pre-connection scan) | Which tag IDs are loaded, and which destinations receive hits when each Google tag fires | Observed | Strongest evidence available without OAuth. A hit to an `AW-` endpoint with no `AW-` Google tag or `awct` firing is a combination signal |
| **Container JSON** | Which Google tags exist and their classified kinds | Structural only | Cannot show combination. Can show a missing Ads Google tag and `GT-` IDs |
| **Operator declaration** | "These IDs are combined, primary is X" | Declared | Uses existing `declaration_source` semantics (`CLIENT_CONFIRMED` / `OPERATOR_ASSUMED`) |

Map each to the existing `evidence_class` / `observation_confidence` model rather than inventing new confidence vocabulary. Findings derived only from declaration or inference carry `confidence: 'confirm'`.

### 6.2 Schema · `google_tag_topology`

New migration (next free prefix at build time). Read live schema state before writing it, per the `dqm_sgtm` silent CHECK violation lesson.

```sql
google_tag_topology (
  id                     uuid pk,
  organization_id        uuid not null,
  client_id              uuid not null,
  google_tag_id          text not null,      -- the Google tag's own ID (GT-/G-/AW-)
  primary_destination_id text,               -- null when unknown
  destination_ids        text[] not null,
  source                 text not null check (source in ('gtm_api','runtime_observed','operator_declared')),
  evidence_class         text not null,
  crawl_run_id           uuid null,          -- when source = runtime_observed
  observed_at            timestamptz not null,
  is_current             boolean not null default true
)
```

Rows are append-only snapshots; `is_current` flips on the previous row for the same `(client_id, google_tag_id, source)` when a new observation lands. History is what lets DQM detect re-combination (§8.3).

Derived per-client verdict (computed, not stored): `SPLIT`, `COMBINED`, `COMBINED_ADS_PRIMARY`, `UNKNOWN`.

### 6.3 Runtime detection in CSE

Extend CSE / pre-connection scan network capture:

- Record every Google tag ID loaded (`gtag/js?id=…` requests).
- Record every destination ID observed in outbound Google measurement hits (GA4 collect, Ads conversion / remarketing endpoints).
- Emit `detected_signals` rows of a new signal type `google_tag_destination_observed` with `{loaded_tag_id, destination_id}` pairs where attributable.

Attribution caveat: if several Google tags load on one page, a hit may not be attributable to the tag that caused it. Record unattributable hits as such. Never infer grouping from co-occurrence alone; co-occurrence produces at most an `OPERATOR_ASSUMED`-strength hint.

Interaction with existing rules (Sprint 3 must check, not assume): on a combined client, Ads hits can fire with no `AW-` ID in page source. Confirm `GOOGLE_ADS_AW_ID_PRESENT` and `signalConsistency.ts` CONF_01–CONF_05 do not raise false conflicts in this case. If they do, they consume the topology verdict and suppress into an `UnassessableFinding` of kind `CONFLICT` with a pointer to the topology finding, rather than reporting a contradiction.

### 6.4 New IHC rules

All in `services/validation/tagConfiguration.ts` (or a new `googleTagTopology.ts` under the same validation layer, re-exported through `services/ihc/tagConfigurationRules.ts`). Each authored with `client_question`. Bump `REGISTER_VERSION` minor.

**`GOOGLE_ADS_GOOGLE_TAG_MISSING`** · severity `high`
Fires when the client has an Ads destination (declared, `awct` tags present, or `AW-` constant present) and no sitewide `googtag` classified `google_ads` exists in the container.
- Topology `COMBINED` with that `AW-` ID on a sitewide Google tag → downgrade to `low`, note "currently covered by a combined Google tag; splitting without adding this tag will break Ads coverage".
- Topology `UNKNOWN` → `high`, `confidence: 'confirm'` (D5).
- Evaluates container JSON plus topology. This rule is how the back-scan (§6.6) finds containers affected by defect 1.

**`GOOGLE_TAG_COMBINED`** · severity `medium`
Fires when topology shows one Google tag with more than one destination. Evidence names the destinations and the primary ID.

**`GOOGLE_TAG_COMBINED_ADS_PRIMARY`** · severity `high` when `clients.secondary_domains` is non-empty, else `medium`
Fires when the primary ID is `AW-` or `DC-` and a GA4 destination is on the same tag. Finding text states the reproducible consequence (GA4 cross-domain settings not editable in the GA4 UI) only once Sprint 0 has reproduced it; until then, phrase as "reported to prevent".

**`GOOGLE_TAG_ID_UNCLASSIFIED`** · severity `low`
Fires for `googtag` tags whose ID resolves to `GT-` or is `unresolvable`. Asks the client which destinations it serves. Feeds operator declaration.

**Modified: `GA4_CROSS_DOMAIN_LINKING_MISSING`**
Uses the classifier (§4.2). Additionally, when topology is `COMBINED_ADS_PRIMARY` and cross-domain is configured, the rule must not return a clean pass; it returns pass with `confidence: 'confirm'` and a pointer to the topology finding.

**Modified: `CONSENT_TYPE_MISMATCH`**
Uses `requiredConsentTypes(tag, container)` (§4.2).

### 6.5 Interpretation layer

Add `ruleInterpretations.ts` entries for all four new rules, with `fix_summary` pointing at the remediation flow (§7). Client-facing copy uses only Verified claims from §1.2 without qualifiers.

### 6.6 Back-scan of existing clients

One-off job after Sprints 1 and 2 ship: run the corrected and new rules over the latest `gtm_container_snapshots` per client. Output an internal list with three groups:

1. Containers Atlas generated that lack an Ads Google tag and a Conversion Linker (defect 1 exposure).
2. Client containers where defect 2 produced findings that no longer reproduce (false positives to retract from any open report or action list).
3. Clients with `COMBINED` / `COMBINED_ADS_PRIMARY` verdicts where topology is known.

Distribution per D4.

---

## 7. Workstream C · Remediation

Chosen behaviour: **flag + step-by-step guidance + split-ready container**.

### 7.1 Guidance

Static, versioned guidance content (in the interpretation layer, not hardcoded in a component), parameterised with the client's actual IDs:

1. Confirm you have admin access on the Google tag itself (Sprint 0 confirms whether GA4 property admin is insufficient).
2. Review the split-ready draft Atlas has placed in your GTM workspace (§7.2).
3. Follow the D2 sequence: split in Google tag admin (Manage Google tag → tag details → split icon next to the ID) and publish the GTM draft, in the order and within the time window Sprint 0 establishes.
4. After the split, re-check settings that lived on the combined tag (cross-domain, internal traffic, consent overrides), since they now belong to whichever tag kept them.
5. Ask Atlas to verify (§7.4).

Each step carries the evidence-level rule from §1.2.

### 7.2 Split-ready container delta

New service `services/planning/generators/googleTagSplitPlanner.ts`:

- **Input:** the client's current container snapshot (GTM OAuth) and topology verdict.
- **Output:** a delta, not a regenerated container. Only:
  - add an Ads `googtag` (and a GA4 `googtag` if the combined tag was the only Google tag and its primary was `AW-`), using the same builders as §5.1;
  - add `CONST` ID variables if absent;
  - re-run `decideConversionLinker()` against the post-split state and add a Conversion Linker if required;
  - set per-destination consent (§5.3).
- **Never** deletes or modifies existing client tags. If an existing tag conflicts (for example a client `googtag` already using the `AW-` ID), the planner stops and returns a conflict for the operator.
- Validate the result with `validateGTMContainer()` before deploy.

Delivery paths:

- **Connected container:** deploy through the existing `gtmDeployService.ts` as a draft workspace named `Atlas · Google tag split · <date>`. No publish. Show the operator a diff (tags/variables added) before deploy.
- **No connection:** downloadable GTM import JSON of the delta (merge import), with the same diff shown.

### 7.3 Endpoint and UI

- `POST /api/gtm/split-plan` → returns delta, diff and any conflicts (no side effects).
- `POST /api/gtm/split-plan/deploy` → deploys the delta as a draft (gated per D3), records a `google_tag_split_plans` row.

```sql
google_tag_split_plans (
  id, organization_id, client_id, topology_snapshot_ids uuid[],
  delta jsonb, status text check (status in ('planned','deployed_draft','verified','abandoned')),
  deployed_workspace_id text null, verified_at timestamptz null, created_at
)
```

### 7.4 Verification

Triggered by the operator after the split:

1. Refresh topology (GTM API if available; otherwise a targeted CSE run on a small page scope).
2. Re-run the Google tag rules.
3. Verdict `SPLIT` and `GOOGLE_ADS_GOOGLE_TAG_MISSING` passing → mark plan `verified`, write the client discontinuity (§8.1) with `effective_date` = verification date (or the operator-supplied split date, if earlier and confirmed).
4. Anything else → keep `deployed_draft`, show what still fails.

Atlas never claims verification from the draft deploy alone.

---

## 8. Workstream D · Reconciliation, AIR, DQM

### 8.1 Client-scoped discontinuities

`platform_discontinuities` is platform-wide today. Add nullable `client_id` and a `kind` column (`'platform' | 'client_tracking_change'`), defaulting existing rows to `'platform'`. Read the live table definition first.

`discontinuityDiff.ts` must include client-scoped rows only for that client's runs. A split writes one row per affected platform (`ga4`, `google_ads`) with description "Google tag split: destinations separated, data collected per destination from this date".

Sprint 5 checks whether AIR's `anomalyDetector.ts` reads `platform_discontinuities`. If not, wire it in so a split-day step change is annotated, not reported as an anomaly. This is in scope; it is small and without it the split produces a false alarm the week a client does the right thing.

### 8.2 L11 context hook

L11 is greenlit as disclosure-only and not yet built. This PRD does not build L11. It defines the input L11 must consume when it is built:

- the client's current topology verdict and its evidence class;
- client-scoped discontinuities from §8.1.

When a GA4 versus Ads discrepancy coincides with `COMBINED` / `COMBINED_ADS_PRIMARY`, L11 lists combination as a candidate explanation, worded as a candidate, never as the established cause. Add this as a section in `docs/ATLAS_L11_RECONCILIATION_SCOPING.md`.

### 8.3 DQM topology check

New check `google_tag_topology`, run inside `runDQMForOrg()` but gated to once per 24h per client (topology changes rarely; the 15-minute loop is the wrong cadence). Only runs where a refreshable source exists (GTM API). Runtime-only clients refresh on CSE runs instead.

Alert type `dqm_google_tag_topology` opens when:

- a client previously `SPLIT` (verified plan) becomes `COMBINED` again; or
- the Ads Google tag classified in the last snapshot disappears from the container.

Same open/update/resolve shape as `dqm_gtg` / `dqm_dma` / `dqm_sgtm`. Widen `health_alerts.alert_type` and `dqm_run_log.check_type` CHECK constraints by reading the live constraints first, and add an explicit insert test (the `dqm_sgtm` lesson). Fold into `getClientSummaries()` via a `topologySeverity()` mirroring `dmaSeverity`, escalate-only.

---

## 9. Workstream E · Consent

Covered structurally by §4.2 and §5.3. Additionally:

- **Consent Hub UI:** where Consent Hub shows per-tag consent requirements, show the Google tag's classified destination and, for combined tags, a note that its consent settings apply to every destination on it.
- **`DEFAULT_CONSENT_GRANTED_GLOBALLY` / `CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG`:** confirm both behave correctly for an Ads `googtag` after reclassification (tests, no expected logic change).

---

## 10. Schema summary

| Change | Type |
|---|---|
| `google_tag_topology` | New table |
| `google_tag_split_plans` | New table |
| `platform_discontinuities.client_id`, `.kind` | Columns added |
| `detected_signals` signal type `google_tag_destination_observed` | Enum / CHECK widen (read live first) |
| `health_alerts.alert_type` + `dqm_run_log.check_type` add `dqm_google_tag_topology` / `google_tag_topology` | CHECK widen (read live first) |

---

## 11. API surface

| Route | Purpose |
|---|---|
| `GET /api/clients/:id/google-tag-topology` | Current verdict, per-tag destinations, evidence classes, history |
| `POST /api/clients/:id/google-tag-topology/declare` | Operator declaration (destinations, primary ID, `declaration_source`) |
| `POST /api/gtm/split-plan` | Build delta + diff + conflicts, no side effects |
| `POST /api/gtm/split-plan/deploy` | Deploy delta as GTM draft (D3 gate) |
| `POST /api/gtm/split-plan/:id/verify` | Run §7.4 verification |
| `GET /api/gtm/split-plan/:id/download` | Delta as GTM import JSON |

---

## 12. Frontend

- **Google tag topology card** on the client detail page: verdict badge, per-Google-tag destination list with primary marked, evidence class chip, "Needs confirmation" when applicable, declaration form for `UNKNOWN` / `GT-` cases.
- **Split flow** launched from the `GOOGLE_TAG_COMBINED*` and `GOOGLE_ADS_GOOGLE_TAG_MISSING` findings: guidance steps (§7.1), delta diff, deploy-as-draft or download, verify.
- **Reports:** new findings render through the existing Action Items / Technical Appendix / Open Questions machinery. No new report section.
- Use `console.*` / `severity.*` design tokens (Key Technical Decision §13).

---

## 13. Sprint plan

| Sprint | Scope | Exit criterion |
|---|---|---|
| **0** | Verification spikes in a sandbox GTM container with test GA4 and Ads properties: (a) obtain a genuine GTM export containing an `AW-` `googtag` and record its parameter shape; (b) whether a GA4-only `googtag` writes usable Ads click-ID cookies; (c) reproduce the `AW-` primary cross-domain lock; (d) runtime precedence of `config` calls on a combined tag; (e) split permission requirements; (f) what Tag Manager API v2 destination resources return and what populates `platform_connections.platform = 'gtm_destinations'`; (g) D2 sequencing test measuring the Ads coverage gap each way; (h) whether any API performs the split. Resolve D1–D5. Update §1.2 statuses. | Every §1.2 row is Verified, Refuted or explicitly Unverifiable, with source and date; D1–D5 recorded |
| **1** | `googleTagClassifier.ts` with constant-variable resolution. Replace every type-based `googtag` check (§1.3 defect 2 list plus grep for any other `'googtag'` reference). `requiredConsentTypes()`. Tests for each call site. | An Ads `googtag` in a client container no longer produces GA4 cross-domain, sGTM or analytics-consent findings; a GA4 `googtag` behaves exactly as before |
| **2** | Generator: Ads Google tag (§5.1), linker rebasing (§5.2), per-destination consent (§5.3), Composable parity (§5.4), fixtures (§5.5). | Golden fixtures show the Ads Google tag in every Ads scenario; the single-domain GA4 + Ads scenario never lacks both an Ads Google tag and a Conversion Linker; drift test proves the suite catches a revert |
| **3** | `google_tag_topology` schema, CSE runtime capture (§6.3), GTM API source if D1 allows, operator declaration, four new rules + modified rules (§6.4), interpretations, existing-rule interaction check. Then run the back-scan (§6.6). | Verdicts correct for split, combined, combined-Ads-primary and unknown fixtures; back-scan list produced |
| **4** | Remediation: guidance content, `googleTagSplitPlanner.ts`, split-plan routes, draft deploy, download, verification, `google_tag_split_plans`, frontend card and split flow. | A combined sandbox client goes from finding to verified split end to end, with no existing client tag modified |
| **5** | Client-scoped discontinuities + `discontinuityDiff.ts` + AIR wiring (§8.1), L11 scoping doc update (§8.2), DQM topology check + alert + `getClientSummaries()` (§8.3), Consent Hub display (§9). | A verified split annotates reconciliation and AIR on its effective date; re-combination opens exactly one alert that resolves on re-split |

Sequencing note: Sprint 1 ships independently and first, because it corrects audits of real clients today. Sprint 2 must not ship before Sprint 0 item (a); generating an Ads `googtag` with a guessed parameter shape is how the `composableOutputGenerator.ts` fabricated-field bugs happened.

---

## 14. Acceptance criteria

Each maps to at least one test.

1. `classifyGoogleTag` resolves `{{CONST - …}}` IDs and classifies `G-`, `AW-`, `DC-`, `GT-` and unresolvable IDs correctly; it never classifies from tag name.
2. A container whose only Google tag is an `AW-` `googtag` produces no `GA4_CROSS_DOMAIN_LINKING_MISSING`, no `SGTM_ROUTING_NOT_CONFIGURED`, and requires `ad_storage` + `ad_user_data` (not `analytics_storage`) under `CONSENT_TYPE_MISMATCH`.
3. A GA4 `googtag` produces the same findings it did before Sprint 1 (regression fixture).
4. Every generated container with a Google Ads destination contains a sitewide `googtag` classified `google_ads`.
5. The Conversion Linker is skipped only when an Ads Google tag is present, single-domain, no sGTM, no Floodlight; never on the strength of a GA4 Google tag alone.
6. Planning and Composable produce identical Google tag infrastructure for identical destinations, including the Ads Google tag.
7. `GOOGLE_ADS_GOOGLE_TAG_MISSING` fires at `high` with `confidence: 'confirm'` when topology is unknown, and downgrades to `low` with the coverage note when topology shows the `AW-` ID on a sitewide combined tag.
8. `GOOGLE_TAG_COMBINED_ADS_PRIMARY` is `high` when `secondary_domains` is set and `medium` otherwise.
9. Co-occurrence of GA4 and Ads hits alone never produces a `COMBINED` verdict stronger than operator-assumed.
10. On a combined fixture, `GOOGLE_ADS_AW_ID_PRESENT` and CONF_01–CONF_05 do not report a contradiction caused by Ads hits without an `AW-` ID in source.
11. The split planner never deletes or modifies an existing client tag, stops on conflict, and its output passes `validateGTMContainer()`.
12. Deploy creates a draft workspace and never publishes.
13. A plan reaches `verified` only after a fresh topology observation shows `SPLIT` and the Ads tag rule passes.
14. A verified split writes client-scoped discontinuities that appear in that client's reconciliation and AIR output and in no other client's.
15. Inserting a `dqm_google_tag_topology` alert succeeds against the live CHECK constraint (explicit test).
16. Re-combination after a verified split opens exactly one alert per client, which resolves when the client is split again.
17. No client-facing string states an Unverified §1.2 claim as fact.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Ads `googtag` parameter shape guessed wrong, breaking every generated container | Sprint 0 item (a) is a hard gate for Sprint 2; golden fixtures + `validateGTMContainer()` |
| Adding an Ads Google tag to a still-combined client double-loads the same Google tag | Sprint 0 item (g) measures it; D2 sequencing; planner only deploys a draft and guidance states the order |
| Split leaves a window with no Ads coverage | D2 chooses the order with the smaller gap; guidance requires both actions in one session; DQM detects a missing Ads tag afterwards |
| Topology cannot be observed reliably (no API grouping, unattributable runtime hits) | Evidence classes and `confidence: 'confirm'` throughout; operator declaration path; rules degrade rather than guess |
| Back-scan reveals Atlas-generated containers with broken Ads attribution | Treat as a product incident, not a sales opportunity: fix the generator first, contact affected clients per D4 with the corrected container |
| Retracting defect-2 false findings from client reports looks bad | Retraction is cheaper than continuing to report findings Atlas knows are wrong; note the correction in the next report's Open Questions or limitations |
| Copy overclaims practitioner folklore | §1.2 status table governs copy; acceptance criterion 17 |
| CHECK constraint widening repeats the `dqm_sgtm` silent failure | Read live constraints before migrations; explicit insert tests |

---

## 16. What this PRD deliberately does not decide

- Whether the Google tag topology check becomes a paid diagnostic line item in the Campaign Signal Validator or the Signal Gap Report. It is a strong audit finding, but packaging is a service-line decision.
- Whether Atlas should ever recommend combining. This PRD assumes per-destination tags under GTM are the default. A client with a hardcoded `gtag.js` install and no GTM may reasonably stay combined; revisit if such clients appear.
- Meta, LinkedIn or TikTok equivalents. None of those platforms has a combination concept comparable to the Google tag.

---

## 17. Sprint 0 outcome (2026-10-01) · decisions resolved by default, nothing live-verified

Sprint 0's verification spikes (§13) need a live sandbox GTM container with test GA4/Ads properties and a real Google login. The build environment has neither, so by explicit owner direction Sprint 0 was **skipped as a verification exercise** and D1–D5 were resolved to the PRD's own defaults. No §1.2 status changed: every non-Verified row stays Unverified.

### 17.1 Decisions

| ID | Resolution |
|---|---|
| D1 | All three topology sources, ranked by evidence class (§6.1). GTM API source is built as a spike: if the Tag Manager API exposes no destination grouping, the source returns nothing and rules fall back to runtime + declared. |
| D2 | Not measured. Guidance orders it: add the Ads Google tag draft first, split in Google tag admin, then publish, in one session. Chosen because it avoids a coverage gap; risk is a brief double-load, **unmeasured**. |
| D3 | Same plan gate as `POST /api/gtm/deploy`. Detection and guidance ungated wherever IHC is available. |
| D4 | Back-scan output is an internal list only. |
| D5 | Unknown topology: `GOOGLE_ADS_GOOGLE_TAG_MISSING` fires at `high` with `confidence: 'confirm'` and a `client_question`. |

### 17.2 UNVERIFIED registry (everything the build depends on without confirmation)

Each item gets an in-file `UNVERIFIED` marker where it is built in.

| # | Assumption | Where it bites | Re-verify before |
|---|---|---|---|
| U1 | Parameter shape of an `AW-` `googtag` (`tagId`, `sendPageView` behaviour) | Sprint 2 generator, Sprint 4 split planner | Any generated container reaches a real client |
| U2 | Whether a GA4-only `googtag` writes usable Ads click-ID cookies | Sprint 2 linker decision (we do **not** depend on it, §5.2) | n/a, informational |
| U3 | Whether the Ads Google tag needs `linked_domains` for cross-domain | Sprint 2 (linker is kept whenever cross-domain is configured) | Real cross-domain client |
| U4 | `AW-` primary locks GA4 cross-domain settings in the GA4 UI | Sprint 3 `GOOGLE_TAG_COMBINED_ADS_PRIMARY` copy phrased "reported to prevent" | Copy is promoted to a stated fact |
| U5 | Runtime precedence of `config` calls on a combined tag | No copy may state it as fact | n/a |
| U6 | Split requires admin on the Google tag itself | Sprint 4 guidance step 1 phrased as "you may need" | Guidance is reworded as a requirement |
| U7 | Combination status visible on the GTM container overview | Not relied on in code | n/a |
| U8 | Tag Manager API v2 destination resources expose Google tag grouping; what populates `platform_connections.platform = 'gtm_destinations'` | Sprint 3 GTM API source | Source is enabled in production |
| U9 | Whether any API can perform the split | Split stays manual (§2) | n/a |
| U10 | D2 ordering's coverage gap / double-load behaviour | Sprint 4 guidance | Guidance is client-facing |

### 17.3 Consequence for sequencing

§13's gate ("Sprint 2 must not ship before Sprint 0 item (a)") is waived for **building**, not for **client use**: Sprint 2/4 output is built against a best-effort Ads `googtag` shape and must not be given to a real client until U1 is checked against a genuine GTM export.
