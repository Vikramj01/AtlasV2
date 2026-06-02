# Solo Marketer / In-House Guide

This guide walks you through the recommended Atlas workflow for an individual marketer or in-house team managing tracking for a single business.

---

## Your Setup Checklist

The sidebar **Set Up** section tracks your progress through these steps. Complete them in order for the best experience.

| Step | Feature | Time |
|---|---|---|
| 1 | [Conversion Strategy](#step-1-conversion-strategy) | 10–15 min |
| 2 | [AI Site Scan](#step-2-ai-site-scan) *(Pro)* | 5 min setup, 10 min scan |
| 3 | [Journey Builder](#step-3-journey-builder) | 15–30 min |
| 4 | [Signal Library](#step-4-signal-library) | 10 min |
| 5 | [Consent Hub](#step-5-consent-hub) | 5 min |
| 6 | [Conversion API](#step-6-conversion-api) *(Pro)* | 20 min |
| 7 | [Platform Connections](#step-7-platform-connections) *(Pro)* | 10 min per platform |

---

## Step 1: Conversion Strategy

**Go to:** Sidebar → Conversion Strategy Gate

Before building any tracking, define *what* you're measuring and *why*. The Conversion Strategy Gate ensures your measurement approach is governed and aligned with your ad platform's optimisation requirements.

1. Click **New strategy brief**.
2. Choose **Single objective** or **Multi-objective** mode.
3. For each objective:
   - Name it (e.g. "Purchase", "Lead form submission").
   - Select the platforms it runs on (Google Ads, Meta, etc.).
   - Click **Evaluate** — Atlas uses Claude AI to return a **CONFIRM**, **AUGMENT**, or **REPLACE** verdict with a recommended conversion action type.
4. Review the governance tier assigned (Primary / Secondary / Suppression).
5. Click **Lock brief** when satisfied.

> Locking the brief is required before running a site scan.

**Output:** A strategy brief PDF you can share with stakeholders.

---

## Step 2: AI Site Scan *(Pro)*

**Go to:** Sidebar → Site Scan

The AI Site Scan crawls your website and uses Claude to identify tracking opportunities, PII risks, and GTM recommendations.

1. Click **New scan**.
2. Enter your website URL and select your business type.
3. Click **Start scan** — Atlas uses Browserbase to crawl your site pages.
4. Once complete, review **Recommendations** per page:
   - Approve recommendations you want to implement.
   - Reject or modify any that don't apply.
5. Click **Save to Signal Library** to add approved events to your signal library.

**Output:** Annotated page screenshots, event recommendations, PII detection report, GTM container JSON, and implementation guide.

---

## Step 3: Journey Builder

**Go to:** Sidebar → Tracking Plan

The Journey Builder maps the customer journey stages on your site and assigns tracking events to each stage.

1. Click **New journey**.
2. Select your business type (e-commerce, lead gen, B2B SaaS, etc.).
3. Atlas pre-populates a journey template — edit stage names, add or remove stages as needed.
4. For each stage:
   - Set the **proxy value** (monetary value for value-based bidding, e.g. £15 for an email sign-up).
   - Set the **buyer intent level** (Problem Aware / Solution Aware / Vendor Aware).
5. Click **Generate spec** to produce the implementation specification.

**Output:** A GTM container JSON and dataLayer code snippets for your developer.

---

## Step 4: Signal Library

**Go to:** Sidebar → Tag Library

The Signal Library is your central registry of tracking events.

1. Browse **system signals** (pre-built events like `purchase`, `generate_lead`, `page_view`).
2. Add **custom signals** for events specific to your business.
3. Use **signal packs** — curated bundles — to deploy a complete set of events at once.
4. From the deployment wizard, configure **signal enrichment** (value fields, dedup IDs) for conversion events.

---

## Step 5: Consent Hub

**Go to:** Sidebar → Consent Hub

Configure how Atlas handles consent state across all tracking.

1. Select your **CMP (Consent Management Platform)** if you use one: OneTrust, Cookiebot, or Usercentrics.
2. Enable **Google Consent Mode v2** — Atlas maps consent categories automatically.
3. Set your **default consent state** for users who haven't made a choice.
4. Copy the generated **consent banner script** and add it to your site `<head>` above GTM.

> Every CAPI event Atlas sends includes the user's consent state. Events are blocked automatically if marketing consent is denied.

---

## Step 6: Conversion API *(Pro)*

**Go to:** Sidebar → Conversion API

Server-side event delivery sends conversion data directly from your server to ad platform APIs, bypassing browser-level tracking limitations.

1. Click **Add provider**.
2. Select the platform: **Meta**, **Google**, or **LinkedIn**.
3. Complete the setup wizard:
   - Enter your credentials (Pixel ID + Access Token for Meta; Customer ID + Conversion ID for Google).
   - Map Atlas signal names to platform event names.
   - Configure deduplication settings.
4. Click **Activate**.
5. Click **Test** to send a test event and verify delivery.

---

## Step 7: Platform Connections *(Pro)*

**Go to:** Sidebar → Platform Connections

Connect your ad platform accounts so Atlas can reconcile your tracking configuration against live data.

1. Click **Add connection**.
2. Select the platform: **Google Ads**, **Meta**, **GA4**, or **GTM**.
3. Click **Connect with OAuth** — you'll be redirected to authorise Atlas.
4. For Google Ads manager accounts, click **Discover accounts** to pull child accounts.
5. Once connected, Atlas can run [reconciliation](../features/reconciliation.md) to compare config vs. live delivery data.

---

## Ongoing Monitoring

Once set up, use these tools regularly:

| Tool | Frequency | What to check |
|---|---|---|
| [Signal Tracking Dashboard](../features/signal-tracking.md) | Daily | Event volume, match quality, dedup rate |
| [Health Dashboard](../features/health-dashboard.md) | Weekly | Overall health score, open alerts |
| [Audit Engine](../features/audit-engine.md) | Monthly | Gap report, implementation drift |
| [Platform Reconciliation](../features/reconciliation.md) | Weekly | Config and volume diffs vs. platforms |
| [Data Quality Monitoring](../features/data-quality.md) | Weekly | GTG path health, DMA poll state |
