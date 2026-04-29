// Mirror of backend/src/types/crawl.ts — keep in sync

export type CrawlMode = 'onboarding' | 'scheduled';
export type CrawlStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type CrawlPageStatus = 'pending' | 'scanning' | 'completed' | 'failed' | 'skipped';
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

export interface SignalIssue {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

// ─── Page scope ───────────────────────────────────────────────────────────────

export interface OrgPageScope {
  id: string;
  org_id: string;
  url: string;
  url_type: UrlType;
  domain: string;
  source: string | null;
  is_active: boolean;
  priority: number;
  added_at: string;
  last_crawled_at: string | null;
}

// ─── Detected signal as returned from the API ─────────────────────────────────

export interface DetectedSignalResult {
  id: string;
  crawl_page_id: string;
  crawl_run_id: string;
  signal_type: SignalType;
  signal_name: string | null;
  signal_id: string | null;
  health_status: SignalHealthStatus;
  health_score: number;
  detected_at: 'page_load' | 'dom_ready' | 'interaction' | 'network' | null;
  parameters: Record<string, unknown> | null;
  issues: SignalIssue[];
  is_regression: boolean;
  created_at: string;
}

// ─── Page result as returned from GET /api/crawl/run/:id ─────────────────────

export interface CrawlPageResult {
  id: string;
  crawl_run_id: string;
  url: string;
  url_type: UrlType;
  domain: string;
  status: CrawlPageStatus;
  http_status: number | null;
  scan_duration_ms: number | null;
  signals_found: number;
  signals_healthy: number;
  signals_degraded: number;
  signals_missing: number;
  error_message: string | null;
  scanned_at: string | null;
  created_at: string;
  detected_signals: DetectedSignalResult[];
}

// ─── Crawl run summary (used by store and list views) ────────────────────────

export interface CrawlRunSummary {
  id: string;
  org_id: string;
  mode: CrawlMode;
  status: CrawlStatus;
  triggered_by: 'system' | 'manual' | 'onboarding';
  total_pages: number;
  pages_completed: number;
  pages_failed: number;
  browserbase_session_id: string | null;
  browser_minutes_used: number | null;
  duration_seconds: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

// ─── API response for GET /api/crawl/run/:id ──────────────────────────────────

export interface CrawlRunDetail {
  run: CrawlRunSummary;
  pages: CrawlPageResult[];
}

// ─── Trigger request inputs ───────────────────────────────────────────────────

export interface TriggerCrawlInput {
  org_id: string;
  mode: CrawlMode;
}

export interface SeedPagesInput {
  org_id: string;
  urls: string[];
  source: 'google_ads' | 'meta_ads' | 'manual';
}
