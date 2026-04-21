# Atlas V2 — Sprint 1.5 PRD: Shell & Home Landing
**For:** Claude Code
**Repo:** `AtlasV2`
**Depends on:** Sprint 1 (language rewrite, Next Action endpoint, Atlas Score endpoint, mandatory Strategy Gate)
**Owner:** Vikram Jeet Singh
**Date:** 2026-04-20

---

## 1. Goal

Fix the app shell (logo, sidebar, landing route) and replace the empty Signal Health landing page with a proper Home that leads with the Next Action. Single column, graceful empty states, same layout on day 1 and day 100.

## 2. In scope

1. Logo and wordmark sizing in the sidebar header
2. Sidebar reorganisation — grouped sections, reordered items
3. Landing route change — Home replaces Signal Health as the post-login destination
4. Home page layout — Next Action card dominant, score tiles below, activity feed

## 3. Out of scope

- Split-screen layouts
- Mobile-specific redesign (desktop first; mobile must not break, but is not the focus)
- New endpoints beyond what Sprint 1 already delivers
- Any change to Signal Health page content — only its position in the sidebar and its default-route status change

---

## 4. Task 1 — Logo and wordmark

**File:** `frontend/src/components/layout/Sidebar.tsx` (header block)

**Current:** Small icon + "Atlas" wordmark at ~14px. Reads as a dev tool.

**Change:**
- Logo icon: 32px square (up from ~18–20px currently)
- Wordmark "Atlas": 20px, `font-weight: 600`, tracking-tight
- Header row vertical padding: `py-5` (up from current `py-3` or similar)
- Horizontal padding: `px-5`
- Divider below header: `border-b border-border` with `mb-3` spacing to next section

**Acceptance:**
- Logo + wordmark occupy roughly the visual weight of 2 sidebar list items.
- On a 1440px viewport the header reads as a brand anchor, not a footnote.
- Colour contrast preserved in both light and dark modes.

---

## 5. Task 2 — Sidebar reorganisation

**File:** `frontend/src/components/layout/Sidebar.tsx`

Replace the current flat list with grouped sections. Group headers are small uppercase labels (`text-xs font-medium text-muted-foreground uppercase tracking-wide`) matching the existing `WORKSPACE` / `ADMIN` style.

### 5.1 New sidebar structure

```
[Atlas logo + wordmark]
─────────────────────────

WORKSPACE
  Home                      (default route)

SET UP
  Set Up Tracking
  Verify Journeys
  Consent & Privacy
  Conversion API

MONITOR
  Signal Health
  Audit History
  Channel leak report

─────────────────────────
  Settings

ADMIN                       (super admin only)
  Platform Admin
```

### 5.2 Implementation notes

- Section headers are static — not collapsible in V1.
- Spacing: `mt-6` between groups, `mb-2` between header and first item.
- Active-state highlight stays the same (existing selected-item style).
- Route mappings unchanged — only the display order and grouping changes.
- `Home` route: `/` (if not already)
- Settings sits below the MONITOR group with a divider above it, not inside any group.
- ADMIN group only renders if `user.isSuperAdmin === true`.

### 5.3 Accessibility

- Group headers get `role="presentation"` — they are visual only, not navigable.
- Sidebar items remain in a `<nav>` with `aria-label="Main navigation"`.
- Tab order follows visual order top-to-bottom.

**Acceptance:**
- Sidebar renders in the exact order specified above.
- Group headers are visually distinct from nav items.
- Keyboard tabbing moves through items only, skipping group headers.
- No broken routes — every item navigates to its existing page.

---

## 6. Task 3 — Landing route change

### 6.1 Route default

**File:** `frontend/src/App.tsx`

- Post-login default redirect: `/` → `HomePage`
- Previous behaviour (landing on `/health` or similar) removed
- Any bookmarked old landing URLs continue to work — only the default redirect changes

### 6.2 HomePage existence

- If `HomePage.tsx` exists but is unused or stubbed, rebuild it per Task 4 below.
- If `/` currently routes to a marketing splash or login screen, add auth-aware routing: unauthenticated → `/login`, authenticated → `HomePage`.

**Acceptance:**
- Fresh login lands on Home, not Signal Health.
- `Home` in the sidebar is the active item by default.
- Signal Health remains reachable at its existing route, just no longer the default.

---

## 7. Task 4 — Home page layout

**File:** `frontend/src/pages/HomePage.tsx`

Single-column layout. Sections in order top to bottom. Max content width `max-w-6xl mx-auto px-6 py-8`.

### 7.1 Greeting block

```
Welcome back, {firstName}
{contextualSubline}
```

- `firstName` from `profile.full_name` (first token), or fallback to "there"
- Subline logic:
  - Morning (< 12:00 local): "Let's get your tracking in shape."
  - Afternoon (12:00–18:00): "Here's what's on Atlas today."
  - Evening (> 18:00): "Quick check before you wrap up."
- Heading: `text-2xl font-semibold`
- Subline: `text-muted-foreground text-sm mt-1`

### 7.2 Next Action card (dominant)

**Component:** `frontend/src/components/dashboard/NextActionCard.tsx` (from Sprint 1)

- Full width of the content column
- Large: minimum 140px height
- Contents: icon (left), action copy (heading + one sentence), ETA badge, CTA button (right-aligned primary)
- Consumes `GET /api/dashboard/next-action` (Sprint 1 endpoint)
- Loading state: skeleton
- Error state: neutral fallback "Run this week's tracking check" with CTA to `/audit/start`

This is the single biggest element on the page. Visual hierarchy must make this unmissable.

### 7.3 Score tiles row

Four tiles in a responsive grid:
- `lg:grid-cols-4`, `md:grid-cols-2`, `grid-cols-1`
- Gap: `gap-4`
- Margin top: `mt-8`

**Tiles:**

| Tile | Source | Empty state copy | Empty CTA |
|---|---|---|---|
| Atlas Score | `atlas-score.overall` | "Run setup to unlock your score" | → `/planning/strategy` |
| Setup | `atlas-score.foundation` as `completed / total` steps | "0 / 6 steps done" | → `/planning/strategy` |
| Match Quality | `atlas-score.signal_quality` | "Not live yet" | → `/capi` |
| Channel Leaks | `atlas-score.channel_performance` | "Not live yet" | → `/channels` |

**Tile component:** reuse or extend existing `ScoreCard` from `frontend/src/components/common/ScoreCard.tsx`.

**Rules:**
- Never show "No data" as the only message. Every empty state has a CTA that moves the user forward.
- When a tile has data, show the numeric score + delta vs last week (if available) + small status pill (`Healthy` / `Needs attention` / `Critical`).

### 7.4 Recent activity feed

Below the score tiles.

- Heading: "Recent activity" (`text-lg font-medium`)
- Empty state: "Your activity will show up here as you use Atlas." with no CTA — this is passive info.
- Populated state: list of 5 most recent events from across audits, CAPI sends, consent config changes, strategy briefs.
  - Each row: icon, one-line description, relative time ("2h ago")
  - Click → deep link to the relevant page

### 7.5 Endpoint for activity feed

**New endpoint:** `GET /api/dashboard/activity`
- Returns `{ data: Array<{ id, type, description, deep_link, created_at }>, error, message }`
- Pulls from: `capi_events` (last 10), `planning_sessions` (last 5), `consent_records` (last 5), `strategy_briefs` (last 5), `offline_conversion_uploads` (last 5) — merged, sorted by `created_at` desc, limited to 10.
- `planGuard('free')` — available to all plans.

**Acceptance:**
- On day 1 with no data: greeting, Next Action card (pointing to Strategy Gate), four empty-state tiles with CTAs, empty activity feed copy. No broken-looking empty panels.
- On day 30 with data: same layout, every tile populated, activity feed shows recent events, Next Action points at the highest-priority outstanding item.
- On mobile (<640px): everything stacks. No horizontal scroll.
- Page loads in under 600ms on a normal connection (tile and activity data can load async with skeletons).

---

## 8. Cross-cutting rules

1. No engineer jargon in any new copy — follows Sprint 1 language rewrite.
2. Every new component wrapped in `SectionErrorBoundary`.
3. Every async data load shows a skeleton.
4. TypeScript strict passes. No unused imports.
5. All new endpoints return `{ data, error, message }` shape.
6. Zod validation on the new `/api/dashboard/activity` endpoint request.

---

## 9. File changes summary

### Modified
- `frontend/src/components/layout/Sidebar.tsx` — logo size, group headers, reordered items
- `frontend/src/App.tsx` — default route to Home
- `frontend/src/pages/HomePage.tsx` — full rebuild per section 7
- `frontend/src/components/common/ScoreCard.tsx` — extend for empty-state CTA if needed

### New
- `frontend/src/components/dashboard/RecentActivityFeed.tsx`
- `backend/src/api/routes/dashboard.ts` — add `/activity` endpoint (extend existing file)
- `backend/src/services/database/dashboardQueries.ts` — add `getRecentActivity(orgId)` (extend existing file)

### Depends on from Sprint 1 (must ship first)
- `GET /api/dashboard/atlas-score` endpoint
- `GET /api/dashboard/next-action` endpoint
- `NextActionCard.tsx` component
- `AtlasScoreRing.tsx` component

---

## 10. Definition of done

- Fresh login lands on Home with logo/wordmark at the new size, sidebar grouped correctly.
- Empty-state Home has no "No data yet" dead ends — every tile offers a next step.
- Populated-state Home shows real scores, recent activity, and an accurate Next Action.
- Signal Health accessible from sidebar under MONITOR, not the default landing.
- QA pass on mobile, tablet, desktop — no overflow, no broken empty states.
- Visual regression check: compare before/after screenshots of Home, sidebar, login→landing flow.

---

**End of PRD.**
