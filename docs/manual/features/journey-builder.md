# Journey Builder

**Available on:** Free

The Journey Builder maps the customer journey on your site or in your product and assigns tracking events to each stage. It produces a GTM container JSON and a dataLayer implementation spec for your development team.

---

## What it does

- Creates a multi-stage journey model (e.g. Awareness → Consideration → Purchase).
- Assigns a **proxy value** (£ amount) to each stage for value-based bidding.
- Tags each stage with a **buyer intent level** to guide optimisation strategy.
- Generates a GTM container and dataLayer spec for developers.

---

## Prerequisites

- An Atlas account (free tier or above).
- A [strategy brief](./conversion-strategy.md) is recommended but not required.

---

## Step-by-step

### 1. Create a new journey

1. Go to **Tracking Plan** in the sidebar.
2. Click **New journey**.
3. Enter a journey name (e.g. "Main purchase funnel — 2026").
4. Select your **business type**:
   - E-commerce
   - Lead Gen
   - B2B SaaS
   - Marketplace
   - Nonprofit
   - B2B Lead Gen

Atlas pre-populates a stage template for your business type. For example, B2B Lead Gen gives you a 7-stage template: Awareness → Engagement → Lead Capture → MQL → SQL → Opportunity → Closed Won.

### 2. Configure journey stages

For each stage, you can:
- **Rename** the stage to match your business terminology.
- Set the **proxy value (£)** — the monetary value of a user reaching this stage. Used for value-based bidding in Google Ads and Meta. Example values:
  - Page view: £0.10
  - Email sign-up: £5.00
  - Checkout started: £15.00
  - Purchase: £50.00 (or actual order value)
- Set the **buyer intent level**:
  - `problem_aware` — early stage, broad audience
  - `solution_aware` — mid-funnel, researching solutions
  - `vendor_aware` — late-funnel, evaluating your specific offering
- Add **tracking events** to the stage by selecting from the Signal Library.
- Add **timing metadata** — expected time-to-convert for this stage.

### 3. Add or remove stages

- Click **Add stage** to insert a new step.
- Drag stages to reorder them.
- Click the trash icon to remove a stage.

### 4. Link to a client (agency only)

If you are an agency user, you can link the journey to a specific client:
1. Click **Link to client**.
2. Select the client from the dropdown.

This makes the journey accessible from the Client Detail Page.

### 5. Generate the spec

1. Click **Generate spec**.
2. Atlas produces:
   - A **GTM container JSON** ready to import into Google Tag Manager.
   - A **dataLayer spec** with per-page JavaScript code snippets.
3. Click **View spec** to open the specification page.
4. Share the spec URL with your developer, or download the GTM container JSON.

---

## Reading the dataLayer Spec

The spec page shows, for each stage:
- The page(s) where the event should fire.
- The `dataLayer.push()` snippet with required and optional parameters.
- An example with placeholder values to make implementation clear.

Example:
```javascript
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'begin_checkout',
  value: 49.99,
  currency: 'GBP',
  items: [{
    item_id: 'SKU_001',
    item_name: 'Product Name',
    price: 49.99,
    quantity: 1
  }]
});
```

---

## Tips & common mistakes

- **Set realistic proxy values.** These values feed directly into value-based bidding. If you set them too high or too low relative to actual revenue, your campaigns will optimise incorrectly.
- **Use buyer intent levels consistently.** They map to audience segmentation signals downstream — keep them meaningful.
- **The journey and the Signal Library are linked.** Events you assign to journey stages come from your Signal Library. If you need a custom event, add it to the library first.
- **B2B Lead Gen journeys include 7 stages by default.** Remove stages that don't apply to your sales cycle rather than leaving them with zero proxy value.
