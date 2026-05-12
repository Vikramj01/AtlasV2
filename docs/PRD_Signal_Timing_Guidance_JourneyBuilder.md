# PRD: Signal Timing Risk & Proxy Event Guidance
## Journey Builder — Step 1 Enhancement
**Product:** Atlas  
**Module:** Journey Builder  
**Status:** Ready for Claude Code handoff  
**Version:** 1.0  
**Date:** May 2026

---

## ⚠️ Pre-Planning Codebase Exploration — Complete Before Sprint Planning

Before reading the rest of this PRD or beginning any planning, explore the existing AtlasV2 codebase to answer the three questions below. Do not make assumptions — find the actual implementation. Record your findings inline here and use them to inform all technical decisions in this PRD.

**Question 1: Vertical / industry context on Client Project**
Locate the Client Project data model (likely in the Supabase schema and the corresponding frontend types). Does the Client Project object store the client's vertical or industry (e.g. B2B SaaS, e-commerce, subscription)? If yes, confirm the field name, its type, and the values it accepts. If no, note that proxy recommendations should display without vertical filtering for v1.

**Question 2: Proxy event library seeding method**
Review how other seed or reference data is currently handled in the codebase — look for existing Supabase migration scripts, seed files, or any admin UI for managing lookup/library data. Confirm whether a migration script is the correct approach for seeding the proxy event library, or whether the existing pattern uses a different method.

**Question 3: Journey Builder Step 2 conversion event handling**
Locate the Journey Builder Step 2 implementation — specifically how it consumes the conversion events array defined in Step 1 to generate GTM and/or WalkerOS output. Confirm whether all events in the array are currently treated identically, or whether there is already any distinction between event types. This determines how proxy events (flagged with `is_proxy: true`) should be handled differently in the generated output.

**Once all three questions are answered, proceed with sprint planning against the rest of this PRD.**

---

---

## 1. Overview

### 1.1 Problem Statement

Journey Builder's Step 1 currently allows users to define their conversion events without any guidance on whether those events are appropriate for the ad platforms they are running. A user can define "Closed Won Deal" as their primary conversion event and proceed through the entire Journey Builder flow — producing a technically correct GTM implementation — while unknowingly creating a signal that Meta cannot use at all and that creates a 60-day feedback loop problem on Google.

The result is a client with a clean, correctly implemented data layer that is structurally misconfigured for how modern ad platforms operate.

### 1.2 Objective

Add a **Signal Timing Assessment layer** to Journey Builder Step 1 that:

1. Classifies each conversion event the user defines by its estimated lag from ad click
2. Surfaces platform-specific timing risk flags inline, at the point of event definition
3. Recommends proxy events where late-funnel events create timing risk
4. Allows the user to add recommended proxy events directly into the Journey Builder flow without leaving Step 1

### 1.3 Design Decision: Step 1 Integration vs. Conversion Strategy Gate

This feature is built **inside Journey Builder Step 1**, not inside the Conversion Strategy Gate.

**Rationale:**
- Timing risk is event-specific. Assessment requires knowing which events the client has defined. The Conversion Strategy Gate fires before this context exists, making any timing warning there generic and dismissible.
- Step 1 is the highest-leverage intervention point. Changing event selection before the rest of the wizard is built is far less costly than surfacing a problem at the end.
- The Conversion Strategy Gate is designed as a decoupled, standalone nudge. Passing event context from Step 1 back to the Gate would create architectural coupling that contradicts its original design intent.
- Inline contextual feedback at the point of decision produces better outcomes than a pre-flight warning the user must mentally connect to their choices later.

The Conversion Strategy Gate remains unchanged.

---

## 2. Background Context

### 2.1 Platform Timing Windows

| Platform | Window | Behaviour Outside Window |
|---|---|---|
| Meta (CAPI) | Real-time preferred; degraded performance after 2h; attribution breaks after 24h | Events beyond 24h fall outside Meta's 7-day click attribution window entirely |
| Google Ads (ECfL / Smart Bidding) | Accepts offline conversions up to 90 days; backdates to click date | Late conversions create a proportionally long feedback loop, delaying campaign learning by the same lag duration |
| Google Performance Max | Same 90-day import tolerance | Same feedback loop problem; also reduces conversion volume available for learning threshold |

### 2.2 The Proxy Event Requirement

When a primary conversion event falls outside acceptable platform timing windows, ad platforms cannot use it to optimise audience targeting in a timely way. The solution is to instrument **proxy events** — earlier-funnel actions that correlate with eventual conversion and can be fired within the platform's preferred window.

Proxy events are not replacements for primary conversions. They are **additional signals** sent alongside or instead of primary conversions when timing constraints make the primary event ineffective. Both should be implemented; the proxy event carries the optimisation weight while the primary event validates signal quality over time.

### 2.3 Event Lag Classification

| Class | Lag from Ad Click | Examples |
|---|---|---|
| **Immediate** | 0–2 hours | Purchase (e-comm), App install, Free trial start, Newsletter signup |
| **Short-lag** | 2–24 hours | Lead form submission, Demo request, Quote request, Free account signup |
| **Long-lag** | 24h–30 days | Sales qualified lead, Proposal sent, Trial conversion |
| **Deep-lag** | 30+ days | Closed won, Contract signed, First subscription renewal, Enterprise onboarding complete |

---

## 3. Feature Specification

### 3.1 UX Flow

**Current Step 1 flow:**
1. User names the conversion event
2. User selects conversion type (e.g. Lead, Purchase, Custom)
3. User proceeds

**New Step 1 flow:**
1. User names the conversion event
2. User selects conversion type
3. **[NEW]** User selects or confirms the business model context for this event (see 3.2)
4. **[NEW]** Atlas classifies the event and surfaces a Timing Assessment panel (see 3.3)
5. **[NEW]** If risk detected, Atlas displays proxy event recommendations inline (see 3.4)
6. **[NEW]** User can accept, dismiss, or modify proxy event recommendations before proceeding
7. User proceeds to Step 2 with confirmed event list (primary + any accepted proxies)

### 3.2 Business Model Context Selector

Before classification, Atlas needs one additional input: the **typical journey duration** for this conversion event. This is not always inferrable from the event name alone.

Display a single inline selector immediately after the conversion type field:

**Label:** "How long does it typically take from first ad click to this conversion?"

**Options (radio, single select):**
- Same session or within a few hours
- 1–7 days
- 1–4 weeks
- More than a month

This input, combined with the conversion type, drives the lag classification. Store this value in the conversion event object for use in Data Quality Monitor and Andromeda scoring downstream.

### 3.3 Timing Assessment Panel

Triggered immediately after the user completes the business model context selector. Renders inline below the event definition fields — does not navigate away or open a modal.

**Panel anatomy:**

```
┌─────────────────────────────────────────────────────┐
│  ⏱ Signal Timing Assessment                          │
│                                                       │
│  [Event Name]: [Classification Badge]                 │
│                                                       │
│  [Risk summary — 1–2 sentences, platform-specific]   │
│                                                       │
│  Platform breakdown:                                  │
│  Meta   [status icon]  [one-line assessment]          │
│  Google [status icon]  [one-line assessment]          │
│                                                       │
│  [Proxy recommendation section — conditional]         │
└─────────────────────────────────────────────────────┘
```

**Classification badges:**

| Badge | Colour | Trigger condition |
|---|---|---|
| Optimal Signal | Green | Immediate class events |
| Timing Risk: Meta | Amber | Short-lag class events |
| Timing Risk: Meta + Google Loop | Red | Long-lag class events |
| Critical Timing Risk | Red | Deep-lag class events |

**Status icons per platform:**

- ✅ Within window — event will be used for optimisation
- ⚠️ Marginal — event may degrade performance
- ❌ Outside window — event cannot be used for real-time optimisation

**Example: "Closed Won Deal" with "More than a month" selected**

```
⏱ Signal Timing Assessment

Closed Won Deal — Critical Timing Risk

This event falls well outside Meta's attribution window and will 
create a 30+ day feedback loop on Google, delaying campaign 
learning by the same duration as your sales cycle.

Meta    ❌  Beyond 24h attribution window. Cannot optimise on this event.
Google  ⚠️  Accepted up to 90 days, but ties campaign feedback loop 
            to your full sales cycle length.

→ We recommend adding proxy events to carry optimisation weight 
  while this event validates signal quality over time.
```

**Example: "Demo Request" with "1–7 days" selected**

```
⏱ Signal Timing Assessment

Demo Request — Timing Risk: Meta

This event typically arrives within Meta's attribution window but 
may create delays for some journeys. Consider a same-session 
proxy to strengthen Meta signal volume.

Meta    ⚠️  Borderline. Events arriving beyond 2h will degrade performance.
Google  ✅  Within Smart Bidding tolerance for this lag duration.
```

### 3.4 Proxy Event Recommendations

Rendered inside the Timing Assessment panel when classification is Amber or Red.

**Header:** "Recommended proxy events"  
**Subtext:** "These earlier-funnel signals carry optimisation weight while your primary event validates quality over time."

Each recommendation card displays:
- Proxy event name
- Estimated lag class (badge)
- Why it works (one sentence)
- Platform benefit (Meta / Google / Both)
- **"Add to Journey"** button

**Proxy event recommendation logic by primary event class:**

| Primary Event Class | Recommended Proxy Events |
|---|---|
| Short-lag | Page engagement (2+ pages viewed), CTA click, Form start |
| Long-lag | Form submission, Lead created (CRM), Meeting booked, Trial started |
| Deep-lag | MQL, SQL, Proposal sent, Trial started, Meeting booked, Demo completed |

**Proxy event library** (Atlas maintains a curated list per vertical — see Section 4):

Each proxy in the library has:
- `name` — display name
- `lag_class` — Immediate / Short-lag / Long-lag
- `platform_benefit` — Meta / Google / Both
- `rationale` — one-sentence explanation
- `event_type` — maps to existing Journey Builder event type taxonomy
- `verticals` — list of verticals where this proxy is commonly applicable

When the user clicks **"Add to Journey"**, the proxy event is appended to the conversion event list in Step 1 with a visual indicator that it was added as a proxy (distinct from primary events). The user can remove it before proceeding.

### 3.5 Multi-Event Handling

Users may define more than one conversion event in Step 1. The Timing Assessment panel runs independently for each event and collapses into a summary view when multiple events are defined:

```
Signal Timing Summary
─────────────────────
✅ Purchase            Optimal Signal
⚠️ Demo Request        Timing Risk: Meta
❌ Closed Won Deal     Critical Timing Risk

2 events need proxy signals  →  [Review Recommendations]
```

Clicking "Review Recommendations" expands the full assessment for flagged events only.

---

## 4. Proxy Event Library (Initial Seed)

The following events should be seeded into the proxy event library at launch. This list is not exhaustive — it should be extensible via the Atlas admin layer without code changes.

### B2B / Lead Generation

| Proxy Event | Lag Class | Platform Benefit | Rationale |
|---|---|---|---|
| Form submission (any) | Short-lag | Both | High-intent, measurable within session or same day |
| Demo / meeting booked | Short-lag | Both | Strong purchase intent signal, typically within 24h |
| Trial account created | Short-lag | Both | Product-qualified lead, correlates with eventual conversion |
| Pricing page viewed (2+ times) | Immediate | Meta | Repeat pricing visits indicate evaluation stage |
| Content download (gated) | Short-lag | Both | Willingness to exchange data signals active consideration |
| MQL (CRM event) | Long-lag | Google | Sales-validated intent, acceptable for Google feedback loops |
| SQL (CRM event) | Long-lag | Google | Higher predictive value than MQL for closed won |
| Proposal / quote viewed | Long-lag | Google | Late-stage indicator, use as secondary optimisation signal |

### B2C / E-commerce

| Proxy Event | Lag Class | Platform Benefit | Rationale |
|---|---|---|---|
| Add to cart | Immediate | Both | Strong purchase intent, fires within session |
| Initiate checkout | Immediate | Both | Highest pre-purchase intent signal available |
| Product detail page (3+ views) | Immediate | Meta | Repeat product evaluation correlates with purchase |
| Wishlist / save item | Immediate | Meta | Explicit intent signal, fires immediately |
| Account created | Short-lag | Both | Commitment signal preceding first purchase |

### Subscription / SaaS

| Proxy Event | Lag Class | Platform Benefit | Rationale |
|---|---|---|---|
| Free trial started | Short-lag | Both | Direct product engagement, strong conversion predictor |
| Onboarding step completed | Short-lag | Both | Activation signal correlates with trial-to-paid conversion |
| Feature used (key feature) | Short-lag | Google | Usage-based intent, requires product analytics integration |
| Subscription page viewed | Immediate | Meta | Upgrade consideration signal |

---

## 5. Technical Implementation Notes

### 5.1 Stack Context

- Frontend: React 19 + Vite + React Router
- Backend: Express on Render
- Database: Supabase
- No Next.js — all routing is client-side via React Router

### 5.2 Data Model Changes

**Extend the conversion event object** to include:

```typescript
interface ConversionEvent {
  // existing fields
  id: string
  name: string
  type: ConversionEventType
  
  // new fields
  journey_duration: 'immediate' | 'one_to_seven_days' | 'one_to_four_weeks' | 'over_one_month'
  lag_class: 'immediate' | 'short_lag' | 'long_lag' | 'deep_lag'
  timing_risk: 'none' | 'meta' | 'meta_and_loop' | 'critical'
  is_proxy: boolean
  proxy_for?: string // id of primary event this proxies
  platform_flags: {
    meta: 'optimal' | 'marginal' | 'outside_window'
    google: 'optimal' | 'marginal' | 'outside_window'
  }
}
```

**Proxy event library table** (Supabase):

```sql
create table proxy_event_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lag_class text not null,
  platform_benefit text not null, -- 'meta' | 'google' | 'both'
  rationale text not null,
  event_type text not null,
  verticals text[], -- array of applicable verticals
  created_at timestamptz default now()
);
```

### 5.3 Classification Logic

Classification runs client-side on event type + journey_duration selection. No API call required for basic classification.

```typescript
function classifyEvent(
  eventType: ConversionEventType,
  journeyDuration: JourneyDuration
): LagClass {
  // Deep-lag: any event with journey duration > 1 month
  if (journeyDuration === 'over_one_month') return 'deep_lag'
  
  // Long-lag: 1–4 weeks, or known long-cycle event types
  if (journeyDuration === 'one_to_four_weeks') return 'long_lag'
  if (LONG_LAG_EVENT_TYPES.includes(eventType) && 
      journeyDuration !== 'immediate') return 'long_lag'
  
  // Short-lag: 1–7 days
  if (journeyDuration === 'one_to_seven_days') return 'short_lag'
  
  // Immediate: same session / within hours
  return 'immediate'
}
```

Proxy recommendations are fetched from Supabase based on the classified lag class. Filter by vertical if vertical context is available from the Client Project.

### 5.4 Component Structure

```
JourneyBuilderStep1/
  ConversionEventForm/       — existing
  BusinessModelContextSelector/  — new
  TimingAssessmentPanel/     — new
    TimingBadge/
    PlatformStatusRow/
    ProxyRecommendationList/
      ProxyEventCard/
  TimingAssessmentSummary/   — new (multi-event view)
```

### 5.5 State Management

Proxy events added via "Add to Journey" are appended to the same conversion events array as primary events, with `is_proxy: true` and `proxy_for` set to the parent event's ID. Journey Builder Step 2+ should visually distinguish proxy events from primary events (e.g. indented, labelled "Proxy signal").

---

## 6. Downstream Integration

### 6.1 Data Quality Monitor

The `lag_class` and `platform_flags` fields stored on each conversion event should be surfaced in the Data Quality Monitor as part of signal health scoring. A client with all Deep-lag events and no proxy events should receive a degraded signal architecture score even if all events are firing correctly.

### 6.2 Andromeda Signal Health

The Andromeda Readiness Score should incorporate timing risk as an input dimension. A client with ❌ Meta timing flags on their primary conversion events should not score well on the Andromeda score regardless of EMQ or deduplication health.

### 6.3 Client Project Context

The timing assessment results should be stored at the Client Project level and surfaced in the project overview — not just inside Journey Builder. Agencies should be able to see at a glance which client projects have unresolved timing risk.

---

## 7. Out of Scope

The following are explicitly out of scope for this PRD:

- **Dynamic proxy scoring / ML** — predicting conversion probability in real-time. This is a data science problem outside Atlas's implementation lane.
- **Platform API integration for signal performance validation** — comparing proxy signal predictions to actual downstream outcomes requires warehouse integration. Future PRD.
- **Audience feedback loop monitoring** — signal pool testing, saturation monitoring. Future PRD.
- **Automated proxy event firing** — Atlas recommends and instruments proxy events; it does not trigger them dynamically based on user behaviour scoring.
- **Modifications to the Conversion Strategy Gate** — remains unchanged.

---

## 8. Acceptance Criteria

### Journey Duration Selector
- [ ] Selector renders inline below conversion type field in Step 1
- [ ] Four options available: same session, 1–7 days, 1–4 weeks, over one month
- [ ] Selection is required before Timing Assessment panel renders
- [ ] Value is stored on the conversion event object

### Timing Assessment Panel
- [ ] Panel renders inline after journey duration is selected (no navigation, no modal)
- [ ] Correct badge rendered for each lag class
- [ ] Meta and Google platform status rows display correct status icon and copy
- [ ] Panel renders independently for each conversion event defined
- [ ] Panel does not render for Immediate-class events with no risk (or renders with green confirmation)

### Proxy Event Recommendations
- [ ] Recommendations render only for Amber and Red classifications
- [ ] Each recommendation card shows event name, lag class, rationale, platform benefit
- [ ] "Add to Journey" appends the proxy event to the conversion event list with `is_proxy: true`
- [ ] Added proxy events are visually distinct from primary events
- [ ] User can remove added proxy events before proceeding
- [ ] User can proceed without adding proxies (recommendations are not blocking)

### Multi-Event Summary
- [ ] Summary view renders when two or more conversion events are defined
- [ ] Summary shows status badge per event
- [ ] "Review Recommendations" expands flagged events only
- [ ] Count of events needing proxy signals is accurate

### Data Persistence
- [ ] `journey_duration`, `lag_class`, `timing_risk`, `platform_flags`, `is_proxy`, `proxy_for` stored on conversion event object in Supabase
- [ ] Proxy events created via "Add to Journey" persisted with correct parent reference

### Downstream
- [ ] Timing risk flags visible in Client Project overview (read-only display, no interaction required at this stage)
- [ ] `lag_class` and `platform_flags` accessible to Data Quality Monitor and Andromeda scoring modules

---

## 9. Open Questions for Implementation

1. **Vertical context** — Does the current Client Project object store the client's vertical (e.g. B2B SaaS, e-commerce, subscription)? If so, proxy recommendations should filter by vertical. If not, show all applicable proxies without vertical filtering for now.

2. **Proxy event library seeding** — Should the initial library be seeded via a Supabase migration script, or managed through an admin UI? Recommend migration script for v1; admin UI is a future enhancement.

3. **Journey Builder Step 2+ treatment of proxy events** — Confirm whether Step 2 (GTM/WalkerOS output generation) currently treats all events in the conversion event array identically. Proxy events should ideally be flagged differently in the generated output (e.g. tagged as supporting signals rather than primary optimisation targets).
