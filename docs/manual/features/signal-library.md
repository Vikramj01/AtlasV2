# Signal Library

**Available on:** Free

The Signal Library is your central registry of tracking events. It stores system signals (pre-built, standard events) and custom signals specific to your organisation, and lets you package and deploy them to clients in one step.

---

## What it does

- Provides a curated set of **system signals** covering common e-commerce, lead gen, and SaaS events.
- Lets you create **custom signals** for events unique to your business.
- Organises signals into **signal packs** — composable bundles you can deploy to any client.
- Generates a **GTM container** and **dataLayer spec** on deployment.

---

## Prerequisites

- An Atlas account (free tier or above).

---

## Understanding Signals

Each signal has:
- **Key** — the event name used in `dataLayer.push({ event: 'key' })` (e.g. `purchase`, `generate_lead`).
- **Name** — a human-readable label.
- **Category** — `conversion`, `micro_conversion`, `engagement`, `page_view`.
- **Required params** — parameters that must be present for the event to be valid.
- **Optional params** — additional parameters that improve data quality.
- **Platform mappings** — how this signal maps to GA4, Google Ads, and Meta event names.

---

## Browsing the Signal Library

1. Go to **Tag Library** (or **Tracking Map** in agency context) in the sidebar.
2. Browse signals by category or search by name/key.
3. Click a signal to view its full spec: params, platform mappings, and example `dataLayer.push`.

---

## Creating a Custom Signal

1. Click **Add signal**.
2. Enter:
   - **Key** (snake_case, e.g. `subscription_started`) — validated against your [naming conventions](./naming-conventions.md).
   - **Name** (human-readable).
   - **Category**.
   - **Required params** — add each param with name, type (string / number / array), and description.
   - **Optional params**.
   - **Platform mappings** — map to the equivalent GA4 event name, Google Ads action, and Meta standard event.
3. Click **Save signal**.

---

## Signal Packs

Signal packs are curated bundles of signals for a specific use case (e.g. "E-commerce Core", "Lead Gen Essential").

### System packs

Atlas ships with system packs covering:
- E-commerce (purchase, add_to_cart, begin_checkout, view_item)
- Lead Gen (generate_lead, sign_up, form_start)
- B2B SaaS (trial_started, demo_requested, plan_upgraded)

### Creating a custom pack

1. Go to **Tag Library → Packs** (or **Templates** in agency context).
2. Click **New pack**.
3. Enter a pack name and description.
4. Add signals to the pack — search and select from your signal library.
5. Click **Save**.

---

## Deploying Signals

The Deployment Wizard deploys a signal pack to a client and optionally configures [signal enrichment](./signal-enrichment.md).

### Step 1 — Select pack and client

1. Open a pack and click **Deploy**.
2. Select the target client.
3. Review the signals included in the pack.
4. Click **Deploy signals**.

### Step 2 — Configure signal enrichment *(optional)*

For conversion signals (purchase, generate_lead, begin_checkout), configure field mappings:
- **Value field** — the dataLayer field path containing the event value (e.g. `ecommerce.value`).
- **Currency** — static value (e.g. `GBP`) or a dynamic field path.
- **Dedup ID field** — the field used to deduplicate events (e.g. `transaction_id`).
- **Content IDs field** — for Meta Advantage+ catalogue campaigns.
- **Platform enablement** — toggle which platforms receive each signal via CAPI.

Click **Save enrichment config** or **Skip** to configure later.

After deployment, generate outputs:
1. From the Client Detail Page, click **Generate outputs**.
2. Download the GTM container JSON and dataLayer spec.

---

## Tips & common mistakes

- **System signals cannot be edited.** If you need a variation, create a custom signal.
- **Pack versioning.** The deployment records the pack version at time of deploy. If you update a pack, re-deploy to clients to push the changes.
- **Enrichment improves match quality.** Even if you skip enrichment during deployment, go back and complete it from the client's Enrichment tab — it directly affects CAPI match rates and value-based bidding accuracy.
