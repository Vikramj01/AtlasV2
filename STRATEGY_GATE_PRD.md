# PRD: Conversion Strategy Gate (Standalone)
**Feature:** Pre-Planning Strategy Planner  
**Route:** `/planning/strategy`  
**Status:** Ready for build  
**Priority:** Medium  
**Risk:** Low — zero integration with existing Planning Mode wizard or session logic

---

## Overview

Add a standalone Conversion Strategy Gate to Atlas. It surfaces as a dismissible nudge banner on the Planning Mode entry screen and links to a self-contained multi-step strategy planner at `/planning/strategy`. The planner walks the user through defining their business outcome and evaluating their current conversion event, then outputs a formatted strategy brief they can reference when running their Planning Mode scan.

**No existing code is modified.** Planning Mode wizard, session schema, audit engine, and all existing Planning routes are untouched.

---

## Scope

### In scope
- Dismissible nudge banner on the Planning Mode entry screen
- New route `/planning/strategy` with a self-contained 2-step form
- Claude API call to evaluate the current event against the stated business outcome
- Strategy brief output screen with copy-to-clipboard and optional print/PDF
- `localStorage` flag to persist banner dismissal per user

### Out of scope
- Any modifications to existing Planning Mode wizard (Steps 1–7)
- Persisting strategy briefs to Supabase (V2)
- Connecting strategy context to Planning Mode scan (V2)
- Plan gating (available to all plans in V1)

---

## New Files

```
frontend/src/
├── app/(dashboard)/planning/strategy/
│   └── page.tsx                        # Route entry point
├── components/strategy/
│   ├── StrategyGateBanner.tsx          # Nudge banner for Planning Mode entry
│   ├── StrategyWizard.tsx              # 2-step wizard shell + progress
│   ├── Step1Outcome.tsx                # Business outcome definition form
│   ├── Step2EventEval.tsx              # Current event input + AI evaluation
│   └── StrategyBrief.tsx              # Output: formatted brief + copy/print
```

---

## Modified Files

```
frontend/src/app/(dashboard)/planning/
└── page.tsx                            # Add <StrategyGateBanner /> at top of page only
```

> **That is the only modification to any existing file.**

---

## Component Specifications

---

### `StrategyGateBanner.tsx`

Dismissible informational banner rendered at the top of the existing Planning Mode entry page (`/planning`), above all existing content.

**Behaviour:**
- Renders only if `localStorage.getItem('strategy_gate_dismissed')` is not `'true'`
- Dismiss button sets `localStorage.setItem('strategy_gate_dismissed', 'true')` and hides banner (no page reload needed, use local state)
- CTA button navigates to `/planning/strategy`

**UI:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  💡 Before you scan — is your conversion event the right one?       │
│  Define your optimisation objective first to get more strategic      │
│  recommendations from your planning session.                         │
│                                                                      │
│  [ Define my objective → ]                          [ Dismiss  ✕ ]  │
└─────────────────────────────────────────────────────────────────────┘
```

- Background: `bg-blue-50` border `border-blue-200`
- Icon: lucide `Lightbulb` in `text-blue-500`
- CTA: shadcn `Button` variant `outline` → navigates to `/planning/strategy`
- Dismiss: small `ghost` button with `X` icon, right-aligned
- Wrap in shadcn `Card` or plain styled `div` — no modal

---

### `page.tsx` — `/planning/strategy`

Route wrapper. Renders `<StrategyWizard />`. No auth beyond existing `ProtectedRoute` (already applied at layout level).

```tsx
export default function StrategyPage() {
  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <StrategyWizard />
    </div>
  );
}
```

---

### `StrategyWizard.tsx`

Shell component managing wizard state. Two steps + one output screen. No backend session required — all state lives in `useState` within this component.

**State shape:**
```ts
type WizardState = {
  step: 1 | 2 | 'output';
  step1: Step1Data | null;
  step2: Step2Data | null;
  brief: StrategyBrief | null;
  loading: boolean;
  error: string | null;
};

type Step1Data = {
  businessType: BusinessType;
  outcomeDescription: string;
  outcomeTimingDays: number; // derived from dropdown selection
};

type Step2Data = {
  currentEventName: string;
  eventSource: 'pixel' | 'capi' | 'offline' | 'none';
  valueDataPresent: boolean;
};

type StrategyBrief = {
  outcomeCategory: 'purchase' | 'qualified_lead' | 'activation_milestone' | 'retention_event' | 'donation';
  eventVerdict: 'CONFIRM' | 'AUGMENT' | 'REPLACE';
  verdictRationale: string;
  recommendedEventName: string | null;
  recommendedEventRationale: string | null;
  proxyEventRequired: boolean;
  proxyEventName: string | null;
  proxyEventRationale: string | null;
  summaryMarkdown: string; // full formatted brief for display + copy
};
```

**Progress indicator:** Simple step counter at the top — `Step 1 of 2` / `Step 2 of 2` / `Your Strategy Brief`. Use shadcn `Progress` or plain text. No complex stepper needed.

**Back navigation:** Show `← Back` text button between Steps 1→2. Not shown on output screen (user can navigate away via sidebar).

---

### `Step1Outcome.tsx`

**Fields:**

| Field | Type | Validation |
|---|---|---|
| Business type | `select` dropdown | Required |
| Outcome description | `textarea` | Required, min 30 chars |
| Outcome timing | `select` dropdown | Required |

**Business type options:**
```
ecommerce | lead_gen | b2b_saas | marketplace | nonprofit | other
```

**Outcome timing dropdown:**

| Label | Value (`outcomeTimingDays`) |
|---|---|
| Same day | 0 |
| 1–3 days | 2 |
| 4–7 days | 5 |
| 1–4 weeks | 14 |
| 1–3 months | 45 |
| Longer than 3 months | 120 |

**Validation:**
- Outcome description < 30 chars: show inline error `"Please be specific — describe the actual business outcome, not just a tracked event."`
- All fields required before CTA enabled

**CTA:** `Continue to event check →`

---

### `Step2EventEval.tsx`

**Fields:**

| Field | Type | Validation |
|---|---|---|
| Current event name | `input` text | Required |
| Event source | `radio` group | Required |
| Value data passed? | `Switch` toggle | Default off |

**Event source options:** Client-side pixel / Server-side CAPI / Offline upload / Not currently tracking

**On submit:**
1. Show loading state on button: `Evaluating your event...`
2. Call Claude API (see API Prompt below)
3. Parse response into `StrategyBrief`
4. Advance wizard to `'output'` step

**Error state:** If API call fails, show shadcn `Alert` with `destructive` variant: `"Something went wrong evaluating your event. Please try again."` — retry button re-fires the same request.

---

### Claude API Call

**Make the call from the frontend directly to the Anthropic API.** Follow the existing pattern used in Planning Mode (`planningApi.ts`). If a backend proxy endpoint exists for Claude calls, use that. Otherwise call `api.anthropic.com/v1/messages` directly.

**Model:** `claude-sonnet-4-6`  
**Max tokens:** `1000`

**System prompt:**
```
You are a conversion strategy analyst for digital advertising campaigns. 
Your job is to evaluate whether a client's current conversion event is well-matched 
to their stated business outcome, and to recommend improvements where needed.

Always respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON object.
```

**User prompt (construct dynamically):**
```
Business type: {businessType}
Business outcome: {outcomeDescription}
Typical days from ad click to outcome: {outcomeTimingDays}
Current optimisation event: {currentEventName}
Event source: {eventSource}
Value data present: {valueDataPresent}

Evaluate whether the current event is well-matched to the stated business outcome.

Respond with this exact JSON structure:
{
  "outcomeCategory": "purchase | qualified_lead | activation_milestone | retention_event | donation",
  "eventVerdict": "CONFIRM | AUGMENT | REPLACE",
  "verdictRationale": "Plain-language explanation of the verdict in 2-3 sentences.",
  "recommendedEventName": "Name of recommended event, or null if verdict is CONFIRM",
  "recommendedEventRationale": "Why this event is a better fit, or null if verdict is CONFIRM",
  "proxyEventRequired": true | false,
  "proxyEventName": "Recommended proxy event name if timing > 1 day, or null",
  "proxyEventRationale": "Why this proxy is a good predictor of the downstream outcome, or null",
  "summaryMarkdown": "A full strategy brief in markdown (3-5 short paragraphs) covering: the outcome, the verdict, the recommended event, and the proxy event if applicable. Written for a marketing practitioner."
}
```

**Parsing:** Strip any accidental markdown fences before `JSON.parse()`. Wrap in try/catch — surface error state if parse fails.

---

### `StrategyBrief.tsx`

Output screen rendered when `step === 'output'`.

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Your Conversion Strategy Brief                      │
│                                                      │
│  Verdict badge: [ ✓ CONFIRM ] / [ ⚠ AUGMENT ] / [ ✕ REPLACE ]
│                                                      │
│  {summaryMarkdown rendered as formatted text}        │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Recommended     │  │ Proxy Event              │  │
│  │ event card      │  │ card (if required)       │  │
│  └─────────────────┘  └──────────────────────────┘  │
│                                                      │
│  [ Copy brief ]   [ Start Planning scan → ]          │
└─────────────────────────────────────────────────────┘
```

**Verdict badge colours:**
- `CONFIRM` → `bg-green-100 text-green-800`
- `AUGMENT` → `bg-yellow-100 text-yellow-800`
- `REPLACE` → `bg-red-100 text-red-800`

**Recommended event card:** Only render if `recommendedEventName !== null`. Show event name bold, rationale below in muted text. shadcn `Card` with left border coloured by verdict.

**Proxy event card:** Only render if `proxyEventRequired === true`. Heading: `Proxy Event Recommendation`. Show `proxyEventName` bold, `proxyEventRationale` below. Amber left border. Include a one-line explainer: `"Your outcome typically fires after the attribution window. This proxy event fires sooner and predicts the downstream result."`

**Copy brief button:**
```ts
navigator.clipboard.writeText(brief.summaryMarkdown)
```
Show `"Copied!"` confirmation for 2 seconds using local state toggle.

**Start Planning scan button:** `Button` variant `default` → navigates to `/planning`. This is a plain link — no data passed, no session created.

**Start over link:** Small ghost text link at bottom — `"Start over"` → resets wizard state back to step 1.

---

## Routing

Add the new route to the React Router config. The route should sit under the existing authenticated layout so sidebar and topbar render normally.

```tsx
// In your routes config (wherever /planning is currently defined)
{
  path: '/planning/strategy',
  element: <StrategyPage />
}
```

No new backend routes required.

---

## Local Storage

| Key | Value | Purpose |
|---|---|---|
| `strategy_gate_dismissed` | `'true'` | Hides nudge banner on Planning Mode entry page |

No other persistence. Strategy briefs are not saved to Supabase in V1.

---

## Acceptance Criteria

| # | Criterion | Pass condition |
|---|---|---|
| 1 | Banner renders on Planning Mode entry | `StrategyGateBanner` appears above existing content on `/planning` when `strategy_gate_dismissed` is not set |
| 2 | Banner dismisses correctly | Clicking dismiss sets localStorage flag and hides banner without page reload |
| 3 | Banner CTA navigates correctly | Clicking "Define my objective" routes to `/planning/strategy` |
| 4 | Step 1 validation | Outcome description under 30 chars shows inline error; CTA disabled until all fields valid |
| 5 | Step 2 submits and calls Claude | On submit, loading state shown; Claude API called with correct prompt |
| 6 | Verdict rendered correctly | CONFIRM / AUGMENT / REPLACE badge with correct colour and rationale |
| 7 | Recommended event card | Renders only when `recommendedEventName` is not null |
| 8 | Proxy event card | Renders only when `proxyEventRequired` is true |
| 9 | Copy button | Copies `summaryMarkdown` to clipboard; shows "Copied!" for 2 seconds |
| 10 | Start Planning scan | Button navigates to `/planning`; no data passed |
| 11 | Start over | Resets wizard to Step 1 |
| 12 | Existing Planning Mode untouched | All existing `/planning` wizard flows unaffected |
| 13 | Error handling | API failure shows retry-able error alert; does not crash wizard |

---

## Dependencies

- `@anthropic-ai/sdk` — already installed
- `lucide-react` — already installed (use `Lightbulb`, `X`, `Check`, `AlertTriangle`)
- shadcn components needed: `Button`, `Card`, `Input`, `Textarea`, `Select`, `Switch`, `Alert`, `Progress`, `Badge`
  - Run `npx shadcn add [component]` for any not yet present

---

## V2 Backlog (do not build now)

- Persist strategy briefs to Supabase against `organization_id` (new `strategy_briefs` table)
- Surface prior brief as pre-filled default when user returns to `/planning/strategy`
- Pass strategy context into Planning Mode session on opt-in
- Share strategy brief via public link (reuse Developer Portal share pattern)
- Overlap resolution with Campaign Signal Validator event verdict logic
