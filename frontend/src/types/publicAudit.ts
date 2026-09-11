import type { ReportJSON } from '@/types/audit';

export type AuditStatus = 'pending' | 'scanning' | 'done' | 'failed';

// A public (no-login) scan runs through the same Check Register v2 engine
// an authenticated scan does (backend/src/api/routes/publicAudit.ts) — the
// result is a real ReportJSON, not a separate lightweight shape.
export interface PublicAuditRun {
  token:       string;
  status:      AuditStatus;
  progress:    number;
  report:      ReportJSON | null;
  error:       string | null;
  expires_at:  string;
}

export interface SubmitAuditResponse {
  token:             string;
  estimated_seconds: number;
}
