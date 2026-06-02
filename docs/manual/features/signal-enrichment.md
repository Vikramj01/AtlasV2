# Signal Enrichment Configuration

**Available on:** Free

Signal Enrichment maps your dataLayer field paths to identity identifiers and signal parameters, so Atlas can automatically populate CAPI events with the right data — improving match quality scores, value-based bidding accuracy, and deduplication.

---

## What it does

- **Identity config** — maps client-side data fields to user identity fields (email, phone, click IDs, name, address).
- **Signal enrichment config** — maps dataLayer fields to conversion signal parameters (value, currency, dedup ID, content IDs).
- Computes an **enrichment score** (0–100) showing how well-configured the enrichment is.
- Estimates **Meta EMQ** (0–10) and **Google match rate** (%) based on the configured fields.
- Validates the configuration against 12 rules and surfaces warnings.

---

## Prerequisites

- At least one client created.
- At least one signal deployed to the client.

---

## Understanding Enrichment Scores

| Score | Colour | Meaning |
|---|---|---|
| 80–100 | Green | Excellent — all key fields mapped |
| 60–79 | Amber | Good — some recommended fields missing |
| 40–59 | Yellow | Fair — required fields missing, match quality impacted |
| 0–39 | Red | Poor — critical fields missing, CAPI delivery will be degraded |

The score is a composite of 50% identity score and 50% average signal score.

---

## Part 1: Identity Configuration

Identity config is set once per client and applies to all CAPI providers and signals.

### Accessing identity config

- **During client setup:** Step 4 of the Client Setup Wizard.
- **After setup:** Client Detail Page → **Enrichment** tab → **Identity Configuration** section.

### Fields to map

| Field | Priority | Description |
|---|---|---|
| `email_field` | **Required** | dataLayer path to the user's email address |
| `phone_field` | **High impact** | dataLayer path to the phone number |
| `fbc_field` | **High impact** | Path to the Facebook Click ID (usually `_fbc` cookie) |
| `fbp_field` | **High impact** | Path to the Facebook Browser ID (usually `_fbp` cookie) |
| `gclid_field` | **High impact** | Path to the Google Click ID |
| `first_name_field` | **Best practice** | dataLayer path to first name |
| `last_name_field` | **Best practice** | dataLayer path to last name |
| `postal_code_field` | **Best practice** | Postal/ZIP code |
| `country_field` | **Best practice** | Two-letter country code |
| `external_id_field` | **Best practice** | Your internal customer/user ID |

### Field path syntax

Use dot notation to reference nested dataLayer values:
- `user.email` → `dataLayer.user.email`
- `checkout.customer.phone_number` → `dataLayer.checkout.customer.phone_number`
- `_fbc` → top-level cookie value (if passed into dataLayer)

Click **Validate** next to any field to test the path against a sample event.

### Auto-capture options

- **Auto-capture IP** — Atlas automatically captures the user's IP address from the server request (no dataLayer mapping needed).
- **Auto-capture User Agent** — Atlas captures the browser user agent from the request headers.

Enable both for maximum Meta EMQ and Google match rate.

### Saving identity config

Click **Save identity config**. The enrichment score updates immediately.

---

## Part 2: Signal Enrichment Configuration

Signal enrichment is configured per signal per deployment. Conversion signals (purchase, generate_lead, begin_checkout) are the priority.

### Accessing signal enrichment

- **During deployment:** Step 2 of the Deployment Wizard.
- **After deployment:** Client Detail Page → **Enrichment** tab → signal tabs.

### Fields per signal

**Value configuration**
- `value_field` — dataLayer path to the event value (e.g. `ecommerce.value` or `order.total`).
- **Include tax** — whether the value includes tax (toggle).
- **Include shipping** — whether the value includes shipping costs.

**Currency configuration**
- Choose **Static** and enter a fixed currency code (e.g. `GBP`) — use this for single-currency sites.
- Choose **Dynamic** and enter a `currency_field` path — use this for multi-currency sites.

**Deduplication configuration**
- `dedup_id_field` — the field that uniquely identifies this event (e.g. `transaction_id`, `lead_id`). Required to prevent duplicate conversions.

**Content IDs** *(for Meta Advantage+ catalogue campaigns)*
- `content_ids_field` — path to an array of product IDs in the dataLayer.

**Platform enablement**
- Toggle **Meta**, **Google**, and **LinkedIn** to control which platforms receive this signal via CAPI.

### Validation rules

Atlas evaluates 12 rules against your configuration and flags errors and warnings:

| Rule | Severity | Check |
|---|---|---|
| IDENT_01 | Error | Email field must be mapped |
| IDENT_02 | Warning | Phone field recommended |
| IDENT_03 | Warning | At least one click ID (fbc/fbp/gclid) required |
| IDENT_04 | Info | External ID recommended |
| IDENT_05 | Info | First name + last name recommended |
| SIG_01 | Error | Purchase value field must be mapped |
| SIG_02 | Warning | Purchase currency should be configured |
| SIG_03 | Error | Purchase dedup ID must be mapped |
| SIG_04 | Warning | At least one conversion signal must be enabled for a platform |
| SIG_05 | Info | Purchase content IDs recommended for catalogue campaigns |
| CROSS_01 | Error | If conversion signals are enabled, identity must be configured |
| CROSS_02 | Warning | All Meta-enabled signals must have dedup IDs |

---

## Tips & common mistakes

- **IDENT_01 and SIG_03 are blocking errors.** If email and purchase dedup ID are not mapped, your CAPI match quality will be zero and duplicate conversions cannot be suppressed.
- **Use cookie paths for click IDs.** fbc/fbp are typically stored in cookies, not in the dataLayer. To use them, configure your site to read the cookie value and push it to the dataLayer on each page load.
- **Enrichment runs before CAPI delivery.** If enrichment fails (e.g. wrong field path), the event still delivers — it just delivers with less data. Check the Signal Tracking Dashboard for match quality scores.
