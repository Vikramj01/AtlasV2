# Planning Mode — End-to-End Test Guide (PM-5.9)

> **Who runs this:** Developer (or Vikram playing the role of a non-technical marketer).
> **When:** After PM-5 is deployed to staging. Run once per test site.
> **Goal:** Verify the full 7-step flow works without needing documentation.

---

## Prerequisites

- [ ] Backend running (`cd backend && npm run dev`)
- [ ] Frontend running (`cd frontend && npm run dev`)
- [ ] Redis running (for Bull job queue)
- [ ] `.env` has valid `ANTHROPIC_API_KEY`, `BROWSERBASE_API_KEY`, `SUPABASE_*` keys
- [ ] Supabase storage buckets `planning-screenshots` and `planning-outputs` exist with correct policies
- [ ] Logged in as a test user in the browser

---

## Test Sites

Run the full flow once for each site type:

| # | Site | Business Type | Notes |
|---|------|---------------|-------|
| A | [Shopify Demo Store](https://shopify-demo.com) or any live Shopify store | E-commerce | Should detect add-to-cart, checkout, purchase |
| B | Any SaaS pricing page (e.g. a demo/public SaaS site) | SaaS | Should detect sign-up, lead form |
| C | A simple contact-form site | Lead Gen | Should detect form submit |

---

## Step-by-Step Checklist

### Step 1 — Setup

- [ ] Navigate to `/planning` — dashboard loads with no errors
- [ ] Click "New Plan" — redirected to `/planning/new`
- [ ] Step 1 form renders with URL input, business type selector, and platform checkboxes
- [ ] Enter an invalid URL (e.g. `not-a-url`) → shows inline validation error
- [ ] Enter a valid URL (e.g. `https://example.com`) → validation clears
- [ ] Select a business type (all 4 options work)
- [ ] Deselect all platforms → "Select at least one platform" warning appears; Continue button disabled
- [ ] Re-select platforms → warning clears; Continue button enabled
- [ ] Click Continue → advances to Step 2

### Step 2 — Page Discovery

- [ ] Homepage URL is pre-populated (cannot be removed)
- [ ] Type a relative path `/checkout` → click Add → resolves to full URL and appears in list
- [ ] Type a full URL `https://example.com/cart` → click Add → appears in list
- [ ] Type a duplicate URL → "This URL is already in the list" error
- [ ] Click a suggested page chip → adds correctly; chip disappears from suggestions
- [ ] Add 10 pages → input disappears (max reached)
- [ ] Remove pages with ✕ (cannot remove homepage)
- [ ] Click "Scan N pages →" → loading spinner appears; navigates to `/planning/:id`

### Step 3 — Scanning Progress

- [ ] Progress bar appears and increments as pages are scanned
- [ ] Each page shows a spinner while scanning, then ✓ or ✗
- [ ] Failed pages show "Error" tooltip with message on hover
- [ ] Successful pages show a page-type badge (e.g. "checkout", "homepage")
- [ ] When all pages finish → "Scan complete!" message appears briefly then auto-advances to Step 4
- [ ] **Error path:** If the session scan fails (e.g. Browserbase unavailable) → "Scan failed" state shows with "Try again" and "Back to Dashboard" buttons

### Step 4 — Review Recommendations

- [ ] Page tabs appear (one per scanned page); tab counts show `(0/N)`
- [ ] Annotated screenshot appears on the left (desktop only)
- [ ] Recommendation cards appear on the right
- [ ] Clicking a recommendation card highlights the corresponding bounding-box overlay on the screenshot
- [ ] Clicking a bounding-box overlay highlights the card on the right
- [ ] **Approve:** Click "✓ Approve" → card border turns green; tab count increments; API call fires
- [ ] **Skip:** Click "— Skip" → card is greyed out; tab count increments
- [ ] **Edit:** Click "✎ Edit" → inline text input appears; change event name; click Save → card shows "✎ Customised"; API call fires
- [ ] **Change decision:** Click "change" link → decision resets; new buttons appear
- [ ] "Approve N high-confidence" batch button appears when there are ≥0.8 confidence undecided recs; clicking it approves them all
- [ ] "+ Custom element" → modal opens; fill form; click "Add Element" → new card appears marked as approved
- [ ] "Continue to Summary" button is **disabled** until all recommendations have a decision
- [ ] Once all decided → "Continue to Summary" becomes active; clicking it advances to Step 5
- [ ] **Mobile:** On a screen <1024px → amber banner appears ("use a desktop browser"); screenshot column hidden

### Step 5 — Tracking Plan Summary

- [ ] Platforms section shows correct platform badges for the session
- [ ] Approved events are grouped by page with event names shown as code badges
- [ ] Skipped events appear with strikethrough
- [ ] Estimated hours = `ceil(approved_count * 0.5)` — verify manually
- [ ] If 0 events approved → warning message; Generate button disabled
- [ ] Click "Generate Implementation Files →" → loading spinner with "Generating files…" text
- [ ] After success → automatically advances to Step 6

### Step 6 — Generated Outputs

- [ ] Three output cards appear: GTM Container JSON, DataLayer Specification, Implementation Guide
- [ ] **GTM Container card:**
  - Click "Preview" → modal opens with JSON in `<pre>` block
  - JSON is valid (copy-paste into a JSON validator)
  - `exportFormatVersion` is `"2"` in the JSON
  - Click "Download .json" → file downloads with `.json` extension
  - Import the downloaded JSON into GTM → no import errors
- [ ] **DataLayer Spec card:**
  - Click "Preview" → modal opens with JSON
  - Code snippets are present in the `pages[].events[].code_snippet` fields
  - Click "Download .json" → downloads correctly
- [ ] **Implementation Guide card:**
  - Click "Preview" → HTML guide renders in the iframe
  - Guide is readable; shows platform setup instructions, event table, testing checklist
  - Click "Download .html" → downloads a self-contained HTML file that opens in a browser
- [ ] GTM import instructions panel is visible
- [ ] "Next: Handoff to Audit Mode →" button advances to Step 7

### Step 7 — Download & Handoff

- [ ] "Your tracking plan is ready!" success state renders
- [ ] All 3 output files listed with download buttons
- [ ] 4-step next-steps guide is visible
- [ ] **Start Audit:** Click "Set Up Audit Mode →" → loading spinner → navigates to `/journey/:id/spec` (Journey Builder)
  - Journey in the builder has correct name (`Tracking Plan — https://...`)
  - Stages match the scanned pages (one stage per page with approved recs)
  - Platforms match the session's selected platforms
- [ ] "Return to Dashboard" → navigates to `/planning`; session shows "Ready" status in the table

---

## Error Handling Tests

Run these separately from the happy path:

| Scenario | How to trigger | Expected behaviour |
|----------|---------------|-------------------|
| **404 session URL** | Navigate to `/planning/nonexistent-id` | "Session not found" screen with "Back to Dashboard" button |
| **Rate limit (429)** | Exhaust free plan (create 1 session on free tier), then try to create another | Redirected to dashboard; amber "Plan limit reached" upgrade banner shown |
| **Network failure during polling (Step 3)** | Disconnect network while scan is running | After 5 failed polls: "Lost connection to the server" error; stop/restart buttons appear |
| **Generation error (Step 5)** | Mock a backend 500 on `/generate` | "Generation failed" error with Retry button; clicking Retry re-calls the API |
| **Session is `failed` status** | Manually set a session to `failed` in DB | When opening `/planning/:id`, routes to Step 3 showing failed state |

---

## Output Quality Checks

These are manual quality checks, not pass/fail automated tests:

### GTM Container JSON

- [ ] The container imports without errors into GTM sandbox
- [ ] All expected tags are present (one per platform, plus consent init tag)
- [ ] GA4 base tag and event tags are present
- [ ] Google Ads conversion tag is present (if Google Ads was selected)
- [ ] Meta Pixel tag is present (if Meta was selected)
- [ ] Consent Mode v2 initialisation tag is present
- [ ] Each tag fires only on its correct trigger (not all pages)
- [ ] Variable names are clear (e.g. `DLV - event_name`, not generated UUIDs)

### DataLayer Specification

- [ ] Code snippets are syntactically valid JavaScript
- [ ] Placeholder values use `{{UPPER_CASE}}` convention consistently
- [ ] Comments explain what each placeholder value should be
- [ ] The GTM installation snippet is present at the top
- [ ] Developer notes section is present and readable

### Implementation Guide HTML

- [ ] Opens correctly in Chrome, Firefox, and Safari (standalone file)
- [ ] Executive summary section shows stats (pages scanned, events, platforms)
- [ ] Per-page event cards show the event name, selector, and code snippet
- [ ] GTM import steps section is accurate
- [ ] Testing checklist section is present
- [ ] No Atlas-internal jargon — readable by a non-technical marketing manager

---

## Regression Tests

After completing PM-5, verify that existing features still work:

- [ ] `/journey/new` — Journey Builder still loads and functions
- [ ] `/dashboard` — Audit history table still loads
- [ ] Creating an audit from a journey still works
- [ ] Sidebar shows "Plan Tracking" item and navigates correctly

---

## Known Limitations (Not Bugs)

- **Annotated screenshot coordinates:** Bounding boxes from Claude AI may not be pixel-perfect. This is acceptable for MVP — the numbered overlays guide users to the right area of the page.
- **Custom elements have no backend persistence:** Custom elements added in Step 4 are stored in the Zustand store only. If the user refreshes, they are lost. This is a known MVP limitation.
- **Download All ZIP:** Not implemented in MVP — three individual download buttons are provided instead.
- **Mobile planning wizard:** Steps 1–3 work on mobile; Step 4 (annotated screenshot) is desktop-only. An amber banner warns mobile users.
