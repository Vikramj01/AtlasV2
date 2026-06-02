# Consent Hub

**Available on:** Free

The Consent Hub configures how Atlas handles user consent state across all tracking. Every CAPI event Atlas sends includes the consent state attached — events are automatically blocked if the required consent category is denied.

---

## What it does

- Generates a **consent banner script** that captures user consent choices.
- Integrates with major **CMPs** (Consent Management Platforms): OneTrust, Cookiebot, Usercentrics.
- Implements **Google Consent Mode v2** — sends consent signals to Google's ad infrastructure.
- Maps CMP consent categories to Atlas internal categories (marketing, analytics, functional).
- Records per-user consent choices for audit purposes.

---

## Prerequisites

- An Atlas account (free tier or above).

---

## Step-by-step

### 1. Open Consent Hub

Go to **Consent Hub** in the sidebar.

### 2. Select your CMP *(if applicable)*

If you use a third-party CMP:

1. Click **Configure CMP integration**.
2. Select your CMP: **OneTrust**, **Cookiebot**, or **Usercentrics**.
3. Follow the CMP-specific instructions to connect your consent data to Atlas.

If you don't use a CMP, Atlas provides a standalone consent banner you can configure below.

### 3. Configure consent categories

Atlas uses three consent categories that map to tracking purposes:

| Category | What it gates |
|---|---|
| **Marketing** | Meta CAPI, LinkedIn CAPI, audience enrichment |
| **Analytics** | Google Enhanced Conversions, GA4 events |
| **Functional** | Deduplication cookies, session tracking |

For each category, set the **default state** for users who haven't made a choice:
- `granted` — tracking runs by default (requires opt-out).
- `denied` — tracking is blocked by default (requires opt-in).

> For EEA/UK users, the default should be `denied` for marketing and analytics categories to comply with PECR/GDPR.

### 4. Configure Google Consent Mode v2

1. Toggle **Enable Google Consent Mode v2**.
2. Atlas automatically maps its consent categories to Google's required signals:
   - `ad_storage` ← marketing
   - `analytics_storage` ← analytics
   - `ad_user_data` ← marketing
   - `ad_personalization` ← marketing
3. The consent mode signals are injected into the GTM container automatically.

### 5. Generate and install the banner script

1. Click **Generate consent script**.
2. Copy the generated JavaScript snippet.
3. Paste it into your site's `<head>` tag, **above** the Google Tag Manager snippet.

The banner script:
- Reads the user's consent choice from your CMP or local storage.
- Sends consent signals to Atlas.
- Updates Google Consent Mode signals.
- Fires a `consent_update` event to the dataLayer when consent changes.

### 6. Test consent flow

1. Open your site in a browser.
2. Open the browser DevTools Console.
3. Check that `dataLayer` contains a consent state object on page load.
4. Accept or decline consent in the banner.
5. Verify the dataLayer updates accordingly.

---

## Consent Records

Atlas stores a consent record for each user interaction. To view:
1. Go to **Consent Hub → Consent Records**.
2. Filter by date range, consent category, or state.

Consent records are useful for GDPR audit trails.

---

## Tips & common mistakes

- **Install the consent script before GTM.** If GTM fires before consent signals are set, Google Consent Mode will default to `denied` and you may lose conversion data.
- **Test with ad blockers enabled.** Your CMP and consent script should degrade gracefully when blocked.
- **Don't set marketing to `granted` by default for EEA users.** This is a legal requirement in most European jurisdictions.
- **Atlas blocks CAPI events automatically.** You don't need to manually gate your server-side calls — Atlas checks consent state before every delivery.
