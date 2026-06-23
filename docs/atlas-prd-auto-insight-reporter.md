# PRD: Auto-insight Reporter

**Status:** Draft — new feature, no existing code or PRD (zero files, zero routes, zero schema as of this audit)
**Owner:** Vikram / Spi3l
**Build order:** Third module, after CSE (shipped) and DQM (in completion — see `atlas-prd-dqm-completion.md`)
**Referenced as downstream consumer in:** `atlas-prd-crawl-signal-extractor.md`, `PLATFORM_RECONCILIATION_PRD.md` (defers "AI-narrated remediation playbooks" to this), `SIGNAL_TRACKING_DASHBOARD_PRD.md`, `atlas-prd-usage-logging.md` (future consumer of usage cost data)
**Not to be confused with:** `atlas-output-quality-prd.md`, which fixes the GTM/planning output pipeline — different feature, no shared scope.

---

## 1. Background

Across the prior PRDs, Auto-insight Reporter has been named consistently as the thing that *explains* the data the rest of Atlas already collects — CSE's detected signals, DQM's health checks and alerts, Andromeda Signal Health scores, BSE delivery logs — instead of leaving an agency or in-house marketer to manually cross-reference Atlas's dashboard against GA4, Google Ads, and Meta Ads to figure out *why* something changed. No PRD has formally specced it. This is that PRD.

## 2. Problem statement

A client's CPA climbs 20% week over week. Right now, answering "why" requires someone to open four separate dashboards (GA4, Google Ads, Meta Ads, Atlas Health) and manually correlate timing. Most agencies don't do this consistently — it's expensive analyst time, and the connection between "a tracking issue Atlas already flagged three days ago" and "the CPA spike the client is asking about today" often never gets made explicitly, even though Atlas had the relevant signal-quality data the whole time.

Auto-insight Reporter's job: take performance data the client already has (GA4, Google Ads, Meta Ads) and signal-quality data Atlas already has (DQM alerts, CSE detected signals, Andromeda Signal Health, BSE delivery health) and produce a plain-language narrative that connects the two, on a schedule, without a human doing the cross-referencing.

## 3. Goals

- Ingest performance metrics from GA4, Google Ads, and Meta Ads on a recurring schedule per connected org.
- Detect statistically meaningful anomalies in that performance data (not just "number went up/down" — actual deviation from expected range).
- Correlate detected anomalies against Atlas's own signal-quality timeline (DQM alerts, CSE-detected tracking changes, Andromeda Signal Health score movements, BSE delivery failures/retries).
- Produce a narrated insight — written for a non-technical stakeholder — that states what changed, when, and what Atlas signal-quality data suggests as a plausible (not asserted-as-certain) contributing factor.
- Surface these on the Health Dashboard and, eventually, as a scheduled digest.

## 4. Non-goals (v1)

- Not a replacement for a human analyst's judgment — narratives state correlation and plausibility, never unqualified causation.
- Not real-time/streaming. Scheduled batch (daily) is the v1 cadence; sub-hourly detection is a later optimization if the data supports it.
- Not a remediation-action engine in v1 — it narrates and points at root causes; `PLATFORM_RECONCILIATION_PRD`'s "AI-narrated remediation playbooks" (i.e., "and here's exactly what to fix") is an explicit Phase 2+ extension of this PRD, not v1 scope.
- Not building new ad-platform reporting UIs — Atlas is not trying to replace GA4/Ads Manager, only to explain the delta between performance and signal quality.

## 5. User stories

- *As an agency account manager*, I want a daily/weekly note that already explains "CPA rose because tracking broke on the checkout page Tuesday" so I don't have to dig for it before the client call.
- *As an in-house marketer*, I want to know when a performance dip is a signal-quality problem (fixable, Atlas's lane) versus a genuine demand/market problem (not fixable by tracking work), so I stop wasting time investigating the wrong cause.
- *As an agency running this across 15 clients*, I want anomalies prioritized by severity/impact, not a wall of narrated noise for every minor fluctuation.

## 6. Architecture overview

```
┌─────────────────┐   ┌──────────────────┐   ┌────────────────────┐
│ External APIs    │   │ Atlas internal    │   │                     │
│ GA4 / Google Ads  │──▶│ data (DQM, CSE,   │──▶│ Correlation Engine  │
│ / Meta Ads        │   │ Andromeda, BSE)   │   │ (anomaly detect +   │
└─────────────────┘   └──────────────────┘   │  timeline join)     │
                                               └─────────┬──────────┘
                                                          ▼
                                               ┌─────────────────────┐
                                               │ Narration layer      │
                                               │ (LLM, structured      │
                                               │  prompt + guardrails) │
                                               └─────────┬───────────┘
                                                          ▼
                                               ┌─────────────────────┐
                                               │ ai_insights table     │
                                               │ → Health Dashboard +  │
                                               │   digest delivery     │
                                               └─────────────────────┘
```

Four new subsystems: (1) ingestion connectors, (2) anomaly detector, (3) correlation/join engine, (4) narration layer. Each is independently buildable and testable.

## 7. Data sources & ingestion

### 7.1 External (new connectors)

| Source | API | Auth | Frequency | Notes |
|---|---|---|---|---|
| GA4 | Google Analytics Data API | OAuth2, per-org client credentials | Daily | Pull standard funnel/conversion metrics per org's configured property |
| Google Ads | Google Ads API | OAuth2, likely shares creds/flow with existing CAPI Module's Google integration — reuse, don't duplicate | Daily | CPA, conversions, spend, impressions at campaign level |
| Meta Ads | Meta Marketing API | OAuth2, likely shares creds/flow with existing CAPI Module's Meta integration — reuse, don't duplicate | Daily | Same metric set, Meta-side |

**Reuse, don't rebuild, auth.** The CAPI Module already has Google and Meta OAuth flows for sending conversions. Check whether the existing token storage/refresh logic can be extended with read-scope (Analytics/Ads reporting scopes) rather than building a second, parallel OAuth integration per platform. This is the single biggest scope-reduction opportunity in this PRD.

**New schema:**

```sql
CREATE TABLE air_metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  source TEXT NOT NULL CHECK (source IN ('ga4','google_ads','meta_ads')),
  metric_name TEXT NOT NULL,        -- e.g. 'cpa', 'conversions', 'spend', 'ctr'
  dimension TEXT,                   -- e.g. campaign_id, null for account-level
  value NUMERIC NOT NULL,
  snapshot_date DATE NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, source, metric_name, dimension, snapshot_date)
);
CREATE INDEX idx_air_snapshots_org_date ON air_metric_snapshots (org_id, snapshot_date DESC);
-- RLS consistent with other org-scoped tables
```

### 7.2 Internal (already exists, read-only for this feature)

- `dqm_run_log` / alert records (from DQM completion PRD) — when did a tracking check fail/degrade.
- CSE `detected_signals` — when did a site's tracking configuration actually change.
- Andromeda Signal Health score history (confirm whether historical scores are already retained over time, or only current — if only current, this PRD needs to start retaining a time series, which is a real dependency to flag, not assume).
- BSE delivery logs (retry/failure rates to Meta CAPI / Google Enhanced Conversions).

**Dependency flag:** if Andromeda scores are not currently stored as a time series (only latest value), this PRD cannot correlate "score dropped on Tuesday" against a performance dip without that history existing first. Confirm before building the correlation engine.

## 8. Anomaly detection

Keep v1 deliberately simple and explainable — this is not the place for an opaque ML model when the eventual narration needs to justify "why did you flag this."

- **Method:** rolling baseline (e.g., trailing 14-day mean + standard deviation, or week-over-week with seasonality adjustment for day-of-week) per `(org, source, metric, dimension)`. Flag when a new snapshot deviates beyond a configurable z-score or percentage threshold (e.g., >2 standard deviations, or >20% week-over-week for low-variance metrics like CPA).
- Avoid alerting on metrics with too little volume to be statistically meaningful (small accounts will have noisy day-to-day swings) — apply a minimum-volume gate per metric before flagging.
- **New schema:**

```sql
CREATE TABLE air_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  source TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  dimension TEXT,
  detected_date DATE NOT NULL,
  baseline_value NUMERIC,
  observed_value NUMERIC,
  deviation_pct NUMERIC,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_air_anomalies_org_date ON air_anomalies (org_id, detected_date DESC);
```

## 9. Correlation engine

For each detected anomaly, look for Atlas-internal events in a window around `detected_date` (suggest ±3 days, configurable):

- Open or newly-opened DQM alerts for that org in the window.
- CSE-detected signal/tracking changes in the window.
- Andromeda Signal Health score drops in the window (pending the dependency in §7.2).
- BSE delivery failure/retry rate spikes in the window.

Output a **ranked list of candidate contributing factors**, not a single asserted cause — multiple things can co-occur, and the narration layer (§10) must be explicit that this is correlation, with timing proximity as the only evidence, not proof of causation.

```sql
CREATE TABLE air_insight_correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id UUID NOT NULL REFERENCES air_anomalies(id),
  factor_type TEXT NOT NULL CHECK (factor_type IN ('dqm_alert','cse_signal_change','andromeda_score_drop','bse_delivery_failure')),
  factor_ref_id UUID,              -- FK to the relevant source table row, nullable if not applicable
  factor_date DATE NOT NULL,
  proximity_days INT NOT NULL,     -- distance from anomaly date
  confidence_score NUMERIC,        -- simple heuristic score, not a black box — see below
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Confidence scoring (v1, heuristic not ML):** closer proximity = higher score; a DQM *critical* alert scores higher than a *warning*; multiple co-occurring factors don't average down — surface all above a minimum threshold, ranked. Keep this transparent and tunable rather than a trained model in v1 — there isn't yet enough labeled outcome data ("was this factor actually the cause") to train anything meaningful, and a fabricated-precision ML score would be worse than an honest heuristic here.

## 10. Narration layer

- Calls an LLM (Claude, via the Anthropic API — consistent with how other AI-assisted features in the Atlas stack are presumably built) with a **structured prompt**, not a freeform one: anomaly data + ranked correlation candidates + explicit instruction to (a) state what changed in plain language, (b) state correlated factors with their proximity and confidence, (c) explicitly flag uncertainty, (d) never assert unproven causation, (e) never recommend a remediation action in v1 (that's Phase 2, tied to Platform Reconciliation's playbook work).
- **Guardrail requirement, not optional:** every generated narrative must be traceable back to the specific anomaly + correlation rows that produced it (store the input payload alongside the output) so a human can audit *why* the AI said what it said. This matters both for trust with clients and for catching prompt/model drift over time.
- Output stored, not regenerated on every view:

```sql
CREATE TABLE air_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  anomaly_id UUID NOT NULL REFERENCES air_anomalies(id),
  narrative TEXT NOT NULL,
  input_payload JSONB NOT NULL,    -- full context sent to the LLM, for audit
  model_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_air_insights_org_status ON air_insights (org_id, status, created_at DESC);
-- RLS consistent with other org-scoped tables
```

## 11. API endpoints

- `GET /api/insights?orgId=&status=` — list insights, filterable, paginated.
- `POST /api/insights/:id/dismiss` / `/read` — status updates for dashboard UX.
- `POST /api/insights/trigger` — manual on-demand run for an org (mirrors DQM's manual trigger pattern), useful for QA and for "client asked about this right now" cases.
- No public-facing endpoint needed in v1 beyond what the Health Dashboard frontend consumes.

## 12. Dashboard integration

- New panel on `HealthDashboardPage` (alongside `DQMStatusPanel.tsx`) — "Insights" feed, most recent/highest-severity first, collapsed by default with expand for full narrative + the underlying anomaly/correlation data (for the technically curious or skeptical client).
- Each insight should visually link to the DQM alert / CSE signal change it cites, if applicable — i.e., clicking "tracking issue flagged Tuesday" jumps to that DQM alert, not just mentions it as text.

## 13. Build phases

1. **Ingestion connectors** (§7) — start with whichever platform reuses existing OAuth most cleanly (likely Google, given CAPI Module precedent); Meta and GA4 follow.
2. **Anomaly detection** (§8) — buildable and testable against historical `air_metric_snapshots` data once a few weeks of ingestion have run; don't wait for narration to validate this layer.
3. **Correlation engine** (§9) — depends on Andromeda score history dependency (§7.2) being resolved; flag this early so it isn't a late blocker.
4. **Narration layer** (§10) — last, since it depends on having real anomaly + correlation data to prompt against and tune guardrails with.
5. **Dashboard integration** (§12) — in parallel with #4 once the `air_insights` schema is stable.
6. **Digest delivery** (email/scheduled summary) — explicitly deferred to a fast-follow after v1 ships on-dashboard; not required for initial launch.

## 14. Success metrics

- % of flagged anomalies that have at least one correlated Atlas-internal factor surfaced (signal vs. noise ratio of the correlation engine).
- Time from anomaly occurrence to narrated insight appearing: target under 24 hours (daily batch cadence).
- Qualitative: agency pilot users report the narrative as "directionally useful" without needing significant editing before sharing with a client — track this via the `read`/`dismissed` status as a rough proxy, supplemented by direct pilot feedback.

## 15. Risks & mitigations

- **LLM overstating causation.** Mitigated by structured prompting (§10) and a hard non-goal against asserting unproven causation — this needs to be tested adversarially before launch (try to get the model to overstate certainty, fix the prompt until it won't).
- **API cost/rate limits** from daily pulls across GA4/Google Ads/Meta Ads for every active org. Needs cost modeling before rollout — tie into the existing usage-logging work (`atlas-prd-usage-logging.md` already flags this PRD as a future consumer of usage cost data, so the cost-tracking hook should be built in from day one, not bolted on later).
- **OAuth scope creep risk.** Reusing CAPI Module's existing Google/Meta auth for read-only reporting scopes needs a security review — adding broader read scopes to an existing token grant is not nothing, even if it avoids a second OAuth flow.
- **False precision in confidence scoring** (§9) — heuristic score must be presented to users as a rough rank, not a percentage implying statistical rigor it doesn't have.

## 16. Open questions

- Is Andromeda Signal Health currently stored as a time series, or only the latest value? (Blocking dependency for §9 — resolve before correlation engine work starts.)
- Does the CAPI Module's existing OAuth token storage support adding read-only reporting scopes cleanly, or does this need a parallel grant?
- What LLM/API budget per org per day is acceptable, and does this need to be a billed feature tier (ties into `atlas-prd-pricing-billing-lifecycle` if that's the right doc name) rather than bundled free?
- Daily batch cadence assumed — confirm this matches client expectations (some agencies may want this only weekly, to avoid alert fatigue, given the "ranked, not a wall of noise" goal in §5).
