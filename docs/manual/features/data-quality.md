# Data Quality Monitoring (DQM)

**Available on:** Pro

Data Quality Monitoring probes your Google Tag Gateway (GTG) path health and tracks your Google Data Manager (DMA) poll state, giving you early warning of infrastructure failures before they impact campaign performance.

---

## What it does

- **GTG path health probes** — makes HTTP requests to your GTG endpoint and records response status and latency.
- **DMA poll state tracking** — monitors your Google Data Manager sync status, upload success rate, and match rate over time.
- Surfaces issues as alerts on the [Health Dashboard](./health-dashboard.md).

---

## Prerequisites

- Pro plan or above.
- A deployed Google Tag Gateway endpoint.
- An active [Bid Signal Enricher](./bid-signal-enricher.md) setup (for DMA monitoring).

---

## GTG Path Health

The Google Tag Gateway (GTG) is a server-side Google tag endpoint. Atlas probes it periodically to check it's responding correctly.

### Viewing GTG health

1. Go to **Signal Health → Data Quality** (or check the Health Dashboard GTG status card).
2. The GTG status shows:
   - **Endpoint URL** — the GTG URL being probed.
   - **HTTP status** — last response code (200 = healthy).
   - **Response time** — latency in milliseconds.
   - **Last checked** — timestamp of most recent probe.
   - **Status** — Healthy / Degraded / Down.

### GTG probe results

| Status | HTTP | Meaning |
|---|---|---|
| Healthy | 200 | GTG is responding normally |
| Degraded | 2xx slow | GTG responding but with high latency (>2s) |
| Error | 4xx/5xx | GTG configuration error or authentication issue |
| Down | Timeout | GTG endpoint unreachable |

---

## DMA Poll State

Atlas tracks the state of your Google Data Manager API connection by polling after each enricher run.

### Viewing DMA state

1. Go to **Signal Health → Data Quality**.
2. The DMA state panel shows:
   - **Last polled** — when Atlas last checked DMA state.
   - **Upload success rate** — percentage of recent uploads that completed without error.
   - **Average match rate** — average Customer Match match rate over recent runs.
   - **Total members (30d)** — total matched members pushed in the last 30 days.
   - **Destination count** — number of Google Ads accounts receiving audiences.
   - **Error categories** — breakdown of error types if uploads are failing.

### Backoff state

If repeated upload failures occur, Atlas enters a **backoff state** and pauses automatic retries until the backoff period expires. This prevents hammering a failing API.

The `backoff_until` timestamp shows when normal polling will resume. During backoff, check the error categories panel to diagnose the root cause (typically: expired OAuth token, invalid destination account, or DMA API quota exceeded).

---

## Tips & common mistakes

- **GTG down doesn't mean conversions are lost.** Standard GTM/pixel tracking continues even if GTG is down. GTG enhances signal quality — its absence degrades quality, it doesn't stop tracking entirely.
- **DMA poll errors are often token-related.** If DMA state shows a high error rate, the first thing to check is whether your Google Ads OAuth connection has expired. Go to [Platform Connections](./platform-connections.md) and test/reconnect the Google Ads connection.
- **High latency on GTG is worth investigating.** GTG latency above 2 seconds can slow page load times. Check your GTG server location relative to your primary user geography.
