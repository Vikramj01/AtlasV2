# PRD: Atlas UX Clarity Layer
**Version:** 1.0  
**Status:** Ready for implementation  
**Scope:** Frontend only — no backend changes required  
**Target files:** New central content file + targeted component updates

---

## 1. Overview

Atlas surfaces technically accurate data but presents it in language that assumes developer familiarity. The target users — agency account managers, in-house marketing strategists, and non-technical campaign owners — need the same data translated into business-impact language without losing access to technical detail.

This PRD specifies a **UX clarity layer** built around four changes:

1. A central content file (`ui-copy.ts`) that owns all user-facing copy, tooltips, status labels, and empty states
2. A reusable `Tooltip` component that consumes from `ui-copy.ts`
3. Label and status language updates across the platform
4. Summary-first default views on data-heavy screens, with drill-down preserved

**What is NOT in scope:**  
- Developer Portal (`/developer`)  
- CAPI setup wizard (technical audience by design)  
- Any backend routes, database schema, or API contracts  
- Any structural redesign of pages or navigation hierarchy

---

## 2. Central Content File

### 2.1 Create `frontend/src/lib/ui-copy.ts`

This is the single source of truth for all user-facing copy introduced by this PRD. No tooltip text, status label, or empty state string should be hardcoded into components — they must reference this file.

```ts
// frontend/src/lib/ui-copy.ts

export const SECTION_LABELS = {
  signalHealth: {
    primary: 'Ad Data Quality',
    technical: 'Signal Health',
  },
  capi: {
    primary: 'Server-Side Tracking',
    technical: 'Conversions API (CAPI)',
  },
  gtmContainer: {
    primary: 'Tracking Setup',
    technical: 'GTM Container',
  },
  crawlSignalExtractor: {
    primary: 'Website Tracking Scan',
    technical: 'Crawl Signal Extractor',
  },
  emqMonitoring: {
    primary: 'Data Quality Score',
    technical: 'Event Match Quality (EMQ)',
  },
  deduplication: {
    primary: 'Duplicate Prevention',
    technical: 'Deduplication',
  },
  journeyBuilder: {
    primary: 'Tracking Plan Builder',
    technical: 'Journey Builder',
  },
  planningMode: {
    primary: 'Site Scan & Recommendations',
    technical: 'AI Planning Mode',
  },
  conversionStrategyGate: {
    primary: 'Campaign Setup Review',
    technical: 'Conversion Strategy Gate',
  },
  consentHub: {
    primary: 'Cookie & Consent Settings',
    technical: 'Consent Integration Hub',
  },
  offlineConversions: {
    primary: 'CRM / Offline Sales Upload',
    technical: 'Offline Conversions',
  },
  channelInsights: {
    primary: 'Channel Performance Signals',
    technical: 'Channel Insights',
  },
  signalLibrary: {
    primary: 'Tracking Event Templates',
    technical: 'Signal Library',
  },
  readinessScore: {
    primary: 'Platform Readiness',
    technical: 'Readiness Score',
  },
  auditEngine: {
    primary: 'Tracking Audit',
    technical: 'Audit Engine',
  },
} satisfies Record<string, { primary: string; technical: string }>;

export const TOOLTIPS = {
  // Health Dashboard
  healthScore: {
    label: 'Signal Health Score',
    what: 'A measure of how completely your website is sending conversion data to your ad platforms.',
    why: 'A higher score means ad platforms have better data to optimise your budget and target the right people.',
  },
  emq: {
    label: 'Event Match Quality (EMQ)',
    what: "How well the customer data you're sending matches Meta's records.",
    why: 'Higher EMQ directly improves the reach and cost-efficiency of your Meta campaigns.',
  },
  deduplication: {
    label: 'Duplicate Prevention',
    what: 'A process that prevents the same conversion from being counted twice.',
    why: 'Without this, ad platforms over-report results and misallocate your budget.',
  },
  signalFreshness: {
    label: 'Signal Freshness',
    what: 'How recently your tracking signals sent data.',
    why: 'Stale signals can cause ad platforms to optimise on outdated behaviour, increasing your cost-per-result.',
  },
  readinessScore: {
    label: 'Platform Readiness Score',
    what: 'An overall score across all Atlas setup areas.',
    why: 'A complete setup ensures every module is protecting and improving your campaign data.',
  },

  // Crawl Signal Extractor
  crawlRun: {
    label: 'Website Tracking Scan',
    what: 'A scan of your website pages that discovers which tracking signals are active and checks if they are correctly configured.',
    why: 'Gaps found here directly explain why ad platforms may be under-reporting conversions.',
  },
  signalHealthy: {
    label: 'Working Correctly',
    what: 'This tracking signal is firing and sending complete data to your ad platform.',
    why: 'No action needed — this signal is contributing to your campaign performance.',
  },
  signalWarning: {
    label: 'Needs Attention',
    what: 'This signal is firing but is missing data your ad platform needs to optimise spend.',
    why: "Fixing this can improve your campaign's ability to find the right audience.",
  },
  signalError: {
    label: 'Not Working',
    what: 'This signal has stopped sending data to your ad platform.',
    why: 'This is likely reducing the quality of conversion data your campaigns are using.',
  },
  partialCrawl: {
    label: 'Scan Completed with Gaps',
    what: "The scan finished but couldn't reach some pages on your website.",
    why: 'Results shown are based on the pages that were successfully scanned. Re-run the scan or check those URLs manually.',
  },

  // Strategy Gate
  strategyVerdict_CONFIRM: {
    label: 'CONFIRM',
    what: "Your current tracking event is the right choice for this campaign objective.",
    why: 'No changes needed — proceed to site scan.',
  },
  strategyVerdict_AUGMENT: {
    label: 'AUGMENT',
    what: 'Your current event works but should be supplemented with an additional signal.',
    why: "Adding the recommended proxy event gives the ad platform more data points to optimise your spend.",
  },
  strategyVerdict_REPLACE: {
    label: 'REPLACE',
    what: "Your current tracking event doesn't match your campaign objective closely enough.",
    why: 'Using the recommended event instead will align what you measure with what you want to achieve.',
  },
  lockBrief: {
    label: 'Lock Strategy Brief',
    what: 'Finalises your conversion strategy so the site scan can begin.',
    why: 'You can always create a new brief later if your strategy changes.',
  },
  proxyEvent: {
    label: 'Proxy Event',
    what: 'A tracking signal that represents an action that happens before the final conversion.',
    why: "Because your conversion timeline is long, ad platforms need an earlier signal to learn from — otherwise they're optimising in the dark.",
  },

  // Journey Builder
  journeyStage: {
    label: 'Journey Stage',
    what: 'A step in your customer journey where a tracking event fires.',
    why: 'Mapping events to journey stages helps ad platforms understand the full path to conversion.',
  },
  gtmContainerExport: {
    label: 'GTM Container Export',
    what: 'A file that can be imported directly into Google Tag Manager.',
    why: 'This saves your developer time by pre-configuring the tracking setup based on your strategy.',
  },

  // Signal Library
  signalPack: {
    label: 'Signal Pack',
    what: 'A curated set of tracking events built for a specific industry or use case.',
    why: 'Signal packs give you a validated starting point instead of configuring events from scratch.',
  },

  // Channel Insights
  channelSignalBehaviour: {
    label: 'Channel Signal Behaviour',
    what: 'How tracking signals are firing across each traffic source (e.g. paid search, organic, email).',
    why: 'Gaps in specific channels can explain underperformance that looks like a media problem but is actually a data problem.',
  },

  // Consent Hub
  consentMode: {
    label: 'Google Consent Mode v2',
    what: 'A framework that tells Google how to handle tracking data based on user consent choices.',
    why: 'Without this configured correctly, you may be losing modelled conversion data in Google Ads.',
  },
  cmpSync: {
    label: 'Consent Platform Sync',
    what: 'Connects Atlas to your existing cookie consent tool (OneTrust, Cookiebot, or Usercentrics).',
    why: 'Ensures your tracking signals only fire in line with what users have agreed to — protecting you from compliance risk.',
  },

  // Offline Conversions
  offlineUpload: {
    label: 'Offline Conversion Upload',
    what: 'A file upload that sends sales or leads from your CRM into Google Ads.',
    why: 'This closes the loop between ad clicks and real-world outcomes, improving Smart Bidding accuracy.',
  },
  gclid: {
    label: 'Click ID (GCLID)',
    what: 'A unique identifier Google Ads assigns to each ad click.',
    why: 'Matching your offline sales back to this ID is how Google Ads knows which clicks converted.',
  },

  // Audit Engine
  auditRun: {
    label: 'Tracking Audit',
    what: 'A simulated visitor journey through your website that checks every tracking event along the way.',
    why: 'Identifies gaps that only appear in real browsing conditions — not just on a single page.',
  },
  gapClassification: {
    label: 'Gap Classification',
    what: 'How a missing or broken tracking event is categorised by where it falls in the customer journey.',
    why: 'Higher-funnel gaps are less critical; lower-funnel gaps (checkout, purchase) directly affect conversion reporting.',
  },
} satisfies Record<string, { label: string; what: string; why: string }>;

export const STATUS_LABELS = {
  healthy: {
    badge: 'Working',
    description: 'This tracking signal is firing and sending complete data to your ad platform.',
  },
  warning: {
    badge: 'Needs Attention',
    description: 'This signal is firing but missing data your ad platform needs to optimise spend.',
  },
  error: {
    badge: 'Not Working',
    description: 'This signal has stopped sending data. This may be affecting your campaign performance.',
  },
} satisfies Record<string, { badge: string; description: string }>;

export const HEALTH_SCORE_CONTEXT = (score: number): string => {
  if (score >= 85) {
    return 'Your ad platforms are receiving strong conversion data. Your campaigns are well-positioned to optimise spend effectively.';
  }
  if (score >= 60) {
    return `Your ad platforms are receiving approximately ${score}% of the conversion data they need. Some signals need attention to improve campaign optimisation.`;
  }
  return `Your tracking score is below 60. Ad platforms are working with incomplete data, which can increase your cost-per-acquisition and reduce targeting accuracy.`;
};

export const EMPTY_STATES = {
  crawlRuns: {
    heading: "You haven't scanned your website yet",
    body: "A scan discovers which tracking signals are live across your pages and checks if they're sending the right data to your ad platforms.",
    cta: 'Start a Website Scan',
  },
  auditHistory: {
    heading: 'No audits run yet',
    body: 'A tracking audit simulates a real visitor journey through your site and checks every conversion event along the way. Run one to find gaps that static checks miss.',
    cta: 'Run a Tracking Audit',
  },
  signalLibrary: {
    heading: 'No tracking events configured',
    body: 'Your signal library holds the tracking events your team has set up. Start by selecting a Signal Pack for your industry, or add events manually.',
    cta: 'Browse Signal Packs',
  },
  journeys: {
    heading: 'No tracking plans created',
    body: 'A tracking plan maps your customer journey to the events your ad platforms need to optimise spend. Create one to generate a ready-to-import GTM setup.',
    cta: 'Build a Tracking Plan',
  },
  strategyBriefs: {
    heading: 'No strategy briefs yet',
    body: 'A strategy brief reviews your campaign objectives and recommends the right conversion events before you run a site scan. This ensures your tracking setup is aligned with your goals.',
    cta: 'Create a Strategy Brief',
  },
  channelInsights: {
    heading: 'No channel data yet',
    body: 'Once your tracking is live, Atlas will show you how signals are behaving across each traffic source — helping you spot data gaps that look like media problems.',
    cta: 'Check Your Signal Setup',
  },
  offlineConversions: {
    heading: 'No offline uploads yet',
    body: 'Upload your CRM or sales data to send offline conversions back to Google Ads. This closes the loop between ad clicks and real-world outcomes.',
    cta: 'Upload Offline Conversions',
  },
  alerts: {
    heading: 'No active alerts',
    body: 'Atlas monitors your tracking signals continuously. If something stops working or degrades, an alert will appear here.',
    cta: null,
  },
} satisfies Record<string, { heading: string; body: string; cta: string | null }>;

export const LOW_HEALTH_CALLOUT = (score: number): string =>
  `Your tracking score has dropped to ${score}. This typically means ad platforms are working with incomplete data, which can increase your cost-per-acquisition and reduce targeting accuracy.`;
```

---

## 3. Tooltip Component

### 3.1 Create `frontend/src/components/common/InfoTooltip.tsx`

This is the single reusable tooltip component used everywhere in the platform. It renders a small info icon that, on hover (desktop) or tap (mobile), shows a two-line popover from `ui-copy.ts`.

**Props:**

```ts
interface InfoTooltipProps {
  entry: {
    label: string;
    what: string;
    why: string;
  };
  side?: 'top' | 'right' | 'bottom' | 'left'; // default: 'top'
  className?: string;
}
```

**Behaviour:**
- Uses shadcn/ui `Tooltip` primitive (`components/ui/tooltip`)
- Icon: `Info` from `lucide-react`, 14px, muted foreground colour
- Popover width: max 280px
- Content structure:
  - **Label** in small semibold text (the `label` field)
  - **What** line: `what` field in normal weight
  - **Why** line: `why` field in muted/secondary colour with a subtle divider above
- Delay: 200ms open, 0ms close
- Must be keyboard accessible (focus-visible trigger)
- Must not interfere with surrounding button or link click targets

**Usage pattern:**

```tsx
import { InfoTooltip } from '@/components/common/InfoTooltip';
import { TOOLTIPS } from '@/lib/ui-copy';

<InfoTooltip entry={TOOLTIPS.healthScore} side="right" />
```

---

## 4. Section Label Updates

### 4.1 Sidebar navigation (`frontend/src/components/layout/Sidebar.tsx`)

Update each nav item to show the **primary label** with the **technical label** as a secondary line below it (smaller, muted). Do not remove technical labels — they must remain visible.

Apply the `SECTION_LABELS` map from `ui-copy.ts` for all items listed in the map. Pattern:

```tsx
// Before
<NavItem label="Signal Health" href="/health" />

// After
<NavItem
  primaryLabel={SECTION_LABELS.signalHealth.primary}
  technicalLabel={SECTION_LABELS.signalHealth.technical}
  href="/health"
/>
```

Update `NavItem` (or equivalent component) to accept and render `primaryLabel` + optional `technicalLabel`. Technical label renders beneath in 10–11px muted text.

### 4.2 Page headings and section headings

On each page listed below, update the primary `<h1>` or section heading to use the `primary` label, with the `technical` label appended in a `<span>` at muted weight. Example pattern:

```tsx
<h1>
  {SECTION_LABELS.crawlSignalExtractor.primary}
  <span className="text-muted-foreground text-sm font-normal ml-2">
    {SECTION_LABELS.crawlSignalExtractor.technical}
  </span>
</h1>
```

**Pages to update:**
- `HealthDashboardPage` — "Ad Data Quality / Signal Health"
- `CrawlStatusPage` — "Website Tracking Scan / Crawl Signal Extractor"
- `PlanningModePage` — "Site Scan & Recommendations / AI Planning Mode"
- `StrategyPage` — "Campaign Setup Review / Conversion Strategy Gate"
- `ConsentPage` — "Cookie & Consent Settings / Consent Integration Hub"
- `CAPIPage` — "Server-Side Tracking / Conversions API (CAPI)"
- `JourneyBuilderPage` — "Tracking Plan Builder / Journey Builder"
- `ChannelInsightsPage` — "Channel Performance Signals / Channel Insights"
- `AuditProgressPage` and `ReportPage` — "Tracking Audit / Audit Engine"

---

## 5. Status Language Updates

### 5.1 `HealthBadge` component (`frontend/src/components/common/HealthBadge.tsx`)

Update to consume from `STATUS_LABELS` in `ui-copy.ts`.

```tsx
import { STATUS_LABELS } from '@/lib/ui-copy';

// Replace hardcoded 'Healthy' / 'Warning' / 'Error' strings
const label = STATUS_LABELS[status]?.badge ?? status;
```

The badge text changes:
- `healthy` → **Working**
- `warning` → **Needs Attention**
- `error` → **Not Working**

Colours remain unchanged (green / amber / red).

### 5.2 `ActiveAlertsFeed` (`frontend/src/components/health/ActiveAlertsFeed.tsx`)

When rendering signal-level alerts, append the `description` from `STATUS_LABELS` below the existing alert message as a secondary line in muted text.

### 5.3 `CrawlResults` (`frontend/src/components/crawl/CrawlResults.tsx`)

Replace inline status strings with `STATUS_LABELS` values. Add an `<InfoTooltip>` next to each status badge using the corresponding entry from `TOOLTIPS` (`signalHealthy`, `signalWarning`, `signalError`).

---

## 6. Health Score Contextual Copy

### 6.1 `OverallScoreRing` (`frontend/src/components/health/OverallScoreRing.tsx`)

Below the score ring (or score number), add a `<p>` element that renders the output of `HEALTH_SCORE_CONTEXT(score)` from `ui-copy.ts`. Style as body text, muted, max-width ~400px.

```tsx
import { HEALTH_SCORE_CONTEXT } from '@/lib/ui-copy';

<p className="text-sm text-muted-foreground max-w-md mt-2">
  {HEALTH_SCORE_CONTEXT(score)}
</p>
```

### 6.2 Low score callout on Health Dashboard

In `HealthDashboardPage`, when `healthScore < 60`, render a soft callout card (amber border, amber background at low opacity) above the main dashboard content containing the output of `LOW_HEALTH_CALLOUT(score)` from `ui-copy.ts`. Include a "See what needs fixing →" link that scrolls to or expands the alerts section.

---

## 7. Tooltip Placement by Screen

For each screen below, add `<InfoTooltip>` components at the specified locations. All tooltip entries reference `TOOLTIPS` from `ui-copy.ts`.

### 7.1 Health Dashboard (`HealthDashboardPage`)

| Element | Tooltip entry |
|---|---|
| Overall score ring heading | `TOOLTIPS.healthScore` |
| EMQ metric card | `TOOLTIPS.emq` |
| Deduplication metric card | `TOOLTIPS.deduplication` |
| Signal Freshness metric (if present) | `TOOLTIPS.signalFreshness` |
| Readiness score card | `TOOLTIPS.readinessScore` |

### 7.2 Crawl Status / Results (`CrawlStatusPage`, `CrawlResults`)

| Element | Tooltip entry |
|---|---|
| Page heading | `TOOLTIPS.crawlRun` |
| "Partial" status badge | `TOOLTIPS.partialCrawl` |
| Per-signal "Working" badge | `TOOLTIPS.signalHealthy` |
| Per-signal "Needs Attention" badge | `TOOLTIPS.signalWarning` |
| Per-signal "Not Working" badge | `TOOLTIPS.signalError` |

### 7.3 Conversion Strategy Gate (`StrategyPage`, `Step2Verdict`, `BriefLocked`)

| Element | Tooltip entry |
|---|---|
| CONFIRM verdict badge | `TOOLTIPS.strategyVerdict_CONFIRM` |
| AUGMENT verdict badge | `TOOLTIPS.strategyVerdict_AUGMENT` |
| REPLACE verdict badge | `TOOLTIPS.strategyVerdict_REPLACE` |
| "Lock Strategy Brief" button | `TOOLTIPS.lockBrief` |
| "Proxy event" label/card | `TOOLTIPS.proxyEvent` |

### 7.4 Journey Builder (`JourneyBuilderPage`, `Step1`–`Step4`)

| Element | Tooltip entry |
|---|---|
| "Journey Stage" label | `TOOLTIPS.journeyStage` |
| GTM Container export button | `TOOLTIPS.gtmContainerExport` |

### 7.5 Signal Library (`SignalCard`, `PackCard`)

| Element | Tooltip entry |
|---|---|
| "Signal Pack" section heading | `TOOLTIPS.signalPack` |

### 7.6 Channel Insights (`ChannelInsightsPage`, `DiagnosticCard`)

| Element | Tooltip entry |
|---|---|
| Page heading / section label | `TOOLTIPS.channelSignalBehaviour` |

### 7.7 Consent Hub (`ConsentPage`)

| Element | Tooltip entry |
|---|---|
| Google Consent Mode section | `TOOLTIPS.consentMode` |
| CMP sync section | `TOOLTIPS.cmpSync` |

### 7.8 Offline Conversions (`CAPIPage` offline tab, upload wizard)

| Element | Tooltip entry |
|---|---|
| Upload area heading | `TOOLTIPS.offlineUpload` |
| GCLID column mapping label | `TOOLTIPS.gclid` |

### 7.9 Audit Engine (`AuditProgressPage`, `ReportPage`)

| Element | Tooltip entry |
|---|---|
| Page heading | `TOOLTIPS.auditRun` |
| Gap classification column/label | `TOOLTIPS.gapClassification` |

---

## 8. Summary-First Views

### 8.1 Crawl Results (`CrawlResults.tsx`)

**Current behaviour:** Renders a full per-page signal breakdown table as default.

**Required change:** Add a summary bar above the table (always visible) showing:
- Total pages scanned
- Count of signals: Working / Needs Attention / Not Working
- A plain-English headline derived from the worst signal status, e.g.:
  - All healthy → *"All tracking signals are working correctly across {n} pages."*
  - Warnings present → *"{n} signals need attention across {n} pages. Your ad platforms may be missing some data."*
  - Errors present → *"{n} signals are not working across {n} pages. This is likely affecting your conversion reporting."*

The summary bar should always be the first thing rendered on this screen. The detailed table renders below it unchanged.

Derive the headline copy programmatically from counts — do not hardcode strings. Pattern:

```tsx
const getHeadlineCopy = (healthy: number, warning: number, error: number, pages: number): string => {
  if (error > 0) return `${error} signal${error > 1 ? 's are' : ' is'} not working across ${pages} pages. This is likely affecting your conversion reporting.`;
  if (warning > 0) return `${warning} signal${warning > 1 ? 's need' : ' needs'} attention across ${pages} pages. Your ad platforms may be missing some data.`;
  return `All tracking signals are working correctly across ${pages} pages.`;
};
```

### 8.2 Channel Insights (`ChannelInsightsPage`, `ChannelOverviewTable`)

**Current behaviour:** Leads with the session/diagnostic data table.

**Required change:** Add a summary card above the table with:
- Total channels detected
- A status indicator (best / worst channel by signal health)
- A single plain-English sentence: e.g. *"Paid search has the strongest signal quality. Email signals need attention."*

Derive this from the existing channel diagnostics data already available in the component.

---

## 9. Empty State Updates

### 9.1 Update each empty state to use `EMPTY_STATES` from `ui-copy.ts`

The following components/pages render empty states. Each should be updated to display:
- The `heading` as a `<h3>` or equivalent
- The `body` as a `<p>` below it in muted text
- The `cta` as a primary button (if not null) — wire to the existing navigation action for that screen

| Component / Page | `EMPTY_STATES` key |
|---|---|
| `CrawlStatusPage` (no runs) | `crawlRuns` |
| `AuditHistoryTable` (empty) | `auditHistory` |
| `SignalCard` / Signal Library (empty) | `signalLibrary` |
| Journey list (empty) | `journeys` |
| Strategy briefs list (empty) | `strategyBriefs` |
| `ChannelOverviewTable` (empty) | `channelInsights` |
| Offline conversions history (empty) | `offlineConversions` |
| `ActiveAlertsFeed` (no alerts) | `alerts` |

---

## 10. Implementation Notes for Claude Code

1. **Import pattern** — always import from `@/lib/ui-copy`. Never inline copy in components.
2. **TypeScript** — `ui-copy.ts` uses `satisfies` to enforce shape. Do not widen types. All additions to the file must conform to the existing shape.
3. **No new dependencies** — `InfoTooltip` uses the existing shadcn/ui `Tooltip` primitive. If the primitive is not yet registered, run `npx shadcn add tooltip` or install `@radix-ui/react-tooltip` manually and create the component following the existing shadcn pattern.
4. **Existing status colours** — do not change badge colours. Only the text label changes.
5. **Build check** — `tsc && vite build` must pass. The `satisfies` keyword in `ui-copy.ts` will surface type errors if any entry is malformed.
6. **Responsive** — `InfoTooltip` must handle mobile correctly. On narrow viewports, prefer `side="bottom"` as default and ensure the popover does not clip. Use Radix collision detection (`avoidCollisions={true}`).
7. **Accessibility** — tooltip trigger must be keyboard focusable and have `aria-label` matching the `label` field of the tooltip entry.
8. **Do not touch** — `frontend/src/components/developer/`, CAPI setup wizard steps (`components/capi/steps/`), or any backend files.

---

## 11. Acceptance Criteria

- [ ] `frontend/src/lib/ui-copy.ts` exists and exports `SECTION_LABELS`, `TOOLTIPS`, `STATUS_LABELS`, `HEALTH_SCORE_CONTEXT`, `LOW_HEALTH_CALLOUT`, `EMPTY_STATES`
- [ ] `InfoTooltip` component exists in `components/common/` and renders correctly on desktop and mobile
- [ ] All tooltip placements in Section 7 are implemented
- [ ] Sidebar nav items show primary + technical labels
- [ ] Page headings on all listed pages show primary + technical labels
- [ ] Status badges read "Working", "Needs Attention", "Not Working"
- [ ] Health score ring shows contextual copy below the score
- [ ] Low health callout (< 60) renders on Health Dashboard
- [ ] Crawl Results shows summary bar above the signal table
- [ ] Channel Insights shows summary card above the data table
- [ ] All empty states use copy from `EMPTY_STATES`
- [ ] `tsc && vite build` passes with no new errors
- [ ] No copy strings are hardcoded in components — all reference `ui-copy.ts`
