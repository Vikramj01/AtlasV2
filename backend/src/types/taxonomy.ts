// ─── Taxonomy Types ───────────────────────────────────────────────────────────
// Shared between backend services and API responses.
// Mirror: frontend/src/types/taxonomy.ts

export type FunnelStage = 'awareness' | 'consideration' | 'conversion' | 'retention' | 'advocacy';
export type NodeType = 'category' | 'event';
export type CaseFormat = 'snake_case' | 'camelCase' | 'kebab-case' | 'PascalCase';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description: string;
  format: string | null; // 'currency', 'iso_4217', 'ga4_items', 'url', 'email', etc.
  item_schema?: ParamSpec[]; // For array types
}

export interface ParameterSchema {
  required: ParamSpec[];
  optional: ParamSpec[];
}

export interface PlatformEventMapping {
  event_name: string;
  param_mapping: Record<string, string>;
  additional_params?: Record<string, string>;
  required_params?: string[];
  custom_event_name?: string;         // For meta/tiktok CustomEvent usage
  requires_conversion_label?: boolean; // For google_ads conversions
}

export interface PlatformMappings {
  ga4?: PlatformEventMapping;
  meta?: PlatformEventMapping;
  google_ads?: PlatformEventMapping;
  tiktok?: PlatformEventMapping;
  linkedin?: PlatformEventMapping;
  snapchat?: PlatformEventMapping;
}

export interface TaxonomyNode {
  id: string;
  organization_id: string | null;
  parent_id: string | null;
  path: string;
  depth: number;
  slug: string;
  name: string;
  description: string | null;
  node_type: NodeType;
  funnel_stage: FunnelStage | null;
  icon: string | null;
  display_order: number;
  is_system: boolean;
  is_custom: boolean;
  deprecated: boolean;
  // Only populated on event nodes:
  parameter_schema: ParameterSchema | null;
  platform_mappings: PlatformMappings | null;
  created_at: string;
  updated_at: string;
  // Populated by tree builder (not stored in DB):
  children?: TaxonomyNode[];
}

export interface NamingConvention {
  id?: string;
  organization_id: string;
  event_case: CaseFormat;
  param_case: CaseFormat;
  event_prefix: string | null;
  param_prefix: string | null;
  word_separator: string;
  max_event_name_length: number;
  max_param_key_length: number;
  allowed_characters: string;
  reserved_words: string[];
  example_event: string | null;
  example_param: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  suggestions: string[];
}

// ─── Request / Response shapes ────────────────────────────────────────────────

export interface CreateTaxonomyEventRequest {
  organization_id: string;
  parent_path: string;
  slug: string;
  name: string;
  description?: string;
  funnel_stage?: FunnelStage;
  parameter_schema: ParameterSchema;
  platform_mappings?: PlatformMappings;
  icon?: string;
}

export interface CreateTaxonomyCategoryRequest {
  organization_id: string;
  parent_path?: string; // null/undefined = root category
  slug: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface UpdateTaxonomyNodeRequest {
  name?: string;
  description?: string;
  funnel_stage?: FunnelStage;
  parameter_schema?: ParameterSchema;
  platform_mappings?: PlatformMappings;
  icon?: string;
  display_order?: number;
}

export interface TaxonomySearchResult {
  id: string;
  path: string;
  slug: string;
  name: string;
  description: string | null;
  node_type: NodeType;
  funnel_stage: FunnelStage | null;
  is_system: boolean;
}
