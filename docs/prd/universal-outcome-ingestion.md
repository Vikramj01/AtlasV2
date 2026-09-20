# Atlas PRD — Universal Outcome Ingestion (repositioning the CRM layer)

**Target path in repo:** `docs/prd/universal-outcome-ingestion.md`
**Status:** Phase 0 ready to build immediately
**Supersedes the positioning of:** `docs/prd/crm-outcome-integration.md` (that PRD's engineering remains correct and shipped; only its framing of CRM as the sole ingestion path is replaced)
**Owner:** Vikram

---

## 1. Why this exists

The CRM Outcome Integration shipped HubSpot and Salesforce connectors plus the whole downstream outcome layer. The engineering is sound. The positioning is wrong.

Most B2B companies Atlas will serve do not run HubSpot or Salesforce. They run Zoho, Pipedrive, Close, Freshsales, Monday, Attio, Copper, something regional, or a spreadsheet. Building a connector per CRM is an unwinnable maintenance treadmill, and this repo already carries the scar tissue to prove it: Google Ads REST failed silently for 12 to 15 months on sunset versions, the Data Manager API schema drifted materially from Atlas's assumptions, LinkedIn sunsets API versions annually. Each connector is a permanent liability, not a one-off build.

It is also the wrong category claim. "We integrate with 14 CRMs" positions Atlas as an integration platform, competing with better-funded incumbents on a dimension where it has no advantage. The defensible claim is the signal engineering.

**The direction:** *Send us your outcomes, however you keep them, and we'll turn them into calibrated conversion signal.*

The floor that qualifier implies, and which must be stated plainly in product rather than discovered at onboarding: an identity key, a stage, and a timestamp. Without those there is no conversion to deliver, regardless of how the data arrives.

Architecturally this means ingestion becomes an **outcome contract** with pluggable transports. The CRM connectors become one transport among several, not the front door.

### 1.1 Why now, specifically

The CRM feature merged yesterday. No HubSpot or Salesforce OAuth app has been registered. `HUBSPOT_CLIENT_ID` / `SALESFORCE_CLIENT_ID` are not set in Render and are not declared in `render.yaml`. All four CRM tables have zero rows. No client has connected anything.

This is the widest this window will ever be. The Phase 1 rename is a pure DDL operation with no data migration, no backfill, and no rollback plan. Once one client connects, the same rename becomes a data migration. Everything else in this PRD is equally cheap later; the rename is not.

---

## 2. Non-goals

- **Not a rollback.** Nothing in `backend/src/services/crm/` gets deleted. `identityResolver`, `valueLadder`, `outcomeDelivery`, `derivedValueCalculator`, `readinessCheck`, the outcome tables, the dedup, the window checking and the delivery gate are the universal layer. A webhook source terminates in exactly those files.
- **Not removing the providers.** `hubspotClient.ts` and `salesforceClient.ts` stay in the tree with their tests. They are the depth play for mid-market B2B where a native connector genuinely beats a webhook. What is removed is CRM as the product's front door.
- **Not the attribution chain check.** The pre-connection check verifying that a click ID reaches the client's records is a separate deliverable, specified in its own PRD as an extension of the Campaign Signal Validator. It touches the scanner, not ingestion, and the two tracks do not block each other.
- **Not iPaaS.** Published Zapier and Make apps are demand-driven, after the webhook exists and is proven.
- **Not multi-touch attribution.** Unchanged from the original PRD.

---

## 3. Phase 0 · Unwire from the product surface

**Effort: under an hour. Do this first, independently of everything else.**

The backend boots clean today because `env.ts` uses `optional(name, '')`, so the absent credentials fall through to empty strings. `/api/crm` is mounted but cannot complete an OAuth handshake. There is no live security exposure.

The real problem is a dead button. `/crm` is reachable from the sidebar, and the OAuth flows read `env.HUBSPOT_CLIENT_ID` straight into the token request without checking it is populated, so clicking Connect produces an opaque token-exchange failure rather than anything intelligible.

### 3.1 Remove the surfaces

- `frontend/src/components/layout/Sidebar.tsx` — remove the `CRM Outcome Integration` entry (line 99, `IMPLEMENTATION` group).
- `frontend/src/App.tsx` — remove the lazy import (line 50) and all three routes (lines 114 to 116: `/crm`, `/crm/oauth/hubspot/callback`, `/crm/oauth/salesforce/callback`).

Leave `frontend/src/pages/CrmIntegrationPage.tsx` and `frontend/src/components/crm/` in the tree. They are rebuilt against the outcome model in Phase 3, not rewritten from scratch.

**Do not remove** `frontend/src/components/capi/CrmOutcomesTab.tsx` from the CAPI Monitoring Dashboard. Operator visibility into outcome events is wanted and survives the repositioning.

TypeScript strict mode has `noUnusedLocals: true` and `noUnusedParameters: true` — unused imports are a build failure. Expect the route removal to surface these and clear them properly rather than suppressing.

### 3.2 Add the credential guard

Both `hubspotOAuth.ts` and `salesforceOAuth.ts` must throw an explicit, named error when their client ID or secret is empty, before constructing any request:

```ts
if (!env.HUBSPOT_CLIENT_ID || !env.HUBSPOT_CLIENT_SECRET) {
  throw new Error('HubSpot OAuth is not configured on this deployment (HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET unset)');
}
```

Two reasons this matters beyond error quality. It makes the env vars a *reliable* off-switch rather than an accidental one. And it closes a real hazard: with the route mounted and no guard, pasting two environment variables into Render turns the entire feature live with no code change, no review and no deploy. That is more surface area than a deliberately-parked feature should have.

`app.ts` line 172 can stay mounted. The route is unreachable from the UI and inert without credentials.

### 3.3 Verify, do not assume

- Check Redis for jobs on `crm-sync` and `crm-derived-value`. Expect zero — jobs only enter `crmSyncQueue` when a config exists with `sync_enabled: true`, and there are no configs. `crmSyncOrchestrator.ts` line 142 already bails on `!config.sync_enabled`, so the self-rescheduling loop cannot start. Confirm rather than reason about it; delayed Bull jobs live in Redis, not in the code, and survive deploys.
- Confirm `SELECT count(*)` is zero on all four CRM tables in production before Phase 1 proceeds. Phase 1's central claim is that no data migration is needed, and that claim must be checked, not assumed.

### 3.4 `CLAUDE.md` update (Phase 0)

Correct the stale entries immediately, not at the end of the programme. A future session reading `CLAUDE.md` today will treat CRM-as-front-door as settled architecture and build on it.

- **Feature list:** amend the CRM Outcome Integration line to state that the connectors are built and tested but deliberately unwired from the product surface pending the outcome-contract repositioning, and that the OAuth flows require credentials not present on any deployment.
- **Completed sprints:** amend the CRM Outcome Integration row to record what actually happened — built, then unwired by product decision, providers retained.

---

## 4. Phase 1 · Rename while the tables are empty

**Effort: roughly two days including test updates. Do this within the week.**

The codebase currently names the universal outcome layer after one source type. Left alone, every source added later inherits that misnomer permanently.

### 4.1 Database rename

One migration. Naming per Key Technical Decision §21: `YYYYMMDDNNN_name.sql`, **no underscore after the date**. Use `20260921001_rename_crm_to_outcomes.sql` or the correct next sequence for the day it is written.

| Current | New |
|---|---|
| `crm_sync_configs` | `outcome_source_configs` |
| `crm_stage_mappings` | `outcome_stage_mappings` |
| `crm_outcome_events` | `outcome_events` |
| `crm_derived_value_snapshots` | `outcome_derived_value_snapshots` |

`ALTER TABLE ... RENAME TO` carries RLS policies, constraints, foreign keys and indexes with the table. Policies are all named `user_isolation` and are table-scoped, so there is no collision and no policy rewrite is needed. Indexes keep their old names unless explicitly renamed — rename them too, since a stale index name is exactly the kind of small confusion that survives for years:

- `idx_crm_sync_configs_org`, `idx_crm_sync_configs_connection`
- `idx_crm_stage_mappings_config`
- `idx_crm_outcome_events_config_created`, `idx_crm_outcome_events_client`, `idx_crm_outcome_events_delivery_status`
- `idx_crm_derived_value_snapshots_config`

Two column renames:

- `outcome_source_configs.provider` → `source_type`, with its CHECK widened from `('hubspot','salesforce')` to `('hubspot','salesforce','webhook','sheet','csv')`. Widening now rather than in Phase 2 avoids a second constraint migration.
- `outcome_events.crm_record_id` → `source_record_id`, `crm_object` → `source_object`, `crm_stage_id` → `source_stage_id`. These are no longer CRM-specific concepts; a webhook sender has a record ID too.

Leave `outcome_source_configs.pipeline_id` and `tracked_object` as they are. They remain CRM-shaped but are nullable and unused by non-CRM sources.

**Health alert type.** `20260919002_crm_sync_health_alert.sql` added `dqm_crm_sync` to the `health_alerts.alert_type` CHECK. Rename to `dqm_outcome_sync` in the same migration. Before writing it, read the live constraint and enumerate every existing value — do not reconstruct the list from memory. Sprint 8 of the Google Stack Alignment plan found `dqm_sgtm` had been live and actively inserting for months without ever being added to this constraint, so every sGTM alert open had been throwing a CHECK violation and no client was ever alerted. Also confirm zero existing rows carry `dqm_crm_sync` before renaming the enum value.

**Ledger.** Per Key Technical Decision §22, if this migration is applied via the Supabase MCP `apply_migration` tool it will stamp its own 14-digit timestamp rather than the filename version. Fix the ledger row in the same change, or let the branching pipeline apply it on merge.

### 4.2 Code rename

Mechanical and compiler-verified. Full inventory:

**Backend**

| Current | New |
|---|---|
| `backend/src/services/crm/` | `backend/src/services/outcomes/` |
| `crmSyncOrchestrator.ts` | `syncOrchestrator.ts` |
| `crmSyncHealthCheck.ts` | `syncHealthCheck.ts` |
| `providerRegistry.ts` | `sourceRegistry.ts` |
| `providers/` | `sources/` |
| `providers/types.ts` | `sources/types.ts` |
| `backend/src/services/database/crmQueries.ts` | `outcomeQueries.ts` |
| `backend/src/types/crm.ts` | `backend/src/types/outcomes.ts` |
| `backend/src/api/routes/crm.ts` | `routes/outcomes.ts` |
| `/api/crm` | `/api/outcomes` |
| `crmSyncQueue` / `crm-sync` | `outcomeSyncQueue` / `outcome-sync` |
| `crmDerivedValueQueue` / `crm-derived-value` | `outcomeDerivedValueQueue` / `outcome-derived-value` |

`identityResolver.ts`, `valueLadder.ts`, `outcomeDelivery.ts`, `derivedValueCalculator.ts`, `objectMapper.ts`, `readinessCheck.ts` and `ingestWindows.ts` keep their names. They were never CRM-specific.

`hubspotClient.ts` and `salesforceClient.ts` move to `sources/` unchanged.

**Frontend**

| Current | New |
|---|---|
| `frontend/src/types/crm.ts` | `types/outcomes.ts` |
| `frontend/src/lib/api/crmApi.ts` | `lib/api/outcomesApi.ts` |
| `frontend/src/store/crmStore.ts` | `store/outcomesStore.ts` |
| `frontend/src/components/crm/` | `components/outcomes/` |
| `CrmConnectCard.tsx` | `SourceConnectCard.tsx` |
| `CrmIntegrationPage.tsx` | `OutcomesPage.tsx` |
| `components/capi/CrmOutcomesTab.tsx` | `components/capi/OutcomesTab.tsx` |

**Queue rename hazard.** Renaming a Bull queue creates a new Redis key namespace. Any job sitting under the old name is orphaned and will never be processed. Phase 0 §3.3 confirms both queues are empty, which is why this is safe now and would not be later. Re-confirm immediately before the rename ships.

### 4.3 `CLAUDE.md` update (Phase 1)

- **Supabase Schema section:** update all four table names, the renamed columns, and the widened `source_type` CHECK.
- **Backend API Routes table:** `/api/crm` row becomes `/api/outcomes`, file `outcomes.ts`.
- **Repository Structure tree:** `services/crm/` becomes `services/outcomes/` with `sources/` beneath it; frontend paths updated.
- **Completed sprints:** new row recording the rename, why it was done while tables were empty, and the queue-namespace hazard it avoided.

---

## 5. Phase 2 · The outcome contract

### 5.1 The contract type

Define in `backend/src/services/outcomes/contract.ts` as a versioned, exported type — this is a public interface that external senders will hold, correctly or otherwise, forever.

```ts
export const OUTCOME_CONTRACT_VERSION = '1.0.0';

export interface OutcomeRecord {
  /** Sender's own stable identifier for this record. Drives idempotency. */
  source_record_id: string;
  /** Sender's stage identifier. Must map to an outcome_stage_mappings row. */
  source_stage_id: string;
  /** ISO 8601. When the stage change occurred, not when it was sent. */
  stage_changed_at: string;

  /** At least one identity key required. Unresolved outcomes deliver nothing. */
  identity: {
    gclid?: string; gbraid?: string; wbraid?: string;
    fbclid?: string; ttclid?: string; li_fat_id?: string;
    msclkid?: string; oppref?: string;
    atlas_event_id?: string;
    email?: string; phone?: string;
  };

  value?: number;
  currency?: string;           // ISO 4217
  source_object?: string;      // 'contact' | 'deal' | free-form for non-CRM sources
}
```

**Strict from day one.** Reject on schema violation with a useful, field-level error. Never coerce, never silently drop an unrecognised field, never infer a missing timestamp. You control your own connectors and can fix them; you cannot fix an external sender's payload, and a coercion applied once becomes a behaviour you can never remove.

Validation via Zod per Implementation Rule 5. Responses `{ data, error, message }` per Rule 10.

### 5.2 `CrmProvider` becomes `OutcomeSource`

`sources/types.ts` already holds `CrmProvider`, and `sourceRegistry.ts` already maps name to implementation. The widening is small:

- Rename `CrmProvider` → `OutcomeSource`, `CrmProviderName` → `OutcomeSourceType`.
- Every method except `fetchChangedRecords` becomes optional. A webhook source has no pipelines to list and no properties to enumerate; a polled source does.
- `fetchChangedRecords` yields `OutcomeRecord` rather than `CrmRecord`. The CRM clients gain a thin mapping step from their native shape to the contract.
- Add a `push`-vs-`pull` discriminator so the orchestrator knows whether to schedule a sync at all.

Nothing downstream of the contract changes. `identityResolver`, `valueLadder`, `outcomeDelivery`, dedup, window checking and the delivery gate are untouched.

### 5.3 `CLAUDE.md` update (Phase 2)

New Key Technical Decision, numbered as the next available. Draft text:

> **Outcome ingestion is contract-first, not connector-first.** Atlas accepts outcomes through a versioned `OutcomeRecord` contract (`services/outcomes/contract.ts`); native CRM connectors, the inbound webhook, and sheet sync are all implementations of `OutcomeSource` that produce contract records. Everything downstream of the contract — identity resolution, value ladder, dedup, ingest-window checking, delivery — is source-agnostic and must stay that way. Do not add source-specific branching below the contract boundary. The contract is strict by design: reject on schema violation with a field-level error rather than coercing, because external senders cannot be corrected after the fact. `OUTCOME_CONTRACT_VERSION` bumps on any shape change and is stamped on every ingested record.

---

## 6. Phase 3 · Inbound webhook, tiers and gate

### 6.1 Webhook

Per-client authenticated endpoint accepting `OutcomeRecord`. Push rather than poll, so latency beats the native connectors.

- Per-config secret, HMAC-signed requests. Follow `shopifyWebhookVerify.ts`, which already solves this shape.
- Replay protection via timestamp window plus the existing deterministic `event_id` idempotency.
- Rate limiting per config.
- **A validation endpoint that accepts a payload, runs the full contract validation, and returns what would happen without delivering anything.** This will save more support time than any other single thing in this PRD. Build it in the same sprint as the webhook, not after.

Covers Zoho, Pipedrive, Close, Freshsales, Monday, Attio, Airtable, Copper and most others through their native workflow automation, for the cost of one endpoint.

### 6.2 Input tiers

`outcome_events.identity_method` already computes the tier. What is new is surfacing it and acting on it.

| Tier | Condition | Consequence |
|---|---|---|
| 1 | Click ID or `atlas_event_id` resolved | Full delivery, highest match rate |
| 2 | Hashed email or phone only | Delivery via Enhanced Conversions for Leads / `user_data.em`, materially lower match rate, disclosed |
| 3 | Unresolved | Persisted, counted, never delivered, never given a fabricated identifier |

A client must be able to see which tier they are operating in, what the match-rate cost is, and what would move them up. That last column is the consulting hook, and it is the honest version of "however you keep them" — the transport is free, the identity floor is not.

### 6.3 Delivery gate

Follow the `run_quality` export-gate precedent: block the client-facing consequence, not the operator's view. An operator can connect a source and inspect its state at any tier. What is gated is **enabling delivery** on a source whose tier-3 rate exceeds threshold — you do not push unverified outcomes into live bidding algorithms.

### 6.4 `CLAUDE.md` update (Phase 3)

Feature list entry for Universal Outcome Ingestion replacing the amended CRM line; schema entries for any new columns; new route rows; completed-sprint rows.

---

## 7. Phase 4 · Sheet sync (demand-driven)

Google Sheets and Excel via OneDrive/SharePoint, as `OutcomeSource` implementations. Reuses the incremental sync, overlap window, record cap and continuation logic already written. Mostly a column-mapping UI.

**Build when a real client needs it, not before.** Same for iPaaS.

---

## 8. Sequencing

| | Phase | When |
|---|---|---|
| 1 | Phase 0 — unwire + guard + `CLAUDE.md` correction | Today |
| 2 | Phase 1 — rename | This week, while tables are empty |
| 3 | *Attribution chain check* (separate PRD) | Next, because it generates revenue and touches none of this |
| 4 | Phase 2 — contract + `OutcomeSource` | After the chain check ships |
| 5 | Phase 3 — webhook, tiers, gate | Immediately after Phase 2 |
| 6 | Phase 4 — sheet sync, iPaaS | On demand |

Phases 2 onward do not get harder with time; they are new code. Phase 1 does. That asymmetry is the only thing forcing the order at the front.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A table turns out to have rows, making Phase 1 a data migration | Phase 0 §3.3 requires a verified zero count before Phase 1 proceeds |
| Orphaned Bull jobs after the queue rename | Confirm both queues empty immediately before the rename ships |
| `health_alerts` CHECK constraint enumerated from memory, dropping a live value | Read the live constraint first; the `dqm_sgtm` precedent is documented and cost real client alerts |
| Migration ledger desync from MCP `apply_migration` | Fix the ledger row in the same change per Key Technical Decision §22, or apply via the branching pipeline |
| Contract coerces rather than rejects, locking in a behaviour permanently | Strict validation is an acceptance criterion, not a preference |
| The webhook makes the identity problem easier to hide | Tiers are computed and surfaced from day one, not deferred |
| `CLAUDE.md` left stale, so a future session builds on CRM-as-front-door | Each phase carries its own `CLAUDE.md` deliverable; Phase 0's is immediate |

---

## 10. Acceptance criteria

**Phase 0**
1. `/crm` is unreachable from the UI; no sidebar entry, no route.
2. Both OAuth flows throw a named, explicit error when credentials are unset, before any network call.
3. Backend boots and the full test suite passes with no CRM environment variables present.
4. Redis holds zero jobs on both CRM queues, verified not assumed.
5. All four CRM tables confirmed at zero rows in production.
6. `CLAUDE.md`'s feature line and sprint row reflect the unwired state.

**Phase 1**
7. All four tables, seven indexes and the named columns renamed in one migration; RLS policies still enforce isolation post-rename.
8. `dqm_outcome_sync` present in the `health_alerts` CHECK alongside every previously-existing value; inserting one succeeds.
9. Migration ledger version matches the filename version exactly.
10. Full typecheck and test suite green; no remaining `crm`-prefixed identifier outside `sources/hubspotClient.ts` and `sources/salesforceClient.ts`.
11. `CLAUDE.md` schema, routes and repository-structure sections updated.

**Phase 2**
12. `OUTCOME_CONTRACT_VERSION` exported and stamped on every ingested record.
13. A payload with an unrecognised field, a missing timestamp, or an empty identity object is rejected with a field-level error and nothing is written.
14. HubSpot sync runs end to end through `OutcomeSource` with zero behaviour change and the existing suite green.
15. No source-specific branching exists below the contract boundary.
16. New Key Technical Decision recorded in `CLAUDE.md`.

**Phase 3**
17. A workflow in a non-HubSpot CRM fires on stage change and produces a delivered conversion.
18. The validation endpoint returns the full would-be outcome without delivering or persisting anything.
19. A replayed webhook payload produces zero additional deliveries.
20. A source whose tier-3 rate exceeds threshold cannot have delivery enabled, while remaining fully inspectable by an operator.
21. A tier-2 client sees their tier, the match-rate consequence, and what would move them to tier 1.
