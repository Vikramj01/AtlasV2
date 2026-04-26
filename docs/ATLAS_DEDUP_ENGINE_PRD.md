# Atlas Sprint 2.0 — Deduplication Engine PRD

**Scope:** Meta CAPI + Google Enhanced Conversions  
**Target:** AtlasV2 repository  
**Status:** Ready for implementation

---

## Context and current state

The Atlas codebase already contains the following relevant files. Read each before starting:

- `frontend/src/lib/capi/dedup.ts` — a deduplication utility on the **frontend**. This is the wrong location. Assess its contents and migrate any useful logic to the backend. See Section 6.7.
- `backend/src/services/capi/pipeline.ts` — the core CAPI dispatch pipeline.
- `backend/src/services/capi/metaDelivery.ts` — Meta CAPI delivery. Currently lacks `event_id` injection.
- `backend/src/services/capi/googleDelivery.ts` — Google Enhanced Conversions delivery. Currently lacks `order_id` injection.
- `backend/src/services/planning/generators/gtmContainer` — GTM container generator. Must be updated to include the Atlas Event ID variable and Atlas Signal Tag.
- `capi_events` and `capi_event_queue` tables in Supabase — exist but lack `event_id` and dedup columns.

### How deduplication works (read this first)

When Atlas dispatches a conversion event server-side via CAPI, the browser Pixel has usually already fired the same event. Without deduplication, Meta and Google count two conversions. The fix: both the browser event and the server event must carry the **same unique `event_id`** so the platform deduplicates them.

**Meta CAPI** deduplicates on `event_name` + `event_id` within a 48-hour window.  
**Google Enhanced Conversions** deduplicates on `order_id` / `transaction_id` within a 90-day window.

**The browser-first flow Atlas will use:**

1. User triggers a conversion event.
2. GTM fires. A Custom JavaScript Variable (`{{Atlas - Event ID}}`) generates a UUID v4.
3. Two tags fire on the same trigger:
   - **Meta Pixel tag** — calls `fbq('track', 'Purchase', {...}, { eventID: '{{Atlas - Event ID}}' })`. The fourth argument is mandatory for dedup; most implementations omit it.
   - **Atlas Signal Tag** (Custom HTML) — beacons `POST /api/capi/browser-event` with `{ event_id, event_name, fbclid, gclid, session_id, timestamp, event_data }`.
4. Atlas backend receives the beacon, stores the `event_id` in Redis with a 48h TTL, keyed by `provider_id + fbclid + event_name`.
5. When the CAPI Bull job dispatches the server-side event, `metaDelivery.ts` looks up the stored `event_id` from Redis and includes it in the CAPI payload. If no match is found, it generates a new UUID (event still fires; logged as a dedup miss).

For **Google**, the dedup key is `transaction_id` (from the order for e-commerce) or `atlas_conversion_id` (a UUID from the same GTM variable, for lead-gen). This is passed as `order_id` in the Enhanced Conversions upload.

---

## What to build — overview

| Component | Type | File(s) |
|---|---|---|
| Database migration | New migration | `supabase/migrations/20260XXX_001_capi_dedup.sql` |
| `POST /api/capi/browser-event` | New Express route | `backend/src/api/routes/capi.ts` |
| `dedupStore.ts` | New service | `backend/src/services/capi/dedupStore.ts` |
| `metaDelivery.ts` | Modified service | `backend/src/services/capi/metaDelivery.ts` |
| `googleDelivery.ts` | Modified service | `backend/src/services/capi/googleDelivery.ts` |
| GTM container generator | Modified service | `backend/src/services/planning/generators/gtmContainer` |
| `frontend/src/lib/capi/dedup.ts` | Assess → refactor or remove | `frontend/src/lib/capi/dedup.ts` |
| Dedup Rate tile | UI update | `frontend/src/components/capi/CAPIMonitoringDashboard.tsx` |
| Types update | Modified types | `frontend/src/types/capi.ts` |

---

## Implementation order

Follow this sequence to avoid dependency issues:

1. Database migration
2. `dedupStore.ts` — Redis abstraction
3. `POST /api/capi/browser-event` — beacon route
4. `metaDelivery.ts` — event_id injection
5. `googleDelivery.ts` — order_id injection
6. GTM container generator — three new elements
7. `frontend/src/lib/capi/dedup.ts` — assess and refactor/remove
8. CAPIMonitoringDashboard tile + metrics endpoint + types

---

## Detailed implementation spec

### 6.1 Database migration

**File:** `supabase/migrations/20260XXX_001_capi_dedup.sql`

```sql
-- Add deduplication fields to capi_events
ALTER TABLE capi_events
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS dedup_status TEXT CHECK (dedup_status IN ('hit', 'miss', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS dedup_matched_at TIMESTAMPTZ;

-- Index for dedup rate queries
CREATE INDEX IF NOT EXISTS idx_capi_events_dedup_status
  ON capi_events (organization_id, provider_id, dedup_status, created_at);

-- Browser event store (receives Atlas Signal Tag beacons from GTM)
CREATE TABLE IF NOT EXISTS capi_browser_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id      UUID REFERENCES capi_providers(id) ON DELETE SET NULL,
  event_id         TEXT NOT NULL,
  event_name       TEXT NOT NULL,
  fbclid           TEXT,
  gclid            TEXT,
  session_id       TEXT,
  event_data       JSONB,
  received_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL
);

ALTER TABLE capi_browser_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON capi_browser_events
  USING (organization_id = auth.uid());

CREATE INDEX idx_capi_browser_events_lookup
  ON capi_browser_events (organization_id, event_name, fbclid, received_at DESC);
```

Also add a `provider_token` column to `capi_providers` — a UUID generated on first activation, used to authenticate the Atlas Signal Tag beacon without requiring a Supabase session:

```sql
ALTER TABLE capi_providers
  ADD COLUMN IF NOT EXISTS provider_token UUID DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_capi_providers_token
  ON capi_providers (provider_token);
```

---

### 6.2 New route — POST /api/capi/browser-event

**File:** `backend/src/api/routes/capi.ts` — add to existing file.

This endpoint receives the Atlas Signal Tag beacon. It is authenticated via `provider_token` (included in the GTM container at generation time, passed as a header `X-Atlas-Provider-Token`). No Supabase session required — this is called from a browser beacon.

**Zod schema:**

```typescript
const BrowserEventSchema = z.object({
  event_id:   z.string().uuid(),
  event_name: z.string().min(1).max(100),
  fbclid:     z.string().nullable().optional(),
  gclid:      z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  timestamp:  z.number().int().positive(),
  event_data: z.record(z.unknown()).optional(),
});
```

**Handler logic:**

1. Read `X-Atlas-Provider-Token` header. Look up `capi_providers` by `provider_token`. If not found → 401.
2. Validate body with Zod. If invalid → 400 with `{ error, message }`.
3. Write to Redis via `dedupStore.ts` (see 6.3). Set TTL = 48h for Meta keys, 90 days for Google keys.
4. Write to `capi_browser_events` table (for audit trail). Set `expires_at = NOW() + INTERVAL '48 hours'`.
5. Return 204 No Content. Never return 500 — beacon failures must be silent to the end user; log and swallow.

**Apply `rateLimiter` middleware.** No `planGuard` needed — this is called from the client's own website.

---

### 6.3 New service — dedupStore.ts

**File:** `backend/src/services/capi/dedupStore.ts` (new file)

Wraps Redis with typed get/set operations. All delivery services call this; never call Redis directly from delivery services.

```typescript
import { redis } from '../queue/jobQueue'; // reuse existing Redis client

const META_TTL_S   = 48 * 60 * 60;        // 48 hours
const GOOGLE_TTL_S = 90 * 24 * 60 * 60;   // 90 days

export interface DedupEntry {
  event_id:    string;
  timestamp:   number;
  event_data?: Record<string, unknown>;
}

function metaKey(providerId: string, fbclid: string, eventName: string): string {
  return `capi:meta:dedup:${providerId}:${fbclid}:${eventName}`;
}

function googleKey(providerId: string, identifier: string, eventName: string): string {
  return `capi:google:dedup:${providerId}:${identifier}:${eventName}`;
}

export async function getMetaDedupEntry(
  providerId: string,
  fbclid: string | null,
  eventName: string
): Promise<DedupEntry | null> {
  if (!fbclid) return null;
  const raw = await redis.get(metaKey(providerId, fbclid, eventName));
  return raw ? (JSON.parse(raw) as DedupEntry) : null;
}

export async function getGoogleDedupEntry(
  providerId: string,
  identifier: string | null, // gclid or transaction_id
  eventName: string
): Promise<DedupEntry | null> {
  if (!identifier) return null;
  const raw = await redis.get(googleKey(providerId, identifier, eventName));
  return raw ? (JSON.parse(raw) as DedupEntry) : null;
}

export async function setDedupEntry(
  provider: 'meta' | 'google',
  providerId: string,
  identifier: string,
  eventName: string,
  entry: DedupEntry
): Promise<void> {
  const key = provider === 'meta'
    ? metaKey(providerId, identifier, eventName)
    : googleKey(providerId, identifier, eventName);
  const ttl = provider === 'meta' ? META_TTL_S : GOOGLE_TTL_S;
  await redis.set(key, JSON.stringify(entry), 'EX', ttl);
}
```

---

### 6.4 metaDelivery.ts — changes

**File:** `backend/src/services/capi/metaDelivery.ts`

Add `event_id` resolution before building the CAPI payload. Log the dedup outcome to `capi_events`.

```typescript
import { getMetaDedupEntry } from './dedupStore';

// Inside the dispatch function, before building the CAPI payload:
const dedupEntry = await getMetaDedupEntry(
  provider.id,
  eventPayload.fbclid ?? null,
  eventPayload.event_name
);

const eventId    = dedupEntry?.event_id ?? crypto.randomUUID();
const dedupStatus: 'hit' | 'miss' = dedupEntry ? 'hit' : 'miss';

// Include in Meta CAPI payload:
const capiPayload = {
  data: [{
    event_name:    eventPayload.event_name,
    event_id:      eventId,               // <-- dedup key
    event_time:    Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data:     { /* hashed identifiers — existing */ },
    custom_data:   { /* value, currency, etc — existing */ },
  }],
};

// After dispatch, update capi_events row:
await supabase.from('capi_events').update({
  event_id:         eventId,
  dedup_status:     dedupStatus,
  dedup_key:        dedupEntry
    ? `${provider.id}:${eventPayload.fbclid}:${eventPayload.event_name}`
    : null,
  dedup_matched_at: dedupEntry ? new Date().toISOString() : null,
}).eq('id', capiEventRowId);
```

---

### 6.5 googleDelivery.ts — changes

**File:** `backend/src/services/capi/googleDelivery.ts`

Resolve `order_id` from the dedup store. Fall back to a generated UUID if not found.

```typescript
import { getGoogleDedupEntry } from './dedupStore';

// Prefer transaction_id (e-commerce), fall back to stored gclid entry (lead-gen)
const transactionId = eventPayload.transaction_id ?? null;
const identifier    = transactionId ?? eventPayload.gclid ?? null;

const dedupEntry = await getGoogleDedupEntry(
  provider.id,
  identifier,
  eventPayload.event_name
);

const orderId     = transactionId ?? dedupEntry?.event_id ?? crypto.randomUUID();
const dedupStatus: 'hit' | 'miss' = (transactionId || dedupEntry) ? 'hit' : 'miss';

// Include in Enhanced Conversions upload payload:
const conversion = {
  gclid:                 eventPayload.gclid,
  conversion_action:     provider.credentials.conversionAction,
  conversion_date_time:  new Date().toISOString(),
  conversion_value:      eventPayload.value,
  currency_code:         eventPayload.currency,
  order_id:              orderId,           // <-- dedup key
  user_identifiers:      [ /* hashed email/phone — existing */ ],
};

// Update capi_events row with dedup outcome (same pattern as metaDelivery).
```

---

### 6.6 GTM container generator — three additions

**File:** `backend/src/services/planning/generators/gtmContainer`

Every generated GTM container must include the following three elements:

#### 1. Custom JavaScript Variable — `{{Atlas - Event ID}}`

```javascript
// Variable type: Custom JavaScript
// Variable name: Atlas - Event ID
function() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  // Polyfill for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
```

> GTM evaluates Custom JavaScript Variables fresh on every tag fire — this generates a new UUID per event, not per page load.

#### 2. GTM Constant Variable — `{{Atlas - Provider Token}}`

```
Variable type: Constant
Value: <provider.provider_token> (resolved at GTM export time from capi_providers.provider_token)
```

#### 3. Atlas Signal Tag — Custom HTML tag

Fires on **all the same triggers** as any CAPI-relevant Pixel tag for this client.

```html
<script>
(function() {
  // Respect consent — do not beacon if ad consent not granted
  var consent = window.dataLayer && window.dataLayer.find(function(e) {
    return e.event === 'consent_update' || e['gtm.start'];
  });
  // Use your existing consent check pattern from the generated consent tag
  if (typeof window.__atlasConsentGranted === 'function' && !window.__atlasConsentGranted()) {
    return;
  }

  var payload = {
    event_id:   '{{Atlas - Event ID}}',
    event_name: '{{Event Name}}',
    fbclid:     '{{fbclid}}',
    gclid:      '{{gclid}}',
    session_id: '{{Atlas - Session ID}}',
    timestamp:  Date.now(),
    event_data: {
      value:    '{{ecommerce.value}}',
      currency: '{{ecommerce.currency}}',
    },
  };

  navigator.sendBeacon(
    'https://api.atlas.vimi.digital/api/capi/browser-event',
    JSON.stringify(payload)
  );
})();
</script>
```

> Use `navigator.sendBeacon()` — it does not block page navigation. No fallback needed; if the browser doesn't support it, the beacon is silently skipped (the server-side CAPI still fires, just without a dedup hit).

#### 4. Update all Meta Pixel conversion tags

All generated `fbq()` calls for conversion events must include the fourth argument:

```javascript
// BEFORE (no dedup):
fbq('track', 'Purchase', { value: 99, currency: 'USD' });

// AFTER (dedup enabled):
fbq('track', 'Purchase', { value: 99, currency: 'USD' }, { eventID: '{{Atlas - Event ID}}' });
```

Non-conversion events (`PageView`, `ViewContent`) do not require this.

---

### 6.7 frontend/src/lib/capi/dedup.ts — assess and refactor

**Read the file first.** Then:

- If it contains **client-side event_id generation logic** → remove. This is now handled by the GTM Custom JS Variable.
- If it contains **UI helper functions** (e.g. formatting dedup rates for display) → retain, rename to `dedupDisplay.ts`, update all imports.
- If it contains anything else → document what it is before removing.

After this change, `dedup.ts` should either not exist or contain only display/formatting utilities with no generation or storage logic.

---

### 6.8 CAPIMonitoringDashboard — Dedup Rate tile

**File:** `frontend/src/components/capi/CAPIMonitoringDashboard.tsx`

Add a fourth monitoring tile alongside the existing Delivery Rate, EMQ Score, and Event Volume tiles.

| Field | Detail |
|---|---|
| Tile title | Deduplication Rate |
| Metric | `(dedup_status = 'hit') ÷ total capi_events for this provider (last 7d) × 100`. Displayed as `XX%`. |
| Status colour | Green ≥ 60% · Amber 30–59% · Red < 30% |
| Tooltip | "% of server-side events matched to a browser Pixel event. 60–90% is healthy. Below 60% may indicate the Atlas Signal Tag is not firing correctly." |

**Backend — update `GET /api/capi/:id/metrics`** to return:

```typescript
{
  dedup_rate:       number;  // 0–100
  dedup_hit_count:  number;
  dedup_miss_count: number;
}
```

Calculate from `capi_events` grouped by `dedup_status` for the given `provider_id`, last 7 days.

---

### 6.9 Types — frontend/src/types/capi.ts

```typescript
// Add to CAPIProviderMetrics:
dedup_rate:        number;   // 0–100
dedup_hit_count:   number;
dedup_miss_count:  number;

// Add to CAPIEvent:
event_id?:         string;
dedup_status?:     'hit' | 'miss' | 'not_applicable';
dedup_matched_at?: string;   // ISO datetime
```

---

## Acceptance criteria

| # | Criterion | How to verify |
|---|---|---|
| 1 | Every generated GTM container includes `{{Atlas - Event ID}}` Custom JS Variable and Atlas Signal Tag. | Inspect exported GTM container JSON. |
| 2 | Meta Pixel conversion tags include `{ eventID: '{{Atlas - Event ID}}' }` as the fourth `fbq()` argument. | Inspect tag configuration in generated GTM container JSON. |
| 3 | `POST /api/capi/browser-event` stores `event_id` in Redis within 200ms of receipt. | Integration test: POST beacon → GET Redis key → confirm value present. |
| 4 | `metaDelivery.ts` CAPI payloads include `event_id` matching the stored browser event. | Integration test: store beacon → trigger dispatch → inspect CAPI call payload. |
| 5 | `dedup_status = 'hit'` written to `capi_events` when a matching `event_id` is found. | Query `capi_events` after a matched dispatch. |
| 6 | `dedup_status = 'miss'` written when no match found. Event still fires with a new UUID. | Trigger CAPI dispatch without a prior beacon → confirm miss + event dispatched. |
| 7 | Google Enhanced Conversions payloads include `order_id` from `transaction_id` or `atlas_conversion_id`. | Inspect `googleDelivery.ts` payload in test mode. |
| 8 | CAPIMonitoringDashboard shows Deduplication Rate tile with correct colour coding. | Seed test data with known hit/miss ratio → confirm displayed percentage. |
| 9 | TypeScript build passes: `tsc && vite build`. | Run build command. Zero errors. |
| 10 | No PII in Redis keys, queue payloads, or logs. `event_id` is a UUID — confirm no email/phone/name in the dedup pipeline. | Code review + log inspection. |

---

## Out of scope

- TikTok Events API deduplication — stub provider only, skip.
- LinkedIn Conversions API deduplication — stub provider only, skip.
- Offline conversion dedup — handled separately via `order_id` in the existing CSV upload pipeline.
- Retroactive dedup scoring for historical `capi_events` rows.
- UI for per-event dedup status in the event log.

---

## Atlas implementation rules

All standard rules apply. Key ones for this sprint:

- **New tables** → `supabase/migrations/` as numbered `.sql` files. RLS required on `capi_browser_events`.
- **No PII in logs or queue payloads.** `event_id` is a UUID — safe. `fbclid`/`gclid` are click IDs, not PII. Do not log `event_data` if it contains form field values.
- **Provider adapter pattern** — `dedupStore.ts` is called from `metaDelivery.ts` and `googleDelivery.ts`. Never put provider-specific logic in `pipeline.ts`.
- **Consent-first** — the Atlas Signal Tag must check consent state before beaconing. If ad consent is not granted, return early without calling `sendBeacon`.
- **Zod validation** — validate the `browser-event` body with Zod before touching Redis or Supabase.
- **TypeScript strict** — `noUnusedLocals`, `noUnusedParameters`. Build must pass.
- **API responses** → `{ data, error, message }` shape.
- **Functional components only** — Dedup Rate tile is a functional component.
- **Loading states** — the new tile shows a skeleton while the metrics endpoint loads.
