# Health Dashboard

**Available on:** Free

The Health Dashboard provides a single-number health score for your tracking infrastructure, an alert feed for active issues, and historical trend charts showing how your health has changed over time.

---

## What it does

- Computes a **live health score** (0–100) composed of multiple sub-scores.
- Shows an **alert feed** with actionable items ranked by severity.
- Displays a **historical trend** of health scores over time.
- Highlights the biggest contributors to score drops.

---

## Prerequisites

- An Atlas account.
- Data from at least one active feature (CAPI, reconciliation, GTM connection, etc.) for a meaningful score.

---

## Understanding the Health Score

The health score is a weighted composite of:

| Component | Weight | What it measures |
|---|---|---|
| **Platform acceptance score** | High | Are ad platforms accepting your CAPI events without errors? |
| **GTG active** | Medium | Is the Google Tag Gateway deployed and responding? |
| **DMA coverage score** | Medium | How well are your Customer Match audiences covering your traffic? |
| **Audit score** | Medium | How complete is your journey tracking? |
| **Enrichment score** | Medium | How well-configured is your CAPI identity and signal enrichment? |

Each component returns 0–100. The overall score is a weighted average.

### Score ranges

| Score | Meaning |
|---|---|
| 80–100 | Healthy — tracking is well-configured and delivering correctly |
| 60–79 | Good — minor issues present, review open alerts |
| 40–59 | Fair — significant gaps, prioritise alerts |
| 0–39 | Poor — critical failures, immediate action required |

---

## Alert Feed

The alert feed shows all active issues across your tracking stack:

- **Severity** — Critical / High / Medium / Low.
- **Category** — which component raised the alert (CAPI, GTM, enrichment, etc.).
- **Description** — plain-English explanation of the issue.
- **Recommended action** — a link to the relevant feature or setting.
- **First seen / Last seen** — when the alert was first detected and most recently confirmed.

### Dismissing alerts

Click **Dismiss** on an alert to acknowledge it. Dismissed alerts are removed from the feed but are still accessible in the alert history.

Alerts automatically clear when the underlying issue is resolved (e.g. a CAPI credential is updated and delivery succeeds).

---

## Historical Trends

The trend chart shows:
- Overall health score over time (selectable range: 7 days, 30 days, 90 days).
- Sub-score trends for each component.
- Score snapshots are taken daily.

Use the trend view to:
- Confirm that a fix worked (score should recover after the fix).
- Identify when a regression started.
- Report tracking health to stakeholders over a reporting period.

---

## Tips & common mistakes

- **A score of 0 on a component doesn't always mean failure.** Some components only score once data is present (e.g. enrichment score is 0 if no signals are deployed). Focus on the alert feed for actionable issues.
- **Platform acceptance score drops are the most urgent.** If your ad platform is rejecting events, your campaign optimisation is degrading in real time.
- **Check the Health Dashboard after every major site or GTM change.** Changes to your website, CMS, or GTM container often break tracking silently.
