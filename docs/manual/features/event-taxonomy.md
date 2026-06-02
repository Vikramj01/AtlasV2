# Event Taxonomy

**Available on:** Free

The Event Taxonomy is a structured tree of all tracking event types, with platform mappings showing how each event relates to GA4, Google Ads, and Meta naming conventions.

---

## What it does

- Provides a searchable, hierarchical catalogue of tracking events.
- Shows how each event maps to GA4 recommended events, Google Ads action types, and Meta standard events.
- Lets you extend the taxonomy with custom events for your organisation.
- Signals in your [Signal Library](./signal-library.md) reference taxonomy events for platform mapping consistency.

---

## Prerequisites

- An Atlas account (free tier or above).

---

## Browsing the Taxonomy

The taxonomy is organised as a tree:

```
E-commerce
  ├── purchase
  ├── begin_checkout
  ├── add_to_cart
  ├── view_item
  └── remove_from_cart
Lead Generation
  ├── generate_lead
  ├── sign_up
  └── form_start
Engagement
  ├── page_view
  ├── scroll
  └── click
...
```

1. Navigate to the taxonomy from **Tag Library → Taxonomy** (or search within the Signal Library).
2. Expand categories to browse events.
3. Click an event to see:
   - **Description** — what this event represents.
   - **Platform mappings** — GA4 event name, Google Ads action type, Meta standard event.
   - **Recommended parameters** — fields to include with this event.

---

## Searching the Taxonomy

Use the search bar to find events by name or keyword. Results show matching events across all categories.

---

## Adding Custom Events

Organisation-specific events (events that don't fit the system taxonomy) can be added:

1. Go to the taxonomy page.
2. Click **Add event**.
3. Enter:
   - **Name** — human-readable label.
   - **Slug** — the event key (snake_case, validated against [naming conventions](./naming-conventions.md)).
   - **Category** — which taxonomy category this event belongs to.
   - **Description** — what this event represents.
   - **Platform mappings** — how it maps to GA4, Google Ads, and Meta.
4. Click **Save**.

Custom events appear in the taxonomy tree under their category and are available to select when building signals.

---

## Editing Events

- **System events** (shipped with Atlas) cannot be edited or deleted.
- **Custom events** (created by your organisation) can be edited or deleted. Deleting a custom event that is referenced by a signal will show a warning.

---

## Tips & common mistakes

- **Use standard taxonomy events where possible.** System events have validated platform mappings. Custom events require you to maintain the mappings manually.
- **Taxonomy events power Signal Library platform mappings.** When you create a Signal that references a taxonomy event, it inherits the platform mappings automatically. Changing a taxonomy event's mapping updates all signals referencing it.
- **Platform naming is not always 1:1.** For example, Meta's `Purchase` event maps to GA4's `purchase` event and Google Ads' "Purchase" conversion action — but the parameter names and structures differ. The taxonomy stores the correct mapping for each platform.
