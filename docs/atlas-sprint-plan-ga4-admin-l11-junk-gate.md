# Sprint plan · GA4 Admin config, L11 Reconciliation, Junk conversion gate

Source: `docs/prd/ga4-admin-l11-junk-conversion-gate.md` (PRD not yet committed to the repo; commit it as Sprint 0's first step).
Date: 2026-10-06. Branch: `claude/fervent-maxwell-g6za1q`. One commit group per sprint, no PRs unless asked.

## Decisions confirmed (PRD §11)

1. Plan gating: `pro` for GA4 checks, GTM publish and the junk gate. GTM publish also needs the confirmation flag.
2. Default `timeout_action`: `release` (fail open).

## Repo findings that change the PRD's assumptions

| # | Finding | Effect on plan |
|---|---|---|
| 1 | `REGISTER_VERSION` is already `1.4.0` (`layers.ts:28`), not `1.3.0` as the PRD expects. | Part B bumps to **1.5.0**. AC B.7.1 is amended. |
| 2 | `processEvent()` has exactly one non-test caller: `POST /api/capi/process` (`capi.ts:487`). It takes one `provider_id` per call and passes **no** `options` (no `clientId`, `rawEventData`, `requestIp`, `requestUa`). | There is no server-side fan-out above `processEvent()`, so the gate must use the PRD's Redis-memoisation fallback keyed on `atlas_event_id`. Separately, IP and UA are never supplied on this path, so `JC_NON_HUMAN_UA` and `JC_SUBMIT_VELOCITY` have no input until the route captures them. Sprint 0 confirms whether another caller exists (CAPI queue, `capi_event_queue`, GTM server-side). |
| 3 | `ALL_V2_LAYERS` is used outside `scoring.ts`: `reporting/coverage.ts` (coverage arithmetic with hard throws), `export/pdfGenerator.ts` ("N of 13 assessed"), `register/reporting.ts` (layer ordering), `types/audit.ts` (`layers_total` always 13). | B1 is wider than the PRD's "scoring.ts only". Each use must be classified as scored or displayed, and the coverage-arithmetic guards must still hold. |
| 4 | `adminGet()` and the `v1beta` base URL are duplicated in `ga4Sync.ts`, `connectionTester.ts` and `ga4Discovery.ts`. | A1 extracts a shared `ga4AdminClient.ts` and migrates all three call sites (PRD names two). |
| 5 | `GTM_SCOPE` (`gtm.ts:64`) has a comment explicitly deferring publish scope as a materially bigger decision. | A3 reverses that documented decision. Update the comment and record it in §12. |
| 6 | `ingestWindows.ts` has `META_OFFLINE_INGEST_WINDOW_DAYS = 62` but no Meta **website** event window. | C2 adds a sourced constant. The expected value is 7 days and is verified per Key Technical Decision §14. |
| 7 | `libphonenumber-js` is not in `backend/package.json`. | C1 adds it. |
| 8 | `ga4_config_snapshots` and `conversion_holds` are new tables. The latest migration is `20260921003`, and three Google Tag Topology migrations are still unapplied. | Use `202609220NN` or later filenames (§21). New migrations are written, not applied, matching the Google Tag Topology precedent. |

## Sprint 0 · Verification (no product code)

- Commit the PRD to `docs/prd/`. Create the §12 log.
- **0.1 GA4 Admin schema.** Fetch the `v1beta` and `v1alpha` Discovery Documents. Record per resource: version, field names, scope. Cover property, data streams, enhanced measurement, Google Ads links, data retention and key events. Confirm cross-domain config is not exposed. Egress may be blocked, so fall back to a web search and mark types unverified.
- **0.2 GTM publish scopes.** Confirm scopes for `create_version` and `publish`.
- **0.3 Live event entry points.** Trace every route and queue reaching `processEvent()`/`processServerSourcedEvent()`, the offline CSV path and the outcome webhook. Document the fan-out point and where `clientId`, IP and UA can be captured (finding 2).
- **0.4 Live data check.** Use the Supabase MCP to check whether any client has `reconciliation_runs` (B.6) and any real GA4 connections.
- Exit: §12 note listing verified, unverifiable and scope changes. If a scope or placement result changes the plan, stop and ask before A1/C1.

## Part A · GA4 Admin config + GTM publish

### A1 · Sync, snapshots, Ads currency/time zone
- Migration `ga4_config_snapshots` (RLS, `snapshot_hash` change-log semantics).
- `ga4AdminClient.ts` (one base-URL constant per API version). Migrate `ga4Sync.ts`, `connectionTester.ts`, `ga4Discovery.ts` onto it with no behaviour change.
- `ga4ConfigSync.ts` wired into `reconciliation/sync/syncOrchestrator.ts`. Normalised, non-PII snapshot, written only on hash change.
- `googleAdsSync.ts` GAQL read of `customer.currency_code, customer.time_zone` via `GOOGLE_ADS_API_VERSION`. Update the §24 table.
- Tests: first sync writes a row, repeat sync writes none, no PII in the snapshot.
- Exit: AC A.7 items 1, 5, 7.

### A2 · Findings, drift alerts, discontinuities
- Seven `FindingCode`s with `FINDING_META`, wired through `findingWriter.ts`. Observed-not-caused wording, `outputLint` banned tokens respected. No client association means no finding.
- Snapshot diff produces one rolled-up `ga4_config_changed` DQM alert per org per run. The migration widens the `health_alerts.alert_type` CHECK, reading the live constraint first (§21/§22).
- `client_tracking_change` discontinuities for stream ID, enhanced-measurement form toggle and currency changes only, using the `20260921003` mechanism.
- Tests: fire and no-fire per finding on fixtures from the Sprint 0 schema, the no-client case, and the alert/discontinuity qualifying-change matrix.
- Exit: AC A.7 items 2, 3, 4.

### A3 · GTM publish and rollback
- Widen `GTM_SCOPE`. Surface a "reconnect to enable publishing" state on old-scope connections.
- `POST /api/gtm/publish` (confirmation flag, human session only, `pro`) and `POST /api/gtm/publish/:logId/rollback`. `gtm_publish_log` table (RLS). Trigger an IHC snapshot after publish.
- Tests: refuses without the flag, refuses on an old scope with a named error, writes a log row, rollback republishes the logged previous version.
- Frontend: reconnect state and publish confirmation UI on the GTM containers section.
- Exit: AC A.7 item 6. Live publish cannot be exercised in this sandbox (no Google account), so it is mock-tested and flagged.

## Part B · L11 Reconciliation (disclosure-only)

### B1 · Scoring isolation (can start in parallel with A)
- `SCORED_V2_LAYERS` in `layers.ts`. Audit every `ALL_V2_LAYERS` use (finding 3) and classify each as scored or displayed. Keep the fixed-denominator guards in `coverage.ts` intact.
- Invariant tests: L11 never in any scored set, and a client-linked audit with L11 failures scores identically to the same audit without them. Modelled on the `PLATFORM_MATCHER_HOSTS` invariant test.
- All existing scoring tests pass unchanged.

### B2 · Data path, rules, rendering (needs B1 and A2)
- `AuditData.reconciliation_summary` (scoping doc §3 plus §7 topology and discontinuity inputs), resolved in the orchestrator before `runRegister()`.
- Preconditions `client_linked` and `reconciliation_data_available`. Bare, public and no-run audits get `skipped`.
- `L11.ts` with five rules, pure and synchronous. Topology wording: candidate explanation only, covered for all four verdicts.
- Extend `UnassessableKind` with a reconciliation kind. If it reads badly for assessed findings, record the alternative in §12 first.
- "Against your connected platforms" section in the PDF and web report, omitted when skipped. `outputLint` coverage for every copy variant.
- Bump `REGISTER_VERSION` 1.4.0 → **1.5.0**. Update the register structural-integrity and layer-count tests in lockstep.
- Build against a seeded fixture if Sprint 0.4 finds no live reconciliation data, and record that live verification is outstanding.
- Exit: AC B.7 items 1–6 (item 1 amended).

## Part C · Junk conversion gate

### C1 · Gate, rules, holds table, observe mode (needs Sprint 0.3)
- `services/capi/junkGate/`: C.5a rules plus evaluator (hard/soft verdict, per-client thresholds).
- Vendored disposable-domain and automation-UA lists with source, version and licence notes. Add `libphonenumber-js`.
- Gate placement per Sprint 0.3. Expected: Redis-memoised verdict keyed on `atlas_event_id`, one hold record per Atlas event listing all bound provider configs. Extend the `/process` route to pass client, IP and UA if Sprint 0.3 confirms that is the right capture point.
- Migrations: `junk_gate_configs` (default `mode='observe'`) and `conversion_holds` (RLS, hashed identifiers, encrypted payload).
- `capi_events.status` gains `junk_held`/`junk_rejected`, and `PipelineResult.status` mirrors them. Check Signal Tracking counters and filters for exhaustive status handling.
- Observe mode records verdicts and never delays or blocks.
- Tests: fire and no-fire per C.5a rule, `JC_DUPLICATE_SUBMISSION` distinct from `event_id` dedup, one evaluation per Atlas event across three providers.

### C2 · Enforce, review tab, release/reject/timeout
- Enforce mode with `action_junk`/`action_suspect`. Release re-enters at `runFromDedup()` with the original `event_id`, `event_time` and captured consent. Reject writes `junk_rejected`.
- Bull delayed job per hold (hold ID only in the payload). `hold_timeout_hours` and `timeout_action` default `release`. Ceiling clamp against `ingestWindows.ts` plus the new Meta website window constant, minus 12 hours, with the clamp surfaced.
- `HeldConversionsTab` in the CAPI Monitoring Dashboard: filters, single and bulk actions, `server_only`/`hybrid` classification with the §C.3 explanation, and a read-only "would have held" log in observe mode. Uses `console.*` tokens, with no fabricated charts.
- Payload nulled on every terminal status.
- Tests: PII-never-in-hold-table, logs or queue payloads; released events keep original identifiers; clamp test.

### C3 · Capture rules, monitoring, alerts
- `JC_HONEYPOT_FILLED` through the existing enrichment field mapping. `JC_SUBMIT_TOO_FAST` through GTM generator capture of first-interaction time and `atlas_ms_to_submit`. Update Google Stack Alignment golden fixtures and run the drift-proof check (mutate, see failure, revert).
- Per-client metrics: hold rate, per-rule hit rate, overturn rate, auto-release and auto-drop counts. Overturn-flag in the tab.
- DQM alerts (timeout-approaching, hold-rate spike), one rolled-up alert per org, with the alert-type CHECK widened in the same migration.

## Sequencing

```
Sprint 0 ─┬─ A1 → A2 ─┐
          ├─ A3        ├─ B2
B1 (parallel) ─────────┘
Sprint 0 ── C1 → C2 → C3
```

Recommended order of execution on the single branch: 0, B1, A1, A2, B2, A3, C1, C2, C3. B1 is cheap and independent, and A3 isn't needed by B. This keeps Part A→B data dependencies tight. You can reorder.

## Per-sprint validation (every sprint)

Backend typecheck and the changed-area tests, then the full backend suite, expecting only the 6 known unrelated failures. Frontend typecheck, `vite build` and tests where touched. New migrations are written and not applied. CLAUDE.md gets a sprint row, Key Technical Decisions §24/§17 and the register version are updated where touched, and the PRD §12 log is appended.

## Known risks and unverifiable items

- GA4 Admin and GTM schemas and scopes may not be fetchable here, so types stay marked unverified.
- Live GTM publish and rollback can't be exercised without a Google account.
- C1 depends on Sprint 0.3: if events carry no IP/UA today, `JC_NON_HUMAN_UA` and `JC_SUBMIT_VELOCITY` ship but stay inert until capture is added.
- Hybrid-event leakage (PRD §C.3) is disclosed, not solved.
