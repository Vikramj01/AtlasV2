# Atlas Sprint 2.0 — Deduplication Engine: Sprint Plan

**Branch:** `claude/dedup-engine-sprint-plan-48QVS`
**PRD:** `docs/ATLAS_DEDUP_ENGINE_PRD.md`
**Scope:** Meta CAPI + Google Enhanced Conversions deduplication
**Status:** Ready to implement

---

## What we're building

When Atlas dispatches a conversion server-side via CAPI, the browser Pixel has usually already fired the same event. Without deduplication, Meta and Google count two conversions. The fix: both the browser event and the server event carry the **same `event_id`** so the platform deduplicates them.

The browser-first flow:
1. GTM fires. `{{Atlas - Event ID}}` Custom JS Variable generates a UUID v4.
2. Meta Pixel tag fires with `{ eventID: '{{Atlas - Event ID}}' }` as the fourth `fbq()` arg.
3. **Atlas Signal Tag** (new Custom HTML tag) beacons `POST /api/capi/browser-event` with `event_id`, `event_name`, `fbclid`, `gclid`, `session_id`, `timestamp`.
4. Backend stores `event_id` in Redis (48h TTL for Meta, 90d for Google), keyed by `provider_id + fbclid/gclid + event_name`.
5. When the Bull job dispatches the server-side CAPI event, `metaDelivery.ts`/`googleDelivery.ts` look up the stored `event_id` from Redis and include it. Miss → generate a new UUID (event still fires; logged as dedup miss).

---

## Existing files to read before implementing each sprint

| File | Relevance |
|---|---|
| `frontend/src/lib/capi/dedup.ts` | Client-side in-memory guard (60s window). No UUID generation. **Remove in 2.0d** — replaced entirely by server-side Redis. |
| `backend/src/services/capi/pipeline.ts` | Core CAPI dispatch pipeline. **Read-only** — no changes needed; `dedupStore` is called from delivery services, not pipeline. |
| `backend/src/services/capi/metaDelivery.ts` | Meta CAPI delivery. Currently lacks `event_id` injection. **Modified in 2.0c.** |
| `backend/src/services/capi/googleDelivery.ts` | Google Enhanced Conversions delivery. Currently lacks `order_id` injection. **Modified in 2.0c.** |
| `backend/src/services/planning/generators/gtmContainerGenerator.ts` | GTM container generator. Must gain 3 new elements. **Modified in 2.0d.** |
| `backend/src/api/routes/capi.ts` | Existing CAPI routes. Receives new `browser-event` route and metrics update. **Modified in 2.0b and 2.0e.** |
| `frontend/src/components/capi/CAPIMonitoringDashboard.tsx` | Monitoring dashboard. Gains Dedup Rate tile. **Modified in 2.0e.** |
| `frontend/src/types/capi.ts` | CAPI types. Gains dedup fields on `CAPIEvent` and `CAPIProviderMetrics`. **Modified in 2.0a.** |

---

## Sprint breakdown

### Sprint 2.0a — Database foundation + types ⬜

**Goal:** All schema changes and TypeScript types land first. Every subsequent sprint depends on these.

**Files:**
- ⬜ `supabase/migrations/20260429_001_capi_dedup.sql` (new)
- ⬜ `frontend/src/types/capi.ts` (modified)

**Migration tasks:**
1. Add columns to `capi_events`:
   - `event_id TEXT`
   - `dedup_key TEXT`
   - `dedup_status TEXT CHECK (dedup_status IN ('hit', 'miss', 'not_applicable'))`
   - `dedup_matched_at TIMESTAMPTZ`
2. Create index `idx_capi_events_dedup_status ON capi_events (organization_id, provider_id, dedup_status, created_at)`.
3. Create `capi_browser_events` table:
   - `id UUID PK DEFAULT gen_random_uuid()`
   - `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`
   - `provider_id UUID REFERENCES capi_providers(id) ON DELETE SET NULL`
   - `event_id TEXT NOT NULL`
   - `event_name TEXT NOT NULL`
   - `fbclid TEXT`, `gclid TEXT`, `session_id TEXT`
   - `event_data JSONB`
   - `received_at TIMESTAMPTZ DEFAULT NOW()`
   - `expires_at TIMESTAMPTZ NOT NULL`
   - RLS enabled: `organization_id = auth.uid()`
4. Add `provider_token UUID DEFAULT gen_random_uuid()` to `capi_providers`. Create unique index `idx_capi_providers_token ON capi_providers (provider_token)`.

**Types tasks (`frontend/src/types/capi.ts`):**
- Add to `CAPIEvent`: `event_id?: string`, `dedup_status?: 'hit' | 'miss' | 'not_applicable'`, `dedup_matched_at?: string`
- Add to `CAPIProviderMetrics` (or create if not existing): `dedup_rate: number`, `dedup_hit_count: number`, `dedup_miss_count: number`

**Acceptance check:** `tsc --noEmit` passes with zero errors.

---

### Sprint 2.0b — Backend dedup infrastructure ⬜

**Goal:** Redis dedup store and browser-event beacon route are live.

**Dependencies:** 2.0a complete (migration applied; `provider_token` column exists).

**Files:**
- ⬜ `backend/src/services/capi/dedupStore.ts` (new)
- ⬜ `backend/src/api/routes/capi.ts` (modified — add `POST /browser-event`)

**`dedupStore.ts` tasks:**
1. Import `redis` from `../queue/jobQueue` (reuse existing Redis client — do not create a new connection).
2. Define constants: `META_TTL_S = 48 * 60 * 60`, `GOOGLE_TTL_S = 90 * 24 * 60 * 60`.
3. Define `DedupEntry` interface: `{ event_id: string; timestamp: number; event_data?: Record<string, unknown> }`.
4. Implement key builders:
   - `metaKey(providerId, fbclid, eventName)` → `capi:meta:dedup:{providerId}:{fbclid}:{eventName}`
   - `googleKey(providerId, identifier, eventName)` → `capi:google:dedup:{providerId}:{identifier}:{eventName}`
5. Implement exported functions:
   - `getMetaDedupEntry(providerId, fbclid | null, eventName): Promise<DedupEntry | null>` — returns `null` if `fbclid` is null.
   - `getGoogleDedupEntry(providerId, identifier | null, eventName): Promise<DedupEntry | null>` — returns `null` if `identifier` is null.
   - `setDedupEntry(provider: 'meta' | 'google', providerId, identifier, eventName, entry): Promise<void>` — writes with correct TTL.
6. No PII in keys — `fbclid`/`gclid` are click IDs, not PII. Never include `email`, `phone`, or name in keys.

**`POST /api/capi/browser-event` tasks:**
1. Zod schema (validate before touching Redis or Supabase):
   ```typescript
   z.object({
     event_id:   z.string().uuid(),
     event_name: z.string().min(1).max(100),
     fbclid:     z.string().nullable().optional(),
     gclid:      z.string().nullable().optional(),
     session_id: z.string().nullable().optional(),
     timestamp:  z.number().int().positive(),
     event_data: z.record(z.unknown()).optional(),
   })
   ```
2. Auth: read `X-Atlas-Provider-Token` header. Look up `capi_providers` by `provider_token`. Return 401 if not found. **No Supabase session required** — this is called from a GTM beacon, not an authenticated browser session.
3. Write to Redis via `setDedupEntry` for both Meta key (if `fbclid` present) and Google key (if `gclid` present).
4. Write to `capi_browser_events` Supabase table (`expires_at = NOW() + 48h`). Do not log `event_data` if it contains form field values.
5. **Return 204 No Content.** Never return 500 — log and swallow all errors so beacon failures are silent to the user.
6. Apply existing `rateLimiter` middleware. No `planGuard` — this endpoint is called from the client's website, not the Atlas dashboard.

**Acceptance check:**
- Integration test: POST beacon → GET Redis key → confirm value present within 200ms.
- 401 returned on invalid/missing token.
- 204 returned on success.

---

### Sprint 2.0c — Delivery pipeline updates ⬜

**Goal:** `metaDelivery.ts` and `googleDelivery.ts` resolve `event_id`/`order_id` from Redis and write dedup outcomes to `capi_events`.

**Dependencies:** 2.0b complete (`dedupStore.ts` exported and tested).

**Files:**
- ⬜ `backend/src/services/capi/metaDelivery.ts` (modified)
- ⬜ `backend/src/services/capi/googleDelivery.ts` (modified)

**`metaDelivery.ts` tasks:**
1. Import `getMetaDedupEntry` from `./dedupStore`.
2. Before building the CAPI payload, call `getMetaDedupEntry(provider.id, eventPayload.fbclid ?? null, eventPayload.event_name)`.
3. Resolve: `eventId = dedupEntry?.event_id ?? crypto.randomUUID()`, `dedupStatus: 'hit' | 'miss' = dedupEntry ? 'hit' : 'miss'`.
4. Include `event_id: eventId` in the Meta CAPI payload's data array item (alongside existing `event_name`, `event_time`, `action_source`, `user_data`, `custom_data`).
5. After successful dispatch, update the `capi_events` row:
   ```typescript
   await supabase.from('capi_events').update({
     event_id:         eventId,
     dedup_status:     dedupStatus,
     dedup_key:        dedupEntry
       ? `${provider.id}:${eventPayload.fbclid}:${eventPayload.event_name}`
       : null,
     dedup_matched_at: dedupEntry ? new Date().toISOString() : null,
   }).eq('id', capiEventRowId);
   ```
6. Log dedup outcome at `debug` level (not `info`) — avoid log noise in production. Never log `event_data`.

**`googleDelivery.ts` tasks:**
1. Import `getGoogleDedupEntry` from `./dedupStore`.
2. Prefer `transaction_id` (e-commerce). Fall back to `gclid` for lead-gen.
   ```typescript
   const transactionId = eventPayload.transaction_id ?? null;
   const identifier    = transactionId ?? eventPayload.gclid ?? null;
   ```
3. Call `getGoogleDedupEntry(provider.id, identifier, eventPayload.event_name)`.
4. Resolve: `orderId = transactionId ?? dedupEntry?.event_id ?? crypto.randomUUID()`, `dedupStatus: 'hit' | 'miss' = (transactionId || dedupEntry) ? 'hit' : 'miss'`.
5. Include `order_id: orderId` in the Enhanced Conversions upload payload (alongside existing `gclid`, `conversion_action`, `conversion_date_time`, `conversion_value`, `currency_code`, `user_identifiers`).
6. Update `capi_events` row with dedup outcome (same pattern as Meta).

**Acceptance check:**
- Integration test: store beacon → trigger Meta dispatch → inspect CAPI call payload for `event_id`.
- `dedup_status = 'hit'` written when match found.
- `dedup_status = 'miss'` written when no match; event still dispatches with a new UUID.
- TypeScript strict — no unused imports.

---

### Sprint 2.0d — GTM container additions + frontend cleanup ⬜

**Goal:** Every generated GTM container includes the three new dedup elements. The obsolete client-side `dedup.ts` is removed.

**Dependencies:** 2.0a (for `provider_token`). GTM changes are independent of 2.0b/2.0c.

**Files:**
- ⬜ `backend/src/services/planning/generators/gtmContainerGenerator.ts` (modified)
- ⬜ `frontend/src/lib/capi/dedup.ts` (deleted)
- ⬜ Any files importing `dedup.ts` — update imports

**GTM container tasks:**

1. **`{{Atlas - Event ID}}` — Custom JavaScript Variable:**
   - Variable name: `Atlas - Event ID`
   - Type: Custom JavaScript
   - Body:
     ```javascript
     function() {
       if (window.crypto && window.crypto.randomUUID) {
         return window.crypto.randomUUID();
       }
       return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
         var r = Math.random() * 16 | 0;
         return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
       });
     }
     ```
   - Note: GTM evaluates Custom JavaScript Variables fresh on every tag fire — one UUID per event, not per page load.

2. **`{{Atlas - Provider Token}}` — Constant Variable:**
   - Variable name: `Atlas - Provider Token`
   - Type: Constant
   - Value: `provider.provider_token` (resolved at GTM export time from `capi_providers.provider_token`)
   - This allows the Atlas Signal Tag to authenticate without a Supabase session.

3. **Atlas Signal Tag — Custom HTML tag:**
   - Fires on all the same triggers as any CAPI-relevant Pixel tag for this client.
   - Consent-first: checks `window.__atlasConsentGranted()` before beaconing; returns early if not granted.
   - Uses `navigator.sendBeacon()` — non-blocking; silently skipped if browser doesn't support it.
   - Payload: `{ event_id: '{{Atlas - Event ID}}', event_name: '{{Event Name}}', fbclid: '{{fbclid}}', gclid: '{{gclid}}', session_id: '{{Atlas - Session ID}}', timestamp: Date.now(), event_data: { value: '{{ecommerce.value}}', currency: '{{ecommerce.currency}}' } }`
   - Target URL: `https://api.atlas.vimi.digital/api/capi/browser-event`
   - Header: `X-Atlas-Provider-Token: {{Atlas - Provider Token}}`

4. **Update all Meta Pixel conversion tags** in the generator:
   - All `fbq('track', ...)` calls for conversion events must include the fourth argument: `{ eventID: '{{Atlas - Event ID}}' }`.
   - Non-conversion events (`PageView`, `ViewContent`) do not require this.
   - Before:
     ```javascript
     fbq('track', 'Purchase', { value: 99, currency: 'USD' });
     ```
   - After:
     ```javascript
     fbq('track', 'Purchase', { value: 99, currency: 'USD' }, { eventID: '{{Atlas - Event ID}}' });
     ```

**`frontend/src/lib/capi/dedup.ts` removal:**
- The existing file is a client-side in-memory guard (60s TTL, Map-based). It does **not** contain UI display helpers or UUID generation — only client-side dedup guard logic.
- The server-side Redis approach (2.0b) fully replaces this. Delete the file.
- Search for all imports of `dedup.ts` (`clientDedup`, `ClientDedup`) across the frontend and remove them. Confirm no call sites remain before deleting.

**Acceptance check:**
- Inspect exported GTM container JSON: confirm `Atlas - Event ID` variable, `Atlas - Provider Token` variable, and Atlas Signal Tag are present.
- Confirm all conversion-event `fbq()` calls have the fourth argument.
- `tsc --noEmit` passes — no dangling imports from deleted `dedup.ts`.

---

### Sprint 2.0e — Monitoring UI ⬜

**Goal:** CAPIMonitoringDashboard gains a Dedup Rate tile. Metrics endpoint returns dedup stats.

**Dependencies:** 2.0a (types), 2.0c (dedup_status written to `capi_events`).

**Files:**
- ⬜ `backend/src/api/routes/capi.ts` (modified — update `GET /:id/metrics`)
- ⬜ `frontend/src/components/capi/CAPIMonitoringDashboard.tsx` (modified)

**Backend metrics task:**
Update `GET /api/capi/:id/metrics` (or equivalent endpoint) to return:
```typescript
{
  dedup_rate:       number;  // 0–100
  dedup_hit_count:  number;
  dedup_miss_count: number;
}
```
Calculate from `capi_events` grouped by `dedup_status` for the given `provider_id`, last 7 days:
```sql
SELECT
  dedup_status,
  COUNT(*) AS count
FROM capi_events
WHERE provider_id = $1
  AND created_at >= NOW() - INTERVAL '7 days'
  AND dedup_status IS NOT NULL
GROUP BY dedup_status;
```
`dedup_rate = (hit_count / (hit_count + miss_count)) * 100` — return `0` if both counts are zero.

**Frontend tile tasks:**
1. Add a fourth monitoring tile to `CAPIMonitoringDashboard.tsx` alongside the existing Delivery Rate, EMQ Score, and Event Volume tiles.
2. Tile spec:
   - Title: `Deduplication Rate`
   - Metric: `XX%` (from `dedup_rate`)
   - Status colour: Green ≥ 60% · Amber 30–59% · Red < 30%
   - Tooltip: `"% of server-side events matched to a browser Pixel event. 60–90% is healthy. Below 60% may indicate the Atlas Signal Tag is not firing correctly."`
3. Loading state: show skeleton while metrics endpoint loads (consistent with existing tile loading pattern).
4. Functional component only.

**Acceptance check:**
- Seed test data with known hit/miss ratio → confirm displayed percentage and colour coding correct.
- Skeleton shown during load.
- `tsc && vite build` passes with zero errors.

---

## Cross-sprint rules (apply to every sprint)

1. **No PII in Redis keys, logs, or queue payloads.** `event_id` is a UUID. `fbclid`/`gclid` are click IDs, not PII. Never include email, phone, or name.
2. **Provider adapter pattern** — `dedupStore.ts` is called from `metaDelivery.ts` and `googleDelivery.ts`. Never put provider-specific dedup logic in `pipeline.ts`.
3. **Consent-first** — Atlas Signal Tag checks consent state before `sendBeacon`.
4. **Zod validation** — `browser-event` body validated with Zod before Redis/Supabase.
5. **TypeScript strict** — `tsc && vite build` must pass at the end of every sprint. Zero unused imports.
6. **API responses** → `{ data, error, message }` shape.
7. **New tables** → RLS required. `organization_id = auth.uid()`.
8. **shadcn/ui** — new tile uses existing component primitives.

---

## Out of scope (per PRD)

- TikTok Events API deduplication (stub provider only)
- LinkedIn Conversions API deduplication (stub provider only)
- Offline conversion dedup (separate `order_id` flow in CSV upload pipeline)
- Retroactive dedup scoring for historical `capi_events` rows
- UI for per-event dedup status in the event log

---

## Acceptance criteria summary

| # | Criterion |
|---|---|
| 1 | Every generated GTM container includes `{{Atlas - Event ID}}` Custom JS Variable and Atlas Signal Tag. |
| 2 | Meta Pixel conversion tags include `{ eventID: '{{Atlas - Event ID}}' }` as the fourth `fbq()` arg. |
| 3 | `POST /api/capi/browser-event` stores `event_id` in Redis within 200ms of receipt. |
| 4 | `metaDelivery.ts` CAPI payloads include `event_id` matching the stored browser event. |
| 5 | `dedup_status = 'hit'` written to `capi_events` when a matching `event_id` is found. |
| 6 | `dedup_status = 'miss'` written when no match found; event still fires with a new UUID. |
| 7 | Google Enhanced Conversions payloads include `order_id` from `transaction_id` or `atlas_conversion_id`. |
| 8 | CAPIMonitoringDashboard shows Deduplication Rate tile with correct colour coding. |
| 9 | TypeScript build passes: `tsc && vite build`. Zero errors. |
| 10 | No PII in Redis keys, queue payloads, or logs. |
