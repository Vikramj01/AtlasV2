# Platform Connections

**Available on:** Pro

Platform Connections links your ad platform and analytics accounts to Atlas via OAuth. Once connected, Atlas can pull live configuration and performance data to power reconciliation, implementation health checks, and the Data Manager Console.

---

## What it does

- OAuth connections to **Google Ads**, **Meta**, **GA4**, and **GTM**.
- Supports **manager accounts** (Google Ads MCC, Meta Business Manager) with child account discovery.
- Encrypts all OAuth tokens at rest using AES-256-GCM.
- Syncs account data (conversion actions, ad sets, event volumes) on demand or on schedule.
- Powers [Platform Reconciliation](./reconciliation.md) and [Implementation Health Checks](./implementation-health.md).

---

## Prerequisites

- Pro plan or above.
- Admin access to the ad platform accounts you want to connect.

---

## Connecting a Platform

### Google Ads

1. Go to **Platform Connections** in the sidebar.
2. Click **Add connection → Google Ads**.
3. Choose the connection type:
   - **Manager account (MCC)** — connects the top-level manager account and discovers child accounts.
   - **Standalone account** — connects a single Google Ads account directly.
4. Click **Connect with Google** — you will be redirected to Google's OAuth consent screen.
5. Authorise Atlas to access your Google Ads data.
6. You are returned to Atlas. The connection appears as **Connected**.
7. If you connected a manager account, click **Discover accounts** to pull the list of child accounts. Select which child accounts to include.

### Meta

1. Click **Add connection → Meta**.
2. Click **Connect with Facebook**.
3. Authorise Atlas on the Meta OAuth screen — grant access to your ad accounts and pixel data.
4. Select the ad account(s) and pixel(s) to connect.
5. Click **Confirm**.

### GA4

1. Click **Add connection → GA4**.
2. Click **Connect with Google**.
3. Authorise Atlas to access your Google Analytics data.
4. Select the GA4 property to connect.

### GTM (Google Tag Manager)

1. Click **Add connection → GTM**.
2. Click **Connect with Google**.
3. Authorise Atlas to access your GTM containers.
4. Select the GTM container to connect.
5. Alternatively, click **Manual upload** to upload a GTM container JSON file without OAuth.

---

## Managing Connections

From the Platform Connections page, you can:
- **Test** a connection — sends a lightweight API call to verify the token is still valid.
- **Disconnect** — revokes the connection and deletes the stored token.
- **Re-connect** — refresh expired OAuth tokens.
- **Discover accounts** (Google Ads MCC) — re-scan for new child accounts under a manager.

---

## Connection Statuses

| Status | Meaning |
|---|---|
| Connected | Token is valid, last sync successful |
| Token expired | OAuth token needs refreshing — click Re-connect |
| Error | Last sync failed — click Test to diagnose |
| Disconnected | Connection removed |

---

## Tips & common mistakes

- **Use a service account where possible.** Personal OAuth tokens can expire or be revoked if the authorising user leaves the organisation. For production, use a shared Google account or service account.
- **Google Ads MCC vs standalone.** If you manage multiple accounts under a manager, connect the MCC — you can then select individual child accounts rather than connecting each one separately.
- **Meta connection requires Business Manager.** You must be an admin on the Meta Business Manager that owns the ad accounts and pixels.
- **GTM OAuth scope is read-only by default.** Atlas can read your container for health checks but cannot publish changes on your behalf.
