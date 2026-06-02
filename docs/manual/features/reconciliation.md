# Platform Reconciliation

**Available on:** Pro

Platform Reconciliation compares your Atlas tracking configuration against live data from your connected ad platforms. It surfaces mismatches in configuration, event volume, delivery quality, and alignment with your strategy brief.

---

## What it does

Reconciliation runs diffs across four dimensions:

| Dimension | What it checks |
|---|---|
| **Config** | Are the conversion actions in your ad platforms configured correctly? |
| **Volume** | Does the event volume in Atlas match what the platform received? |
| **Delivery** | Are events being delivered successfully? Are there high error rates? |
| **Alignment** | Does your live tracking match the strategy brief you locked? |

Each finding is assigned a **severity**: Critical, High, Medium, Low.

---

## Prerequisites

- Pro plan or above.
- At least one [platform connection](./platform-connections.md).
- A locked [strategy brief](./conversion-strategy.md) *(required for alignment checks)*.

---

## Running a Reconciliation

### Manual run

1. Go to **Reconciliation** in the sidebar.
2. Select the client (if agency context) or proceed directly.
3. Click **Run reconciliation**.
4. Select the platforms to include (Google Ads, Meta, GA4).
5. Click **Start run**.

Atlas fetches data from each connected platform and runs the diff engine. This typically takes 30–60 seconds.

### Automatic trigger

Reconciliation can also trigger automatically after a strategy brief is locked. Check **Team & Settings → Schedules** to configure automatic reconciliation cadences.

---

## Reading Results

### Findings list

Each finding shows:
- **Dimension** — Config / Volume / Delivery / Alignment.
- **Platform** — which ad platform the finding relates to.
- **Event name** — the specific conversion action affected.
- **Description** — a plain-English explanation of the discrepancy.
- **Severity** — how urgently this needs attention.

### Resolving findings

1. Click a finding to expand it.
2. Review the recommended action.
3. Make the required change in your ad platform or Atlas configuration.
4. Click **Mark as resolved** in Atlas.

Resolved findings are archived but not deleted — you can review the history at any time.

---

## Tolerance Configuration

Not all volume discrepancies are problems. For example, server-side CAPI typically shows slightly different numbers to the browser pixel due to deduplication.

Configure tolerance thresholds per event per platform:

1. Go to **Reconciliation → Tolerance settings**.
2. For each event + platform combination, set a **tolerance percentage** (e.g. ±10%).
3. Click **Save**.

Findings that fall within the tolerance band are automatically suppressed.

---

## Event Stats Time-Series

The reconciliation run detail page includes a time-series chart of:
- Atlas CAPI volume (events delivered).
- Platform-reported volume (events received by the ad platform).
- Delta percentage.

Use this to spot trends (e.g. a sudden drop in delivery rate following a GTM publish).

---

## Tips & common mistakes

- **Run reconciliation regularly, not just once.** Set a weekly schedule — tracking drift accumulates silently.
- **Config findings often need platform-side fixes.** If Atlas flags that a conversion action is missing a value setting, the fix is usually in Google Ads or Meta, not in Atlas.
- **Volume discrepancies up to 10% are normal.** Deduplication, consent blocking, and latency all create natural variance. Set tolerances appropriately before investigating small discrepancies.
- **Alignment findings mean your live tracking has drifted from your brief.** Treat these as high priority — they indicate your campaigns may be optimising against the wrong signal.
