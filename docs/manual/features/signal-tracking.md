# Signal Tracking Dashboard

**Available on:** Free

The Signal Tracking Dashboard shows a live log of every CAPI event Atlas has delivered, with aggregate metrics on volume, match quality, and deduplication.

---

## What it does

- Displays a paginated log of all CAPI events with status, match quality, and delivery latency.
- Shows aggregate cards for total volume, average match quality, and dedup rate.
- Filters events by provider, event name, date range, and status.
- Exports filtered event data to CSV asynchronously.

---

## Prerequisites

- An Atlas account (free tier or above).
- At least one [CAPI provider](./capi.md) activated and delivering events.

---

## Dashboard overview

### Aggregate cards

At the top of the dashboard, four cards show:

| Card | What it shows |
|---|---|
| **Total events** | Number of events delivered in the selected time range |
| **Match quality** | Average match quality score (Meta EMQ 0–10, Google match rate %) |
| **Dedup rate** | Percentage of events suppressed as duplicates |
| **Delivery latency** | Average time from Atlas receiving the event to platform confirmation |

### Event list

The event list shows each delivery attempt with:
- **Event ID** — Atlas internal identifier.
- **Event name** — the Atlas signal key (e.g. `purchase`).
- **Provider** — Meta / Google / LinkedIn.
- **Status** — Delivered / Failed / Consent blocked / Dedup skipped.
- **Match quality** — score for this specific event.
- **Latency** — delivery time in milliseconds.
- **Timestamp** — when the event was received.

Click any event to see the full payload, provider response, and consent state.

---

## Filtering events

Use the filter bar to narrow down the event list:
- **Provider** — filter to a specific CAPI provider.
- **Event name** — filter to a specific signal.
- **Status** — show only failed events, consent-blocked events, etc.
- **Date range** — select a custom start and end date.

---

## Exporting to CSV

For detailed analysis in a spreadsheet:

1. Apply any filters you want.
2. Click **Export CSV**.
3. The export runs as a background job — you will be notified when it's ready.
4. Click **Download** to save the file.

CSV exports include all columns from the event list plus additional fields: hashed identifiers sent, raw provider response, and enrichment score.

---

## Understanding event statuses

| Status | Meaning |
|---|---|
| `delivered` | Event was accepted by the ad platform |
| `delivery_failed` | Platform API returned an error — check the error code |
| `consent_blocked` | Event was blocked because the required consent category was denied |
| `dedup_skipped` | Event was suppressed as a duplicate of a previously delivered event |

---

## Tips & common mistakes

- **High consent_blocked rate.** If a large percentage of events are consent_blocked, check your consent default state in the [Consent Hub](./consent-hub.md). For EEA users with opted-out consent, this is expected.
- **Low match quality.** If Meta EMQ is below 6 or Google match rate is below 30%, check your [signal enrichment](./signal-enrichment.md) configuration — identity fields are likely not mapped.
- **High dedup rate.** Some dedup is expected and healthy. Very high rates (>50%) may indicate your browser pixel and CAPI are both firing with the same event ID, which is correct behaviour — but if you're seeing 90%+ dedup, verify your dedup window is configured correctly.
- **Delivery failures.** Click into a failed event to read the provider error message. Common causes: expired access tokens, invalid pixel ID, malformed payload. Check your CAPI provider credentials.
