export type SignalCategory = 'conversion' | 'engagement' | 'navigation' | 'custom';

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

export interface WalkerOSMapping {
  entity: string;
  action: string;
  trigger: { type: 'load' | 'click' | 'submit'; selector?: string };
  data_mapping: Record<string, string>;
}

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
  walkeros_mapping: WalkerOSMapping | null;
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
  client_count?: number;
}

export interface SignalPackSignal {
  id: string;
  pack_id: string;
  signal_id: string;
  stage_hint: string | null;
  is_required: boolean;
  display_order: number;
  signal?: Signal;
}

export interface SignalPackWithSignals extends SignalPack {
  signals: SignalPackSignal[];
}
