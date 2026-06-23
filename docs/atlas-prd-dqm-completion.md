# PRD: Data Quality Monitor — Completion (Phase 2)

**Status:** Draft — ready for Claude Code implementation
**Owner:** Vikram / Spi3l
**Related docs:** `CLAUDE.md`, `docs/manual/features/data-quality.md`, `atlas-prd-crawl-signal-extractor.md` (build order: CSE → DQM → Auto-insight Reporter)
**Depends on:** Existing DQM schema (`dqm_gtg_checks`, `dqm_dma_poll_state`), existing Health Dashboard / `health_scores` alerts pipeline (assumed live from IHC work — verify table name before implementation)

---

## 1. Background — current state (audited)

DQM core monitoring is functional (~70% complete). Built and working:

| Layer | Status |
|---|---|
| DB schema (`dqm_gtg_checks`, `dqm_dma_poll_state`, migration `20260615_001_dqm_tables.sql`, RLS) | ✅ |
| GTG probe service (`backend/src/services/dqm/gtgProbe.ts`) | ✅ |
| DMA poll service (`backend/src/services/dqm/dmaPolling.ts`) | ✅ |
| Orchestrator (`backend/src/services/dqm/dqmOrchestrator.ts`) | ✅ |
| API routes (`GET /api/dqm/status`, `POST /api/dqm/trigger`) | ✅ |
| Frontend panel (`DQMStatusPanel.tsx` in `HealthDashboardPage`) | ✅ |
| Tests (`dqm.test.ts`) | ✅ |

**Four gaps remain**, all blocking DQM from being self-running and alert-producing:

1. No scheduled/automatic execution — `runDQMForAllActiveOrgs()` only runs on manual trigger.
2. No alert delivery — DQM findings never reach the `health_scores`/alerts pipeline.
3. No "Degraded" classification — probe only records `pass/fail/timeout/error`, missing the documented slow-2xx state.
4. `backoff_until` column exists but DMA polling doesn't honor it.

This PRD closes all four. It does **not** add new check types, new data sources, or a fraud/signal-integrity scoring dimension — those are explicitly out of scope (see §8).

## 2. Problem statement

DQM currently requires a human to remember to click "trigger" and to read the panel. For DQM to do its job — catching tracking breakage before it silently corrupts a client's conversion signal — it has to run on its own and surface problems without anyone going looking for them.

## 3. Goals

- DQM runs automatically, per-org, on a predictable schedule, with no manual trigger required for normal operation.
- A failing or degraded check produces a real alert in the existing alerts/health-scores surface — not just a status row nobody opens.
- "Degraded" (slow but functioning) is a distinct, visible state, not silently folded into "pass."
- The DMA poller respects its own backoff window instead of hammering a failing endpoint on every orchestrator run.

## 4. Non-goals

- No new probe types (e.g., no expansion beyond GTG + DMA checks in this PRD).
- No alert *channels* beyond whatever the existing alerts pipeline already supports (email/webhook/in-app) — if it only supports in-app today, that's fine; this PRD wires DQM into it, it doesn't build new channels.
- No fraud/signal-integrity scoring (tracked separately; see §8).

## 5. Gap-by-gap design

### 5.1 Scheduled runs

**Current state:** `dqmOrchestrator.runDQMForAllActiveOrgs()` exists and is correct in isolation; nothing calls it on a timer.

**Design:** Use the existing Bull/Redis infrastructure (Render-managed, service `red-d7vpjnr7uimc73evp8lg`) rather than a separate cron daemon — this keeps DQM consistent with how CSE's Browserbase jobs are already orchestrated and avoids introducing a second scheduling mechanism into the stack.

- Register a Bull **repeatable job** (`dqm:scheduled-run`) using Bull's `repeat: { cron: '*/15 * * * *' }` (every 15 minutes — tune after observing real probe latency/cost; GTG is a cheap HEAD request, DMA polling is heavier, see staggering below).
- Job handler calls `dqmOrchestrator.runDQMForAllActiveOrgs()`.
- **Stagger, don't fire all orgs simultaneously.** If org count is non-trivial, have the repeatable job enqueue one child job per active org (`dqm:run-org`, payload `{ orgId }`) rather than looping synchronously inside one job — this gives per-org retry/failure isolation for free via Bull's existing retry semantics, and avoids one slow org's DMA poll blocking everyone else's GTG check.
- Idempotency: each child job keyed by `orgId + windowTimestamp` (e.g., `dqm-run:${orgId}:${flooredTo15min}`) so a Bull retry or overlapping manual trigger doesn't double-write a check result for the same window.
- Manual trigger (`POST /api/dqm/trigger`) stays as-is for on-demand runs (e.g., right after a client deploys a tracking change) — it bypasses the schedule, doesn't replace it.

**New code:**
- `backend/src/jobs/dqmScheduler.ts` — registers the repeatable job at boot (alongside wherever CSE's Bull queues are registered, for consistency).
- `backend/src/jobs/dqmRunOrgJob.ts` — per-org job handler, thin wrapper calling existing orchestrator logic scoped to one org.

**Schema change:** none required for this gap alone, but see §6 for a `dqm_run_log` table that also serves alerting (§5.2).

### 5.2 Alert delivery

**Current state:** Probe results land in `dqm_gtg_checks` / `dqm_dma_poll_state` but nothing reads them for alerting purposes.

**Design:** Add a thin **alert-writing adapter**, not a new alert system. DQM should look exactly like every other thing that already writes into the `health_scores`/alerts pipeline (confirm exact table/interface name before implementation — referred to generically below as `HealthAlertSink`).

- After each probe run (GTG or DMA), the orchestrator/job handler evaluates the result against severity rules and, if it crosses a threshold, calls `HealthAlertSink.write({ orgId, source: 'dqm', checkType: 'gtg' | 'dma', severity, message, metadata })`.
- **Severity mapping:**
  - GTG: `fail` or `timeout` → `critical`; new `degraded` (§5.3) → `warning`; `pass` → no alert (and auto-resolve any open `critical`/`warning` alert for that org+checkType if previously firing — i.e., recovery should clear the alert, not just leave it stale).
  - DMA: declining match-rate or upload-success-rate beyond a configurable threshold (suggest: >10 percentage point drop vs. trailing 7-day average, or absolute match rate <50%) → `warning`; complete upload failure or zero 30-day member count where there was previously activity → `critical`.
- **Dedup/noise control:** don't write a new alert on every single failing run if one is already open for that org+checkType — update the existing alert's `last_seen_at` and occurrence count instead. This requires either a `status` column on the alert record (`open`/`resolved`) or relying on whatever the existing alerts table already does for this (check before building — don't duplicate dedup logic that already exists elsewhere in the pipeline).
- **New code:** `backend/src/services/dqm/dqmAlertEvaluator.ts` — pure function taking a probe result + recent history, returning an alert decision (`none | open | update | resolve`). Keep this separate from the probe services themselves so the severity thresholds are unit-testable in isolation.

### 5.3 Degraded latency classification

**Current state:** `gtgProbe.ts` records `pass/fail/timeout/error` only. The manual already documents a "Degraded" state (2xx but slow, >2s) that doesn't exist in code.

**Design:**
- Extend the probe result enum: `pass | degraded | fail | timeout | error`.
- Classification logic in `gtgProbe.ts`: if HTTP status is 2xx **and** latency > threshold → `degraded`; if HTTP status is 2xx and latency ≤ threshold → `pass`; non-2xx → `fail` (unchanged); no response within timeout → `timeout` (unchanged).
- Threshold should be configurable per-org (not hardcoded), defaulting to 2000ms per the existing manual, stored alongside the org's DQM config (check whether a per-org config table already exists for DQM thresholds; if not, a single `dqm_org_config` table is justified scope here — small, but real schema addition, listed in §6).
- Frontend: `DQMStatusPanel.tsx` needs a visual state for `degraded` distinct from `pass` (amber, not green) — this is a small frontend change but should not be skipped, since the whole point of this gap is visibility.

### 5.4 Backoff implementation

**Current state:** `backoff_until` exists on `dqm_dma_poll_state` but `dmaPolling.ts` doesn't check it.

**Design:**
- At the top of the DMA poll function, before doing any work: if `backoff_until` is set and `now() < backoff_until`, skip the poll entirely and return a `skipped-backoff` result (this should **not** generate a new alert — the alert is already open from the failure that triggered the backoff; skipping is expected behavior, not a new problem).
- On poll failure, set `backoff_until = now() + backoffInterval`, where `backoffInterval` follows exponential backoff with a cap: start at 5 minutes, double on each consecutive failure, cap at e.g. 4 hours, reset to base on the next successful poll.
- Track consecutive-failure count (add `consecutive_failures` column if it doesn't already exist alongside `backoff_until` — check the existing migration before assuming this is missing).
- This logic belongs in `dmaPolling.ts` directly, gated at the start of the function — not in the orchestrator, since the orchestrator shouldn't need to know about DMA-specific backoff semantics.

## 6. Data model changes

New migration, e.g. `20260701_001_dqm_completion.sql`:

```sql
-- Per-org DQM configuration (latency threshold, alert sensitivity)
CREATE TABLE dqm_org_config (
  org_id UUID PRIMARY KEY REFERENCES orgs(id),
  degraded_latency_threshold_ms INT NOT NULL DEFAULT 2000,
  dma_match_rate_warning_threshold NUMERIC NOT NULL DEFAULT 0.50,
  dma_match_rate_drop_pct_warning NUMERIC NOT NULL DEFAULT 0.10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS consistent with existing dqm_* tables

-- Only if not already present on dqm_dma_poll_state — verify before applying
ALTER TABLE dqm_dma_poll_state
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;

-- Run-level audit log (also backs alert dedup/recovery logic in 5.2)
CREATE TABLE dqm_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  check_type TEXT NOT NULL CHECK (check_type IN ('gtg', 'dma')),
  status TEXT NOT NULL CHECK (status IN ('pass','degraded','fail','timeout','error','skipped-backoff')),
  latency_ms INT,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('scheduled','manual')),
  alert_action TEXT CHECK (alert_action IN ('none','open','update','resolve')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dqm_run_log_org_created ON dqm_run_log (org_id, created_at DESC);
-- RLS consistent with existing dqm_* tables
```

Confirm before applying: exact name/shape of the existing alerts/`health_scores` table this PRD writes into — adjust `HealthAlertSink` interface accordingly rather than guessing the schema here.

## 7. API changes

- `GET /api/dqm/status` — extend response to include `degraded` as a possible state and surface `consecutive_failures`/backoff status for DMA so the frontend can show "backing off, retrying at HH:MM" instead of a bare failure.
- `GET /api/dqm/runs?orgId=` (new) — paginated read of `dqm_run_log`, for a "recent activity" view if useful on the Health Dashboard; optional, not required for MVP of this PRD.
- No changes needed to `POST /api/dqm/trigger` beyond ensuring it also writes to `dqm_run_log` with `triggered_by: 'manual'`.

## 8. Future considerations (explicitly out of scope here)

The anomaly-evaluation pattern built in §5.2 (`dqmAlertEvaluator.ts` — taking a result plus recent history and producing a severity verdict) is the same shape of logic a future "signal integrity" or fraud-risk sub-score on Andromeda Signal Health would need (velocity/anomaly detection on conversion patterns rather than probe latency). Worth keeping the evaluator's interface generic enough that it isn't GTG/DMA-specific in spirit, but this PRD does not build, spec, or commit to that work.

## 9. Build sequence

1. Migration (§6) + `dqm_org_config` defaults backfill for existing orgs.
2. Degraded classification in `gtgProbe.ts` (§5.3) — smallest, most isolated change, do first.
3. Backoff logic in `dmaPolling.ts` (§5.4) — independent of the others, do in parallel with #2.
4. `dqmAlertEvaluator.ts` + `HealthAlertSink` wiring (§5.2) — depends on confirming the real alerts table shape first.
5. Bull scheduler + per-org job (§5.1) — depends on #2–4 being in place so scheduled runs actually produce the full behavior, not just trigger old logic on a timer.
6. Frontend: degraded state styling + backoff status display in `DQMStatusPanel.tsx`.
7. Tests: extend `dqm.test.ts` for degraded classification, backoff skip behavior, alert dedup/recovery, and add a test for the Bull job handler (mocked queue).

## 10. Success metrics

- Zero manual `POST /api/dqm/trigger` calls required for normal operation across active orgs for a full week post-launch (manual trigger usage should drop to near-zero, used only for ad-hoc verification).
- Time from a real tracking break to a visible alert: target under 15 minutes (one schedule interval), not "until someone opens the dashboard."
- No duplicate alert spam: a single ongoing failure produces one open alert that updates, not N alerts.

## 11. Risks / open questions

- **Confirm the real alerts/health_scores table schema before building `HealthAlertSink`** — this PRD assumes it exists from prior IHC work; if it doesn't, alert delivery needs its own mini-PRD first.
- **Schedule interval (15 min) is a placeholder** — tune based on actual GTG/DMA probe cost and org count; too frequent on DMA polling specifically risks hitting platform rate limits, which is exactly the kind of thing backoff (§5.4) needs to absorb gracefully.
- Per-org config (`dqm_org_config`) introduces a new table for thresholds that may belong instead on an existing `orgs` settings/JSON column if one exists — check before adding a new table.
