// ─── Taxonomy Types ───────────────────────────────────────────────────────────
// Mirror of backend/src/types/taxonomy.ts — keep in sync.

export type FunnelStage = 'awareness' | 'consideration' | 'conversion' | 'retention' | 'advocacy';
export type NodeType = 'category' | 'event';
export type CaseFormat = 'snake_case' | 'camelCase' | 'kebab-case' | 'PascalCase';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description: string;
  format: string | null;
  item_schema?: ParamSpec[];
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
  custom_event_name?: string;
  requires_conversion_label?: boolean;
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
  parameter_schema: ParameterSchema | null;
  platform_mappings: PlatformMappings | null;
  created_at: string;
  updated_at: string;
  // Populated by tree builder:
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
