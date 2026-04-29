# PRD: Crawl Signal Extractor
**Atlas — Signal Intelligence Platform**
**Module:** Crawl Signal Extractor (CSE)
**Status:** Draft v1.0
**Author:** Vikram Jayaram / Spi3l LLC
**Date:** April 2026
**Build sequence:** Highest priority unbuilt module. Build before Data Quality Monitor and Auto-insight Reporter.
**Claude Code target:** This document is the primary build brief. Read every section before writing any code.

---

## 1. Overview

The Crawl Signal Extractor (CSE) is the onboarding engine and scheduled scan runner for Atlas. It is the module that physically visits customer pages using Browserbase/Playwright, detects marketing signals (tags, events, pixels, CAPI calls), and writes the results into the Signal Library. Without it, the Signal Library is empty, Journey Builder has no signal map to work from, and the Data Quality Monitor has no baseline to compare against.

Every other intelligence module in Atlas is downstream of this one.

The CSE runs in two modes:

- **Onboarding mode** — triggered once when a new org completes setup. Crawls all ad-destination URLs and conversion funnel pages. Populates the Signal Library with an initial baseline. This is the first meaningful thing a customer sees after connecting their ad accounts.
- **Scheduled mode** — runs on the cadence defined by the org's subscription tier (weekly for Monitor, daily for Management, Operations, and agency tiers). Compares results against the previous baseline. Writes delta records that the Data Quality Monitor uses for regression detection.

---

## 2. Tech Stack (use these exactly — do not deviate)

| Layer | Technology |
|---|---|
| Frontend | Vite + React 19 + React Router v6 |
| Backend | Express.js — `backend/src/` |
| Queue | Bull (Redis-backed) — `backend/src/services/queue/` |
| Browser automation | Browserbase + Playwright |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth — JWT as Bearer token to Express |
| UI components | shadcn/ui |
| Hosting | Vercel (frontend), Render (backend) |

**CLAUDE.md note:** An older CLAUDE.md in the repo may say Next.js App Router. This is incorrect — the production codebase is Vite + React Router + Express. Always follow the actual file structure, not the CLAUDE.md description.

---

## 3. File Structure to Create

```
backend/src/
  api/routes/
    crawl.ts                        ← Express router (new)
  services/
    crawl/
      crawlJob.ts                   ← Bull job definition and processor (new)
      pageDiscovery.ts              ← Page URL discovery logic (new)
      signalDetector.ts             ← Playwright signal detection logic (new)
      signalWriter.ts               ← Writes detected signals to Supabase (new)
      crawlHelpers.ts               ← Shared utilities (new)
    queue/
      worker.ts                     ← Add crawl job registration (modify existing)
  types/
    crawl.ts                        ← All crawl-related TypeScript types (new)

frontend/src/
  pages/
    CrawlStatusPage.tsx             ← Onboarding crawl progress UI (new)
  components/
    crawl/
      CrawlProgress.tsx             ← Progress indicator component (new)
      CrawlResults.tsx              ← Results summary component (new)
  lib/api/
    crawlApi.ts                     ← API client for crawl endpoints (new)
  store/
    crawlStore.ts                   ← Zustand store for crawl state (new)
  types/
    crawl.ts                        ← Frontend crawl types (new)

db/migrations/
  005_crawl_signal_extractor.sql    ← All new tables for this module (new)
```

### Patterns to follow

Before writing any file, read the equivalent existing file for the pattern:

| New file | Follow pattern from |
|---|---|
| `backend/src/api/routes/crawl.ts` | `backend/src/api/routes/health.ts` |
| `backend/src/services/crawl/crawlJob.ts` | `backend/src/services/queue/worker.ts` |
| `frontend/src/lib/api/crawlApi.ts` | `frontend/src/lib/api/healthApi.ts` |
| `frontend/src/store/crawlStore.ts` | `frontend/src/store/auditStore.ts` |
| `frontend/src/pages/CrawlStatusPage.tsx` | `frontend/src/pages/HealthDashboardPage.tsx` |
| `db/migrations/005_crawl_signal_extractor.sql` | `db/migrations/001_create_audit_tables.sql` |

---

## 4. Database Schema

All tables created in `db/migrations/005_crawl_signal_extractor.sql`.

### 4.1 `crawl_runs` — one record per scan execution

```sql
CREATE TABLE crawl_runs (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  mode                text          NOT NULL CHECK (mode IN ('onboarding', 'scheduled')),
  status              text          NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  triggered_by        text          NOT NULL CHECK (triggered_by IN ('system', 'manual', 'onboarding')),

  -- Page scope
  total_pages         integer       NOT NULL DEFAULT 0,
  pages_completed     integer       NOT NULL DEFAULT 0,
  pages_failed        integer       NOT NULL DEFAULT 0,

  -- Browserbase tracking
  browserbase_session_id  text      NULL,   -- session ID for reconciliation
  browser_minutes_used    numeric(8,4) NULL, -- actual duration logged

  -- Timing
  started_at          timestamptz   NULL,
  completed_at        timestamptz   NULL,
  duration_seconds    integer       GENERATED ALWAYS AS (
                        EXTRACT(EPOCH FROM (completed_at - started_at))::integer
                      ) STORED,

  -- Error capture
  error_message       text          NULL,
  error_detail        jsonb         NULL,

  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_runs_org_id     ON crawl_runs (org_id);
CREATE INDEX idx_crawl_runs_status     ON crawl_runs (status);
CREATE INDEX idx_crawl_runs_created_at ON crawl_runs (created_at DESC);
```

### 4.2 `crawl_pages` — one record per page per crawl run

```sql
CREATE TABLE crawl_pages (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  crawl_run_id        uuid          NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  url                 text          NOT NULL,
  url_type            text          NOT NULL CHECK (url_type IN (
                        'ad_destination',       -- pulled from Google Ads / Meta
                        'conversion_funnel',    -- auto-detected checkout/signup/thank-you
                        'manual'                -- customer-added
                      )),
  domain              text          NOT NULL,   -- extracted hostname

  -- Scan result
  status              text          NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'scanning', 'completed', 'failed', 'skipped')),
  http_status         integer       NULL,       -- page response code
  scan_duration_ms    integer       NULL,

  -- Signal summary (denormalised for quick reads)
  signals_found       integer       NOT NULL DEFAULT 0,
  signals_healthy     integer       NOT NULL DEFAULT 0,
  signals_degraded    integer       NOT NULL DEFAULT 0,
  signals_missing     integer       NOT NULL DEFAULT 0,

  error_message       text          NULL,
  scanned_at          timestamptz   NULL,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_pages_crawl_run_id ON crawl_pages (crawl_run_id);
CREATE INDEX idx_crawl_pages_org_id       ON crawl_pages (org_id);
CREATE INDEX idx_crawl_pages_domain       ON crawl_pages (domain);
```

### 4.3 `detected_signals` — one record per signal per page per run

```sql
CREATE TABLE detected_signals (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  crawl_page_id       uuid          NOT NULL REFERENCES crawl_pages(id) ON DELETE CASCADE,
  crawl_run_id        uuid          NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  -- Signal identity
  signal_type         text          NOT NULL CHECK (signal_type IN (
                        'gtm_container',
                        'ga4_base',
                        'ga4_event',
                        'meta_pixel',
                        'meta_capi',
                        'google_ads_conversion',
                        'google_ads_remarketing',
                        'tiktok_pixel',
                        'linkedin_insight',
                        'snapchat_pixel',
                        'custom_event'
                      )),
  signal_name         text          NULL,       -- e.g. 'purchase', 'add_to_cart'
  signal_id           text          NULL,       -- e.g. GTM-XXXXX, G-XXXXX, pixel ID

  -- Health assessment
  health_status       text          NOT NULL CHECK (health_status IN (
                        'healthy',
                        'degraded',
                        'missing',
                        'duplicate',
                        'misconfigured'
                      )),
  health_score        integer       NOT NULL CHECK (health_score BETWEEN 0 AND 100),

  -- Detection detail
  detected_at         text          NULL CHECK (detected_at IN (
                        'page_load', 'dom_ready', 'interaction', 'network'
                      )),
  firing_triggers     jsonb         NULL,       -- what triggered the event
  parameters          jsonb         NULL,       -- full event parameters captured
  issues              jsonb         NULL,       -- array of issue objects {code, severity, message}

  -- Baseline tracking (for scheduled mode delta detection)
  first_seen_run_id   uuid          NULL REFERENCES crawl_runs(id),
  is_regression       boolean       NOT NULL DEFAULT false,  -- true if not in previous run

  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_detected_signals_crawl_run_id  ON detected_signals (crawl_run_id);
CREATE INDEX idx_detected_signals_org_id        ON detected_signals (org_id);
CREATE INDEX idx_detected_signals_signal_type   ON detected_signals (signal_type);
CREATE INDEX idx_detected_signals_health_status ON detected_signals (health_status);
```

### 4.4 `org_page_scope` — the customer's configured page list

```sql
CREATE TABLE org_page_scope (
  id                  uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              uuid          NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  url                 text          NOT NULL,
  url_type            text          NOT NULL CHECK (url_type IN (
                        'ad_destination', 'conversion_funnel', 'manual'
                      )),
  domain              text          NOT NULL,
  source              text          NULL,       -- 'google_ads', 'meta_ads', 'auto_detected', 'manual'
  is_active           boolean       NOT NULL DEFAULT true,
  priority            integer       NOT NULL DEFAULT 0,   -- higher = scanned first
  added_at            timestamptz   NOT NULL DEFAULT now(),
  last_crawled_at     timestamptz   NULL,

  -- Uniqueness: one active record per org + URL
  UNIQUE (org_id, url)
);

CREATE INDEX idx_org_page_scope_org_id    ON org_page_scope (org_id);
CREATE INDEX idx_org_page_scope_is_active ON org_page_scope (is_active) WHERE is_active = true;
```

---

## 5. TypeScript Types

### `backend/src/types/crawl.ts`

```typescript
export type CrawlMode = 'onboarding' | 'scheduled';
export type CrawlStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type UrlType = 'ad_destination' | 'conversion_funnel' | 'manual';
export type SignalType =
  | 'gtm_container'
  | 'ga4_base'
  | 'ga4_event'
  | 'meta_pixel'
  | 'meta_capi'
  | 'google_ads_conversion'
  | 'google_ads_remarketing'
  | 'tiktok_pixel'
  | 'linkedin_insight'
  | 'snapchat_pixel'
  | 'custom_event';

export type SignalHealthStatus = 'healthy' | 'degraded' | 'missing' | 'duplicate' | 'misconfigured';

export interface CrawlJobData {
  org_id: string;
  crawl_run_id: string;
  mode: CrawlMode;
  pages: PageToScan[];
  tier: string;
}

export interface PageToScan {
  id: string;          // org_page_scope.id
  url: string;
  url_type: UrlType;
  domain: string;
  priority: number;
}

export interface DetectedSignal {
  signal_type: SignalType;
  signal_name: string | null;
  signal_id: string | null;
  health_status: SignalHealthStatus;
  health_score: number;
  detected_at: 'page_load' | 'dom_ready' | 'interaction' | 'network' | null;
  firing_triggers: Record<string, unknown> | null;
  parameters: Record<string, unknown> | null;
  issues: SignalIssue[];
}

export interface SignalIssue {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface CrawlRunSummary {
  crawl_run_id: string;
  org_id: string;
  mode: CrawlMode;
  status: CrawlStatus;
  total_pages: number;
  pages_completed: number;
  pages_failed: number;
  signals_found: number;
  signals_healthy: number;
  signals_degraded: number;
  started_at: string | null;
  completed_at: string | null;
}
```

---

## 6. Page Discovery Logic

### `backend/src/services/crawl/pageDiscovery.ts`

Page discovery runs before the crawl job is queued. It assembles the list of URLs to scan for an org based on three sources, applied in priority order:

```typescript
import { supabase } from '../database/supabaseClient';
import { PageToScan, UrlType } from '../../types/crawl';
import { ATLAS_PRICING } from '../../config/pricing';

/**
 * Assembles the page scope for an org crawl.
 * Respects the tier page cap and domain limits.
 * Priority: ad_destination > conversion_funnel > manual
 */
export async function discoverPages(
  org_id: string,
  tier: string,
): Promise<PageToScan[]> {
  const config = ATLAS_PRICING[tier as keyof typeof ATLAS_PRICING];
  const pageCap = config.page_cap_per_domain;
  const domainLimit = config.type === 'direct' ? config.domains : 999;

  // Pull active page scope for this org
  const { data: scopePages } = await supabase
    .from('org_page_scope')
    .select('id, url, url_type, domain, priority')
    .eq('org_id', org_id)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (!scopePages?.length) return [];

  // Group by domain and apply page cap per domain
  const byDomain = new Map<string, PageToScan[]>();

  for (const page of scopePages) {
    const existing = byDomain.get(page.domain) ?? [];
    if (existing.length < pageCap) {
      existing.push({
        id:       page.id,
        url:      page.url,
        url_type: page.url_type as UrlType,
        domain:   page.domain,
        priority: page.priority,
      });
      byDomain.set(page.domain, existing);
    }
  }

  // Apply domain limit and flatten
  const domains = Array.from(byDomain.keys()).slice(0, domainLimit);
  return domains.flatMap(d => byDomain.get(d) ?? []);
}

/**
 * Auto-detects conversion funnel pages from a domain
 * by checking common URL patterns.
 * Called during onboarding before the first crawl.
 */
export async function detectFunnelPages(
  domain: string,
  org_id: string,
): Promise<string[]> {
  const funnelPatterns = [
    /\/signup/i, /\/register/i, /\/join/i,
    /\/login/i, /\/signin/i,
    /\/cart/i, /\/basket/i,
    /\/checkout/i,
    /\/thank[-_]?you/i, /\/order[-_]?confirmation/i, /\/success/i,
    /\/pricing/i, /\/plans/i,
    /\/demo/i, /\/trial/i,
  ];

  // Check existing crawled pages for this domain to find funnel URLs
  const { data: existingPages } = await supabase
    .from('org_page_scope')
    .select('url')
    .eq('org_id', org_id)
    .eq('domain', domain);

  const detected: string[] = [];

  for (const page of existingPages ?? []) {
    if (funnelPatterns.some(p => p.test(page.url))) {
      detected.push(page.url);
    }
  }

  return detected;
}

/**
 * Seeds org_page_scope from connected ad accounts.
 * Called during onboarding after ad account connection.
 * In this phase: accepts a manually provided URL list.
 * Future phase: pulls live from Google Ads and Meta APIs.
 */
export async function seedPageScopeFromAdUrls(
  org_id: string,
  urls: string[],
  source: 'google_ads' | 'meta_ads' | 'manual',
): Promise<void> {
  const rows = urls.map((url, index) => ({
    org_id,
    url,
    domain:   new URL(url).hostname,
    url_type: 'ad_destination' as UrlType,
    source,
    priority: urls.length - index,   // earlier = higher priority
  }));

  await supabase
    .from('org_page_scope')
    .upsert(rows, { onConflict: 'org_id,url', ignoreDuplicates: true });
}
```

---

## 7. Signal Detection Logic

### `backend/src/services/crawl/signalDetector.ts`

This is the core Playwright script that runs inside each Browserbase session. It intercepts network requests and inspects the DOM to detect marketing signals.

**Critical architecture decision: one Browserbase session scans multiple pages sequentially.** Do not open a new session per page — Browserbase bills a minimum of 1 minute per session. Batching pages into one session dramatically reduces cost.

```typescript
import { chromium } from 'playwright';
import { Browserbase } from '@browserbasehq/sdk';
import { DetectedSignal, PageToScan, SignalIssue } from '../../types/crawl';

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

interface ScanBatchResult {
  browserbase_session_id: string;
  browser_minutes_used: number;
  page_results: PageScanResult[];
}

interface PageScanResult {
  page_id: string;
  url: string;
  http_status: number | null;
  scan_duration_ms: number;
  signals: DetectedSignal[];
  error?: string;
}

/**
 * Scans a batch of pages in a single Browserbase session.
 * IMPORTANT: All pages in the batch are scanned sequentially
 * in the same browser session to minimise browser-minute billing.
 */
export async function scanPageBatch(
  pages: PageToScan[],
  org_id: string,
  crawl_run_id: string,
): Promise<ScanBatchResult> {
  const sessionStart = Date.now();

  // Create ONE Browserbase session for the entire batch
  // Tag with org metadata for reconciliation
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    userMetadata: {
      org_id,
      crawl_run_id,
      batch_size: pages.length.toString(),
      page_ids:   pages.map(p => p.id).join(','),
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = await browser.newContext();
  const page_results: PageScanResult[] = [];

  try {
    for (const targetPage of pages) {
      const pageStart = Date.now();
      const browserPage = await context.newPage();

      // Collect network requests to detect CAPI calls and pixel fires
      const networkRequests: { url: string; postData: string | null }[] = [];
      browserPage.on('request', req => {
        networkRequests.push({
          url:      req.url(),
          postData: req.postData(),
        });
      });

      let httpStatus: number | null = null;

      try {
        const response = await browserPage.goto(targetPage.url, {
          waitUntil: 'networkidle',
          timeout:   30_000,
        });
        httpStatus = response?.status() ?? null;

        // Wait for any late-firing tags
        await browserPage.waitForTimeout(2000);

        // Detect signals from DOM + network
        const signals = await detectSignalsOnPage(browserPage, networkRequests);

        page_results.push({
          page_id:         targetPage.id,
          url:             targetPage.url,
          http_status:     httpStatus,
          scan_duration_ms: Date.now() - pageStart,
          signals,
        });
      } catch (err) {
        page_results.push({
          page_id:         targetPage.id,
          url:             targetPage.url,
          http_status:     httpStatus,
          scan_duration_ms: Date.now() - pageStart,
          signals:         [],
          error:           err instanceof Error ? err.message : String(err),
        });
      } finally {
        await browserPage.close();
        // Clear network requests for next page in batch
        networkRequests.length = 0;
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const totalSeconds = (Date.now() - sessionStart) / 1000;
  const browserMinutes = Math.max(totalSeconds / 60, 1); // min 1 minute (Browserbase billing)

  return {
    browserbase_session_id: session.id,
    browser_minutes_used:   browserMinutes,
    page_results,
  };
}

/**
 * Signal detection logic — runs inside Playwright page context.
 * Checks DOM and network requests for marketing signals.
 */
async function detectSignalsOnPage(
  page: import('playwright').Page,
  networkRequests: { url: string; postData: string | null }[],
): Promise<DetectedSignal[]> {
  const signals: DetectedSignal[] = [];

  // ── GTM Container detection ──────────────────────────────────────────
  const gtmIds = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    return scripts
      .map(s => s.getAttribute('src') || '')
      .filter(src => src.includes('googletagmanager.com/gtm.js'))
      .map(src => new URL(src).searchParams.get('id'))
      .filter(Boolean) as string[];
  });

  for (const gtmId of gtmIds) {
    signals.push({
      signal_type:    'gtm_container',
      signal_name:    null,
      signal_id:      gtmId,
      health_status:  'healthy',
      health_score:   100,
      detected_at:    'page_load',
      firing_triggers: null,
      parameters:     { container_id: gtmId },
      issues:         [],
    });
  }

  // ── GA4 detection ────────────────────────────────────────────────────
  const ga4Hits = networkRequests.filter(r =>
    r.url.includes('google-analytics.com/g/collect') ||
    r.url.includes('analytics.google.com/g/collect')
  );

  if (ga4Hits.length > 0) {
    const measurementIds = [...new Set(
      ga4Hits.map(r => new URL(r.url).searchParams.get('tid')).filter(Boolean)
    )];

    // Check for duplicate firing
    const issues: SignalIssue[] = [];
    if (ga4Hits.length > measurementIds.length * 2) {
      issues.push({
        code:     'GA4_DUPLICATE_FIRE',
        severity: 'warning',
        message:  `GA4 fired ${ga4Hits.length} times — possible duplicate tag.`,
      });
    }

    signals.push({
      signal_type:    'ga4_base',
      signal_name:    'page_view',
      signal_id:      measurementIds[0] ?? null,
      health_status:  issues.length > 0 ? 'degraded' : 'healthy',
      health_score:   issues.length > 0 ? 70 : 100,
      detected_at:    'page_load',
      firing_triggers: null,
      parameters:     { measurement_ids: measurementIds, hit_count: ga4Hits.length },
      issues,
    });
  }

  // ── Meta Pixel detection ─────────────────────────────────────────────
  const metaPixelHits = networkRequests.filter(r =>
    r.url.includes('facebook.com/tr') ||
    r.url.includes('connect.facebook.net')
  );

  if (metaPixelHits.length > 0) {
    const pixelIds = [...new Set(
      metaPixelHits
        .map(r => new URL(r.url).searchParams.get('id'))
        .filter(Boolean)
    )];

    const issues: SignalIssue[] = [];

    // Check for missing event_id (needed for CAPI deduplication)
    const missingEventId = metaPixelHits.some(r =>
      !new URL(r.url).searchParams.has('eid')
    );
    if (missingEventId) {
      issues.push({
        code:     'META_MISSING_EVENT_ID',
        severity: 'critical',
        message:  'Meta Pixel firing without event_id — CAPI deduplication will fail.',
      });
    }

    signals.push({
      signal_type:    'meta_pixel',
      signal_name:    null,
      signal_id:      pixelIds[0] ?? null,
      health_status:  issues.some(i => i.severity === 'critical') ? 'misconfigured' : 'healthy',
      health_score:   issues.some(i => i.severity === 'critical') ? 40 : 100,
      detected_at:    'page_load',
      firing_triggers: null,
      parameters:     { pixel_ids: pixelIds },
      issues,
    });
  }

  // ── Google Ads Conversion detection ──────────────────────────────────
  const gadsHits = networkRequests.filter(r =>
    r.url.includes('googleadservices.com/pagead/conversion') ||
    r.url.includes('google.com/pagead/conversion')
  );

  if (gadsHits.length > 0) {
    signals.push({
      signal_type:    'google_ads_conversion',
      signal_name:    null,
      signal_id:      null,
      health_status:  'healthy',
      health_score:   90,
      detected_at:    'page_load',
      firing_triggers: null,
      parameters:     { hit_count: gadsHits.length },
      issues:         [],
    });
  }

  // ── TikTok Pixel detection ───────────────────────────────────────────
  const tiktokHits = networkRequests.filter(r =>
    r.url.includes('analytics.tiktok.com')
  );
  if (tiktokHits.length > 0) {
    signals.push({
      signal_type:    'tiktok_pixel',
      signal_name:    null,
      signal_id:      null,
      health_status:  'healthy',
      health_score:   90,
      detected_at:    'page_load',
      firing_triggers: null,
      parameters:     { hit_count: tiktokHits.length },
      issues:         [],
    });
  }

  // ── LinkedIn Insight Tag detection ───────────────────────────────────
  const linkedinHits = networkRequests.filter(r =>
    r.url.includes('snap.licdn.com') || r.url.includes('linkedin.com/px')
  );
  if (linkedinHits.length > 0) {
    signals.push({
      signal_type:    'linkedin_insight',
      signal_name:    null,
      signal_id:      null,
      health_status:  'healthy',
      health_score:   90,
      detected_at:    'page_load',
      firing_triggers: null,
      parameters:     { hit_count: linkedinHits.length },
      issues:         [],
    });
  }

  return signals;
}
```

---

## 8. Bull Job Definition

### `backend/src/services/crawl/crawlJob.ts`

```typescript
import Queue from 'bull';
import { supabase } from '../database/supabaseClient';
import { scanPageBatch } from './signalDetector';
import { writeSignalsToLibrary } from './signalWriter';
import { logUsage } from '../../lib/usageLogger';
import { CrawlJobData } from '../../types/crawl';

// Batch size: how many pages to scan per Browserbase session
// Balance between session length and cost — 10-15 pages per session is optimal
const PAGES_PER_SESSION = 12;

export const crawlQueue = new Queue<CrawlJobData>('crawl', {
  redis: process.env.UPSTASH_REDIS_URL!,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail:     50,
  },
});

crawlQueue.process(async (job) => {
  const { org_id, crawl_run_id, mode, pages, tier } = job.data;

  // Mark run as started
  await supabase
    .from('crawl_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', crawl_run_id);

  // Update job progress
  await job.progress(5);

  // Split pages into batches for session efficiency
  const batches = chunkArray(pages, PAGES_PER_SESSION);
  let totalBrowserMinutes = 0;
  let completedPages = 0;
  let failedPages = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      const batchResult = await scanPageBatch(batch, org_id, crawl_run_id);
      totalBrowserMinutes += batchResult.browser_minutes_used;

      // Write page results and signals to Supabase
      for (const pageResult of batchResult.page_results) {
        if (pageResult.error) {
          failedPages++;
          await supabase.from('crawl_pages').update({
            status:          'failed',
            error_message:   pageResult.error,
            scan_duration_ms: pageResult.scan_duration_ms,
            scanned_at:      new Date().toISOString(),
          }).eq('id', pageResult.page_id);
        } else {
          completedPages++;
          await writeSignalsToLibrary({
            org_id,
            crawl_run_id,
            page_id:   pageResult.page_id,
            signals:   pageResult.signals,
            http_status: pageResult.http_status,
            scan_duration_ms: pageResult.scan_duration_ms,
          });
        }
      }

      // Log Browserbase usage — non-blocking
      logUsage({
        org_id,
        event_type:             'page_scan',
        browser_minutes:        batchResult.browser_minutes_used,
        pages_scanned:          batch.length,
        job_id:                 job.id?.toString(),
        scan_run_id:            crawl_run_id,
        browserbase_session_id: batchResult.browserbase_session_id,
      });

      // Update crawl_run with session ID from first batch
      if (i === 0) {
        await supabase.from('crawl_runs').update({
          browserbase_session_id: batchResult.browserbase_session_id,
        }).eq('id', crawl_run_id);
      }

      // Update progress
      const progress = Math.round(5 + ((i + 1) / batches.length) * 90);
      await job.progress(progress);

    } catch (batchError) {
      failedPages += batch.length;
      console.error(`[crawlJob] Batch ${i + 1} failed for org ${org_id}:`, batchError);
    }
  }

  // Determine final status
  const status = failedPages === 0
    ? 'completed'
    : completedPages === 0
      ? 'failed'
      : 'partial';

  // Finalise the crawl run
  await supabase.from('crawl_runs').update({
    status,
    pages_completed:      completedPages,
    pages_failed:         failedPages,
    browser_minutes_used: totalBrowserMinutes,
    completed_at:         new Date().toISOString(),
  }).eq('id', crawl_run_id);

  await job.progress(100);

  return { status, completedPages, failedPages };
});

// Helper
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
```

### Register in `backend/src/services/queue/worker.ts`

Add to the existing worker file — do not replace, just import and register:

```typescript
// Add this import at the top of worker.ts
import { crawlQueue } from '../crawl/crawlJob';

// Add this log to confirm registration (follow existing pattern)
console.log('[worker] Crawl queue registered');
```

---

## 9. Signal Writer

### `backend/src/services/crawl/signalWriter.ts`

Writes scan results to `crawl_pages`, `detected_signals`, and updates `org_page_scope.last_crawled_at`. Also feeds the Signal Library.

```typescript
import { supabase } from '../database/supabaseClient';
import { DetectedSignal } from '../../types/crawl';

interface WriteSignalsArgs {
  org_id: string;
  crawl_run_id: string;
  page_id: string;
  signals: DetectedSignal[];
  http_status: number | null;
  scan_duration_ms: number;
}

export async function writeSignalsToLibrary(args: WriteSignalsArgs): Promise<void> {
  const { org_id, crawl_run_id, page_id, signals, http_status, scan_duration_ms } = args;

  const healthy   = signals.filter(s => s.health_status === 'healthy').length;
  const degraded  = signals.filter(s => s.health_status === 'degraded' || s.health_status === 'misconfigured').length;
  const missing   = signals.filter(s => s.health_status === 'missing').length;

  // Update crawl_pages record
  await supabase.from('crawl_pages').update({
    status:           'completed',
    http_status,
    scan_duration_ms,
    signals_found:    signals.length,
    signals_healthy:  healthy,
    signals_degraded: degraded,
    signals_missing:  missing,
    scanned_at:       new Date().toISOString(),
  }).eq('id', page_id);

  // Write detected signals
  if (signals.length > 0) {
    const signalRows = signals.map(signal => ({
      crawl_page_id: page_id,
      crawl_run_id,
      org_id,
      ...signal,
      issues:         signal.issues,
      parameters:     signal.parameters,
      firing_triggers: signal.firing_triggers,
      first_seen_run_id: crawl_run_id,   // will be updated by delta check
    }));

    await supabase.from('detected_signals').insert(signalRows);
  }

  // Update last crawled timestamp on page scope
  await supabase.from('org_page_scope').update({
    last_crawled_at: new Date().toISOString(),
  }).eq('id', page_id);
}
```

---

## 10. Express API Routes

### `backend/src/api/routes/crawl.ts`

Follow the pattern from `health.ts` exactly — `Router`, `authMiddleware`, typed request handlers.

```typescript
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { supabase } from '../../services/database/supabaseClient';
import { crawlQueue } from '../../services/crawl/crawlJob';
import { discoverPages, seedPageScopeFromAdUrls } from '../../services/crawl/pageDiscovery';
import { ATLAS_PRICING } from '../../config/pricing';

const router = Router();
router.use(authMiddleware);

// POST /api/crawl/trigger
// Manually trigger a crawl for an org (scheduled or onboarding)
router.post('/trigger', async (req: Request, res: Response) => {
  const { org_id, mode = 'scheduled' } = req.body;

  if (!org_id) return res.status(400).json({ error: 'org_id is required' });

  try {
    // Get org subscription tier
    const { data: sub } = await supabase
      .from('org_active_subscriptions')
      .select('tier')
      .eq('org_id', org_id)
      .single();

    if (!sub) return res.status(404).json({ error: 'No active subscription found' });

    // Discover pages within tier entitlement
    const pages = await discoverPages(org_id, sub.tier);
    if (!pages.length) return res.status(400).json({ error: 'No pages in scope for this org' });

    // Create crawl_run record
    const { data: crawlRun } = await supabase
      .from('crawl_runs')
      .insert({
        org_id,
        mode,
        status:       'queued',
        triggered_by: 'manual',
        total_pages:  pages.length,
      })
      .select('id')
      .single();

    // Create crawl_pages records (one per page, status = pending)
    await supabase.from('crawl_pages').insert(
      pages.map(p => ({
        crawl_run_id: crawlRun!.id,
        org_id,
        url:          p.url,
        url_type:     p.url_type,
        domain:       p.domain,
        status:       'pending',
      }))
    );

    // Queue the job
    await crawlQueue.add({
      org_id,
      crawl_run_id: crawlRun!.id,
      mode,
      pages,
      tier: sub.tier,
    });

    res.json({ crawl_run_id: crawlRun!.id, pages_queued: pages.length });
  } catch (err) {
    console.error('[crawl/trigger]', err);
    res.status(500).json({ error: 'Failed to trigger crawl' });
  }
});

// POST /api/crawl/seed-pages
// Seeds org_page_scope from a list of ad destination URLs
// (Manual phase — future phase pulls from Google Ads + Meta APIs)
router.post('/seed-pages', async (req: Request, res: Response) => {
  const { org_id, urls, source = 'manual' } = req.body;

  if (!org_id || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'org_id and urls[] are required' });
  }

  try {
    await seedPageScopeFromAdUrls(org_id, urls, source);
    res.json({ seeded: urls.length });
  } catch (err) {
    console.error('[crawl/seed-pages]', err);
    res.status(500).json({ error: 'Failed to seed pages' });
  }
});

// GET /api/crawl/runs/:org_id
// Returns the last 10 crawl runs for an org
router.get('/runs/:org_id', async (req: Request, res: Response) => {
  const { org_id } = req.params;

  const { data, error } = await supabase
    .from('crawl_runs')
    .select('*')
    .eq('org_id', org_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/crawl/run/:crawl_run_id
// Returns a single crawl run with its page results
router.get('/run/:crawl_run_id', async (req: Request, res: Response) => {
  const { crawl_run_id } = req.params;

  const { data: run, error: runError } = await supabase
    .from('crawl_runs')
    .select('*')
    .eq('id', crawl_run_id)
    .single();

  if (runError) return res.status(404).json({ error: 'Crawl run not found' });

  const { data: pages } = await supabase
    .from('crawl_pages')
    .select('*, detected_signals(*)')
    .eq('crawl_run_id', crawl_run_id)
    .order('created_at', { ascending: true });

  res.json({ run, pages });
});

// GET /api/crawl/page-scope/:org_id
// Returns the current page scope for an org
router.get('/page-scope/:org_id', async (req: Request, res: Response) => {
  const { org_id } = req.params;

  const { data, error } = await supabase
    .from('org_page_scope')
    .select('*')
    .eq('org_id', org_id)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
```

### Mount in `backend/src/app.ts`

```typescript
// Add to existing route mounting in app.ts
import crawlRouter from './api/routes/crawl';
app.use('/api/crawl', crawlRouter);
```

---

## 11. Onboarding Mode Integration

Onboarding mode runs automatically when an org completes the setup wizard. It differs from scheduled mode in one way: it is the first crawl, so there is no previous baseline to compare against. All signals are written as `is_regression = false` and `first_seen_run_id = crawl_run_id`.

The trigger point is after the org connects their ad accounts (or manually seeds URLs during the manual phase). The onboarding wizard should call `POST /api/crawl/seed-pages` followed by `POST /api/crawl/trigger` with `mode: 'onboarding'`.

The frontend `CrawlStatusPage.tsx` shows a live progress indicator during onboarding. Poll `GET /api/crawl/run/:crawl_run_id` every 5 seconds until `status === 'completed'` or `'failed'`.

---

## 12. Scheduled Mode Integration

Scheduled crawls are triggered by a Bull cron job, not by user action. Add to the nightly job runner after the Browserbase reconciliation step:

```typescript
// src/jobs/nightlyRunner.ts — add scheduled crawl trigger

import { crawlQueue } from '../services/crawl/crawlJob';
import { discoverPages } from '../services/crawl/pageDiscovery';

async function triggerScheduledCrawls(): Promise<void> {
  // Get all orgs with active subscriptions
  const { data: orgs } = await supabase
    .from('org_active_subscriptions')
    .select('org_id, tier');

  for (const org of orgs ?? []) {
    const config = ATLAS_PRICING[org.tier as keyof typeof ATLAS_PRICING];

    // Check if this org should be crawled today based on their cadence
    const shouldCrawl = await isCrawlDue(org.org_id, config.scans_per_month);
    if (!shouldCrawl) continue;

    const pages = await discoverPages(org.org_id, org.tier);
    if (!pages.length) continue;

    const { data: crawlRun } = await supabase
      .from('crawl_runs')
      .insert({
        org_id:       org.org_id,
        mode:         'scheduled',
        status:       'queued',
        triggered_by: 'system',
        total_pages:  pages.length,
      })
      .select('id')
      .single();

    await supabase.from('crawl_pages').insert(
      pages.map(p => ({
        crawl_run_id: crawlRun!.id,
        org_id:       org.org_id,
        url:          p.url,
        url_type:     p.url_type,
        domain:       p.domain,
        status:       'pending',
      }))
    );

    await crawlQueue.add({
      org_id:       org.org_id,
      crawl_run_id: crawlRun!.id,
      mode:         'scheduled',
      pages,
      tier:         org.tier,
    });
  }
}

// Check if this org's crawl cadence is due today
async function isCrawlDue(org_id: string, scans_per_month: number): Promise<boolean> {
  const { data: lastRun } = await supabase
    .from('crawl_runs')
    .select('created_at')
    .eq('org_id', org_id)
    .eq('triggered_by', 'system')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastRun) return true; // Never run — run now

  const daysBetweenScans = Math.floor(30 / scans_per_month);
  const daysSinceLastRun = Math.floor(
    (Date.now() - new Date(lastRun.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  return daysSinceLastRun >= daysBetweenScans;
}
```

### Updated nightly sequence

```typescript
export async function runNightlyJobs(): Promise<void> {
  await refreshUsageMonthlySummary();
  await runBrowserbaseReconciliation();
  await triggerScheduledCrawls();       // ← NEW — triggers crawl jobs into Bull queue
  await runFairUseCapCheck();
  await runMarginAlertCheck();
}
```

---

## 13. Frontend Components

### `frontend/src/pages/CrawlStatusPage.tsx`

Follow the loading state pattern from `HealthDashboardPage.tsx`. Key behaviours:

- On mount: start polling `GET /api/crawl/run/:crawl_run_id` every 5 seconds
- Show `CrawlProgress` component with `pages_completed / total_pages`
- When `status === 'completed'`: stop polling, show `CrawlResults`
- When `status === 'failed'`: show error state with retry button

### `frontend/src/store/crawlStore.ts`

Follow `auditStore.ts` pattern. State shape:

```typescript
interface CrawlState {
  currentRunId: string | null;
  run: CrawlRunSummary | null;
  pages: CrawlPageResult[];
  isPolling: boolean;
  error: string | null;
  setCurrentRun: (runId: string) => void;
  pollRun: () => Promise<void>;
  stopPolling: () => void;
  reset: () => void;
}
```

### `frontend/src/lib/api/crawlApi.ts`

Follow `healthApi.ts` pattern using `apiFetch<T>`:

```typescript
export const crawlApi = {
  triggerCrawl: (org_id: string, mode: CrawlMode) =>
    apiFetch<{ crawl_run_id: string; pages_queued: number }>('/crawl/trigger', {
      method: 'POST', body: JSON.stringify({ org_id, mode })
    }),

  seedPages: (org_id: string, urls: string[], source: string) =>
    apiFetch<{ seeded: number }>('/crawl/seed-pages', {
      method: 'POST', body: JSON.stringify({ org_id, urls, source })
    }),

  getRun: (crawl_run_id: string) =>
    apiFetch<{ run: CrawlRunSummary; pages: CrawlPageResult[] }>(
      `/crawl/run/${crawl_run_id}`
    ),

  getRuns: (org_id: string) =>
    apiFetch<CrawlRunSummary[]>(`/crawl/runs/${org_id}`),

  getPageScope: (org_id: string) =>
    apiFetch<OrgPageScope[]>(`/crawl/page-scope/${org_id}`),
};
```

---

## 14. Environment Variables Required

Confirm these exist in `backend/.env` before running. Do not add new keys without checking:

```bash
BROWSERBASE_API_KEY=           # already used by existing Browserbase integration
BROWSERBASE_PROJECT_ID=        # already used by existing Browserbase integration
UPSTASH_REDIS_URL=             # already used by Bull queue
SUPABASE_URL=                  # already exists
SUPABASE_SERVICE_ROLE_KEY=     # already exists
```

No new environment variables are needed.

---

## 15. Implementation Order

Execute in this exact sequence. Do not skip ahead.

### Step 1 — Schema (Day 1 morning)
- [ ] Write and run `db/migrations/005_crawl_signal_extractor.sql`
- [ ] Verify all four tables exist in Supabase dashboard
- [ ] Confirm FKs resolve correctly against `organisations`

### Step 2 — Types and config (Day 1 afternoon)
- [ ] Create `backend/src/types/crawl.ts`
- [ ] Create `frontend/src/types/crawl.ts`
- [ ] Confirm `src/config/pricing.ts` exists (from Subscriptions PRD) — import from it

### Step 3 — Core backend services (Day 2)
- [ ] Write `pageDiscovery.ts`
- [ ] Write `signalDetector.ts` — test against one real URL manually before wiring into the job
- [ ] Write `signalWriter.ts`
- [ ] Write `crawlJob.ts` — register in `worker.ts`

### Step 4 — API routes (Day 3 morning)
- [ ] Write `crawl.ts` route file
- [ ] Mount in `app.ts`
- [ ] Test all endpoints with Postman or curl against a real org_id

### Step 5 — Scheduled trigger (Day 3 afternoon)
- [ ] Write `triggerScheduledCrawls()` in `nightlyRunner.ts`
- [ ] Add to nightly sequence
- [ ] Test: manually call the function and confirm crawl_runs row is created and job appears in Bull queue

### Step 6 — Frontend (Day 4)
- [ ] Write `crawlApi.ts`
- [ ] Write `crawlStore.ts`
- [ ] Write `CrawlProgress.tsx` and `CrawlResults.tsx` components
- [ ] Write `CrawlStatusPage.tsx`
- [ ] Add route to `App.tsx`

### Step 7 — End-to-end test (Day 5)
- [ ] Seed one real org with 5 URLs via `POST /api/crawl/seed-pages`
- [ ] Trigger onboarding crawl via `POST /api/crawl/trigger`
- [ ] Confirm `crawl_runs`, `crawl_pages`, and `detected_signals` populate correctly
- [ ] Confirm `usage_events` receives a `page_scan` event
- [ ] Confirm `browserbase_usage_snapshots` shows the session

**Total estimated build time: 5 days**

---

## 16. Success Criteria

| Criterion | How to verify |
|---|---|
| One Browserbase session scans multiple pages | Check `browserbase_session_id` is the same across multiple `crawl_pages` rows from one run |
| `usage_events` receives scan events | Query `SELECT * FROM usage_events WHERE event_type = 'page_scan' LIMIT 10` |
| Signal Library populates on first crawl | Query `SELECT signal_type, COUNT(*) FROM detected_signals GROUP BY signal_type` |
| Page cap is respected | Seed 50 URLs for a Monitor org — confirm only 25 appear in `discoverPages()` output |
| Scheduled cadence fires correctly | Manually call `isCrawlDue()` for an org that was crawled yesterday — confirms correct for daily vs weekly tiers |
| Onboarding crawl completes < 10 mins for 25 pages | Time a real onboarding crawl run end-to-end |

---

## 17. Known Limitations (Phase 1)

- **Ad URL discovery is manual.** `seedPageScopeFromAdUrls()` accepts a URL list rather than pulling live from Google Ads and Meta APIs. Connecting live ad accounts is a Phase 2 addition to this module.
- **Signal detection scope.** The detector covers GTM, GA4, Meta Pixel, Google Ads Conversions, TikTok Pixel, and LinkedIn Insight Tag. Snapchat Pixel and custom dataLayer events are not detected in this phase.
- **JavaScript-rendered events.** Events that fire only on user interaction (button clicks, form submissions) are not captured in this phase — only page_load and networkidle events are observed.
- **Conversion funnel auto-detection** relies on URL pattern matching only. Pages with non-standard URL structures (e.g. SPAs with hash routing) may not be detected automatically.

---

## 18. Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `organisations` table | Exists — confirmed | All FKs reference this |
| `org_active_subscriptions` view | Defined in Subscriptions PRD | Must be built before scheduled trigger |
| `ATLAS_PRICING` config | Defined in Subscriptions PRD | Must exist before pageDiscovery.ts is built |
| `logUsage()` utility | Defined in Usage Logging PRD | Must exist before crawlJob.ts is built |
| Browserbase SDK | Already installed | Existing integration |
| Bull/Redis (Upstash) | Exists | Crawl queue added to existing worker |

---

## 19. Related PRDs

- PRD: Usage Logging & Cost Intelligence — `logUsage()` called from `crawlJob.ts`; Browserbase session metadata feeds reconciliation
- PRD: Subscription Management & Pricing Config — `ATLAS_PRICING` and `org_active_subscriptions` used by page discovery and scheduled trigger
- PRD: Data Quality Monitor — downstream consumer; reads `detected_signals` and `crawl_runs` for baseline comparison and regression detection
- PRD: Auto-insight Reporter — downstream consumer; reads signal health data to generate AI-powered insight reports

---

*Document owner: Vikram Jayaram / Spi3l LLC*
*Last updated: April 2026*
