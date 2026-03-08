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

// ── API request / response shapes ─────────────────────────────────────────────

export interface CreateSessionInput {
  website_url: string;
  business_type: BusinessType;
  business_description?: string;
  selected_platforms: Platform[];
  page_urls: string[];
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
  decision: UserDecision;
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
