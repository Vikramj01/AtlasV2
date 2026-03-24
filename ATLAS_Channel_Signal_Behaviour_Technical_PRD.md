# Channel Signal Behaviour — Technical Implementation PRD

> **Companion to:** ATLAS_Channel_Signal_Behaviour_PRD.docx (product PRD)
> **Status:** Draft · March 2026
> **Codebase:** github.com/Vikramj01/AtlasV2
> **Author:** Vikram / Spi3l LLC

---

## 1. Implementation Overview

Channel Signal Behaviour (CSB) adds a channel dimension to Atlas's signal layer. This document specifies the exact files to create, modify, and extend — scoped so Claude Code can execute against it.

**Closest existing analog:** The Data Health feature (`/health` route, `healthRouter`, `healthQueries.ts`, `HealthDashboardPage.tsx`). CSB follows the same architectural pattern: Express route → database queries → Bull queue for async computation → React page with direct API calls.

### New files to create

```
backend/src/
├── api/routes/channels.ts                    # Express router: /api/channels/*
├── services/database/channelQueries.ts       # Supabase query functions
├── services/channels/                        # CSB business logic
│   ├── sessionIngestion.ts                   # Event ingestion & channel classification
│   ├── journeyComputation.ts                 # Aggregate sessions → journey maps
│   └── diagnosticEngine.ts                   # Correlate drop-offs with signal health
├── types/channel.ts                          # TypeScript interfaces

frontend/src/
├── pages/ChannelInsightsPage.tsx              # Main page (3 tabs)
├── components/channels/                       # CSB-specific components
│   ├── ChannelOverviewTable.tsx               # Overview tab: channel comparison table
│   ├── ChannelHealthIndicator.tsx             # Green/amber/red composite indicator
│   ├── JourneyFlowComparison.tsx              # Journeys tab: side-by-side flow
│   ├── JourneyStep.tsx                        # Single step in flow diagram
│   ├── DiagnosticsFeed.tsx                    # Diagnostics tab: prioritised list
│   ├── DiagnosticCard.tsx                     # Single diagnostic item
│   └── ChannelHomeCard.tsx                    # Home page action card
├── lib/api/channelApi.ts                      # API client functions
├── types/channel.ts                           # Frontend type definitions
├── store/channelStore.ts                      # Zustand store (optional, may use direct fetch)

db/migrations/
├── 005_create_channel_tables.sql              # Supabase migration
```

### Files to modify

```
backend/src/app.ts                            # Mount channelsRouter
backend/src/services/queue/jobQueue.ts        # Add channelQueue
backend/src/services/queue/worker.ts          # Add channel job processor
frontend/src/App.tsx                          # Add /channels route
frontend/src/components/layout/Sidebar.tsx    # Add Channel Insights nav item
frontend/src/pages/HomePage.tsx               # Add third action card
frontend/src/components/common/SetupChecklist.tsx  # Add "Enable channel tracking" step
```

---

## 2. Database Schema

### Migration: `db/migrations/005_create_channel_tables.sql`

```sql
-- Atlas Channel Signal Behaviour
-- Migration 005: Channel session and journey tables

-- ─── channel_sessions ────────────────────────────────────────────────────────
-- One row per user session, tagged with acquisition channel.

CREATE TABLE IF NOT EXISTS public.channel_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  session_ext_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN (
    'google_ads', 'meta_ads', 'tiktok_ads', 'linkedin_ads',
    'organic_search', 'paid_search_other', 'organic_social', 'paid_social_other',
    'email', 'referral', 'direct', 'other'
  )),
  source TEXT,
  medium TEXT,
  campaign TEXT,
  device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'other')),
  browser TEXT,
  landing_page TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  event_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  conversion_reached BOOLEAN NOT NULL DEFAULT false,
  signal_completion_score NUMERIC(4,3) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_channel_sessions_user ON public.channel_sessions(user_id);
CREATE INDEX idx_channel_sessions_site ON public.channel_sessions(user_id, website_url);
CREATE INDEX idx_channel_sessions_channel ON public.channel_sessions(channel);
CREATE INDEX idx_channel_sessions_started ON public.channel_sessions(started_at DESC);
CREATE UNIQUE INDEX idx_channel_sessions_ext ON public.channel_sessions(user_id, website_url, session_ext_id);

-- ─── channel_session_events ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.channel_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.channel_sessions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL CHECK (event_category IN (
    'page_view', 'micro_conversion', 'macro_conversion', 'engagement'
  )),
  page_url TEXT,
  event_params JSONB DEFAULT '{}',
  signal_health_status TEXT CHECK (signal_health_status IN (
    'healthy', 'degraded', 'missing', 'unknown'
  )) DEFAULT 'unknown',
  seq INTEGER NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cse_session ON public.channel_session_events(session_id);
CREATE INDEX idx_cse_event ON public.channel_session_events(event_name);

-- ─── channel_journey_maps ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.channel_journey_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  channel TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  conversion_rate NUMERIC(5,4) DEFAULT 0,
  avg_pages_per_session NUMERIC(5,2) DEFAULT 0,
  avg_events_per_session NUMERIC(5,2) DEFAULT 0,
  signal_completion_score NUMERIC(4,3) DEFAULT 0,
  journey_steps JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cjm_user_site ON public.channel_journey_maps(user_id, website_url);
CREATE UNIQUE INDEX idx_cjm_unique ON public.channel_journey_maps(user_id, website_url, channel, period_start, period_end);

-- ─── channel_diagnostics ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.channel_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  channel TEXT NOT NULL,
  diagnostic_type TEXT NOT NULL CHECK (diagnostic_type IN (
    'signal_gap', 'journey_divergence', 'engagement_anomaly', 'consent_impact'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  affected_pages TEXT[] DEFAULT '{}',
  estimated_impact TEXT,
  recommended_action TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_cd_user_site ON public.channel_diagnostics(user_id, website_url);
CREATE INDEX idx_cd_severity ON public.channel_diagnostics(severity);
CREATE INDEX idx_cd_unresolved ON public.channel_diagnostics(user_id, website_url) WHERE NOT is_resolved;

-- ─── RLS policies ────────────────────────────────────────────────────────────

ALTER TABLE public.channel_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_journey_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own channel_sessions"
  ON public.channel_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own channel_session_events"
  ON public.channel_session_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.channel_sessions cs
    WHERE cs.id = channel_session_events.session_id AND cs.user_id = auth.uid()
  ));

CREATE POLICY "Users read own channel_journey_maps"
  ON public.channel_journey_maps FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own channel_diagnostics"
  ON public.channel_diagnostics FOR SELECT USING (auth.uid() = user_id);
```

### Journey Steps JSON Schema

```typescript
interface JourneyStep {
  step_number: number;
  type: 'page_view' | 'event';
  identifier: string;
  session_count: number;
  percentage: number;
  drop_off_rate: number;
  signal_health: 'healthy' | 'degraded' | 'missing' | 'mixed';
  signal_health_detail?: string;
}
```

---

## 3. Backend Implementation

### 3.1 Types: `backend/src/types/channel.ts`

```typescript
export type ChannelType =
  | 'google_ads' | 'meta_ads' | 'tiktok_ads' | 'linkedin_ads'
  | 'organic_search' | 'paid_search_other' | 'organic_social' | 'paid_social_other'
  | 'email' | 'referral' | 'direct' | 'other';

export type EventCategory = 'page_view' | 'micro_conversion' | 'macro_conversion' | 'engagement';
export type SignalHealthStatus = 'healthy' | 'degraded' | 'missing' | 'unknown';
export type DiagnosticType = 'signal_gap' | 'journey_divergence' | 'engagement_anomaly' | 'consent_impact';
export type Severity = 'critical' | 'warning' | 'info';

export interface SessionEvent {
  event_name: string;
  event_category: EventCategory;
  page_url?: string;
  event_params?: Record<string, unknown>;
  fired_at: string;
}

export interface IngestSessionPayload {
  session_id: string;
  website_url: string;
  channel_hints: {
    referrer?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    gclid?: string;
    fbclid?: string;
    ttclid?: string;
  };
  device_type?: string;
  browser?: string;
  landing_page: string;
  events: SessionEvent[];
}

export interface ChannelOverview {
  channel: ChannelType;
  total_sessions: number;
  conversion_rate: number;
  signal_completion_score: number;
  avg_pages_per_session: number;
  avg_events_per_session: number;
  health_status: 'healthy' | 'warning' | 'critical';
}

export interface ChannelDiagnostic {
  id: string;
  channel: ChannelType;
  diagnostic_type: DiagnosticType;
  severity: Severity;
  title: string;
  description: string;
  affected_pages: string[];
  estimated_impact: string | null;
  recommended_action: string | null;
  created_at: string;
}
```

### 3.2 Routes: `backend/src/api/routes/channels.ts`

```
GET  /api/channels/overview              — channel comparison table
GET  /api/channels/journeys              — all channel journey maps
GET  /api/channels/journeys/:channel     — single channel detail
GET  /api/channels/diagnostics           — active diagnostics
POST /api/channels/ingest                — receive session batches from WalkerOS
POST /api/channels/compute               — trigger journey computation
POST /api/channels/diagnostics/:id/resolve — mark resolved
```

Pattern: follows `backend/src/api/routes/health.ts` exactly — `authMiddleware`, `sendInternalError`, query functions from `channelQueries.ts`.

### 3.3 Channel Classification: `backend/src/services/channels/sessionIngestion.ts`

Classification hierarchy (implement in priority order):

```
1. Click ID:  gclid → google_ads | fbclid → meta_ads | ttclid → tiktok_ads
2. UTM:       medium=cpc/ppc → map source to ad platform | medium=social → organic_social | medium=email → email | medium=referral → referral
3. Referrer:  google/bing/yahoo → organic_search | facebook/instagram/twitter/linkedin → organic_social | other → referral
4. Fallback:  → direct
```

### 3.4 Queue Addition: `backend/src/services/queue/jobQueue.ts`

Add `channelQueue` following the `healthQueue` pattern:

```typescript
export interface ChannelJobData {
  trigger: 'scheduled' | 'manual';
  user_id?: string;
  website_url?: string;
}

export const channelQueue = new Bull<ChannelJobData>('channel', {
  redis: buildRedisOpts(env.REDIS_URL),
  defaultJobOptions: { attempts: 1, timeout: 5 * 60 * 1000, removeOnComplete: 10, removeOnFail: 10 },
});
```

### 3.5 Mount in `backend/src/app.ts`

```typescript
import { channelsRouter } from '@/api/routes/channels';
app.use('/api/channels', channelsRouter);
```

---

## 4. Frontend Implementation

### 4.1 API Client: `frontend/src/lib/api/channelApi.ts`

Follow `healthApi.ts` pattern. Functions: `getOverview(site?, days?)`, `getJourneys(site?, days?)`, `getDiagnostics(site?)`, `triggerCompute(site?)`, `resolveDiagnostic(id)`.

### 4.2 Sidebar: `frontend/src/components/layout/Sidebar.tsx`

Add to `PERSONAL_NAV` after Data Health:

```typescript
{ label: 'Channel Insights', to: '/channels', Icon: GitBranch },
```

Also add to `orgNav()` in same position. Import `GitBranch` from `lucide-react`.

### 4.3 Route: `frontend/src/App.tsx`

```typescript
import { ChannelInsightsPage } from '@/pages/ChannelInsightsPage';
// Inside AppLayout routes:
<Route path="/channels" element={<ChannelInsightsPage />} />
```

### 4.4 Home Card: `frontend/src/pages/HomePage.tsx`

Add third card after audit card. Icon: `GitBranch` in emerald-100/emerald-600. Title: "Analyse channel behaviour". CTA: "View channels →".

### 4.5 Main Page: `frontend/src/pages/ChannelInsightsPage.tsx`

Three tabs using `@/components/ui/tabs`:
- **Overview** (default): `ChannelOverviewTable` — table comparing all channels
- **Journeys**: `JourneyFlowComparison` — visual flow side-by-side
- **Diagnostics**: `DiagnosticsFeed` — prioritised diagnostic list

Page fetches via `channelApi` in `useEffect` (no Zustand store, same as `HealthDashboardPage`). Includes date range selector and site selector.

---

## 5. Phased Build Plan

### Phase 1 (2–3 weeks): Foundation + Overview
1. Migration `005_create_channel_tables.sql`
2. `backend/src/types/channel.ts`
3. `backend/src/services/database/channelQueries.ts`
4. `backend/src/services/channels/sessionIngestion.ts`
5. `backend/src/api/routes/channels.ts`
6. Add `channelQueue` to `jobQueue.ts`
7. Mount in `app.ts`
8. `frontend/src/types/channel.ts`
9. `frontend/src/lib/api/channelApi.ts`
10. Modify `Sidebar.tsx`
11. Modify `App.tsx`
12. `ChannelInsightsPage.tsx` (Overview tab only)
13. `ChannelOverviewTable.tsx` + `ChannelHealthIndicator.tsx`
14. Modify `HomePage.tsx`

### Phase 2 (2–3 weeks): Journeys
15. `backend/src/services/channels/journeyComputation.ts`
16. Channel job processor in `worker.ts`
17. `JourneyFlowComparison.tsx` + `JourneyStep.tsx`
18. Journeys tab in `ChannelInsightsPage.tsx`

### Phase 3 (2 weeks): Diagnostics
19. `backend/src/services/channels/diagnosticEngine.ts`
20. `DiagnosticsFeed.tsx` + `DiagnosticCard.tsx`
21. Diagnostics tab + alert banner
22. Modify `SetupChecklist.tsx`

---

## 6. Codebase Conventions

- **Auth**: `authMiddleware` sets `req.user.id` from Supabase JWT
- **Errors**: `sendInternalError(res, err)` from `@/utils/apiError`
- **Logging**: `logger` from `@/utils/logger` (pino)
- **DB writes**: Backend service role key (bypasses RLS). No user write policies.
- **DB reads**: Through backend API, not direct Supabase client
- **UI**: shadcn/ui components in `@/components/ui/*`
- **Styling**: Tailwind. Existing colour tokens: `text-primary`, `bg-primary/10`, `text-muted-foreground`
- **Icons**: `lucide-react`
- **Pages**: `*Page.tsx` in `pages/`
- **Components**: PascalCase in feature folders under `components/`
- **Tests**: vitest, pattern in `backend/src/services/audit/__tests__/`

---

*This document + the product PRD form the complete handoff for Claude Code.*
