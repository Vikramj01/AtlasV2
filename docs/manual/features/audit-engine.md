# Audit Engine

**Available on:** Free (limited runs); Pro (scheduled)

The Audit Engine simulates real user journeys on your website using a headless browser and compares what tracking actually fired against what your journey plan says should fire. The result is a scored gap report and a PDF brief.

---

## What it does

- Drives a headless browser through your defined customer journey stages.
- Captures all `dataLayer` events and network requests (GTM, GA4, pixel calls).
- Compares captured events against your Journey Builder spec.
- Classifies gaps: **Missing event**, **Wrong parameters**, **Extra event**, **Correct**.
- Generates a scored PDF report with findings ranked by severity.

---

## Prerequisites

- An Atlas account (free tier or above).
- A [journey](./journey-builder.md) with at least one stage and associated page URLs.
- A publicly accessible website.

---

## Running an Audit

### Manual run

1. Go to **Audit Engine** in the sidebar.
2. Click **Run audit**.
3. Select the journey to audit.
4. Confirm the page URLs for each stage.
5. Click **Start audit**.

The audit progress page opens and shows real-time status as each stage is checked. A typical audit of a 5-stage journey takes 2–5 minutes.

### Scheduled runs *(Pro)*

1. Go to **Audit Engine → Schedules**.
2. Click **Add schedule**.
3. Select the journey and set the frequency: Daily, Weekly, or Monthly.
4. Set the notification email for the report.
5. Click **Save**.

Scheduled audits run automatically at midnight (UTC) on the configured cadence.

---

## Reading the Audit Report

### Summary page

- **Overall score** — 0–100, weighted by finding severity.
- **Stage breakdown** — score per journey stage.
- **Finding counts** — how many Missing, Wrong, Extra, and Correct events were found.

### Findings detail

For each finding:
- **Type** — Missing / Wrong parameters / Extra / Correct.
- **Stage** — which journey stage this relates to.
- **Expected event** — what the journey spec said should fire.
- **Actual event** — what was captured (or `null` for missing).
- **Parameter diff** — for "Wrong parameters" findings, a side-by-side comparison of expected vs. actual parameter values.

### Gap Report

The Gap Report is a filtered view showing only Missing and Wrong parameter findings, grouped by page. Share this with your developer as a targeted remediation list.

---

## Audit History

All previous audit runs are listed with:
- Run date and time.
- Score.
- Finding counts.
- Link to the full report.

Comparing scores over time shows whether your tracking is improving or regressing.

---

## PDF Export

Click **Export PDF** from any audit report to generate a presentation-ready brief containing:
- Executive summary with overall score.
- Stage-by-stage breakdown with scores.
- Full findings list.
- Recommended next actions.

---

## Tips & common mistakes

- **Dynamic pages may behave differently than in a real session.** The headless browser doesn't accept cookies, log in, or maintain cart state. If your checkout requires authentication, some events will appear missing even if they fire correctly for logged-in users.
- **Use realistic test URLs.** Audit pages must be publicly accessible and contain the GTM snippet. Staging environments behind VPN or HTTP auth won't work.
- **Scheduled audits run on the live site.** This is intentional — the goal is to detect production tracking failures. Don't schedule audits too frequently on high-traffic checkouts.
- **Extra events aren't always problems.** Extra events (fired but not in the spec) are flagged informally. They may be legacy events or marketing pixels outside your spec. Review and remove if they're not needed.
