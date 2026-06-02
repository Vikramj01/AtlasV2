# Atlas User Manual

> **Version:** 1.0 — June 2026  
> Atlas is a marketing signal optimisation and tracking infrastructure platform for agencies, consultancies, and SMB marketers. Hosted at atlas.vimi.digital.

---

## Table of Contents

1. [Getting Started](#getting-started)
   - [Account Setup](#account-setup)
   - [Agency Setup](#agency-setup)
2. [Role Guides](#role-guides)
   - [Solo Marketer / In-House](#solo-marketer--in-house-guide)
   - [Agency Admin](#agency-admin-guide)
   - [Developer / Agency Client](#developer--agency-client-guide)
3. [Feature Reference](#feature-reference)
   - [Conversion Strategy Gate](#conversion-strategy-gate)
   - [AI Site Scan](#ai-site-scan-planning-mode)
   - [Journey Builder](#journey-builder)
   - [Signal Library](#signal-library)
   - [Signal Enrichment Configuration](#signal-enrichment-configuration)
   - [Consent Hub](#consent-hub)
   - [Conversion API (CAPI)](#conversion-api-capi)
   - [Offline Conversions](#offline-conversions)
   - [Platform Connections](#platform-connections)
   - [Platform Reconciliation](#platform-reconciliation)
   - [Implementation Health Checks](#implementation-health-checks-ihc)
   - [Bid Signal Enricher](#bid-signal-enricher)
   - [Signal Tracking Dashboard](#signal-tracking-dashboard)
   - [Audit Engine](#audit-engine)
   - [Health Dashboard](#health-dashboard)
   - [Channel Insights](#channel-insights)
   - [Data Quality Monitoring](#data-quality-monitoring-dqm)
   - [Event Taxonomy](#event-taxonomy)
   - [Naming Conventions](#naming-conventions)
4. [Platform Plans](#platform-plans)

---

# Getting Started

---

## Account Setup

This guide covers everything you need to do from the moment you land on Atlas for the first time through to having a fully configured workspace ready to use.

### 1. Sign Up

1. Navigate to the Atlas login page.
2. Enter your email address and a secure password, then click **Sign up**.
3. Check your inbox for a verification email and click the confirmation link.
4. You will be redirected back to Atlas and logged in automatically.

> If you don't receive the verification email within a few minutes, check your spam folder. You can request a new one from the login page.

### 2. Create Your Organisation

On first login, Atlas prompts you to create an organisation. This is your workspace — everything you build in Atlas lives under an organisation.

1. Enter an **Organisation name** (e.g. your company or agency name).
2. Select an **Organisation type**:
   - **Agency** — you manage tracking for multiple clients
   - **In-house / Brand** — you manage tracking for a single business
3. Click **Create organisation**.

You can rename your organisation later from **Team & Settings → Organisation**.

### 3. Choose a Plan

After creating your organisation, Atlas will show you the plan options:

| Plan | Best for |
|---|---|
| **Free** | Individuals exploring Atlas or running basic tracking setups |
| **Pro** | Marketers who need site scanning, CAPI integrations, and platform connections |
| **Agency** | Agencies managing multiple clients with full data management |

To upgrade:
1. Go to **Team & Settings → Billing**.
2. Click **Upgrade plan**.
3. You will be redirected to the Stripe Checkout page. Enter your payment details and confirm.
4. You are returned to Atlas with your new plan active immediately.

To manage or cancel your subscription, click **Manage billing** on the same page — this opens the Stripe Billing Portal.

### 4. Invite Team Members

1. Go to **Team & Settings → Team**.
2. Click **Invite member**.
3. Enter the team member's email address and select their role:
   - **Admin** — full access including billing and settings
   - **Member** — full feature access, no billing
4. Click **Send invite**. The invitee receives an email with a link to join your workspace.

Team members can be removed or have their role changed at any time from the same page.

### 5. Account Settings

Navigate to **Settings** (bottom of the sidebar) to manage:

- **Profile** — your display name and email
- **Password** — change your login password
- **Billing** — view plan status, upgrade, or access the Stripe portal
- **Notifications** — configure alert delivery preferences

---

## Agency Setup

**Available on:** Agency plan

This guide covers setting up your agency workspace in Atlas: creating clients, configuring team access, and deploying signal templates.

### 1. Your Agency Workspace

When you log in as an agency user, the sidebar shows your **organisation workspace** with these sections:

- **Overview** — agency-wide health summary
- **Clients** — list of all client accounts
- **Data Manager** — cross-client DMA/Customer Match console
- **Tracking Map** — your signal library
- **Templates** — reusable signal packs
- **Site Scan, Audit Engine, CAPI, Consent** — shared tooling

### 2. Add a Client

Each client gets their own configuration, signals, CAPI setup, and platform connections.

1. Go to **Clients** in the sidebar.
2. Click **Add client**.
3. The **Client Setup Wizard** opens with 6 steps:

#### Step 1 — Basic details
- Enter the client's **name** and **website URL**.
- Select their **industry** from the dropdown.

#### Step 2 — Business type
- Choose the business model: E-commerce, Lead Gen, B2B SaaS, Marketplace, Nonprofit, or B2B Lead Gen.
- This determines the default signal pack and journey template used.

#### Step 3 — Platform configuration
- Enter platform IDs (Google Ads customer ID, Meta Pixel ID, GA4 Measurement ID) if available.
- These can be added or updated later.

#### Step 4 — Identity field mapping
- Map your client's dataLayer field paths to identity identifiers (email, phone, click IDs).
- This powers CAPI match quality and enrichment scoring.
- Click **Save** to save the identity config, or **Skip** to configure later.

#### Step 5 — Page configuration
- Define the key pages on the client's site (homepage, product, checkout, confirmation, etc.)

#### Step 6 — Review & create
- Review all settings and click **Create client**.

### 3. Client Detail Page

The Client Detail Page is the central hub for each client. It contains tabs for:

| Tab | What's here |
|---|---|
| **Overview** | Health score, recent audit, signal summary |
| **Signals** | Deployed signals for this client |
| **Enrichment** | Enrichment score, identity config, signal field mappings |
| **Platforms** | Connected ad platforms and GA4 |
| **CAPI** | Conversion API providers |
| **Reconciliation** | Platform config and volume diffs |
| **Settings** | Client name, URL, industry |

### 4. Deploy Signal Packs

1. Go to **Templates** in the sidebar.
2. Browse system packs or create a custom pack.
3. Click **Deploy** on a pack.
4. The **Deployment Wizard** opens:
   - **Step 1** — Select the target client and confirm the signals to deploy.
   - **Step 2** — Configure signal enrichment (value field, currency, dedup ID, content IDs).
5. Click **Deploy**.

### 5. Generate Outputs for a Client

1. Open the **Client Detail Page**.
2. Click **Generate outputs**.
3. Atlas generates:
   - A **GTM container JSON** ready to import into Google Tag Manager.
   - A **dataLayer spec** with code snippets for your developer.

### 6. Data Manager Console

1. Go to **Data Manager** in the sidebar.
2. The console shows each client's GTG status, average match rate, upload success rate, members pushed (30d), and actions needed.
3. Click **Export CSV** for a full report.

---

# Role Guides

---

## Solo Marketer / In-House Guide

This guide walks you through the recommended Atlas workflow for an individual marketer or in-house team managing tracking for a single business.

### Your Setup Checklist

| Step | Feature | Time |
|---|---|---|
| 1 | Conversion Strategy | 10–15 min |
| 2 | AI Site Scan *(Pro)* | 5 min setup, 10 min scan |
| 3 | Journey Builder | 15–30 min |
| 4 | Signal Library | 10 min |
| 5 | Consent Hub | 5 min |
| 6 | Conversion API *(Pro)* | 20 min |
| 7 | Platform Connections *(Pro)* | 10 min per platform |

### Step 1: Conversion Strategy

**Go to:** Sidebar → Conversion Strategy Gate

1. Click **New strategy brief**.
2. Choose **Single objective** or **Multi-objective** mode.
3. For each objective: name it, select platforms, click **Evaluate** to get a CONFIRM / AUGMENT / REPLACE verdict.
4. Review governance tier (Primary / Secondary / Suppression).
5. Click **Lock brief** when satisfied.

> Locking the brief is required before running a site scan.

### Step 2: AI Site Scan *(Pro)*

**Go to:** Sidebar → Site Scan

1. Click **New scan**, enter your website URL and business type.
2. Click **Start scan**.
3. Review recommendations per page — approve or reject each one.
4. Click **Save to Signal Library** to add approved events.

### Step 3: Journey Builder

**Go to:** Sidebar → Tracking Plan

1. Click **New journey** and select your business type.
2. For each stage: set proxy value (£), buyer intent level, and assign tracking events.
3. Click **Generate spec** to produce the GTM container JSON and dataLayer spec.

### Step 4: Signal Library

**Go to:** Sidebar → Tag Library

Browse system signals, create custom signals, and deploy signal packs. Configure signal enrichment for conversion events during deployment.

### Step 5: Consent Hub

**Go to:** Sidebar → Consent Hub

1. Select your CMP (OneTrust, Cookiebot, or Usercentrics) if applicable.
2. Enable **Google Consent Mode v2**.
3. Set default consent state (use `denied` for EEA/UK users).
4. Copy the generated consent banner script and install above GTM in your site `<head>`.

### Step 6: Conversion API *(Pro)*

**Go to:** Sidebar → Conversion API

1. Click **Add provider** and select Meta, Google, or LinkedIn.
2. Enter credentials, map events, configure deduplication.
3. Click **Activate**, then **Test**.

### Step 7: Platform Connections *(Pro)*

**Go to:** Sidebar → Platform Connections

1. Click **Add connection**, select the platform.
2. Click **Connect with OAuth** and authorise Atlas.
3. For Google Ads MCC, click **Discover accounts** to pull child accounts.

### Ongoing Monitoring

| Tool | Frequency | What to check |
|---|---|---|
| Signal Tracking Dashboard | Daily | Event volume, match quality, dedup rate |
| Health Dashboard | Weekly | Overall health score, open alerts |
| Audit Engine | Monthly | Gap report, implementation drift |
| Platform Reconciliation | Weekly | Config and volume diffs vs. platforms |

---

## Agency Admin Guide

This guide walks you through the full Atlas workflow for an agency owner or lead managing tracking infrastructure across multiple clients.

### Phase 1 — Workspace Setup

1. Create your organisation and upgrade to Agency plan.
2. Invite team members with Admin or Member roles.
3. Go to **Team & Settings → Naming Conventions** and set naming format before building your signal library.

### Phase 2 — Add Clients

Run the 6-step Client Setup Wizard for each client. Prioritise:
- **Step 3:** Enter platform IDs — enables reconciliation immediately.
- **Step 4:** Map email and phone fields — directly impacts CAPI match quality.

### Phase 3 — Strategy & Planning

For each client: go to **Conversion Strategy** → create a brief → add objectives → evaluate → lock. Then run an AI site scan, approve recommendations, and save to the Signal Library.

### Phase 4 — Signal Deployment

Select or clone a system signal pack, deploy to the client, configure signal enrichment (value field, dedup ID, platform enablement), then generate outputs (GTM container + dataLayer spec).

### Phase 5 — CAPI Setup

Add CAPI providers per client: select platform, enter credentials, map events, link identity config, activate, and test.

### Phase 6 — Platform Connections & Reconciliation

Connect platforms via OAuth → run reconciliation → review findings across Config / Volume / Delivery / Alignment dimensions → set tolerance thresholds per event.

### Phase 7 — Ongoing Health

| Cadence | Task |
|---|---|
| Daily | Signal Tracking Dashboard — volume and match quality |
| Weekly | Health Dashboard — alerts and health score trends |
| Weekly | Reconciliation — config/volume drift |
| Monthly | Audit Engine — full journey audit per client |
| Monthly | Implementation Health — GTM tag drift |

---

## Developer / Agency Client Guide

Your agency will share a **Developer Portal** link — a public page (no login required) with your complete implementation spec.

### What's in the Developer Portal

- **GTM Container JSON** — import-ready file for Google Tag Manager
- **dataLayer Spec** — per-page `dataLayer.push()` snippets
- **GCLID / UTM capture script** — paste into your site `<head>` above GTM
- **Hidden form fields** — HTML to add to lead forms for GCLID/UTM capture
- **Implementation guide** — Enhanced Conversions for Leads setup

### Implementing the GTM Container

1. Log in to Google Tag Manager.
2. Go to **Admin → Import Container**.
3. Select the JSON file from your agency.
4. Choose **Merge** (not Overwrite).
5. Test in Preview mode, then publish.

### Implementing the dataLayer Spec

Replace placeholder values (shown as `{{PLACEHOLDER}}`) with your actual data variables and push to `window.dataLayer` before GTM fires. Example:

```javascript
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'purchase',
  transaction_id: '{{ORDER_ID}}',
  value: {{ORDER_VALUE}},
  currency: 'GBP',
  items: [...]
});
```

### GCLID / UTM Capture

Add the capture script to your `<head>` *above* the GTM snippet. Add hidden form fields to each lead form — they are populated automatically by the capture script.

---

# Feature Reference

---

## Conversion Strategy Gate

**Available on:** Free

Defines and governs your tracking objectives before building any tracking. Uses Claude AI to evaluate each objective and return a CONFIRM / AUGMENT / REPLACE verdict.

### Verdicts

| Verdict | Meaning |
|---|---|
| **CONFIRM** | Your current setup is appropriate — no changes needed |
| **AUGMENT** | Partially correct — add the recommended enhancements |
| **REPLACE** | Suboptimal — switch to the recommended action type |

### Governance tiers

- **Primary** — the main conversion action for campaign optimisation
- **Secondary** — supporting signal, not optimised against directly
- **Suppression** — used to exclude converting users from prospecting

### Step-by-step

1. Go to **Conversion Strategy** → **New strategy brief**.
2. Choose Single or Multi-objective mode.
3. Add objectives, select platforms, click **Evaluate**.
4. Review verdicts, recommended primary event, and conversion tier.
5. Click **Lock brief** — required before running a site scan.
6. Click **Export PDF** to share with stakeholders.

### Tips

- **Don't skip this step.** The strategy brief anchors everything downstream.
- **One primary conversion per campaign.** Platforms degrade performance when optimising for too many primary conversions simultaneously.
- **OCI nudge.** If Claude recommends OCI for a CRM-stage event, take it seriously — offline conversion import is significantly more accurate for late-funnel events.

---

## AI Site Scan (Planning Mode)

**Available on:** Pro

Crawls your site with a real browser and uses Claude AI to identify tracking opportunities, PII risks, and GTM recommendations.

### Prerequisites

- Pro plan. Locked strategy brief.

### Step-by-step

1. Go to **Site Scan** → **New scan**.
2. Enter the site URL and select business type.
3. Click **Start scan** and watch real-time progress.
4. Review annotated screenshots and AI recommendations per page.
5. Approve or reject each recommendation.
6. Click **Save to Signal Library** to add approved events.
7. To rescan individual pages after changes, click **Rescan** on a specific page.

### Outputs

- GTM container JSON
- dataLayer implementation spec
- GCLID/UTM capture script
- PII risk assessment
- Enhanced Conversions for Leads guidance

### Tips

- **Use a live site.** Staging environments behind authentication won't be fully crawled.
- **Review PII flags carefully.** Investigate before approving any recommendation that captures sensitive data.
- **Lock your brief first.** Without a brief, recommendations are generic.

---

## Journey Builder

**Available on:** Free

Maps your customer journey stages and assigns tracking events, producing a GTM container and dataLayer spec.

### Step-by-step

1. Go to **Tracking Plan** → **New journey**.
2. Select your business type — a stage template is pre-populated.
3. For each stage:
   - Set **proxy value (£)** for value-based bidding.
   - Set **buyer intent level** (problem_aware / solution_aware / vendor_aware).
   - Assign tracking events from your Signal Library.
4. Click **Generate spec** to produce the GTM container JSON and dataLayer spec.

### Business types

E-commerce, Lead Gen, B2B SaaS, Marketplace, Nonprofit, **B2B Lead Gen** (7-stage template: Awareness → Engagement → Lead Capture → MQL → SQL → Opportunity → Closed Won).

### Tips

- **Set realistic proxy values.** They feed directly into value-based bidding. Inaccurate values will degrade campaign performance.
- **B2B Lead Gen journeys include 7 stages by default.** Remove stages that don't apply rather than leaving them with zero proxy value.

---

## Signal Library

**Available on:** Free

Central registry of tracking events. Browse system signals, create custom signals, and deploy signal packs to clients.

### Understanding Signals

Each signal has: **key** (event name), **category**, **required params**, **optional params**, and **platform mappings** (GA4, Google Ads, Meta).

### Signal Packs

Curated bundles of signals for a use case. System packs ship with Atlas; you can clone and customise them or build from scratch.

### Creating a Custom Signal

1. Click **Add signal**.
2. Enter key (snake_case), name, category, required/optional params, and platform mappings.
3. Click **Save signal**.

### Deploying Signals

1. Open a pack → click **Deploy**.
2. Select the target client.
3. Configure **signal enrichment** (value field, currency, dedup ID) for conversion events.
4. Click **Deploy signals**.
5. From the Client Detail Page, click **Generate outputs** for the GTM container and dataLayer spec.

### Tips

- **System signals cannot be edited.** Create a custom signal if you need a variation.
- **Enrichment improves match quality.** Even if you skip enrichment during deployment, complete it from the client's Enrichment tab.

---

## Signal Enrichment Configuration

**Available on:** Free

Maps your dataLayer field paths to identity and signal parameters to improve CAPI match quality, value-based bidding, and deduplication.

### Enrichment Score (0–100)

| Score | Colour | Meaning |
|---|---|---|
| 80–100 | Green | Excellent — all key fields mapped |
| 60–79 | Amber | Good — some recommended fields missing |
| 40–59 | Yellow | Fair — required fields missing |
| 0–39 | Red | Poor — critical fields missing, CAPI will be degraded |

### Part 1: Identity Configuration (once per client)

Set at **Client Detail → Enrichment tab** or during Client Setup Wizard Step 4.

| Field | Priority |
|---|---|
| `email_field` | **Required** |
| `phone_field` | **High impact** |
| `fbc_field`, `fbp_field`, `gclid_field` | **High impact** |
| First/last name, address fields | Best practice |

Use dot notation for field paths: `user.email`, `checkout.customer.phone_number`.

Enable **Auto-capture IP** and **Auto-capture User Agent** for maximum match quality.

### Part 2: Signal Enrichment (per conversion signal)

Set during Deployment Wizard Step 2 or from the client's Enrichment tab.

- **value_field** — path to event value (e.g. `ecommerce.value`)
- **currency** — static (e.g. `GBP`) or dynamic field path
- **dedup_id_field** — unique event identifier (e.g. `transaction_id`)
- **content_ids_field** — for Meta Advantage+ catalogue campaigns
- **Platform toggles** — enable Meta, Google, LinkedIn per signal

### Validation Rules

| Rule | Severity | Check |
|---|---|---|
| IDENT_01 | Error | Email field must be mapped |
| IDENT_02 | Warning | Phone field recommended |
| IDENT_03 | Warning | At least one click ID (fbc/fbp/gclid) required |
| IDENT_04 | Info | External ID recommended |
| IDENT_05 | Info | First name + last name recommended |
| SIG_01 | Error | Purchase value field must be mapped |
| SIG_02 | Warning | Purchase currency should be configured |
| SIG_03 | Error | Purchase dedup ID must be mapped |
| SIG_04 | Warning | At least one conversion signal enabled for a platform |
| SIG_05 | Info | Purchase content IDs recommended |
| CROSS_01 | Error | If conversion signals enabled, identity must be configured |
| CROSS_02 | Warning | All Meta-enabled signals must have dedup IDs |

### Tips

- **IDENT_01 and SIG_03 are blocking errors.** Without email and purchase dedup ID, match quality will be zero and duplicates cannot be suppressed.
- **Enrichment is non-fatal.** If enrichment fails (wrong field path), the event still delivers — just with less data.

---

## Consent Hub

**Available on:** Free

Configures consent state handling across all tracking. Every CAPI event includes consent state — events are blocked automatically if consent is denied.

### Step-by-step

1. Go to **Consent Hub**.
2. Select your CMP (OneTrust, Cookiebot, or Usercentrics) if applicable.
3. Set default consent state per category — use `denied` for EEA/UK users.
4. Toggle **Google Consent Mode v2** on — Atlas maps categories automatically.
5. Click **Generate consent script**, copy it, and install in your site `<head>` above GTM.

### Consent Categories

| Category | What it gates |
|---|---|
| **Marketing** | Meta CAPI, LinkedIn CAPI, audience enrichment |
| **Analytics** | Google Enhanced Conversions, GA4 events |
| **Functional** | Deduplication cookies, session tracking |

### Tips

- **Install the consent script before GTM.** If GTM fires before consent signals are set, Google Consent Mode defaults to `denied`.
- **Don't set marketing to `granted` by default for EEA users.** This is a legal requirement under GDPR/PECR.

---

## Conversion API (CAPI)

**Available on:** Pro

Server-side event delivery to Meta, Google Enhanced Conversions, and LinkedIn CAPI. Bypasses ad blockers and browser restrictions.

### Supported platforms

- **Meta CAPI** — Pixel ID + Access Token
- **Google Enhanced Conversions** — Customer ID + Conversion ID + Label
- **LinkedIn CAPI** — Insight Tag ID + Access Token

### Step-by-step

1. Go to **Conversion API** → **Add provider**.
2. Select platform and complete the setup wizard.
3. Enter credentials, map events, configure deduplication.
4. Click **Activate**, then **Test** to verify delivery.

### CAPI Pipeline

All events pass through: **Consent gate → Dedup check → PII hashing (SHA-256) → Signal enrichment → Format → Deliver → Log → Counters.**

### Deduplication

For dedup to work, your browser pixel must send an `event_id` parameter matching the same field Atlas uses as the dedup key.

### Tips

- **Test before going live.** Use Meta's test event code or Google Ads test conversion to validate before activating on production traffic.
- **Identity enrichment has the biggest impact on match quality.** Map email, phone, and click IDs before activating.
- **Check consent logs** if events aren't appearing in your ad platform.

---

## Offline Conversions

**Available on:** Pro

Upload CRM or offline conversion data to Google Ads, closing the loop between ad clicks and offline sales.

### CSV Format

| Column | Required | Format |
|---|---|---|
| `gclid` | Yes | Google click ID string |
| `conversion_name` | Yes | Match Google Ads action name exactly |
| `conversion_time` | Yes | ISO 8601 (e.g. `2026-06-01T14:30:00+01:00`) |
| `conversion_value` | No | Decimal number |
| `currency_code` | No | ISO 4217 (e.g. `GBP`) |
| `email` | No | Raw email (hashed before upload) |
| `phone` | No | E.164 format (e.g. `+447700900000`) |

### Step-by-step

1. Go to **Conversion API → Offline Conversions → Upload**.
2. Upload your CSV.
3. Review the Validation Report — fix invalid rows.
4. Click **Confirm upload** to submit to Google Ads.

### Tips

- **Upload within 90 days of the click.** GCLIDs expire after 90 days.
- **Match Google Ads action names exactly.** A single character difference will cause the row to fail.
- **Atlas hashes PII before transmission.** Upload raw (unhashed) email and phone — Atlas handles hashing.

---

## Platform Connections

**Available on:** Pro

OAuth connections to Google Ads (incl. MCC), Meta, GA4, and GTM. Powers reconciliation, IHC, and the Data Manager Console.

### Connecting Platforms

1. Go to **Platform Connections** → **Add connection**.
2. Select platform and connection type (Manager / Child / Standalone for Google Ads).
3. Click **Connect with OAuth** and authorise Atlas.
4. For Google Ads MCC: click **Discover accounts** to pull child accounts.

### Connection Statuses

| Status | Meaning |
|---|---|
| Connected | Token valid, last sync successful |
| Token expired | Click Re-connect to refresh OAuth token |
| Error | Click Test to diagnose |
| Disconnected | Connection removed |

### Tips

- **Connect the Google Ads MCC once** and discover all child accounts, rather than connecting each individually.
- **Meta connection requires Business Manager admin access.**
- **GTM OAuth is read-only.** Atlas can read your container but cannot publish changes.

---

## Platform Reconciliation

**Available on:** Pro

Compares your Atlas tracking configuration against live platform data across four dimensions: Config, Volume, Delivery, Alignment.

### Dimensions

| Dimension | What it checks |
|---|---|
| **Config** | Conversion actions configured correctly in ad platforms? |
| **Volume** | Atlas event volume vs. platform-reported volume |
| **Delivery** | Delivery success rates and error rates |
| **Alignment** | Does live tracking match your locked strategy brief? |

### Step-by-step

1. Go to **Reconciliation** → **Run reconciliation**.
2. Select platforms, click **Start run** (takes 30–60 seconds).
3. Review findings by severity (Critical / High / Medium / Low).
4. Make fixes in your platform or Atlas config.
5. Click **Mark as resolved** on each finding.

### Tolerance Configuration

Go to **Reconciliation → Tolerance settings** to set acceptable variance per event per platform (e.g. ±10%). Findings within tolerance are suppressed automatically.

### Tips

- **Run reconciliation regularly.** Set a weekly schedule — tracking drift accumulates silently.
- **Volume discrepancies up to 10% are normal.** Deduplication, consent blocking, and latency all create natural variance.
- **Alignment findings are the most critical** — they indicate campaigns may be optimising against the wrong signal.

---

## Implementation Health Checks (IHC)

**Available on:** Pro

Validates your GTM container against best-practice rules, establishes a baseline, and detects drift when the container changes.

### Connecting Your GTM Container

Go to **Settings → Implementation Health**:
- **OAuth:** click **Connect with Google** and select your container.
- **Manual upload:** export the container JSON from GTM Admin and upload it.

### Step-by-step

1. Select a GTM connection → click **Run check**.
2. Review findings with severity levels.
3. After a clean check, click **Set as baseline**.
4. Future checks diff against the baseline and flag any changes as drift.

### Alert Preferences

Go to **Implementation Health → Alert preferences** to set minimum severity threshold and notification channels (email / Slack webhook).

### Tips

- **Set a baseline after a clean implementation, not before.**
- **Re-baseline after intentional GTM changes** — otherwise Atlas keeps flagging the change as drift.
- **Use OAuth for live monitoring.** OAuth picks up GTM changes automatically; manual uploads require re-uploading after every publish.

---

## Bid Signal Enricher

**Available on:** Pro (Enricher); Agency (Data Manager Console)

Pushes hashed Customer Match audiences to Google's Data Manager API for value-based bidding and audience targeting.

### Running an Enricher Job

1. Go to **Bid Signal Enricher** → **New enricher run**.
2. Select ingest type (CSV upload or CRM sync).
3. Select destination Google Ads accounts and operation type (ADD / REMOVE / CREATE_OR_REPLACE).
4. Click **Start run**.

Atlas hashes all PII (SHA-256) before transmission — upload raw data.

### Match Rate Guidance

| Rate | Status | Action |
|---|---|---|
| > 40% | Good | No action needed |
| 20–40% | Fair | Check identity config — ensure email and phone are mapped |
| < 20% | Poor | Review data quality; check hashing format; verify account permissions |

### Data Manager Console (Agency)

Go to **Data Manager** for cross-client view: GTG status, match rates, upload success, members pushed (30d), and actions needed per client.

### Tips

- **Use normalised data.** Email addresses should be lowercase and trimmed. Phone numbers should be in E.164 format (`+447700900000`).
- **Customer Match requires at least 1,000 matched members** before a list can be used for targeting.
- **Upload both email and phone** where available — dual-matched members improve audience confidence.

---

## Signal Tracking Dashboard

**Available on:** Free

Live log of every CAPI event Atlas has delivered, with aggregate metrics on volume, match quality, and deduplication.

### Aggregate Cards

| Card | What it shows |
|---|---|
| **Total events** | Events delivered in the selected time range |
| **Match quality** | Average Meta EMQ (0–10) or Google match rate (%) |
| **Dedup rate** | Percentage of events suppressed as duplicates |
| **Delivery latency** | Average delivery time in milliseconds |

### Event Statuses

| Status | Meaning |
|---|---|
| `delivered` | Accepted by the ad platform |
| `delivery_failed` | Platform API returned an error |
| `consent_blocked` | Blocked by consent gate |
| `dedup_skipped` | Suppressed as a duplicate |

### Exporting to CSV

Apply filters → click **Export CSV** → wait for the background job → click **Download**.

### Tips

- **Low match quality** usually means identity fields aren't mapped. Check Signal Enrichment.
- **High consent_blocked rate** is expected for EEA users with opted-out consent.
- **Delivery failures:** click into a failed event to read the provider error message.

---

## Audit Engine

**Available on:** Free (manual); Pro (scheduled)

Simulates real user journeys using a headless browser, compares what tracking fired against your journey spec, and produces a scored gap report.

### Finding Types

- **Missing** — event in spec but not captured
- **Wrong parameters** — event fired but parameters incorrect
- **Extra** — event fired but not in spec
- **Correct** — event matches spec

### Step-by-step

1. Go to **Audit Engine** → **Run audit**.
2. Select the journey, confirm page URLs, click **Start audit** (2–5 minutes for a 5-stage journey).
3. Review the report: overall score, stage breakdown, findings detail.
4. Share the **Gap Report** with your developer as a targeted remediation list.

### Scheduled Audits (Pro)

Go to **Audit Engine → Schedules** to configure daily, weekly, or monthly runs with email notification.

### PDF Export

Click **Export PDF** for a presentation-ready brief with executive summary, stage breakdown, and recommended next actions.

### Tips

- **Dynamic pages may behave differently** than in a real session — the headless browser doesn't log in or maintain cart state.
- **Use publicly accessible URLs.** Staging environments behind VPN or HTTP auth won't work.

---

## Health Dashboard

**Available on:** Free

Single-number health score for your tracking infrastructure, an alert feed, and historical score trends.

### Health Score Components

| Component | Measures |
|---|---|
| Platform acceptance score | Ad platform accepting CAPI events without errors |
| GTG active | Google Tag Gateway deployed and responding |
| DMA coverage score | Customer Match audience coverage |
| Audit score | Journey tracking completeness |
| Enrichment score | CAPI identity and signal field mapping quality |

### Score Ranges

| Score | Meaning |
|---|---|
| 80–100 | Healthy |
| 60–79 | Good — minor issues, review alerts |
| 40–59 | Fair — significant gaps, prioritise alerts |
| 0–39 | Poor — immediate action required |

### Tips

- **Platform acceptance score drops are the most urgent.** Campaign optimisation degrades in real time when the platform rejects events.
- **Check after every GTM publish** — tracking regressions are often silent.

---

## Channel Insights

**Available on:** Free

Maps signal behaviour per traffic channel, showing how tracking quality and conversion signals differ across paid, organic, direct, email, and referral traffic.

### Common Diagnostic Findings

| Finding | Meaning |
|---|---|
| Missing UTM parameters | Attribution will be inaccurate |
| GCLID not captured | Enhanced Conversions will be degraded |
| Low conversion signal rate | Funnel drop-off or tracking gap |
| High consent block rate | Expected for EEA users with opted-out consent |

### Tips

- **UTM consistency is critical.** Inconsistent tagging (e.g. `utm_source=google` vs `utm_source=Google_Ads`) splits one channel into multiple entries.
- **Compare channel signal health, not just volume.** High-volume channels with poor signal health waste your tracking investment.

---

## Data Quality Monitoring (DQM)

**Available on:** Pro

Probes your Google Tag Gateway (GTG) path health and tracks DMA poll state, providing early warning of infrastructure failures.

### GTG Path Health

Atlas probes your GTG endpoint periodically and records HTTP status and latency.

| Status | HTTP | Meaning |
|---|---|---|
| Healthy | 200 | GTG responding normally |
| Degraded | 2xx slow | High latency (>2s) |
| Error | 4xx/5xx | Configuration or authentication issue |
| Down | Timeout | Endpoint unreachable |

### DMA Poll State

After each enricher run, Atlas checks DMA API state and records upload success rate, match rate, members (30d), and destination count.

**Backoff state:** If repeated failures occur, Atlas pauses automatic retries. Check the error categories panel — common causes are expired OAuth token, invalid destination account, or API quota exceeded.

### Tips

- **GTG down doesn't stop tracking.** Standard GTM/pixel tracking continues — GTG enhances signal quality, it doesn't replace it.
- **DMA poll errors are often token-related.** Check your Google Ads OAuth connection in Platform Connections first.

---

## Event Taxonomy

**Available on:** Free

Structured tree of all tracking event types with platform mappings to GA4, Google Ads, and Meta naming conventions.

### Browsing

Go to **Tag Library → Taxonomy**. Expand categories to browse events. Click an event to see platform mappings and recommended parameters.

### Adding Custom Events

1. Click **Add event**.
2. Enter name, slug (snake_case), category, description, and platform mappings.
3. Click **Save**.

### Tips

- **Use standard taxonomy events where possible.** System events have validated platform mappings — custom events require you to maintain mappings manually.
- **Signals referencing a taxonomy event inherit its platform mappings automatically.** Updating a taxonomy event's mapping updates all referencing signals.

---

## Naming Conventions

**Available on:** Free

Org-level rules for event and parameter naming. New signals are validated in real time and you can preview rename impacts before applying changes.

### Configuring

Go to **Team & Settings → Naming Conventions**:
- Set **format**: `snake_case`, `camelCase`, `PascalCase`, `kebab-case`
- Set optional **prefix** and **max length**
- Click **Save**

### Rename Preview

Click **Preview renames** before saving to see which existing signals would be affected. Click **Save and apply** to commit.

> Applying renames updates signal keys in your library but does not automatically update deployed GTM containers — update those separately.

### Best Practices

- Use `snake_case` to align with GA4 and Meta event naming conventions.
- Keep event names short and verb-based: `purchase`, `generate_lead`, `sign_up`.
- Set conventions **before** building your signal library — renaming after deployment is expensive.
- **System signals are not renamed.** Atlas system signals follow GA4 naming conventions and cannot be changed by convention rules.

---

# Platform Plans

| Plan | Key features |
|---|---|
| **Free** | Conversion Strategy Gate, Journey Builder, Signal Library, Signal Enrichment, Consent Hub, Signal Tracking Dashboard, Audit Engine (manual), Health Dashboard, Channel Insights, Event Taxonomy, Naming Conventions |
| **Pro** | Everything in Free, plus: AI Site Scan, Conversion API (Meta/Google/LinkedIn), Offline Conversions, Platform Connections, Platform Reconciliation, Implementation Health Checks, Bid Signal Enricher, Data Quality Monitoring, Scheduled Audits |
| **Agency** | Everything in Pro, plus: Multi-client workspace, Signal Pack Templates, Data Manager Console |

Super admins bypass all plan gates.

---

*Atlas User Manual — v1.0 — June 2026*
