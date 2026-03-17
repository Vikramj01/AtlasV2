# CLAUDE.md — Atlas Phase 1: Consent Integration Hub + Conversion API Module

## Project Context

Atlas is a marketing signal optimisation and tracking infrastructure platform built for agencies, consultancies, and SMB marketers. It's hosted at atlas.spi3l.com.

### What Atlas Does Today
- **Journey Builder**: Guided wizard + AI-assisted flow for defining customer journeys and generating composable tracking tags
- **Planning Mode**: AI agent that scans sites, recommends tagging, and generates GTM container JSON
- **Validation Engine**: 26 rules across 3 layers (signal initiation, parameter completeness, persistence)
- **Chrome Extension**: Scans website tracking tags and identifies existing implementations
- **Dual GTM Output**: Generates both client-side and server-side GTM container configurations
- **WalkerOS Integration**: Uses WalkerOS as the vendor-neutral event collection/data layer

### Tech Stack
- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes + Supabase Edge Functions
- **Database**: Supabase (PostgreSQL) for app state; DuckDB/MotherDuck for analytics
- **Auth**: Supabase Auth (email + OAuth)
- **Hosting**: Vercel
- **State Management**: Zustand
- **Forms**: react-hook-form + zod
- **Payments**: Stripe (future)

### Existing Supabase Schema (tables you must NOT modify)
```sql
-- These tables exist and are in use. Do not alter them.
organizations (id, name, type, plan, created_at)
profiles (id [FK auth.users], organization_id, full_name, role, created_at)
clients (id, organization_id, name, website_url, industry, created_at)
projects (id, organization_id, client_id, name, status, phase_data, created_by, created_at, updated_at)
planning_sessions (id, user_id, site_url, business_type, business_context, platforms, implementation_format, status, created_at, updated_at)
planning_pages (id, session_id, url, label, page_type, scan_status, is_selected, page_capture, ai_analysis, error, created_at)
planning_recommendations (id, session_id, page_id, element_reference, selector, recommendation_type, ...)
```

RLS is enabled with organization-level isolation. All new tables MUST follow this pattern.

### Existing Folder Structure
```
atlas/
├── frontend/src/
│   ├── app/                    # Next.js App Router pages
│   ├── components/
│   │   ├── layout/             # Sidebar, Header, Layout
│   │   ├── wizard/             # Journey Builder wizard phases
│   │   ├── journey/            # JourneyList, JourneyCard, StepEditor
│   │   ├── conversion/         # ConversionConfig, PlatformMapper
│   │   └── clients/            # ClientList, ClientCard
│   ├── pages/                  # Dashboard, Projects, Clients, Templates
│   ├── services/               # api.ts, gtm-generator.ts
│   ├── store/                  # Zustand stores
│   ├── types/                  # TypeScript interfaces
│   └── utils/                  # validation.ts, formatting.ts
├── backend/src/                # (if separate — some logic in Next.js API routes)
├── supabase/
│   └── migrations/             # SQL migration files
└── package.json
```

---

## What You Are Building

Two features that extend Atlas's existing event pipeline:

### Feature 1: Consent Integration Hub
A consent management layer with two modes:
- **Built-in Mode**: Lightweight consent banner Atlas generates and injects alongside tracking tags
- **Integration Mode**: Bidirectional sync with external CMPs (OneTrust, Cookiebot, Usercentrics)

Key capabilities: consent collection, storage, enforcement (gates tag firing + CAPI forwarding), Google Consent Mode v2 signal generation, consent analytics dashboard.

### Feature 2: Conversion API Module
Server-side conversion API integrations with a provider-abstracted architecture:
- **Meta Conversions API** (ships first)
- **Google Enhanced Conversions** (ships alongside or immediately after)
- Architecture designed so TikTok, LinkedIn, Snapchat adapters plug in later

Key capabilities: guided setup wizard, automatic PII hashing (SHA-256), event deduplication, consent gating, EMQ monitoring, delivery dashboard.

### How They Connect
```
User visits site
  → Consent banner/CMP collects decision
  → Consent state stored in Atlas + propagated to data layer
  → WalkerOS collects events (with consent state attached)
  → Atlas validation engine checks quality + consent compliance
  → Consented conversion events route to CAPI Module
  → CAPI Module hashes PII, formats payload, sends to Meta/Google
  → Delivery confirmation + EMQ scores logged to dashboard
```

---

## Implementation Rules

### Must Follow
1. **All new tables** go in `supabase/migrations/` as numbered SQL files
2. **RLS required** on every new table — use the org_isolation pattern from existing tables
3. **Credentials encryption** — provider tokens/API keys stored in `capi_providers.credentials` must be encrypted. Use Supabase Vault if available, otherwise AES-256 at the application layer
4. **No PII in logs** — never log unhashed email, phone, or other personal data
5. **Consent-first** — every event entering or leaving Atlas must carry a consent state. No data processing without consent validation
6. **Provider adapter pattern** — the CAPI module uses a TypeScript interface (`CAPIProviderAdapter`) that all providers implement. Never put Meta-specific or Google-specific logic in the core pipeline
7. **shadcn/ui components** — use existing shadcn/ui components for all new UI. Install additional components as needed via `npx shadcn add [component]`
8. **Zod validation** — all API request/response bodies validated with Zod schemas
9. **Error boundaries** — wrap all new pages/features in React error boundaries
10. **Loading states** — every async operation shows a loading indicator (use shadcn Skeleton)

### Code Style
- TypeScript strict mode
- Functional components only (no class components)
- Server components by default; 'use client' only when needed
- API routes use Next.js Route Handlers (app/api/...)
- Database queries via Supabase JS client (not raw SQL in application code)
- Zustand for client-side state; server state via React Query or SWR

### Testing
- Unit tests for PII hashing (critical path — must not leak unhashed data)
- Unit tests for provider adapter payload formatting
- Integration tests for consent → CAPI pipeline flow
- E2E tests for the setup wizard flows

---

## File Placement Guide

Place new files in these locations:

```
atlas/
├── frontend/src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── consent/                    # Consent settings + analytics pages
│   │   │   │   ├── page.tsx
│   │   │   │   └── analytics/page.tsx
│   │   │   └── integrations/
│   │   │       └── capi/                   # CAPI provider setup + dashboard
│   │   │           ├── page.tsx
│   │   │           ├── [providerId]/
│   │   │           │   ├── setup/page.tsx  # 5-step wizard
│   │   │           │   └── dashboard/page.tsx
│   │   │           └── layout.tsx
│   │   └── api/
│   │       └── v1/
│   │           ├── consent/
│   │           │   ├── route.ts            # POST (record consent)
│   │           │   ├── [projectId]/
│   │           │   │   ├── [visitorId]/route.ts  # GET, DELETE
│   │           │   │   └── analytics/route.ts    # GET
│   │           │   └── config/route.ts     # GET, PUT consent config
│   │           └── capi/
│   │               ├── providers/
│   │               │   ├── route.ts        # POST (create provider)
│   │               │   └── [id]/
│   │               │       ├── route.ts    # GET, PUT, DELETE
│   │               │       ├── test/route.ts     # POST (test events)
│   │               │       ├── activate/route.ts # PUT
│   │               │       └── dashboard/route.ts # GET
│   │               └── process/route.ts    # Internal: event processing endpoint
│   ├── components/
│   │   ├── consent/
│   │   │   ├── ConsentSettings.tsx
│   │   │   ├── BannerConfigurator.tsx
│   │   │   ├── CMPIntegration.tsx
│   │   │   ├── CategoryEditor.tsx
│   │   │   ├── ConsentAnalyticsDashboard.tsx
│   │   │   └── BannerPreview.tsx
│   │   └── capi/
│   │       ├── ProviderList.tsx
│   │       ├── SetupWizard.tsx
│   │       ├── steps/
│   │       │   ├── ConnectAccount.tsx
│   │       │   ├── MapEvents.tsx
│   │       │   ├── ConfigureIdentifiers.tsx
│   │       │   ├── TestVerify.tsx
│   │       │   └── Activate.tsx
│   │       ├── EMQEstimator.tsx
│   │       ├── CAPIMonitoringDashboard.tsx
│   │       ├── DeliveryTimeline.tsx
│   │       └── ErrorLog.tsx
│   ├── lib/
│   │   ├── consent/
│   │   │   ├── consent-engine.ts           # Consent state management
│   │   │   ├── gcm-mapper.ts              # Google Consent Mode mapping
│   │   │   ├── banner-generator.ts        # Generate banner JS snippet
│   │   │   └── cmp-listeners.ts           # OneTrust/Cookiebot/Usercentrics bridges
│   │   ├── capi/
│   │   │   ├── pipeline.ts                # Core event processing pipeline
│   │   │   ├── hash-pii.ts               # SHA-256 PII hashing
│   │   │   ├── dedup.ts                   # Event deduplication logic
│   │   │   ├── queue.ts                   # Event queue management
│   │   │   └── adapters/
│   │   │       ├── types.ts               # CAPIProviderAdapter interface
│   │   │       ├── meta.ts               # Meta Conversions API adapter
│   │   │       ├── google.ts             # Google Enhanced Conversions adapter
│   │   │       ├── tiktok.ts             # (stub for Phase 1.5)
│   │   │       └── linkedin.ts           # (stub for Phase 1.5)
│   │   └── shared/
│   │       └── crypto.ts                  # Shared hashing utilities
│   ├── store/
│   │   ├── consentStore.ts
│   │   └── capiStore.ts
│   └── types/
│       ├── consent.ts
│       └── capi.ts
├── supabase/
│   └── migrations/
│       ├── 20260317_001_consent_tables.sql
│       └── 20260317_002_capi_tables.sql
└── scripts/
    └── generate-consent-banner.ts  # CLI tool to preview banner output
```

---

## Development Sequence

### Sprint 0 (Week 1-2): Shared Foundation
1. Run the Supabase migration (creates all new tables)
2. Implement `types/consent.ts` and `types/capi.ts`
3. Implement `lib/shared/crypto.ts` (SHA-256 hashing)
4. Implement `lib/capi/hash-pii.ts`
5. Implement `lib/capi/adapters/types.ts` (provider interface)

### Sprint 1 (Week 3-4): Consent Core
1. Consent API routes (POST, GET, DELETE)
2. `ConsentSettings.tsx` page with built-in banner configurator
3. `banner-generator.ts` — generates the JS snippet
4. `consent-engine.ts` — state management + GCM mapping
5. Basic consent analytics API route

### Sprint 2 (Week 5-6): Meta CAPI Adapter
1. `lib/capi/adapters/meta.ts` — full Meta adapter
2. `lib/capi/pipeline.ts` — core processing pipeline
3. `lib/capi/dedup.ts` — event deduplication
4. CAPI provider API routes (create, test, activate)
5. `SetupWizard.tsx` with all 5 steps (Meta-specific)

### Sprint 3 (Week 7-8): Google Adapter + CMP Integration
1. `lib/capi/adapters/google.ts` — Google Enhanced Conversions adapter
2. `lib/consent/cmp-listeners.ts` — OneTrust, Cookiebot, Usercentrics
3. `CMPIntegration.tsx` component
4. Extend SetupWizard for Google (OAuth flow, conversion action selection)

### Sprint 4 (Week 9-10): Dashboards + Consent Enforcement
1. `ConsentAnalyticsDashboard.tsx`
2. `CAPIMonitoringDashboard.tsx`
3. Consent enforcement in the event pipeline (consent gates CAPI)
4. `lib/capi/queue.ts` — retry logic, dead letter handling
5. Error log UI

### Sprint 5 (Week 11-12): Integration Testing + Polish
1. End-to-end consent → CAPI pipeline testing
2. Load testing (5,000 events/min target)
3. Edge case handling (token expiry, rate limiting, burst traffic)
4. Documentation
5. Beta launch prep

---

## Key Technical Decisions (Already Made)

1. **Supabase for everything** — no new database systems. Consent records and CAPI events go in Supabase tables, not DuckDB.
2. **Next.js API routes for CAPI processing** — not Supabase Edge Functions. The CAPI pipeline needs access to encryption keys and provider credentials that are easier to manage in the Next.js server environment.
3. **Provider credentials encrypted at rest** — use `@noble/ciphers` for AES-256-GCM encryption of tokens stored in JSONB columns.
4. **Event queue in Supabase** — for Phase 1, the event queue is a Supabase table with status-based polling. If throughput becomes an issue in Phase 2, migrate to a proper queue (Inngest, Trigger.dev, or Supabase Realtime).
5. **No external CMP dependency for built-in mode** — the built-in consent banner is a self-contained JS snippet that Atlas generates. It does NOT require OneTrust or any other third-party service.

---

## Reference Documents

The full PRD with detailed specs is in: `docs/atlas-prd-consent-capi.docx`

Key sections to reference:
- **Section 6**: Consent data models (complete column definitions)
- **Section 7**: Consent API specifications (request/response formats)
- **Section 13**: CAPI data models (complete column definitions)
- **Section 14**: CAPI API specifications + Meta/Google payload formats
- **Section 9 & 16**: Error handling & edge cases
- **Section 10 & 17**: Acceptance criteria & test plans
