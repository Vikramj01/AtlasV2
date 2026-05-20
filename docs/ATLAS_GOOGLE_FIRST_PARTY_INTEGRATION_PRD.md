# Atlas Google First-Party Integration PRD

**Version:** 0.1 (draft)
**Last updated:** 2026-05-20
**Owner:** Vikram J. (technical) / Spi3l LLC
**Status:** Proposed — phased

---

## Overview

Google's first-party measurement stack has consolidated into three layers that Atlas must integrate with coherently:

1. **Google Tag Gateway (GTG)** — CDN-level reverse proxy that serves Google scripts first-party. Atlas detects, recommends, and verifies; no programmatic integration.
2. **GTM / GTM Destinations / server-side GTM** — configuration and routing. Atlas configures, governs, and monitors.
3. **Data Manager API (DMA)** — unified ingestion endpoint at `datamanager.googleapis.com/v1` for audiences and conversions across Google Ads, GA4, DV360, and CM360. Atlas pushes to it as a destination.

The Customer Match deprecation in the legacy Google Ads API (`OfflineUserDataJobService`, `UserDataService`) hit on April 1, 2026, making DMA the only programmatic path for Customer Match. Enhanced Conversions for Web, Enhanced Conversions for Leads, and offline conversion imports were unified in April 2026 to accept tags, Data Manager, and API connections simultaneously — making dedup, schema consistency, and signal strategy the new hard problems.

This PRD breaks Atlas's integration response into six phases plus one optional follow-on phase. Phases are designed to be sequenceable: each downstream phase depends on artifacts shipped in earlier ones, but phases can be paused or stretched without breaking what precedes them.

## Goals

- Restore CAPI Module Google compliance for clients with active Customer Match flows.
- Establish Atlas as the orchestration and quality layer in front of the GTG + GTM + DMA stack, not as one transport among many.
- Build Bid Signal Enricher DMA-native from day one (avoid building on a deprecated foundation).
- Convert the GTG and DMA configuration surface into detectable, scorable signals — feeding CSE, Direct Audit, Andromeda, and DQM.
- Surface the resulting signal lift (~11% from GTG, plus DMA match-rate improvements) as attributable Atlas value, with clean ROI storytelling per tier.

## Non-goals

- Building a competing first-party transport layer (Atlas does not replace GTG or sGTM).
- Owning customer CRM ingestion plumbing (DMA accepts data; Atlas orchestrates the push from existing sources).
- Multi-platform parity for confidential matching (this is a Google-specific PET; equivalent features on Meta/TikTok are out of scope).

## Phase summary

| Phase | Name | Priority | Depends on | Approx scope |
|---|---|---|---|---|
| 1 | DMA Compliance Migration | P0 — urgent | — | CAPI Module Google provider re-platform, OAuth, naming |
| 2 | Detection Foundation | P0 | — (parallelizable with P1) | CSE detection signals + Direct Audit checks for GTG & DMA |
| 3 | Recommendation Layer | P1 | P1, P2 | Journey Builder Steps 2.5/2.6, signal timing, GTM Destinations addendum |
| 4 | Bid Signal Enricher (DMA-native) | P1 | P1 | Full module build on DMA foundation |
| 5 | Scoring & Pricing Integration | P2 | P2, P3 | Andromeda re-weighting + DMA usage_events |
| 6 | DQM Integration | P2 | P2, P4 | GTG + DMA monitoring inside Data Quality Monitor module |
| 7 (optional) | Data Manager Console | P3 | P4 | Agency-grade aggregated DMA diagnostics view |

P1 and P2 can run in parallel — they touch different surfaces and have no dependency overlap.

---

## Phase 1 — DMA Compliance Migration

**Priority:** P0 (post-deadline)
**Estimated effort:** 2–3 weeks
**Owner:** Backend + CAPI Module

### Why this is Phase 1

The legacy Google Ads API paths for Customer Match upload (`OfflineUserDataJobService`, `UserDataService`) stopped accepting writes on April 1, 2026. Any Atlas client still routed through those paths is broken or about to break. Beyond compliance, Phase 1 establishes the DMA client and OAuth foundation that Phases 4 and 6 depend on.

### Scope

- Build a typed DMA client in the Atlas backend (Express on Render). Use Google's OpenAPI spec for type generation. Wrap both `audiencemembers:ingest` and `events:ingest` endpoints.
- OAuth 2.0 integration with the `datamanager` scope. Add token refresh handling, store refresh tokens encrypted in Supabase, isolate per-org credentials.
- Re-platform the Google provider in the CAPI Module's five-provider wizard. Replace legacy `OfflineUserDataJobService` and `UserDataService` calls with DMA equivalents.
- Migrate Customer Match push to `audiencemembers:ingest` with `UserIdData` support (recently added).
- Migrate offline conversion imports and Enhanced Conversions for Leads to `events:ingest` with `IngestEvents`.
- Add support for `EventSource` enum values (APP, IN_STORE, PHONE, OTHER) — needed for store sales and call-tracking integrations.
- Rename "Google CAPI" tab and all UI references to "Data Manager (Google)" — Meta-ism cleanup.
- Audit all existing Google integration code paths for any remaining legacy API calls; document and remediate.
- Queue DMA calls via Bull on the existing Render Redis instance (`red-d7vpjnr7uimc73evp8lg`) for retry and rate-limit handling.

### Out of scope

- Bid Signal Enricher (Phase 4).
- Confidential matching feature (Phase 4 — needs the Enricher's tier-gating UI).
- Multi-destination single-call optimization (kept simple in Phase 1; one destination per call is fine).
- DMA diagnostics endpoint polling (Phase 6).

### Database changes

Proposed migration: `20260601_001_dma_oauth_credentials.sql`

- New table: `google_dma_credentials` — keyed on `org_id`, stores encrypted refresh tokens, OAuth scope, `expires_at`, and consent metadata.
- Extend `usage_events` schema to accept a `dma_ingest_event` row type (cost computed at write — full pricing model wiring deferred to Phase 5).
- Audit and update `capi_browser_events` row schema if any columns assume legacy Ads API IDs.

### Files / modules affected

- `backend/src/integrations/google/` — new DMA client module.
- `backend/src/modules/capi/providers/google.ts` — re-platform.
- `backend/src/config/pricing.ts` — add the new event type, finalize cost in Phase 5.
- `frontend/src/components/capi-wizard/` — rename tab, update copy.
- `docs/atlas-prd-subscriptions-pricing-config.md` — update event type list.

### Success criteria

- Zero legacy `OfflineUserDataJobService` or `UserDataService` calls in production code.
- Customer Match audience push works for at least one live client end-to-end via DMA.
- Offline conversion upload works for at least one live client end-to-end via DMA.
- All existing CAPI Module Google clients migrated without manual reconfiguration (auto-migration script).
- OAuth flow covers token refresh and credential rotation cleanly across org boundaries.

### Open questions

- Does any existing client rely on the now-removed `validateOnly` semantics from the legacy API? If so, map to DMA's `validateOnly` boolean.
- Should we expose `encoding` (HEX vs Base64) as a per-client config, or default to one? Default to HEX recommended.
- Token storage: Supabase Vault, or app-level encryption with a single KMS key? Decision needed before build.

---

## Phase 2 — Detection Foundation

**Priority:** P0 (parallelizable with Phase 1)
**Estimated effort:** 2 weeks
**Owner:** CSE + Direct Audit

### Why this is Phase 2

Detection signals are the foundation for recommendations (Phase 3), scoring (Phase 5), and monitoring (Phase 6). They're cheap to build, deterministically observable from the existing Browserbase crawler, and unlock everything downstream. Worth shipping in parallel with Phase 1 because no dependency overlap.

### Scope

#### CSE detection — new `detected_signals` row types

- `transport_layer_health` — origin of `gtag.js` and `gtm.js` requests; first-party domain vs `googletagmanager.com`.
- `gtg_status` — boolean derived from `transport_layer_health`, plus CDN identification (Cloudflare / Akamai / Fastly / GCP from response headers).
- `sgtm_endpoint_status` — presence of a first-party subdomain serving sGTM, plus its health (200 response, valid container).
- `cookie_longevity` — observed cookie expiry windows in Safari; tagged with `_ga`, `_gcl_au`, and Google Ads click ID cookies.
- `dma_indirect_signals` — heuristic indicators that DMA might be in use (cannot be directly observed from browser; this is a placeholder for OAuth-authorized inspection added in Phase 6).

#### Direct Audit — new check series

- **DA-GTG-001** — Is Google Tag Gateway enabled? Boolean from `transport_layer_health`.
- **DA-GTG-002** — Which CDN is fronting the gateway? Categorical: Cloudflare / Akamai / Fastly / GCP / Other.
- **DA-GTG-003** — Are all Google scripts (`gtag.js`, `gtm.js`, and any pings) routed first-party, or only a subset? Common failure mode: partial deployment.
- **DA-GTG-004** — Does the first-party `gtag.js` path return 200 and match upstream version? Drift detection.
- **DA-DMA-001** — DMA OAuth connection live and authorized for this org? Boolean from `google_dma_credentials` + auth probe.
- **DA-DMA-002** — Are DMA events landing? Non-zero ingest rate over last 24 hours. Requires DMA diagnostics endpoint (foreshadows Phase 6).
- **DA-DMA-003** — Match rate per destination above threshold? Per-destination threshold to be defined; placeholder until Phase 6 polling lands.
- **DA-DMA-004** — Configured destinations match the destinations the client expects? Detects accidental destination drift or missing additions.

DA-DMA-002 and DA-DMA-003 require the diagnostics endpoint to be polled; if Phase 6 has not landed by the time Phase 2 ships, these checks remain in a `pending_data` state in the UI rather than firing false negatives.

### Out of scope

- Recommendation copy or remediation steps (Phase 3 builds these on top of the checks).
- UI surfacing of new signals beyond the existing Direct Audit results page (basic surfacing only).
- Monitoring or alerting on these signals (Phase 6).
- Andromeda score integration (Phase 5).

### Database changes

Proposed migration: `20260615_001_transport_layer_signals.sql`

- Extend `detected_signals` `signal_type` enum (or equivalent constraint) with the new row types listed above.
- Add `transport_layer_metadata` JSON column on `crawl_pages` for CDN/origin metadata captured per page.
- New check definitions in the Direct Audit checks catalog (wherever DA-GTM-001 through 004 are currently stored).

### Files / modules affected

- `backend/src/crawl/extractors/transport-layer.ts` — new extractor module.
- `backend/src/crawl/extractors/google-scripts.ts` — extend to capture script origins.
- `backend/src/audit/checks/` — new files for each DA-GTG-* and DA-DMA-* check.
- `frontend/src/components/audit-results/` — extend rendering for new check types.

### Success criteria

- CSE returns transport-layer signals for any crawled page; coverage parity with existing detected_signals types.
- All eight new Direct Audit checks run on at least one real client and produce correct results.
- DA-DMA checks degrade gracefully when DMA diagnostics is not yet polled.
- Detection accuracy verified against at least three reference sites: one with GTG on, one without, one with partial deployment.

### Open questions

- How do we handle clients on Tealium / Ensighten where GTG must use the gtag implementation route only? Add a sub-state to DA-GTG-001 to flag "GTG-compatible TMS detected"?
- Cookie longevity check on Safari requires a Safari user-agent in Browserbase; confirm Browserbase supports this cleanly or whether we need a separate runner.
- Should `dma_indirect_signals` be removed for now (not detectable from browser) and re-added in Phase 6 when we have OAuth-authorized inspection? Recommendation: yes, defer.

---

## Phase 3 — Recommendation Layer

**Priority:** P1
**Estimated effort:** 3 weeks
**Owner:** Journey Builder + Conversion Strategy Gate + GTM Destinations PRD owner

### Why this is Phase 3

Detection without recommendation is just diagnostics. Phase 3 turns the new signals into actionable wizard steps and recommendation logic inside Journey Builder. This is also where the existing GTM Destinations PRD addendum gets its own addendum to reflect the DMA path.

### Scope

#### Journey Builder updates

- **Step 2.5 expansion (per-event routing).** Existing Step 2.5 handles legacy vs Destinations container choice. Expand to a per-event routing decision matrix: tag-only / GTM Destinations / DMA push / combination. Atlas recommends per event based on event type, latency tolerance, value, and privacy requirements.
- **Step 2.6 new (transport layer pre-flight).** New step prior to container configuration. Detects GTG status from Phase 2 signals; if not enabled, generates a deployment recommendation specific to the detected CDN. Non-blocking — surfaced as a strong nudge with cost/benefit framing (~11% signal uplift, free to deploy).
- **Signal timing guidance refinement.** Current logic flags Meta 2h/24h windows and recommends proxy events. Add a parallel Google branch: events that miss Meta windows but are fine for Google DMA backfill should be recommended differently per platform. Output is dual-platform recommendations rather than single-platform.
- **Proxy event recommendation rewrite.** Current model: "instrument a proxy lead event." New model: "instrument the real offline conversion via DMA push + a click-ID-tied proxy event for early funnel signal." Per-platform recommendations.

#### Conversion Strategy Gate updates

- Add GTG status to the gate's signal inventory display. If GTG is off, surface it as a "structural ceiling on signal quality" item with severity = high.
- Add DMA OAuth status check to the gate's pre-flight checklist for Google-side recommendations.

#### GTM Destinations PRD — addendum to addendum

The existing GTM Destinations PRD addendum (covering two-container schema, Journey Builder Step 2.5, Andromeda sub-dimension, Direct Audit DA-GTM-001 through 004, DQM container change detection) needs an additional addendum covering:

- Two-container schema × DMA path interaction. The two containers (legacy + Destinations) are the *tag layer* output. DMA is a *separate parallel transport* that writes to the same destinations. Document explicitly so future PRD readers understand the orthogonality.
- Transport axis added to the PRD. GTG sits below the container choice; document that the recommendation engine considers both axes (transport + container) independently.
- Split the existing Andromeda "Destinations Configuration Health" sub-dimension into three sub-dimensions: **Container Configuration** (existing), **DMA Coverage** (new — % of high-value events with DMA backfill), and **Transport Health** (new — GTG status, sGTM health, cookie longevity).

### Out of scope

- Implementing the Andromeda re-weighting math (Phase 5).
- Building DQM alert templates for these signals (Phase 6).
- Bid Signal Enricher recommendations beyond the routing decision (Phase 4).

### Database changes

- Extend Journey Builder wizard state schema to persist per-event routing choices.
- New table or column for transport-layer recommendation state: was GTG recommendation surfaced, did the user dismiss/snooze/act on it.

Proposed migration: `20260701_001_journey_builder_routing.sql`

### Files / modules affected

- `frontend/src/components/journey-builder/steps/` — new Step 2.6 component, expanded Step 2.5.
- `backend/src/services/journey-builder/recommendation-engine.ts` — recommendation logic for per-event routing and signal timing.
- `frontend/src/components/conversion-strategy-gate/` — extend pre-flight checks.
- `docs/prd/GTM_DESTINATIONS_ADDENDUM_V2.md` — new addendum file.
- `docs/prd/ANDROMEDA_SIGNAL_HEALTH_PRD.md` — update to reflect split sub-dimensions (actual scoring work happens in Phase 5).

### Success criteria

- Journey Builder generates per-event routing recommendations for any conversion event added to the journey.
- GTG pre-flight step surfaces correct CDN-specific deployment guidance for at least four CDN providers (Cloudflare, Akamai, Fastly, GCP).
- Signal timing guidance produces dual-platform recommendations where Meta and Google differ.
- GTM Destinations addendum addendum is published and reviewed.
- Conversion Strategy Gate displays GTG and DMA status correctly.

### Open questions

- How aggressive should the GTG nudge be — banner, modal, or just an inline item in the gate? Recommendation: inline in the gate, with a single CTA card on Step 2.6.
- Should the routing matrix in Step 2.5 be auto-populated (Atlas picks) with override, or always user-driven? Recommendation: auto-populated with one-click override per event.
- Where do CDN-specific deployment instructions live — in Atlas docs, or fetched dynamically from a recommendations service? Probably embedded for v1.

---

## Phase 4 — Bid Signal Enricher (DMA-Native Build)

**Priority:** P1
**Estimated effort:** 4–6 weeks
**Owner:** Backend + new Bid Signal Enricher module owner
**Depends on:** Phase 1 (DMA client + OAuth) must be complete

### Why this is Phase 4

The Bid Signal Enricher is the cleanest fit for DMA — it's effectively a managed DMA wrapper. Building it on the legacy Google Ads API and then migrating would be wasted work. Phase 1 establishes the DMA foundation; Phase 4 builds the full module on top.

### Scope

- Build the Bid Signal Enricher module per the existing PRD intent (first-party data push to Google Enhanced Conversions, Meta CAPI, and adjacent platforms). DMA is the *only* Google transport — no fallback to legacy Ads API.
- Multi-destination single-call architecture. A single `audiencemembers:ingest` or `events:ingest` call writes to Google Ads + GA4 + DV360 + CM360 in one round-trip. Surface this in the UI as a feature (vs. the manual fan-out alternative).
- Match rate and attribution uplift telemetry pulled directly from DMA's diagnostics endpoint, surfaced in the Atlas UI. Refresh interval TBD — likely hourly polling per active org.
- Confidential matching as opt-in feature. Trusted-execution-environment-based match. Tier-gated to Management and Operations subscriptions (and Agency Scale and above). Surface in UI as "Privacy-enhanced data activation (Google TEE)."
- Hashing / dedup / retry logic adapted to DMA schema. Reuse the existing four-layer dedup architecture (`capi_browser_events` table, `dedup_status`/`dedup_key`/`dedup_matched_at` columns from migration `20260519_001_capi_dedup.sql`). DMA events become a fifth signal source in the dedup pipeline.
- Support for both `events:ingest` (offline + enhanced conversions, store sales, call tracking) and `audiencemembers:ingest` (Customer Match audiences with `UserIdData`).
- Support for the `EventSource` enum: WEB, APP, IN_STORE, PHONE, OTHER. Auto-detect from upstream source where possible.
- Optional `transaction_id` handling — the recent DMA release made it optional for some flows but required for offline conversions used as supplementary tag signal. Encode the rules.
- Meta-side: build the Meta CAPI portion of the Enricher in parallel using the existing CAPI Module infrastructure. Out of scope for *this PRD's Google focus* but tracked here for completeness.

### Out of scope

- Andromeda scoring updates for the Enricher (Phase 5).
- Aggregated multi-client diagnostics dashboard (Phase 7, if built).
- Non-Google platforms beyond Meta CAPI (TikTok, LinkedIn, Snap deferred to a future phase).
- Auto-suggestion of which CRM fields map to DMA identifiers — manual mapping UI for v1.

### Database changes

Proposed migration: `20260801_001_bid_signal_enricher.sql`

- New table: `enricher_runs` — keyed on `org_id`, tracks each DMA push: timestamp, destination set, event count, success/failure, diagnostics endpoint response.
- New table: `enricher_field_mappings` — per-org mapping of CRM fields to DMA identifiers (email, phone, address components, mobile device ID, user ID).
- Extend `usage_events` to track Enricher-driven DMA calls separately from other DMA calls if useful for pricing analysis.

### Files / modules affected

- `backend/src/modules/bid-signal-enricher/` — new module.
- `backend/src/integrations/google/dma-client.ts` — extend for diagnostics polling (added in Phase 6, stubbed here).
- `backend/src/services/dedup/` — extend four-layer dedup with DMA event source.
- `frontend/src/components/bid-signal-enricher/` — new UI components.
- `backend/src/config/pricing.ts` — confidential matching gating logic.

### Success criteria

- Bid Signal Enricher pushes to Google Ads + GA4 + DV360 + CM360 in a single call for at least one live client.
- Match rate telemetry visible in UI within 24 hours of first push.
- Confidential matching toggle correctly gated by subscription tier.
- Dedup integration prevents double-counting between DMA push and existing tag-based events for the same conversion.
- All `EventSource` enum values supported and tested.

### Open questions

- Confidential matching has higher latency than non-confidential. Default state: off, with a clear "enable" prompt for tier-eligible orgs? Or default on, with opt-out? Recommendation: opt-in default to avoid surprising latency.
- Should Enricher push events that have *already* been tag-fired, supplementing the tag with first-party data? Or only push events that are *exclusively* server-side? Affects dedup design materially. Recommendation: supplement (additive enrichment), explicitly dedup'd via the existing four-layer architecture.
- Field mapping UI: manual v1, or LLM-assisted suggestion in v1? Recommendation: manual for v1; LLM mapping can be a fast follow.
- AI report overage pricing ($25 per report — open question in existing pricing PRD) interacts with Enricher reports. Decide before Phase 5.

---

## Phase 5 — Scoring and Pricing Integration

**Priority:** P2
**Estimated effort:** 2 weeks
**Owner:** Andromeda module + Pricing
**Depends on:** Phase 2 (detection signals exist), Phase 3 (recommendations exist)

### Why this is Phase 5

Once detection (P2) and recommendations (P3) are live, scoring should reflect them. Same for pricing — the usage_events row type added in Phase 1 needs cost wired in. This is the integration phase that makes everything billable and scorable.

### Scope

#### Andromeda Signal Health updates

- **GTG presence as composite multiplier.** Without GTG, Andromeda Readiness Score caps at 85/100, reflecting the ~11% structural signal loss. With GTG, the cap lifts to 100. This makes the GTG recommendation high-priority by design.
- **DMA Coverage sub-dimension.** New sub-dimension under Destinations Configuration Health (or as a standalone dimension). Measures % of high-value events with a DMA-backed enrichment path. Weight TBD — recommend starting at 0.15 of the composite.
- **Transport Health sub-dimension.** New sub-dimension covering GTG status, sGTM health, cookie longevity. Weight TBD — recommend starting at 0.15 of the composite.
- **Re-weighting math.** With the new sub-dimensions, the existing five-dimension composite needs re-weighting. Open question — see below.

#### Pricing / usage_events

- Wire cost computation for the `dma_ingest_event` row type added in Phase 1. Decision needed: per-event cost vs. flat per-call. Recommendation: per-event (each member or event ingested = one usage event row), priced at a low rate consistent with the 80–85% gross margin target.
- Confidential matching as tier feature: enforce gating at the API layer (not just UI) for Management/Operations tiers and Agency Scale and above.
- Bid Signal Enricher events tracked as a sub-type of `dma_ingest_event` if pricing differentiation is needed.
- GTG recommendation packaged as a Diagnostic tier onboarding deliverable. Marketing collateral generated automatically when DA-GTG-001 returns false: "Atlas detected your account is losing ~11% of measured signal because Google Tag Gateway isn't deployed. Here's a one-pager with the deployment steps for your CDN."

### Out of scope

- DMA diagnostics polling for ongoing match-rate tracking (Phase 6).
- Multi-client diagnostics dashboard (Phase 7).
- Pricing model overhaul beyond the new event type and confidential matching gate.

### Database changes

Minimal — most schema work is in Phase 1.

- Andromeda scoring config updates in `andromeda_scoring_config` table or equivalent.
- Confidential matching entitlement check requires either a new `entitlements` table or extension of existing subscription metadata.

### Files / modules affected

- `backend/src/modules/andromeda/scoring.ts` — re-weighting math, new sub-dimensions.
- `backend/src/config/pricing.ts` — cost wiring for DMA events, gating logic.
- `backend/src/services/entitlements/` — confidential matching gate.
- `frontend/src/components/diagnostic-onboarding/` — GTG recommendation one-pager generation.

### Success criteria

- Andromeda Readiness Score reflects GTG status (cap or multiplier).
- DMA Coverage and Transport Health sub-dimensions compute correctly for at least one live client.
- DMA usage events generate accurate billing rows.
- Confidential matching is correctly enforced server-side, not just hidden in UI.
- GTG recommendation deliverable generated automatically during Diagnostic-tier onboarding.

### Open questions

- Composite re-weighting: with the new sub-dimensions, the existing five-dimension structure needs adjustment. Two options: (a) absorb new sub-dimensions inside existing dimensions, keeping five total; (b) expand to six or seven dimensions. Recommendation: (a) for less disruption.
- Per-event vs flat per-call pricing for DMA — depends on Bid Signal Enricher volume modeling.
- Should the AI report overage price ($25, currently open in pricing PRD) cover Enricher-generated reports too? Decide alongside Phase 4.
- Intermediate tier between Operations and Enterprise — does the new DMA / confidential matching feature set justify creating one? Re-open this question now that there's more high-tier-only feature mass.

---

## Phase 6 — DQM Integration

**Priority:** P2
**Estimated effort:** Folded into DQM module build (already in roadmap)
**Owner:** Data Quality Monitor module owner
**Depends on:** Phase 2 (detection signals), Phase 4 (DMA in active use)

### Why this is Phase 6

Data Quality Monitor is already next in the roadmap after CSE — second build per existing prioritization. The GTG and DMA monitoring requirements fit naturally inside DQM rather than as standalone work. This phase ensures DQM scope explicitly covers them.

### Scope

- **GTG path health monitoring.** Periodic check that first-party `gtag.js` returns 200 and matches upstream version. Alert on drift or 4xx/5xx.
- **Cookie longevity monitoring.** Track Safari cookie lifetimes for `_ga`, `_gcl_au`, and Google Ads click ID cookies. Alert if observed lifetimes regress (indicates GTG break).
- **DMA diagnostics endpoint polling.** Hourly poll per active org. Track upload success rate, match rate per destination, rejection rate, error categories. Feed DA-DMA-002 and DA-DMA-003 with live data.
- **Signal volume parity baseline.** When GTG is deployed, capture a baseline volume snapshot and track parity over time. Alerts if volume regresses materially below baseline (indicates GTG misconfiguration or break).
- **Destination drift detection.** Alert when DMA destination list diverges from expected configuration (manual changes in Google Ads UI, accidental removal).
- **Severity-based alerting** consistent with existing DQM design: critical alerts = immediate, warnings = weekly digest.
- **Agency health dashboard integration.** GTG status and DMA health roll up per client in the agency view.

### Out of scope

- Multi-client aggregated DMA dashboard (Phase 7, optional).
- Predictive alerting (anomaly detection) on match rates — fast follow.
- Auto-remediation (DQM only alerts; it does not modify config).

### Database changes

Follows the DQM module's general design — monitoring runs and alerts. Specific additions:

- DMA diagnostics polling state table (last poll, last successful poll, current backoff).
- GTG path health history table.

### Files / modules affected

- `backend/src/modules/data-quality-monitor/` — new module (already scoped).
- `backend/src/modules/data-quality-monitor/checks/gtg-*.ts` — GTG-specific checks.
- `backend/src/modules/data-quality-monitor/checks/dma-*.ts` — DMA-specific checks.
- `backend/src/integrations/google/dma-diagnostics.ts` — polling client.

### Success criteria

- All five GTG/DMA monitoring items run on at least one live client with realistic alert volume.
- Polling cadence does not exceed Google's DMA rate limits.
- Agency dashboard correctly aggregates DMA health across clients.
- DA-DMA-002 and DA-DMA-003 (from Phase 2) now return real data rather than pending state.

### Open questions

- Polling frequency for DMA diagnostics — hourly per org may be too aggressive at scale. Adaptive polling based on traffic volume?
- Where do alerts route — email, Slack, in-app, agency dashboard, all of the above?
- Should DQM expose a manual "force re-check" action for support flows, or rely entirely on scheduled checks?

---

## Phase 7 (optional) — Data Manager Console

**Priority:** P3 (conditional)
**Estimated effort:** 3–4 weeks
**Owner:** TBD
**Depends on:** Phase 4 (Enricher generating DMA data) + Phase 6 (diagnostics polling live)

### Why this is optional

Phase 7 is a new module candidate, not a requirement. The value proposition is agency-grade visibility — a single console showing DMA health, match rates, destination coverage, and signal lift across all clients in an agency book. It's high-leverage commercial content but is not blocking on any of the other phases.

### Scope (if built)

- Aggregated DMA diagnostics dashboard surfacing match rate, rejection rate, and volume per destination, per client.
- Agency-level multi-client view: sortable, filterable, exportable.
- GTG status overlay: which clients have GTG, which CDN, and signal-lift attribution per deployment.
- Confidential matching adoption rollup.
- Per-client trend graphs over 30 / 90 / 365 days.
- Bulk action affordances: which clients need GTG deployment, which have DMA OAuth disconnected, etc.

### Out of scope

- Direct DMA configuration editing (agencies still manage Google Ads UI for that).
- Cross-platform signal health (DMA-specific; Meta/TikTok in a future console if pattern works).

### Database changes

Mostly views and aggregates over existing tables — no new transactional schema.

### Success criteria

- Single page renders DMA health for all clients in an agency org in under 2 seconds.
- Exports to CSV and PDF for client-facing reporting.
- Agency users report reduced time-to-detect on DMA issues.

### Open questions

- Should this be a standalone module or a tab inside DQM? Recommendation: tab inside DQM to start; promote if usage justifies.
- Pricing: included in Agency tiers by default, or premium add-on?

---

## Cross-cutting concerns

### Naming consistency

A pass across the codebase and docs to rename "Google CAPI" to "Data Manager (Google)" wherever it appears. Suggested style: keep "CAPI Module" as the umbrella module name (it covers Meta CAPI, TikTok Events API, etc. — all of which retain CAPI-style naming), but rename the Google-specific sub-provider.

### Documentation

Each phase ships with documentation updates:

- Phase 1 — internal runbook for DMA OAuth flow and token rotation.
- Phase 2 — Direct Audit check catalog updates with the new DA-GTG-* and DA-DMA-* checks.
- Phase 3 — Journey Builder user-facing docs covering the new Step 2.5/2.6 logic.
- Phase 4 — Bid Signal Enricher user docs + sales collateral.
- Phase 5 — pricing page updates if any new tier or feature gating is customer-visible.
- Phase 6 — DQM alert catalog with the new alert types.

### Migration / customer comms

Phase 1 will trigger an auto-migration of any client still on legacy Google Ads API paths. Communication plan:

- In-app notification on first login post-deployment.
- Email to admin users describing the migration.
- Doc page explaining the change and what it means for them (mostly nothing, by design).
- Support runbook for handling questions.

### Compliance / privacy

DMA's confidential matching is itself a compliance asset (trusted execution environment, hashed identifiers). Ensure that Atlas's privacy posture documentation reflects that DMA pushes are PET-compatible and that hashing happens client-side before transmission.

UAE and Singapore market specifics — confirm DMA is available in both regions before promoting it to those customer bases. (Quick check needed; both should be fine but worth verifying.)

### Risks

- **OAuth credential management at scale.** Refresh token handling for many orgs is operationally non-trivial. Phase 1 must get this right or downstream phases break.
- **DMA rate limits.** Google publishes limits; need to confirm they accommodate Atlas's projected scale, especially for Bid Signal Enricher at agency volume.
- **Diagnostics endpoint reliability.** Phase 6 depends on it. If Google's diagnostics is flaky or rate-limited, fallback strategies needed.
- **CDN-specific GTG deployment guidance** must stay current as Google updates the one-click integrations. Treat as living content, not static docs.

---

## Rollup of open questions

Carried across all phases for review. Marked by phase of origin.

1. (P1) Token storage approach — Supabase Vault vs app-level encryption with KMS.
2. (P1) Encoding default for DMA payloads — HEX recommended.
3. (P2) Tealium / Ensighten GTG-compatibility sub-state on DA-GTG-001.
4. (P2) Browserbase Safari user-agent support for cookie longevity check.
5. (P3) GTG nudge aggressiveness in Conversion Strategy Gate.
6. (P3) Auto-populated vs user-driven per-event routing matrix in Step 2.5.
7. (P3) CDN-specific deployment instructions — embedded vs fetched.
8. (P4) Confidential matching opt-in vs opt-out default.
9. (P4) Enricher push semantics — supplement vs exclusive.
10. (P4) Field mapping UI — manual vs LLM-assisted in v1.
11. (P5) Andromeda composite re-weighting — absorb sub-dimensions vs expand dimension count.
12. (P5) Per-event vs flat per-call DMA pricing.
13. (P5) AI report overage price covers Enricher reports?
14. (P5) Intermediate tier between Operations and Enterprise — revisit.
15. (P6) DMA diagnostics polling frequency — fixed vs adaptive.
16. (P6) DQM alert routing surfaces.
17. (P7) Data Manager Console — standalone module vs DQM tab.

---

## Appendix: file path conventions used

- PRDs: `/docs/prd/*.md`
- Migrations: `/backend/supabase/migrations/YYYYMMDD_NNN_description.sql` (using existing repo convention)
- Modules: `/backend/src/modules/<module-name>/`
- Integrations: `/backend/src/integrations/<vendor>/`
- Frontend components: `/frontend/src/components/<feature>/`

Adjust to actual repo structure if it differs from these conventions.
