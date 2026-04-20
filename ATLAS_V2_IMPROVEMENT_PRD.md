# Atlas V2 — Improvement PRD
**For:** Claude Code
**Repo:** `AtlasV2` (branch `claude/atlas-planning-sprint-KQi7C` or new `claude/atlas-v2-improvements`)
**Owner:** Vikram Jeet Singh
**Date:** 2026-04-20

---

## 1. Goal

Close six gaps identified in the architectural review. Deliver in sequenced sprints, marketer-visible impact first.

## 2. In scope

1. Language rewrite (copy + component labels)
2. GA4-only output mode (drop WalkerOS)
3. CAPI adapter contract
4. Google adapter split + gclid/gbraid/wbraid capture + OAuth lifecycle
5. Consent Mode v2 in generated tags and CAPI payloads
6. Golden samples + CI contract tests

## 3. Out of scope

- WalkerOS integration (removed, not deprecated — full deletion)
- Crawl Signal Extractor, Data Quality Monitor, Auto-insight Reporter (separate PRDs, future)
- New billing tiers or pricing changes
- TikTok / LinkedIn adapter completion (stubs stay stubs)

## 4. Sequencing

| Sprint | Scope | Estimate |
|---|---|---|
| S1 | Language rewrite + Next Action card + mandatory Strategy Gate | 1 week |
| S2 | GA4-only generators, drop WalkerOS | 2 weeks |
| S3 | CAPI adapter contract + Meta fixes | 1 week |
| S4 | Google adapter split + OAuth lifecycle | 1 week |
| S5 | Consent Mode v2 in generated tags + CAPI payloads | 1 week |
| S6 | Golden samples + CI contract tests | 1 week |

Total: 7 weeks.

---

# Sprint 1 — Language rewrite + Next Action + mandatory Strategy Gate

## 1.1 Language rewrite

**Deliverable:** every user-facing string replaced. No engineer jargon surfaces to the marketer.

**Canonical replacement map** — apply repo-wide to `frontend/src/**/*.tsx` and `*.ts`:

| Old | New |
|---|---|
| WalkerOS event spec | Tracking plan |
| GTM container JSON | Google Tag Manager setup file |
| Validation Engine | Tracking health check |
| 26 validation rules | Tracking health check (26 checks) |
| CONFIRM | Keep current event |
| AUGMENT | Add proxy event |
| REPLACE | Switch conversion event |
| EMQ monitoring | Meta match quality |
| Event Match Quality | Match quality |
| Readiness Score | Setup completeness |
| Signal Library | Event catalogue |
| Signal Packs | Tracking kits |
| Composable Packs | Ready-made tracking kits |
| Deployment Wizard | Go-live checklist |
| Channel Insights diagnostic | Channel leak report |
| PII detection | Privacy risk check |
| Data Layer Spec | Developer handoff doc |
| Journey Builder | Customer journey mapper |
| AI Planning Mode | Site scan |
| Audit Engine | Live site check |
| Readiness dimensions | Setup steps |

**Acceptance:**
- Grep for each left-column term across `frontend/src/` returns zero matches in user-facing strings (comments / variable names may remain).
- Page titles, button labels, toast messages, empty states, error messages all use the new vocabulary.
- One QA pass: read every page aloud. If it sounds like docs, rewrite.

## 1.2 Single Atlas Score model

Replace four parallel scores with one composite.

**New shape:**
```ts
type AtlasScore = {
  overall: number;        // 0-100
  foundation: number;     // strategy locked + consent live + GTM deployed
  signal_quality: number; // tracking health check results + match quality
  channel_performance: number; // channel leak report
  updated_at: string;
}
```

- New endpoint: `GET /api/dashboard/atlas-score`
- Collapse existing `readinessApi` and `healthApi` into this. Keep the old endpoints as thin wrappers during migration; remove in S6.
- Frontend: `OverallScoreRing` becomes `AtlasScoreRing`, shows `overall` + three sub-scores as bars.

## 1.3 Next Action card

Dashboard becomes a single dominant card plus secondary widgets.

**Component:** `frontend/src/components/dashboard/NextActionCard.tsx`

**Priority ladder** (first match wins):

| Trigger | Action copy | CTA | ETA |
|---|---|---|---|
| No strategy brief for active client | "Lock your conversion event" | → `/planning/strategy` | 3 min |
| Site not scanned in 30 days | "Rescan your site" | → `/planning` | 5 min |
| Critical tracking gap in last check | "Fix missing {eventName} event" | → developer handoff | hand to dev |
| Meta match quality < 6.0 | "Improve Meta match quality" | → `/capi` | 15 min |
| Consent Mode v2 not active | "Turn on Consent Mode v2" | → `/consent` | 10 min |
| GTM file generated but not deployed | "Deploy your GTM file" | → go-live checklist | 20 min |
| All green | "Run this week's tracking check" | → `/audit/start` | 2 min |

**Acceptance:**
- Endpoint `GET /api/dashboard/next-action` returns `{ action_id, copy, cta_route, eta_minutes, priority }`.
- Unit tests cover every branch of the priority ladder.
- Card renders one action. No fallback list.

## 1.4 Mandatory Strategy Gate

Strategy Gate stops being a dismissible banner. It becomes a hard gate on any spec-generating action.

**Changes:**
- Remove `localStorage` dismissal logic from `StrategyGateBanner`.
- `projects.phase_data` gets a new field `strategy_brief_id` (nullable FK to new `strategy_briefs` table).
- Backend: `POST /api/planning/sessions` rejects with 400 if `strategy_brief_id` not set on the project. Error message: `"Lock your conversion event first."`
- Backend: `POST /api/journeys` and `POST /api/signals/deploy` same guard.
- Frontend: wrap gated routes in `<StrategyGateGuard>` component that redirects to `/planning/strategy` if no brief exists.

**New table:**
```sql
-- supabase/migrations/20260420_001_strategy_briefs.sql
CREATE TABLE strategy_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  business_outcome TEXT NOT NULL,
  outcome_timing_days INTEGER NOT NULL,
  current_event TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('keep','add_proxy','switch')),
  proxy_event TEXT,
  rationale TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strategy_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_briefs_org ON strategy_briefs
  USING (organization_id IN (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  ));

ALTER TABLE projects ADD COLUMN strategy_brief_id UUID REFERENCES strategy_briefs(id);
```

**Acceptance:**
- Attempting to run a scan without a brief returns 400 with the exact error copy above.
- `StrategyGateBanner` removed or repurposed as a passive "Your locked event: X" display.
- V2 backlog item "persist briefs to Supabase" marked complete.

---

# Sprint 2 — GA4-only output mode, drop WalkerOS

## 2.1 Deletions

Remove WalkerOS end-to-end:
- `backend/src/services/planning/generators/` — delete any `walkeros-*.ts`
- Remove WalkerOS fields from `planning_sessions`, `signals`, `journeys` tables (migration)
- Remove WalkerOS copy, docs, toggles from frontend
- Remove WalkerOS validation rules from the 26-rule set (keep rule count current in UI copy — if net count is 22, say 22)
- Remove npm deps: `@elbwalker/*` if present

## 2.2 GA4-native generators

**New generators in `backend/src/services/planning/generators/`:**

- `ga4DataLayerSpec.ts` — emits standard GA4 recommended events (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `generate_lead`, `sign_up`, `login`, custom events for project type).
- `gtmContainerGa4.ts` — emits GTM container JSON with:
  - GA4 Configuration tag (measurement ID from project config)
  - GA4 Event tags for every event in the tracking plan
  - DataLayer Variable for every event parameter
  - Consent Mode v2 default + update tags (see S5)
  - Custom Event triggers matching dataLayer event names
- `developerHandoffDoc.ts` — replaces old implementation guide. Markdown export, plain English, code snippets, screenshots where possible.

**Output contract shape:**
```ts
type TrackingPlan = {
  version: number;
  project_id: string;
  ga4_measurement_id: string | null;
  events: Array<{
    name: string;                    // GA4 recommended or snake_case custom
    trigger_description: string;     // plain English, for marketer
    parameters: Array<{
      name: string;
      type: 'string'|'number'|'boolean'|'array'|'object';
      required: boolean;
      example_value: string;
      privacy_risk: 'none'|'low'|'high';
    }>;
    funnel_stage: 'awareness'|'consideration'|'conversion'|'retention';
    platforms: Array<'ga4'|'meta'|'google_ads'|'linkedin'|'tiktok'>;
  }>;
  consent_mode_v2: {
    default_state: Record<string,'granted'|'denied'>;
    region_overrides: Array<{region:string; state:Record<string,'granted'|'denied'>}>;
  };
}
```

## 2.3 GTM schema validation

**New module:** `backend/src/services/planning/generators/gtmSchemaValidator.ts`

- Validates generated container against GTM import schema (`accountId`, `containerId`, `exportFormatVersion`, `containerVersion.tag[]`, `trigger[]`, `variable[]` shapes)
- Rejects export if invalid
- Frontend: download button disabled until validator returns `{valid: true}`. Show validation errors inline.

## 2.4 GTM merge / diff

**New endpoint:** `POST /api/planning/gtm/merge`

- Input: generated container + user-uploaded existing container
- Output: merge preview with tags grouped as `will_add`, `will_overwrite`, `untouched`
- Per-overwrite toggle `keep_existing | use_atlas`
- `POST /api/planning/gtm/export` accepts merge decisions and returns final container

## 2.5 Spec versioning

**New table:**
```sql
CREATE TABLE tracking_plan_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  spec JSONB NOT NULL,
  diff_from_previous JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, version_no)
);
```

- Rescan creates a new version + diff
- Frontend: version picker + diff viewer (`events added / changed / removed`)
- GTM filename format: `atlas-{client_slug}-v{version}.json`

**Sprint 2 acceptance:**
- No WalkerOS references in repo (grep `walkeros` returns zero matches outside migration history).
- Fresh scan on a Shopify demo site produces a valid GA4 dataLayer spec and a GTM container that imports cleanly into a real GTM account (manual QA).
- Merge flow correctly preserves user tags marked `keep_existing`.

---

# Sprint 3 — CAPI adapter contract + Meta fixes

## 3.1 Adapter contract

**File:** `frontend/src/lib/capi/adapters/types.ts` (extend existing)

```ts
export interface CAPIProviderAdapter {
  name: 'meta'|'google_ec_web'|'google_ec_leads'|'google_offline'|'tiktok'|'linkedin';

  // Required for every adapter
  requiredUserParams: string[];
  optionalUserParams: string[];
  dedupStrategy: {
    key: string[];                    // field names to concatenate for dedup hash
    window_seconds: number;
  };
  retryPolicy: {
    max_attempts: number;
    backoff: 'exponential'|'linear';
    base_ms: number;
  };
  consentSignals: string[];           // Consent Mode v2 fields the adapter reads
  testMode: {
    supported: boolean;
    credentialField: string | null;   // e.g. 'test_event_code' for Meta
  };

  // Lifecycle
  validateCredentials(creds: ProviderCredentials): Promise<ValidationResult>;
  buildPayload(
    event: CAPIEvent,
    creds: ProviderCredentials,
    consent: ConsentState
  ): ProviderPayload;
  validatePayload(payload: ProviderPayload): ValidationResult;
  send(payload: ProviderPayload, creds: ProviderCredentials): Promise<SendResult>;
  computeMatchQuality(payload: ProviderPayload): number; // 0-10
}
```

**Contract test suite:** `backend/src/services/capi/__tests__/adapter-contract.test.ts`
- Every adapter imported and asserted against the interface
- Fixture events run through each adapter
- Build, validate, send (mocked) paths covered

## 3.2 Meta adapter fixes

**File:** `frontend/src/lib/capi/adapters/meta.ts`

Changes:

1. **event_id required on every event**
   - Adapter auto-generates UUID if caller omits
   - Generated client-side snippet in GTM export also writes `event_id` to dataLayer on browser pixel events — same ID, so dedup works

2. **fbc / fbp capture**
   - Generated dataLayer snippet (part of GTM export) reads `_fbc` and `_fbp` cookies on page load
   - Backend ingest accepts `fbc` and `fbp` in every event payload
   - Adapter passes them in `user_data`

3. **Test Event Code**
   - Add field `test_event_code` to Meta provider credentials
   - When populated, adapter includes it in payload → events go to Events Manager test view
   - UI: "Test mode" toggle in provider setup, with field for code

4. **Data Processing Options**
   - Provider credentials schema additions:
     ```ts
     data_processing_options: string[];   // default []
     data_processing_options_country: number;
     data_processing_options_state: number;
     ```
   - UI: Privacy settings section in Meta setup wizard

5. **external_id required**
   - Payload validator rejects events without `external_id` (with helpful error)
   - If project has no user auth, fall back to hashed email as external_id
   - Document in wizard copy

6. **User parameter completeness validator**
   - `validatePayload` warns if `< 6` user params present
   - Warns if any of: `em, ph, fn, ln, ct, st, zp, country, ge, db, external_id, client_ip_address, client_user_agent, fbc, fbp` missing where reasonably available

**Sprint 3 acceptance:**
- Contract test suite passes for Meta, Google stubs, TikTok stub, LinkedIn stub
- Meta adapter `computeMatchQuality` returns a score that correlates with Meta's published EMQ rubric (verified against at least 3 golden sample payloads)
- Test Event Code flow verified against a real Meta pixel in test mode

---

# Sprint 4 — Google adapter split + OAuth lifecycle

## 4.1 Split into three named adapters

Replace current `google` and `google-offline` with three:

| Adapter | File | Use case |
|---|---|---|
| `google_ec_web` | `adapters/google-ec-web.ts` | Enhanced Conversions for Web via gtag/GTM. No server upload — adapter generates the tag config. |
| `google_ec_leads` | `adapters/google-ec-leads.ts` | Offline lead matching via `UploadClickConversions` with `user_identifiers`. |
| `google_offline` | `adapters/google-offline.ts` | Offline sales tied to `gclid` via `UploadClickConversions`. |

Setup wizard UI: marketer picks use case in plain English. Adapter is inferred.

Decision tree copy:
- "Are you tracking a web conversion?" → Yes → `google_ec_web`
- "Do you have gclid from the original click?" → Yes → `google_offline`
- "Matching offline leads by email/phone?" → Yes → `google_ec_leads`

## 4.2 Required captures

Generated client-side snippet (shipped in GTM export from S2) must capture:

- `gclid` — from URL param on landing, write to first-party cookie with 90-day TTL
- `gbraid` — same
- `wbraid` — same
- Persist across sessions via cookie
- Push into dataLayer on every event

Backend ingest validates presence where applicable. Adapters include them in uploads.

## 4.3 Consent Mode v2 in Google payloads

Every Google upload must include the `consent` field:
```ts
consent: {
  ad_user_data: 'GRANTED'|'DENIED';
  ad_personalization: 'GRANTED'|'DENIED';
}
```

Sourced from the consent state captured at event time (from `consent_records` table).

## 4.4 OAuth lifecycle

**Credentials schema for Google adapters:**
```ts
type GoogleAdsCreds = {
  developer_token: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token: string;
  access_token_expires_at: string;
  customer_id: string;           // required
  login_customer_id: string;     // required if MCC account
}
```

**Token refresh worker:**
- New Bull job `google-oauth-refresh`, scheduled every 30 min
- For each provider with `access_token_expires_at < NOW() + 10 min`, refresh via Google OAuth
- On refresh failure: mark provider `status = 'reconnect_required'`, emit notification
- Reconnect button in UI kicks user into OAuth flow

**Sprint 4 acceptance:**
- Setup wizard routes marketer to correct adapter based on their answers
- A GA4 GTM export from S2 captures `gclid`, `gbraid`, `wbraid` in real tests
- OAuth refresh runs in a scheduled job and updates `access_token_expires_at`
- Reconnect flow verified end-to-end

---

# Sprint 5 — Consent Mode v2 in generated tags and CAPI payloads

## 5.1 Single source of truth

Consent Mode v2 config lives in one place: `consent_configs.gcm_mapping`.

All of these consume it:
- Generated GTM container (default consent tag + per-tag firing rules)
- Generated client-side consent banner (already exists)
- CAPI adapters (Meta: maps to `data_processing_options`; Google: maps to `consent` object)

## 5.2 Generated GTM changes

`gtmContainerGa4.ts` must emit:

1. **Default consent state tag** — `Consent Initialization` template, fires before all tags, sets defaults from `consent_configs.gcm_mapping.default_state`
2. **Consent update tag** — fires on consent banner interaction, updates state
3. **Region overrides** — one default consent tag per region override entry
4. **Per-tag consent settings** — every GA4 and conversion tag carries:
   - `Additional consent checks: Require additional consent for tag to fire`
   - Mapped consent types (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`)

## 5.3 CAPI payload changes

- Meta adapter: read consent state from event's linked `consent_record`, map `ad_user_data=DENIED` → add `"LDU"` to `data_processing_options` (Limited Data Use), set `data_processing_options_country=0`, `data_processing_options_state=0` for automatic geolocation
- Google adapters: pass `consent.ad_user_data` and `consent.ad_personalization` in every upload

## 5.4 Enforcement

- Events arriving at CAPI pipeline without a consent record → rejected with status `consent_missing`, logged to `capi_event_queue` with error
- No silent drop. No default-grant fallback.

**Sprint 5 acceptance:**
- Generated GTM container passes Google Tag Assistant "Consent Mode configured" check
- Meta adapter includes LDU correctly when consent denied (verified via test event code)
- Google adapter rejects payload builder call if consent state missing

---

# Sprint 6 — Golden samples + CI contract tests

## 6.1 Directory structure

```
contracts/
  generators/
    tracking-plan.schema.json
    gtm-container-ga4.schema.json
  adapters/
    meta-capi.schema.json
    google-ec-web.schema.json
    google-ec-leads.schema.json
    google-offline.schema.json

golden-samples/
  ecommerce-shopify/
    inputs/
      site-scan.json
      strategy-brief.json
      consent-config.json
    expected/
      tracking-plan.json
      gtm-container.json
      developer-handoff.md
      meta-capi-payload.json
      google-ec-web-tag.json
  lead-gen-saas/
    inputs/ ...
    expected/ ...
  publisher-content/
    inputs/ ...
    expected/ ...
```

Minimum 3 project types. Each with complete inputs and expected outputs.

## 6.2 Contract tests

**File:** `backend/src/__tests__/golden-samples.test.ts`

For each sample:
1. Feed inputs into generators
2. Diff output against `expected/`
3. Fail test on any deviation

For each adapter:
1. Build payload from fixture event
2. Diff against expected payload JSON
3. Run `validatePayload` — assert `valid: true`

## 6.3 CI integration

- GitHub Actions workflow: run on every PR
- Fails the build on any sample drift
- Intentional output changes require: update golden sample + explanation in PR description

**Sprint 6 acceptance:**
- `npm test` runs all golden-sample tests in < 30s
- CI blocks merge on failed contract tests
- Three project-type samples committed and passing

---

## 5. Migrations summary

New migrations to create in `supabase/migrations/` (sequenced by sprint):

```
20260420_001_strategy_briefs.sql                 (S1)
20260420_002_project_strategy_brief_fk.sql       (S1)
20260427_001_drop_walkeros_fields.sql            (S2)
20260427_002_tracking_plan_versions.sql          (S2)
20260511_001_capi_provider_credentials_v2.sql    (S3) — adds test_event_code, DPO fields for Meta
20260518_001_google_oauth_fields.sql             (S4) — adds access_token, expires_at, login_customer_id
```

Every migration includes RLS policies. Every table scoped by `organization_id`.

## 6. Cross-cutting rules (applies to all sprints)

1. **Zero PII in Redis queue payloads.** Realtime CAPI ingest must hash in the request handler before enqueuing. Document this explicitly in `backend/src/services/capi/pipeline.ts` with a code comment linking to this PRD.
2. **Zod validation** on every new route.
3. **Error boundary** on every new page.
4. **PlanGate** on new routes as appropriate — Strategy Gate stays available on all plans, CAPI provider CRUD stays `pro+`, Consent Hub stays `pro+`.
5. **No user-facing engineer jargon** — after S1, any new copy must pass the same vocabulary test.
6. **TypeScript strict passes.** No unused imports.
7. **Every new endpoint returns `{ data, error, message }`.**
8. **Super admin bypasses all plan gates. Never bypasses consent or credential encryption.**

## 7. Risks and open questions

| Risk | Mitigation |
|---|---|
| Dropping WalkerOS breaks any existing customer projects | Pre-S2: query Supabase for active WalkerOS usage. If any, write a one-time migration script that converts WalkerOS specs to GA4 specs. |
| Google OAuth refresh failures silently break CAPI | Monitor `status='reconnect_required'` providers. Weekly alert to org owner. |
| Golden samples drift on every intentional schema change | Accept it. Drift detection is the feature, not a bug. |
| Language rewrite misses long-tail strings | Grep audit + manual read-aloud pass + ship a feedback widget for customers to flag confusing copy. |

## 8. Definition of done

- All six sprints merged to `main`
- Golden samples green in CI
- Fresh onboarding: new user signs up → forced through Strategy Gate → completes site scan → downloads valid GTM file → Meta provider configured with Test Event Code → sends test event → sees it in Events Manager. End-to-end, no dev handholding.
- Marketer-readability: hand the app to someone with zero tracking vocabulary. They can complete the onboarding flow.

---

**End of PRD.**
