# Atlas Phase 1: Foundation UX & Export — Implementation PRD

> **Status**: Ready for build | **Priority**: HIGHEST | **Date**: April 2026
> **Repo**: `github.com/Vikramj01/AtlasV2` (private)
> **Estimated effort**: 4–6 weeks across all tasks

---

## 0. Read This First

### Why This Phase Exists

Atlas has strong underlying features but is structured as a **toolkit** (here are all the things you can do) rather than a **workflow** (here is what you should do next). Phase 1 fixes that without adding any new modules. Every change in this PRD modifies or extends existing code — nothing is built from scratch.

### What This Phase Delivers

1. **Action Dashboard** — Replaces the current home screen with a prioritised action list that pulls from all existing Atlas subsystems
2. **Intelligent Router** — Task-oriented entry point for users who don't know which mode to use
3. **Navigation Relabelling** — Renames sidebar items from product architecture terms to task-oriented language
4. **Contextual Guidance Layer** — Adds inline "so what?" interpretations to all existing quantitative metrics
5. **Signal Inventory Spreadsheet Export** — XLSX export of Signal Library + implementation status

### Actual Tech Stack (CLAUDE.md is outdated — use this)

| Layer | Technology |
|-------|-----------|
| Frontend | **Vite + React 19 + React Router v6** |
| Backend | **Express.js** (separate service in `backend/src/`) |
| State | **Zustand** stores in `frontend/src/store/` |
| UI | **shadcn/ui** components |
| Database | **Supabase** (PostgreSQL) |
| Auth | **Supabase Auth** — JWT passed as `Bearer` token to Express |
| Queue | **Bull** (Redis-backed) in `backend/src/services/queue/` |
| Hosting | **Vercel** (frontend), **Render** (backend) |

### Key File Paths

```
# FRONTEND — files you will modify
frontend/src/App.tsx                              — All routes
frontend/src/components/layout/Sidebar.tsx        — PERSONAL_NAV and orgNav() arrays
frontend/src/pages/HomePage.tsx                   — Current home page (will be replaced)

# FRONTEND — patterns to follow
frontend/src/pages/HealthDashboardPage.tsx        — Page pattern with loading states
frontend/src/lib/api/healthApi.ts                 — API client pattern (apiFetch<T>)
frontend/src/store/auditStore.ts                  — Zustand store pattern
frontend/src/types/health.ts                      — Type definition pattern
frontend/src/components/ui/                       — shadcn/ui components

# BACKEND — files you will modify
backend/src/app.ts                                — Route mounting

# BACKEND — patterns to follow
backend/src/api/routes/health.ts                  — Express Router + authMiddleware
backend/src/services/database/healthQueries.ts    — Supabase query pattern
backend/src/types/health.ts                       — Backend type pattern

# DATABASE
db/migrations/                                    — Core migrations (numbered 001–004)
supabase/migrations/                              — Additional migrations (timestamped)
```

### Build Order

Execute in this exact sequence. Each task builds on the previous one.

```
Task 1: Navigation Relabelling ............... ~2 days (no backend changes)
Task 2: Action Dashboard Backend ............. ~3 days (new API endpoint)
Task 3: Action Dashboard Frontend ............ ~4 days (replace HomePage)
Task 4: Intelligent Router ................... ~2 days (component on dashboard)
Task 5: Contextual Guidance Layer ............ ~5 days (cross-cutting, all pages)
Task 6: Signal Inventory Export .............. ~4 days (new endpoint + XLSX generation)
```

---

## 1. Navigation Relabelling

### 1.1 Objective

Rename sidebar navigation items from product-architecture terms to task-oriented language that marketing professionals understand immediately. No structural changes — same routes, same pages, same components. Only label text and icon changes.

### 1.2 Changes

**File**: `frontend/src/components/layout/Sidebar.tsx`

Apply these changes to **both** the `PERSONAL_NAV` array and the `orgNav()` function:

| Current Label | New Label | Current Icon | New Icon | Route (unchanged) |
|---------------|-----------|-------------|----------|-------------------|
| Home | Home | `Home` | `Home` | `/home` |
| Planning Mode | Set Up Tracking | (current) | `Wand2` | (current route) |
| Direct Audit | Quick Scan | (current) | `ScanSearch` | (current route) |
| Journey Builder | Verify Journeys | (current) | `Route` | (current route) |
| Signal Library | Tracking Map | (current) | `Map` | (current route) |
| Signal Packs | Templates | (current) | `Package` | (current route) |
| CAPI / Conversion APIs | Conversion APIs | (current) | Keep current | (current route) |
| Consent Hub | Consent & Privacy | (current) | `ShieldCheck` | (current route) |
| Developer Portal | Developer Handoff | (current) | `Share2` | (current route) |
| Data Health | Signal Health | `HeartPulse` | `Activity` | `/health` |

### 1.3 Implementation Notes

- Import new icons from `lucide-react` at the top of `Sidebar.tsx`
- Only change the `label` string and `Icon` component reference in the nav arrays
- Do NOT change route paths, page component imports, or any other wiring
- The page titles (inside each page component's `<h1>` or page header) should also be updated to match the new labels for consistency — find the title text in each page's TSX file and update it
- Update any breadcrumb components that reference the old labels
- Search the codebase for hardcoded label strings that might appear in tooltips, page metadata, or help text: `grep -r "Planning Mode\|Signal Library\|Signal Packs\|Consent Hub\|Developer Portal\|Direct Audit\|Journey Builder" frontend/src/`

### 1.4 Acceptance Criteria

- [ ] All sidebar labels updated in both `PERSONAL_NAV` and `orgNav()`
- [ ] All page titles/headers match new labels
- [ ] All routes still work — no broken navigation
- [ ] No references to old labels remain in the frontend codebase (check with grep)
- [ ] Icons render correctly

---

## 2. Action Dashboard

### 2.1 Objective

Replace the current `HomePage.tsx` with a prioritised action dashboard that pulls data from all existing Atlas subsystems and surfaces the most important items first. This is the single most impactful UX change — it transforms Atlas from a toolkit into a workflow.

### 2.2 Data Sources

The dashboard aggregates data from subsystems that already exist. No new database tables needed for the initial version. The backend will query existing tables and compute the dashboard payload.

| Data Source | What It Provides | Existing Table/API |
|------------|-----------------|-------------------|
| CAPI Module | Delivery rates by provider, EMQ scores, failed events | `capi_providers`, `capi_events` (or equivalent — check schema) |
| Developer Portal | Implementation status per page (implemented/pending/blocked) | `developer_portal_pages` or equivalent |
| Audit History | Recent audit scores, score deltas | `audits` table |
| Signal Library | Signal coverage (signals defined vs signals verified) | `signals`, `signal_packs` tables |
| Journey Builder | Journey completion status, gap report summaries | `journeys`, `journey_audits` tables |

### 2.3 TypeScript Interfaces

**File to create**: `frontend/src/types/dashboard.ts`

```typescript
// ─── Dashboard Card Types ───

export type CardSeverity = 'critical' | 'warning' | 'info' | 'success';
export type CardCategory = 'capi' | 'implementation' | 'signal_health' | 'opportunity' | 'activity';

export interface DashboardCard {
  id: string;
  severity: CardSeverity;
  category: CardCategory;
  title: string;
  description: string;
  metric?: {
    value: string;
    label: string;
    trend?: 'up' | 'down' | 'stable';
    trendValue?: string;
  };
  action?: {
    label: string;
    route: string;  // internal route to navigate to
  };
  timestamp: string;  // ISO datetime
}

export interface DashboardSummary {
  overall_health: 'healthy' | 'attention' | 'critical';
  signal_coverage_pct: number;
  capi_delivery_pct: number | null;  // null if no CAPI configured
  avg_emq: number | null;
  implementation_progress: {
    total_pages: number;
    implemented: number;
    pending: number;
    blocked: number;
  } | null;  // null if no developer portal configured
  last_audit: {
    score: number;
    date: string;
    delta: number | null;  // change from previous audit
  } | null;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  cards: DashboardCard[];  // pre-sorted by severity: critical → warning → info → success
  last_refreshed: string;
}
```

**File to create**: `backend/src/types/dashboard.ts`

```typescript
// Mirror the frontend types. Keep in sync.
// Copy the same interfaces: DashboardCard, DashboardSummary, DashboardResponse
```

### 2.4 Backend API

**File to create**: `backend/src/api/routes/dashboard.ts`

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getDashboardData } from '../../services/dashboard/dashboardService';

const router = Router();

// GET /api/dashboard
// Returns aggregated dashboard data for the authenticated user's active org
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const orgId = req.query.org_id as string | undefined;

    const dashboard = await getDashboardData(userId, orgId);
    res.json(dashboard);
  } catch (err) {
    console.error('Dashboard fetch error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

export default router;
```

**Mount in `backend/src/app.ts`**:

```typescript
import dashboardRoutes from './api/routes/dashboard';
// ... existing route imports

app.use('/api/dashboard', dashboardRoutes);
```

**File to create**: `backend/src/services/dashboard/dashboardService.ts`

This service queries existing tables and computes the dashboard payload. The implementation must:

1. Query `capi_providers` and related event/delivery tables for the user's org to compute delivery rates, EMQ averages, and identify any providers with delivery rates below 90% (these become `critical` cards)
2. Query the developer portal tables to get implementation progress counts (total, implemented, pending, blocked) — if `pending > 0`, generate a `warning` card with the count
3. Query the `audits` table for the most recent audit and the one before it to compute score delta — if score improved, generate an `info` card; if declined, generate a `warning` card
4. Query the signal library to compute coverage percentage (signals with verified implementation / total signals) — if below 80%, generate an `opportunity` card
5. Check for CAPI providers where EMQ is below 7.0 — generate an `opportunity` card with specific guidance on which identifiers to add
6. Sort all generated cards by severity: `critical` first, then `warning`, then `info`, then `success`

```typescript
import { supabase } from '../database/supabaseClient';
import type { DashboardResponse, DashboardCard, DashboardSummary } from '../../types/dashboard';

export async function getDashboardData(
  userId: string,
  orgId?: string
): Promise<DashboardResponse> {
  const cards: DashboardCard[] = [];

  // 1. Resolve the active org for this user
  // Use existing org resolution pattern from the codebase
  const activeOrgId = orgId ?? await resolveDefaultOrg(userId);

  // 2. CAPI health
  const capiHealth = await getCapiHealth(activeOrgId);
  if (capiHealth) {
    // Generate critical cards for providers with delivery < 90%
    for (const provider of capiHealth.providers) {
      if (provider.delivery_rate < 0.90) {
        cards.push({
          id: `capi-delivery-${provider.provider_name}`,
          severity: 'critical',
          category: 'capi',
          title: `${provider.provider_name} delivery rate dropped to ${Math.round(provider.delivery_rate * 100)}%`,
          description: `${provider.failed_events} events failed delivery in the last 24 hours. Check the Conversion APIs dashboard for details.`,
          metric: {
            value: `${Math.round(provider.delivery_rate * 100)}%`,
            label: 'Delivery rate',
            trend: 'down',
          },
          action: { label: 'View details', route: '/capi' },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Generate opportunity cards for low EMQ
    for (const provider of capiHealth.providers) {
      if (provider.avg_emq !== null && provider.avg_emq < 7.0) {
        cards.push({
          id: `emq-low-${provider.provider_name}`,
          severity: 'info',
          category: 'opportunity',
          title: `${provider.provider_name} EMQ is ${provider.avg_emq.toFixed(1)} — below target`,
          description: getEmqGuidance(provider.avg_emq, provider.missing_identifiers),
          metric: {
            value: provider.avg_emq.toFixed(1),
            label: 'Event Match Quality',
          },
          action: { label: 'Configure identifiers', route: '/capi' },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // 3. Implementation progress
  const implProgress = await getImplementationProgress(activeOrgId);
  if (implProgress && implProgress.pending > 0) {
    cards.push({
      id: 'impl-progress',
      severity: 'warning',
      category: 'implementation',
      title: `${implProgress.implemented} of ${implProgress.total_pages} pages implemented`,
      description: `${implProgress.pending} pages are pending implementation. ${implProgress.blocked > 0 ? `${implProgress.blocked} are blocked.` : ''}`,
      metric: {
        value: `${implProgress.implemented}/${implProgress.total_pages}`,
        label: 'Pages implemented',
      },
      action: { label: 'View handoff status', route: '/developer-portal' },
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Recent audit
  const recentAudit = await getRecentAuditDelta(activeOrgId);
  if (recentAudit) {
    const isDecline = recentAudit.delta !== null && recentAudit.delta < 0;
    cards.push({
      id: 'recent-audit',
      severity: isDecline ? 'warning' : 'info',
      category: 'activity',
      title: isDecline
        ? `Audit score dropped from ${recentAudit.previous_score} to ${recentAudit.score}`
        : `Latest audit score: ${recentAudit.score}`,
      description: isDecline
        ? 'Signal coverage has declined since the last audit. Re-run to identify which signals were affected.'
        : recentAudit.delta && recentAudit.delta > 0
          ? `Score improved by ${recentAudit.delta} points since the last audit.`
          : 'Run a new audit to check for any changes.',
      metric: {
        value: String(recentAudit.score),
        label: 'Audit score',
        trend: recentAudit.delta && recentAudit.delta > 0 ? 'up' : recentAudit.delta && recentAudit.delta < 0 ? 'down' : 'stable',
      },
      action: { label: 'Run new audit', route: '/quick-scan' },
      timestamp: recentAudit.date,
    });
  }

  // 5. Signal coverage
  const coverage = await getSignalCoverage(activeOrgId);
  if (coverage && coverage.coverage_pct < 80) {
    cards.push({
      id: 'signal-coverage',
      severity: 'info',
      category: 'opportunity',
      title: `Signal coverage is ${coverage.coverage_pct}%`,
      description: `You're tracking ${coverage.verified} of ${coverage.total} recommended signals. Mid-funnel signals help Meta and Google build better audience models.`,
      metric: {
        value: `${coverage.coverage_pct}%`,
        label: 'Signal coverage',
      },
      action: { label: 'View tracking map', route: '/signal-library' },
      timestamp: new Date().toISOString(),
    });
  }

  // 6. Build summary
  const summary: DashboardSummary = {
    overall_health: cards.some(c => c.severity === 'critical')
      ? 'critical'
      : cards.some(c => c.severity === 'warning')
        ? 'attention'
        : 'healthy',
    signal_coverage_pct: coverage?.coverage_pct ?? 0,
    capi_delivery_pct: capiHealth?.overall_delivery_rate ?? null,
    avg_emq: capiHealth?.overall_avg_emq ?? null,
    implementation_progress: implProgress,
    last_audit: recentAudit
      ? { score: recentAudit.score, date: recentAudit.date, delta: recentAudit.delta }
      : null,
  };

  // 7. Sort cards by severity
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  cards.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    summary,
    cards,
    last_refreshed: new Date().toISOString(),
  };
}
```

**Important implementation notes for the service functions:**

- `resolveDefaultOrg(userId)`: Check existing org resolution logic in the codebase. There should already be a pattern for getting the user's active org — likely in auth middleware or an org service.
- `getCapiHealth(orgId)`: Query `capi_providers` table filtered by `org_id`. Join with whatever table stores CAPI delivery logs/events to compute rates. Check the CAPI module's existing queries for patterns.
- `getImplementationProgress(orgId)`: Query the developer portal tables. Look for a `status` column on pages/signals with values like `implemented`, `pending`, `blocked`.
- `getRecentAuditDelta(orgId)`: Query `audits` table ordered by `created_at DESC LIMIT 2` to get current and previous scores.
- `getSignalCoverage(orgId)`: Query `signals` table. Count total vs those with a verified status.
- `getEmqGuidance(emq, missingIdentifiers)`: Pure function that returns contextual guidance string based on EMQ value and which identifiers are missing. See Section 5 (Contextual Guidance) for the full guidance copy.

### 2.5 Zustand Store

**File to create**: `frontend/src/store/dashboardStore.ts`

```typescript
import { create } from 'zustand';
import type { DashboardResponse } from '@/types/dashboard';

interface DashboardStore {
  data: DashboardResponse | null;
  loading: boolean;
  error: string | null;

  setData: (data: DashboardResponse) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  data: null,
  loading: false,
  error: null,

  setData: (data) => set({ data, loading: false, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  clear: () => set({ data: null, loading: false, error: null }),
}));
```

### 2.6 API Client

**File to create**: `frontend/src/lib/api/dashboardApi.ts`

Follow the exact pattern from `healthApi.ts`:

```typescript
import { apiFetch } from './apiFetch';  // or wherever the shared fetch helper lives
import type { DashboardResponse } from '@/types/dashboard';

export const dashboardApi = {
  getDashboard: (orgId?: string) => {
    const params = orgId ? `?org_id=${orgId}` : '';
    return apiFetch<DashboardResponse>(`/api/dashboard${params}`);
  },
};
```

### 2.7 Frontend — Dashboard Page

**File to modify**: `frontend/src/pages/HomePage.tsx`

Replace the current card-based home page with the new Action Dashboard. Keep the existing file but rewrite its contents. Follow the loading/error state pattern from `HealthDashboardPage.tsx`.

#### Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│ SUMMARY BAR (full width)                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │ Health   │ │ CAPI     │ │ Coverage │ │ Last     │    │
│ │ Status   │ │ Delivery │ │ Score    │ │ Audit    │    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
├─────────────────────────────────────────────────────────┤
│ ACTION CARDS (sorted by severity)                       │
│ ┌───────────────────────────────────────────────────┐   │
│ │ 🔴 Critical: CAPI delivery rate dropped to 68%   │   │
│ │    [View details →]                               │   │
│ ├───────────────────────────────────────────────────┤   │
│ │ 🟡 Warning: 3 of 8 pages pending implementation  │   │
│ │    [View handoff status →]                        │   │
│ ├───────────────────────────────────────────────────┤   │
│ │ 🔵 Info: EMQ is 6.2 — adding phone number could  │   │
│ │    increase to ~7.8  [Configure identifiers →]    │   │
│ └───────────────────────────────────────────────────┘   │
│                                                         │
│ ┌─ INTELLIGENT ROUTER (shows when no cards or below) ─┐ │
│ │ "What do you want to do?"                           │ │
│ │ [Set up tracking] [Check if working] [Scan a URL]   │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### Component Structure

Create these sub-components in `frontend/src/components/dashboard/`:

```
frontend/src/components/dashboard/
├── SummaryBar.tsx          — 4 metric cards in a row
├── ActionCard.tsx          — Single action card with severity styling
├── ActionCardList.tsx      — Renders sorted list of ActionCards
├── IntelligentRouter.tsx   — 3-button task router
└── EmptyState.tsx          — Shown when no cards exist (everything is healthy)
```

#### SummaryBar Component

Uses shadcn `Card` component. Four small cards in a horizontal row using CSS grid `grid-cols-2 lg:grid-cols-4`.

Each metric card shows:
- Label (e.g., "Signal Health")
- Value (e.g., "Healthy" or "Attention Needed")
- Color coding: green for healthy/high, amber for attention/medium, red for critical/low
- Optional trend indicator (small arrow up/down)

Health status badge colors:
- `healthy` → `bg-green-50 text-green-700 border-green-200`
- `attention` → `bg-amber-50 text-amber-700 border-amber-200`
- `critical` → `bg-red-50 text-red-700 border-red-200`

#### ActionCard Component

Props: `card: DashboardCard`

Severity-based left border:
- `critical` → `border-l-4 border-l-red-500`
- `warning` → `border-l-4 border-l-amber-500`
- `info` → `border-l-4 border-l-blue-500`
- `success` → `border-l-4 border-l-green-500`

Each card shows: title (bold), description (muted), metric badge (if present), and action button (text link style, navigates using `useNavigate()` from react-router).

#### EmptyState Component

Shown when `cards.length === 0`. Displays:
- Green checkmark icon
- "All systems healthy"
- "No issues detected across your tracking infrastructure"
- The Intelligent Router below it

### 2.8 Acceptance Criteria

- [ ] `GET /api/dashboard` returns `DashboardResponse` with summary + sorted cards
- [ ] Dashboard page loads with skeleton/loading state while fetching
- [ ] Summary bar shows 4 metrics with correct color coding
- [ ] Cards are sorted by severity (critical first)
- [ ] Each card's action button navigates to the correct route
- [ ] Empty state shown when no action items exist
- [ ] Dashboard works for users with no CAPI configured (null handling)
- [ ] Dashboard works for users with no developer portal configured
- [ ] Dashboard works for users with no audits run yet
- [ ] Page auto-refreshes data every 5 minutes (use `setInterval` in `useEffect`)

---

## 3. Intelligent Router

### 3.1 Objective

Provide a task-oriented entry point for users who don't know which Atlas mode to use. This appears on the dashboard below the action cards (always visible), and is the primary content when the user has no active projects or alerts.

### 3.2 Component

**File**: `frontend/src/components/dashboard/IntelligentRouter.tsx`

Three large, clickable cards in a horizontal row. Each represents a plain-language task:

| Button Text | Subtitle | Route | Maps To |
|------------|----------|-------|---------|
| "Set up tracking on a site" | "Scan your site, get AI recommendations, generate GTM + dataLayer code" | Planning Mode route | Planning Mode |
| "Check if my tracking works" | "Build or verify a customer journey and audit your signal chain" | Journey Builder route | Journey Builder → Audit |
| "Scan a URL quickly" | "Enter any URL for an instant signal coverage report" | Direct Audit route | Direct Audit |

#### Visual Design

- Use shadcn `Card` with `CardContent`
- Each card has an icon (top), title (bold), subtitle (muted), and a "Get started →" link
- Hover state: subtle border color change + shadow
- Grid: `grid-cols-1 md:grid-cols-3 gap-4`
- Icons: `Wand2` for setup, `Route` for verify, `ScanSearch` for scan (matching the new sidebar icons)
- Follow the exact card styling pattern already used in `HomePage.tsx` (the existing "run a quick audit" and "plan your tracking" cards)

### 3.3 Section Header

Above the router cards, add a section header:

```tsx
<div className="mt-8 mb-4">
  <h2 className="text-lg font-semibold text-foreground">What would you like to do?</h2>
  <p className="text-sm text-muted-foreground mt-1">Choose a starting point based on where you are in the process.</p>
</div>
```

### 3.4 Acceptance Criteria

- [ ] Three cards render in a responsive grid
- [ ] Each card navigates to the correct route on click
- [ ] Cards match existing design language (same Card/CardContent pattern)
- [ ] Router section is always visible on the dashboard (below action cards)

---

## 4. Contextual Guidance Layer

### 4.1 Objective

Add inline "so what?" interpretations to every quantitative metric in Atlas. This is a cross-cutting change that touches multiple existing pages. Each metric gets a plain-language explanation of what it means for campaign performance and what action to take.

### 4.2 Guidance Component

**File to create**: `frontend/src/components/shared/MetricGuidance.tsx`

A reusable tooltip/expandable component that appears next to or below any metric:

```typescript
interface MetricGuidanceProps {
  metricType: MetricType;
  value: number;
  context?: Record<string, any>;  // additional context for richer guidance
}

type MetricType =
  | 'emq_score'
  | 'capi_delivery_rate'
  | 'signal_coverage'
  | 'audit_score'
  | 'journey_gap'
  | 'consent_rate'
  | 'implementation_progress';
```

#### Rendering

Two display modes — pick based on available space:

1. **Inline hint**: Small info icon (ℹ️ via `lucide-react Info`) next to the metric value. On hover/click, shows a popover with the guidance text. Use shadcn `Popover` or `Tooltip` component.

2. **Expandable card**: Below the metric, a subtle expandable section with a "What does this mean?" toggle. Use for larger dashboard contexts where space allows.

Default to **inline hint** for all uses. The page-level implementation decides which mode to use.

### 4.3 Guidance Copy

**File to create**: `frontend/src/lib/guidance/metricGuidance.ts`

This file contains all guidance logic as pure functions. No API calls — all guidance is computed client-side from the metric value and context.

```typescript
export function getMetricGuidance(
  type: MetricType,
  value: number,
  context?: Record<string, any>
): { summary: string; detail: string; action?: string } {
  switch (type) {
    case 'emq_score':
      return getEmqGuidance(value, context);
    case 'capi_delivery_rate':
      return getCapiDeliveryGuidance(value, context);
    case 'signal_coverage':
      return getSignalCoverageGuidance(value, context);
    case 'audit_score':
      return getAuditScoreGuidance(value, context);
    case 'journey_gap':
      return getJourneyGapGuidance(value, context);
    case 'consent_rate':
      return getConsentRateGuidance(value, context);
    case 'implementation_progress':
      return getImplementationGuidance(value, context);
    default:
      return { summary: '', detail: '' };
  }
}
```

#### EMQ Score Guidance

```typescript
function getEmqGuidance(emq: number, ctx?: Record<string, any>) {
  const missingIds = ctx?.missing_identifiers as string[] | undefined;

  if (emq >= 8) {
    return {
      summary: 'Strong match quality.',
      detail: 'Your EMQ is above 8, which means Meta can match most of your conversion events to user profiles. This gives Andromeda 2 high-quality signal data for audience modeling and conversion optimization.',
    };
  }
  if (emq >= 6) {
    const idHint = missingIds?.length
      ? ` Adding ${missingIds[0]} as an identifier could increase this to ~${(emq + 1.5).toFixed(1)}.`
      : '';
    return {
      summary: 'Below target — room to improve.',
      detail: `Your EMQ of ${emq.toFixed(1)} means Meta can match roughly ${Math.round(emq * 10)}% of your events.${idHint} Higher EMQ typically improves conversion modeling by 15–20%, which directly lowers CPA.`,
      action: 'Configure identifiers in Conversion APIs',
    };
  }
  return {
    summary: 'Low match quality — action needed.',
    detail: `An EMQ of ${emq.toFixed(1)} means Meta is struggling to match your conversion events to user profiles. Your campaign optimization is severely limited. Prioritise adding email and phone number as identifiers.`,
    action: 'Configure identifiers in Conversion APIs',
  };
}
```

#### CAPI Delivery Rate Guidance

```typescript
function getCapiDeliveryGuidance(rate: number, ctx?: Record<string, any>) {
  const pct = Math.round(rate * 100);
  const failedCount = ctx?.failed_events as number | undefined;

  if (pct >= 98) {
    return {
      summary: 'Excellent delivery.',
      detail: 'Your server-side events are being delivered reliably. Both Meta and Google are receiving consistent conversion signals.',
    };
  }
  if (pct >= 90) {
    return {
      summary: 'Good, with minor issues.',
      detail: `${pct}% delivery rate. ${failedCount ? `${failedCount} events failed in the last 24 hours.` : ''} Most failures are retried successfully. Check the delivery log for persistent errors.`,
    };
  }
  return {
    summary: 'Delivery problems — campaigns affected.',
    detail: `At ${pct}% delivery, a significant portion of your conversion events aren't reaching the ad platforms. Meta's Andromeda 2 penalises inconsistent CAPI delivery more than no CAPI at all. This may be actively hurting campaign performance.`,
    action: 'Check Conversion APIs dashboard for error details',
  };
}
```

#### Signal Coverage Guidance

```typescript
function getSignalCoverageGuidance(pct: number) {
  if (pct >= 90) {
    return {
      summary: 'Comprehensive tracking.',
      detail: 'You\'re capturing most recommended signals. Your ad platforms have broad visibility into the customer journey, which helps them optimise beyond just last-click conversions.',
    };
  }
  if (pct >= 70) {
    return {
      summary: 'Good coverage with gaps.',
      detail: `At ${pct}% coverage, you're capturing the core conversion events but missing some mid-funnel signals. Both Google PMax and Meta Andromeda 2 use mid-funnel signals to build better audience models and optimise bidding. Adding these signals typically improves prospecting efficiency by 10–15%.`,
      action: 'View your Tracking Map to see which signals are missing',
    };
  }
  return {
    summary: 'Significant tracking gaps.',
    detail: `Only ${pct}% of recommended signals are being captured. Your ad platforms are making optimisation decisions with incomplete data, which leads to higher CPAs and less efficient spend.`,
    action: 'Run Set Up Tracking to identify what\'s missing',
  };
}
```

#### Audit Score Guidance

```typescript
function getAuditScoreGuidance(score: number) {
  if (score >= 85) return { summary: 'Strong signal infrastructure.', detail: 'Your tracking implementation is well-configured. Tags are firing correctly, data layer is structured properly, and platform signals are being captured.' };
  if (score >= 65) return { summary: 'Functional with issues.', detail: `A score of ${score} indicates some signals aren't firing correctly or are missing required parameters. Review the audit gap report for specific issues to fix.`, action: 'Review the latest gap report' };
  return { summary: 'Major issues — campaigns likely affected.', detail: `A score of ${score} indicates significant problems with your tracking infrastructure. Ad platforms are likely receiving incomplete or incorrect conversion data, which directly impacts bidding and optimisation.`, action: 'Run a new audit and address critical issues first' };
}
```

#### Consent Rate Guidance

```typescript
function getConsentRateGuidance(rate: number) {
  const pct = Math.round(rate * 100);
  if (pct >= 80) return { summary: 'High consent rate.', detail: `${pct}% of visitors are granting marketing consent. This means your CAPI and pixel signals have strong coverage.` };
  if (pct >= 50) return { summary: 'Moderate consent rate.', detail: `At ${pct}% consent, roughly half your visitor signals are blocked by consent requirements. Consider A/B testing banner copy and positioning to improve opt-in rates without compromising compliance.` };
  return { summary: 'Low consent rate — signal loss.', detail: `Only ${pct}% of visitors grant consent. This means most of your conversion signals are blocked, severely limiting what ad platforms can optimise against. Review your consent banner design and messaging.`, action: 'Review Consent & Privacy settings' };
}
```

#### Implementation Progress Guidance

```typescript
function getImplementationGuidance(pct: number, ctx?: Record<string, any>) {
  const blocked = ctx?.blocked as number | undefined;
  if (pct >= 100) return { summary: 'Fully implemented.', detail: 'All pages have been implemented and verified. Your tracking plan is live.' };
  if (pct >= 70) return { summary: 'Nearly complete.', detail: `${Math.round(pct)}% of pages are implemented.${blocked ? ` ${blocked} pages are blocked — check with your developer for unresolved issues.` : ' Share the Developer Handoff link to keep your developer on track.'}` };
  return { summary: 'Early stages.', detail: `Only ${Math.round(pct)}% of pages have been implemented. Until implementation is complete, your tracking plan exists only on paper. Share the Developer Handoff link to accelerate progress.`, action: 'Share Developer Handoff link' };
}
```

### 4.4 Integration Points

Add the `MetricGuidance` component to the following existing pages. In each case, place the component next to or below the relevant metric display:

| Page | File | Metric | MetricType |
|------|------|--------|-----------|
| CAPI Dashboard | Check CAPI-related pages | EMQ score display | `emq_score` |
| CAPI Dashboard | Check CAPI-related pages | Delivery rate display | `capi_delivery_rate` |
| Health Dashboard | `HealthDashboardPage.tsx` | Overall health score | `audit_score` |
| Signal Library | Signal Library page | Coverage percentage | `signal_coverage` |
| Consent Hub | Consent analytics page | Consent rate | `consent_rate` |
| Developer Portal | Developer portal page | Implementation % | `implementation_progress` |
| Journey Audit Results | Journey gap report page | Gap severity | `journey_gap` |
| Action Dashboard | `HomePage.tsx` (new) | All summary metrics | Various |

**Implementation approach**: Search each page for the metric value rendering (usually inside a `<span>`, `<Badge>`, or similar). Add the `<MetricGuidance>` component directly after it:

```tsx
{/* Existing metric display */}
<span className="text-2xl font-bold">{emqScore.toFixed(1)}</span>
{/* Add guidance */}
<MetricGuidance metricType="emq_score" value={emqScore} context={{ missing_identifiers: missingIds }} />
```

### 4.5 Acceptance Criteria

- [ ] `MetricGuidance` component renders correctly in both tooltip and expandable modes
- [ ] All 7 metric types have complete guidance copy
- [ ] Guidance is integrated into all 7+ pages listed in the integration table
- [ ] Guidance text changes dynamically based on the metric value
- [ ] Action links in guidance navigate to the correct routes
- [ ] No guidance text references old navigation labels (use new labels from Task 1)

---

## 5. Signal Inventory Spreadsheet Export

### 5.1 Objective

Export the Signal Library and implementation status as a formatted XLSX file that agencies can share with clients. This is the most-requested export format for agency-client communication.

### 5.2 Backend Endpoint

**File to create**: `backend/src/api/routes/exports.ts`

```typescript
import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { generateSignalInventoryXlsx } from '../../services/exports/signalInventoryExport';

const router = Router();

// GET /api/exports/signal-inventory?org_id=xxx&format=xlsx
router.get('/signal-inventory', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const orgId = req.query.org_id as string;
    const clientId = req.query.client_id as string | undefined;

    if (!orgId) {
      return res.status(400).json({ error: 'org_id is required' });
    }

    const buffer = await generateSignalInventoryXlsx(userId, orgId, clientId);

    const filename = clientId
      ? `signal-inventory-${clientId}-${new Date().toISOString().split('T')[0]}.xlsx`
      : `signal-inventory-${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Signal inventory export error:', err);
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

export default router;
```

**Mount in `backend/src/app.ts`**:

```typescript
import exportRoutes from './api/routes/exports';
app.use('/api/exports', exportRoutes);
```

### 5.3 Export Service

**File to create**: `backend/src/services/exports/signalInventoryExport.ts`

**Dependency**: Install `exceljs` — `npm install exceljs` in the backend directory.

```typescript
import ExcelJS from 'exceljs';
import { supabase } from '../database/supabaseClient';

export async function generateSignalInventoryXlsx(
  userId: string,
  orgId: string,
  clientId?: string
): Promise<Buffer> {
  // 1. Fetch signal data
  const signals = await fetchSignals(orgId, clientId);
  const implementations = await fetchImplementationStatus(orgId, clientId);
  const platformMappings = await fetchPlatformMappings(orgId, clientId);

  // 2. Create workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Atlas by Spi3l';
  workbook.created = new Date();

  // 3. Sheet 1: Signal Inventory
  const inventorySheet = workbook.addWorksheet('Signal Inventory');
  buildSignalInventorySheet(inventorySheet, signals, implementations);

  // 4. Sheet 2: Implementation Checklist
  const checklistSheet = workbook.addWorksheet('Implementation Checklist');
  buildImplementationChecklistSheet(checklistSheet, signals, implementations);

  // 5. Sheet 3: Platform Mapping
  const mappingSheet = workbook.addWorksheet('Platform Mapping');
  buildPlatformMappingSheet(mappingSheet, signals, platformMappings);

  // 6. Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

#### Sheet 1: Signal Inventory

Columns:
| Column | Header | Width | Description |
|--------|--------|-------|-------------|
| A | Signal Name | 30 | e.g., "purchase", "add_to_cart" |
| B | Signal Type | 15 | e.g., "conversion", "engagement", "pageview" |
| C | Description | 40 | Human-readable description |
| D | Platforms | 25 | Comma-separated: "GA4, Meta, Google Ads" |
| E | Priority | 12 | "Critical", "High", "Medium", "Low" |
| F | Status | 15 | "Verified", "Implemented", "Pending", "Not Started" |
| G | Last Verified | 18 | Date or "—" |
| H | Page(s) | 35 | Which pages this signal fires on |

Formatting:
- Header row: bold, white text on navy background (`1B2A4A`), frozen
- Status column: conditional fill colors — green for Verified, blue for Implemented, amber for Pending, red for Not Started
- Auto-filter enabled on all columns
- Column widths set explicitly (ExcelJS `column.width`)

#### Sheet 2: Implementation Checklist

Grouped by page URL. Columns:
| Column | Header | Width |
|--------|--------|-------|
| A | Page URL | 40 |
| B | Signal Name | 25 |
| C | Expected Event | 20 |
| D | dataLayer Key | 25 |
| E | Status | 15 |
| F | Developer Notes | 35 |

Each page URL is a merged header row spanning all columns, with a light background. Signals for that page are listed below it.

#### Sheet 3: Platform Mapping

Shows how each signal maps to each ad platform's event taxonomy. Columns:
| Column | Header | Width |
|--------|--------|-------|
| A | Atlas Signal | 25 |
| B | GA4 Event | 25 |
| C | Google Ads Conversion | 25 |
| D | Meta Standard Event | 25 |
| E | TikTok Event | 20 |
| F | LinkedIn Event | 20 |

Empty cells where a signal doesn't map to a platform.

### 5.4 Frontend Integration

**File to modify**: Signal Library page (find the page that renders the signal inventory list)

Add an "Export" button in the page header area, next to any existing action buttons:

```tsx
import { Download } from 'lucide-react';

<Button
  variant="outline"
  size="sm"
  onClick={handleExport}
  disabled={exporting}
>
  <Download className="h-4 w-4 mr-2" />
  {exporting ? 'Exporting...' : 'Export to Excel'}
</Button>
```

The `handleExport` function:

```typescript
const handleExport = async () => {
  setExporting(true);
  try {
    const response = await fetch(`/api/exports/signal-inventory?org_id=${activeOrgId}`, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });
    if (!response.ok) throw new Error('Export failed');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-inventory-${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export error:', err);
    // Show toast error notification
  } finally {
    setExporting(false);
  }
};
```

Also add the export button to the Action Dashboard — in the summary bar area, add a small "Export tracking map" link that triggers the same download.

### 5.5 Acceptance Criteria

- [ ] `GET /api/exports/signal-inventory` returns valid XLSX binary
- [ ] XLSX has 3 worksheets: Signal Inventory, Implementation Checklist, Platform Mapping
- [ ] Signal Inventory sheet has correct headers, formatting, conditional colors, and auto-filter
- [ ] Implementation Checklist groups signals by page URL
- [ ] Platform Mapping shows all configured platform event mappings
- [ ] Export button on Signal Library page triggers download
- [ ] File downloads with correct filename pattern
- [ ] Export works for orgs with no signals (produces valid empty XLSX with headers)
- [ ] Export filtered by client_id when specified

---

## 6. Implementation Notes

### 6.1 Database Schema

**No new tables are required for Phase 1.** The Action Dashboard queries existing tables only. Verify the following tables exist and contain the expected data before starting Task 2:

- CAPI provider config table (stores provider name, credentials, status)
- CAPI event/delivery log table (stores delivery attempts, success/failure, EMQ)
- Developer portal pages table (stores page URL, implementation status)
- Audits table (stores audit results, scores, timestamps)
- Signals table (stores signal definitions, types, platform mappings)
- Signal implementation status (either a column on signals or a join table)

Run these queries against the Supabase database to confirm schema before building the dashboard service:

```sql
-- Check CAPI tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE '%capi%';

-- Check developer portal tables  
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE '%developer%' OR table_name LIKE '%portal%';

-- Check audit tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE '%audit%';

-- Check signal tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE '%signal%';
```

If any expected table doesn't exist or has a different name, adapt the queries in `dashboardService.ts` accordingly. The logic stays the same — only the table/column names might differ.

### 6.2 Environment Variables

No new environment variables needed. The dashboard service uses the existing Supabase connection already configured in the backend.

### 6.3 Dependencies

**Backend**:
- `exceljs` — for XLSX generation (Task 6 only). Install: `cd backend && npm install exceljs`

**Frontend**:
- No new dependencies. Uses existing shadcn/ui components.

### 6.4 Testing Notes

- Test the dashboard with a fresh user account (no data) — all null handling must work
- Test with an org that has CAPI configured but no events yet
- Test with an org that has signals defined but no audits run
- Test the XLSX export with unicode characters in signal names
- Test navigation label changes don't break any direct URL access (bookmarks, shared links)

---

## 7. Relationship to Future Phases

This Phase 1 work creates the foundation for:

- **Phase 2 (Crawl Signal Extractor)**: The Action Dashboard will display crawl results as new card types. The export endpoint will be extended to include crawl reports.
- **Phase 3 (Data Quality Monitor)**: DQM alerts will be the primary source of `critical` and `warning` cards on the Action Dashboard. The dashboard service will query the DQM alert table once it exists.
- **Phase 4 (Export & Integration)**: The `/api/exports` route created in Task 6 will be extended with additional export types (monitoring data API, structured issue export, client health report PDF).

The dashboard's card system is designed to be extensible — new card types can be added by adding new functions to `dashboardService.ts` without changing the frontend. The `CardCategory` type can be extended with new values as modules are added.

---

## 8. Deployment Checklist

- [ ] All backend changes deployed to Render
- [ ] All frontend changes deployed to Vercel
- [ ] `exceljs` dependency installed in production backend
- [ ] Dashboard API endpoint accessible and returning data
- [ ] XLSX export endpoint accessible and returning valid files
- [ ] Sidebar labels updated in production
- [ ] All existing routes still functional (regression test)
- [ ] No console errors on any page
- [ ] Mobile responsive check on dashboard page
