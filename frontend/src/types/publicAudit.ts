export interface AuditFinding {
  check_id: string;
  label:    string;
  passed:   boolean;
  detail:   string;
  weight:   number;
}

export interface AuditSiteMeta {
  platform:      string | null;
  business_type: string;
  tags_detected: string[];
}

export type AuditStatus = 'pending' | 'scanning' | 'done' | 'failed';
export type AuditGrade  = 'A' | 'B' | 'C' | 'D';

export interface PublicAuditRun {
  token:       string;
  status:      AuditStatus;
  score?:      number;
  grade?:      AuditGrade;
  findings?:   AuditFinding[];
  ai_summary?: string;
  site_meta?:  AuditSiteMeta;
  error?:      string;
  expires_at:  string;
}

export interface SubmitAuditResponse {
  token:             string;
  estimated_seconds: number;
}
