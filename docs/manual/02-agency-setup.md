# Agency Setup

**Available on:** Agency plan

This guide covers setting up your agency workspace in Atlas: creating clients, configuring team access, and deploying signal templates.

---

## 1. Your Agency Workspace

When you log in as an agency user, the sidebar shows your **organisation workspace** with these sections:

- **Overview** — agency-wide health summary
- **Clients** — list of all client accounts
- **Data Manager** — cross-client DMA/Customer Match console
- **Tracking Map** — your signal library
- **Templates** — reusable signal packs
- **Site Scan, Audit Engine, CAPI, Consent** — shared tooling

---

## 2. Add a Client

Each client gets their own configuration, signals, CAPI setup, and platform connections.

1. Go to **Clients** in the sidebar.
2. Click **Add client**.
3. The **Client Setup Wizard** opens with 6 steps:

### Step 1 — Basic details
- Enter the client's **name** and **website URL**.
- Select their **industry** from the dropdown.

### Step 2 — Business type
- Choose the business model: E-commerce, Lead Gen, B2B SaaS, Marketplace, Nonprofit, or B2B Lead Gen.
- This determines the default signal pack and journey template used.

### Step 3 — Platform configuration
- Enter platform IDs (Google Ads customer ID, Meta Pixel ID, GA4 Measurement ID) if available.
- These can be added or updated later.

### Step 4 — Identity field mapping
- Map your client's dataLayer field paths to identity identifiers (email, phone, click IDs).
- This powers CAPI match quality and enrichment scoring.
- Click **Save** to save the identity config, or **Skip** to configure later.
- See [Signal Enrichment](./features/signal-enrichment.md) for full details.

### Step 5 — Page configuration
- Define the key pages on the client's site (homepage, product, checkout, confirmation, etc.)
- These pages are used as context for audit runs and site scans.

### Step 6 — Review & create
- Review all settings and click **Create client**.

The new client appears in your client list. Click the client name to open their **Client Detail Page**.

---

## 3. Client Detail Page

The Client Detail Page is the central hub for each client. It contains tabs for:

| Tab | What's here |
|---|---|
| **Overview** | Health score, recent audit, signal summary |
| **Signals** | Deployed signals for this client |
| **Enrichment** | Enrichment score, identity config, signal field mappings |
| **Platforms** | Connected ad platforms and GA4 |
| **CAPI** | Conversion API providers |
| **Reconciliation** | Platform config and volume diffs |
| **Settings** | Client name, URL, industry |

---

## 4. Deploy Signal Packs

Signal packs are reusable bundles of tracking events that can be deployed to clients in one step.

1. Go to **Templates** in the sidebar.
2. Browse system packs (e-commerce, lead gen, etc.) or create a custom pack.
3. Click **Deploy** on a pack.
4. The **Deployment Wizard** opens:
   - **Step 1** — Select the target client and confirm the signals to deploy.
   - **Step 2** — Configure signal enrichment (value field, currency, dedup ID, content IDs). This can be skipped and completed later from the client's Enrichment tab.
5. Click **Deploy**. The signals are now active for that client.

---

## 5. Invite Client Users

You can give client-side team members (e.g. developers, in-house marketers) access to their specific workspace:

1. Go to **Team & Settings → Team**.
2. Click **Invite member**.
3. Enter their email and assign the **Member** role.
4. Once they accept, they can access the client workspace and the [Developer Portal](./roles/agency-client.md).

---

## 6. Generate Outputs for a Client

Once signals are deployed, generate the GTM container and dataLayer spec:

1. Open the **Client Detail Page**.
2. Click **Generate outputs** (or navigate to the Signals tab).
3. Atlas generates:
   - A **GTM container JSON** ready to import into Google Tag Manager.
   - A **dataLayer spec** with code snippets for your developer.

The GTM container includes identity DataLayer Variables if the client has an identity config saved.

---

## 7. Data Manager Console

The Data Manager Console gives you an agency-wide view of Customer Match / DMA health across all clients.

1. Go to **Data Manager** in the sidebar.
2. The console shows each client's:
   - GTG (Google Tag Gateway) active status
   - Average match rate
   - Upload success rate
   - Members pushed in the last 30 days
   - Actions needed (low match rate, DMA not connected, etc.)
3. Click **Export CSV** for a full report.

See [Bid Signal Enricher](./features/bid-signal-enricher.md) for how to push Customer Match audiences.

---

## Next Steps

- Follow the [Agency Admin role guide](./roles/agency-admin.md) for a full end-to-end workflow.
- Set up [Platform Connections](./features/platform-connections.md) to start reconciling data.
- Configure [CAPI](./features/capi.md) for server-side event delivery.
