# Atlas · Conversion Signal Layer — Sprint Plan

**Source:** *Atlas · Conversion Signal Layer Response* PRD (prepared for Vikram Jayanand, 27 Aug 2026)
**This document:** turns that PRD's 13 build items (B1–B13), 4 modify items (M1–M4), and 3 deprecate/clean-up items (D1–D3) into an ordered, file-level sprint plan for the AtlasV2 repo.
**Verification:** every "current state" line below was re-checked against the live repository while writing this plan (not carried over from the PRD unverified) — exact file paths and line numbers are cited throughout so each item can be picked up without re-discovery.
**Ordering:** phases below preserve the PRD's own §6 sequencing recommendation exactly (Immediate → Immediate/parallel → Next → Then → Opportunistic). No calendar dates are assigned — phases are ordered, not dated, so this plan stays valid regardless of team size.

---

## Totals

| Category | Count | Phase distribution |
|---|---|---|
| Build (new) | 13 (B1–B13) | Phase 0: B9 · Phase 1: B7, B8, B1 · Phase 2: B6, B3 · Phase 3: B4, B5, B10, B11, B13 · Informational: B2 |
| Modify | 4 (M1–M4) | Phase 0: M1 · Phase 1: M4 · Phase 2: M2 · (M3 folded into M1's recurring check) |
| Deprecate / clean up | 3 (D1–D3) | Phase 3: D1 · Informational only: D2, D3 |

---

## Phase 0 — Immediate (target: before 1 Sept 2026 — AI Max default-on date)

### B9 — Campaign Signal Validator (pre-flight diagnostic)

**Why now.** Google's AI Max switches on by default for Search campaigns using auto-created assets or broad match from 1 Sept 2026, and scales whatever the primary conversion action rewards — a weak proxy event gets bought harder, efficiently, while reported conversions rise and revenue does not. This is the single most time-sensitive item in the PRD.

**Current state.** Nothing built. The only mention anywhere in the repo is one forward-looking backlog line in `STRATEGY_GATE_PRD.md:362` ("Overlap resolution with Campaign Signal Validator event verdict logic," under "V2 Backlog — do not build now"). No route, service, schema, or frontend surface exists.

**Scope decision (confirmed with user):** build both halves together — the in-app diagnostic AND the standalone $500–800 paid product — rather than deferring the paid flow. This is materially more scope for a tight window; see Dependencies/Risk below.

**Reusable building blocks:**
- `backend/src/services/planning/siteDetectionService.ts` — zero-cost, no-Browserbase `fetch()` + Cheerio scan (`detectSite()`). Detects platform, existing tracking (GTM/GA4/Meta Pixel/Google Ads/TikTok/LinkedIn), business type. Runs in 1–3s.
- `backend/src/services/planning/pageCaptureService.ts` — `capturePageStandalone()` is a self-contained, single-call Browserbase capture (owns its own session lifecycle) — the best entry point for a one-off diagnostic scan.
- `backend/src/services/journey/platformSchemas.ts` (`PLATFORM_SCHEMAS`) and the shared `trackingSignals` detection utilities — reused by both Planning Mode and the Audit Engine.
- Journey Builder's `journey_stages` table + `journeyQueries.ts` CRUD, if the diagnostic should read a client's existing journey/conversion-action configuration.
- PDF output: `backend/src/services/export/pdfGenerator.ts` (Audit Engine's PDFKit 5-page report) or Strategy Gate's `generateBriefPdf()` / `uploadStrategyBriefPdf()` pattern (`backend/src/api/routes/strategy.ts:461`).

**Not reusable / net-new required:**
- Neither existing orchestrator fits a standalone lightweight check — Planning Mode's `sessionOrchestrator.ts` is scoped to a multi-page scan-to-container flow, and the Audit Engine's `orchestrator.ts` is tied to full journey/stage simulation and scoring against an existing journey spec. Needs a new, purpose-built diagnostic orchestrator.
- "Event verdict logic" (flagging a weak/proxy primary conversion action) doesn't exist anywhere — entirely new module.
- One-time-purchase billing: today `backend/src/services/stripe/subscriptionService.ts` and `backend/src/api/routes/billing.ts` only support recurring `pro`/`agency` subscriptions (Stripe Checkout `line_items` always uses a recurring `priceId`, never `mode: 'payment'`). `planGuard.ts` enforces tier hierarchy, not per-purchase entitlements. Needs: a new one-time Stripe Checkout flow, a purchase/entitlement table, and route-level gating separate from `planGuard`.

**Tasks:**
- [ ] New backend route + service: diagnostic orchestrator (reuse `siteDetectionService` + `pageCaptureService.capturePageStandalone()`)
- [ ] New "event verdict" module: rules for weak/proxy primary conversion actions (define what counts as weak — e.g. pageview-only, no value, no CRM-stage linkage)
- [ ] Surface as an Output inside Client Projects / Planning Mode (in-app, gated by existing plan tiers)
- [ ] New Stripe one-time Checkout session flow (`mode: 'payment'`) + entitlement record table (new migration) for the standalone product
- [ ] New standalone route/page (outside the org-authenticated app shell, or a lightweight authenticated purchase flow — decide based on whether prospects need an account first)
- [ ] PDF output reusing `pdfGenerator.ts` or the Strategy Gate brief-export pattern
- [ ] Pricing/entitlement copy + checkout UI

**Dependency / risk note:** building both halves simultaneously roughly doubles Phase 0 scope versus the in-app-only path the PRD itself flags as the lower-risk option for this deadline. If capacity turns out insufficient, the in-app diagnostic is the fallback minimum (see Open Questions).

---

### M1 — LinkedIn API version bump

**Why now.** LinkedIn sunsets Marketing API versions on roughly an annual cadence; version `202507` is already sunset per the source document.

**Current state.** `backend/src/services/capi/linkedinDelivery.ts:32` hardcodes `const LINKEDIN_VERSION = '202501'` — older than the already-sunset `202507`, and predates every 2026 feature (qualified leads, new identifiers, cross-account discovery). Used in `linkedInHeaders()` (lines 77–84) as the `LinkedIn-Version` header, called from `sendLinkedInEvents()` (line 193) and `sendLinkedInTestEvent()` (line 287).

**Tasks:**
- [ ] Bump `LINKEDIN_VERSION` to a current supported version
- [ ] Add a standing recurring check (not a one-time fix) — e.g. a dated comment + calendar reminder, or a lightweight version-currency check job — since this will go stale again on LinkedIn's own clock. Fold **M3** (Google Ads `GOOGLE_ADS_API_VERSION = 'v17'` pin in `backend/src/services/offline-conversions/googleOfflineUpload.ts:37`, used only for the read-only GAQL conversion-action metadata lookup, not ingestion) into this same recurring check rather than treating either as one-off.
- [ ] Regression-test existing LinkedIn CAPI delivery against the new version before merging (this is a live delivery path — a bad version bump silently under-reports, per the PRD's own failure-mode framing)

**Note:** this bump is a prerequisite for B8 (qualified-lead conversion types don't work on `202501` regardless) — do this first even though B8 is Phase 1.

---

### B12 — DQM client-facing alert delivery

**Why now.** Without delivery, match-rate decay or GTG failures sit in a database table nobody looks at until spend is already gone. Correction to prior status notes: DQM's detection/scheduling side is *already built* — this is purely a wiring gap.

**Current state.**
- `backend/src/services/queue/worker.ts:1269-1272` — confirmed 15-minute cron already running: `dqmQueue.add({ trigger: 'scheduled' }, { repeat: { cron: '*/15 * * * *' }, jobId: 'dqm-15min' })`.
- `backend/src/services/dqm/dqmOrchestrator.ts` `applyAlertDecision()` (~line 80) calls `createAlert()` on an `'open'` decision.
- `backend/src/services/database/healthQueries.ts:168-193` `createAlert()` — confirmed it *only* does a single-row INSERT into `health_alerts`. No email/Slack dispatch anywhere in this function or its callers.
- `backend/src/services/usage/alertDelivery.ts` (165 lines) — the one working delivery path in the codebase, but wired to internal operator concerns (margin thresholds, fair-use caps, Browserbase reconciliation), never called from DQM. Pattern: `sendOperatorAlert(message, severity)` never throws (console-log fallback always fires), then `Promise.allSettled([sendEmail(...), sendSlack(...)])` — `sendEmail()` gated on `env.OPERATOR_ALERT_EMAIL` + `env.RESEND_API_KEY` (Resend API), `sendSlack()` gated on `env.OPERATOR_SLACK_WEBHOOK_URL`.
- `ihc_alert_preferences` table (`supabase/migrations/20260610002_implementation_health.sql:133-149`) — the closest existing **per-org notification-preference** pattern: one row per org, discrete boolean flags per severity tier (`email_critical_enabled`, `email_high_digest_enabled`, `email_medium_digest_enabled`, `email_low_enabled`), digest-scheduling fields (`digest_timezone`, `daily_digest_hour`, `weekly_digest_day`, `weekly_digest_hour`), `critical_alert_batch_minutes`, and array columns `recipient_user_ids uuid[]` / `paused_properties uuid[]`. Used by `backend/src/services/ihc/alertService.ts`'s `getPrefs()`, `resolveRecipientEmails()`, `runDailyDigestsForDueOrgs()`, `runWeeklyDigestsForDueOrgs()`.

**Tasks:**
- [ ] New migration: `dqm_alert_preferences` table mirroring `ihc_alert_preferences`'s shape (per-org row, per-severity flags, recipient list, digest timing) — reuse the IHC pattern rather than inventing a new one, per the PRD's explicit instruction
- [ ] Extend `applyAlertDecision()` in `dqmOrchestrator.ts` to call a new delivery function after `createAlert()` succeeds
- [ ] New delivery function modeled on `alertDelivery.ts`'s never-throws / `Promise.allSettled` email+Slack pattern, but reading per-org preferences from `dqm_alert_preferences` instead of global env-var gating
- [ ] Reuse `ihc/alertService.ts`'s `resolveRecipientEmails()` logic (org owner fallback via `profiles` + `supabaseAdmin.auth.admin.listUsers()`) if no explicit recipients configured
- [ ] Settings UI: extend or mirror IHC's alert-preferences screen for DQM

---

## Phase 1 — Next

### B7 + B8 — LinkedIn bundle (Enricher destination + qualified-lead conversion types)

**Why now.** LinkedIn now bids directly on MQL/SQL via `MAX_QUALIFIED_LEAD` — a larger commercial wedge for Atlas's B2B/GCC/SEA client base than another Google or Meta audience push. Depends on **M1** (Phase 0) — none of this works on API version `202501`.

#### B8 — Qualified-lead conversion types + new identifiers

**Current state.** `linkedinDelivery.ts`'s `LinkedInUserId` union (lines 36-40) supports only 4 idTypes (`SHA256_EMAIL`, `LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID`, `ACXIOM_ID`, `ORACLE_MOAT_ID`) — no IP-based identifier type. `userInfo` (lines 49-55) declares `title`/`companyName` fields that are never populated by `formatLinkedInEvent()` (lines 97-146). No `conversionOwnershipTypes` field anywhere. Confirmed: the "event type" for LinkedIn currently lives entirely in the pre-configured Conversion URN (`creds.conversion_id`), not a per-event type enum (comment at line 144: *"event type lives in the conversion URN, not the payload"*) — this is the architectural piece that needs to change to support qualified-lead conversion *rule types* distinct from the base conversion.

**Tasks:**
- [ ] Add `MAX_QUALIFIED_LEAD`, `MARKETING_QUALIFIED_LEAD`, `SALES_QUALIFIED_LEAD` conversion rule type support
- [ ] Add `PLAINTEXT_IP_ADDRESS`, `GOOGLE_AID`, `SHA256_IP_ADDRESS` to the `LinkedInUserId` idType union
- [ ] Add `conversionOwnershipTypes` field to the conversion event payload
- [ ] Multi-account conversion discovery (currently single conversion-ID-per-provider model — check `capi_providers.credentials` shape for how this needs to extend)
- [ ] Populate the previously-dead `title`/`companyName` fields in `formatLinkedInEvent()` if qualified-lead scoring benefits from them

#### B7 — LinkedIn Matched Audiences as Enricher destination

**Current state.** `backend/src/services/enricher/enricherService.ts`:
- `EnricherDestination` type (lines 17-22) is a closed union: `'GOOGLE_ADS' | 'GA4' | 'DV360' | 'CM360'` — all Google-DMA-only, matching `DMADestinationType` in `backend/src/integrations/google/dmaTypes.ts:6`.
- `buildDestinations()` (lines 61-68) maps 1:1 into `DMADestination[]` with no branching for non-Google types.
- `runAudienceEnricher()` (lines 70-170) always calls `ingestAudienceMembers()` from `@/integrations/google/dmaClient` — a single hardcoded delivery path.
- `enricher_runs.destinations` column (`supabase/migrations/20260612_001_enricher_runs.sql:5`) is untyped `jsonb NOT NULL DEFAULT '[]'` with no CHECK constraint — no migration required to *store* a LinkedIn destination object, only application-layer changes.

**Tasks:**
- [ ] Add a new destination type literal (e.g. `'LINKEDIN_MATCHED_AUDIENCE'`) to `EnricherDestination.type`, plus a LinkedIn-specific identifier field (e.g. `audienceId`/`segmentId`)
- [ ] New LinkedIn Matched Audiences ingestion client (separate from `dmaClient`)
- [ ] Branch `buildDestinations()` / `runAudienceEnricher()` to route non-Google destinations to the new client instead of `ingestAudienceMembers()`
- [ ] CRM-stage → LinkedIn-conversion-type mapping UI/config (explicitly consulting-adjacent — a judgement call that fails quietly if done badly; needs product input, not just engineering)
- [ ] Data Manager Console (agency plan aggregation view) — extend to show LinkedIn alongside DMA state if in scope

---

### B1 + M4 — Consent bundle (GPC detection + audit trail)

**Why now.** Twelve US states have required programmatic GPC (Global Privacy Control) honouring since 1 Jan 2026, propagating to pixels, CAPI calls, and list uploads — enforcement is running as coordinated multi-state sweeps that specifically test for proof the suppression came from an automatic browser signal, not just that it happened.

#### B1 — GPC detection + suppression proof

**Current state.**
- Confirmed zero matches anywhere in the repo for `GPC`, `Sec-GPC`, `globalPrivacyControl`.
- `frontend/src/lib/consent/consent-engine.ts`: `recordConsent()` (lines 148-186) always hardcodes `source: 'builtin'` — no code path inspects `navigator.globalPrivacyControl` or a `Sec-GPC` request header. `initConsentEngine()` (lines 216-243) only reads/writes `localStorage`, falling back to an all-`denied` GCM default when there's no prior snapshot — a static privacy-first default, not signal-driven.
- `ConsentSource` type (`frontend/src/types/consent.ts:12`, mirrored in `backend/src/types/consent.ts:12`): `ConsentMode | 'api'` where `ConsentMode = 'builtin' | 'onetrust' | 'cookiebot' | 'usercentrics'`. No `'gpc'` value.
- `consent_records` table (`supabase/migrations/20260317_001_consent_and_capi_tables.sql:49-64`): `source TEXT NOT NULL DEFAULT 'builtin' CHECK (source IN ('builtin','onetrust','cookiebot','usercentrics','api'))` — the `'api'` precedent shows this field is meant to carry non-banner sources, but has no GPC-specific value. Table also has `ip_country`, `user_agent`, `gcm_state`, `decisions` JSONB — the shape a GPC-triggered denial row needs to conform to. RLS policy `public_insert_consent` (lines 181-183) already allows unauthenticated INSERTs, relevant since GPC detection is an unauthenticated/edge-triggered write.

**Tasks:**
- [ ] Add `'gpc'` to `ConsentSource`/`ConsentMode` in both `frontend/src/types/consent.ts:12` and `backend/src/types/consent.ts:12`
- [ ] Add `'gpc'` to the `consent_records.source` CHECK constraint (new migration)
- [ ] Client-side detection: read `navigator.globalPrivacyControl` on page load; server-side: read `Sec-GPC` request header where applicable
- [ ] On detection, auto-set marketing/personalisation GCM signals to denied without a re-prompt (wire into `initConsentEngine()` / banner init path), write a `consent_records` row with `source: 'gpc'`
- [ ] Build the audit-trail proof: confirm and surface that a GPC-triggered denial actually suppressed CAPI dispatch (check consent-gating logic already in `pipeline.ts`'s `isConsentGranted()`) and suppressed Customer Match / audience uploads before transfer — this proof is the sellable output, not just the detection
- [ ] **Open decision (flagged in the PRD, not yet resolved):** should GPC detection hard-block re-consent prompts, or should the banner still be allowed to offer opt-in afterward? CMPs differ by state. Recommend: hard-block re-prompt by default (matches the "no re-prompt" language in the PRD's own scope line) but make it a per-org config toggle since CMP behavior varies — confirm with Vikram before building the banner-suppression logic, since this changes the UI flow.

#### M4 — Consent-source provenance

**Current state.** `ConsentSource` already supports the `'api'` precedent for non-banner sources — the field exists, but nothing populates a GPC-specific value today because GPC detection itself doesn't exist yet (blocked on B1).

**Tasks:**
- [ ] Once B1 ships, confirm `'gpc'` is written correctly as the `source` value on every GPC-triggered `consent_records` row (this is largely satisfied by B1's implementation directly — treat as an acceptance criterion of B1 rather than separate work, per the PRD calling it a "counterpart")

---

### B2 — "ad_storage is the sole Google gate" guidance (ride-along, not a phase item on its own)

**Why now.** On 15 June 2026 Google decoupled Google Signals from advertising data flow; `ad_storage` became the sole control over whether Analytics data reaches Google Ads.

**Current state.** `GCMSignal` type (`frontend/src/types/consent.ts:17-24`) already correctly includes `ad_storage`, `ad_user_data`, `ad_personalization` — the plumbing is fine. Confirmed zero matches for `google_signals` anywhere under `backend/src/services/planning`. The implementation guide's only Consent Mode copy today is an info-box in `backend/src/services/planning/generators/implementationGuideGenerator.ts:425-427` describing Consent Mode v2 defaults generically — no mention of Google Signals independence anywhere.

**Tasks:**
- [ ] Add explicit copy to `implementationGuideGenerator.ts`'s Section 4 (`platformSection`, ~line 420) stating `ad_storage` is the sole Google Signals gate
- [ ] Add the same guidance to the Consent Hub configuration screen
- [ ] Consider a one-time check flagging any client CMP config still treating Google Signals as independent

Bundle this with Phase 1's consent work since it touches the same subsystem and guide-generation pipeline.

---

## Phase 2 — Then

### B6 + M2 — TikTok bundle (real backend delivery + event-name fix)

**Why now.** TikTok is one of the seven platforms this whole analysis covers, and Atlas's own code already flags its integration as a stub.

**Current state.**
- `frontend/src/lib/capi/adapters/tiktok.ts`: `send()` (lines 172-180) and `sendEvents()` (lines 205-216) unconditionally return `error_code: 'CLIENT_SIDE_DELIVERY_NOT_SUPPORTED'`. `sendTestEvent()` (lines 218-227) also fails — and the fallback it points to (`POST /api/capi/providers/:id/test`) has no `tiktok` branch either (`backend/src/api/routes/capi.ts:291-343`), so testing is currently a dead end.
- No `backend/src/services/capi/tiktokDelivery.ts` exists — confirmed via directory listing (`customerMatch.ts, credentials.ts, metaDelivery.ts, dedupStore.ts, googleDelivery.ts, linkedinDelivery.ts, amazonDelivery.ts, pipeline.ts` only).
- `pipeline.ts`'s `deliverToProvider()` switch (lines 299-361) has no `tiktok` case — falls to `default`, returning `UNSUPPORTED_PROVIDER`.
- `frontend/src/components/capi/ProviderList.tsx`: `ADDABLE_PROVIDERS` (lines 35-40) deliberately excludes `tiktok` (and `snapchat`) from the "add new provider" flow, though `PROVIDER_LABELS` (lines 13-20) still has a `tiktok: 'TikTok'` display label for legacy rows.
- `TIKTOK_EVENT_SUGGESTIONS` (lines 69-84 of the same adapter file) maps `form_submit`/`lead` to `'SubmitForm'` (lines 81-82) — the pre-2025 deprecated name. `TIKTOK_STANDARD_EVENTS` (lines 61-65) has no `'Lead'` value at all currently.

**Reuse pattern:** the most recent full provider addition (Amazon, `20260701001_amazon_capi_provider.sql`) is the concrete precedent for wiring a real backend — 8 touch points confirmed by tracing that migration: DB CHECK constraint, `CAPIProvider`/`CAPIAdapterName` unions + credentials interface in both `frontend/src/types/capi.ts` and `backend/src/types/capi.ts` (kept in sync manually), new delivery service, `dedupStore.ts` getter, `pipeline.ts` dispatch case, `capi.ts` route branches, `ProviderList.tsx`/`ConnectAccount.tsx` UI.

**Tasks:**
- [ ] New `backend/src/services/capi/tiktokDelivery.ts` mirroring `linkedinDelivery.ts`'s shape: format function, `sendTikTokEvents()` (batch), `sendTikTokTestEvent()`, `validateTikTokCredentials()`
- [ ] New `getTikTokDedupEntry()` in `dedupStore.ts` following the existing per-provider getter pattern
- [ ] Add `tiktok` case to `pipeline.ts`'s `deliverToProvider()` switch, and to `NATIVE_ID_FIELD` / `isConsentGranted()` if TikTok's event-ID or consent mapping differs from defaults
- [ ] Add `tiktok` branches to `capi.ts`'s credential-validation (`POST /providers`) and test-event (`POST /providers/:id/test`) routes
- [ ] Add `tiktok` to `ProviderList.tsx`'s `ADDABLE_PROVIDERS` and wire credential-input UI in `ConnectAccount.tsx`
- [ ] Frontend adapter stub stays as-is architecturally (per the LinkedIn/Amazon precedent, `send()`/`sendEvents()` correctly return `CLIENT_SIDE_DELIVERY_NOT_SUPPORTED` since real delivery is backend-only) — just confirm the pipeline path (`/api/capi/process`) now actually delivers
- [ ] **M2, same file, do together:** change `TIKTOK_EVENT_SUGGESTIONS`'s `form_submit`/`lead` mapping from `'SubmitForm'` to `'Lead'`

---

### B3 — Signal Library validity window and deprecation dates

**Why now.** TikTok's `ClickButton`/`PlaceAnOrder` events sunset in 2027, LinkedIn sunsets API versions annually, Google closed three Ads API endpoints in six months — a library that only describes current state rots invisibly.

**Current state.** `signals` table (`supabase/migrations/20260619_001_signal_library_tables.sql:7-26`) has a bare `version INTEGER NOT NULL DEFAULT 1` — no `valid_from`, `deprecated_at`, or supersession-pointer column. Same for `signal_packs` (lines 78-89, `version INTEGER NOT NULL DEFAULT 1` at line 85). `SignalCard.tsx` has no version/deprecation field or badge logic at all (grep confirms no matches beyond an unrelated `category` color usage). `SignalLibraryPage.tsx` has no version/deprecated/sunset-aware grouping or filtering.

**Tasks:**
- [ ] New migration: add `valid_from`, `deprecated_at`, `superseded_by_signal_id` (FK to `signals.id`) to `signals`
- [ ] Consider the same fields on `signal_packs` if packs need pack-level sunset messaging
- [ ] Sunset badge component in `SignalCard.tsx`; surface deprecation state in `SignalLibraryPage.tsx`'s filtering/grouping
- [ ] Backfill first dated entries from what's already known: legacy Google Ads ingestion endpoints (deprecated), TikTok's pre-2025 event names (`SubmitForm` → `Lead`, tying back to M2)

---

## Phase 3 — Opportunistic / low urgency

### B4 — Microsoft Advertising provider (UET + Conversions API)

**Why now.** Microsoft published Conversions API documentation in beta on 17 Aug 2026 — scarce positioning asset while beta access lasts, but low volume for most accounts today.

**Current state.** Zero references to Microsoft/Bing/UET anywhere in `backend/src`.

**Tasks:** follow the Amazon-precedent 8-touch-point pattern documented under B6/M2 above (CHECK constraint migration, both `types/capi.ts` unions + credentials interface, new `microsoftDelivery.ts`, `dedupStore.ts` getter, `pipeline.ts` dispatch, `capi.ts` route branches, `ProviderList.tsx`/`ConnectAccount.tsx` UI). Sequence after B6/B8 per the PRD.

### B5 — OpenAI / OAIQ provider

**Why now.** ChatGPT ads reached Europe on 24 Aug 2026 with almost no regional agency instrumentation yet — low volume, high visibility.

**Current state.** Zero references to `openai`/`oaiq` anywhere in the repo.

**Tasks:** same 8-touch-point pattern as B4. Additionally: build the OAIQ pixel (`__oppref` first-party cookie, 720-hour lifetime) plus server-side Conversions API with event-ID dedup and hashed identifiers. **Explicitly do not build or market** incrementality/MMM features — the platform itself has none (no multi-day attribution windows, no lift studies, 24-48hr reporting lag). Instrumentation + dedup only.

### B10 — Reconciliation "known platform discontinuity" annotations

**Why now.** Meta's click-through redefinition (3 Mar 2026) and GA4's attribution-model narrowing moved platform-reported numbers for reasons unrelated to performance — every diff the engine finds today gets surfaced as an unexplained anomaly.

**Current state.** Confirmed zero matches for "engage-through," "click-through," "last-touch" across `backend/src/services/reconciliation/engine/` (`configDiff.ts`, `volumeDiff.ts`, `deliveryDiff.ts`, `alignmentDiff.ts`, `identityDiff.ts`). Pipeline: `reconciliationRunner.ts`'s `executeRun()` (line 53) runs each diff module in sequence, each isolated in its own try/catch, each calling `findingWriter.ts`'s `writeFinding()` with a coded `FindingInput`.

**Tasks:**
- [ ] New discontinuity register (no table/config exists today — needs a new table or config file: `{ platform, effective_date, description }`)
- [ ] New `engine/discontinuityDiff.ts` module mirroring `configDiff.ts`'s shape (query active `platform_connections`, loop, call `writeFinding()`)
- [ ] Register as a new step in `reconciliationRunner.ts`'s `executeRun()`, checked *before* the volume/alignment diffs write their own findings so a discontinuity-shaped drift gets annotated instead of raised as an anomaly
- [ ] New `FindingCode`/dimension in `../codes/findingCodes`
- [ ] Seed the register with Meta's 3 Mar 2026 redefinition and GA4's attribution-window narrowing; extend over time as new platform-side redefinitions ship

### B13 — AIR (Auto-Insight Reporter) LinkedIn connector

**Why now.** As LinkedIn becomes a first-class qualified-lead bidder (post-B8), anomaly detection and narrative reporting should eventually cover it too. Sequence last — no LinkedIn data worth narrating until B8 ships.

**Current state.** Correction to prior status notes: `backend/src/services/air/` (`anomalyDetector.ts`, `correlationEngine.ts`, `narratorService.ts`, all with tests) is substantially built, not absent. `air/ingestion/` has `metaAdsConnector.ts`, `googleAdsConnector.ts`, `ga4Connector.ts` only — `ingestionOrchestrator.ts` explicitly restricts eligibility to orgs with an active connection on `['google_ads', 'meta_ads', 'ga4']` and imports only those 3 connectors. `AirMetricRow.source` (`airIngestionUtils.ts:5`) is a closed union `'google_ads' | 'meta_ads' | 'ga4'`.

**Tasks:**
- [ ] New `air/ingestion/linkedInAdsConnector.ts` mirroring `metaAdsConnector.ts`'s 4-step shape: fetch campaign insights → build flat metric rows → entry point resolving tokens via `tokenManager` → write via `airIngestionUtils.ts`'s shared helper
- [ ] Widen `AirMetricRow.source` union to include `'linkedin_ads'`
- [ ] Register the new connector in `ingestionOrchestrator.ts`'s `Promise.allSettled` list and eligibility filter

### B11 — Google DMA CompositeData (IP + observation timestamp)

**Why now.** From Q3 2026, Google will accept IP + observation-timestamp pairs into Customer Match via the Data Manager API's `CompositeData` field — **not yet live**, blocked on Google shipping it.

**Current state.** `backend/src/integrations/google/dmaTypes.ts:77-83` — `DMAUserIdData` has only `hashedEmail`, `hashedPhoneNumber`, `mobileDeviceId`, `userId`, `addressInfo`. No `CompositeData`/IP/timestamp fields anywhere, as expected since Google hasn't shipped this yet.

**Tasks:** track Google's Q3 rollout; add the field to `DMAUserIdData` and the DMA client once the schema publishes. No action until then — listed so it's on the roadmap rather than rediscovered later.

### D1 — Remove the stale `dqm-hourly` Bull job

**Why now.** Housekeeping found while verifying B12.

**Current state.** `worker.ts:1265-1268`'s own comment confirms: the 15-minute fan-out (line 1269-1272) replaced an hourly job, but the old repeatable registration was never explicitly removed from Redis — may still fire redundant (harmless) fan-outs.

**Tasks:**
- [ ] One-time call to Bull's `removeRepeatable` for the old `'dqm-hourly'` job id

---

## Informational only — no sprint work required

**D2 — "We'll set up your CAPI" positioning.** Not a code change. Google's Data Manager ships its own no-code connectors and Meta's CAPI is now free/one-click/Meta-hosted — the platforms are commoditising bare installation. Deprioritize any future roadmap item whose only value is pixel/CAPI installation; Atlas's defensible ground is reconciliation, consent-as-liability, signal decay monitoring, and the Strategy Gate verdict layer.

**D3 — Legacy Google Ads ingestion paths.** Confirmed already clean. `googleDelivery.ts` and `googleOfflineUpload.ts` both route through `datamanager.googleapis.com/v1/events:ingest`, not `ConversionUploadService`/`OfflineUserDataJobService`/`UserDataService`. `docs/ATLAS_GOOGLE_FIRST_PARTY_INTEGRATION_PRD.md`'s Phase 1 scoped exactly this migration, and the code confirms it shipped. No action — listed to close the loop on a prior assumption that this was still outstanding.

---

## Open questions carried over from the source PRD

These weren't fully resolved during planning and should be confirmed before or during the relevant phase:

1. **Legacy client-side audit.** Confirm whether any live client accounts run a pre-DMA integration path outside this codebase (e.g. a manually configured legacy Ads API integration Atlas doesn't manage) — worth a client-side audit even though Atlas's own code is clean (per D3).
2. **GPC default behaviour (B1).** Hard-block re-consent prompts once GPC is detected, or still let the banner offer opt-in? CMPs differ by state. Flagged inline under B1 above with a recommended default (hard-block, configurable per org) — needs confirmation before building the banner-suppression logic.
3. **Phase 0 capacity risk.** The user has chosen to build B9's full scope (in-app diagnostic + standalone paid product) simultaneously ahead of 1 Sept, which is meaningfully more work than the PRD's own lower-risk option (in-app only, paid product deferred). If capacity turns out insufficient as the deadline approaches, the realistic fallback minimum is B9 in-app diagnostic alone, or B9 in-app + M1 — decide which to protect before the deadline forces the choice.
