# Offline Conversions

**Available on:** Pro

Offline Conversions lets you upload CRM or offline conversion data to Google Ads, closing the loop between ad clicks and sales that happen outside your website (phone calls, in-store, long sales cycles).

---

## What it does

- Accepts CSV uploads containing GCLID, conversion name, conversion time, and optional value.
- Validates each row before upload (format, required fields, GCLID syntax).
- Hashes PII (email, phone) automatically before transmission.
- Uploads validated data to Google Ads via the `uploadClickConversions` API.
- Reports per-row success and errors so you can fix and re-upload.

---

## Prerequisites

- Pro plan or above.
- A Google Ads [platform connection](./platform-connections.md) with conversion upload permissions.
- GCLID capture implemented on your site (see the [GCLID capture script](./site-scan.md#the-implementation-guide) from the AI Site Scan).

---

## Step-by-step

### 1. Configure offline conversions

Before uploading, configure your conversion actions:

1. Go to **Conversion API → Offline Conversions**.
2. Click **Configure**.
3. Enter your Google Ads **Customer ID**.
4. Add the conversion action names you want to upload against (must match exactly what's in Google Ads).
5. Set default currency if your values are in a consistent currency.
6. Click **Save configuration**.

### 2. Prepare your CSV

Your CSV must include the following columns:

| Column | Required | Format | Example |
|---|---|---|---|
| `gclid` | Yes | Google click ID string | `CjwKCAjw...` |
| `conversion_name` | Yes | Match Google Ads action name | `Qualified Lead` |
| `conversion_time` | Yes | ISO 8601 | `2026-06-01T14:30:00+01:00` |
| `conversion_value` | No | Decimal number | `250.00` |
| `currency_code` | No | ISO 4217 | `GBP` |
| `email` | No | Raw email (hashed before upload) | `user@example.com` |
| `phone` | No | E.164 format | `+447700900000` |

Download the template CSV from the upload page for a ready-to-fill example.

### 3. Upload the CSV

1. Go to **Conversion API → Offline Conversions → Upload**.
2. Click **Choose file** and select your prepared CSV.
3. Click **Upload**.
4. Atlas validates each row and shows a **Validation Report**:
   - **Valid rows** — ready to submit to Google Ads.
   - **Invalid rows** — listed with the specific error (missing GCLID, wrong date format, etc.).
5. Fix invalid rows in your CSV and re-upload, or proceed with only the valid rows.
6. Click **Confirm upload** to submit to Google Ads.

### 4. Monitor upload history

Go to **Offline Conversions → History** to see:
- All previous upload jobs.
- Status: Pending / Processing / Completed / Failed.
- Row counts: Total / Uploaded / Failed.
- Google Ads API response for each job.

---

## GCLID Capture

GCLIDs are only available for 90 days after the click. To capture them:

1. Add the GCLID capture script (from your AI Site Scan implementation guide) to your site `<head>`.
2. Add hidden form fields to capture the GCLID value at lead submission.
3. Store the GCLID in your CRM against the lead/contact record.
4. When the lead converts (e.g. closes as a sale), include the stored GCLID in your upload CSV.

---

## Tips & common mistakes

- **Upload within 90 days of the click.** GCLIDs expire. Build a regular upload cadence (weekly or monthly) into your CRM workflow.
- **Conversion time must be after the click time.** Google rejects rows where the conversion timestamp precedes the click.
- **Match Google Ads action names exactly.** A single character difference (including capitalisation) will cause the row to fail.
- **Atlas nulls raw PII after processing.** Email and phone are hashed and then removed from storage. You cannot retrieve them after upload.
