# Atlas — Features Overview
### Marketing Signal Optimisation & Tracking Infrastructure for Performance Teams

---

## The Problem

Most performance marketing teams spend **40% or more of their time** on tracking setup and maintenance — not strategy.

They're rebuilding the same tag plans for every new client. They're guessing which conversion events to optimise toward. They're discovering tracking failures weeks after they break. And they're missing 20–40% of conversions because browser-only tracking can't survive ad blockers, iOS 17, and consent drop-off.

**Atlas fixes the entire tracking stack** — from strategy alignment, through deployment, to continuous monitoring.

---

## What is Atlas?

Atlas is a **marketing signal optimisation platform** built for performance agencies, consultancies, and in-house marketing teams. It combines AI-powered planning, server-side conversion tracking, and automated health monitoring into a single infrastructure layer that sits across Google Ads, Meta, GA4, GTM, and LinkedIn.

The result: faster client onboarding, higher conversion match quality, and tracking that stays accurate without manual intervention.

---

## The Three Pillars

```
  PLAN IT RIGHT         DEPLOY IT RIGHT        KEEP IT RIGHT
  ─────────────         ───────────────        ─────────────
  Strategy Gate    →    Signal Library    →    Reconciliation
  AI Planning Mode      Realtime CAPI          Health Checks
  Journey Builder       Signal Enrichment      Health Dashboard
                        Customer Match
```

---

## Pillar 1: Plan It Right

### 1. Conversion Strategy Gate

> **"Your conversion event is training the algorithm. Is it training it on the right thing?"**

**The problem:** Teams fire pixels at every button click and wonder why ROAS is unpredictable. The real culprit is optimising toward the wrong event — one that doesn't correlate with actual business outcomes.

**What Atlas does:** Before any tag goes live, the Strategy Gate runs an AI evaluation of your conversion objective. You define the business outcome and the event you're currently using. Atlas (powered by Claude) returns a verdict:

| Verdict | Meaning |
|---|---|
| **CONFIRM** | Your current event is well-matched to the objective — keep it |
| **AUGMENT** | Your event fires too late; add an upstream proxy event for faster feedback |
| **REPLACE** | Your event doesn't correlate with the outcome — switch to a better signal |

For each objective, Atlas recommends:
- **Governance tier** — primary (bid on it), secondary (observe only), or suppression (don't use)
- **Platform action types** — exact settings for Google Ads, Meta, LinkedIn, GA4
- **Proxy event** — for long-cycle B2B (e.g. "demo completed" as the signal for a 14-day SQL cycle)

**Output:** A locked **Strategy Brief** (PDF + web view) that becomes the source of truth for every downstream decision. The brief must be locked before a site scan can begin — strategy first, then implementation.

**Why it matters:** Fixing conversion event alignment is the highest-leverage move in performance marketing. Atlas makes it systematic and auditable.

---

### 2. AI Planning Mode

> **"A complete tracking plan in one session, not two weeks."**

**The problem:** Building a tracking plan requires crawling a site, mapping all meaningful interactions, writing a data layer spec, configuring GTM, and handing off to developers — typically 2–5 days of specialist time per client.

**What Atlas does:** Point Atlas at a URL. It handles the rest.

1. **Browserbase crawl** — visits every key page with a real browser
2. **AI analysis** (Claude) — reviews page structure, interactive elements, forms, and existing tag coverage
3. **Recommendations** — each trackable element gets: event name, confidence score, priority tier (must-have / should-have / nice-to-have), element selector, and business justification
4. **Review workflow** — approve, edit, or reject recommendations one by one; bulk-approve all high-confidence (80%+) suggestions
5. **PII detection** — flags fields that may contain email, phone, or payment data before they reach a tag

**Outputs:**
- **GTM Container JSON** — ready to import directly into Google Tag Manager
- **Data Layer Specification** — human-readable Markdown spec of every event and parameter
- **Implementation Handoff Guide** — JavaScript snippets, GCLID/UTM cookie capture, hidden form fields, CRM field mapping, Enhanced Conversions for Leads guidance, and a QA checklist

**Why it matters:** Compresses weeks of tagging consultancy into a single AI-powered session. Signals flow directly into the Signal Library for reuse across all future clients.

---

### 3. Journey Builder

> **"Give the algorithm a monetary signal at every stage — not just the final sale."**

**The problem:** Ad platforms need value signals to optimise Smart Bidding. Most teams only pass a value at purchase, leaving the algorithm blind to the entire upper and mid funnel.

**What Atlas does:** A guided wizard maps each business stage to:
- **`proxy_value_gbp`** — the estimated monetary value of that stage (e.g. £12 for a qualified lead, £80 for a booked demo)
- **`buyer_intent_level`** — problem_aware / solution_aware / vendor_aware

Supports 6 business types with built-in templates — including a **7-stage B2B Lead Gen template** covering MQL → SQL → Opportunity → Closed Won.

**Output:** GTM container JSON with value and intent metadata baked into every stage event — ready for developer import.

**Why it matters:** Unlocks Target ROAS and value-based Smart Bidding across the full funnel, not just e-commerce checkouts.

---

## Pillar 2: Deploy It Right

### 4. Signal Library & Taxonomy

> **"Build your conversion signals once. Deploy them to every client."**

**The problem:** Every agency rebuilds the same events — purchase, lead, page_view — from scratch for every client engagement. Naming drifts. Platform mappings get lost. Tribal knowledge walks out the door.

**What Atlas does:**
- **System signals** — a curated library of standard events (purchase, generate_lead, begin_checkout, sign_up, etc.) with pre-built platform mappings for Meta, Google, LinkedIn, and GA4
- **Custom signals** — create org-specific events with required/optional parameters and platform mappings
- **Signal Packs** — group signals into templates (e.g. "E-commerce Core Pack", "B2B Lead Gen Pack") and deploy the entire pack to a client in one step
- **Naming conventions** — define org-level casing, prefixes, and separator rules; Atlas validates in real time and previews how existing signals rename

**Output:** Exportable XLSX signal inventory. Per-client deployment wizard with field mapping.

**Why it matters:** Agencies managing 50+ clients can standardise their entire tracking stack from one place. Onboarding a new client goes from hours to minutes.

---

### 5. Realtime CAPI (Conversions API)

> **"Send conversions server-side and recover the 20–40% that browser tracking misses."**

**The problem:** iOS 17 Intelligent Tracking Prevention, ad blockers, and consent drop-off mean browser pixels miss a significant share of conversions. Attribution degrades. Algorithms optimise on incomplete data.

**What Atlas does:** A server-side conversion pipeline that runs parallel to your browser tags:
- **Meta CAPI** — server events with SHA-256 hashed PII and automatic event deduplication
- **Google Enhanced Conversions** — server-side match using hashed email/phone
- **LinkedIn CAPI** — full conversion delivery
- **Consent gating** — events are held until the user's consent state is resolved
- **Deduplication** — event_id matching prevents double-counting browser + server events

**Signal Tracking Dashboard** — live event log with aggregate cards (total volume, match quality score, dedup rate, p95 latency), per-event filters, and async CSV export.

**Why it matters:** Recovering lost conversions is the fastest attribution win available. Atlas handles the server infrastructure, hashing, and dedup logic so teams don't have to.

---

### 6. Signal Enrichment Configuration

> **"More identity data = higher match quality = better attribution."**

**The problem:** A server-side event that arrives without email, phone, or click ID data is nearly useless for attribution. Most CAPI implementations send bare events with minimal matching data.

**What Atlas does:** A configuration layer that maps client data fields (from your dataLayer or CRM) into CAPI payloads:

**Identity mapping** — email, phone, first/last name, postal code, country, external IDs, Facebook click IDs (fbc/fbp), Google click IDs (gclid, wbraid, gbraid), auto-captured IP and user agent

**Signal-level mapping** — event value, currency, deduplication ID (order_id / transaction_id), and product content IDs for dynamic retargeting

**Validation engine** — 12 rules (IDENT_01–05, SIG_01–05, CROSS_01–02) check field resolution and flag gaps before events go live

**Scores & estimates:**

| Metric | What it measures |
|---|---|
| **Enrichment Score (0–100)** | Combined identity + signal completeness |
| **Meta EMQ estimate** | Estimated Event Match Quality (2 / 4 / 6 / 8) |
| **Google match rate estimate** | Estimated match rate (20% / 45% / 65%) |

**Why it matters:** Every point of EMQ improvement lifts Meta's ability to attribute conversions and optimise campaigns. Atlas makes the path to maximum match quality explicit and measurable.

---

### 7. Bid Signal Enricher — Customer Match

> **"Push your first-party audience data to every Google destination in one operation."**

**The problem:** First-party CRM and email lists sit in spreadsheets while Google campaigns run on third-party signals. Audience syncs are manual, slow, and error-prone.

**What Atlas does:** Upload an email/phone list → select up to 3 Google destinations (Google Ads, GA4, DV360, CM360) → push in a single API call. Atlas tracks match rate, record count, and matched count per run.

**Agency Data Manager Console** — for agency plan users, a single dashboard aggregates Customer Match state, match rates, and upload history across every client in one view.

**Why it matters:** Activates first-party data at scale for lookalike modelling, remarketing, and audience suppression. Match-rate telemetry shows which lists are actually landing.

---

## Pillar 3: Keep It Right

### 8. Platform Reconciliation

> **"Find out when your tracking strategy and your live platform config have drifted apart."**

**The problem:** A strategy brief says optimise on "qualified_lead." Three months later, a campaign manager has switched the bidding goal to "contact_form_submit." Nobody notices until ROAS collapses.

**What Atlas does:** A one-click reconciliation run performs a **4-phase automated audit** across Google Ads, Meta, GA4, and GTM:

| Phase | What it checks |
|---|---|
| **Config Diff** | Do platform conversion action settings match the strategy brief? |
| **Alignment Diff** | Are live campaigns optimising on the right primary event? |
| **Delivery Diff** | Are events reaching platforms? Is dedup working? Is EMQ sufficient? |
| **Volume Diff** | Is Atlas-delivered event volume matching platform-recorded volume? |

**Example findings:**
- `WRONG_PRIMARY_CONVERSION` — Campaign is bidding on an event marked as secondary in the brief
- `EMQ_LOW` — Meta Event Match Quality below 6.0; identity enrichment needs improvement
- `CAPI_DEDUP_LOW` — Server + browser dedup rate below 70%; event_id mismatch
- `VOLUME_DELTA_EXCEEDED` — >20% divergence between Atlas delivery and platform receipt

Each finding includes observed vs. expected values, severity (critical / error / warning / info), and plain-English remediation steps. Tolerances are configurable per client and event.

**Why it matters:** Tracking drift is invisible until it's catastrophic. Atlas surfaces it early — with specific, actionable findings — before it damages campaign performance.

---

### 9. Implementation Health Checks

> **"Know exactly which GTM tags are misconfigured before your QA team finds out the hard way."**

**The problem:** GTM containers accumulate years of technical debt. Conflicting tags, missing triggers, stale variables, and drift from the original spec are invisible until something breaks.

**What Atlas does:** Connect your GTM container (OAuth or manual JSON upload) → Atlas runs a rule-based tag audit:
- Signal initiation checks — are the right events firing?
- Parameter completeness — are required fields populated?
- Tag configuration — are triggers, variables, and firing rules correct?
- Drift detection — has anything changed since the last approved baseline?

Crawl Signal Extractor (CSE) runs can be promoted to an **IHC baseline** — so any future change to the live site triggers a drift alert automatically.

Alert preferences per severity level (critical = immediate push, high = daily digest, Slack integration available).

**Why it matters:** Automated container QA replaces manual audits. Baseline + drift detection means implementation regressions get caught at commit time, not at reporting time.

---

### 10. Signal Health Dashboard

> **"One score. One page. Instant visibility across the entire tracking stack."**

**The problem:** Health data is scattered — GTM has its own preview, Meta has EMQ, Google has diagnostics, CAPI has its own logs. There's no single place to see if everything is working.

**What Atlas does:** A composite **Health Score (0–100)** that combines:

| Component | What it measures |
|---|---|
| Signal Health | Event volume and delivery rate |
| Platform Acceptance | Platform-confirmed event receipt rate |
| GTG Path Health | Google Tag Gateway HTTP status and latency |
| DMA Coverage | Customer Match audience coverage |
| Enrichment Quality | Identity + signal enrichment completeness |

Includes a **30-day trend chart**, active **alert feed**, **setup completeness checklist**, and **quick-action cards** (e.g. "Your EMQ is 4 — improve identity mapping" → links directly to enrichment config).

For agencies: a **multi-client selector** surfaces health scores across the entire client book on a single screen.

**Why it matters:** Proactive monitoring replaces reactive firefighting. Agencies know which client needs attention before the client notices.

---

## End-to-End Workflow

```
1. ONBOARD A NEW CLIENT
   ├── Run Conversion Strategy Gate → get AI verdicts on which events to optimise
   ├── Lock Strategy Brief → defines "success" for this engagement
   └── Run AI Planning Mode → generate tracking plan + GTM container in one session

2. DEPLOY TRACKING
   ├── Pull signals from the Signal Library (or save new ones from the planning session)
   ├── Configure Journey Builder → assign proxy values to every funnel stage
   └── Connect platforms (Google Ads, Meta, GA4, GTM via OAuth)

3. ACTIVATE SERVER-SIDE TRACKING
   ├── Set up Realtime CAPI (Meta, Google, LinkedIn)
   ├── Configure Signal Enrichment → map identity and value fields
   └── Push first-party audience to Google via Customer Match

4. MONITOR & MAINTAIN
   ├── Review Signal Health Dashboard daily (composite score + alerts)
   ├── Run Platform Reconciliation weekly → surface drift before it breaks campaigns
   └── Review Implementation Health Check findings → resolve tag config issues

5. OPTIMISE
   ├── Enrichment score guides which identity fields to capture next
   ├── Match rate telemetry shows if CAPI needs tuning
   └── Reconciliation findings drive platform config corrections
```

---

## Who It's For

### Agencies & Consultancies
- Standardise tracking across 50+ clients from a single Signal Library
- Cut client onboarding time with AI Planning Mode
- Prove diligence with PDF strategy briefs, audit trails, and PII detection
- Monitor the entire client portfolio from the Agency Health Console

### In-House Performance Teams
- Stop rebuilding the tracking stack every quarter
- Get AI-assisted tracking plan generation without hiring a specialist
- Recover lost conversions with server-side CAPI — no engineering lift
- Keep tracking accurate as site and platform configs evolve

### SMB & D2C Marketers
- No tracking specialist required — Atlas handles the complexity
- GCLID capture, Enhanced Conversions, and value-based bidding out of the box
- Consent and PII detection built in for privacy compliance
- One health score tells you if your tracking is working

---

## Built for the Modern Privacy Era

- **Consent-first** — every event carries consent state; CAPI events are held until consent resolves
- **PII detection** — AI flags sensitive fields before they reach a tracking tag
- **SHA-256 hashing** — all identity data hashed before transmission to ad platforms
- **Audit trail** — every strategy decision, brief, and finding is versioned and exportable

---

*Atlas is available at [atlas.vimi.digital](https://atlas.vimi.digital)*
