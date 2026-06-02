# Agency Client / Developer Guide

This guide is for client-side users and developers who are receiving tracking implementation guidance from an Atlas-using agency.

---

## What You Have Access To

As a client user or developer, you typically interact with Atlas through:

1. **The Developer Portal** — a shareable, public-facing page with your implementation spec.
2. **Your client workspace** — if your agency has given you a direct login.

---

## The Developer Portal

Your agency will share a Developer Portal link with you. This is a standalone page (no login required) that contains everything you need to implement the tracking spec.

### What's in the Developer Portal

- **GTM Container JSON** — a ready-to-import GTM container file containing all tags, triggers, and variables.
- **dataLayer Spec** — per-page code snippets showing exactly what `dataLayer.push()` calls to add and when.
- **GCLID / UTM capture script** — a small JavaScript snippet that captures click IDs and UTM parameters into first-party cookies.
- **Hidden form fields** — instructions for adding hidden fields to your lead forms to capture GCLID and UTM data.
- **Implementation guide** — step-by-step guidance for Enhanced Conversions for Leads (if applicable).

---

## Implementing the GTM Container

1. Log in to your Google Tag Manager account.
2. Go to **Admin → Import Container**.
3. Choose the JSON file provided by your agency.
4. Select **Merge** (not Overwrite) to add the new tags alongside any existing configuration.
5. Review the imported tags, triggers, and variables.
6. Click **Submit** and publish.

> Always test in GTM Preview mode before publishing to live.

---

## Implementing the dataLayer Spec

The dataLayer spec shows you exactly what JavaScript to add to your website pages.

For each page, you will find snippets like:

```javascript
// On the order confirmation page
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'purchase',
  transaction_id: '{{ORDER_ID}}',
  value: {{ORDER_VALUE}},
  currency: 'GBP',
  items: [...]
});
```

Replace the placeholder values (shown in `{{double_braces}}`) with your actual data variables.

**Important:** Push the dataLayer event *before* GTM fires. The recommended placement is in the `<head>` or at the top of the `<body>` on the relevant page.

---

## GCLID / UTM Capture

Add the capture script to your site's `<head>` tag, *above* the GTM snippet:

```html
<script>
  <!-- Paste the script provided by your agency here -->
</script>
```

This script reads URL parameters on landing and stores them in first-party cookies (`_gcl_aw`, `atlas_utm_source`, etc.) for up to 90 days. The values are then picked up by the hidden form fields on your lead forms.

---

## Hidden Form Fields

For each lead form on your site, add hidden fields as specified in the implementation guide. These fields are automatically populated by the GCLID/UTM capture script.

Example:
```html
<input type="hidden" name="gclid" id="atlas_gclid_field">
<input type="hidden" name="utm_source" id="atlas_utm_source_field">
```

---

## Testing Your Implementation

Your agency can run an **Audit Engine** check to verify your implementation. To help them:

1. Complete a test journey on your website (add to cart, submit a lead form, complete a purchase).
2. Confirm GTM Preview shows the expected `dataLayer` events firing.
3. Share the session recording or GTM debug URL with your agency contact.

---

## Getting Help

If something in the implementation guide isn't clear, contact your agency. They can:
- Re-run the site scan and update recommendations.
- Share an updated GTM container.
- Run a new audit to identify remaining gaps.
