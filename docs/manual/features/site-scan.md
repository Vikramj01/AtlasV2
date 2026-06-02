# AI Site Scan (Planning Mode)

**Available on:** Pro

The AI Site Scan crawls your website using a real browser (Browserbase), captures screenshots and page source, and sends them to Claude for analysis. The result is a set of tagging recommendations, a PII risk assessment, and a ready-to-import GTM container.

---

## What it does

- Browses your website automatically across key page types.
- Detects existing tracking tags (GTM, GA4, pixels, CAPI).
- Identifies trackable elements (forms, buttons, checkout steps, CTA clicks).
- Flags PII exposure risks (forms that may inadvertently capture sensitive data).
- Generates event recommendations with element selectors.
- Produces a GTM container JSON and an implementation guide.

---

## Prerequisites

- Pro plan or above.
- A locked [strategy brief](./conversion-strategy.md) for the site being scanned.

---

## Step-by-step

### 1. Start a new scan

1. Go to **Site Scan** in the sidebar.
2. Click **New scan**.
3. Enter the **site URL** to scan (must be publicly accessible).
4. Select the **business type** — this guides the AI's recommendations.
5. Click **Start scan**.

Atlas will open the site in a headless browser and begin crawling. You can watch progress in real time on the scan status page.

### 2. Review page captures

Once the scan completes, each crawled page is listed with:
- A **screenshot** with annotated recommendations overlaid.
- A **page type** classification (homepage, product, cart, checkout, confirmation, etc.).
- The **AI analysis** summary.

### 3. Review recommendations

For each page, Atlas shows individual recommendations:
- **Event name** — the suggested Atlas/GA4 event.
- **Element reference** — the CSS selector or element description.
- **Action type** — click, form submit, page view, scroll depth, etc.
- **Recommendation type** — new tag, update existing, remove, or no action.

Click **Approve** to accept a recommendation, or **Reject** to dismiss it.

### 4. Save to Signal Library

Once you've approved the recommendations you want:

1. Click **Save to Signal Library**.
2. Approved events are added to your Signal Library as custom signals.
3. You can then deploy them via the [Deployment Wizard](./signal-library.md#deploying-signals).

### 5. Rescan pages

If you make changes to your site, you can rescan individual pages:
- Open the scan session.
- Click **Rescan** on a specific page.
- Atlas re-crawls that page and updates the recommendations.

---

## The Implementation Guide

The generated implementation guide includes:

- **GCLID / UTM capture script** — a JavaScript snippet to add to your site `<head>`.
- **Hidden form fields** — HTML to add to lead forms to capture click IDs.
- **CRM field mapping** — recommended CRM fields to populate from hidden form data.
- **Enhanced Conversions for Leads** — instructions for configuring Google's ECL feature.

Find the guide in the scan session under the **Implementation Guide** tab, or in the generated GTM container notes.

---

## Tips & common mistakes

- **Use a realistic test session.** The scan works best on a live site. Staging environments behind authentication won't be fully crawled.
- **Review PII flags carefully.** If Atlas flags a form field as potentially capturing PII in a tracking tag, investigate before approving the recommendation.
- **The GTM container is a starting point.** Import it, review in Preview mode, and adjust before publishing.
- **Lock your brief first.** The scan uses your strategy brief to contextualise recommendations. Running without a brief produces generic suggestions.
