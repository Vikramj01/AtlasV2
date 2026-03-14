# Composable Signals & Agency Workspaces — Sprint Plan

Source PRD: `ATLAS_Composable_Signals_PRD.md`
Implementation branch: `claude/atlas-cx-enhancements-eeCd2`

---

## Architecture Summary

Three-layer model:
1. **Signal Library** — platform-agnostic signal definitions + reusable packs (org-owned or system)
2. **Client Projects** — per-client URLs, measurement IDs, deployed packs
3. **Outputs** — GTM container JSON, WalkerOS flow.json, dataLayer spec (generated per client)

## Sprint Overview

| Sprint | Scope | Key Deliverables |
|--------|-------|-----------------|
| Sprint 1 | Organisation & Client Foundation | DB migrations, org/client CRUD, sidebar workspace switcher |
| Sprint 2 | Signal Library | Signal + pack CRUD, system seed data, signal library UI |
| Sprint 3 | Deployments & Output Generation | Deploy packs to clients, composable GTM + WalkerOS generators |
| Sprint 4 | Integration & Polish | Audit from deployments, Planning Mode integration, bulk regenerate |

---

## Sprint 1 — Organisation & Client Foundation

### DB Migrations
See `docs/composable-signals-migrations.md` for the full SQL.

Tables created:
- `organisations` — agency/team accounts
- `organisation_members` — user membership + roles
- `clients` — per-client website projects
- `client_platforms` — measurement IDs per platform per client
- `client_pages` — funnel page URLs per client

Nullable `client_id` columns added to: `planning_sessions`, `journeys`, `audits`

### Backend

| File | What it does |
|------|-------------|
| `backend/src/types/organisation.ts` | TypeScript types for all org/client entities |
| `backend/src/services/database/orgQueries.ts` | Organisation + member CRUD |
| `backend/src/services/database/clientQueries.ts` | Client + platform + page CRUD |
| `backend/src/api/middleware/orgMiddleware.ts` | Validates org membership, attaches `req.org` |
| `backend/src/api/routes/organisations.ts` | `/api/organisations` CRUD + member management |
| `backend/src/api/routes/clients.ts` | `/api/organisations/:orgId/clients` CRUD + platforms + pages |

### Frontend

| File | What it does |
|------|-------------|
| `frontend/src/types/organisation.ts` | Shared org/client types |
| `frontend/src/lib/api/organisationApi.ts` | API client for orgs + clients |
| `frontend/src/store/organisationStore.ts` | Current org, clients list, members |
| `frontend/src/pages/OrgDashboardPage.tsx` | Org overview: clients grid, health summary |
| `frontend/src/pages/ClientListPage.tsx` | Client list with health scores |
| `frontend/src/pages/ClientDetailPage.tsx` | Client detail: platforms, pages, deployments, outputs |
| `frontend/src/components/organisation/OrgSwitcher.tsx` | Workspace switcher in sidebar |
| `frontend/src/components/organisation/ClientCard.tsx` | Client card for list view |
| `frontend/src/components/organisation/ClientSetupWizard.tsx` | 4-step client onboarding |
| `frontend/src/components/organisation/MemberManagement.tsx` | Invite/remove/role UI |

---

## Sprint 2 — Signal Library

### DB Migrations
- `signals` — platform-agnostic signal definitions (system + custom)
- `signal_packs` — reusable collections
- `signal_pack_signals` — many-to-many join
- Seed: 8 system signals from action primitives
- Seed: 4 system packs (Ecommerce, SaaS, Lead Gen, Content)

### Backend

| File | What it does |
|------|-------------|
| `backend/src/types/signal.ts` | TypeScript types for Signal, SignalPack, etc. |
| `backend/src/services/database/signalQueries.ts` | Signal + pack CRUD |
| `backend/src/api/routes/signals.ts` | `/api/signals` + `/api/signal-packs` CRUD |

### Frontend

| File | What it does |
|------|-------------|
| `frontend/src/types/signal.ts` | Shared signal types |
| `frontend/src/lib/api/signalApi.ts` | API client for signals + packs |
| `frontend/src/store/signalStore.ts` | Signals, packs, deployments state |
| `frontend/src/pages/SignalLibraryPage.tsx` | Browse signals, create custom |
| `frontend/src/pages/SignalPacksPage.tsx` | Browse + create packs |
| `frontend/src/pages/PackDetailPage.tsx` | Pack contents + deployments + version |
| `frontend/src/components/signals/SignalCard.tsx` | Signal display with platform mappings |
| `frontend/src/components/signals/SignalEditor.tsx` | Create/edit custom signal form |
| `frontend/src/components/signals/PackCard.tsx` | Pack display card |
| `frontend/src/components/signals/PackEditor.tsx` | Create/edit pack wizard |
| `frontend/src/components/signals/SignalToPlatformPreview.tsx` | How signal maps to each platform |

---

## Sprint 3 — Deployments & Output Generation

### DB Migrations
- `deployments` — pack-to-client assignments with signal overrides
- `client_outputs` — generated outputs per client

### Backend

| File | What it does |
|------|-------------|
| `backend/src/services/signals/composableOutputGenerator.ts` | Orchestrates output gen from signal packs |
| `backend/src/services/signals/walkerosComposableGenerator.ts` | WalkerOS modular flow.json output |
| Deploy/generate endpoints added to `clients.ts` route | Deploy pack, generate outputs, bulk regenerate |

### Frontend

| File | What it does |
|------|-------------|
| `frontend/src/components/signals/DeploymentWizard.tsx` | Assign pack to client, map signals to pages |
| `frontend/src/components/signals/PackDeploymentView.tsx` | Which clients use this pack |
| `frontend/src/components/signals/WalkerOSAdvantageCard.tsx` | GTM vs WalkerOS comparison card |
| Output download UI added to `ClientDetailPage.tsx` | Download GTM/WalkerOS/dataLayer outputs |

---

## Sprint 4 — Integration & Polish

### Backend
- `POST /api/organisations/:orgId/clients/:clientId/audit` — run audit from deployed signal packs
- Planning Mode: compare AI recs against deployed pack signals

### Frontend
- Planning Mode client selector (when in org context) — `Step1PlanningSetup.tsx`
- Planning Mode pack comparison in `Step4ReviewRecommendations.tsx`
- Member management page in `OrgSettingsPage.tsx`
- Pack version tracking + "X clients outdated" on `PackDetailPage.tsx`
- Bulk regenerate UI on `PackDetailPage.tsx`
- WalkerOS migration prompts on all output screens

---

## New Routes Summary

### Frontend Routes

| Route | Page |
|-------|------|
| `/org/:orgId` | `OrgDashboardPage` |
| `/org/:orgId/clients` | `ClientListPage` |
| `/org/:orgId/clients/:clientId` | `ClientDetailPage` |
| `/org/:orgId/clients/:clientId/deploy` | `DeployPackPage` (via `DeploymentWizard`) |
| `/org/:orgId/signals` | `SignalLibraryPage` |
| `/org/:orgId/packs` | `SignalPacksPage` |
| `/org/:orgId/packs/:packId` | `PackDetailPage` |
| `/org/:orgId/settings` | `OrgSettingsPage` |

### Backend Routes

```
/api/organisations         CRUD
/api/organisations/:orgId/members   CRUD
/api/organisations/:orgId/clients   CRUD
/api/organisations/:orgId/clients/:clientId/platforms  PUT
/api/organisations/:orgId/clients/:clientId/pages      CRUD
/api/organisations/:orgId/clients/:clientId/deploy     POST/DELETE/GET
/api/organisations/:orgId/clients/:clientId/generate   POST
/api/organisations/:orgId/clients/:clientId/generate-all POST
/api/organisations/:orgId/clients/:clientId/outputs    GET + download
/api/organisations/:orgId/clients/:clientId/audit      POST
/api/signals               CRUD
/api/signal-packs          CRUD
/api/signal-packs/:id/signals  POST/DELETE
```
