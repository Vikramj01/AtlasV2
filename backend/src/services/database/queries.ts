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

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteAudit(auditId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audits')
    .delete()
    .eq('id', auditId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete audit: ${error.message}`);
}

// ─── Audit list (with report scores joined) ───────────────────────────────────

export interface AuditListItem {
  id: string;
  website_url: string;
  created_at: string;
  status: AuditStatus;
  signal_health: number | null;
  attribution_risk: string | null;
}

export async function listAudits(user_id: string): Promise<AuditListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select(`
      id,
      website_url,
      created_at,
      status,
      audit_reports (
        report_json
      )
    `)
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to list audits: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => {
    const reportRows = row['audit_reports'] as Array<{ report_json: ReportJSON }> | null;
    const report = reportRows?.[0]?.report_json ?? null;
    return {
      id: row['id'] as string,
      website_url: row['website_url'] as string,
      created_at: row['created_at'] as string,
      status: row['status'] as AuditStatus,
      signal_health: report?.executive_summary?.scores?.conversion_signal_health ?? null,
      attribution_risk: report?.executive_summary?.scores?.attribution_risk_level ?? null,
    };
  });
}

// ─── Previous audit score (for before/after comparison) ───────────────────────
// Returns the most recent *other* completed audit for the same user + website URL.

export async function getPreviousAuditScore(
  currentAuditId: string,
  websiteUrl: string,
  userId: string,
): Promise<{ audit_id: string; score: number; created_at: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select('id, created_at, audit_reports(report_json)')
    .eq('user_id', userId)
    .eq('website_url', websiteUrl)
    .eq('status', 'completed')
    .neq('id', currentAuditId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const reportRows = row['audit_reports'] as Array<{ report_json: ReportJSON }> | null;
  const score = reportRows?.[0]?.report_json?.executive_summary?.scores?.conversion_signal_health;
  if (score == null) return null;

  return {
    audit_id: row['id'] as string,
    score,
    created_at: row['created_at'] as string,
  };
}
