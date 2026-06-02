# Conversion Strategy Gate

**Available on:** Free

The Conversion Strategy Gate ensures your measurement approach is properly governed before you build any tracking. It uses Claude AI to evaluate each conversion objective and return a verdict on whether your current setup should be confirmed, augmented, or replaced.

---

## What it does

- Defines tracking objectives at a campaign or business level.
- Evaluates each objective with Claude and returns a **CONFIRM**, **AUGMENT**, or **REPLACE** verdict.
- Assigns a **measurement governance tier** (Primary / Secondary / Suppression) per objective.
- Recommends platform-specific action types (e.g. "Website conversion" vs "Enhanced conversion").
- Flags CRM-stage events where OCI (Offline Conversion Import) is more appropriate than pixel-based tracking.
- Generates a **PDF strategy brief** you can share with stakeholders.

> A locked strategy brief is required before running an AI Site Scan.

---

## Prerequisites

- An Atlas account (free tier or above).
- A clear understanding of your campaign objectives and conversion actions.

---

## Step-by-step

### 1. Create a new brief

1. Go to **Conversion Strategy** in the sidebar.
2. Click **New strategy brief**.
3. Enter a **brief name** (e.g. "Q3 2026 — ViMi Digital").
4. Choose a mode:
   - **Single objective** — one primary conversion action.
   - **Multi-objective** — multiple conversion actions (e.g. purchase + lead + micro-conversion).
5. Click **Create**.

### 2. Add objectives

For each objective:

1. Click **Add objective**.
2. Enter a name (e.g. "Purchase", "Contact form submission").
3. Select the **platforms** this objective runs on (Google Ads, Meta, LinkedIn, etc.).
4. Optionally link a **campaign** if you want campaign-level specificity.

### 3. Evaluate with Claude

1. Click **Evaluate** on an objective.
2. Atlas sends the objective details to Claude for analysis.
3. The verdict is returned:

| Verdict | Meaning |
|---|---|
| **CONFIRM** | Your current conversion action setup is appropriate — no changes needed |
| **AUGMENT** | Your setup is partially correct — add the recommended enhancements |
| **REPLACE** | Your current setup is suboptimal — switch to the recommended action type |

4. Review the **recommended primary event** and **recommended proxy event**.
5. Note the **conversion tier** — this tells you how the platform should optimise against this signal.

### 4. Review platform action types

Each evaluated objective includes platform-specific action type recommendations, e.g.:
- Google Ads: "Use Purchase as a Primary, page_view as Suppression"
- Meta: "Optimise for Purchase event with value optimisation enabled"

### 5. Lock the brief

Once all objectives have been evaluated and you are satisfied with the recommendations:

1. Click **Lock brief**.
2. Confirm the lock — this cannot be undone (but you can create a new version).

A locked brief enables site scanning and reconciliation runs.

### 6. Export the PDF

1. Click **Export PDF** from the brief page.
2. A PDF brief is generated containing all objectives, verdicts, and recommendations.
3. Share with clients, stakeholders, or your media agency.

---

## Tips & common mistakes

- **Don't skip this step.** The strategy brief anchors everything downstream. If your objectives aren't well-defined, your tracking plan will drift.
- **One primary conversion per campaign.** Platforms degrade performance when optimising for too many primary conversions simultaneously. Use the tier system to keep one primary event per campaign.
- **OCI nudge.** If Claude recommends OCI for a CRM-stage event (e.g. "Qualified Lead"), take that seriously — importing offline conversions from your CRM is significantly more accurate than relying on a web pixel for late-funnel events.
