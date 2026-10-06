# PRD · GA4 Admin Config Integration, L11 Reconciliation, Junk Conversion Gate

**Target path:** `docs/prd/ga4-admin-l11-junk-conversion-gate.md`
**Status:** Ready for build
**Date:** 2026-10-06
**Owner:** Vikram Jayanand

This PRD covers three pieces of work in one document because they share data paths. Part A produces new GA4 configuration findings; Part B surfaces those findings (and every existing reconciliation finding) in the Check Register v2 report; Part C protects the outbound signal itself. Build order is A, then B, then C.

Read this alongside `CLAUDE.md`, `docs/ATLAS_L11_RECONCILIATION_SCOPING.md` (Part B is built from its §5 to §7), and `docs/prd/google-tag-topology.md`. Where this PRD and the code disagree, the code wins and the deviation is recorded in §12 of this document, following the pattern already used in `docs/prd/universal-outcome-ingestion.md`.

---

## 0. Sprint 0 · Verification before any code

Three things must be checked before Part A, B or C writes a line of product code. Each follows Key Technical Decision §14 (verify third-party schemas against their live source).

1. **GA4 Admin API schema.** Fetch the live Discovery Documents for both `https://analyticsadmin.googleapis.com/$discovery/rest?version=v1beta` and `?version=v1alpha`. For every resource listed in §A.3, record which version exposes it, the exact field names, and the required OAuth scope. If this sandbox's egress proxy blocks the fetch (it has blocked Google docs before), record that, use the closest verifiable source, and flag every affected type as unverified in its file header.
2. **GTM API v2 publish scopes.** Confirm which scopes `workspaces.create_version` and `versions.publish` require (expected: `tagmanager.edit.containerversions` and `tagmanager.publish`). Same fallback rule as above.
3. **Live event entry points.** Trace every caller of `processEvent()` and `processServerSourcedEvent()` in `backend/src/services/capi/pipeline.ts`, plus the offline CSV upload path and the outcome webhook path, and document where a single Atlas event fans out to multiple provider configs. Part C's gate must sit at that fan-out boundary (see §C.4). Record the result in §12.

Exit criterion: a short note appended to §12 listing what was verified, what could not be, and any change to the scope below that results.

---

# Part A · GA4 Admin config integration (plus GTM publish)

## A.1 Problem

Atlas already talks to the GA4 Admin API, but only narrowly. `ga4Discovery.ts` reads `accountSummaries` and `ga4Sync.ts` reads `keyEvents` into `platform_conversion_actions`. The GA4 OAuth scope is `analytics.readonly` (`ga4OAuth.ts`). Atlas never reads the property's configuration state, so a whole class of drift that silently corrupts measurement is invisible: a container sending to a measurement ID that is not one of the property's streams, enhanced measurement double-counting form submissions Atlas already tracks, a missing Google Ads link, or a GA4 currency that differs from the Ads account's.

The Google Stack Alignment Sprint 4 row in `CLAUDE.md` names this directly: "Live GA4 Admin API cross-referencing ... remains a noted gap."

## A.2 Goal

Snapshot each connected GA4 property's configuration on a schedule, check it against what Atlas knows about the client (GTM container, Journey Builder signals, Google Ads connection), write real findings into the existing reconciliation pipeline, and alert on drift between snapshots through DQM.

Also in scope, bundled because it is OAuth work on the same Google consent screen: widen the GTM connection so Atlas can create and publish container versions, not only push drafts.

## A.3 GA4 configuration read

Read-only. No write scopes for GA4 in this PRD.

Resources to read per property (versions and field names to be confirmed in Sprint 0; this list is the intent, not the verified schema):

| Resource | Used for |
|---|---|
| Property (`currencyCode`, `timeZone`) | Currency and time zone alignment with Google Ads |
| Data streams (web stream `measurementId`, `defaultUri`) | Measurement ID and domain checks against the container and client |
| Enhanced measurement settings (per web stream) | Form interaction double-count check |
| Google Ads links | Link presence check against the client's connected Ads customer |
| Key events (already synced) | Reused; no new call |
| Data retention settings | Informational disclosure |

Cross-domain configuration: as far as is known the GA4 "configure your domains" list is a Google tag setting and is **not** exposed by the Admin API. Sprint 0 confirms this. If it is not exposed, the C5 cross-domain gap stays as it is today and no rule pretends otherwise.

Google Ads side: the currency and time zone check needs the Ads customer's own `currency_code` and `time_zone`. These are not synced today (`googleAdsSync.ts` only reads conversion-action value settings). Add a GAQL read of `customer.currency_code, customer.time_zone` to `googleAdsSync.ts`, using `GOOGLE_ADS_API_VERSION` from `adsApiVersion.ts` (Key Technical Decision §23). Update the §24 table if a new call site is added.

### Implementation

- New `backend/src/services/reconciliation/sync/ga4ConfigSync.ts`. Share the `adminGet()` helper with `ga4Sync.ts` rather than duplicating it; extract it to a small `ga4AdminClient.ts` with a single base-URL constant per API version (do not repeat the duplicated `DMA_BASE_URL` pattern).
- Wire into `reconciliation/sync/syncOrchestrator.ts` alongside the existing GA4 sync, so it runs on the same schedule and trigger (`POST /api/reconciliation/trigger`).
- New table `ga4_config_snapshots` (migration named `YYYYMMDDNNN_ga4_config_snapshots.sql`, per Key Technical Decision §21; RLS required): `id`, `organization_id`, `connection_id`, `client_id` (nullable), `property_id`, `snapshot jsonb` (normalised, non-PII), `snapshot_hash`, `captured_at`. Write a new row only when `snapshot_hash` changes, so the table is a change log rather than a poll log.
- If the existing `analytics.readonly` scope covers every resource in §A.3 (expected), no reconnect is needed. If Sprint 0 finds a resource needs more, stop and record it in §12 rather than widening silently.

## A.4 Findings

New `FindingCode` values in `reconciliation/codes/findingCodes.ts`, each with `FINDING_META` narrative and remediation. Written via the existing `findingWriter.ts`.

| Code | Dimension | Severity | Fires when |
|---|---|---|---|
| `GA4_STREAM_ID_NOT_IN_PROPERTY` | config | error | The GA4 `tagId` in the client's connected or generated GTM container is not any web stream's `measurementId` on the connected property |
| `GA4_STREAM_DOMAIN_MISMATCH` | config | warning | No web stream's `defaultUri` host matches the client's primary domain or `secondary_domains` |
| `GA4_ENHANCED_FORM_DOUBLE_COUNT` | alignment | warning | Enhanced measurement form interactions are on for the stream, and the client has an Atlas lead or form-submit signal deployed to GA4 |
| `GA4_ADS_LINK_MISSING` | alignment | error | The client has a connected Google Ads customer with no Google Ads link on the GA4 property |
| `GA4_ADS_CURRENCY_MISMATCH` | config | warning | GA4 property currency differs from the linked Ads customer currency |
| `GA4_ADS_TIMEZONE_MISMATCH` | config | info | GA4 property time zone differs from the Ads customer time zone |
| `GA4_SIGNAL_NOT_KEY_EVENT` | alignment | warning | A Journey Builder stage marked as a conversion maps to a GA4 event name that is not a key event on the property |

Wording rule: every narrative states what was observed, never a cause it cannot see. `GA4_ENHANCED_FORM_DOUBLE_COUNT` says the configuration "can count the same submission twice", not that it does. `outputLint.ts`'s banned tokens apply.

A finding that depends on a client association (all of the above except a bare property read) is only written when the GA4 connection is associated with a client. No client, no finding.

## A.5 Drift alerts

On each new snapshot row, diff against the previous snapshot for the same property. Changes to stream measurement IDs, enhanced measurement settings, Ads links, currency or time zone produce one DQM alert through the existing `dqmAlertDelivery.ts` (email, Slack, webhook), new alert type `ga4_config_changed`. Follow the Google Tag Topology precedent: one rolled-up alert per org per run, per-property detail in the snapshot table, and update the `health_alerts` alert-type CHECK in the same migration.

A config change is also written as a `client_tracking_change` row in `platform_discontinuities` (scoped to the client, `platform = 'ga4'`) when it changes how data is collected: stream ID change, enhanced measurement form toggle, currency change. This lets `discontinuityDiff.ts` and AIR's `correlationEngine.ts` annotate later volume shifts as a known change rather than drift, using the mechanism migration `20260921003` already built.

## A.6 GTM publish (bundled OAuth work)

Today `api/routes/gtm.ts` requests `tagmanager.readonly` and `tagmanager.edit.containers`, and `gtmDeployService.ts` pushes a generated container into a workspace as a draft. A human then publishes in GTM.

Add:

- Widen `GTM_SCOPE` with the version and publish scopes confirmed in Sprint 0. Existing connections keep working for draft deploy; a connection authorised under the old scope set must reconnect to publish (Google re-prompts on widened scopes; there is no silent upgrade). Surface a "reconnect to enable publishing" state on the connection, never a failed publish.
- `POST /api/gtm/publish`: creates a container version from the Atlas-deployed workspace, then publishes it. Requires an explicit confirmation flag in the request body and a human user session; never callable from a queue job or a scheduled task.
- Record every publish in a new `gtm_publish_log` table (org, client, container, version ID published, previous live version ID, user, timestamp).
- `POST /api/gtm/publish/:logId/rollback`: re-publishes the recorded previous version. This is the safety net that makes programmatic publishing acceptable.
- After publish, trigger an IHC snapshot of the container so drift baselines reflect the new live version.

## A.7 Acceptance criteria

1. A connected GA4 property associated with a client produces a `ga4_config_snapshots` row on first sync and no new row on a repeat sync with unchanged config.
2. Each finding in §A.4 has a unit test for fire and no-fire cases, using fixtures shaped from the Sprint 0 verified schema.
3. No finding is written for a GA4 connection with no client association.
4. A config change between two snapshots produces exactly one rolled-up DQM alert for the org, and a `client_tracking_change` discontinuity for the qualifying change types only.
5. Ads `currency_code`/`time_zone` read uses `GOOGLE_ADS_API_VERSION`; §24's table is updated.
6. GTM publish refuses without the confirmation flag, refuses on an old-scope connection with a named error, writes a log row on success, and rollback republishes the logged previous version.
7. No PII in snapshots, logs or queue payloads.

---

# Part B · L11 Reconciliation (disclosure-only)

## B.1 Decision already made

Built exactly as `docs/ATLAS_L11_RECONCILIATION_SCOPING.md` decided on 2026-09-13: L11 findings render in the Check Register v2 report and **never enter any score**, numerator or denominator. This section does not re-open that decision; it specifies the build.

## B.2 Scoring isolation (do this first)

Follow scoping doc §6. `LAYER_WEIGHT` is not the lever.

- Add `SCORED_V2_LAYERS` to `validation/register/layers.ts` = `ALL_V2_LAYERS` minus `reconciliation`. `ALL_V2_LAYERS` stays at 13.
- Pass `SCORED_V2_LAYERS` everywhere `scoring.ts` currently defaults to `ALL_V2_LAYERS`, so L11 never enters `layerScoringDecisions`, `coverageRatio`, `inScoredLayers` or `layerCoverageFromDecisions`. A fully covered run then reads "12 of 12".
- Invariant test: L11 never appears in any scored layer set, and a client-linked audit with L11 failures scores identically to the same audit with L11 data removed. Model it on the `PLATFORM_MATCHER_HOSTS` invariant test.

## B.3 Data path

- New `AuditData.reconciliation_summary` in the shape of scoping doc §3, extended with the §7 inputs: the client's Google tag topology verdict and strength (`computeTopologyVerdict()`), and client-scoped `client_tracking_change` discontinuities.
- Resolved by the audit orchestrator before `runRegister()`, following "resolve outside, read inside" (Key Technical Decision §16): audit has a `client_id`, that client has a completed `reconciliation_runs` row, take the most recent run's unresolved findings. Undefined otherwise.
- Two new precondition tags, `client_linked` and `reconciliation_data_available`. An audit with no client, a public no-login scan, or a client with no reconciliation run gets `skipped`, not `fail`.

## B.4 Rules

New file `validation/register/L11.ts`. Rules stay pure and synchronous.

| Rule | Behaviour |
|---|---|
| `RECONCILIATION_RUN_RECENT` | Flags when the most recent reconciliation run is older than 7 days. Stale data is disclosed as stale, not read as clean |
| `RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT` | Flags an unresolved critical or error `config` finding, including Part A's GA4 codes |
| `RECONCILIATION_NO_ALIGNMENT_GAPS` | Flags unresolved `alignment` findings, including `GA4_ADS_LINK_MISSING`, `GA4_SIGNAL_NOT_KEY_EVENT`, `GA4_ENHANCED_FORM_DOUBLE_COUNT` |
| `RECONCILIATION_NO_UNEXPLAINED_VOLUME_DRIFT` | Flags unresolved `volume` findings not annotated by a platform or client-scoped discontinuity |
| `RECONCILIATION_DELIVERY_HEALTHY` | Flags unresolved `delivery` findings (expired connection, events not received, low dedup, low EMQ) |

Severity drives only report prominence and ordering, since nothing is scored. Use the underlying finding's severity, capped by the evidence class rules already in the verdict lattice.

Topology wording (scoping doc §7, load-bearing): when a GA4 versus Ads discrepancy coincides with `COMBINED` or `COMBINED_ADS_PRIMARY`, combination is listed as a **candidate explanation**, never the cause. `assumed`/`none` strength carries "needs confirmation". `UNKNOWN` says nothing about combination.

## B.5 Rendering

- Render through the existing disclosure surfaces, not the Issues or score path. Extend the `UnassessableKind` discriminator (`types/audit.ts`) with a reconciliation kind rather than inventing a parallel bucket (Key Technical Decision §19). If Claude Code finds this surface reads badly for findings that were in fact assessed, record the alternative in §12 before building one.
- PDF and web report both get an "Against your connected platforms" section, omitted entirely when L11 is skipped (no empty heading, matching the Open Questions precedent).
- Every rendered line passes `outputLint.ts`.

## B.6 Before writing rule files

Scoping doc §5.1 still stands: verify the §B.3 shape against at least one real client with live reconciliation findings. If no production client has reconciliation data, build against a seeded fixture, and record in §12 that live verification is outstanding.

## B.7 Acceptance criteria

1. `REGISTER_VERSION` bumped (from the live value in `layers.ts`, currently expected `1.3.0`, to `1.4.0`).
2. Scoring invariant tests from §B.2 pass, and every existing scoring test passes unchanged.
3. Bare-URL and public scans show L11 as skipped and render no L11 section.
4. A client-linked audit with Part A GA4 findings renders them in the L11 section with correct wording.
5. Topology candidate-explanation wording is covered by tests for all four verdicts.
6. `outputLint.ts` passes for every L11 copy variant.

---

# Part C · Junk conversion gate (v1, rules only)

## C.1 Problem

Bot submissions and junk leads reach Atlas as real conversion events and are delivered to Meta, Google, LinkedIn and others as genuine signal. Bidding algorithms then optimise towards more of the same traffic. Atlas has dedup (same `event_id`) and consent gating but nothing that asks whether the conversion itself is plausible.

## C.2 Decisions taken

- **Detection:** deterministic rules only in v1. No third-party bot scoring (vendor dependency, per-event cost, extra fingerprinting under PDPA and GDPR). CRM disqualification is not a pre-upload signal, because it arrives after delivery; it belongs to a later version via the outcome contract, as a retraction path.
- **Default action:** flagged conversions are **held for review**, not dropped.
- **Auto-release:** held items time out, so a quiet reviewer never starves bidding.

## C.3 Effectiveness boundary (state this honestly in the product)

The gate can only stop what Atlas itself sends. For a hybrid setup where the browser pixel or Google tag fires the same conversion client-side, holding the server copy removes the server copy only; the platform still receives the browser event. The gate is fully effective for:

- server-only conversion events (lead events configured to fire server-side only),
- offline conversion uploads and Enhanced Conversions for Leads,
- LinkedIn CAPI and other destinations Atlas sends to server-side only,
- outcome events sent through Universal Outcome Ingestion.

v1 must classify each in-scope event per destination as `server_only` or `hybrid` from the client's deployment config, and show that classification beside the hold queue so nobody believes junk was blocked when a browser copy got through. Changing generated containers to make lead events server-only is a follow-up, not v1.

## C.4 Where the gate sits

Order within the pipeline:

1. Enrichment (existing)
2. Consent gate (existing). The junk gate only ever sees events that passed consent, so evaluating IP and user agent adds no new processing beyond what consent already allows for delivery.
3. **Junk gate (new)**
4. Dedup and onwards (existing `runFromDedup()`)

`processEvent()` is called per provider config. The gate must evaluate an Atlas event **once**, not once per provider. Sprint 0 item 3 decides the exact placement. If fan-out happens above `processEvent()`, evaluate at that boundary. If not, memoise the verdict in Redis keyed by `atlas_event_id` with a TTL longer than the hold window, and create one hold record per Atlas event listing every provider config it was bound for.

Out of scope for the gate in v1: Shopify order and refund webhooks (paid orders are not junk leads) and refund adjustments. The outcome webhook is out of scope too, since its delivery gate already handles identity quality; revisit in v2.

## C.5 Rules

New `backend/src/services/capi/junkGate/` with one pure function per rule and a small evaluator. Each rule returns `hit: boolean`, `class: 'hard' | 'soft'`, and a non-PII evidence string.

**C.5a · Rules on data Atlas already receives**

| Rule | Class | Fires when |
|---|---|---|
| `JC_EMAIL_MALFORMED` | hard | Email fails syntax validation, or has no MX-capable domain shape |
| `JC_EMAIL_DISPOSABLE` | soft | Email domain is on the bundled disposable-domain list |
| `JC_PHONE_INVALID` | soft | Phone fails validation for the event's country, or is a repeated or sequential digit pattern |
| `JC_DUPLICATE_SUBMISSION` | soft | Same hashed email or phone with the same event name within a configurable window (default 10 minutes) under a different `event_id`. Distinct from dedup, which catches the same `event_id` |
| `JC_SUBMIT_VELOCITY` | soft | More than N submissions of the same event from the same IP within an hour (default 5), counted in Redis with a hashed IP key |
| `JC_NON_HUMAN_UA` | hard | User agent matches a maintained list of headless and automation signatures |
| `JC_TEST_VALUES` | soft | Name or email local part matches a short list of obvious test values (`test`, `asdf`, `qwerty` and similar) |

**C.5b · Rules that need new capture**

| Rule | Class | Fires when | Capture needed |
|---|---|---|---|
| `JC_HONEYPOT_FILLED` | hard | A mapped honeypot field has any value | Only where the client's form already has a honeypot field, mapped through the existing signal enrichment field mapping. Atlas does not inject fields into forms |
| `JC_SUBMIT_TOO_FAST` | hard | Under 2 seconds between first form interaction and submit (configurable) | GTM generator adds first-interaction timestamp capture and passes `atlas_ms_to_submit` in `custom_data`. Golden fixtures must be updated (Google Stack Alignment Sprint 2 suite) |

Dropped deliberately: "missing click ID where one is expected". Organic and direct leads are legitimate and carry no click ID, so the rule would hold good leads.

**Verdict:** any hard hit = `junk`; two or more soft hits = `suspect`; otherwise `clean`. Thresholds are per-client configurable.

Lists (disposable domains, automation user agents) are vendored into the repo with a source note, a version string and a licence check, and refreshed by a documented manual step. No runtime fetch of third-party lists. Phone validation uses `libphonenumber-js` (not currently a backend dependency; add it).

## C.6 Holding

New table `conversion_holds` (RLS required):

`id`, `organization_id`, `client_id`, `atlas_event_id`, `event_name`, `event_time`, `provider_config_ids uuid[]`, `verdict` (`junk`/`suspect`), `rule_hits jsonb` (rule IDs plus non-PII evidence only, for example "domain on disposable list", "submitted 1.2s after first interaction"), `payload_encrypted` (AES-256-GCM via `@noble/ciphers`), `delivery_class` (`server_only`/`hybrid`), `status` (`held`/`released`/`rejected`/`auto_released`/`auto_dropped`), `expires_at`, `decided_by`, `decided_at`, `created_at`.

Privacy rules for the held payload:

- Hash identifiers (email, phone, names) **before** persisting, using the same normalisation and SHA-256 path as pipeline step 3. Raw email and phone are never written to the hold table. The reviewer sees the email domain and the rule evidence, never the address.
- Fields some destinations need in plain form (IP, user agent) stay inside the encrypted payload only.
- On any terminal status, null `payload_encrypted` (Implementation Rule 3 and Key Technical Decision §5).
- Queue jobs carry the hold ID only.

`capi_events.status` gains `junk_held` and `junk_rejected` (and `PipelineResult.status` mirrors them), so the Signal Tracking Dashboard and counters account for held events instead of losing them.

## C.7 Release, reject, timeout

- **Release** re-enters the pipeline at dedup (`runFromDedup()`) for each bound provider config, with the original `event_id`, `event_time` and the consent state captured at the time. Consent is never re-evaluated against a newer decision.
- **Reject** writes the terminal status and a `capi_events` row with `junk_rejected`. Nothing is sent.
- **Timeout:** each client sets `hold_timeout_hours` (default 24, range 1 to 72) and `timeout_action` (`release` default, or `drop`). A Bull delayed job per hold enforces it.
- **Hard ceiling:** `expires_at` can never exceed the shortest delivery window of any bound destination, minus a 12-hour safety margin. Read windows from `outcomes/ingestWindows.ts`, and add a sourced constant for Meta website events (expected 7 days; verify per Key Technical Decision §14). If the client's timeout would exceed the ceiling, clamp it and show that the clamp happened.

## C.8 Configuration

New table `junk_gate_configs`, one per client:

- `mode`: `off` / `observe` / `enforce`. **Default `observe`.** Observe evaluates every in-scope event and records verdicts without holding anything. A client moves to `enforce` only by an explicit setting change. This gives real hit-rate data before a single conversion is delayed.
- `event_names text[]`: events in scope. Default: lead-type events from the client's Journey Builder stages; purchase events excluded.
- Per-rule enable flags and thresholds.
- `action_junk`, `action_suspect`: `hold` (default) / `drop` / `send`.
- `hold_timeout_hours`, `timeout_action`.

## C.9 Review surface

New `HeldConversionsTab` in the CAPI Monitoring Dashboard, alongside `RefundsTab`:

- Queue filtered by client, verdict, rule, event name, time to expiry.
- Per item: event name, time, email domain, rule hits with evidence, delivery class (`server_only`/`hybrid` with the §C.3 explanation on hybrid), time remaining.
- Single and bulk release or reject.
- Observe mode shows the same view as a read-only "would have held" log.

No fabricated data (Implementation Rule 12): no trend chart unless a real time-series endpoint backs it.

## C.10 Monitoring

- Metrics per client: hold rate, per-rule hit rate, per-rule overturn rate (released after review divided by held), auto-release and auto-drop counts.
- DQM alerts via `dqmAlertDelivery.ts`: holds approaching timeout with no reviewer action; hold rate spike above a configurable threshold (could be an attack or a misfiring rule; the alert says both are possible). Rolled up per org, matching existing DQM alert precedent.
- A rule with a high overturn rate is flagged in the tab as likely to be holding good leads.

## C.11 Acceptance criteria

1. One Atlas event bound for three providers produces exactly one hold record and one verdict evaluation.
2. Every rule in §C.5a has fire and no-fire unit tests; `JC_DUPLICATE_SUBMISSION` is proven distinct from `event_id` dedup.
3. Observe mode never delays or blocks an event, and records verdicts.
4. Released events reach providers with the original `event_id`, `event_time` and consent state; dedup still applies.
5. No raw email or phone in `conversion_holds`, logs or queue payloads (test asserts this, following the outcomes PII-never-logged test pattern); payload is nulled on every terminal status.
6. Timeout clamping is tested against the shortest destination window.
7. Hybrid events are labelled as such in the review surface.
8. GTM generator changes for `JC_SUBMIT_TOO_FAST` update golden fixtures and pass the drift-proof check (mutate, see failure, revert).

---

## 9. Sequencing

| Phase | Contents | Depends on |
|---|---|---|
| Sprint 0 | §0 verification | none |
| A1 | GA4 config sync, snapshots, Ads currency/time zone read | Sprint 0 |
| A2 | §A.4 findings, §A.5 drift alerts and discontinuities | A1 |
| A3 | GTM version and publish, rollback, publish log | Sprint 0 |
| B1 | Scoring isolation and invariant tests | none (can run in parallel with A) |
| B2 | Data path, preconditions, L11 rules, rendering | B1, A2 |
| C1 | Gate placement, §C.5a rules, holds table, observe mode | Sprint 0 |
| C2 | Enforce mode, review tab, release/reject/timeout | C1 |
| C3 | §C.5b capture rules, monitoring and alerts | C2 |

## 10. Out of scope

- Invalid-click refund claims, click-fraud detection or IP blocking. Considered and rejected as a separate product with established competitors.
- Third-party bot scoring.
- CRM or outcome-based retraction of already-delivered junk (v2, through the outcome contract).
- Converting hybrid lead events to server-only in generated containers (follow-up).
- Any GA4 write scope.
- Scoring L11.

## 11. Open decisions

1. Plan gating: should GA4 config checks, GTM publish and the junk gate follow existing feature gating (`pro`) or sit on `agency`? Default if unanswered: `pro` for A and C, matching reconciliation and CAPI; GTM publish on `pro` with the confirmation flag.
2. Default `timeout_action`: this PRD sets `release` (fail open, preserving today's behaviour). Confirm.

## 12. Deviations and verification log

*(Claude Code appends here during the build: Sprint 0 results, any departure from this document and the reason, and anything left unverified.)*

### Sprint 0 results (2026-10-06)

**0.1 GA4 Admin schema — verified live** (Discovery Documents fetched directly, revision 20261003, both `v1beta` and `v1alpha`).

| Resource | Version | Fields / notes |
|---|---|---|
| Property | v1beta + v1alpha | `currencyCode`, `timeZone` |
| Data streams | v1beta + v1alpha | `webStreamData.measurementId`, `webStreamData.defaultUri`, `type` |
| Enhanced measurement | **v1alpha only** (`dataStreams.getEnhancedMeasurementSettings`) | `formInteractionsEnabled`, `streamEnabled`, plus the other toggles. v1beta has no equivalent |
| Google Ads links | v1beta + v1alpha | `customerId`, `canManageClients`, `adsPersonalizationEnabled` |
| Key events | v1beta + v1alpha | `eventName`, `countingMethod`, `defaultValue` (already synced) |
| Data retention | v1beta + v1alpha | `eventDataRetention`, `userDataRetention`, `resetUserDataOnNewActivity` |

- Every read method accepts `analytics.readonly` (also `analytics.edit`). **No scope widening and no GA4 reconnect needed**, including for v1alpha.
- **Deviation:** the enhanced-measurement read, which `GA4_ENHANCED_FORM_DOUBLE_COUNT` depends on, exists only on `v1alpha`. A1's `ga4AdminClient.ts` therefore needs a base URL per API version, and the enhanced-measurement call is the one alpha dependency. Alpha surfaces can change without notice, so that call must fail soft: when it errors, the snapshot omits enhanced measurement and `GA4_ENHANCED_FORM_DOUBLE_COUNT` is not written, never asserted.
- **Cross-domain config is not exposed** (no cross-domain or linked-domains field anywhere in either document; `GlobalSiteTag` is only the gtag snippet). The C5 gap stays as it is, and no rule pretends otherwise.
- A Google Ads link carries only `customerId`, so matching it to the client's connected Ads customer is a normalised-ID comparison (strip dashes).

**0.2 GTM v2 publish scopes — verified live** (Discovery Document revision 20260930).
- `workspaces.create_version` → `tagmanager.edit.containerversions`
- `versions.publish` → `tagmanager.publish`
- `versions.set_latest` → `tagmanager.edit.containers` (already held)
- A3 adds the first two to `GTM_SCOPE`. This reverses the comment in `api/routes/gtm.ts` that deferred publish scope.

**0.3 Live event entry points.**
- `processEvent()` has one non-test caller, `POST /api/capi/process` (`capi.ts:487`), which takes a single `provider_id` per call and passes no `options` (no `clientId`, `rawEventData`, `requestIp`, `requestUa`). Its only client is the browser-side `frontend/src/lib/capi/pipeline.ts`, which calls it once per provider with the user's auth token.
- **Fan-out is therefore not server-side**: one Atlas event for N providers arrives as N independent requests, so the gate cannot sit above `processEvent()`. The PRD's fallback applies (Redis-memoised verdict keyed on `atlas_event_id`, TTL longer than the hold window, one hold record per Atlas event listing all bound provider configs).
- `processServerSourcedEvent()` callers: Shopify (`shopifyCapiDelivery.ts`), outcomes (`outcomeDelivery.ts`, two sites). All are out of gate scope per §C.4.
- `capi_event_queue` has an `enqueueEvent()` writer in `capiQueries.ts` but **no caller anywhere**, and the table is empty. Treated as dead path.
- **Open issue for C1:** the route sees the browser's request IP/UA only if the browser itself posts to it. IP/UA are not currently passed to the pipeline at all, and the event carries no form-fill timing. `JC_NON_HUMAN_UA` and `JC_SUBMIT_VELOCITY` need the route to capture `req.ip`/`user-agent` and pass them through `options`. Caveat: this reflects the browser calling the Atlas API directly with a user token. If real deployments instead relay events from a server-side GTM or a customer backend, those values would be the relay's, not the visitor's. No production data exists to tell which (see 0.4), so C1 should treat IP/UA rules as capture-dependent and keep them inert unless the event carries visitor IP/UA explicitly.
- Offline CSV and outcome webhook paths remain out of v1 scope as the PRD states.

**0.4 Live data check** (production Supabase project, read-only counts): `reconciliation_runs` 0, `reconciliation_findings` 0, GA4 `platform_connections` 0, `capi_providers` 0, `capi_events` 0, `capi_event_queue` 0.
- **B.6 outcome:** no client has reconciliation data. Part B is built against a seeded fixture, and live verification of the §B.3 shape is **outstanding**.
- No production CAPI traffic exists, so Part C's hit rates cannot be sanity-checked against real data. `observe` as the default mode is therefore the only source of that evidence.

**Scope changes from Sprint 0:** (1) the A1 client needs a per-version base URL, with the enhanced-measurement call on v1alpha failing soft; (2) C1's IP/UA rules are capture-dependent; (3) `REGISTER_VERSION` is already `1.4.0`, so B2 bumps to `1.5.0` (noted in the sprint plan); (4) no GA4 reconnect is needed. No change to the sprint order.

### B1 results (2026-10-06)

- `SCORED_V2_LAYERS` (`layers.ts`) = `ALL_V2_LAYERS` minus `reconciliation`; `ALL_V2_LAYERS` stays at 13. `scoring.ts` defaults to the scored set, so L11 never enters `layerScoringDecisions`, `coverageRatio`, `inScoredLayers` or `layerCoverageFromDecisions`; a fully covered run reads "12 of 12".
- **Wider than the PRD's "scoring.ts only"** (as flagged in the sprint plan): `reporting/coverage.ts` (`layers_not_tested` and its reconcile guards) and `export/pdfGenerator.ts` (the "N of M assessed" table) now also use the scored set, and the frontend `ExecutiveSummary` layer table drops its L11 row. Otherwise one report would show "12 of 12" in the header and "N of 13 assessed" in the coverage table. `register/reporting.ts`'s per-layer stage rollup deliberately keeps all 13 (display of whatever results exist). B2 renders L11 in its own section.
- **Deviation from AC B.7.2 ("every existing scoring test passes unchanged"):** impossible alongside "12 of 12". The assertions that literally encoded the 13-layer denominator (`layers_total: 13`, "8 of 13", "13 of 13 assessed", the openart replay's `5 of 13`, and the L11 "not yet built" `not_applicable` row) were updated to 12. No scoring arithmetic, weights, thresholds or verdicts changed; only the layer count in the denominator. Scores for runs with no L11 results are unchanged; the withheld/shown decision can differ only where coverage sat between 7/13 and 7/12.
- Invariant tests (`scoring.test.ts`): scored set is exactly the enum minus L11; no L11 decision by default; "12 of 12"; adding failing L11 results leaves `calculateV2Scores` output deep-equal; L11 results alone never pass the coverage gate. Drift proof: making `SCORED_V2_LAYERS` include L11 failed 8 tests; reverted.
- Validation: backend `tsc` clean, suite 2990/2996 (only the 6 known unrelated csv/organisations/strategy/clients/dashboard failures); frontend suite 132/132, `vite build` clean. Frontend `tsc` shows 10 pre-existing `trackingHubStore.ts` errors, identical on a clean stash.

### A1 results (2026-10-06)

- `integrations/google/ga4AdminClient.ts` (per-version base URLs, `ga4AdminGet()`, `Ga4AdminError`); `ga4Sync.ts` uses `ga4AdminGet`, `ga4Discovery.ts` and `connectionTester.ts` import the shared v1beta base constant. The PRD named two call sites; there were three. Their own error text and pagination are unchanged, so no behaviour change.
- `ga4ConfigSync.ts` and migration `20260922001_ga4_config_snapshots.sql` (RLS: org-member read, service-role write; **written, not applied**).
- **Design decisions beyond the PRD text:** (1) timestamps and Ads-link `creatorEmailAddress` are excluded from the snapshot (the former would change the hash without a config change; the latter is PII, AC A.7.7); (2) an optional read that fails carries the previous snapshot's value forward instead of writing `null`, so a transient or alpha-surface failure never produces a false "config changed" row (and so never a false drift alert in A2); with no previous value the section is `null` = not observed; (3) Ads customer currency/time zone are stored in `platform_connections.metadata.ads_customer` rather than a new table, because `platform_state_cache` (named in CLAUDE.md) has no migration in this repo to extend; A2 reads it from there.
- `googleAdsSync.ts`'s new `syncCustomerSettings()` uses `GOOGLE_ADS_API_VERSION`; CLAUDE.md §24 table updated. Both new reads are additive and wrapped non-fatal in `syncOrchestrator.ts` so they can never fail the existing key-event/conversion-action sync.
- Tests: 14 new (`ga4ConfigSync.test.ts`, `googleAdsCustomerSettings.test.ts`); drift proof: forcing "always insert" failed 2 tests, reverted. Backend typecheck clean; suite 3004/3010 (only the 6 known unrelated failures).
- Not verified live: no GA4 connection exists in production (Sprint 0.4), so the sync is exercised against Discovery-Document-shaped fixtures only.

### A2 results (2026-10-06)

- **Findings.** Seven `FindingCode`s with `FINDING_META` (dimension/severity per the PRD table). Rules are pure (`engine/ga4ConfigRules.ts`); `engine/ga4ConfigDiff.ts` resolves inputs and writes via `findingWriter`, called from `reconciliationRunner.ts`'s `executeRun()` for every run type. No GA4 connection or no snapshot = no finding (AC A.7.3). Wording rule enforced by test: every narrative/remediation clears `outputLint`'s `BANNED_TOKENS`, and the double-count finding says the configuration "can count" twice.
- **Input resolution (decisions the PRD left open):**
  - *Container* = the client's connected GTM container's latest snapshot, else the latest generated `client_outputs` `gtm_container`. IDs come from `classifyGoogleTag()` (constant-variable resolution; an Ads `googtag` or unresolvable ID is skipped, never guessed).
  - *Lead/form signal "deployed to GA4"* = GA4 event names of the client's deployed signals (`deployments` → `signal_pack_signals` → `signals.platform_mappings.ga4`) plus its Journey Builder conversion stages; the double-count rule fires only for `generate_lead`/`form_submit`/`sign_up`.
  - *Conversion stage* = a `journeys.client_id` journey stage whose action is in the `conversion` category of `ACTION_PRIMITIVES`; its GA4 event is that primitive's GA4 mapping. **`journey_client_link` (named in CLAUDE.md) does not exist** in the live schema or migrations; the link is `journeys.client_id`.
  - *Ads link match* accepts a link to the client's customer ID **or its parent manager ID**, to avoid a false `GA4_ADS_LINK_MISSING` for MCC-level links. Currency/time zone compare only when linked, and only against values actually observed.
  - `GA4_SIGNAL_NOT_KEY_EVENT` needs a completed key-event sync for the GA4 connection; before that it stays silent.
- **Drift alert.** `diffGa4Snapshots()` (pure) compares consecutive snapshots, only sections observed in both (a `null` section is never a change). DQM: `dqm/ga4ConfigChangeMonitor.ts` is stateless over the snapshot log (newest snapshot per property in the last 24h vs its prior; a first snapshot is a baseline) and `evaluateGa4ConfigChangeAlert()` rolls everything into **one** `warning` alert per org (`open` → `update` while active → `resolve` via the usual two-ok path). Alert type `ga4_config_changed` (as the PRD names it), run-log check type `ga4_config`; migration `20260922002` widens both CHECKs from the live definitions read this sprint (written, **not applied**). Residual: if an operator resolves the alert by hand while the change is still inside the 24h window, the next 15-minute loop re-opens it.
- **Discontinuities.** On a changed snapshot with a previous one and a client, `buildGa4DiscontinuityRows()` writes `client_tracking_change` rows (`platform='ga4'`) for stream ID, enhanced-measurement form-interaction toggle and currency changes only; Ads-link, time-zone and enhanced on/off changes alert but do not. Written via the existing idempotent `writeClientDiscontinuities()`; non-fatal inside the sync.
- **Existing test updated:** the topology migration test asserted the 20260921003 CHECK list covers every `AlertType`; it now checks the newest migration, which owns the list.
- Validation: backend `tsc` clean; 55 new tests (rules, diff/loader helpers, drift, DQM monitor/evaluator, orchestrator wiring); drift proofs: forcing "always insert" earlier (A1) and adding `time_zone` to the discontinuity set both failed tests, reverted. Suite: only the 6 known unrelated failures.
- **Not verified live:** no GA4 connection, reconciliation run or client with these inputs exists in production (Sprint 0.4), so every rule is exercised against fixtures only.

### B2 results (2026-10-06)

- **Deviation — `UnassessableKind` NOT extended (PRD §B.5 asked to record the alternative; recorded here, after the fact rather than before building).** `UnassessableFinding`/`could_not_be_assessed` means "excluded because the scan could not assess it" and its consumers (the `NotAssessed` tab, the PDF "Not Assessed, and Why" section, `buildWithAccessSection`, `buildOpenQuestions`) all assume that. L11 findings were genuinely *assessed*, so listing them there would read as the opposite of what they are, and every consumer would need a kind filter. Built instead a dedicated typed field, `ReportJSON.reconciliation_disclosure` (`ReconciliationDisclosure`), rendered as its own "Against your connected platforms" section (PDF page + web tab), omitted entirely when L11 is skipped. Decision #19's intent (no parallel ad-hoc bucket) is kept: it is one typed field, linted, and nothing else produces it.
- **Isolation by partition, not by filtering at each consumer.** The orchestrator splits `runRegister()`'s output with `partitionReconciliation()` immediately; everything downstream (stored validation results, suppression partitions, `calculateV2Scores`, `interpretResults`, journey/platform breakdowns, coverage counts, the technical appendix) only ever receives `core`. L11 results surface solely through the disclosure. Combined with B1's `SCORED_V2_LAYERS`, L11 is excluded twice over. **Not covered by a test:** the orchestrator call site itself (`runAuditOrchestrator` has no test harness in this repo); the pieces it composes (`attachReconciliationInputs`, `partitionReconciliation`, `buildReconciliationDisclosure`, `generateReport`) are each tested, and the partition has a drift proof.
- **Data path.** `AuditData.reconciliation_summary` (scoping §3 + §7 topology verdict/strength + client-scoped `client_tracking_change` rows) and `AuditData.client_linked`, set by `attachReconciliationInputs()` (non-fatal) before `runRegister()`. New preconditions `client_linked` and `reconciliation_data_available` in `RulePrecondition`/`PRECONDITION_CHECKS`. `resolveReconciliationSummary()` returns undefined — not an empty summary — with no completed run, or when the findings read fails, so L11 skips rather than reporting a clean result about data that does not exist.
- **Rules (`L11.ts`).** Five rules, `evidence_class: 'DIRECT'`, `detectable_by: 'connector'`. The integrity test that every rule is `crawl` now exempts the reconciliation layer (it reads connected-platform data, not the crawl). Severity = highest underlying finding (critical→critical, error→high, warning→medium, info→low); it only orders the section since nothing is scored. Rules tolerate a missing summary when called directly (the register-integrity test invokes every rule on a minimal AuditData).
- **Deviation — `RECONCILIATION_NO_CRITICAL_CONFIG_DRIFT` flags every unresolved `config`-dimension finding, not only critical/error.** The PRD text says "critical or error", but three of Part A's own config findings are warning/info (`GA4_STREAM_DOMAIN_MISMATCH`, `GA4_ADS_CURRENCY_MISMATCH`, `GA4_ADS_TIMEZONE_MISMATCH`), and AC B.7.4 requires Part A's GA4 findings to render. Gating at error would have dropped them from the section entirely. The rule keeps the PRD's name.
- **Volume "annotated" definition (PRD left open).** A volume finding is explained when the same run wrote an unresolved discontinuity finding for that platform, or a client-scoped tracking change on that platform falls within 14 days of the run (or has no date). Explained ones pass and are counted in the summary line; they are never listed as drift.
- **Topology wording** (`buildContextNotes`, covered for all four verdicts + strengths): only when an unresolved GA4/Google Ads config/alignment/volume difference exists AND verdict is `COMBINED`/`COMBINED_ADS_PRIMARY` does the section say a shared Google tag is "one candidate explanation … not established as the cause"; `assumed`/`none` strength adds "needs confirmation"; `SPLIT` and `UNKNOWN` say nothing about combination. Known client-scoped tracking changes are annotated as "a change to how data is collected … may reflect the change rather than drift".
- **outputLint.** `lintReportOutput` now also scans every disclosure field. Because finding narratives interpolate client-chosen names and the lint is a hard gate on the whole report, `lintSafe()` replaces any line that would trip it with a neutral pointer, so one client's conversion called "Missing Leads" cannot fail the audit. A test asserts every Atlas-authored `FINDING_META` narrative is clean on its own.
- **Version / counts.** `REGISTER_VERSION` is `1.5.0` (the PRD expected a bump from `1.3.0` to `1.4.0`; the live value was already `1.4.0` — Google Tag Topology Sprint 3). Register 96 → 101 rules, 13 layers shipped. Scoring unchanged (B1).
- **B.6 / live verification: outstanding.** No client in production has a reconciliation run (Sprint 0.4), so the §B.3 shape has been exercised against fixtures only. Built against a seeded fixture as the PRD permits.
- **Not done:** no Issues/Action Items entries for L11 (by design); no Slack/PDF-export variant beyond the PDF page; the web tab is not shown in the public no-login report because that path never has a client.

### A3 results (2026-10-06)

- **Scopes** (`services/gtm/gtmScopes.ts`): `GTM_SCOPE` now requests `tagmanager.edit.containerversions` and `tagmanager.publish` on top of the existing read + `edit.containers` (Sprint 0-verified). `scopeCapabilities()` derives `can_deploy`/`can_publish` from the grant's stored scope string; publishing needs BOTH new scopes. This reverses the decision documented in `gtm.ts` to leave publish scope out of the consent screen; the comment now says so. `/deploy` and `/split-plan/deploy` still create drafts only.
- **Old-scope connections:** keep working for draft deploy and report `can_publish: false` (`GET /containers` now returns `can_deploy`/`can_publish`, derived server-side; the encrypted credentials are stripped from the response). Publishing on one returns 403 `GTM_RECONNECT_REQUIRED` ("Reconnect via OAuth to enable publishing"), never a failed Google call.
- **Reconnect actually upgrades the connection (not in the PRD, required by it):** `/callback/finalize` only ever inserted, so "reconnect to enable publishing" would have created a second row for the same container, splitting its snapshots, client link and publish log. It now re-authorises an existing OAuth connection for the same org/account/container in place (same id, new credentials, client link kept) and returns 200 `reconnected: true`.
- **`POST /api/gtm/publish`** `{connection_id, workspace_id, confirm: true}`: refuses without `confirm === true` (400 `CONFIRMATION_REQUIRED`; `"true"`/`1` also refused), requires an OAuth connection with the widened grant, and publishes only a workspace Atlas created (name prefix check on `Atlas Deploy`/`Atlas ·`, 403 `NOT_ATLAS_WORKSPACE`), so Atlas can never publish someone's own in-progress workspace. Order: read the live version FIRST (the rollback target) → `create_version` → refuse on `compilerError` or a sync conflict before anything goes live → `publish` with the version's `fingerprint` so a version that changed in between is rejected by Google. Verified against the live Discovery Document (`publish` takes an optional `fingerprint`; `versions:live` returns the live `ContainerVersion`).
- **Human session only:** the route sits behind `authMiddleware` (a Supabase user JWT). The publish service is imported by exactly one file (`api/routes/gtm.ts`); a test fails if any queue/worker/scheduler file references it, and another asserts the draft deploy service contains no `create_version`/`publish`/`versions:live` call.
- **Log + rollback.** `gtm_publish_log` (migration `20260922003`, written not applied; org-read RLS, service-role write) records org, client, connection, account/container, workspace, published and previous version IDs, user and time. `POST /publish/:logId/rollback` re-publishes the logged previous version, with checks beyond the PRD: it needs `confirm: true` and the widened grant too; refuses if the publish was already rolled back, if the row is itself a rollback, or if there was no earlier live version (409 `NO_PREVIOUS_VERSION`); and it **refuses when the live version is no longer the one Atlas published** (409 `LIVE_VERSION_CHANGED`) so a rollback can never silently overwrite a later human publish. A rollback is itself logged.
- **Log-write failure after a successful publish** does not hide that the container is live: the response is 201 with `log_id: null`, `rollback_available: false` and an explicit message, and the version IDs are written to the error log so a manual rollback is possible.
- **Post-publish IHC snapshot:** queues the existing `gtmContainerSyncQueue` job (non-fatal; `snapshot_queued` in the response says whether it was queued). It re-syncs the live container; it does not itself wait for that to finish.
- **Frontend:** `GtmPublishControl` in the split flow after a draft deploy (confirmation checkbox gates the button; rollback of the publish just made; honest "no rollback available" text; reconnect message for an old grant), a "Publishing enabled" / "Reconnect to enable publishing" state on each container in Implementation Health.
- **Not verified live:** no Google account is available in this sandbox, so publish and rollback are exercised against stubbed Tag Manager responses shaped from the Discovery Document only. Treat the first real publish as the live test, on a non-critical container.
- Tests: 5 scope, 14 service, 19 route, 1 reconnect, 6 frontend. Drift proofs: removing the confirmation check, the scope check, and the Atlas-workspace guard each failed tests (1, 2 and 1), then restored.

