# Bid Signal Enricher

**Available on:** Pro (Enricher); Agency (Data Manager Console)

The Bid Signal Enricher pushes Customer Match audiences to Google's Data Manager API (DMA), enabling value-based bidding and audience targeting using your first-party CRM data.

---

## What it does

- Uploads hashed customer data (email, phone, address) to Google's Customer Match.
- Supports multiple destination accounts (Google Ads customer IDs).
- Tracks **match rates** per upload and surfaces trends.
- The **Data Manager Console** (agency plan) aggregates DMA health across all clients.

---

## Prerequisites

- Pro plan or above.
- A Google Ads [platform connection](./platform-connections.md) with Customer Match permissions.
- First-party customer data (email and/or phone numbers).

---

## Running an Enricher Job

### 1. Go to Bid Signal Enricher

Go to **Bid Signal Enricher** in the sidebar.

### 2. Configure destinations

1. Click **Add destination**.
2. Select a connected Google Ads account.
3. Set the **operation type**:
   - `ADD` — add members to the Customer Match list.
   - `REMOVE` — remove members from the list.
   - `CREATE_OR_REPLACE` — replace the entire list.
4. Click **Save destination**.

You can add multiple destinations to push the same audience to multiple accounts simultaneously.

### 3. Ingest data

1. Click **New enricher run**.
2. Select the **ingest type**:
   - **CSV upload** — upload a file with customer data.
   - **CRM sync** — connect directly to your CRM (if configured).
3. Select the destination(s) to push to.
4. Click **Start run**.

Atlas automatically:
- Hashes all PII (email, phone, name, address) using SHA-256 before transmission.
- Sends the hashed data to the Google DMA API.
- Records match counts and match rate.

### 4. Monitor results

From the enricher run list:
- **Status** — Pending / Processing / Completed / Failed.
- **Record count** — how many customers were in the upload.
- **Matched count** — how many Google matched against existing accounts.
- **Match rate** — percentage matched (target: >30% for meaningful audience size).

---

## Data Manager Console *(Agency)*

The Data Manager Console is an agency-wide view of Customer Match health across all clients.

1. Go to **Data Manager** in the sidebar.
2. For each client, you see:
   - **GTG active** — whether the Google Tag Gateway is deployed.
   - **Match rate** — average match rate over recent uploads.
   - **Upload success rate** — percentage of upload jobs that completed without error.
   - **Members (30d)** — total matched members pushed in the last 30 days.
   - **Destinations** — number of Google Ads accounts receiving this audience.
   - **Actions needed** — flags for GTG not deployed, DMA not connected, low match rate.

3. Click **Export CSV** for a full cross-client report.

---

## Match Rate Guidance

| Match rate | Status | Action |
|---|---|---|
| > 40% | Good | No action needed |
| 20–40% | Fair | Check identity config — ensure email and phone are mapped |
| < 20% | Poor | Review data quality; check hashing format; verify account permissions |

---

## Tips & common mistakes

- **Use normalised data.** Google's matching is sensitive to formatting. Email addresses should be lowercase and trimmed. Phone numbers should be in E.164 format (`+447700900000`).
- **Atlas hashes before transmission.** You do not need to pre-hash your CSV. Upload raw (unhashed) PII — Atlas handles hashing automatically.
- **Customer Match requires a minimum list size.** Google requires at least 1,000 matched members before a Customer Match list can be used for targeting.
- **Match rates improve with more identifiers.** Upload both email and phone where available — a customer matched on both identifiers counts as a single member but with higher confidence.
- **GTG must be deployed for real-time enrichment.** The Google Tag Gateway (GTG) enables enhanced signals. Check the Data Manager Console for GTG status per client.
