# Naming Conventions

**Available on:** Free

Naming Conventions lets you define organisation-level rules for how tracking events and parameters should be named. All new signals are validated against these rules in real time, and you can preview how existing signals would be renamed if you change the conventions.

---

## What it does

- Defines naming format rules for event names and parameter names (e.g. `snake_case`, `camelCase`, `PascalCase`).
- Validates new signal keys against the rules as you type.
- Shows a **rename preview** — which existing signals would change name if the convention is updated.
- Helps maintain consistency across a large signal library, especially important for agencies with many clients.

---

## Prerequisites

- An Atlas account (free tier or above).
- Organisation admin role.

---

## Configuring Naming Conventions

1. Go to **Team & Settings → Naming Conventions**.
2. Configure the event name rule:
   - **Format** — `snake_case`, `camelCase`, `PascalCase`, `kebab-case`.
   - **Prefix** — optional prefix all events must start with (e.g. `atlas_`).
   - **Max length** — maximum character count for event names.
3. Configure the parameter name rule:
   - Same format and length options as event names.
4. Click **Save**.

---

## Real-time Validation

When you create or edit a signal, the **Key** field is validated in real time against your naming convention:
- ✅ `purchase` — valid (snake_case).
- ❌ `Purchase` — invalid (should be `purchase`).
- ❌ `beginCheckout` — invalid (should be `begin_checkout`).

A red error message appears below the field with the specific rule that was violated.

---

## Rename Preview

Before saving a convention change, you can preview the impact:

1. Make your convention changes.
2. Click **Preview renames** (don't click Save yet).
3. Atlas shows a table of every existing signal that would be renamed, with the current name and the proposed new name.
4. Review the list. If you are happy, click **Save and apply**.

> Applying a rename updates signal keys across your library. This does not automatically update your deployed GTM containers or dataLayer implementations — those need to be updated separately.

---

## Naming Convention Best Practices

### Event names
- Use `snake_case` for consistency with GA4 recommended events and Meta standard events.
- Keep names short but descriptive: `begin_checkout` not `user_started_the_checkout_process`.
- Use present tense verbs: `purchase`, `generate_lead`, `sign_up`.
- Avoid generic names: `click`, `button_click` — prefer `cta_click`, `nav_click`, `hero_cta_click`.

### Parameter names
- Use `snake_case` to match GA4 parameter naming.
- Use standard names where they exist: `value`, `currency`, `transaction_id`, `item_id`.
- Prefix custom parameters with your org identifier to avoid conflicts: `my_org_lead_score`.

---

## Tips & common mistakes

- **Set naming conventions before building your signal library.** Renaming signals after deployment requires updating GTM containers and dataLayer implementations — expensive and error-prone.
- **Agencies should standardise across clients.** Consistent event naming makes cross-client reporting, benchmarking, and signal pack reuse significantly easier.
- **The rename preview is non-destructive.** Previewing renames does not make any changes — you must explicitly save and apply.
- **System signals are not renamed.** Atlas system signals (pre-built events like `purchase`) follow GA4 naming conventions by design and cannot be renamed by convention rules.
