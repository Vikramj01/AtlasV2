# Channel Insights

**Available on:** Free

Channel Insights maps signal behaviour per traffic channel, showing you how tracking quality and conversion signals differ across paid, organic, direct, email, and referral traffic.

---

## What it does

- Ingests session data and maps it to traffic channels (Google Ads, Meta, organic search, direct, email, referral).
- Diagnoses tracking quality per channel — are conversion events firing correctly for each channel's traffic?
- Surfaces anomalies: channels with unexpectedly low event rates, high bounce rates, or missing signals.
- Helps identify attribution gaps — traffic that converts but isn't being credited correctly.

---

## Prerequisites

- An Atlas account.
- CAPI events being delivered (at least some live traffic).
- UTM parameters applied to your campaign URLs (strongly recommended).

---

## Viewing Channel Insights

1. Go to **Channel Insights** in the sidebar.
2. The main view shows a summary table of channels with:
   - **Sessions** — estimated session count.
   - **Events fired** — total tracking events from this channel's traffic.
   - **Conversion rate** — percentage of sessions with a conversion event.
   - **Signal health** — overall signal quality score for this channel.
   - **Diagnostic status** — OK / Warning / Critical.

3. Click a channel row to see the **Channel Detail** view:
   - Event breakdown by signal name.
   - Journey map showing which stages of your funnel are most represented.
   - Diagnostics — specific issues detected for this channel.

---

## Understanding Diagnostics

Each channel can have one or more diagnostic findings:

| Finding | Meaning |
|---|---|
| Missing UTM parameters | Traffic from this channel is arriving without UTM tags — attribution will be inaccurate |
| GCLID not captured | Google click IDs are not being stored — offline conversions and Enhanced Conversions will be degraded |
| Low conversion signal rate | Very few sessions from this channel have a conversion event — may indicate a funnel drop-off or tracking gap |
| Consent block rate high | A high proportion of this channel's events are being blocked by consent gate — expected for certain regions |
| Event mismatch | Events are firing but parameters don't match the expected spec |

---

## Tips & common mistakes

- **UTM consistency is critical.** Channels are identified primarily by UTM source/medium. Inconsistent UTM tagging (e.g. sometimes `utm_source=google` and sometimes `utm_source=Google_Ads`) will split what should be one channel into multiple entries.
- **Direct traffic is always noisy.** A high proportion of "direct" sessions often indicates UTM parameters are being stripped (common on iOS redirects or link shorteners). Use UTM-persistent landing pages.
- **Compare channel signal health, not just volume.** A high-volume channel with poor signal health is wasting your tracking investment — prioritise fixing those channels first.
