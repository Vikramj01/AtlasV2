import type {
  FunnelType, Region, RuleSetVersion, SiteType, SecondaryMotion, DeclaredPlatform,
  TrafficRegion, CMP, DeclaredConversion,
} from './audit';

export type ScheduleFrequency = 'daily' | 'weekly';

/** Check Register v2 Scan Inputs, optionally persisted on the schedule — see backend/src/types/schedule.ts's docstring. */
export interface ScheduleScanInputs {
  rule_set_version?: RuleSetVersion;
  site_type?: SiteType;
  secondary_motion?: SecondaryMotion;
  declared_platforms?: DeclaredPlatform[];
  primary_channel?: DeclaredPlatform;
  monthly_spend_band?: string;
  traffic_regions?: TrafficRegion[];
  cmp?: CMP;
  product_domain?: string;
  checkout_domain?: string;
  additional_properties?: string[];
  declared_conversions?: DeclaredConversion[];
}

export interface Schedule extends ScheduleScanInputs {
  id: string;
  user_id: string;
  name: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  url_map: Record<string, string>;
  frequency: ScheduleFrequency;
  /** 0 = Sunday … 6 = Saturday. Null for daily. */
  day_of_week: number | null;
  hour_utc: number;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_audit_id: string | null;
  last_audit_score: number | null;
  last_audit_rule_set_version?: RuleSetVersion | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleInput extends ScheduleScanInputs {
  name: string;
  website_url: string;
  funnel_type: FunnelType;
  region?: Region;
  url_map: Record<string, string>;
  frequency: ScheduleFrequency;
  day_of_week?: number | null;
  hour_utc?: number;
  test_email?: string;
  test_phone?: string;
}
