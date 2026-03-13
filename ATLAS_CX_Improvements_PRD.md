# ATLAS Customer Experience Improvements — Product Requirements Document

## Document Purpose

This PRD defines a comprehensive set of customer experience improvements to the existing Atlas platform. Atlas is fully implemented and deployed with three working modes (Planning Mode, Journey Builder + Audit Mode, Direct Audit Mode). This document specifies enhancements to the existing system — not a new product.

This document is intended to be consumed directly by Claude Code as the implementation specification. All file paths, component names, API patterns, and conventions reference the existing AtlasV2 codebase as documented in CLAUDE.md.

### Guiding Principle

Every improvement in this PRD serves one goal: **reduce the time and effort it takes a non-technical marketer to go from "I need tracking on my site" to "my tracking is verified and working."** The current path has friction at multiple points. These improvements remove that friction systematically.

---

## 1. Improvement Areas — Prioritised

This PRD covers six improvement areas, ordered by impact:

| Priority | Improvement Area | Impact | Effort |
|----------|-----------------|--------|--------|
| P0 | **Developer Portal & Implementation Tracking** | Bridges the biggest gap in the product (planning → implementation → audit) | Large |
| P0 | **Smart Onboarding (URL-First Setup)** | Eliminates setup friction, delivers instant value | Medium |
| P1 | **Planning-to-Audit Feedback Loop** | Connects the two halves of the product into a single workflow | Medium |
| P1 | **GTM Container Preview & Confidence Builder** | Removes the #1 anxiety point (importing unknown JSON into GTM) | Medium |
| P2 | **Quick-Check Endpoint (Single Page Verification)** | Tightens the developer feedback loop from minutes to seconds | Small |
| P2 | **Incremental Re-Scan & Change Detection** | Solves the staleness problem for ongoing tracking maintenance | Medium |

---

## 2. P0: Developer Portal & Implementation Tracking

### 2.1 Problem

After Planning Mode generates outputs (GTM container JSON, dataLayer spec, implementation guide), the user downloads a ZIP file and sends it to a developer. Atlas has zero visibility into what happens next. The marketer doesn't know when the developer starts, what pages are done, or when everything is ready to audit. The developer receives a standalone file with no connection back to Atlas.

### 2.2 Solution

Add a **Developer Portal** — a separate, shareable view designed for the developer implementing the tracking code. The marketer generates a share link from their planning session; the developer opens it and sees exactly what to implement, page by page, with a progress checklist.

### 2.3 User Flow

**Marketer (existing user):**
1. Completes Planning Mode (existing Step 7 — `Step7DownloadAndHandoff.tsx`)
2. Sees a new "Share with Developer" button alongside the existing download buttons
3. Clicks it → Atlas generates a shareable link with a unique token
4. Copies the link and sends it to their developer (email, Slack, etc.)
5. Returns to their planning dashboard (`/planning`) and sees a new "Implementation Progress" column on their session row

**Developer (new user type — no Atlas account needed):**
1. Opens the shared link → `/dev/:shareToken`
2. Sees a clean, developer-focused view: no wizard, no marketing language, no scores
3. View shows:
   - Site name and URL at the top
   - A checklist of pages, each with:
     - Page name and URL
     - The dataLayer code to implement (copyable, with inline comments)
     - A status toggle: Not Started → In Progress → Implemented
     - A "Quick Check" button (see Section 7 below)
   - The GTM container file for download
   - Platform IDs section (if the marketer filled them in)
4. Developer works through pages, updating status as they go
5. When all pages are marked "Implemented", the marketer sees a notification

### 2.4 Database Changes

```sql
-- Share tokens for developer portal access
CREATE TABLE developer_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,           -- Cryptographically random token (32 chars)
  developer_name TEXT,                        -- Optional: developer can set their name
  developer_email TEXT,                       -- Optional: for notification delivery
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '90 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Implementation progress per page
CREATE TABLE implementation_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES developer_shares(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES planning_pages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'implemented', 'verified'
  )),
  developer_notes TEXT,                       -- Optional notes from the developer
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(share_id, page_id)
);

-- Indexes
CREATE INDEX idx_developer_shares_token ON developer_shares(share_token);
CREATE INDEX idx_developer_shares_session ON developer_shares(session_id);
CREATE INDEX idx_implementation_progress_share ON implementation_progress(share_id);

-- RLS: shares are accessed by token (no auth required) or by owning user
ALTER TABLE developer_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE implementation_progress ENABLE ROW LEVEL SECURITY;

-- Owner can manage their shares
CREATE POLICY "Users manage own shares" ON developer_shares
  FOR ALL USING (auth.uid() = user_id);

-- Progress is readable/writable via the share token (checked in application layer, not RLS)
-- For the developer portal, we use supabaseAdmin since the developer is unauthenticated.
-- The route handler validates the share_token and checks is_active + expires_at.
```

### 2.5 API Endpoints

Add new route file: `backend/src/api/routes/developer.ts`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/planning/sessions/:id/share` | JWT (owner) | Generate share token. Returns `{ share_token, share_url }` |
| `DELETE` | `/api/planning/sessions/:id/share/:shareId` | JWT (owner) | Revoke a share link |
| `GET` | `/api/planning/sessions/:id/share` | JWT (owner) | List active shares for a session |
| `GET` | `/api/dev/:shareToken` | None (public) | Get developer portal data (session, pages, recommendations, outputs, progress). Validates token + active + not expired. |
| `PATCH` | `/api/dev/:shareToken/pages/:pageId/status` | None (public) | Update page implementation status. Body: `{ status, developer_notes? }` |
| `GET` | `/api/dev/:shareToken/outputs/:outputId/download` | None (public) | Download a specific output file |
| `GET` | `/api/planning/sessions/:id/progress` | JWT (owner) | Get implementation progress summary (for marketer's dashboard view) |

**Important:** The `/api/dev/*` endpoints do NOT require JWT authentication. They authenticate via the share token. The backend validates: token exists, `is_active = true`, `expires_at > now()`. Use `supabaseAdmin` for these queries since there's no authenticated user context.

### 2.6 Backend Implementation

New files to create:

```
backend/src/
├── api/routes/developer.ts             ← Routes for /api/dev/* and /api/planning/sessions/:id/share
├── services/database/developerQueries.ts ← CRUD for developer_shares + implementation_progress
└── services/developer/shareService.ts  ← Token generation, validation, progress aggregation
```

**Token generation:** Use `crypto.randomBytes(24).toString('hex')` for share tokens (48 hex chars). This goes through `shareService.ts`, not directly in the route handler.

**Progress aggregation:** `GET /api/planning/sessions/:id/progress` returns:

```typescript
interface ImplementationProgress {
  total_pages: number;
  not_started: number;
  in_progress: number;
  implemented: number;
  verified: number;
  percent_complete: number;          // (implemented + verified) / total_pages * 100
  all_implemented: boolean;          // true when all pages are implemented or verified
  pages: PageProgress[];
}

interface PageProgress {
  page_id: string;
  page_label: string;
  page_url: string;
  status: 'not_started' | 'in_progress' | 'implemented' | 'verified';
  developer_notes: string | null;
  updated_at: string;
}
```

### 2.7 Frontend Implementation

#### New Page: Developer Portal

Create: `frontend/src/pages/DeveloperPortalPage.tsx`
Route: `/dev/:shareToken`
Layout: **No `AppLayout`** — this is a standalone page (like `AuditProgressPage`). No sidebar, no auth required. Clean, minimal layout with Atlas branding in the header.

This page does NOT use any Zustand store. It fetches all data from `GET /api/dev/:shareToken` on mount and manages state locally with `useState`.

**Page Structure:**

```
┌──────────────────────────────────────────────────────┐
│  Atlas logo            Developer Implementation View │
├──────────────────────────────────────────────────────┤
│  Site: example.com                                   │
│  Prepared by: marketer@agency.com                    │
│  Generated: March 14, 2026                           │
│                                                      │
│  Progress: ████████░░ 6/8 pages (75%)               │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [Download GTM Container]  [Download Full Spec]      │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ☑ Homepage                          [Implemented]   │
│  ☑ Category Page                     [Implemented]   │
│  ◌ Product Page                      [In Progress]   │
│    ┌─────────────────────────────────────────────┐   │
│    │ // PRODUCT PAGE — dataLayer code            │   │
│    │ window.dataLayer.push({                     │   │
│    │   event: 'view_item',                       │   │
│    │   ecommerce: { ... }                        │   │
│    │ });                                     [Copy]  │
│    │                                             │   │
│    │ // ADD TO CART — fires on button click       │   │
│    │ window.dataLayer.push({                     │   │
│    │   event: 'add_to_cart',                     │   │
│    │   ecommerce: { ... }                        │   │
│    │ });                                     [Copy]  │
│    └─────────────────────────────────────────────┘   │
│    [Quick Check This Page]                           │
│    Notes: ____________________________________       │
│                                                      │
│  ○ Cart                              [Not Started]   │
│  ○ Checkout                          [Not Started]   │
│  ☑ Purchase Confirmation             [Implemented]   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Each page section is an accordion — collapsed by default, expanded on click. The expanded view shows:
1. The dataLayer code for that page (from the generated `datalayer_spec` output), with a copy button per code block
2. A status dropdown: Not Started / In Progress / Implemented
3. An optional notes text field
4. A "Quick Check This Page" button (see Section 7)

#### New Components

Create in `frontend/src/components/developer/`:

| Component | Description |
|-----------|-------------|
| `DeveloperHeader.tsx` | Atlas-branded header with site name and progress bar. No nav, no auth. |
| `PageImplementationCard.tsx` | Accordion card per page. Shows code, status dropdown, notes, quick-check button. |
| `CodeSnippet.tsx` | Syntax-highlighted code block with a copy button. Uses a `<pre>` with Tailwind prose classes. No external syntax highlighting library — keep it lightweight. |
| `ProgressBar.tsx` | Visual progress bar showing implemented/total pages. Reuse or extend existing `common/` components. |

#### New API Client

Create: `frontend/src/lib/api/developerApi.ts`

```typescript
// This API client does NOT use the authenticated apiFetch.
// It makes unauthenticated requests to /api/dev/* endpoints.

export async function getDevPortal(shareToken: string): Promise<DevPortalData> { ... }
export async function updatePageStatus(shareToken: string, pageId: string, status: string, notes?: string): Promise<void> { ... }
export async function downloadOutput(shareToken: string, outputId: string): Promise<Blob> { ... }
```

#### Modifications to Existing Components

**`Step7DownloadAndHandoff.tsx`:** Add a "Share with Developer" button alongside the existing download buttons. Clicking generates a share link via `POST /api/planning/sessions/:id/share` and shows a copyable URL in a modal or inline reveal.

**`PlanningDashboard.tsx`:** Add an "Implementation" column to the session list table. Shows a mini progress indicator (e.g., "6/8 pages" or a small progress bar). Links to a detail view. If no share has been created yet, show "Not shared" with a link to generate a share.

**`planningApi.ts`:** Add functions: `createShare(sessionId)`, `listShares(sessionId)`, `deleteShare(sessionId, shareId)`, `getProgress(sessionId)`.

#### New Route

Add to the router in `frontend/src/`:

```typescript
{ path: '/dev/:shareToken', element: <DeveloperPortalPage /> }
// This route is NOT wrapped in ProtectedRoute — it's publicly accessible
```

---

## 3. P0: Smart Onboarding (URL-First Setup)

### 3.1 Problem

Step 1 of Planning Mode (`Step1PlanningSetup.tsx`) currently asks the user to manually enter: site URL, business type, ad platforms, and an optional business description. This takes 30-60 seconds and requires the user to make decisions ("am I ecommerce or marketplace?") that Atlas could infer automatically.

### 3.2 Solution

Replace the manual form with a **URL-first flow**: the user pastes a URL, Atlas performs a lightweight server-side detection scan (no Browserbase needed), and pre-fills everything based on what it finds. The user confirms rather than configures.

### 3.3 Technical Approach — Lightweight Site Detection

Create a new backend service that performs a fast, server-side-only check on a URL. This does NOT use Browserbase — it uses a simple HTTP fetch with HTML parsing.

New file: `backend/src/services/planning/siteDetectionService.ts`

```typescript
export interface SiteDetection {
  url: string;
  resolved_url: string;                     // After redirects
  site_title: string;
  detected_platform: DetectedPlatform | null;  // Shopify, WooCommerce, WordPress, etc.
  inferred_business_type: string;           // ecommerce, saas, lead_gen, content, etc.
  business_type_confidence: number;         // 0.0 to 1.0
  existing_tracking: ExistingTrackingQuick; // What tags are already installed
  detected_currency: string | null;         // From meta tags or hreflang
  detected_language: string | null;
}

export interface DetectedPlatform {
  name: string;                             // 'shopify', 'woocommerce', 'squarespace', 'wordpress', 'webflow', 'custom'
  version?: string;
  indicators: string[];                     // What gave it away (e.g., 'Shopify CDN detected', 'wp-content in HTML')
}

export interface ExistingTrackingQuick {
  gtm_detected: boolean;
  gtm_container_id: string | null;
  ga4_detected: boolean;
  ga4_measurement_id: string | null;
  meta_pixel_detected: boolean;
  meta_pixel_id: string | null;
  google_ads_detected: boolean;
  tiktok_detected: boolean;
  linkedin_detected: boolean;
}
```

**Detection logic:**

1. Fetch the URL with a standard `fetch()` (not Browserbase). Follow redirects. Set a 10-second timeout.
2. Parse the HTML response (use `cheerio` or simple regex — the HTML is static, we don't need JS execution):
   - Check for platform indicators:
     - Shopify: `cdn.shopify.com` in any script/link src, or `Shopify.` in inline scripts
     - WooCommerce: `woocommerce` in body class, `wp-content/plugins/woocommerce` in any src
     - WordPress: `wp-content` or `wp-includes` in any src
     - Squarespace: `static.squarespace.com` in any src
     - Webflow: `webflow.com` in any script src
   - Check for tracking scripts:
     - GTM: `googletagmanager.com/gtm.js` → extract container ID from the query param
     - GA4: `googletagmanager.com/gtag/js` → extract measurement ID
     - Meta Pixel: `connect.facebook.net/en_US/fbevents.js` → extract pixel ID from `fbq('init', '...')`
     - Google Ads: `googleadservices.com` or `gtag('config', 'AW-')`
     - TikTok: `analytics.tiktok.com`
     - LinkedIn: `snap.licdn.com`
   - Infer business type:
     - If Shopify or WooCommerce detected → `ecommerce`
     - If `/pricing` page linked from nav → likely `saas`
     - If "contact" form is prominent + no cart → likely `lead_gen`
     - If blog/articles dominate → `content`
     - Fallback → `custom` with low confidence
   - Extract currency from `<meta property="product:price:currency">`, `hreflang`, or Shopify `Shopify.currency`
   - Extract page title from `<title>` tag

**Cost:** Zero. This is a server-side HTTP fetch — no Browserbase, no AI, no external APIs. Takes ~1-3 seconds.

### 3.4 API Endpoint

Add to `backend/src/api/routes/planning.ts`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/planning/detect` | JWT | Lightweight site detection. Body: `{ url: string }`. Returns `SiteDetection`. |

This endpoint is NOT rate-limited by the planning limiter (it doesn't create a session). Add a separate lightweight rate limit: 10 requests per minute per user (to prevent abuse).

### 3.5 Frontend Changes

**Modify `Step1PlanningSetup.tsx`:**

Current flow: Form with URL field + business type selector + platform checkboxes + description textarea

New flow:

**State 1 — URL Entry (initial state):**
- Single prominent text input: "Paste your website URL"
- One button: "Scan"
- That's it — nothing else visible initially

**State 2 — Detection Results (after scan completes, ~2 seconds):**
The form expands to show pre-filled results:

```
✓ Site detected: Example Store (Shopify)
  Business type: Online Store [change]
  
✓ Existing tracking found:
  ☑ Google Analytics 4 (G-ABC123)
  ☑ Google Tag Manager (GTM-XYZ789)
  ☐ Meta Pixel — not detected [add]
  ☐ Google Ads — not detected [add]
  ☐ TikTok — not detected
  ☐ LinkedIn — not detected

Describe your business (optional):
[                                                    ]

[Continue →]
```

Everything is pre-filled but editable. The user reviews and clicks Continue. Total time: ~10 seconds (vs. 30-60 seconds with manual form).

**State 3 — Detection Failed:**
If the fetch fails (timeout, DNS error, Cloudflare block), fall back to the current manual form with a message: "We couldn't scan your site automatically. Please fill in the details below."

**Zustand store change:** Update `planningStore.ts` to add:

```typescript
interface PlanningStore {
  // ... existing fields ...
  siteDetection: SiteDetection | null;
  detectionLoading: boolean;
  detectionError: string | null;
  runDetection: (url: string) => Promise<void>;
}
```

**API client change:** Add to `frontend/src/lib/api/planningApi.ts`:

```typescript
export async function detectSite(url: string): Promise<SiteDetection> { ... }
```

### 3.6 Dependencies

Add `cheerio` to backend dependencies: `npm install cheerio` (for HTML parsing without JS execution). It's lightweight and well-maintained.

---

## 4. P1: Planning-to-Audit Feedback Loop

### 4.1 Problem

When an audit finds issues, the Gap Report (`GapReportPage.tsx`) and the standard report (`ReportPage.tsx`) show what's wrong — but with no connection to the tracking plan that defined what should be right. The user sees "purchase event missing" but can't trace it back to the planning session that specified it.

Additionally, after a developer implements tracking and the user runs an audit, there's no before/after comparison showing what improved.

### 4.2 Solution

Two enhancements:

#### 4.2.1 Link Audit Findings to Planning Sessions

When an audit is run from a Journey that was created via Planning Mode handoff, the audit results should reference the original planning session and show the trail: planning recommendation → implementation status → audit finding.

**Database change:** Add a column to the `journeys` table:

```sql
ALTER TABLE journeys ADD COLUMN source_planning_session_id UUID REFERENCES planning_sessions(id) ON DELETE SET NULL;
```

The existing handoff endpoint (`POST /api/planning/sessions/:id/handoff`) already creates a Journey. Modify it to also set `source_planning_session_id` on the created Journey.

**Backend change:** Modify `backend/src/services/database/journeyQueries.ts`:

In the `createJourneyFromHandoff()` function (or wherever the handoff creates the journey), include the `source_planning_session_id` in the insert.

**Backend change:** Modify `GET /api/audits/:id/gaps` response:

When the audit was run from a journey that has a `source_planning_session_id`, include planning context in each gap:

```typescript
interface GapWithPlanningContext {
  // ... existing gap fields ...
  planning_context?: {
    session_id: string;
    recommendation_id: string;
    original_recommendation: string;     // The AI's original business justification
    implementation_status: string;       // From developer_shares/implementation_progress if a share exists
    developer_notes: string | null;
  };
}
```

**Frontend change:** Modify `GapReportPage.tsx` and its child components:

When a gap has `planning_context`, show an additional section in the gap detail:

```
TRACKING PLAN CONTEXT:
Atlas recommended tracking this event on March 10, 2026.
AI recommendation: "This button triggers a purchase completion. Tracking this
lets Google Ads and Meta optimise for buyers."
Implementation status: Marked as "Implemented" by developer on March 12.
Developer notes: "Added dataLayer push in checkout-success.js"
```

This lets the marketer trace: "Atlas recommended it → the developer says they implemented it → the audit says it's not working → something is wrong with the implementation, not the plan."

#### 4.2.2 Before/After Comparison

When a user runs a second (or subsequent) audit on the same journey, show a comparison.

**Backend change:** Modify `GET /api/audits/:id/report` response:

When previous audits exist for the same journey, include a `comparison` field:

```typescript
interface ReportJSON {
  // ... existing fields ...
  comparison?: {
    previous_audit_id: string;
    previous_audit_date: string;
    previous_score: number;
    current_score: number;
    score_change: number;              // +/- points
    rules_fixed: string[];             // Rule IDs that went from fail → pass
    rules_regressed: string[];         // Rule IDs that went from pass → fail
    rules_unchanged_fail: string[];    // Still failing
  };
}
```

Query logic: For the current audit's `journey_id`, find the most recent completed audit with a different `audit_id`. Compare their `audit_results`.

**Frontend change:** Modify `frontend/src/components/audit/ReportPages/ExecutiveSummary.tsx`:

When `comparison` data is present, show a banner at the top of the Executive Summary:

```
IMPROVEMENT SINCE LAST AUDIT (March 10 → March 14)
Signal Health: 35% → 84%  (+49 points)
Fixed: 12 issues
Regressed: 1 issue
Still failing: 3 issues
```

Use green for improvements, red for regressions. This gives the marketer a clear win to show stakeholders.

---

## 5. P1: GTM Container Preview & Confidence Builder

### 5.1 Problem

The GTM container JSON is the most valuable output of Planning Mode, but also the most anxiety-inducing. Non-technical users don't know what's in the JSON file. Importing it into GTM feels high-stakes — "will this break my existing tags?"

### 5.2 Solution

Add an interactive **GTM Container Preview** to the outputs step (`Step6GeneratedOutputs.tsx`) that shows exactly what the container contains, in plain English, before the user downloads or imports it.

### 5.3 Implementation

This is a frontend-only change. The data already exists in the generated GTM container JSON output (stored in `planning_outputs` as `output_type = 'gtm_container'`). We just need to parse and display it.

#### New Component: GTM Container Preview

Create: `frontend/src/components/planning/GTMContainerPreview.tsx`

This component receives the parsed GTM container JSON and renders an interactive tree view:

```
GTM CONTAINER PREVIEW
What will be created when you import this file

📁 Configuration (2 items)
  ├─ GA4 Config Tag — Connects your site to Google Analytics 4
  │  Measurement ID: G-ABC123 (detected from your site)
  │  Fires on: All pages
  │
  └─ Conversion Linker — Captures ad click IDs (gclid) for Google Ads
     Fires on: All pages

📁 Conversion Events (3 items)
  ├─ GA4 Purchase Event — Sends purchase data to GA4
  │  Fires when: dataLayer event = "purchase"
  │  Sends: Order ID, total, currency, products
  │  Why: This is how GA4 counts your revenue
  │
  ├─ Google Ads Purchase Conversion — Reports sales to Google Ads
  │  Fires when: dataLayer event = "purchase"
  │  Sends: Order ID, total, currency
  │  Why: Google Ads Smart Bidding needs this to optimise campaigns
  │
  └─ Meta Purchase Event — Reports sales to Meta/Facebook
     Fires when: dataLayer event = "purchase"
     Sends: Order ID, total, products, currency
     Why: Meta needs this for purchase optimisation campaigns

📁 Engagement Events (2 items)
  ├─ GA4 Add to Cart — Tracks cart additions in GA4
  │  ...
  └─ Meta Add to Cart — Tracks cart additions in Meta
     ...

📁 Variables (8 items)
  ├─ DLV - ecommerce.transaction_id
  ├─ DLV - ecommerce.value
  ├─ DLV - ecommerce.currency
  │  ...
  └─ CJS - SHA256 Hash (for Enhanced Conversions)

📁 Triggers (4 items)
  ├─ CE - purchase (fires on dataLayer event "purchase")
  ├─ CE - add_to_cart (fires on dataLayer event "add_to_cart")
  │  ...
```

Each item is an expandable accordion row. The "Why" line uses the same business-impact language from `rule-interpretations.ts`.

#### Existing Tracking Conflict Warning

If the site detection (from Section 3) found existing tracking, show a banner:

```
YOUR EXISTING SETUP
Atlas detected GA4 (G-ABC123) and GTM (GTM-XYZ789) already on your site.

When you import this container:
✓ 4 new event tags will be added
✓ 3 new triggers will be added
✓ 8 new variables will be added
✗ Nothing existing will be overwritten (Atlas uses unique tag names)

Tip: Import using "Merge → Rename conflicting" in GTM for safety.
```

This information comes from combining the `SiteDetection.existing_tracking` data (from Section 3) with the generated container contents. The logic to determine "new vs. existing" compares the tag names in the generated container against what was detected.

#### Modify `Step6GeneratedOutputs.tsx`

Replace the current download-only card for the GTM container with a two-section layout:

1. **Preview section** (always visible): The GTM Container Preview component
2. **Download section** (below): The existing download button, now with additional context: "This file contains X tags, Y triggers, Z variables"

Add a "Platform IDs" subsection where the user can paste their actual measurement IDs (GA4, Google Ads, Meta Pixel ID) before downloading. Atlas replaces all placeholder values in the container JSON with the real IDs before generating the download. This is a frontend-only operation — parse the JSON, do a find-and-replace on placeholder patterns (`G-XXXXXXXXX`, `AW-XXXXXXXXX/YYYYYYY`, `1234567890`), and create a new Blob for download.

---

## 6. P2: Quick-Check Endpoint (Single Page Verification)

### 6.1 Problem

The current audit flow requires a full Browserbase simulation across all journey stages (30-60 seconds). Developers implementing tracking want to verify one page at a time as they work. Running a full audit after each page implementation is too slow and too expensive.

### 6.2 Solution

Add a **Quick-Check** endpoint that verifies a single URL against a single expected event specification. Returns pass/fail in 5-10 seconds. Uses Browserbase but only visits one page.

### 6.3 API Endpoint

Add to `backend/src/api/routes/developer.ts`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/dev/:shareToken/pages/:pageId/quickcheck` | None (share token) | Run a single-page check. Returns `QuickCheckResult`. |

Also available to authenticated users:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/planning/sessions/:sessionId/pages/:pageId/quickcheck` | JWT (owner) | Same check, authenticated. |

### 6.4 Backend Implementation

New file: `backend/src/services/planning/quickCheckService.ts`

```typescript
export interface QuickCheckRequest {
  page_url: string;
  expected_events: ExpectedEventCheck[];    // Derived from approved recommendations for this page
}

export interface ExpectedEventCheck {
  event_name: string;                       // e.g., 'purchase', 'add_to_cart'
  required_params: string[];                // e.g., ['transaction_id', 'value', 'currency']
  platform_checks: PlatformCheck[];         // Which platform endpoints should receive data
}

export interface PlatformCheck {
  platform: string;                         // 'ga4', 'meta', 'google_ads'
  endpoint_patterns: string[];              // URL patterns to match in network requests
}

export interface QuickCheckResult {
  page_url: string;
  overall_status: 'pass' | 'fail' | 'partial';
  check_duration_ms: number;
  events: EventCheckResult[];
  platforms: PlatformCheckResult[];
  raw_datalayer_events: object[];           // What was actually found in the dataLayer
  errors: string[];                         // Navigation errors, timeouts, etc.
}

export interface EventCheckResult {
  event_name: string;
  found: boolean;
  params_found: Record<string, boolean>;    // e.g., { transaction_id: true, value: true, currency: false }
  params_values: Record<string, any>;       // Actual values found (e.g., { transaction_id: 'ORD-123', value: 99.99 })
}

export interface PlatformCheckResult {
  platform: string;
  tag_loaded: boolean;
  event_received: boolean;
  endpoint_hit: string | null;              // The actual URL that was requested
}
```

**Implementation:** This reuses the existing `browserbase/client.ts` but with a simplified flow:

1. Create a Browserbase session (reuse `client.ts`)
2. Navigate to the single URL
3. Wait for network idle (max 15 seconds)
4. Capture `dataLayer` events and network requests (reuse logic from `dataCapture.ts`)
5. Compare against `expected_events`
6. Return result immediately (no job queue — this is synchronous for the user, but keep a 20-second total timeout)

**Important:** Quick-check does NOT go through the Bull job queue. It's a direct async operation in the route handler because it needs to return results inline (~5-10 seconds). Add a specific rate limit: 20 quick-checks per hour per share token.

**Cost per quick-check:** ~$0.05-0.10 (one Browserbase session, ~10 seconds at $0.30/min). Acceptable for the value it provides.

### 6.5 Frontend Integration

**In `DeveloperPortalPage.tsx` / `PageImplementationCard.tsx`:**

Each page card has a "Quick Check" button. Clicking it:

1. Shows a loading spinner on the button ("Checking...")
2. Calls `POST /api/dev/:shareToken/pages/:pageId/quickcheck`
3. After 5-10 seconds, displays inline results:

```
QUICK CHECK RESULTS — Product Page

✓ view_item event found
  ✓ items[] present (1 item)
  ✓ value: 29.99
  ✓ currency: SGD

⚠ add_to_cart event NOT found
  The dataLayer event "add_to_cart" was not detected.
  Tip: Make sure the dataLayer.push() fires when the
  "Add to Cart" button is clicked, not on page load.

Platforms:
  ✓ GA4 — receiving events
  ✓ Meta Pixel — loaded
  ✗ Google Ads — conversion tag not detected on this page
```

If the check passes for all events, automatically update the page status to "verified" (the fourth status level beyond "implemented").

**In `Step6GeneratedOutputs.tsx` (for the authenticated user):**

Add a "Quick Check" button next to each page in the tracking plan summary. Same behaviour as the developer portal version, but uses the authenticated endpoint.

---

## 7. P2: Incremental Re-Scan & Change Detection

### 7.1 Problem

Websites change over time — new pages, redesigned CTAs, updated forms, removed elements. The tracking plan from a planning session becomes stale. Currently, the only option is to run an entirely new planning session, losing all previous approvals and implementation progress.

### 7.2 Solution

Add a **Re-Scan** capability that runs the AI scanner again on the same pages, compares against the existing approved recommendations, and shows what changed.

### 7.3 API Endpoint

Add to `backend/src/api/routes/planning.ts`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/planning/sessions/:id/rescan` | JWT (owner) | Re-scan all pages and compare against existing recommendations. Enqueues a job on `planningQueue`. |
| `GET` | `/api/planning/sessions/:id/changes` | JWT (owner) | Get the change detection results after re-scan completes. |

### 7.4 Backend Implementation

New file: `backend/src/services/planning/changeDetectionService.ts`

```typescript
export interface ChangeDetectionResult {
  session_id: string;
  scan_date: string;
  previous_scan_date: string;
  changes: PageChangeResult[];
  summary: ChangeSummary;
}

export interface PageChangeResult {
  page_id: string;
  page_url: string;
  page_label: string;
  change_type: 'unchanged' | 'modified' | 'new_elements' | 'removed_elements' | 'page_not_found';
  new_recommendations: AIRecommendation[];       // Elements found now that weren't in the original scan
  removed_elements: RemovedElement[];             // Elements in the original plan that no longer exist on the page
  modified_elements: ModifiedElement[];           // Elements that exist but changed (different text, different position)
}

export interface RemovedElement {
  recommendation_id: string;
  original_event_name: string;
  original_element_text: string;
  reason: string;                                 // "Element with selector '.add-to-cart-btn' no longer found on the page"
}

export interface ModifiedElement {
  recommendation_id: string;
  original_element_text: string;
  current_element_text: string;
  change_description: string;                     // AI-generated description of what changed
}

export interface ChangeSummary {
  pages_unchanged: number;
  pages_modified: number;
  new_elements_found: number;
  elements_removed: number;
  elements_modified: number;
  action_required: boolean;                       // true if any critical changes detected
}
```

**Implementation flow:**

1. Re-run the page capture pipeline (`pageCaptureService.ts`) on all pages in the session
2. For each page, send both the NEW capture and the EXISTING approved recommendations to Claude API
3. Claude compares the current page state against what was previously recommended and returns structured change data
4. Store the change results (could be a new JSONB column on `planning_sessions` or a new table — JSONB column is simpler)

**Claude prompt addition for re-scan:** Add to the existing page analysis prompt in `aiAnalysisService.ts`:

```
CHANGE DETECTION MODE:
You are re-scanning a page that was previously analysed. Below are the
previously approved recommendations. Compare the current page state against
these recommendations and identify:
1. Elements that still exist and are unchanged
2. Elements that have been modified (different text, position, or behaviour)
3. Elements that no longer exist on the page
4. New elements that weren't in the previous scan but should be tracked

PREVIOUS RECOMMENDATIONS:
[JSON of approved recommendations for this page]
```

**Cost:** Same as a regular planning scan (~$0.13 per session re-scan).

### 7.5 Database Change

```sql
ALTER TABLE planning_sessions ADD COLUMN last_rescan_at TIMESTAMPTZ;
ALTER TABLE planning_sessions ADD COLUMN rescan_results JSONB;
```

### 7.6 Frontend Changes

**`PlanningDashboard.tsx`:** Add a "Re-scan" button on each completed planning session row. Shows the last re-scan date if one was performed.

**New component: `frontend/src/components/planning/ChangeDetectionResults.tsx`**

A modal or slide-out panel that shows the change detection results:

```
SITE CHANGES DETECTED — example.com
Last scanned: March 10, 2026
Re-scanned: March 14, 2026

2 pages unchanged
1 page modified
1 new element found

PRODUCT PAGE — Modified
⚠ "Add to Cart" button text changed from "Add to Cart" to "Add to Bag"
  → Your tracking still works (selector unchanged), but you may want
    to update the event label in your GTM container.

CHECKOUT PAGE — New Element Found
+ "Express Checkout" button detected
  Atlas recommends tracking this as a begin_checkout event.
  Priority: Should Have
  [Approve & Add to Plan]  [Skip]

HOMEPAGE — Unchanged ✓
CONTACT PAGE — Unchanged ✓
```

For new elements, the user can approve them directly from this view. Approving adds them to the existing tracking plan and regenerates the affected outputs (dataLayer spec, GTM container).

---

## 8. Implementation Sequence

### Sprint 1 (Week 1–2): Smart Onboarding + GTM Preview

**Goal:** Reduce setup time from 60 seconds to 10 seconds, and build user confidence in GTM imports.

| Task | Files | Estimate |
|------|-------|----------|
| Build `siteDetectionService.ts` (HTML fetch + parsing) | `backend/src/services/planning/siteDetectionService.ts` | 6h |
| Add `cheerio` dependency | `backend/package.json` | 0.5h |
| Add `POST /api/planning/detect` endpoint | `backend/src/api/routes/planning.ts` | 2h |
| Add `detectSite()` to frontend API client | `frontend/src/lib/api/planningApi.ts` | 1h |
| Rebuild `Step1PlanningSetup.tsx` with URL-first flow | `frontend/src/components/planning/Step1PlanningSetup.tsx` | 8h |
| Update `planningStore.ts` with detection state | `frontend/src/store/planningStore.ts` | 1h |
| Build `GTMContainerPreview.tsx` component | `frontend/src/components/planning/GTMContainerPreview.tsx` | 8h |
| Add platform ID replacement to download flow | `frontend/src/components/planning/Step6GeneratedOutputs.tsx` | 4h |
| Modify `Step6GeneratedOutputs.tsx` to include preview | `frontend/src/components/planning/Step6GeneratedOutputs.tsx` | 3h |
| Add existing tracking conflict warning logic | `frontend/src/components/planning/GTMContainerPreview.tsx` | 3h |
| Testing + edge cases (detection failures, missing data) | Various | 4h |

**Sprint deliverable:** User pastes a URL → site is auto-detected in 2 seconds → form is pre-filled. GTM container shows interactive preview with plain-English explanations before download.

### Sprint 2 (Week 3–4): Developer Portal

**Goal:** A developer can open a shared link and see exactly what to implement, page by page, with status tracking.

| Task | Files | Estimate |
|------|-------|----------|
| Create DB migration: `developer_shares` + `implementation_progress` tables | SQL migration | 2h |
| Build `shareService.ts` (token generation, validation) | `backend/src/services/developer/shareService.ts` | 3h |
| Build `developerQueries.ts` | `backend/src/services/database/developerQueries.ts` | 4h |
| Build `/api/dev/*` routes + `/api/planning/sessions/:id/share` routes | `backend/src/api/routes/developer.ts` | 6h |
| Build `DeveloperPortalPage.tsx` | `frontend/src/pages/DeveloperPortalPage.tsx` | 10h |
| Build `DeveloperHeader.tsx` | `frontend/src/components/developer/DeveloperHeader.tsx` | 2h |
| Build `PageImplementationCard.tsx` (accordion + code + status) | `frontend/src/components/developer/PageImplementationCard.tsx` | 6h |
| Build `CodeSnippet.tsx` (copy-to-clipboard code blocks) | `frontend/src/components/developer/CodeSnippet.tsx` | 2h |
| Build `ProgressBar.tsx` | `frontend/src/components/developer/ProgressBar.tsx` | 1h |
| Build `developerApi.ts` (unauthenticated API client) | `frontend/src/lib/api/developerApi.ts` | 2h |
| Add `/dev/:shareToken` route (public, no ProtectedRoute) | Frontend router | 1h |
| Modify `Step7DownloadAndHandoff.tsx` — add "Share with Developer" button | `frontend/src/components/planning/Step7DownloadAndHandoff.tsx` | 3h |
| Modify `PlanningDashboard.tsx` — add implementation progress column | `frontend/src/pages/PlanningDashboard.tsx` | 3h |
| Add `createShare`, `getProgress` to `planningApi.ts` | `frontend/src/lib/api/planningApi.ts` | 1h |
| Testing: share flow, developer access, status updates, expiry | Various | 4h |

**Sprint deliverable:** Marketer clicks "Share with Developer" → copies a link → developer opens it → sees page-by-page implementation guide with status tracking.

### Sprint 3 (Week 5–6): Quick-Check + Planning-to-Audit Loop

**Goal:** Developers can verify individual pages in 5 seconds. Audit findings trace back to planning recommendations.

| Task | Files | Estimate |
|------|-------|----------|
| Build `quickCheckService.ts` | `backend/src/services/planning/quickCheckService.ts` | 8h |
| Add quick-check endpoints (both dev + authenticated) | `backend/src/api/routes/developer.ts`, `backend/src/api/routes/planning.ts` | 3h |
| Add rate limiter for quick-check (20/hour per token) | `backend/src/api/middleware/quickCheckLimiter.ts` | 2h |
| Add quick-check button + inline results to `PageImplementationCard.tsx` | `frontend/src/components/developer/PageImplementationCard.tsx` | 6h |
| Add `source_planning_session_id` column to `journeys` table | SQL migration | 1h |
| Modify handoff to set `source_planning_session_id` | `backend/src/services/database/journeyQueries.ts` | 1h |
| Modify `GET /api/audits/:id/gaps` to include planning context | `backend/src/api/routes/audits.ts`, query changes | 4h |
| Modify `GapReportPage.tsx` to show planning context on gaps | `frontend/src/pages/GapReportPage.tsx` + child components | 4h |
| Build before/after comparison logic in report generator | `backend/src/services/reporting/generator.ts` | 4h |
| Modify `ExecutiveSummary.tsx` to show comparison banner | `frontend/src/components/audit/ReportPages/ExecutiveSummary.tsx` | 3h |
| Testing: quick-check accuracy, planning context display, comparison | Various | 6h |

**Sprint deliverable:** Developer clicks "Quick Check" on a page → sees pass/fail in 5 seconds. Audit gap report shows "Atlas recommended this event on March 10" context. Second audit shows "+49 points improvement" comparison.

### Sprint 4 (Week 7–8): Re-Scan + Polish

**Goal:** Users can detect site changes without starting over. Polish and edge cases across all improvements.

| Task | Files | Estimate |
|------|-------|----------|
| Build `changeDetectionService.ts` | `backend/src/services/planning/changeDetectionService.ts` | 8h |
| Add re-scan prompt mode to `aiAnalysisService.ts` | `backend/src/services/planning/aiAnalysisService.ts` | 4h |
| Add `POST /api/planning/sessions/:id/rescan` endpoint | `backend/src/api/routes/planning.ts` | 3h |
| Add `GET /api/planning/sessions/:id/changes` endpoint | `backend/src/api/routes/planning.ts` | 2h |
| Add `last_rescan_at` + `rescan_results` columns | SQL migration | 1h |
| Build `ChangeDetectionResults.tsx` component | `frontend/src/components/planning/ChangeDetectionResults.tsx` | 6h |
| Add re-scan button to `PlanningDashboard.tsx` | `frontend/src/pages/PlanningDashboard.tsx` | 2h |
| Handle "approve new element" from change detection (add to plan + regenerate outputs) | Backend + frontend | 4h |
| Polish: loading states, error boundaries, edge cases across all new features | Various | 8h |
| Mobile responsiveness for developer portal | `DeveloperPortalPage.tsx` + children | 4h |
| End-to-end testing: full flow from URL entry → planning → share → implement → quick-check → audit → comparison | Various | 6h |

**Sprint deliverable:** User clicks "Re-scan" → sees what changed on their site → approves new elements without starting over. All improvements polished and tested.

---

## 9. Types & Interfaces Summary

All new TypeScript interfaces should be added to the appropriate type files.

**`frontend/src/types/planning.ts`:** Add:
- `SiteDetection`, `DetectedPlatform`, `ExistingTrackingQuick`
- `DeveloperShare`, `ImplementationProgress`, `PageProgress`
- `QuickCheckResult`, `EventCheckResult`, `PlatformCheckResult`
- `ChangeDetectionResult`, `PageChangeResult`, `ChangeSummary`

**`backend/src/types/`:** Create `developer.ts` with the same interfaces (or a shared types package if one exists).

---

## 10. Environment & Configuration Changes

No new environment variables required. All new features use existing services:
- Browserbase (for quick-check) — uses existing `BROWSERBASE_API_KEY`
- Claude API (for re-scan analysis) — uses existing `ANTHROPIC_API_KEY`
- Supabase (for new tables) — uses existing connection

The only new dependency is `cheerio` (backend only, for HTML parsing in site detection).

---

## 11. Migration Checklist

Run these SQL migrations in order:

```
Migration 1: developer_shares + implementation_progress tables (Sprint 2)
Migration 2: ALTER journeys ADD source_planning_session_id (Sprint 3)
Migration 3: ALTER planning_sessions ADD last_rescan_at, rescan_results (Sprint 4)
```

All migrations are additive (new tables, new columns). No existing data is modified or at risk.

---

## 12. Impact on Existing Features

| Existing Feature | Impact | Changes Required |
|-----------------|--------|-----------------|
| Planning Mode (7-step wizard) | Step 1 rebuilt (URL-first). Step 6 enhanced (GTM preview). Step 7 enhanced (share button). | Modify 3 existing components |
| Planning Dashboard | New columns (implementation progress, re-scan button) | Modify `PlanningDashboard.tsx` |
| Audit Gap Report | New context section linking to planning recommendations | Modify `GapReportPage.tsx` |
| Audit Report Executive Summary | New before/after comparison banner | Modify `ExecutiveSummary.tsx` |
| Journey handoff | Now sets `source_planning_session_id` | Modify journey creation query |
| All other features | No changes | — |

No existing endpoints are modified in breaking ways. All changes are additive (new fields in responses, new endpoints, new components).

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Site detection fails on JS-heavy SPAs (empty HTML from server) | URL-first onboarding falls back to manual form | Graceful fallback is built into the design. Show "We couldn't auto-detect — please fill in manually." |
| Developer portal share links are guessable | Unauthorised access to tracking plans | 48-character hex tokens (crypto.randomBytes(24)) have ~10^57 possible values. Rate limit token validation attempts. Auto-expire after 90 days. |
| Quick-check Browserbase costs add up | Per-check cost of ~$0.05-0.10 | Rate limit: 20 checks per hour per share token. Free plan: 5 quick-checks per month. Pro: 50. Agency: unlimited. |
| Re-scan Claude API costs | Additional ~$0.13 per re-scan | Re-scans count against the planning session monthly limit (same as new sessions). |
| Developer portal used but developer never updates status | Marketer doesn't know implementation progress | Add a "nudge" feature in a future sprint — marketer can send a reminder notification. For now, the status defaults are visible enough. |
| GTM container preview reveals technical complexity to non-technical users | Overwhelms the user | Preview uses plain English only, with technical details hidden in expandable sections. Default view is business-impact summaries, not JSON. |

---

## 14. Success Metrics

| Metric | Current Baseline | Target | How Measured |
|--------|-----------------|--------|-------------|
| Planning Mode Step 1 completion time | ~45 seconds (estimated) | <15 seconds | Timestamp from page load to "Continue" click |
| Share link generation rate | 0% (feature doesn't exist) | >40% of completed planning sessions | Track `POST /api/planning/sessions/:id/share` calls |
| Developer portal visit rate | 0% | >70% of generated share links are visited | Track `GET /api/dev/:shareToken` calls |
| Quick-check usage | 0% | >3 checks per developer per session | Track quick-check endpoint calls per share token |
| Implementation completion rate (all pages "implemented") | Unknown | >50% of shared sessions within 14 days | Track `implementation_progress` status updates |
| Planning → Audit conversion rate | Current handoff rate (measure baseline) | +20% increase | Track audits run on journeys with `source_planning_session_id` set |
| Repeat audit rate (before/after comparison available) | Current rate (measure baseline) | +30% increase | Track second+ audits on same journey |

---

## 15. Out of Scope (for this version)

- Email/Slack notifications when developer completes implementation (deferred to follow-up sprint)
- Agency workspaces with multi-client management (separate PRD required)
- White-label branding on developer portal and PDF exports (separate PRD required)
- GTM API direct import (bypassing file download) — requires OAuth and complex permissions
- Scheduled automated audits (monitoring/alerting) — separate feature, separate PRD
- Industry benchmarks ("87% of ecommerce sites track this") — requires aggregate data collection
