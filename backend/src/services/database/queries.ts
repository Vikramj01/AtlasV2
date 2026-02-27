import { supabaseAdmin } from './supabase';
import type { AuditRow, AuditStatus, FunnelType, Region, ValidationResult, ReportJSON } from '@/types/audit';

// ─── Audits ───────────────────────────────────────────────────────────────────

export async function createAudit(data: {
  user_id: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  test_email?: string;
  test_phone?: string;
}): Promise<AuditRow> {
  const { data: row, error } = await supabaseAdmin
    .from('audits')
    .insert({ ...data, status: 'queued', progress: 0 })
    .select()
    .single();

  if (error) throw new Error(`Failed to create audit: ${error.message}`);
  return row as AuditRow;
}

export async function getAudit(audit_id: string): Promise<AuditRow | null> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select()
    .eq('id', audit_id)
    .single();

  if (error) return null;
  return data as AuditRow;
}

export async function updateAuditStatus(
  audit_id: string,
  status: AuditStatus,
  extra?: { progress?: number; error_message?: string; completed_at?: string; browserbase_session_id?: string }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audits')
    .update({ status, ...extra })
    .eq('id', audit_id);

  if (error) throw new Error(`Failed to update audit status: ${error.message}`);
}

export async function countAuditsThisMonth(user_id: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from('audits')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user_id)
    .gte('created_at', startOfMonth.toISOString());

  if (error) throw new Error(`Failed to count audits: ${error.message}`);
  return count ?? 0;
}

// ─── Audit results ────────────────────────────────────────────────────────────

export async function saveValidationResults(
  audit_id: string,
  results: ValidationResult[]
): Promise<void> {
  const rows = results.map((r) => ({
    audit_id,
    validation_layer: r.validation_layer,
    rule_id: r.rule_id,
    status: r.status,
    severity: r.severity,
    technical_details: r.technical_details,
  }));

  const { error } = await supabaseAdmin.from('audit_results').insert(rows);
  if (error) throw new Error(`Failed to save validation results: ${error.message}`);
}

// ─── Audit reports ────────────────────────────────────────────────────────────

export async function saveReport(audit_id: string, report: ReportJSON): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audit_reports')
    .upsert({ audit_id, report_json: report });

  if (error) throw new Error(`Failed to save report: ${error.message}`);
}

export async function getReport(audit_id: string): Promise<ReportJSON | null> {
  const { data, error } = await supabaseAdmin
    .from('audit_reports')
    .select('report_json')
    .eq('audit_id', audit_id)
    .single();

  if (error) return null;
  return data.report_json as ReportJSON;
}
