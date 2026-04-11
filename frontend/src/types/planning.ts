// ── Planning Mode — Frontend TypeScript types ─────────────────────────────────

export type PlanningSessionStatus =
  | 'setup'
  | 'scanning'
  | 'review_ready'
  | 'generating'
  | 'outputs_ready'
  | 'failed';

export type PlanningPageStatus = 'pending' | 'scanning' | 'done' | 'failed';

export type UserDecision = 'approved' | 'skipped' | 'edited';

export type OutputType = 'gtm_container' | 'datalayer_spec' | 'implementation_guide';

export type BusinessType = 'ecommerce' | 'saas' | 'lead_gen' | 'other';

export type Platform = 'ga4' | 'google_ads' | 'meta' | 'tiktok' | 'sgtm';

// ── Session ────────────────────────────────────────────────────────────────────

export interface PlanningSession {
  id: string;
  user_id: string;
  website_url: string;
  business_type: BusinessType;
  business_description: string | null;
  selected_platforms: Platform[];
  status: PlanningSessionStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  last_rescan_at: string | null;
  rescan_results: ChangeDetectionResult | null;
  client_id?: string | null;
}

// ── Change Detection (Re-scan) ────────────────────────────────────────────────

export interface NewElement {
  event_name: string;
  element_text: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  business_justification: string;
  selector: string;
}

export interface RemovedElement {
  recommendation_id: string;
  original_event_name: string;
  reason: string;
}

export interface ModifiedElement {
  recommendation_id: string;
  original_event_name: string;
  change_description: string;
}

export type ChangeType = 'unchanged' | 'modified' | 'new_elements' | 'removed_elements' | 'page_not_found';

export interface PageChangeResult {
  page_id: string;
  page_url: string;
  page_label: string;
  change_type: ChangeType;
  new_elements: NewElement[];
  removed_elements: RemovedElement[];
  modified_elements: ModifiedElement[];
  scanned_at: string;
}

export interface ChangeSummary {
  pages_unchanged: number;
  pages_modified: number;
  new_elements_found: number;
  elements_removed: number;
  action_required: boolean;
}

export interface ChangeDetectionResult {
  session_id: string;
  status: 'scanning' | 'complete' | 'failed';
  started_at: string;
  completed_at: string | null;
  error: string | null;
  pages: PageChangeResult[];
  summary: ChangeSummary;
}

// ── Pages ──────────────────────────────────────────────────────────────────────

export interface PlanningPage {
  id: string;
  session_id: string;
  url: string;
  page_type: string | null;
  page_order: number;
  page_title: string | null;
  meta_description: string | null;
  screenshot_url: string | null;
  existing_tracking: ExistingTrackingInfo[];
  status: PlanningPageStatus;
  error_message: string | null;
  created_at: string;
  scanned_at: string | null;
}

export interface ExistingTrackingInfo {
  platform: string;
  detected: boolean;
  id?: string;
}

// ── Recommendations ────────────────────────────────────────────────────────────

export interface RecommendedParam {
  param_key: string;
  param_label: string;
  source: string;
  example_value: string;
  required: boolean;
}

export interface PlanningRecommendation {
  id: string;
  page_id: string;
  element_selector: string | null;
  element_text: string | null;
  element_type: string | null;
  action_type: string;
  event_name: string;
  required_params: RecommendedParam[];
  optional_params: RecommendedParam[];
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  confidence_score: number;
  business_justification: string;
  affected_platforms: Platform[];
  user_decision: UserDecision | null;
  modified_config: Record<string, unknown> | null;
  decided_at: string | null;
  source: 'ai' | 'manual';
  /** Linked taxonomy event ID — matched by event name slug after AI analysis. */
  taxonomy_event_id: string | null;
  /** Denormalised taxonomy path, e.g. "ecommerce/cart/add_to_cart". */
  taxonomy_path: string | null;
  created_at: string;
}

// ── Outputs ────────────────────────────────────────────────────────────────────

export interface PlanningOutput {
  id: string;
  session_id: string;
  output_type: OutputType;
  content: Record<string, unknown> | null;
  content_text: string | null;
  storage_path: string | null;
  file_size_bytes: number | null;
  mime_type: string;
  generated_at: string;
  version: number;
  download_url?: string;
}

// ── Site Detection ─────────────────────────────────────────────────────────────

export interface DetectedPlatform {
  name: string;
  version?: string;
  indicators: string[];
}

export interface ExistingTrackingQuick {
  gtm_detected: boolean;
  gtm_container_id: string | null;
  ga4_detected: boolean;
  ga4_measurement_id: string | null;
  meta_pixel_detected: boolean;
  meta_pixel_id: string | null;
  google_ads_detected: boolean;
  tiktok_detected: boolean;
  linkedin_detected: boolean;
}

export interface SiteDetection {
  url: string;
  resolved_url: string;
  site_title: string;
  detected_platform: DetectedPlatform | null;
  inferred_business_type: string;
  business_type_confidence: number;
  existing_tracking: ExistingTrackingQuick;
  detected_currency: string | null;
  detected_language: string | null;
}

// ── API request / response shapes ─────────────────────────────────────────────

export interface CreateSessionInput {
  website_url: string;
  business_type: BusinessType;
  business_description?: string;
  selected_platforms: Platform[];
  page_urls: string[];
  client_id?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  status: PlanningSessionStatus;
}

export interface GetSessionResponse {
  session: PlanningSession;
  pages: PlanningPage[];
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
}

export interface GetRecommendationsResponse {
  session_id: string;
  recommendations: PlanningRecommendation[];
  pages: Pick<PlanningPage, 'id' | 'url' | 'page_title' | 'page_type' | 'screenshot_url'>[];
}

export interface UpdateDecisionInput {
  user_decision: UserDecision;
  modified_config?: Record<string, unknown>;
}

export interface GenerateOutputsResponse {
  session_id: string;
  status: PlanningSessionStatus;
  outputs: Array<{
    id: string;
    type: OutputType;
    mime_type: string;
    version: number;
    generated_at: string;
    download_url: string | null;
  }>;
}

export interface ListSessionsResponse {
  sessions: PlanningSession[];
}

export interface HandoffResponse {
  journey_id: string;
  message: string;
}

// ── Developer Portal ───────────────────────────────────────────────────────────

export type ImplementationStatus = 'not_started' | 'in_progress' | 'implemented' | 'verified';

export interface DeveloperShare {
  id: string;
  session_id: string;
  share_token: string;
  developer_name: string | null;
  developer_email: string | null;
  is_active: boolean;
  expires_at: string;
  created_at: string;
}

export interface PageProgress {
  page_id: string;
  page_label: string;
  page_url: string;
  status: ImplementationStatus;
  developer_notes: string | null;
  updated_at: string;
}

export interface ImplementationProgress {
  total_pages: number;
  not_started: number;
  in_progress: number;
  implemented: number;
  verified: number;
  percent_complete: number;
  all_implemented: boolean;
  pages: PageProgress[];
}

// ── Quick Check ────────────────────────────────────────────────────────────────

export interface QuickCheckTracking {
  gtm: boolean;
  gtm_container_id: string | undefined;
  ga4: boolean;
  ga4_measurement_id: string | undefined;
  meta_pixel: boolean;
  meta_pixel_id: string | undefined;
  google_ads: boolean;
  datalayer_events: string[];
}

export interface QuickCheckResult {
  url: string;
  checked_at: string;
  duration_ms: number;
  tracking: QuickCheckTracking;
  overall_status: 'tracking_found' | 'partial' | 'not_found' | 'error';
  summary: string;
}

export interface DevPortalPage {
  page_id: string;
  page_url: string;
  page_label: string;
  page_type: string | null;
  datalayer_code: string | null;
  status: ImplementationStatus;
  developer_notes: string | null;
}

export interface DevPortalData {
  session_id: string;
  site_url: string;
  site_title: string | null;
  prepared_by: string;
  generated_at: string;
  share_id: string;
  pages: DevPortalPage[];
  outputs: Array<{ id: string; output_type: OutputType; mime_type: string }>;
  progress: ImplementationProgress;
}

export type PiiSeverity = 'high' | 'medium' | 'info';

export interface PiiWarning {
  severity: PiiSeverity;
  field: string;
  event_name: string;
  page_url?: string;
  message: string;
  recommendation: string;
}
