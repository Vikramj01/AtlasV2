# Atlas PRD · Google Tag Gateway (honest status, first-party-aware detection, verified probing, generated configuration)

**Target path in repo:** `docs/prd/google-tag-gateway.md`
**Status:** Draft · Sprint 0 not started
**Owner:** Vikram
**Date:** 2026-11-08
**Depends on:** `scoreEngine.ts` (`fetchGTGActive`, `computeOverallScore`), `api/routes/dataManager.ts` (`computeNeedsAction`), `services/dqm/gtgProbe.ts` + `dqmOrchestrator.ts` + `dqmAlertEvaluator.ts`, `dqm_gtg_checks`, `client_platforms` (sGTM verification pattern from `20260831002`), `siteDetectionService.ts`, `pageCaptureService.ts`, `quickCheckService.ts`, `audit/dataCapture.ts`, `audit/siteSetupDetector.ts`, `audit/gapClassifier.ts`, `google/googleTagTopology.ts`, `validation/register/L1.ts` + `platformDetection.ts` + `signalConsistency.ts`, `planning/generators/dataLayerSpecGenerator.ts`, `journey/generators/gtmDataLayer.ts`, `Step2_6GTGPreflight.tsx`, `KeyMetricsRow.tsx`, `DQMStatusPanel.tsx`, `DataManagerConsolePage.tsx`, CSE (`crawl_runs`, `crawl_pages`, `detected_signals`), Google Tag Topology PRD (`docs/prd/google-tag-topology.md`), L11 Reconciliation

**Primary source:** Google for Developers, "Set up Google tag gateway for advertisers" (`developers.google.com/tag-platform/tag-manager/gateway/setup-guide`), last updated 2026-11-06. Re-fetch before each sprint; this page is changing.

---

## 0. Summary

Google tag gateway for advertisers (GTG) serves the Google tag or GTM container from a reserved path on the advertiser's own domain (for example `/metrics/`). The advertiser's CDN or load balancer routes that path to `{TAG-ID}.fps.goog`, overrides the Host header, and forwards visitor location in headers. Some measurement hits then also travel through the first-party path instead of going to Google domains directly.

Atlas has GTG-labelled features, but the 2026-11-08 repo review found they do not measure GTG. Atlas's detection layer also assumes Google tags are always loaded from Google hostnames, so a client who deploys GTG correctly starts to look broken to Atlas.

This PRD does five things, in priority order:

1. **Make GTG status honest.** `gtg_active` stops meaning "has a GTM connection" and starts meaning "GTG verified on this client's domain".
2. **Make detection first-party aware.** One shared Google endpoint matcher is used by every detector, so GTG sites stop producing false "not detected" and "base tag missing" findings, and topology detection keeps working.
3. **Probe the client's real path.** Per client, using Google's own `/healthy` and `?validate_geo=healthy` checks.
4. **Generate, don't advise.** GTG-aware install snippets and CDN configuration prefilled with the client's tag IDs and path, and a rewritten Journey Builder step.
5. **Measure uplift, don't assert it.** A before/after comparison through reconciliation, replacing the hard-coded "~11%" claim.

---

## 1. Context and problem

### 1.1 How GTG works (from the primary source)

- One reserved path per GTM container or per standalone Google tag. A single GTM container path covers every tag inside that container. Standalone tags outside a container each need their own path.
- Path rules: not already in use on the domain, not `/`, at most 100 characters. **The path reroutes all traffic under it**, so a collision breaks part of the site.
- Origin: `{TAG-ID}.fps.goog` (Cloudflare and Fastly variants route to `fps.goog` and pass the tag ID in `X-Gtg-Tag-Id`).
- Required forwarding: Host header override to the origin; all cookies and query strings; visitor location as either `X-Forwarded-CountryRegion` (ISO 3166-2, e.g. `US-CA`) or `X-Forwarded-Country` + `X-Forwarded-Region`. `X-Forwarded-CountryRegion` wins if both are sent. Optional `X-Forwarded-Geolocation` (`latlong=…;city=…`).
- Supported routes documented: Google Cloud external Application Load Balancer, Cloudflare Snippets (Pro plan and above), Akamai Property Manager + EdgeScape, Amazon CloudFront, Fastly, and a generic "other" recipe.
- Page change: the GTM snippet `src` becomes `'/metrics/?id='+i+dl`; the gtag snippet `src` becomes `/metrics/`. `<noscript>` is not supported and stays on `www.googletagmanager.com`.
- Verification: `https://{domain}/{path}/healthy` returns `ok`; `https://{domain}/{path}/?validate_geo=healthy` returns `ok` only if location headers arrive.
- Tag Assistant: hits should show as routed to the reserved path.

### 1.2 Claims we rely on versus claims we do not

| Claim | Status |
|---|---|
| Path, origin, header and verification mechanics in §1.1 | Primary source, relied on |
| "Some measurement requests" go through the first-party path | Primary source, but *which* ones is unspecified. Sprint 0 must observe this on live GTG sites rather than assume all GA4 and Ads hits move |
| GTG delivers "~11% signal uplift" | Google's own marketing figure, not Atlas evidence. Must not appear in Atlas UI as a fact (see §5) |
| GTG reduces ITP cookie restrictions | Plausible mechanism, not measured by Atlas. Phrase as Google's stated rationale only |

### 1.3 Defects found in Atlas (repo review, 2026-11-08)

**Defect 1 · `gtg_active` measures the wrong thing.** `fetchGTGActive()` (`scoreEngine.ts` L89–96) and the Data Manager Console (`dataManager.ts` L57) return true when any `gtm_container_connections` row exists. A GTM OAuth connection is reported as "GTG deployed". Downstream:
- `computeOverallScore()` caps the health score at 85 when false (L228).
- `KeyMetricsRow.tsx` L143–146 shows "GTG Status: Active · +11% signal uplift".
- `computeNeedsAction()` raises `gtg_not_deployed`, which flows into the Console and its CSV export.

Result: false positives (connected GTM, no gateway) and false negatives (real GTG, no OAuth connection).

**Defect 2 · The DQM probe checks Google, not the client.** `gtgProbe.ts` sends HEAD to `https://www.googletagmanager.com/gtag/js?id={container_id}`. The code comment says the client domain is not stored. `dqm_gtg` alerts therefore track Google's CDN uptime and can never detect a broken client path. The probe is also org-level (one connection per org, `limit(1)`), a gap already noted in `20260831002`.

**Defect 3 · The preflight guidance is outdated.** `Step2_6GTGPreflight.tsx` tells users to proxy `/gtag/js` from `googletagmanager.com` through Workers or EdgeWorkers. The current method is a reserved path to `{TAG-ID}.fps.goog` with Host override and location headers. CloudFront is missing. The status line is hard-coded to "Not yet detected". "GTG is deployed · continue" is unverified self-report stored as `gtg_preflight_dismissed`.

**Defect 4 · Detection matches Google by hostname.** On a GTG site, `googletagmanager.com` disappears from script URLs and some hits move to the client's domain. Every detector below keys on Google hostnames:

| File | Behaviour on a GTG site |
|---|---|
| `planning/siteDetectionService.ts` L171–177 | GTM and GA4 "not detected"; Planning Mode may recommend installing GTM on a site that has it |
| `planning/pageCaptureService.ts` L251 | GTM container ID not captured |
| `developer/quickCheckService.ts` L141–149 | GTM and Google tags "not found" |
| `audit/gapClassifier.ts` L219 | `gtmLoaded` false, so the GTM-mediated base-tag route fails and false "base tag missing" findings are raised |
| `google/googleTagTopology.ts` (`GTAG_JS`, `destinationOfHit`) | `loaded_tag_ids` empty; if hits move first-party, `destination_ids` empty too. Topology verdict silently degrades to `UNKNOWN` |
| `validation/register/L1.ts` L409, `platformDetection.ts` L41, `signalConsistency.ts` L138 | `GOOGLE_ADS_AW_ID_PRESENT` fails; consistency checks may report a contradiction |
| `audit/dataCapture.ts` `TRACKED_URL_PATTERNS` | Probably still captures hits if they keep `/g/collect` (unverified), but misses the first-party script loads |
| `audit/siteSetupDetector.ts` heuristic 2 | Any same-site `/g/collect` is labelled `firstparty_measurement_protocol_shape`, so GTG is misread as possible sGTM |

**Defect 5 · Atlas snippets would revert GTG.** `dataLayerSpecGenerator.ts` L138–142 and `journey/generators/gtmDataLayer.ts` L166–171 always emit the standard `googletagmanager.com` snippet. A developer pasting Atlas's handoff on a GTG client undoes the gateway.

**Defect 6 · The 85 cap ignores applicability.** It penalises clients for whom GTG is impractical (Shopify-hosted stores with no CDN in front, sites with no path-routing capability) or partly redundant (custom-domain sGTM already serving the container).

---

## 2. Non-goals

- Atlas does not change a client's CDN, DNS or load balancer configuration. It generates configuration and verifies it.
- Atlas does not proxy GTG traffic itself or host the reserved path.
- No support for Google's "In-UI" automatic setup flow beyond detecting and verifying its result (see Sprint 0 D3).
- No change to server-side GTM routing generation (still deferred per `20260831002`). This PRD only stops GTG and sGTM being confused with each other.
- No claim of a universal uplift figure, from Google or Atlas.

---

## 3. Open decisions · resolve in Sprint 0

| # | Decision | Default if unresolved |
|---|---|---|
| D1 | Should the 85 cap survive at all, or become a recommendation-only finding? | Keep the cap, but only when GTG is `applicable` (§5.2) and `not_detected`; never apply it on `unknown` |
| D2 | Where do GTG endpoints live: new table, or `client_platforms` rows with `platform='gtg'` like sGTM? | New table `client_gtg_endpoints` (§6.1). One client can have several paths, which `client_platforms`' one-row-per-platform shape does not fit |
| D3 | How does Google's In-UI / Cloudflare automatic setup differ (path naming, headers)? | Treat as unknown; detection is shape-based (§4) so it should still work; verify in Sprint 0 |
| D4 | Does `docs/.../gateway/legacy-setups` describe the old `/gtag/js` proxy pattern Atlas currently teaches? If so, do we detect legacy setups as GTG, or flag them for migration? | Detect as `gtg_legacy`, raise an info finding recommending migration |
| D5 | Plan gating for generated CDN configuration | Same tier as Journey Builder; verification and probing on all tiers |

---

## 4. Core concept · the Google endpoint matcher

### 4.1 One matcher, used everywhere

New pure module `backend/src/services/google/googleEndpointMatcher.ts` (no I/O). It replaces every hostname check listed in §1.3 defect 4.

```ts
type GoogleRequestKind =
  | 'gtm_container_load'   // gtm.js, any origin
  | 'google_tag_load'      // gtag/js, any origin
  | 'ga4_hit'              // /g/collect, /mp/collect
  | 'ads_hit'              // /pagead/(1p-)?(conversion|viewthroughconversion|user-list)/
  | 'other';

type GoogleTransport =
  | 'google_direct'        // Google-owned hostname
  | 'gtg'                  // same-site host, reserved path, no sGTM signature
  | 'sgtm'                 // known sGTM endpoint for this client, or sGTM signature
  | 'unknown_first_party'; // same-site but cannot tell GTG from sGTM

interface ClassifiedGoogleRequest {
  kind: GoogleRequestKind;
  transport: GoogleTransport;
  tagId: string | null;       // GTM-/G-/AW-/GT-/DC- from id= / tid= / path
  reservedPath: string | null; // e.g. '/metrics' when transport = 'gtg'
}

classifyGoogleRequest(url: string, ctx: {
  siteHostname: string;
  knownGtgPaths?: string[];     // from client_gtg_endpoints
  knownSgtmOrigins?: string[];  // from verified client_platforms sgtm rows
}): ClassifiedGoogleRequest
```

Rules:

- A same-site URL whose query has `id=GTM-…` or `id=G-|AW-|GT-|DC-…`, or whose path ends in `gtm.js` / `gtag/js`, is a container or tag load regardless of host.
- A same-site URL whose path contains `/g/collect`, `/mp/collect` or a `pagead` conversion pattern is a hit regardless of host.
- Transport decision order: `knownSgtmOrigins` match → `sgtm`; `knownGtgPaths` prefix match → `gtg`; Google hostname → `google_direct`; same-site otherwise → `unknown_first_party`.
- Bare `/metrics/` with no query (the gtag GTG `src`) is ambiguous. Classify as `google_tag_load` only if the response is JavaScript and a Google measurement hit with a tag ID follows from the same path prefix within the capture. Otherwise `other`.
- Interaction with the topology classifier: `googleTagTopology.ts` consumes `ClassifiedGoogleRequest` for both loads and destinations. `googleTagClassifier.ts` (container JSON, by ID prefix) is unchanged.

### 4.2 Callers that switch to the matcher

`siteDetectionService.ts` (HTML regex becomes a script-`src` scan through the matcher), `pageCaptureService.ts`, `quickCheckService.ts`, `gapClassifier.ts`, `googleTagTopology.ts`, `register/L1.ts`, `platformDetection.ts`, `signalConsistency.ts`, `dataCapture.ts` (`shouldCaptureUrl` also accepts any URL the matcher classifies as non-`other`), `siteSetupDetector.ts`.

`siteSetupDetector.ts` heuristic 2 changes: a same-site `/g/collect` with transport `gtg` is no longer evidence of sGTM. `unknown_first_party` keeps today's "possible" labelling, with the explanation widened to "possible sGTM or Google tag gateway".

### 4.3 Fixtures

- A captured GTG site (GTM container through a reserved path), recorded in Sprint 0.
- A captured standalone-gtag GTG site, if one can be found.
- A synthetic site with both GTG and custom-domain sGTM.
- Existing fixtures (`openartAiC9486929.ts`, `pureborn49448510`) must produce identical findings after the switch. This is a regression gate.

---

## 5. Workstream A · Honest status

### 5.1 New GTG status model

Replace the boolean with a per-client status, computed from §6 verification results:

| Status | Meaning |
|---|---|
| `verified` | A registered endpoint passes `/healthy` and `validate_geo` within the last 24 h, and the live page loads the container through it |
| `verified_no_geo` | `/healthy` passes, `validate_geo` fails. Routing works, location headers missing |
| `detected_unverified` | Matcher sees `gtg` or `unknown_first_party` loads in a capture, but no endpoint registered or probed yet |
| `partial` | Some containers or standalone tags route through GTG, others still load from Google |
| `legacy` | Old `/gtag/js` proxy pattern (D4) |
| `broken` | Registered endpoint fails `/healthy` |
| `not_detected` | Recent capture shows `google_direct` loads only |
| `not_applicable` | Operator-declared, or platform known to block path routing (§5.2) |
| `unknown` | No capture yet |

`gtg_active` stays as a column for compatibility and becomes `status IN ('verified','verified_no_geo')`. `fetchGTGActive()` and `dataManager.ts` read it from the new status, never from `gtm_container_connections`.

### 5.2 Applicability

`not_applicable` is set when:
- the operator declares it (with a reason, using existing `declaration_source` semantics), or
- the commerce platform detector reports a hosted platform with no path routing (Shopify without a proxying CDN in front), and no first-party Google traffic is observed.

### 5.3 Score cap and copy

- The cap in `computeOverallScore()` applies only when status is `not_detected` and the client is applicable (D1 default). `unknown` and `not_applicable` never cap. `broken` caps (a broken gateway can cost the container).
- `KeyMetricsRow.tsx`: show the status label. Remove "+11% signal uplift". Replace with "Google reports measurement gains; Atlas measures yours after deployment" until §8 produces a client figure, then show that.
- `Step2_6GTGPreflight.tsx` info card: same treatment of the 11% claim.
- `computeNeedsAction()`: `gtg_not_deployed` only for applicable `not_detected`; new flags `gtg_broken`, `gtg_geo_missing`, `gtg_partial`.

### 5.4 Back-fill

One-off job: recompute status for all clients from their latest CSE run using the matcher. Clients with no capture move to `unknown`, which lifts any cap that was applied only because of the old boolean. Log the before/after distribution; this is useful evidence of how wrong the old flag was.

---

## 6. Workstream B · Endpoint registry and verified probing

### 6.1 Schema · `client_gtg_endpoints`

New migration (next free prefix at build time; latest at review was `20260924001`). Read live constraint state before widening anything, per the `dqm_sgtm` silent CHECK violation lesson.

```sql
client_gtg_endpoints (
  id               uuid pk default gen_random_uuid(),
  org_id           uuid not null,
  client_id        uuid not null references clients(id) on delete cascade,
  hostname         text not null,          -- www.example.com
  reserved_path    text not null,          -- '/metrics' (no trailing slash)
  tag_or_container text not null,          -- GTM-XXXX or G-/AW-/GT- ID
  source           text not null check (source in ('detected','operator_declared','atlas_generated')),
  is_verified      boolean not null default false,
  geo_verified     boolean not null default false,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (client_id, hostname, reserved_path)
)
```

Extend `dqm_gtg_checks`: add `client_id uuid` (nullable for historic rows), `endpoint_id uuid`, `geo_status text check (geo_status in ('pass','fail','skipped'))`. Old rows remain as history but are excluded from status computation.

### 6.2 Discovery

- CSE and Direct Audit captures pass all `ClassifiedGoogleRequest` with transport `gtg` or `unknown_first_party` to an upsert into `client_gtg_endpoints` with `source='detected'`.
- Operators can add or correct an endpoint in client setup (same place sGTM URLs are captured today).

### 6.3 Probe rewrite (`gtgProbe.ts`)

Per endpoint, every DQM run:

1. `GET https://{hostname}{reserved_path}/healthy` → expect 200 and body `ok`.
2. `GET https://{hostname}{reserved_path}/?validate_geo=healthy` → expect 200 and body `ok`.
3. Latency thresholds as today (degraded above 2,000 ms).

Notes:
- The probe origin is Atlas's own server (Render). The geo check therefore validates that the CDN adds location headers for Atlas's request, which is what we want: it proves the CDN rule is in place, not where any visitor is.
- Body must be checked, not only status. A site's catch-all 200 page would otherwise pass.
- Never probe a path the client has not registered or Atlas has not detected.

### 6.4 Alerts

`evaluateGTGAlert()` in `dqmAlertEvaluator.ts`, same open/update/resolve shape as `dqm_sgtm`:
- `broken` → high
- `verified_no_geo` → medium (Google gets the proxy's location instead of the visitor's; silent and common)
- `partial` → low

Per-client severity folds into `getClientSummaries()` via `worstDqmSeverity()`, escalate-only, matching existing conventions.

---

## 7. Workstream C · Generator

### 7.1 GTG-aware install snippets

`dataLayerSpecGenerator.ts` and `journey/generators/gtmDataLayer.ts` take an optional `gtg: { reservedPath }`:
- GTM: `j.src='{reservedPath}/?id='+i+dl;`
- gtag: `<script async src="{reservedPath}/"></script>`
- `<noscript>` stays on `https://www.googletagmanager.com/ns.html`, with a comment explaining why.

When a client's status is `verified`, `verified_no_geo` or `detected_unverified`, generators default to the GTG variant. Handoff docs (`developerHandoffDoc.ts`) state which variant was produced and why.

### 7.2 CDN configuration generation

New `backend/src/services/gtg/cdnConfigGenerator.ts` producing, from `{hostname, reservedPath, tagId}`:

| Target | Output |
|---|---|
| Cloudflare | Snippet code (with `X-Gtg-Tag-Id`, `X-Forwarded-*` headers) and the rule expression; note Pro plan requirement |
| CloudFront | Origin and behaviour settings as a checklist, including precedence, `CachingDisabled`, `AllViewerExceptHostHeader` |
| Fastly | Condition, Host, and the two VCL snippets (`vcl_miss`, `vcl_pass`) |
| Akamai | Property Manager rule and EdgeScape behaviour checklist |
| GCP | Internet NEG backend, custom request headers, routing rule |
| Other | The generic recipe |

All output is generated from templates kept in one file, with the primary source URL and its "last updated" date embedded so drift is visible.

### 7.3 Path selection and collision check

- Default suggestion: a random 5–6 character lowercase alphanumeric path (Google's own suggestion reduces collision risk). Allow readable overrides.
- Before suggesting, check the path against CSE's `crawl_pages` for the client. Any crawled URL under the path blocks it.
- Validate the documented rules: not `/`, max 100 characters.

### 7.4 Journey Builder step rewrite

`Step2_6GTGPreflight.tsx`:
- Status line reads the real §5.1 status.
- CDN tabs add CloudFront and "Other", and render §7.2 output for the client's IDs.
- "GTG is deployed · continue" becomes "Verify now", which runs §6.3 on demand. Pass sets `gtg_preflight_dismissed`. Fail shows which check failed.
- "Skip for now" unchanged.

### 7.5 Interaction with Google Tag Topology

A GTM container needs one reserved path; each standalone Google tag needs its own. Topology split guidance (`google-tag-topology.md` §7.1) must:
- prefer splitting inside the GTM container when the client runs GTG, so no new paths are needed;
- when a split creates new standalone tags outside GTM, list each extra path and its CDN config as part of the remediation.

The split-ready container delta (§7.2 of that PRD) is unaffected.

---

## 8. Workstream D · Uplift measurement

Goal: replace Google's figure with the client's own.

- Record `gtg_went_live_at` per client (first `verified` transition).
- Using L11 reconciliation inputs, compare a fixed window before and after (default 28 days each, excluding 7 days around go-live): GA4 sessions and key events, Google Ads conversions, against backend orders or outcomes where Atlas ingests them.
- Report the ratio change of platform-observed to backend-observed conversions, with the sample sizes. Do not report an uplift below a minimum volume (reuse the sample-size floor convention from the CRM Outcome Integration PRD §7.3) or when other tracking changes landed in the window (`platform_discontinuities`).
- Surface as an AIR insight and in the KeyMetrics tile once available.
- Portfolio: a "GTG coverage and measured uplift" column in the Data Manager Console.

This workstream is deliberately last and may be descoped without affecting A–C.

---

## 9. API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/clients/:id/gtg` | Status, endpoints, latest checks |
| POST | `/api/clients/:id/gtg/endpoints` | Operator add or correct an endpoint |
| POST | `/api/clients/:id/gtg/verify` | On-demand §6.3 probe |
| POST | `/api/clients/:id/gtg/config` | Generate §7.2 config for a CDN target; runs §7.3 collision check |

---

## 10. Sprint plan

| Sprint | Scope | Exit criterion |
|---|---|---|
| 0 | Verification (§13 registry): capture two live GTG sites, read the legacy-setups and In-UI pages, confirm which hits move first-party, confirm the source of the 11% figure. Resolve D1–D5 | Every UNVERIFIED item marked verified or explicitly accepted as a risk |
| 1 | Workstream A · status model, `gtg_active` re-sourcing, score cap, copy changes, back-fill | No UI or score depends on `gtm_container_connections` for GTG |
| 2 | §4 matcher and all callers in §4.2, fixtures | GTG fixture produces no false "not detected" / "base tag missing" / AW-missing findings; existing fixtures unchanged |
| 3 | Workstream B · registry, discovery, probe rewrite, alerts | `dqm_gtg` alerts fire on a deliberately broken test path and on missing location headers |
| 4 | Workstream C · snippets, CDN config, collision check, Journey Builder rewrite, topology guidance update | A test domain configured only from Atlas output passes both Google checks |
| 5 | Workstream D · uplift measurement (optional) | One real client with a reported figure and its sample sizes |

---

## 11. Acceptance criteria

1. A client with a GTM OAuth connection and no gateway shows `not_detected`, not "Active".
2. A client with a working gateway and no GTM connection shows `verified` and is not capped.
3. A client whose CDN routes the path but drops location headers shows `verified_no_geo` and raises a medium alert.
4. On the GTG fixture, Planning Mode detects the GTM container and does not recommend installing GTM.
5. On the GTG fixture, `gapClassifier` raises no base-tag-missing finding for GTM-mediated platforms.
6. On the GTG fixture, topology detection records the loaded tag IDs and attributable destinations.
7. GTG traffic is not labelled as possible sGTM.
8. Atlas-generated snippets for a GTG client use the reserved path and keep `<noscript>` on Google.
9. The path suggester never proposes a path that matches a crawled URL.
10. No Atlas UI states "+11%" or any uplift figure that Atlas did not measure for that client.
11. Backend and frontend typecheck, build and full test suites pass, with only the pre-existing failures documented in CLAUDE.md.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Google changes GTG mechanics (page updated 2026-11-06, a legacy-setups page exists) | Templates embed source date; Sprint 0 and each later sprint re-fetch the page |
| Hits do not move first-party the way we assume | Matcher is shape-based and host-agnostic, so it works whichever hits move; Sprint 0 confirms |
| Bare `/metrics/` gtag `src` is ambiguous | Require a following tagged hit from the same prefix before classifying (§4.1) |
| Probing triggers client WAF or rate limits | Two lightweight GETs per endpoint per run; identify Atlas in User-Agent; back off on 403/429 as DMA polling does |
| Back-fill lifts many score caps at once and looks like a score jump | Announce in changelog; show a "status recomputed" note on affected clients for one cycle |
| Uplift measurement confounded by other changes | Discontinuity exclusion and minimum volume; report "insufficient evidence" rather than a number |

---

## 13. UNVERIFIED registry

| Item | Needed by | How to verify |
|---|---|---|
| Exact URL shapes of first-party hits (does `/g/collect` keep its suffix under the reserved path?) | Sprint 2 | Capture two live GTG sites with Direct Audit |
| Which Google Ads `pagead` requests move first-party | Sprint 2 | Same captures with an Ads conversion triggered |
| Whether bare `/{path}/` gtag loads carry the tag ID anywhere observable | Sprint 2 | Same captures |
| In-UI / automatic Cloudflare setup path and header behaviour | Sprint 2 | Read the "Decide how to setup" page; test if a Cloudflare account is available |
| Legacy setup patterns (`legacy-setups` page) | Sprint 1 (status `legacy`) | Fetch and summarise |
| Source and method behind Google's ~11% figure | Sprint 1 copy | Locate Google's announcement; record as vendor claim regardless |
| Whether `/healthy` and `validate_geo` responses are stable contracts | Sprint 3 | Monitor across Sprint 0 captures; treat body change as `error`, not `fail` |

---

## 14. What this PRD deliberately does not decide

- Pricing or packaging of GTG configuration as a ViMi consulting service.
- Whether Atlas ever offers a managed gateway (Atlas-hosted path) as an alternative for clients without a CDN.
- Any change to sGTM routing generation.
