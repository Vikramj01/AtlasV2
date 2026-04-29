// ─── Primitive types ──────────────────────────────────────────────────────────

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
export type DetectedAt = 'page_load' | 'dom_ready' | 'interaction' | 'network';

// ─── Bull job payload ─────────────────────────────────────────────────────────

export interface CrawlJobData {
  org_id: string;
  crawl_run_id: string;
  mode: CrawlMode;
  pages: PageToScan[];
  tier: string;
}

// ─── Page scope ───────────────────────────────────────────────────────────────

export interface PageToScan {
  id: string;       // org_page_scope.id — used to update crawl_pages and org_page_scope
  url: string;
  url_type: UrlType;
  domain: string;
  priority: number;
}

export interface OrgPageScopeRow {
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

// ─── Signal detection ─────────────────────────────────────────────────────────

export interface SignalIssue {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface DetectedSignal {
  signal_type: SignalType;
  signal_name: string | null;
  signal_id: string | null;
  health_status: SignalHealthStatus;
  health_score: number;
  detected_at: DetectedAt | null;
  firing_triggers: Record<string, unknown> | null;
  parameters: Record<string, unknown> | null;
  issues: SignalIssue[];
}

// ─── Scan results (returned from signalDetector) ──────────────────────────────

export interface PageScanResult {
  page_id: string;
  url: string;
  http_status: number | null;
  scan_duration_ms: number;
  signals: DetectedSignal[];
  error?: string;
}

export interface ScanBatchResult {
  browserbase_session_id: string;
  browser_minutes_used: number;
  page_results: PageScanResult[];
}

// ─── signalWriter args ────────────────────────────────────────────────────────

export interface WriteSignalsArgs {
  org_id: string;
  crawl_run_id: string;
  page_id: string;
  signals: DetectedSignal[];
  http_status: number | null;
  scan_duration_ms: number;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface CrawlRunRow {
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
  error_detail: Record<string, unknown> | null;
  created_at: string;
}

export interface CrawlPageRow {
  id: string;
  crawl_run_id: string;
  org_id: string;
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
}

export interface DetectedSignalRow extends DetectedSignal {
  id: string;
  crawl_page_id: string;
  crawl_run_id: string;
  org_id: string;
  first_seen_run_id: string | null;
  is_regression: boolean;
  created_at: string;
}

// CrawlRunSummary — used by both the API response and the frontend store
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
