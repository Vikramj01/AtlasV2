/**
 * Planning Mode — TypeScript type definitions
 * These mirror the interface shapes from ATLAS_Planning_Mode_PRD.md Section 3.
 */

// ── DOM & Page Capture ──────────────────────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SimplifiedDOMNode {
  tag: string;
  id?: string;
  classes?: string[];
  text_content?: string;       // Truncated to 200 chars
  href?: string;
  type?: string;               // For inputs
  role?: string;               // ARIA role
  data_attributes?: Record<string, string>;
  children?: SimplifiedDOMNode[];
  bounding_box?: BoundingBox;
}

export interface InteractiveElement {
  element_id: string;          // Generated unique ID
  tag: string;
  text: string;
  selector: string;
  element_type: 'button' | 'link' | 'form_submit' | 'input' | 'select' | 'custom';
  parent_form_id?: string;
  href?: string;
  bounding_box: BoundingBox;
  is_visible: boolean;
  is_above_fold: boolean;
}

export interface FormField {
  name: string;
  type: string;
  label: string;
  placeholder?: string;
  required: boolean;
  selector: string;
}

export interface FormCapture {
  form_id: string;
  action: string;
  method: string;
  selector: string;
  fields: FormField[];
  submit_button: InteractiveElement | null;
}

export interface ExistingTrackingDetection {
  gtm_detected: boolean;
  gtm_container_id?: string;
  ga4_detected: boolean;
  ga4_measurement_id?: string;
  meta_pixel_detected: boolean;
  meta_pixel_id?: string;
  google_ads_detected: boolean;
  google_ads_id?: string;
  tiktok_pixel_detected: boolean;
  linkedin_insight_detected: boolean;
  walkeros_detected: boolean;
  other_tags: string[];
  datalayer_events_found: string[];
}

export interface PageCapture {
  url: string;
  actual_url: string;
  page_title: string;
  screenshot_base64: string;         // JPEG at 80% quality, full viewport (1280×800)
  simplified_dom: SimplifiedDOMNode[];
  interactive_elements: InteractiveElement[];
  forms: FormCapture[];
  existing_tracking: ExistingTrackingDetection;
  meta_tags: Record<string, string>;
  page_load_time_ms: number;
}

// ── AI Analysis ─────────────────────────────────────────────────────────────

export interface AIAnalysisRequest {
  page_url: string;
  page_title: string;
  business_type: string;
  business_context: string;
  screenshot_base64: string;
  simplified_dom: SimplifiedDOMNode[];
  interactive_elements: InteractiveElement[];
  forms: FormCapture[];
  existing_tracking: ExistingTrackingDetection;
  platforms_selected: string[];
  /** Rendered taxonomy tree from renderTaxonomyForPrompt — injected by the orchestrator. */
  taxonomy_context?: string;
}

export interface SuggestedParam {
  param_key: string;
  param_label: string;
  source: 'element_text' | 'element_attribute' | 'parent_context' | 'page_url' | 'developer_provided';
  source_detail: string;
  example_value: string;
}

export interface RecommendedElement {
  element_reference: string;
  selector: string;
  recommendation_type:
    | 'track_click'
    | 'track_form_submit'
    | 'track_page_view'
    | 'track_scroll'
    | 'track_video'
    | 'track_custom';
  action_primitive_key: string;
  suggested_event_name: string;
  suggested_event_category: string;
  business_justification: string;
  priority: 'must_have' | 'should_have' | 'nice_to_have';
  parameters_to_capture: SuggestedParam[];
  confidence: number;
  screenshot_annotation: BoundingBox & { label: string };
}

export interface PageClassification {
  page_type: string;
  funnel_position: 'top' | 'middle' | 'bottom' | 'post_conversion';
  business_importance: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface TrackingAssessment {
  has_existing_tracking: boolean;
  quality: 'none' | 'minimal' | 'partial' | 'comprehensive';
  summary: string;
  conflicts: string[];
}

export interface AIAnalysisResponse {
  page_classification: PageClassification;
  recommended_elements: RecommendedElement[];
  existing_tracking_assessment: TrackingAssessment;
  page_summary: string;
}

// ── Session / Database Entities ──────────────────────────────────────────────

export type BusinessType = 'ecommerce' | 'saas' | 'lead_gen' | 'content' | 'marketplace' | 'custom';

export type SessionStatus =
  | 'setup'
  | 'scanning'
  | 'review_ready'
  | 'generating'
  | 'outputs_ready'
  | 'failed';

export type PageStatus = 'pending' | 'scanning' | 'done' | 'failed';

export type UserDecision = 'approved' | 'skipped' | 'modified';

export type OutputType = 'gtm_container' | 'datalayer_spec' | 'implementation_guide' | 'walkeros_flow';

export interface PlanningSession {
  id: string;
  user_id: string;
  client_id?: string | null;
  website_url: string;
  business_type: BusinessType;
  business_description?: string;
  selected_platforms: string[];
  status: SessionStatus;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface PlanningPage {
  id: string;
  session_id: string;
  url: string;
  page_type: string;
  page_order: number;
  page_title?: string;
  meta_description?: string;
  screenshot_url?: string;
  screenshot_width?: number;
  screenshot_height?: number;
  existing_tracking: Array<{ platform: string; detected_via: string; detail: string }>;
  status: PageStatus;
  error_message?: string;
  created_at: string;
  scanned_at?: string;
}

export interface PlanningRecommendation {
  id: string;
  page_id: string;
  element_selector?: string;
  element_text?: string;
  element_type?: string;
  action_type: string;
  event_name: string;
  required_params: SuggestedParam[];
  optional_params: SuggestedParam[];
  bbox_x?: number;
  bbox_y?: number;
  bbox_width?: number;
  bbox_height?: number;
  confidence_score: number;
  business_justification: string;
  affected_platforms: string[];
  user_decision?: UserDecision;
  modified_config?: Record<string, unknown>;
  decided_at?: string;
  source: 'ai' | 'manual';
  /** Linked taxonomy event ID — set after AI analysis matches the event name to the org taxonomy. */
  taxonomy_event_id?: string | null;
  /** Denormalised taxonomy path for display, e.g. "ecommerce/cart/add_to_cart". */
  taxonomy_path?: string | null;
  created_at: string;
}

export interface PlanningOutput {
  id: string;
  session_id: string;
  output_type: OutputType;
  content?: unknown;
  content_text?: string;
  storage_path?: string;
  file_size_bytes?: number;
  mime_type: string;
  generated_at: string;
  version: number;
}

// ── Input shapes for API routes (Sprint PM-2) ─────────────────────────────────

export interface CreateSessionInput {
  website_url: string;
  business_type: BusinessType;
  business_description?: string;
  selected_platforms: string[];
  pages: Array<{ url: string; page_type?: string }>;
  client_id?: string;
}

export interface UpdateDecisionInput {
  user_decision: UserDecision;
  modified_config?: Record<string, unknown>;
}
