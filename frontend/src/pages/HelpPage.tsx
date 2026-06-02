import { useState, useMemo, type ChangeEvent, type ReactElement } from 'react';
import type { FC } from 'react';
import { Search, BookOpen, Users, Zap, ChevronRight, ExternalLink } from 'lucide-react';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HelpSection {
  id: string;
  title: string;
  plan?: 'pro' | 'agency';
  content: string;
  keywords: string[];
}

interface HelpGroup {
  label: string;
  icon: FC<{ className?: string }>;
  sections: HelpSection[];
}

// ── Content ───────────────────────────────────────────────────────────────────

const GROUPS: HelpGroup[] = [
  {
    label: 'Getting Started',
    icon: BookOpen,
    sections: [
      {
        id: 'account-setup',
        title: 'Account Setup',
        keywords: ['sign up', 'register', 'login', 'organisation', 'billing', 'team', 'invite'],
        content: `
## Account Setup

### 1. Sign Up
Navigate to the Atlas login page, enter your email and password, then confirm your email via the verification link.

### 2. Create Your Organisation
On first login you will be prompted to create an organisation — your workspace in Atlas.
- Enter an **Organisation name**.
- Select an **Organisation type**: Agency (managing multiple clients) or In-house / Brand (single business).

### 3. Choose a Plan
| Plan | Best for |
|---|---|
| **Free** | Individuals exploring Atlas or running basic setups |
| **Pro** | Site scanning, CAPI integrations, platform connections |
| **Agency** | Multi-client workspaces and data management |

To upgrade: go to **Team & Settings → Billing**, click **Upgrade plan**, and complete Stripe Checkout.

### 4. Invite Team Members
Go to **Team & Settings → Team**, click **Invite member**, enter their email and select a role (Admin or Member).

### 5. Account Settings
Navigate to **Settings** at the bottom of the sidebar to manage your profile, password, billing, and notifications.
        `.trim(),
      },
      {
        id: 'agency-setup',
        title: 'Agency Setup',
        plan: 'agency',
        keywords: ['agency', 'client', 'setup wizard', 'clients', 'workspace', 'multi-client'],
        content: `
## Agency Setup

### Add a Client
Go to **Clients → Add client** to open the 6-step Client Setup Wizard:

1. **Basic details** — name, website URL, industry
2. **Business type** — e-commerce, lead gen, B2B SaaS, marketplace, nonprofit, B2B lead gen
3. **Platform config** — Google Ads customer ID, Meta Pixel ID, GA4 Measurement ID
4. **Identity field mapping** — map dataLayer paths to email, phone, and click IDs for CAPI match quality
5. **Page configuration** — define key pages (homepage, checkout, confirmation, etc.)
6. **Review & create**

### Deploy Signal Packs
Go to **Templates**, find a pack, click **Deploy**, select the target client, configure signal enrichment, and deploy.

### Generate Client Outputs
From the Client Detail Page, click **Generate outputs** to produce a GTM container JSON and dataLayer spec.

### Data Manager Console
Go to **Data Manager** for an agency-wide view of Customer Match / DMA health across all clients.
        `.trim(),
      },
    ],
  },
  {
    label: 'Role Guides',
    icon: Users,
    sections: [
      {
        id: 'role-solo',
        title: 'Solo Marketer / In-House',
        keywords: ['solo', 'in-house', 'brand', 'individual', 'marketer', 'setup checklist'],
        content: `
## Solo Marketer / In-House Guide

Complete these steps in order to get the most out of Atlas:

| Step | Feature | Plan |
|---|---|---|
| 1 | Conversion Strategy Gate | Free |
| 2 | AI Site Scan | Pro |
| 3 | Journey Builder | Free |
| 4 | Signal Library | Free |
| 5 | Consent Hub | Free |
| 6 | Conversion API | Pro |
| 7 | Platform Connections | Pro |

**Step 1 — Conversion Strategy:** Define tracking objectives, evaluate with Claude AI, lock the strategy brief.

**Step 2 — AI Site Scan:** Crawl your site to discover tracking opportunities. Approve recommendations and save to your Signal Library.

**Step 3 — Journey Builder:** Map customer journey stages, assign proxy values (£), and generate your GTM container + dataLayer spec.

**Step 4 — Signal Library:** Manage events, create custom signals, and deploy signal packs.

**Step 5 — Consent Hub:** Configure your CMP integration and Google Consent Mode v2.

**Step 6 — Conversion API:** Set up server-side event delivery to Meta, Google, and LinkedIn.

**Step 7 — Platform Connections:** Connect Google Ads, Meta, GA4, and GTM for reconciliation and health checks.

**Ongoing monitoring:** Use the Signal Tracking Dashboard (daily), Health Dashboard (weekly), Audit Engine (monthly), and Platform Reconciliation (weekly).
        `.trim(),
      },
      {
        id: 'role-agency-admin',
        title: 'Agency Admin',
        plan: 'agency',
        keywords: ['agency admin', 'agency workflow', 'client management', 'multi-client'],
        content: `
## Agency Admin Guide

### Phase 1 — Workspace Setup
- Create your agency organisation and upgrade to Agency plan.
- Invite team members (Admin for leads, Member for practitioners).
- Set org-level naming conventions before building your signal library.

### Phase 2 — Add Clients
Run the 6-step Client Setup Wizard for each client. Prioritise:
- Step 3: Enter platform IDs (enables reconciliation immediately).
- Step 4: Map email and phone fields (directly impacts CAPI match quality).

### Phase 3 — Strategy & Planning
For each client: lock a strategy brief → run an AI site scan → approve recommendations → save to Signal Library.

### Phase 4 — Signal Deployment
Select or clone a system signal pack, deploy to the client, configure signal enrichment (value field, dedup ID), generate GTM container and dataLayer spec.

### Phase 5 — CAPI Setup
Add CAPI providers per client: select platform, enter credentials, map events, link identity config, activate, and test.

### Phase 6 — Platform Connections & Reconciliation
Connect platforms via OAuth, then run reconciliation to compare config and volume against live platform data.

### Phase 7 — Ongoing Health
- Implementation Health Checks: validate GTM containers and detect drift.
- Data Manager Console: cross-client Customer Match / DMA health overview.
- Weekly: Signal Tracking Dashboard + Reconciliation.
- Monthly: Audit Engine per client.
        `.trim(),
      },
      {
        id: 'role-developer',
        title: 'Developer / Agency Client',
        keywords: ['developer', 'implementation', 'gtm', 'datalayer', 'gclid', 'hidden fields'],
        content: `
## Developer / Agency Client Guide

Your agency will share a **Developer Portal** link — a public page containing your complete implementation spec.

### What's in the Developer Portal
- **GTM Container JSON** — import-ready file for Google Tag Manager
- **dataLayer Spec** — per-page JavaScript snippets showing every \`dataLayer.push()\` call
- **GCLID / UTM capture script** — paste into your site \`<head>\` to capture click IDs in first-party cookies
- **Hidden form fields** — HTML to add to lead forms for GCLID and UTM capture
- **Implementation guide** — Enhanced Conversions for Leads setup guidance

### Implementing the GTM Container
1. Log in to Google Tag Manager.
2. Go to **Admin → Import Container**.
3. Select the JSON file from your agency.
4. Choose **Merge** (not Overwrite).
5. Review imported tags and triggers.
6. Test in Preview mode, then publish.

### Implementing the dataLayer Spec
Replace the placeholder values in code snippets (shown as \`{{PLACEHOLDER}}\`) with your actual data variables and push to \`window.dataLayer\` before GTM fires.

### GCLID / UTM Capture
Add the capture script to your \`<head>\` *above* the GTM snippet. Add hidden form fields to each lead form — they are populated automatically by the capture script.
        `.trim(),
      },
    ],
  },
  {
    label: 'Feature Reference',
    icon: Zap,
    sections: [
      {
        id: 'feature-strategy',
        title: 'Conversion Strategy Gate',
        keywords: ['strategy', 'brief', 'verdict', 'confirm', 'augment', 'replace', 'objectives', 'governance'],
        content: `
## Conversion Strategy Gate

**Available on:** Free

Defines and governs your tracking objectives before building any tracking. Uses Claude AI to evaluate each objective.

### Verdicts
| Verdict | Meaning |
|---|---|
| **CONFIRM** | Your current setup is appropriate — no changes needed |
| **AUGMENT** | Partially correct — add the recommended enhancements |
| **REPLACE** | Suboptimal — switch to the recommended action type |

### Governance tiers
- **Primary** — the main conversion action for campaign optimisation
- **Secondary** — supporting signal, not optimised against directly
- **Suppression** — used to exclude converting users from prospecting

### How to use
1. Go to **Conversion Strategy** → **New strategy brief**.
2. Choose Single or Multi-objective mode.
3. Add objectives, select platforms, click **Evaluate**.
4. Review verdicts and recommended action types.
5. Click **Lock brief** — required before running a site scan.
6. **Export PDF** to share with stakeholders.

> **Tip:** Lock your brief before scanning. Without a brief, site scan recommendations are generic.
        `.trim(),
      },
      {
        id: 'feature-site-scan',
        title: 'AI Site Scan',
        plan: 'pro',
        keywords: ['site scan', 'crawl', 'planning mode', 'ai', 'recommendations', 'pii', 'gtm'],
        content: `
## AI Site Scan (Planning Mode)

**Available on:** Pro

Crawls your site with a real browser and uses Claude AI to identify tracking opportunities, PII risks, and GTM recommendations.

### Prerequisites
- Pro plan. Locked strategy brief.

### How to use
1. Go to **Site Scan** → **New scan**.
2. Enter the site URL and select business type.
3. Click **Start scan** and watch real-time progress.
4. Review annotated screenshots and AI recommendations per page.
5. Approve or reject each recommendation.
6. Click **Save to Signal Library** to add approved events.

### Outputs
- GTM container JSON
- dataLayer implementation spec
- GCLID/UTM capture script
- PII risk assessment
- Enhanced Conversions for Leads guidance

> **Tip:** Use the implementation guide tab for the GCLID capture script and hidden form field HTML.
        `.trim(),
      },
      {
        id: 'feature-journey',
        title: 'Journey Builder',
        keywords: ['journey', 'funnel', 'stages', 'proxy value', 'buyer intent', 'tracking plan', 'gtm container'],
        content: `
## Journey Builder

**Available on:** Free

Maps your customer journey stages and assigns tracking events, producing a GTM container and dataLayer spec.

### How to use
1. Go to **Tracking Plan** → **New journey**.
2. Select your business type — a stage template is pre-populated.
3. For each stage:
   - Set **proxy value (£)** for value-based bidding.
   - Set **buyer intent level** (problem_aware / solution_aware / vendor_aware).
   - Assign tracking events from your Signal Library.
4. Click **Generate spec** to produce the GTM container JSON and dataLayer spec.

### Business types
E-commerce, Lead Gen, B2B SaaS, Marketplace, Nonprofit, **B2B Lead Gen** (7-stage template: Awareness → Closed Won).

> **Tip:** Set realistic proxy values — they feed directly into value-based bidding. Inaccurate values will degrade campaign performance.
        `.trim(),
      },
      {
        id: 'feature-signal-library',
        title: 'Signal Library',
        keywords: ['signals', 'events', 'packs', 'deploy', 'custom signal', 'signal pack', 'library'],
        content: `
## Signal Library

**Available on:** Free

Central registry of tracking events. Browse system signals, create custom signals, and deploy signal packs to clients.

### Signals
Each signal has a **key** (event name), **category**, **required params**, **optional params**, and **platform mappings** (GA4, Google Ads, Meta).

### Signal Packs
Curated bundles of signals for a use case (e.g. "E-commerce Core"). System packs ship with Atlas; you can clone and customise them.

### Deploying signals
1. Open a pack → click **Deploy**.
2. Select the target client.
3. Configure **signal enrichment** (value field, currency, dedup ID) for conversion events.
4. Click **Deploy signals**.
5. From the Client Detail Page, click **Generate outputs** for the GTM container and dataLayer spec.

> **Tip:** Configure enrichment during deployment — it directly affects CAPI match quality and value-based bidding accuracy.
        `.trim(),
      },
      {
        id: 'feature-enrichment',
        title: 'Signal Enrichment',
        keywords: ['enrichment', 'identity', 'match quality', 'emq', 'field mapping', 'value field', 'dedup', 'phone', 'email', 'gclid'],
        content: `
## Signal Enrichment Configuration

**Available on:** Free

Maps your dataLayer field paths to identity and signal parameters to improve CAPI match quality, value-based bidding, and deduplication.

### Enrichment Score (0–100)
- 80–100 Green — all key fields mapped
- 60–79 Amber — some recommended fields missing
- 40–59 Yellow — required fields missing
- 0–39 Red — critical fields missing, CAPI will be degraded

### Identity Configuration (once per client)
Set at **Client Detail → Enrichment tab** or during Client Setup Wizard Step 4.

| Field | Priority |
|---|---|
| \`email_field\` | **Required** |
| \`phone_field\` | **High impact** |
| \`fbc_field\`, \`fbp_field\`, \`gclid_field\` | **High impact** |
| Name, address fields | Best practice |

Use dot notation for field paths: \`user.email\`, \`checkout.customer.phone_number\`.

### Signal Enrichment (per conversion signal)
Set at **Client Detail → Enrichment tab** or during Deployment Wizard Step 2.
- **value_field** — path to event value (e.g. \`ecommerce.value\`)
- **currency** — static (e.g. \`GBP\`) or dynamic field path
- **dedup_id_field** — unique event identifier (e.g. \`transaction_id\`)
- **content_ids_field** — for Meta Advantage+ catalogue campaigns

### Validation rules
12 rules (IDENT_01–05, SIG_01–05, CROSS_01–02). IDENT_01 (email) and SIG_03 (purchase dedup ID) are **errors** — all others are warnings or info.
        `.trim(),
      },
      {
        id: 'feature-consent',
        title: 'Consent Hub',
        keywords: ['consent', 'gdpr', 'cookie', 'cmp', 'onetrust', 'cookiebot', 'usercentrics', 'gcm', 'consent mode'],
        content: `
## Consent Hub

**Available on:** Free

Configures consent state handling across all tracking. Every CAPI event includes consent state — events are blocked automatically if consent is denied.

### CMP integrations
Supports **OneTrust**, **Cookiebot**, and **Usercentrics**. Go to **Consent Hub → Configure CMP integration** and select your provider.

### Google Consent Mode v2
Enable under **Consent Hub → Google Consent Mode v2**. Atlas maps consent categories to Google signals automatically:
- \`ad_storage\` ← marketing consent
- \`analytics_storage\` ← analytics consent
- \`ad_user_data\` / \`ad_personalization\` ← marketing consent

### Consent banner script
Generate the script from **Consent Hub → Generate consent script**. Install in your site \`<head>\` **above** the GTM snippet.

> **Important:** Set marketing and analytics consent to \`denied\` by default for EEA/UK users to comply with GDPR/PECR.
        `.trim(),
      },
      {
        id: 'feature-capi',
        title: 'Conversion API (CAPI)',
        plan: 'pro',
        keywords: ['capi', 'server-side', 'meta', 'google', 'linkedin', 'conversion api', 'enhanced conversions', 'deduplication'],
        content: `
## Conversion API (CAPI)

**Available on:** Pro

Server-side event delivery to Meta, Google Enhanced Conversions, and LinkedIn CAPI. Bypasses ad blockers and browser restrictions.

### Supported platforms
- **Meta CAPI** — Pixel ID + Access Token
- **Google Enhanced Conversions** — Customer ID + Conversion ID + Label
- **LinkedIn CAPI** — Insight Tag ID + Access Token

### How to set up
1. Go to **Conversion API** → **Add provider**.
2. Select platform and complete the setup wizard.
3. Enter credentials, map events, configure deduplication.
4. Click **Activate**, then **Test** to verify delivery.

### Deduplication
For dedup to work, your browser pixel must send an \`event_id\` parameter matching the same field Atlas uses as the dedup key. Configure under the provider's dedup settings.

### CAPI pipeline
All events go through: Consent gate → Dedup check → PII hashing (SHA-256) → Enrich → Format → Deliver → Log → Counters.

> **Tip:** Identity enrichment has the biggest impact on match quality. Map email, phone, and click IDs in Signal Enrichment before activating CAPI.
        `.trim(),
      },
      {
        id: 'feature-offline',
        title: 'Offline Conversions',
        plan: 'pro',
        keywords: ['offline', 'csv', 'gclid', 'upload', 'crm', 'google ads upload', 'click conversions'],
        content: `
## Offline Conversions

**Available on:** Pro

Upload CRM or offline conversion data to Google Ads, closing the loop between ad clicks and offline sales.

### CSV format
Required columns: \`gclid\`, \`conversion_name\`, \`conversion_time\` (ISO 8601).
Optional: \`conversion_value\`, \`currency_code\`, \`email\`, \`phone\`.

### How to upload
1. Go to **Conversion API → Offline Conversions → Upload**.
2. Upload your CSV.
3. Review the Validation Report — fix invalid rows.
4. Click **Confirm upload** to send to Google Ads.

### GCLID capture
Add the GCLID capture script (from AI Site Scan implementation guide) to your site \`<head>\`. Store the GCLID in your CRM at lead capture — include it in your CSV when the lead converts.

> **Important:** Upload within 90 days of the click. GCLIDs expire after 90 days.
        `.trim(),
      },
      {
        id: 'feature-connections',
        title: 'Platform Connections',
        plan: 'pro',
        keywords: ['connections', 'oauth', 'google ads', 'meta', 'ga4', 'gtm', 'mcc', 'manager account'],
        content: `
## Platform Connections

**Available on:** Pro

OAuth connections to Google Ads (incl. MCC), Meta, GA4, and GTM. Powers reconciliation, IHC, and the Data Manager Console.

### Connecting platforms
1. Go to **Platform Connections** → **Add connection**.
2. Select platform and connection type (Manager / Child / Standalone for Google Ads).
3. Click **Connect with OAuth** and authorise Atlas.
4. For Google Ads MCC: click **Discover accounts** to pull child accounts.

### Connection statuses
- **Connected** — token valid, last sync successful
- **Token expired** — click Re-connect to refresh
- **Error** — click Test to diagnose

> **Tip:** Connect the Google Ads MCC once and discover all child accounts, rather than connecting each account individually.
        `.trim(),
      },
      {
        id: 'feature-reconciliation',
        title: 'Platform Reconciliation',
        plan: 'pro',
        keywords: ['reconciliation', 'diff', 'volume', 'config', 'delivery', 'alignment', 'tolerance', 'findings'],
        content: `
## Platform Reconciliation

**Available on:** Pro

Compares your Atlas tracking configuration against live data from connected platforms across four dimensions: Config, Volume, Delivery, Alignment.

### Running a reconciliation
Go to **Reconciliation** → **Run reconciliation**. Select platforms, click **Start run**. Takes 30–60 seconds.

### Dimensions
| Dimension | What it checks |
|---|---|
| **Config** | Conversion actions configured correctly in ad platforms? |
| **Volume** | Event volume in Atlas vs. platform-reported volume |
| **Delivery** | Delivery success rates and error rates |
| **Alignment** | Does live tracking match your locked strategy brief? |

### Tolerance configuration
Go to **Reconciliation → Tolerance settings** to set acceptable variance per event per platform (e.g. ±10%). Findings within tolerance are suppressed automatically.

### Resolving findings
Expand a finding, make the fix in your platform or Atlas config, then click **Mark as resolved**.

> **Tip:** Alignment findings are the most critical — they indicate campaigns may be optimising against the wrong signal.
        `.trim(),
      },
      {
        id: 'feature-ihc',
        title: 'Implementation Health Checks',
        plan: 'pro',
        keywords: ['ihc', 'implementation health', 'gtm', 'baseline', 'drift', 'tag rules', 'alerts'],
        content: `
## Implementation Health Checks (IHC)

**Available on:** Pro

Validates your GTM container against best-practice rules, establishes a baseline, and detects drift when the container changes.

### Connecting your GTM container
Go to **Settings → Implementation Health**:
- **OAuth**: click **Connect with Google** and select your container.
- **Manual upload**: export the container JSON from GTM and upload it.

### Running a health check
Select a GTM connection and click **Run check**. Atlas surfaces findings with severity levels (Critical → Low).

### Baselines
After a clean health check, click **Set as baseline**. Future checks diff against this baseline and flag any changes as drift.

### Alert preferences
Go to **Implementation Health → Alert preferences** to set minimum severity threshold and notification channels (email / Slack webhook).

> **Tip:** Re-baseline after intentional GTM changes — otherwise Atlas will keep flagging the change as drift.
        `.trim(),
      },
      {
        id: 'feature-enricher',
        title: 'Bid Signal Enricher',
        plan: 'pro',
        keywords: ['enricher', 'customer match', 'dma', 'audience', 'match rate', 'first-party data'],
        content: `
## Bid Signal Enricher

**Available on:** Pro (Enricher); Agency (Data Manager Console)

Pushes hashed Customer Match audiences to Google's Data Manager API for value-based bidding and audience targeting.

### Running an enricher job
1. Go to **Bid Signal Enricher** → **New enricher run**.
2. Select ingest type (CSV upload or CRM sync).
3. Select destination Google Ads accounts.
4. Click **Start run**.

Atlas hashes all PII (SHA-256) before transmission — upload raw data.

### Match rate guidance
| Rate | Status |
|---|---|
| > 40% | Good |
| 20–40% | Fair — check identity config |
| < 20% | Poor — review data quality and hashing |

### Data Manager Console (Agency)
Go to **Data Manager** for cross-client view: GTG status, match rates, upload success, members pushed (30d), and actions needed per client.

> **Tip:** Upload both email and phone where available — dual-matched members improve audience confidence.
        `.trim(),
      },
      {
        id: 'feature-signal-tracking',
        title: 'Signal Tracking Dashboard',
        keywords: ['signal tracking', 'event log', 'capi log', 'match quality', 'dedup rate', 'export', 'csv'],
        content: `
## Signal Tracking Dashboard

**Available on:** Free

Live log of every CAPI event Atlas has delivered, with aggregate metrics on volume, match quality, and deduplication.

### Aggregate cards
- **Total events** — delivered in the selected time range
- **Match quality** — average Meta EMQ (0–10) or Google match rate (%)
- **Dedup rate** — percentage of events suppressed as duplicates
- **Delivery latency** — average delivery time in milliseconds

### Event statuses
| Status | Meaning |
|---|---|
| \`delivered\` | Accepted by the ad platform |
| \`delivery_failed\` | Platform API returned an error |
| \`consent_blocked\` | Blocked by consent gate |
| \`dedup_skipped\` | Suppressed as a duplicate |

### Exporting to CSV
Apply filters → click **Export CSV** → wait for the background job to complete → click **Download**.

> **Tip:** Low match quality usually means identity fields aren't mapped. Check Signal Enrichment configuration.
        `.trim(),
      },
      {
        id: 'feature-audit',
        title: 'Audit Engine',
        keywords: ['audit', 'gap report', 'journey audit', 'headless', 'pdf report', 'score', 'missing events'],
        content: `
## Audit Engine

**Available on:** Free (manual); Pro (scheduled)

Simulates real user journeys using a headless browser, compares what tracking fired against your journey spec, and produces a scored gap report.

### Running an audit
Go to **Audit Engine** → **Run audit**. Select the journey, confirm page URLs, click **Start audit**. Takes 2–5 minutes for a 5-stage journey.

### Scheduled audits (Pro)
Go to **Audit Engine → Schedules** to configure daily, weekly, or monthly runs with email notification.

### Finding types
- **Missing** — event in spec but not captured
- **Wrong parameters** — event fired but parameters incorrect
- **Extra** — event fired but not in spec
- **Correct** — event matches spec

### PDF export
Click **Export PDF** from any report for a presentation-ready brief with executive summary, stage breakdown, and recommended next actions.

> **Tip:** The Gap Report filtered view shows only Missing and Wrong parameter findings — the most actionable remediation list for your developer.
        `.trim(),
      },
      {
        id: 'feature-health',
        title: 'Health Dashboard',
        keywords: ['health', 'score', 'alerts', 'trend', 'platform acceptance', 'gtg', 'dma coverage'],
        content: `
## Health Dashboard

**Available on:** Free

Single-number health score for your tracking infrastructure, an alert feed, and historical score trends.

### Health score components
| Component | Measures |
|---|---|
| Platform acceptance | Ad platform accepting CAPI events without errors |
| GTG active | Google Tag Gateway deployed and responding |
| DMA coverage | Customer Match audience coverage |
| Audit score | Journey tracking completeness |
| Enrichment score | CAPI identity and signal field mapping quality |

### Score ranges
- 80–100 Healthy | 60–79 Good | 40–59 Fair | 0–39 Poor (immediate action required)

### Alert feed
Active issues ranked by severity with recommended actions. Alerts clear automatically when the underlying issue is resolved.

> **Tip:** Check the Health Dashboard after every GTM publish or site deployment — tracking regressions are often silent.
        `.trim(),
      },
      {
        id: 'feature-channels',
        title: 'Channel Insights',
        keywords: ['channel', 'paid', 'organic', 'attribution', 'utm', 'channel health', 'diagnostics'],
        content: `
## Channel Insights

**Available on:** Free

Maps signal behaviour per traffic channel, showing how tracking quality and conversion signals differ across paid, organic, direct, email, and referral traffic.

### Viewing insights
Go to **Channel Insights**. The main table shows per channel:
- Sessions, events fired, conversion rate, signal health score, diagnostic status.

Click a channel to see event breakdown, journey map, and specific diagnostics.

### Common diagnostic findings
- Missing UTM parameters — attribution will be inaccurate
- GCLID not captured — Enhanced Conversions will be degraded
- Low conversion signal rate — funnel drop-off or tracking gap
- High consent block rate — expected for EEA users with opted-out consent

> **Tip:** Inconsistent UTM tagging (e.g. \`utm_source=google\` vs \`utm_source=Google_Ads\`) splits what should be one channel into multiple entries.
        `.trim(),
      },
      {
        id: 'feature-dqm',
        title: 'Data Quality Monitoring',
        plan: 'pro',
        keywords: ['dqm', 'gtg', 'tag gateway', 'dma', 'poll state', 'latency', 'health probes'],
        content: `
## Data Quality Monitoring (DQM)

**Available on:** Pro

Probes your Google Tag Gateway (GTG) path health and tracks DMA poll state, providing early warning of infrastructure failures.

### GTG path health
Atlas probes your GTG endpoint periodically and records HTTP status and latency. Statuses: Healthy (200) / Degraded (slow) / Error (4xx/5xx) / Down (timeout).

### DMA poll state
After each enricher run, Atlas checks DMA API state and records upload success rate, match rate, members pushed (30d), and destination count.

If repeated failures occur, Atlas enters a **backoff state** — automatic retries pause until the backoff period expires. Check error categories to diagnose root cause (usually: expired OAuth token, invalid account, or API quota exceeded).

> **Tip:** GTG down doesn't stop tracking — standard GTM continues. GTG enhances signal quality; its absence degrades quality, not delivery.
        `.trim(),
      },
      {
        id: 'feature-taxonomy',
        title: 'Event Taxonomy',
        keywords: ['taxonomy', 'event tree', 'platform mappings', 'ga4', 'standard events', 'categories'],
        content: `
## Event Taxonomy

**Available on:** Free

Structured tree of all tracking event types with platform mappings to GA4, Google Ads, and Meta naming conventions.

### Browsing
Go to **Tag Library → Taxonomy**. Expand categories (E-commerce, Lead Generation, Engagement, etc.) to browse events. Click an event to see platform mappings and recommended parameters.

### Adding custom events
1. Click **Add event**.
2. Enter name, slug (snake_case), category, description, and platform mappings.
3. Click **Save**.

Custom events appear in the taxonomy tree and are available when building signals.

### System vs custom events
- **System events** — pre-built, validated platform mappings, cannot be edited.
- **Custom events** — org-specific, you maintain the platform mappings.

> **Tip:** Signals referencing a taxonomy event inherit its platform mappings automatically. Updating a taxonomy event's mapping updates all referencing signals.
        `.trim(),
      },
      {
        id: 'feature-naming',
        title: 'Naming Conventions',
        keywords: ['naming', 'convention', 'snake_case', 'camelcase', 'prefix', 'rename', 'validation'],
        content: `
## Naming Conventions

**Available on:** Free

Org-level rules for event and parameter naming. New signals are validated in real time, and you can preview which existing signals would be renamed before applying changes.

### Configuring
Go to **Team & Settings → Naming Conventions**:
- Set **format**: \`snake_case\`, \`camelCase\`, \`PascalCase\`, \`kebab-case\`
- Set optional **prefix** (e.g. \`atlas_\`)
- Set **max length**
- Click **Save**

### Rename preview
Before saving a change, click **Preview renames** to see which existing signals would be affected. Click **Save and apply** to commit.

> **Note:** Applying renames updates signal keys in your library but does not automatically update deployed GTM containers — update those separately.

### Best practices
- Use \`snake_case\` to align with GA4 and Meta event naming.
- Keep event names short and verb-based: \`purchase\`, \`generate_lead\`, \`sign_up\`.
- Set conventions *before* building your signal library — renaming after deployment is expensive.
        `.trim(),
      },
    ],
  },
];

// ── Plan badge ────────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: 'pro' | 'agency' }) {
  const cls =
    plan === 'agency'
      ? 'bg-purple-100 text-purple-700 border border-purple-200'
      : 'bg-blue-100 text-blue-700 border border-blue-200';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {plan === 'agency' ? 'Agency' : 'Pro'}
    </span>
  );
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────

function renderContent(raw: string) {
  const lines = raw.split('\n');
  const elements: ReactElement[] = [];
  let tableRows: string[][] = [];
  let inTable = false;
  let key = 0;

  function flushTable() {
    if (tableRows.length < 2) { tableRows = []; inTable = false; return; }
    const [header, , ...body] = tableRows;
    elements.push(
      <div key={key++} className="overflow-x-auto my-4">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              {header.map((h, i) => (
                <th key={i} className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-700">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="even:bg-gray-50">
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-gray-200 px-3 py-2 text-gray-600">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = []; inTable = false;
  }

  function parseInline(text: string): ReactElement[] {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="bg-gray-100 text-gray-800 text-xs px-1.5 py-0.5 rounded font-mono">{part.slice(1, -1)}</code>;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      return part;
    });
  }

  for (const line of lines) {
    if (line.startsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!cells.every(c => /^[-: ]+$/.test(c))) tableRows.push(cells);
      continue;
    }
    if (inTable) flushTable();

    if (!line.trim()) { elements.push(<div key={key++} className="h-2" />); continue; }
    if (line.startsWith('### ')) { elements.push(<h3 key={key++} className="text-base font-semibold text-gray-800 mt-5 mb-2">{line.slice(4)}</h3>); continue; }
    if (line.startsWith('## ')) { elements.push(<h2 key={key++} className="text-lg font-bold text-gray-900 mt-6 mb-3 pb-1 border-b border-gray-200">{line.slice(3)}</h2>); continue; }
    if (line.startsWith('> ')) { elements.push(<blockquote key={key++} className="border-l-4 border-blue-400 pl-4 py-1 my-3 bg-blue-50 text-blue-800 text-sm rounded-r">{parseInline(line.slice(2))}</blockquote>); continue; }
    if (line.startsWith('- ')) { elements.push(<li key={key++} className="ml-4 list-disc text-gray-700 text-sm leading-relaxed">{parseInline(line.slice(2))}</li>); continue; }
    if (/^\d+\. /.test(line)) { elements.push(<li key={key++} className="ml-4 list-decimal text-gray-700 text-sm leading-relaxed">{parseInline(line.replace(/^\d+\. /, ''))}</li>); continue; }
    elements.push(<p key={key++} className="text-gray-700 text-sm leading-relaxed">{parseInline(line)}</p>);
  }
  if (inTable) flushTable();
  return elements;
}

// ── Main page ─────────────────────────────────────────────────────────────────

function HelpPageInner() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string>('account-setup');

  const allSections = useMemo(() => GROUPS.flatMap(g => g.sections), []);

  const filteredGroups = useMemo(() => {
    if (!query.trim()) return GROUPS;
    const q = query.toLowerCase();
    return GROUPS.map((g: HelpGroup) => ({
      ...g,
      sections: g.sections.filter(
        (s: HelpSection) =>
          s.title.toLowerCase().includes(q) ||
          s.keywords.some(k => k.includes(q)) ||
          s.content.toLowerCase().includes(q),
      ),
    })).filter(g => g.sections.length > 0);
  }, [query]);

  const activeSection = allSections.find((s: HelpSection) => s.id === activeId) ?? allSections[0];

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search help..."
              value={query}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {filteredGroups.map((group: HelpGroup) => (
            <div key={group.label}>
              <div className="flex items-center gap-2 px-2 mb-1">
                <group.icon className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group.label}</span>
              </div>
              <div className="space-y-0.5">
                {group.sections.map((section: HelpSection) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveId(section.id)}
                    className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      activeId === section.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="truncate">{section.title}</span>
                    {section.plan && <PlanBadge plan={section.plan} />}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {filteredGroups.length === 0 && (
            <p className="text-sm text-gray-400 px-2 py-4 text-center">No results for "{query}"</p>
          )}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <a
            href="https://github.com/Vikramj01/AtlasV2/blob/main/docs/manual/index.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View full docs on GitHub
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-6">
            <span>Help</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-gray-600">{activeSection?.title}</span>
            {activeSection?.plan && <PlanBadge plan={activeSection.plan} />}
          </div>

          <div className="prose-sm">
            {activeSection ? renderContent(activeSection.content) : (
              <p className="text-gray-400">Select a topic from the sidebar.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export function HelpPage() {
  return (
    <SectionErrorBoundary label="Help">
      <HelpPageInner />
    </SectionErrorBoundary>
  );
}
