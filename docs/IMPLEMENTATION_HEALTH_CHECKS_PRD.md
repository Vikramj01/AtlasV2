# Atlas — Implementation Health Checks PRD (v2, revised)

**Module name:** Implementation Health Checks (IHC)
**Positioning:** Extension of the existing **Validation Engine**. Adds two new `validation_layer` values (`tag_configuration`, `implementation_drift`) to the existing rule registry. Findings flow through existing Audit Engine output and Health Dashboard alert feed.
**Owner:** Atlas core
**Status:** Ready for Claude Code execution
**Last updated:** May 2026
**Active branch:** `claude/map-b2b-advertiser-journey-UEDDw`

---

## 1. Context

AtlasV2 already ships a Validation Engine with 26 rules across three layers (`signal_initiation` × 8, `parameter_completeness` × 12, `persistence` × 6). Rules consume `AuditData` — runtime observations from headless browser journey simulation — and emit `ValidationResult` objects. Interpretations live in a parallel `RULE_INTERPRETATIONS` map carrying business impact, severity, owner, and fix summary. Findings are scored, summarized via `generateBusinessSummary`, and exported as PDF reports through the Audit Engine.

CSE is live (`backend/src/services/crawl/`, migration `20260530_001_crawl_signal_extractor.sql`, `/api/crawl/*` routes, `CrawlStatusPage` at `/crawl/:runId`). The Health Dashboard alert feed exists. Operator alert delivery exists via `services/usage/alertDelivery.ts`.

The existing 26 rules answer **"did the right thing happen at runtime?"** They do not answer:

- **"Is the GTM configuration set up correctly at the source?"** (custom HTML bypassing consent, hardcoded literals where dynamic variables should be, duplicate tag definitions, consent settings missing or misconfigured, fragile CSS-selector triggers)
- **"Did something break since the last good state?"** (regression vs. baseline, selectors that vanished after a site change, payload shape changes)

These two question types map cleanly to two new validation layers in the existing engine.

## 2. Objective

Extend the Validation Engine to detect (a) GTM **configuration** mistakes that the existing runtime rules cannot see, and (b) **regressions** from a known good baseline. Use the same rule contract, severity scale, interpretation system, and reporting pipeline as the existing engine.

## 3. Scope

### In scope (v1)

Two new `validation_layer` values in the Validation Engine:

- **`tag_configuration`** — static rules that operate on GTM container JSON
- **`implementation_drift`** — rules that compare current `AuditData` against a stored baseline

**14 new rules** distributed across these two layers (full list in §5).

GTM container ingestion (OAuth + JSON upload fallback) so static rules have container data to operate on.

Baseline state management so drift rules have something to compare against — reusing the existing `crawl_runs` table with an `is_baseline` flag.

UI surfaces extending the existing Audit Engine output, Signal Library tag drill-down, and Health Dashboard alert feed. No new top-level navigation.

Alert delivery reusing existing `services/usage/alertDelivery.ts`. New workspace-level notification preferences.

### Out of scope (v1)

- Slack / Teams / SMS / mobile push (email + in-app only)
- Auto-remediation suggestions or one-click fixes
- LLM-based classification of unfamiliar custom HTML snippets (deterministic only)
- IHC findings affecting the Andromeda composite score (advisory only in v1)
- Per-region IHC differentiation (multi-region currency mismatch handling deferred to existing multi-region scope)

## 4. Architecture alignment

### 4.1 Rule contract

Every new rule follows the existing shape exactly:

```typescript
export const RULE_NAME = {
  rule_id: 'RULE_NAME',
  validation_layer: 'tag_configuration' | 'implementation_drift',
  severity: 'critical' | 'high' | 'medium' | 'low',
  affected_platforms: string[],
  business_impact: string,
  recommended_owner: 'Frontend Developer' | 'Backend Developer' | 'GTM implementer' | 'Marketing Ops' | 'DevOps' | 'Security',
  fix_summary: string,
  test: (auditData: AuditData) => ValidationResult
};
```

Rules register in `validation-rules.ts` (appended to `ALL_VALIDATION_RULES`). Interpretations register in `rule-interpretations.ts` (appended to `RULE_INTERPRETATIONS`) with `business_impact`, `affected_platforms`, `severity`, `recommended_owner`, `fix_summary`, `estimated_effort`.

### 4.2 AuditData extensions

The `AuditData` type (in `types/audit`) gains two optional fields:

```typescript
interface AuditData {
  // ...existing fields...
  gtmContainer?: GTMContainerSnapshot;      // For tag_configuration layer
  baselineAuditData?: AuditData;            // For implementation_drift layer
}

interface GTMContainerSnapshot {
  container_id: string;
  fetched_at: string;
  source: 'gtm_api' | 'manual_upload';
  tags: GTMTag[];
  triggers: GTMTrigger[];
  variables: GTMVariable[];
  built_in_variables: string[];
  consent_default_tag: GTMTag | null;
}
```

Rules that need a particular data source declare it implicitly by what they read. The validation runner skips rules whose required data is absent and marks them `'skipped'` (new status value) rather than `'fail'`.

### 4.3 New tables

Migration: `20260XXX_implementation_health.sql`

```sql
-- GTM container connections per property
create table gtm_container_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  property_id uuid not null,
  container_id text not null,                    -- GTM-XXXXX
  account_id text,
  auth_method text not null check (auth_method in ('oauth', 'manual_upload')),
  oauth_credentials_encrypted text,              -- AES-256-GCM via @noble/ciphers
  last_synced_at timestamptz,
  last_container_json_snapshot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Container JSON snapshots (versioned, for drift over time)
create table gtm_container_snapshots (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references gtm_container_connections(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  container_json jsonb not null,                 -- Full container export
  container_version text,
  snapshot_at timestamptz not null default now(),
  is_active boolean not null default true
);

-- Per-org notification preferences for IHC alerts
create table ihc_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) unique,
  email_critical_enabled boolean not null default true,
  email_high_digest_enabled boolean not null default true,
  email_medium_digest_enabled boolean not null default true,
  email_low_enabled boolean not null default false,
  digest_timezone text not null default 'UTC',
  daily_digest_hour int not null default 9,
  weekly_digest_day int not null default 1,      -- Monday
  weekly_digest_hour int not null default 9,
  critical_alert_batch_minutes int not null default 15,
  recipient_user_ids uuid[] not null default '{}',
  paused_properties uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit findings (persistent, cross-run) — extend existing or add new
create table audit_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  client_id uuid references clients(id),
  property_id uuid not null,
  rule_id text not null,
  validation_layer text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'suppressed')),
  evidence jsonb not null,
  resolution_note text,
  suppressed_until timestamptz,
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_audit_findings_org_status on audit_findings(organization_id, status);
create index idx_audit_findings_property_severity on audit_findings(property_id, severity);
create index idx_audit_findings_rule on audit_findings(rule_id);

-- All four tables: RLS enforced via organization_id = (select organization_id from profiles where id = auth.uid())
```

### 4.4 Existing tables extended

`crawl_runs` — add `is_baseline boolean not null default false`. Only one active baseline per property at a time. Index: `(property_id, is_baseline) where is_baseline = true`.

### 4.5 Job infrastructure

Drift detection runs as a scheduled Bull job on **Render-managed Redis** (service `red-d7vpjnr7uimc73evp8lg`). New queue: `ihcDriftQueue` in `backend/src/services/queue/`. Default cadence: daily per property with active container connection. Pro plan: daily. Agency plan: configurable down to hourly. Free: not available.

GTM container sync runs as a separate Bull job: `gtmContainerSyncQueue`. Hourly for OAuth-connected containers; on-demand for manual uploads.

### 4.6 Plan gating

`planGuard('pro')` on all IHC routes — these are deeper-audit features matching the `pro` tier boundary. `<PlanGate minPlan="pro">` on UI components. Super admins bypass both as per existing convention.

## 5. New rules

For each rule below: `rule_id`, `severity`, `affected_platforms`, `business_impact` (truncated for brevity in PRD; full text goes into `rule-interpretations.ts`), and the test logic outline.

### Layer: `tag_configuration` (11 rules)

#### 5.1 CUSTOM_HTML_TAG_DETECTED
- **severity:** `medium`
- **platforms:** `['All']`
- **business_impact:** Custom HTML tags bypass GTM template safety, cannot be governed centrally, and frequently contain copy-pasted legacy code from old tutorials. Each one is a future maintenance and audit liability.
- **owner:** GTM implementer
- **fix:** Replace with a built-in tag template wherever possible. If a template doesn't exist, document the reason for the custom HTML in the tag note.
- **test:** Count tags where `type === 'html'`. Pass if count = 0. Warning if 1–3. Fail if > 3.

#### 5.2 CUSTOM_HTML_TAG_BYPASSES_CONSENT
- **severity:** `critical`
- **platforms:** `['All']`
- **business_impact:** A custom HTML tag is sending tracking events without consent gating. This is a compliance violation under GDPR, ePrivacy, UAE Personal Data Protection Law, and similar regulations. Ad accounts and customer trust are at direct risk.
- **owner:** GTM implementer
- **fix:** Add `consentSettings` to the tag with the appropriate required consent types. If the tag fires `gtag`, `fbq`, or other marketing pixels, it must require `ad_storage` and `ad_user_data` consent at minimum.
- **test:** For each custom HTML tag, parse content for `gtag(`, `fbq(`, `ga(`, `_gaq.push`, or third-party pixel patterns. Fail if any such tag has no `consentSettings` or `consentSettings === 'NO_ADDITIONAL_CONSENT'`.

#### 5.3 CUSTOM_HTML_TAG_HARDCODES_CONVERSION_DATA
- **severity:** `high`
- **platforms:** `['Google Ads', 'Meta Ads', 'GA4']`
- **business_impact:** A custom HTML tag contains hardcoded conversion IDs, pixel IDs, or value/currency literals. These never adapt to runtime context — every conversion gets the same hardcoded value, every transaction looks the same to the algorithm.
- **owner:** GTM implementer
- **fix:** Move conversion IDs and pixel IDs to GTM variables. Move value, currency, and transaction_id to dataLayer-sourced variables.
- **test:** For each custom HTML tag, regex-match: `AW-\d+`, `G-[A-Z0-9]+`, pixel ID patterns, `currency:\s*['"]\w{3}['"]`, `value:\s*\d+`. Fail if any match in a tag identified as tracking-critical.

#### 5.4 HARDCODED_VALUE_IN_TAG_CONFIG
- **severity:** `critical`
- **platforms:** `['Google Ads', 'Meta Ads', 'GA4', 'sGTM']`
- **business_impact:** A conversion tag has the `value` parameter set as a literal number or string rather than a dataLayer variable. Smart Bidding and tROAS will train on this flat value, distorting bids and ROAS reporting. Most common cause: a test value left in production after development.
- **owner:** GTM implementer
- **fix:** Replace the literal value with `{{ecommerce.value}}` or the equivalent dataLayer variable reference.
- **test:** For each tag where destination is in `['google_ads_conversion', 'ga4_event', 'meta_pixel']` and event in `['purchase', 'generate_lead', 'sign_up']`, inspect the `value` parameter. Fail if value is a literal (number or string) rather than a `{{variable}}` reference.

#### 5.5 HARDCODED_CURRENCY_IN_TAG_CONFIG
- **severity:** `high`
- **platforms:** `['Google Ads', 'Meta Ads', 'GA4']`
- **business_impact:** A conversion tag has `currency` set as a literal string. If this doesn't match the site's actual transaction currency, ad platforms will misvalue conversions (e.g., 100 SGD treated as 100 AED). If it does match and the site is single-region, this is acceptable but fragile to future expansion.
- **owner:** GTM implementer
- **fix:** Use a dataLayer variable for currency. If the site is genuinely single-currency, document that decision in the tag note.
- **test:** Inspect `currency` parameter on conversion tags. Warning if literal but matches property's known locale currency. Fail if literal and mismatch with property locale.

#### 5.6 HARDCODED_TRANSACTION_ID_IN_TAG_CONFIG
- **severity:** `critical`
- **platforms:** `['All']`
- **business_impact:** Transaction ID is hardcoded. This collapses deduplication completely — every purchase carries the same ID, causing all but one to be discarded by GA4 / ad platforms with dedup logic. Conversions silently drop to ~1 per day regardless of real volume.
- **owner:** GTM implementer
- **fix:** Replace with `{{ecommerce.transaction_id}}` dataLayer variable.
- **test:** Inspect `transaction_id` parameter. Fail if literal.

#### 5.7 DUPLICATE_TAG_CONFIGURATION
- **severity:** `critical`
- **platforms:** `['Google Ads', 'Meta Ads', 'GA4']`
- **business_impact:** Multiple tags fire the same conversion event for the same destination. Conversions are counted multiple times. ROAS appears inflated; algorithms train on phantom volume.
- **owner:** GTM implementer
- **fix:** Identify the canonical tag and pause/delete the duplicates. If sGTM and client-side both legitimately fire for the same event, ensure `event_id` is set on both for deduplication.
- **test:** Group tags by `(destination_platform, conversion_id_or_pixel_id, event_name)`. Identify groups with overlapping firing triggers. Fail if any duplicate group lacks `event_id` for dedup.

#### 5.8 CONSENT_SETTINGS_MISSING_ON_MARKETING_TAG
- **severity:** `critical`
- **platforms:** `['Google Ads', 'Meta Ads', 'GA4', 'LinkedIn Ads', 'TikTok Ads', 'Pinterest Ads', 'Microsoft Ads']`
- **business_impact:** A marketing or advertising tag has no Consent Mode v2 settings configured. The tag will fire regardless of user consent state, creating compliance exposure under GDPR / ePrivacy / regional privacy laws.
- **owner:** GTM implementer
- **fix:** Configure `consentSettings` requiring `ad_storage` and `ad_user_data` for ad-platform tags; `analytics_storage` for analytics tags.
- **test:** For each tag with destination in marketing platforms, inspect `consentSettings`. Fail if absent or `NO_ADDITIONAL_CONSENT`.

#### 5.9 CONSENT_TYPE_MISMATCH
- **severity:** `high`
- **platforms:** varies
- **business_impact:** A marketing tag requires only `analytics_storage` consent (or vice versa). Users granting analytics consent but denying ads consent are still being tracked by ads tags, creating compliance risk.
- **owner:** GTM implementer
- **fix:** Marketing tags must require `ad_storage` + `ad_user_data`. Analytics tags require `analytics_storage`. Don't mix.
- **test:** Match tag destination type against required consent types. Fail on mismatch.

#### 5.10 DEFAULT_CONSENT_GRANTED_GLOBALLY
- **severity:** `medium`
- **platforms:** `['All']`
- **business_impact:** The container's Consent Mode default state is `granted` for all signals. Either there is no consent banner, or the CMP integration is decorative — tags fire regardless of user choice. Compliance exposure.
- **owner:** GTM implementer
- **fix:** Set default consent state to `denied` for `ad_storage`, `ad_user_data`, `ad_personalization`, and `analytics_storage` in EU/EEA/UK regions. Update via CMP integration when user grants.
- **test:** Inspect container-level Consent Mode initialization tag. Fail if defaults are `granted` globally and no region-specific overrides.

#### 5.11 FRAGILE_CSS_SELECTOR_TRIGGER
- **severity:** `low` (advisory) — promoted to `critical` by drift layer if selector vanishes
- **platforms:** `['All']`
- **business_impact:** A trigger depends on a specific CSS class, ID, or selector. These break silently when the site is redesigned. Identifying them in advance lets you either replace with dataLayer events or monitor more closely.
- **owner:** GTM implementer
- **fix:** Replace with dataLayer push events where possible. If CSS selector is the only option, document the dependency.
- **test:** For each click / form-submit trigger, check filter conditions. Flag triggers using `Click Classes`, `Click ID`, `Click Element matches CSS selector`, `Form ID`, or `Form Classes` as fragile.

### Layer: `implementation_drift` (3 rules)

These rules require both a current `AuditData` snapshot and a `baselineAuditData` snapshot. They only run when `is_baseline` exists for the property.

#### 5.12 SELECTOR_NOT_FOUND_ON_LIVE_SITE
- **severity:** `critical`
- **platforms:** `['All']`
- **business_impact:** A trigger's CSS selector no longer exists on the live site. The trigger is dead — any conversions or events depending on it are not firing. Most common cause: a frontend redesign renamed the target element.
- **owner:** Frontend Developer
- **fix:** Update the trigger to match the new CSS selector, or replace with a dataLayer event push.
- **test:** Cross-reference triggers flagged as fragile (rule 5.11) with the latest CSE crawl results. Fail if the referenced selector is not found on any crawled page where the trigger should apply.

#### 5.13 TAG_FIRING_REGRESSION_VS_BASELINE
- **severity:** `critical`
- **platforms:** varies
- **business_impact:** A tag that fired successfully in the baseline is no longer firing on the same page. This indicates a regression — either the trigger broke, the tag was paused, or the page changed in a way that prevents firing. Conversion tracking is currently broken for affected events.
- **owner:** Frontend Developer or GTM implementer
- **fix:** Compare current tag firing to baseline, identify what changed (site code, GTM container, or both), and restore.
- **test:** For each page-tag pair in baseline, check current `AuditData` for the same firing. Fail if the tag fired in baseline but does not fire now. Must persist across 2 consecutive runs to alert (suppresses transient site flakiness).

#### 5.14 TAG_PAYLOAD_REGRESSION_VS_BASELINE
- **severity:** `high`
- **platforms:** varies
- **business_impact:** A tag is firing but the payload has changed in a way that degrades signal quality. Most common cases: `value` was a number in baseline, now `undefined`; `transaction_id` was populated, now missing; `currency` changed.
- **owner:** Frontend Developer or Backend Developer
- **fix:** Identify the dataLayer change. Restore the variable population at the source.
- **test:** Compare key payload fields (`value`, `currency`, `transaction_id`, `event_id`, `items` length, `user_data` presence) for the same tag on the same page across baseline and current. Fail if a field changed from populated to null/undefined or changed type. Must persist 2 consecutive runs.

## 6. GTM container ingestion

### 6.1 Primary path: GTM API OAuth

Add OAuth flow for Google Tag Manager API (scope: `https://www.googleapis.com/auth/tagmanager.readonly`). On connect:

1. User clicks "Connect GTM" in property settings
2. OAuth flow stores access + refresh tokens in `gtm_container_connections.oauth_credentials_encrypted` (AES-256-GCM)
3. Backend fetches account list → user selects account → user selects container
4. Initial container sync runs immediately; subsequent syncs run hourly via `gtmContainerSyncQueue`
5. Each sync writes a row to `gtm_container_snapshots` and updates `last_container_json_snapshot_id`

### 6.2 Fallback path: manual JSON upload

For users who cannot grant OAuth (read-only access concerns, or no admin):

1. User exports container JSON from GTM UI (Admin → Export Container)
2. Uploads via file picker or pastes JSON
3. Backend validates schema, stores in `gtm_container_snapshots`
4. No automatic refresh; user prompted to re-upload after significant time has passed (e.g., 14 days)

### 6.3 Container parser

New service: `backend/src/services/gtm/containerParser.ts`. Normalizes GTM container JSON into the `GTMContainerSnapshot` type used by `AuditData`. Handles GTM API response format and exported JSON format identically.

## 7. Baseline state management

A baseline is a designated "known good" snapshot of `AuditData` for a property. Drift rules compare current state to this baseline.

### 7.1 Baseline creation

- **Automatic:** First successful CSE crawl after IHC is enabled for a property automatically becomes the baseline.
- **Manual:** User can click "Set as baseline" on any successful audit/crawl run to promote it.
- **Replace:** Setting a new baseline marks the previous as `is_baseline = false`.

### 7.2 Baseline as `AuditData`

The drift rules consume `auditData.baselineAuditData`. The Validation Engine runner is responsible for populating this field by:

1. Loading the most recent crawl with `is_baseline = true` for the property
2. Reconstructing `AuditData` from `crawl_pages` and `detected_signals`
3. Attaching it to the current `AuditData` before running drift-layer rules

### 7.3 Cadence

- Pro plan: daily drift check (Bull job at 02:00 workspace TZ)
- Agency plan: configurable down to hourly
- Free plan: no drift checks (IHC entirely behind `planGuard('pro')`)

## 8. UI changes

### 8.1 Audit Engine PDF report (existing)

The Audit Engine already produces scored PDF reports. Extend the report template (`backend/src/services/audit/reportGenerator.ts` or equivalent) to include:

- Two new sections after the existing layer sections: **Configuration Health** (`tag_configuration` findings) and **Drift Detection** (`implementation_drift` findings)
- Each section uses the same finding card pattern as existing layers
- `generateBusinessSummary` updated to include new severity counts

### 8.2 Audit results page (existing)

Add a `validation_layer` filter chip set: signal_initiation / parameter_completeness / persistence / **tag_configuration** / **implementation_drift**. Multi-select. Default: all selected.

Per-finding cards already render `business_impact`, `recommended_owner`, `fix_summary`. No changes needed beyond ensuring new rules populate these fields.

### 8.3 Signal Library tag drill-down (existing `/signals`)

Add a **Health Checks** tab on each tag's detail view, showing all findings (open + resolved) where the evidence references that tag. Timeline of detection and resolution.

### 8.4 Health Dashboard alert feed (existing)

Critical and high findings from new layers automatically appear in the existing alert feed. No new dashboard surface — reuse the existing pattern.

### 8.5 Journey Builder integration (existing)

In Journey Builder, when a journey step references a signal that has an open `critical` or `high` finding, render a warning chip on the step:

```
Step 3: Add to Cart
[⚠ Implementation issue detected — see Health Checks]
```

Click opens the finding in a side panel.

### 8.6 New settings page

Add **Settings → Implementation Health** page with:

- GTM container connection management (connect / re-upload / disconnect per property)
- Baseline status (current baseline timestamp, "set new baseline" action)
- Notification preferences (severity-tier toggles, digest timing, recipient list, paused properties)

### 8.7 New routes

```
GET  /settings/implementation-health
POST /api/gtm/connect                    // OAuth start
GET  /api/gtm/callback                   // OAuth callback
POST /api/gtm/upload                     // Manual JSON upload
GET  /api/gtm/containers                 // List connected containers
DELETE /api/gtm/containers/:id           // Disconnect

POST /api/audit/baseline/:property_id    // Set current as baseline
GET  /api/audit/baselines                // List baselines

GET  /api/findings                       // Filter by validation_layer, severity, status
PATCH /api/findings/:id                  // Acknowledge, resolve, suppress
POST /api/findings/bulk-action

GET  /api/ihc/preferences
PATCH /api/ihc/preferences
```

All routes use existing `authMiddleware` + `planGuard('pro')` + Zod request validation. RLS enforced on every table.

## 9. Alert system

### 9.1 Channel

Email + in-app feed only. Email delivery via existing `services/usage/alertDelivery.ts`. In-app via existing Health Dashboard alert feed.

### 9.2 Severity → cadence mapping

| Severity | Delivery |
|---|---|
| `critical` | Email immediate (batched 15min default, configurable) + in-app + dashboard prominence |
| `high` | Daily digest email at workspace-configured hour + in-app |
| `medium` | Weekly digest email Monday workspace-configured hour + in-app |
| `low` | In-app only (no email by default; opt-in toggle available) |

### 9.3 Critical alert content

Subject: `[Atlas] Critical: {rule_title} on {property_name}`

Body assembled from `RULE_INTERPRETATIONS[rule_id]`:
- `business_impact`
- Evidence summary from `audit_findings.evidence`
- `recommended_owner`
- `fix_summary`
- `estimated_effort`
- Deep link to finding in Atlas

### 9.4 Dedup rules

- A finding alerts once on transition from `closed` → `open`.
- While `open` and unchanged, no further alerts.
- Severity escalation (e.g., `low` → `critical` when fragility rule is promoted by drift layer) triggers a new alert at the new severity.
- Closed → re-opened within 24h: suppress (anti-flap).
- Closed → re-opened after 24h: new alert.
- `suppressed` status silences alerts for the suppression window.

### 9.5 Critical batching

To prevent alert storms after a major site deploy: 15-minute rolling window per organization, up to 10 critical findings per email. Excess goes to the next batch. Window is configurable per org via `ihc_alert_preferences.critical_alert_batch_minutes`.

## 10. Implementation phasing

| Phase | Scope | Duration | Dependencies |
|---|---|---|---|
| A | Container ingestion (OAuth + upload), container parser, 7 of 11 `tag_configuration` rules (custom HTML × 3, hardcoded × 3, duplicate × 1) | 2 sprints | None |
| B | Consent rules × 3 + Fragility rule | 1 sprint | Phase A |
| C | Drift rules × 3 + baseline management + Bull scheduled job | 2 sprints | CSE (already shipped); parallelizable with B |
| D | UI surfaces (settings page, filters, drill-down tab, Journey chips) | 1–2 sprints | A & B partial |
| E | Alert system (email digest, in-app feed integration, preferences) | 1 sprint | A findings persisted |

Total: roughly 5–6 sprints, with B/C/D parallelizable. Active branch already in flight; cut a feature branch off `claude/map-b2b-advertiser-journey-UEDDw` or its merged successor.

## 11. Acceptance criteria

### Phase A
- [ ] GTM OAuth flow connects, stores encrypted tokens, fetches initial container
- [ ] Manual JSON upload accepts valid container exports, rejects malformed input
- [ ] `gtmContainerSyncQueue` runs hourly, writes new snapshot when container version changes
- [ ] 7 Phase A rules registered in `ALL_VALIDATION_RULES` with matching entries in `RULE_INTERPRETATIONS`
- [ ] Audit Engine output includes new section for `tag_configuration` layer findings
- [ ] `audit_findings` table populated, RLS verified
- [ ] PDF report renders new section correctly with severity counts

### Phase B
- [ ] 4 remaining `tag_configuration` rules registered and tested
- [ ] Consent Mode default state correctly detected from container-level tag

### Phase C
- [ ] CSE crawl can be promoted to baseline; only one active baseline per property
- [ ] `baselineAuditData` reconstruction works correctly from `crawl_pages` + `detected_signals`
- [ ] Drift rules only run when baseline exists; otherwise marked `'skipped'`
- [ ] Regression alerts require 2 consecutive failures (suppresses transient flake)
- [ ] `ihcDriftQueue` runs on configured cadence per plan tier

### Phase D
- [ ] `validation_layer` filter chip on audit results page
- [ ] Health Checks tab on Signal Library tag drill-down
- [ ] Warning chip on Journey Builder steps with open critical/high findings
- [ ] Settings → Implementation Health page renders and persists preferences
- [ ] `<PlanGate minPlan="pro">` enforced on all IHC UI

### Phase E
- [ ] Critical alerts delivered within 15min of detection (configurable)
- [ ] Daily digest at workspace TZ hour
- [ ] Weekly digest on Monday at workspace TZ hour
- [ ] Dedup rules prevent flapping
- [ ] In-app feed shows new findings, marks acknowledged on view
- [ ] Bulk acknowledge / resolve / suppress works end-to-end
- [ ] `ihc_alert_preferences` per-org settings respected

## 12. Open questions

1. **GTM container delta detection:** when a new snapshot arrives, do we re-run all `tag_configuration` rules immediately, or only run rules whose dependent tags changed? Recommend re-run all on container change (rules are cheap; latency is fine).

2. **Custom HTML classifier:** v1 uses deterministic regex patterns (`gtag(`, `fbq(`, etc.). Some legitimate custom HTML won't match these but is still tracking-related. Do we add a Claude-based classifier in v1.1? Recommend defer to v1.1 and gather false-negative data first.

3. **Baseline drift over time:** if a baseline is 60 days old and the site has legitimately evolved, drift alerts become noisy. Do we auto-suggest baseline refresh after N days? Recommend yes — surface a "Baseline is 30+ days old" warning in settings, with one-click refresh.

4. **Fragility rule visibility on free plan:** could the FRAGILE_CSS_SELECTOR_TRIGGER count (without detail) be shown on free plan as upsell? Recommend yes — counts visible, drill-down gated.

5. **Andromeda score impact:** confirmed out of scope for v1 per scope statement. Revisit after 30 days of false-positive data.

---

## 13. Hand-off notes for Claude Code

- All new code paths must follow existing AtlasV2 patterns documented in `CLAUDE.md`:
  - Express handlers in `backend/src/api/routes/`
  - Services in `backend/src/services/`
  - Bull jobs use Render-managed Redis (service `red-d7vpjnr7uimc73evp8lg`)
  - Encryption via `@noble/ciphers` AES-256-GCM
  - Zod validation on every route
  - RLS on every new table via `organization_id = (select organization_id from profiles where id = auth.uid())`
  - Frontend: Vite + React 19, Zustand stores, shadcn/ui components, `<PlanGate>` wrapper
  - Model: `claude-sonnet-4-6` for any LLM-assisted classification (none in v1)

- Migration file naming: follow `20260XXX_NNN_implementation_health.sql` convention used by existing migrations. Wrap optional `ALTER TABLE` in `DO $$ IF EXISTS ... END $$` guards.

- Append new rule objects to `validation-rules.ts` `ALL_VALIDATION_RULES` array in declaration order, grouped by layer with a section comment matching the existing style.

- Append new interpretation entries to `rule-interpretations.ts` `RULE_INTERPRETATIONS` map.

- For the new `'skipped'` status value: extend `ValidationResult` type, update `generateBusinessSummary` and `determineOverallStatus` to ignore skipped rules in counts.

- No PII in queue payloads. No decrypted credentials in logs. Standard hygiene.
