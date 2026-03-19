import type { FunnelType, Region } from './audit';

export type ScheduleFrequency = 'daily' | 'weekly';

export interface Schedule {
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
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleInput {
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
