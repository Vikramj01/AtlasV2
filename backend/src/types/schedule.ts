// ─── Scheduled Audit types ────────────────────────────────────────────────────

import type {
  FunnelType, Region, RuleSetVersion, SiteType, SecondaryMotion, DeclaredPlatform,
  TrafficRegion, CMP, DeclaredConversion,
} from './audit';

export type ScheduleFrequency = 'daily' | 'weekly';

/**
 * Check Register v2 Scan Inputs, persisted on the schedule so a recurring
 * re-run is scored by the same engine as the audit it was set up from —
 * see 20260903001_scheduled_audit_scan_inputs.sql (Site Evaluation
 * Coverage & Honesty PRD §6.7). All optional: a schedule with none of
 * these set is a plain v1-legacy schedule, same as before this field
 * existed. No current UI path populates these yet (POST /api/schedules'
 * only caller, ScheduleModal.tsx, is a v1-shaped form) — they exist so the
 * schedule/audit pipeline can actually carry v2 config end to end once one
 * does, the same way createAudit/AuditJobData already can.
 */
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

export interface ScheduleRow extends ScheduleScanInputs {
  id: string;
  user_id: string;
  name: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  url_map: Record<string, string>;
  frequency: ScheduleFrequency;
  /** 0 = Sunday … 6 = Saturday. Null for daily schedules. */
  day_of_week: number | null;
  /** UTC hour (0–23) when the audit runs */
  hour_utc: number;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_audit_id: string | null;
  last_audit_score: number | null;
  /** Set alongside last_audit_score by updateScheduleScore() — lets the regression comparator skip a false alert when the compared runs used different rule libraries. */
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

export interface UpdateScheduleInput {
  name?: string;
  frequency?: ScheduleFrequency;
  day_of_week?: number | null;
  hour_utc?: number;
  is_active?: boolean;
}
