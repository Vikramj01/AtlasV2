export type BusinessType = 'ecommerce' | 'saas' | 'lead_gen' | 'content' | 'marketplace' | 'custom';
export type JourneyStatus = 'draft' | 'active' | 'archived';
export type ImplementationFormat = 'gtm';
export type Platform = 'ga4' | 'google_ads' | 'meta' | 'sgtm' | 'tiktok' | 'linkedin';
export type ActionCategory = 'conversion' | 'engagement' | 'navigation';
export type SpecFormat = 'gtm_datalayer' | 'validation_spec';
export type StageStatus = 'healthy' | 'issues_found' | 'signals_missing' | 'not_checked';
export type GapType = 'MISSING' | 'WRONG' | 'EXTRA';
export type GapSeverity = 'critical' | 'high' | 'medium' | 'info';
export type EstimatedEffort = 'low' | 'medium' | 'high';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'string' | 'number' | 'array' | 'object' | 'boolean';
  description: string;
  example: string;
  validation_regex?: string;
}

export interface PlatformMapping {
  platform: Platform;
  event_name: string;
  param_mapping: Record<string, string>;
  payload_template: string;
  additional_params?: Record<string, unknown>;
}

export interface ActionPrimitive {
  key: string;
  label: string;
  description: string;
  category: ActionCategory;
  required_params: ParamSpec[];
  optional_params: ParamSpec[];
  platform_mappings: PlatformMapping[];
}

export interface PlatformDetection {
  script_patterns: string[];
  network_patterns: string[];
  datalayer_markers: string[];
  global_objects: string[];
}

export interface PlatformDelivery {
  method: 'script_tag' | 'network_request' | 'server_side';
  endpoint_patterns: string[];
  required_identifiers: string[];
}

export interface UserDataConfig {
  supports_enhanced_conversions: boolean;
  hashing_required: boolean;
  hash_algorithm: 'sha256' | 'none';
  hashable_fields: string[];
}

export interface ClickIdConfig {
  param_name: string;
  storage_method: 'cookie' | 'localstorage' | 'url';
  persistence_required: boolean;
  cookie_name?: string;
}

export interface PlatformSchema {
  platform: Platform;
  display_name: string;
  detection: PlatformDetection;
  delivery: PlatformDelivery;
  user_data_handling: UserDataConfig;
  click_id: ClickIdConfig | null;
}

// Journey domain types
export interface Journey {
  id: string;
  user_id: string;
  name: string;
  business_type: BusinessType;
  status: JourneyStatus;
  implementation_format: ImplementationFormat;
  source_planning_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface JourneyStage {
  id: string;
  journey_id: string;
  stage_order: number;
  label: string;
  page_type: string;
  sample_url: string | null;
  actions: string[];
  created_at: string;
  updated_at: string;
}

export interface JourneyPlatform {
  id: string;
  journey_id: string;
  platform: Platform;
  is_active: boolean;
  measurement_id: string | null;
  config: Record<string, unknown>;
  created_at: string;
}

export interface GeneratedSpec {
  id: string;
  journey_id: string;
  format: SpecFormat;
  spec_data: unknown;
  version: number;
  generated_at: string;
}

export interface Gap {
  gap_type: GapType;
  sub_type: string;
  severity: GapSeverity;
  action_key: string;
  platform: string;
  expected: string;
  found: string;
  business_impact: string;
  fix_owner: string;
  fix_description: string;
  fix_code: string;
  estimated_effort: EstimatedEffort;
}

export interface JourneyAuditResult {
  id: string;
  audit_id: string;
  journey_id: string;
  stage_id: string;
  stage_status: StageStatus;
  gaps: Gap[];
  raw_capture: unknown | null;
  created_at: string;
}

export interface JourneyTemplate {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  business_type: BusinessType;
  is_system: boolean;
  is_shared: boolean;
  template_data: {
    stages: Array<{
      order: number;
      label: string;
      page_type: string;
      actions: string[];
    }>;
  };
  created_at: string;
  updated_at: string;
}

// API request/response types
export interface CreateJourneyRequest {
  name?: string;
  business_type: BusinessType;
  implementation_format?: ImplementationFormat;
  stages?: Array<Omit<JourneyStage, 'id' | 'journey_id' | 'created_at' | 'updated_at'>>;
  platforms?: Array<Pick<JourneyPlatform, 'platform' | 'is_active' | 'measurement_id' | 'config'>>;
}

export interface UpdateJourneyRequest {
  name?: string;
  business_type?: BusinessType;
  status?: JourneyStatus;
  implementation_format?: ImplementationFormat;
  source_planning_session_id?: string | null;
}

export interface UpsertStageRequest {
  stage_order: number;
  label: string;
  page_type: string;
  sample_url?: string | null;
  actions: string[];
}

export interface UpsertPlatformsRequest {
  platforms: Array<{
    platform: Platform;
    is_active: boolean;
    measurement_id?: string | null;
    config?: Record<string, unknown>;
  }>;
}

export interface ReorderStagesRequest {
  stage_ids: string[];
}

export interface GenerateSpecsRequest {
  formats?: SpecFormat[];
}

// Validation spec (consumed by audit engine)
export interface ExpectedEvent {
  action_key: string;
  event_name_by_platform: Record<string, string>;
  required_params: string[];
  optional_params: string[];
}

export interface ExpectedPlatform {
  platform: string;
  must_detect_tag: boolean;
  must_receive_event: boolean;
  endpoint_patterns: string[];
}

export interface GlobalCheck {
  check_type: 'click_id_persistence' | 'event_id_deduplication' | 'consent_enforcement' | 'pii_hashing';
  platform: string;
  description: string;
  params: Record<string, unknown>;
}

export interface StageValidationSpec {
  stage_order: number;
  stage_label: string;
  sample_url: string | null;
  expected_events: ExpectedEvent[];
  expected_platforms: ExpectedPlatform[];
}

export interface ValidationSpec {
  journey_id: string;
  stages: StageValidationSpec[];
  global_checks: GlobalCheck[];
}

// Generator output types
export interface GTMStageOutput {
  stage_label: string;
  stage_order: number;
  sample_url: string | null;
  code_snippet: string;
  comments: string[];
}

export interface GTMDataLayerOutput {
  stages: GTMStageOutput[];
  global_setup: string;
}

// Journey definition used by generators
export interface JourneyDefinition {
  id: string;
  name: string;
  business_type: BusinessType;
  implementation_format: ImplementationFormat;
  stages: JourneyStage[];
}

export interface PlatformConfig {
  platform: Platform;
  is_active: boolean;
  measurement_id: string | null;
  config: Record<string, unknown>;
}
