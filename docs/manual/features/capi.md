# Conversion API (CAPI)

**Available on:** Pro

The Conversion API sends conversion events directly from your server to ad platform APIs, bypassing browser-level tracking limitations (ad blockers, ITP, cookie restrictions). Atlas supports Meta CAPI, Google Enhanced Conversions, and LinkedIn CAPI.

---

## What it does

- Delivers conversion events server-side to Meta, Google, and LinkedIn.
- Hashes all PII (email, phone, name, address) using SHA-256 before transmission.
- Deduplicates events to prevent double-counting when both browser pixel and server-side tracking fire.
- Applies [signal enrichment](./signal-enrichment.md) automatically before delivery.
- Logs every delivery attempt with status, match quality score, and latency.
- Blocks delivery automatically if consent is denied.

---

## Prerequisites

- Pro plan or above.
- [Consent Hub](./consent-hub.md) configured.
- Ad platform credentials (API access tokens).
- [Signal enrichment](./signal-enrichment.md) configured for conversion signals *(recommended)*.

---

## Adding a CAPI Provider

1. Go to **Conversion API** in the sidebar.
2. Click **Add provider**.
3. Select the platform: **Meta**, **Google**, or **LinkedIn**.
4. Complete the setup wizard:

### Meta CAPI setup

1. Enter your **Meta Pixel ID** (found in Meta Events Manager).
2. Enter your **Access Token** — generate this in Meta Events Manager → Settings → Conversions API.
3. Optionally enter a **Test Event Code** for testing (found in Meta Events Manager → Test Events).
4. Configure **event mapping** — map Atlas signal names to Meta standard events:
   - `purchase` → `Purchase`
   - `generate_lead` → `Lead`
   - `begin_checkout` → `InitiateCheckout`
5. Configure **deduplication** — enable and set a dedup window (default: 7 days). The dedup key must match what your browser pixel sends as `event_id`.
6. Click **Save**.

### Google Enhanced Conversions setup

1. Enter your **Google Ads Customer ID** (format: 123-456-7890).
2. Enter your **Conversion ID** and **Conversion Label** (from your Google Ads conversion action).
3. Configure event mapping and deduplication.
4. Click **Save**.

### LinkedIn CAPI setup

1. Enter your **LinkedIn Insight Tag ID**.
2. Enter your **LinkedIn API Access Token**.
3. Configure event mapping.
4. Click **Save**.

---

## Activating and Testing

1. After saving a provider, click **Activate** to enable live delivery.
2. Click **Test** to send a test event. The test event response shows:
   - Delivery status (success / failed).
   - Provider response payload.
   - Match quality indicators.
3. Check your ad platform's event manager to confirm the test event was received.

---

## Deduplication

Atlas deduplication ensures that when both your browser pixel and Atlas CAPI fire for the same event, the platform only counts it once.

For deduplication to work:
1. Your browser pixel must send an `event_id` parameter with each event.
2. Atlas must be configured with the same dedup field mapping (matching the `event_id` source).
3. The dedup window must be long enough to cover the typical browser→server delay (default 7 days is usually sufficient).

---

## CAPI Event Log

After going live, monitor delivery in the [Signal Tracking Dashboard](./signal-tracking.md):
- **Volume** — events delivered per day.
- **Match quality** — Meta EMQ score and Google match rate.
- **Dedup rate** — percentage of events suppressed as duplicates.
- **Latency** — average delivery time in milliseconds.

---

## Offline Conversions

For CRM-stage conversions (e.g. "Qualified Lead", "Closed Won") that happen offline, use the [Offline Conversions](./offline-conversions.md) feature instead of real-time CAPI.

---

## Tips & common mistakes

- **Test before going live.** Use the test event code (Meta) or test conversion in Google Ads to validate delivery before activating on production traffic.
- **Dedup window must match your pixel.** If your browser pixel uses `Math.random()` as event ID on each page load, deduplication won't work — use a stable transaction ID instead.
- **Identity enrichment improves match rates significantly.** A delivery with only `event_name` and timestamp will have near-zero match quality. Map email, phone, and click IDs in [Signal Enrichment](./signal-enrichment.md).
- **Check consent logs.** If events aren't appearing in your ad platform, check whether they are being blocked by the consent gate in the CAPI event log.
