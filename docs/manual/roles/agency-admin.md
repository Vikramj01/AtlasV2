# Agency Admin Guide

This guide walks you through the full Atlas workflow for an agency owner or lead managing tracking infrastructure across multiple clients.

---

## Phase 1: Workspace Setup

### 1.1 Create your organisation
See [Account Setup](../01-account-setup.md). Choose **Agency** as your organisation type and upgrade to the **Agency plan**.

### 1.2 Invite your team
Go to **Team & Settings → Team**. Invite team members with Admin or Member roles. Admins can manage billing and settings; Members get full feature access.

### 1.3 Set org-level naming conventions
Before adding clients, establish naming rules so all events and parameters are consistently named across your entire client portfolio.

1. Go to **Team & Settings → Naming Conventions**.
2. Set your preferred event naming format (e.g. `snake_case`, `camelCase`).
3. Define parameter naming rules.
4. Click **Save**. Atlas validates all new signals against these rules in real time.

See [Naming Conventions](../features/naming-conventions.md) for full details.

---

## Phase 2: Add Clients

For each client, follow the [Agency Setup → Add a Client](../02-agency-setup.md#2-add-a-client) flow. Run the 6-step Client Setup Wizard and pay particular attention to:

- **Step 3 (Platform config):** Enter platform IDs now if you have them — this enables reconciliation and CAPI setup immediately.
- **Step 4 (Identity mapping):** Map `email_field` and `phone_field` at minimum. This directly impacts CAPI match quality.

---

## Phase 3: Strategy & Planning

For each client, work through the setup checklist in this order:

### 3.1 Conversion Strategy Gate
Lock a strategy brief before scanning. This ensures the tracking plan is aligned with the client's campaign objectives.

1. Open the client's workspace (click client name → Overview).
2. Navigate to **Conversion Strategy** in the sidebar.
3. Create a brief, add objectives, evaluate each with Claude, and lock the brief.

### 3.2 AI Site Scan *(Pro)*
Run a site scan to discover existing tracking, identify gaps, and get AI-generated GTM recommendations.

1. Navigate to **Site Scan**.
2. Start a new scan for the client's domain.
3. Review and approve recommendations.
4. Save approved events to the Signal Library.

---

## Phase 4: Signal Deployment

### 4.1 Select or build a signal pack
Atlas ships with system signal packs for common business types. For agency clients you can:
- Use a system pack as-is.
- Clone a system pack and customise it for a vertical.
- Build a custom pack from scratch in **Templates**.

### 4.2 Deploy the pack
1. Go to **Templates**, find the pack, click **Deploy**.
2. Select the target client.
3. In Step 2 of the wizard, configure signal enrichment:
   - **Purchase:** map `value_field`, `currency`, `dedup_id_field`.
   - **Lead:** map `dedup_id_field`.
   - Enable platforms (Meta, Google) per signal.
4. Deploy.

### 4.3 Generate outputs
On the Client Detail Page, click **Generate outputs** to produce:
- GTM container JSON (includes identity DataLayer Variables if identity config is set).
- dataLayer implementation spec for the developer.

Send the spec to the client's developer via the [Developer Portal](./agency-client.md).

---

## Phase 5: CAPI Setup

For each client that needs server-side event delivery:

1. Open the client's **CAPI** tab.
2. Add a provider (Meta / Google / LinkedIn).
3. Complete the setup wizard — credentials, event mapping, dedup config.
4. Link the identity config from Step 4 of client setup to the CAPI provider.
5. Activate and test.

See [Conversion API](../features/capi.md) for full details.

---

## Phase 6: Platform Connections & Reconciliation

### 6.1 Connect platforms
Go to **Platform Connections** and add OAuth connections for Google Ads, Meta, GA4, and GTM for each client.

### 6.2 Run reconciliation
After locking the strategy brief and setting up CAPI:

1. Navigate to **Reconciliation**.
2. Click **Run reconciliation**.
3. Review findings across four dimensions: Config, Volume, Delivery, Alignment.
4. Set **tolerance thresholds** per event per platform (e.g. allow ±10% volume variance before flagging).
5. Resolve or dismiss findings.

Schedule regular reconciliation runs — Atlas can trigger them automatically post-brief-lock.

---

## Phase 7: Ongoing Health Management

### 7.1 Implementation Health Checks
1. Go to **Settings → Implementation Health**.
2. Connect or upload your GTM container.
3. Atlas runs tag configuration rule checks.
4. Promote a crawl run as a **baseline** — future runs diff against it to detect drift.

### 7.2 Data Manager Console *(Agency)*
The Data Manager Console gives you a cross-client view of Customer Match / DMA health.

1. Go to **Data Manager** in the sidebar.
2. Review match rates, upload success, and "Needs action" flags per client.
3. For clients with low match rates, check their identity config and signal enrichment settings.

### 7.3 Regular review cadence

| Cadence | Task |
|---|---|
| Daily | Signal Tracking Dashboard — check volume and match quality |
| Weekly | Health Dashboard — review alerts and health score trends |
| Weekly | Reconciliation — check for config/volume drift |
| Monthly | Audit Engine — run a full journey audit per client |
| Monthly | Implementation Health — check for GTM tag drift |
