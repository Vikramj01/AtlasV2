// ─── Signal Library types ─────────────────────────────────────────────────────

export interface ParamSpec {
  key: string;
  label: string;
  type: 'string' | 'number' | 'array' | 'boolean';
}

export interface PlatformEventMapping {
  event_name: string;
  param_mapping: Record<string, string>;
  additional?: Record<string, string>;
}

export type SignalCategory = 'conversion' | 'engagement' | 'navigation' | 'custom';

export interface Signal {
  id: string;
  organisation_id: string | null;
  key: string;
  name: string;
  description: string;
  category: SignalCategory;
  is_system: boolean;
  is_custom: boolean;
  source_action_primitive: string | null;
  required_params: ParamSpec[];
  optional_params: ParamSpec[];
  platform_mappings: Record<string, PlatformEventMapping>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SignalPack {
  id: string;
  organisation_id: string | null;
  name: string;
  description: string | null;
  business_type: string;
  is_system: boolean;
  version: number;
  signals_count: number;
  created_at: string;
  updated_at: string;
}

export interface SignalPackSignal {
  id: string;
  pack_id: string;
  signal_id: string;
  stage_hint: string | null;
  is_required: boolean;
  display_order: number;
  signal?: Signal;  // joined
}

export interface SignalPackWithSignals extends SignalPack {
  signals: SignalPackSignal[];
}

// ─── Deployments ──────────────────────────────────────────────────────────────

export interface SignalOverride {
  enabled?: boolean;
  param_overrides?: Record<string, unknown>;
  stage_assignment?: string;
}

export interface Deployment {
  id: string;
  client_id: string;
  pack_id: string;
  signal_overrides: Record<string, SignalOverride>;
  deployed_at: string;
  last_generated_at: string | null;
  pack?: SignalPack;  // joined
}

export interface ClientOutput {
  id: string;
  client_id: string;
  output_type: 'gtm_container' | 'datalayer_spec' | 'implementation_guide';
  output_data: Record<string, unknown> | null;
  file_path: string | null;
  version: number;
  source_deployments: Array<{
    deployment_id: string;
    pack_id: string;
    pack_version: number;
  }>;
  generated_at: string;
}

// ─── Generation input types ───────────────────────────────────────────────────

export interface SignalWithOverrides {
  signal: Signal;
  stage_assignment: string | null;
  param_overrides: Record<string, unknown>;
  enabled: boolean;
}

export interface DeploymentWithSignals {
  deployment_id: string;
  pack_id: string;
  pack_name: string;
  signals: SignalWithOverrides[];
}

// ─── Request shapes ────────────────────────────────────────────────────────────

export interface CreateSignalRequest {
  organisation_id: string;
  key: string;
  name: string;
  description: string;
  category: SignalCategory;
  required_params?: ParamSpec[];
  optional_params?: ParamSpec[];
  platform_mappings?: Record<string, PlatformEventMapping>;
}

export interface UpdateSignalRequest {
  /** Rename the signal's event key (used for batch convention renames). */
  key?: string;
  name?: string;
  description?: string;
  category?: SignalCategory;
  required_params?: ParamSpec[];
  optional_params?: ParamSpec[];
  platform_mappings?: Record<string, PlatformEventMapping>;
}

export interface CreatePackRequest {
  organisation_id?: string;
  name: string;
  description?: string;
  business_type: string;
}

export interface DeployPackRequest {
  pack_id: string;
  signal_overrides?: Record<string, SignalOverride>;
}
