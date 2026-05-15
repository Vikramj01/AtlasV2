# Platform Reconciliation — Phase 1 Sprint Plan: Connection Plumbing

Source PRD: `docs/PLATFORM_RECONCILIATION_PRD.md` (sections 15, 7, 8, 9)
Implementation branch: `claude/platform-reconciliation-sprint-plan-s5Qmu`

---

## Phase 1 Goal

Stand up the full connection management layer for Google Ads, Meta, and GA4. After Phase 1, users can OAuth-connect their Manager Accounts / Business Managers, discover child accounts, explicitly connect specific accounts to Atlas clients, and manage the full connection lifecycle (disconnect, re-discover, remove). No sync or reconciliation logic runs yet — this phase is purely: *can we discover, connect, and stay connected?*

---

## Architecture Summary

```
OAuth flow → token encryption → account discovery → user picks accounts → child rows created
              (AES-256-GCM)       (Manager/BM API)    (AccountPickerModal)   (status=active)

platform_connections table:
  manager row  (org-level, tokens here, client_id=NULL)
    └── child rows  (per-client, status=available|active|revoked, no tokens)
  standalone row  (per-client, tokens here, no parent)
```

All token storage uses the existing `@noble/ciphers` AES-256-GCM pattern from `capi_providers.credentials`. Sync workers and reconciliation engine come in Phase 2+.

---

## Sprint Overview

| Sprint | Focus | Key Deliverables |
|---|---|---|
| **1.A** | Schema + Backend Core | DB migration, OAuth service files, token manager, encryption |
| **1.B** | Discovery Services + Connection Lifecycle | Google Ads / Meta / GA4 discovery, lifecycle transitions, connection tester |
| **1.C** | API Routes | `/api/connections` route file with all Phase 1 endpoints |
| **1.D** | Frontend — Pages + Stores | ConnectionsPage, ClientConnectionsPage, connectionStore, connectionApi |
| **1.E** | Frontend — Components | All connection components including AccountPickerModal |
| **1.F** | Settings + Sidebar Integration | Settings tab, sidebar entries, ReauthBanner |

---

## Sprint 1.A — Schema + Backend Core

### DB Migration

File: `supabase/migrations/20260606_001_platform_connections.sql`

Creates the `platform_connections` table per PRD section 6.1:
- All six columns including `parent_connection_id` self-referential FK
- Three-type `CHECK` constraint: `manager`, `child`, `standalone`
- `UNIQUE (organization_id, platform, account_id)`
- `oauth_tokens JSONB` (encrypted, `NULL` on child rows)
- `status` check: `active | expired | revoked | error | available`
- All indexes from section 6.7 that apply to this table:
  - `idx_platform_connections_client`
  - `idx_platform_connections_parent`
  - `idx_platform_connections_manager`
- RLS per section 6.8 (standard `organization_id = auth.uid()` policy)

```sql
-- Key constraint to include:
CONSTRAINT child_requires_parent CHECK (
  (connection_type = 'child'      AND parent_connection_id IS NOT NULL AND client_id IS NOT NULL) OR
  (connection_type = 'manager'    AND parent_connection_id IS NULL     AND client_id IS NULL) OR
  (connection_type = 'standalone' AND parent_connection_id IS NULL     AND client_id IS NOT NULL)
)
```

Migration guard: wrap the `ALTER TABLE` additions in the standard `DO $$ IF EXISTS` guard per CLAUDE.md rule 9.

### TypeScript Types

File: `backend/src/types/connections.ts`

```typescript
export type Platform = 'google_ads' | 'meta' | 'ga4' | 'gtm_destinations';
export type ConnectionType = 'manager' | 'child' | 'standalone';
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error' | 'available';

export interface PlatformConnection {
  id: string;
  organization_id: string;
  client_id: string | null;
  platform: Platform;
  connection_type: ConnectionType;
  parent_connection_id: string | null;
  account_id: string;
  account_label: string | null;
  oauth_tokens: string | null;      // encrypted JSONB, never returned to client
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// Safe version returned to frontend (no tokens)
export interface PlatformConnectionPublic extends Omit<PlatformConnection, 'oauth_tokens'> {}

// Grouped shape for the connections list endpoint
export interface ConnectionGroup {
  manager: PlatformConnectionPublic | null;
  children: PlatformConnectionPublic[];
}

export interface ConnectionsResponse {
  google_ads: ConnectionGroup[];
  meta: ConnectionGroup[];
  ga4: PlatformConnectionPublic[];   // GA4 standalones only
  gtm_destinations: ConnectionGroup[];
}

// Discovered account from OAuth enumeration
export interface DiscoveredAccount {
  account_id: string;
  account_label: string;
  manager_account_id?: string;   // Google Ads only
  is_manager?: boolean;           // Google Ads only
  status: 'available' | 'active' | 'revoked';
  existing_connection_id?: string; // set if already in DB
}
```

Frontend mirror: `frontend/src/types/connections.ts` (identical public types).

### Token Manager

File: `backend/src/services/connections/tokenManager.ts`

Responsibilities:
- `encryptTokens(tokens: OAuthTokens): string` — AES-256-GCM via `@noble/ciphers`, key from `PLATFORM_CONNECTIONS_ENCRYPTION_KEY`
- `decryptTokens(encrypted: string): OAuthTokens` — inverse
- `resolveTokens(connectionId: string): Promise<OAuthTokens>` — for a `child` row, fetches the parent row's tokens; for `manager`/`standalone`, fetches own tokens. Throws if no tokens found.
- `refreshGoogleToken(tokens: OAuthTokens): Promise<OAuthTokens>` — exchanges refresh token for new access token, persists new expiry
- `refreshMetaToken(tokens: OAuthTokens): Promise<OAuthTokens>` — proactive refresh at day 50; marks expired at day 60
- `markExpired(connectionId: string): Promise<void>` — sets `status='expired'`, sets `last_error`

`OAuthTokens` interface:
```typescript
interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;    // unix ms
  token_type: string;
  scope?: string;
}
```

Security invariant: decrypted tokens are never assigned to a variable outside the function scope that uses them. Never logged. Never returned in API responses.

### OAuth Flow Files (scaffolded)

Three files created with structure but platform-specific logic filled in Sprint 1.B after discovery services are in place:

- `backend/src/services/connections/oauthFlows/googleAdsOAuth.ts`
- `backend/src/services/connections/oauthFlows/metaOAuth.ts`
- `backend/src/services/connections/oauthFlows/ga4OAuth.ts`

Each exports:
```typescript
export function getAuthUrl(state: string, clientId?: string): string
export async function handleCallback(code: string, state: string): Promise<OAuthTokens>
```

CSRF protection: `state` parameter is `HMAC-SHA256(secret, nonce + clientId + timestamp)`. Verified in callback before token exchange. Secret from `OAUTH_STATE_SECRET` env var.

Env vars required (added to `.env.example`):
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `META_APP_ID`
- `META_APP_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `PLATFORM_CONNECTIONS_ENCRYPTION_KEY`
- `OAUTH_STATE_SECRET`

### Database Query Module

File: `backend/src/services/database/connectionQueries.ts`

| Function | SQL / purpose |
|---|---|
| `listConnectionsForOrg(orgId)` | All connections for org, ordered by platform then type |
| `getConnectionById(id, orgId)` | Single row, scoped to org |
| `getParentConnection(childId)` | Fetches parent via `parent_connection_id` |
| `upsertConnection(data)` | INSERT … ON CONFLICT (organization_id, platform, account_id) DO UPDATE |
| `updateConnectionStatus(id, status, error?)` | Sets status + last_error + updated_at |
| `updateConnectionTokens(id, encryptedTokens)` | Sets oauth_tokens + updated_at |
| `updateLastSynced(id)` | Sets last_synced_at = NOW() |
| `deleteConnection(id, orgId)` | DELETE with org scope; cascades via FK |
| `getChildConnections(parentId)` | All children of a manager row |
| `getManagerConnectionsForOrg(orgId, platform)` | All manager rows for an org + platform |

---

## Sprint 1.B — Discovery Services + Connection Lifecycle

### Google Ads Discovery

File: `backend/src/services/connections/discovery/googleAdsDiscovery.ts`

```typescript
export async function discoverChildAccounts(
  managerAccountId: string,
  tokens: OAuthTokens
): Promise<DiscoveredAccount[]>
```

Implementation:
1. Initialise `google-ads-api` client with `GOOGLE_ADS_DEVELOPER_TOKEN` + access token
2. Set `login_customer_id` to `managerAccountId`
3. Execute GAQL from PRD section 9.1:
   ```sql
   SELECT customer_client.client_customer, customer_client.descriptive_name,
          customer_client.id, customer_client.manager, customer_client.status
   FROM customer_client WHERE customer_client.level <= 1
   ```
4. Map results to `DiscoveredAccount[]` — exclude the manager account itself
5. Cross-reference against existing DB rows to populate `status` and `existing_connection_id`

Note: `google-ads-api` npm package — verify current maintenance status at implementation. Fallback: `google-ads-node`.

### Meta Discovery

File: `backend/src/services/connections/discovery/metaDiscovery.ts`

```typescript
export async function discoverBusinessManagers(tokens: OAuthTokens): Promise<DiscoveredAccount[]>
export async function discoverAdAccounts(businessManagerId: string, tokens: OAuthTokens): Promise<DiscoveredAccount[]>
```

Flow:
1. `GET /me/businesses` — list Business Managers
2. For each BM: `GET /{bm_id}/owned_ad_accounts` + `GET /{bm_id}/client_ad_accounts`
3. Fallback: `GET /me/adaccounts` for accounts not under any BM → these become `standalone`
4. Cross-reference DB to set status/existing_connection_id

Uses `facebook-nodejs-business-sdk`. Wrap all calls in a thin abstraction layer (`metaApiClient.ts`) so the AEM endpoint can be swapped without touching the discovery module (per risk R4 in PRD section 20).

### GA4 Discovery

File: `backend/src/services/connections/discovery/ga4Discovery.ts`

```typescript
export async function discoverProperties(tokens: OAuthTokens): Promise<DiscoveredAccount[]>
```

Flow:
1. Initialise `@google-analytics/admin` `AnalyticsAdminServiceClient` with access token
2. Call `accountSummaries.list()` — returns accounts with nested property summaries
3. Flatten to one `DiscoveredAccount` per property (GA4 has no Manager Account equivalent; all properties → `standalone`)
4. Cross-reference DB

Note: GA4 OAuth uses the same Google OAuth client as Google Ads. Combined scopes on one consent screen: `https://www.googleapis.com/auth/adwords` + `https://www.googleapis.com/auth/analytics.readonly`.

### Connection Lifecycle

File: `backend/src/services/connections/connectionLifecycle.ts`

```typescript
export async function initiateOAuth(platform: Platform, clientId?: string, orgId: string): Promise<{ authUrl: string; state: string }>
export async function handleOAuthCallback(platform: Platform, code: string, state: string, orgId: string): Promise<{ managerId?: string; discovered: DiscoveredAccount[] }>
export async function connectAccount(connectionId: string, clientId: string, orgId: string): Promise<PlatformConnectionPublic>
export async function disconnectAccount(connectionId: string, orgId: string): Promise<void>
export async function rediscoverAccounts(managerConnectionId: string, orgId: string): Promise<DiscoveredAccount[]>
export async function removeConnection(connectionId: string, orgId: string, confirmed: boolean): Promise<void>
```

State transitions:
- `initiateOAuth` → generates HMAC state, returns platform auth URL
- `handleOAuthCallback` → exchanges code, encrypts tokens, upserts manager row (`status='active'`), runs discovery, upserts discovered child rows (`status='available'`)
- `connectAccount` → `available` → `active`; attaches `client_id`; validates client belongs to same org
- `disconnectAccount` → `active` → `available`; nulls `client_id` on child rows (history retained)
- `rediscoverAccounts` → re-runs discovery; new accounts → `available`; gone accounts → `revoked`
- `removeConnection` → hard delete; `confirmed` must be `true` (guard against accidental cascade)

### Connection Tester

File: `backend/src/services/connections/connectionTester.ts`

```typescript
export async function testConnection(connectionId: string, orgId: string): Promise<{ ok: boolean; latency_ms: number; error?: string }>
```

Per platform no-op read:
- **Google Ads:** GAQL `SELECT customer.id FROM customer LIMIT 1` on the account's own customer ID
- **Meta:** `GET /me?fields=id,name`
- **GA4:** `GET /v1beta/properties/{propertyId}/metadata` via Admin API

Resolves tokens via `tokenManager.resolveTokens` (handles parent-token pattern for child rows). Returns timing and success/failure. Never surfaces token values in error.

---

## Sprint 1.C — API Routes

File: `backend/src/api/routes/connections.ts`

Registered in `backend/src/app.ts` as `app.use('/api/connections', connectionsRouter)`.

All routes:
- Pass through `authMiddleware`
- Pass through `planGuard('pro')`
- Request bodies validated with Zod schemas
- Responses follow `{ data, error, message }` shape

### Route Table

| Method | Path | Handler summary |
|---|---|---|
| `GET` | `/api/connections` | List all connections for org; groups by platform into `ConnectionsResponse` shape |
| `GET` | `/api/connections/oauth/:platform/start` | Call `initiateOAuth(platform, clientId?, orgId)`; return `{ authUrl }` |
| `GET` | `/api/connections/oauth/:platform/callback` | Validate state HMAC; call `handleOAuthCallback`; return discovered accounts list |
| `POST` | `/api/connections/:id/discover` | Re-enumerate under manager; return updated `DiscoveredAccount[]` |
| `POST` | `/api/connections/:id/connect` | Body: `{ clientId }`; call `connectAccount`; return updated connection |
| `POST` | `/api/connections/:id/disconnect` | Call `disconnectAccount`; return updated connection |
| `DELETE` | `/api/connections/:id` | Body: `{ confirmed: true }`; call `removeConnection`; 400 if not confirmed |
| `POST` | `/api/connections/:id/test` | Call `testConnection`; return `{ ok, latency_ms, error? }` |
| `POST` | `/api/connections/:id/sync` | Phase 2 placeholder: returns `{ message: "Sync available in Phase 2" }` with 501 |

Zod schemas for request bodies:
```typescript
const ConnectBody = z.object({ clientId: z.string().uuid() });
const RemoveBody = z.object({ confirmed: z.literal(true) });
```

Rate limiting: `POST /api/connections/:id/discover` and `POST /api/connections/:id/test` go through existing `rateLimiter` middleware (5 req/min per user).

OAuth callback special handling: route mounted *before* `express.json()` body parser is applied (same pattern as Stripe webhook). Callback reads query params, not body. On completion, redirects frontend to `/connections?platform=:platform&status=success&manager=:managerId` (or `?status=error&message=...`).

---

## Sprint 1.D — Frontend: Pages + Stores

### API Client

File: `frontend/src/lib/api/connectionApi.ts`

```typescript
export const connectionApi = {
  list(): Promise<ConnectionsResponse>
  startOAuth(platform: Platform, clientId?: string): Promise<{ authUrl: string }>
  getDiscoveredAccounts(managerId: string): Promise<DiscoveredAccount[]>
  rediscover(connectionId: string): Promise<DiscoveredAccount[]>
  connect(connectionId: string, clientId: string): Promise<PlatformConnectionPublic>
  disconnect(connectionId: string): Promise<PlatformConnectionPublic>
  remove(connectionId: string): Promise<void>
  test(connectionId: string): Promise<{ ok: boolean; latency_ms: number; error?: string }>
}
```

### Zustand Store

File: `frontend/src/store/connectionStore.ts`

State shape:
```typescript
interface ConnectionState {
  connections: ConnectionsResponse | null;
  loading: boolean;
  error: string | null;
  oauthInProgress: Platform | null;
  discoveredAccounts: DiscoveredAccount[];
  showPickerForManager: string | null;    // connection id of manager needing picker
  testResults: Record<string, { ok: boolean; latency_ms: number; error?: string }>;
}
```

Actions:
- `fetchConnections()` — loads all connections; sets `loading`
- `startOAuth(platform, clientId?)` — sets `oauthInProgress`, opens auth URL in same tab
- `handleOAuthReturn(platform, managerId?)` — called on redirect back; re-fetches + sets `showPickerForManager`
- `connectAccount(connectionId, clientId)` — POST connect; optimistic update
- `disconnectAccount(connectionId)` — POST disconnect; optimistic update
- `rediscover(connectionId)` — re-enumerates; updates `discoveredAccounts`
- `removeConnection(connectionId)` — DELETE with confirmation; removes from state
- `testConnection(connectionId)` — POST test; stores result in `testResults`
- `clearPicker()` — clears `showPickerForManager` and `discoveredAccounts`

### Pages

**`frontend/src/pages/ConnectionsPage.tsx`** — route `/connections`
- Top-level connections overview across all clients
- Tabs or sections per platform: Google Ads | Meta | GA4
- Shows manager connections with child count, standalone connections
- "Add connection" CTA per platform that triggers `startOAuth`
- `ReauthBanner` shown at top if any connection has `status='expired'`
- Wrapped in `SectionErrorBoundary`
- Loading skeleton while `connectionStore.loading`

**`frontend/src/pages/ClientConnectionsPage.tsx`** — route `/connections/:clientId`
- Per-client view filtered to one client
- Shows which manager accounts have this client connected as a child
- Allows connecting new accounts to this specific client
- "Available" accounts shown with per-row "Connect" button
- Connected accounts shown with "Disconnect" and "Test" buttons
- Wrapped in `SectionErrorBoundary`

React Router additions in `frontend/src/App.tsx` (or router file):
```tsx
<Route path="/connections" element={<ProtectedRoute><ConnectionsPage /></ProtectedRoute>} />
<Route path="/connections/:clientId" element={<ProtectedRoute><ClientConnectionsPage /></ProtectedRoute>} />
```

---

## Sprint 1.E — Frontend: Components

All files under `frontend/src/components/connections/`.

### `ConnectionStatusBadge.tsx`
Props: `status: ConnectionStatus`
Renders a coloured chip:
- `active` → green
- `available` → grey (not yet connected)
- `expired` → amber with warning icon
- `revoked` → red strikethrough
- `error` → red

### `OAuthInitiateButton.tsx`
Props: `platform: Platform; clientId?: string; disabled?: boolean`
Renders platform-branded button (Google / Meta / GA4 colour/icon). On click: calls `connectionStore.startOAuth`. Shows spinner while `oauthInProgress === platform`.

### `AccountPickerModal.tsx`
Props: `managerId: string; onClose: () => void`
- Shown after OAuth callback returns discovered accounts (`showPickerForManager` is set)
- Lists all discovered accounts with checkbox per row
- Shows name, account ID, current status badge
- Already-active accounts pre-checked and disabled
- "Connect selected" CTA: calls `connectAccount` for each newly-checked row, passing the `clientId` from state or a client selector in the modal
- On completion: calls `clearPicker()`, shows success toast

### `ManagerConnectionCard.tsx`
Props: `connection: PlatformConnectionPublic; children: PlatformConnectionPublic[]`
- Card showing manager account name, platform icon, status badge
- "Re-discover accounts" button → `rediscover(connection.id)`
- "Remove manager" button → confirmation dialog → `removeConnection`
- Expandable child list below (renders `ChildAccountRow` per child)

### `ChildAccountRow.tsx`
Props: `connection: PlatformConnectionPublic; clientId: string`
- One table row: account label, account ID, status badge, last synced
- `status='available'` → "Connect" button → `connectAccount(id, clientId)`
- `status='active'` → "Disconnect" button + "Test" button
- "Test" shows `testResults[id]` inline (tick/cross + latency)
- `status='expired'` → "Re-authorise" button → `startOAuth(platform, clientId)`

### `StandaloneConnectionCard.tsx`
Props: `connection: PlatformConnectionPublic`
- Similar to ManagerConnectionCard without child tree
- "Test", "Disconnect", "Remove" actions

### `ConnectionCard.tsx`
Props: `connection: PlatformConnectionPublic`
Generic read-only card. Used in list/overview pages. Shows: platform icon, account label, status badge, last synced timestamp, error message if `status='error'`.

### `RediscoverButton.tsx`
Props: `connectionId: string`
Button that triggers `rediscover`. Shows spinner during call. Success toast with count of newly-discovered accounts.

### `ReauthBanner.tsx`
- Reads `connectionStore.connections` for any `status='expired'` rows
- If found: renders a sticky amber banner at top of page: "X connection(s) need re-authorisation"
- Per-expired-connection "Re-connect" link → `startOAuth` for that platform

---

## Sprint 1.F — Settings + Sidebar Integration

### Settings Tab Extension

File: `frontend/src/pages/SettingsPage.tsx` (extend existing)

Add a "Platform Connections" tab to the settings page tab list. Tab content: embed `<ConnectionsPage />` or a stripped-down version of it scoped to the current org. Alternatively, link through to `/connections`.

### Sidebar Entries

File: `frontend/src/components/layout/Sidebar.tsx` (extend existing)

Under **SET UP** group:
```
Connections    /connections    (Link icon or Plug icon)
```

Under **MONITOR** group (placeholder for Phase 2 when reconciliation page ships):
```
Reconciliation  /reconciliation  (disabled, tooltip: "Available in Phase 2")
```

### Route Registration

Ensure both `/connections` and `/connections/:clientId` are in the protected route tree. No public access.

---

## Phase 1 Acceptance Criteria (full checklist)

### OAuth + Discovery (Manager flow)
- [ ] A `pro`+ user can initiate Google Ads OAuth, complete consent, and land on `AccountPickerModal`
- [ ] Picker lists all child accounts under Manager Account with status badges
- [ ] Selecting accounts and confirming creates `child` rows (`status='active'`) with correct `parent_connection_id`
- [ ] Unselected accounts persist as `status='available'`
- [ ] Same end-to-end flow works for Meta (Business Manager) and GA4 (property enumeration)

### OAuth (Standalone flow)
- [ ] "Connect individual account" creates a `standalone` row directly without `available` interstitial
- [ ] Standalone connections appear without manager parent in connection list

### Lifecycle controls
- [ ] "Connect" button flips `available` → `active`
- [ ] "Disconnect" button flips `active` → `available`; sync state retained; no new syncs
- [ ] "Re-discover" re-enumerates; new accounts → `available`; removed → `revoked`
- [ ] "Remove manager" cascade-deletes all children with explicit confirmation dialog

### Token + Auth health
- [ ] Expired refresh token → `status='expired'` → `ReauthBanner` visible
- [ ] "Test connection" performs no-op read and returns success/failure + latency
- [ ] Decrypted tokens never appear in logs, error responses, or API payloads
- [ ] HMAC state parameter prevents CSRF on OAuth callback

### Phase 1 boundary
- [ ] "Sync now" button exists on connected accounts but is disabled with "Sync available in Phase 2" tooltip
- [ ] No `reconciliation_runs` or `reconciliation_findings` are created

### Plan gating
- [ ] `free` plan users see "Platform Connections" in sidebar but hit `PlanGate` on navigation
- [ ] `pro` and `agency` users have full access

---

## File Manifest

### New files

```
supabase/migrations/
  20260606_001_platform_connections.sql

backend/src/
  types/connections.ts
  services/connections/
    tokenManager.ts
    connectionLifecycle.ts
    connectionTester.ts
    oauthFlows/
      googleAdsOAuth.ts
      metaOAuth.ts
      ga4OAuth.ts
    discovery/
      googleAdsDiscovery.ts
      metaDiscovery.ts
      ga4Discovery.ts
  services/database/connectionQueries.ts
  api/routes/connections.ts

frontend/src/
  types/connections.ts
  lib/api/connectionApi.ts
  store/connectionStore.ts
  pages/ConnectionsPage.tsx
  pages/ClientConnectionsPage.tsx
  components/connections/
    ConnectionStatusBadge.tsx
    OAuthInitiateButton.tsx
    AccountPickerModal.tsx
    ManagerConnectionCard.tsx
    ChildAccountRow.tsx
    StandaloneConnectionCard.tsx
    ConnectionCard.tsx
    RediscoverButton.tsx
    ReauthBanner.tsx
```

### Modified files

```
frontend/src/App.tsx              # add /connections and /connections/:clientId routes
frontend/src/components/layout/Sidebar.tsx  # add Connections nav item
frontend/src/pages/SettingsPage.tsx         # add Platform Connections tab
backend/src/app.ts                          # register connections router
.env.example                                # add new env vars
```

---

## Dependencies & Gating Items

| Item | Owner | ETA | Blocker for |
|---|---|---|---|
| Google Ads developer token (Standard Access application) | Vikram | 1–4 weeks after apply | Phase 2+ production volume; Phase 1 dev uses Basic Access |
| Meta App Review (`ads_read`, `business_management`) | Vikram | 4–6 weeks typical | Phase 1 Meta OAuth in production; dev uses test ad accounts |
| GA4 OAuth client (same as Google Ads client) | Sprint 1.A | Day 1 | All GA4 and Google Ads flows |
| Redis + Bull running (already in place) | — | — | Phase 2 sync workers only |

---

## npm Packages to Add

```bash
# Backend
npm install google-ads-api @google-analytics/data @google-analytics/admin facebook-nodejs-business-sdk
npm install --save-dev @types/node   # if not already present
```

Verify `google-ads-api` maintenance status at implementation time. If unmaintained, use `google-ads-node` instead. Wrap platform SDK calls in internal adapter modules so the swap is contained.

---

## Notes for Implementation

1. **Token resolution for child rows**: child rows have no tokens of their own. `tokenManager.resolveTokens(childConnectionId)` must traverse to the parent and decrypt from there. This lookup must be done inside the service layer, never exposed via API.

2. **OAuth callback redirect**: the callback endpoint is a `GET` (OAuth standard). After processing, redirect the browser to a frontend URL (`/connections?...`). The frontend reads query params on mount in `ConnectionsPage` and calls `handleOAuthReturn`.

3. **Combined Google OAuth consent screen**: if the user authorises Google Ads and GA4 in one step, both scopes appear on one consent screen. The callback handler checks which scopes were granted and creates/updates connections accordingly.

4. **Standalone vs Manager picker**: the `OAuthInitiateButton` should offer two flows — "Connect via Manager Account" (default for agencies) and "Connect individual account" (standalone, for in-house teams). A simple modal with two options before redirecting to OAuth is sufficient.

5. **Plan limits per account**: open question from PRD section 22 — for Phase 1, enforce `planGuard('pro')` at the route level only. Per-account limits deferred to billing sprint.
