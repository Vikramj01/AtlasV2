import { supabaseAdmin } from './supabase';
import type {
  AuditRow, AuditStatus, FunnelType, Region, ValidationResult, ReportJSON,
  RuleSetVersion, SiteType, SecondaryMotion, DeclaredPlatform, TrafficRegion, CMP, DeclaredConversion, RunQuality,
  DeclarationSource, SignalConflict,
} from '@/types/audit';
import { sanitizeForJsonb } from '@/utils/sanitizeJsonb';

// ─── Audits ───────────────────────────────────────────────────────────────────

export async function createAudit(data: {
  // Omitted entirely for a public (no-login) scan — is_public: true instead.
  // See 20260914001_public_audit_check_register.sql.
  user_id?: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  test_email?: string;
  test_phone?: string;
  client_id?: string;
  // Check Register v2 Scan Inputs — present when rule_set_version === 'v2'.
  rule_set_version?: RuleSetVersion;
  site_type?: SiteType;
  secondary_motion?: SecondaryMotion;
  declared_platforms?: DeclaredPlatform[];
  declaration_source?: DeclarationSource;
  primary_channel?: DeclaredPlatform;
  monthly_spend_band?: string;
  traffic_regions?: TrafficRegion[];
  cmp?: CMP;
  product_domain?: string;
  checkout_domain?: string;
  additional_properties?: string[];
  declared_conversions?: DeclaredConversion[];
  // Public (no-login) scan fields — mutually exclusive with user_id.
  is_public?: boolean;
  ip_hash?: string;
  expires_at?: string;
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

/** Looks up a public (no-login) audit by its access token — the sole access mechanism for these rows, same model as the old public_audit_runs table. */
export async function getAuditByPublicToken(token: string): Promise<AuditRow | null> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select()
    .eq('public_token', token)
    .eq('is_public', true)
    .single();

  if (error) return null;
  return data as AuditRow;
}

/** Records the lead-capture email a public-scan visitor entered to unlock their report. */
export async function setAuditLeadEmail(audit_id: string, email: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audits')
    .update({ lead_email: email })
    .eq('id', audit_id)
    .eq('is_public', true);

  if (error) throw new Error(`Failed to save lead email: ${error.message}`);
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

/**
 * Persists coverage_fingerprint/pages_distinct (Site Evaluation Coverage &
 * Honesty PRD §9), register_version/conversion_signal_health_numerator/
 * _denominator (Report Correctness Programme PRD Part D3/D4), and
 * run_quality (Pre-Connection Scan Confidence Tiering PRD §7.3) onto the
 * audits row — see 20260903002_audit_coverage_fingerprint.sql,
 * 20260906002_score_comparability.sql and
 * 20260911001_settle_contract_run_quality.sql. All fields undefined for an
 * AuditData/score shape that never computed them (Journey-Builder mode, a
 * v1-legacy audit, a run predating these fields); called unconditionally
 * by the orchestrator regardless, so the columns are simply left null
 * rather than needing a separate skip-if-absent branch at every call site.
 */
export async function updateAuditCoverage(
  audit_id: string,
  fields: {
    coverage_fingerprint?: string;
    pages_distinct?: number;
    register_version?: string;
    conversion_signal_health_numerator?: number;
    conversion_signal_health_denominator?: number;
    run_quality?: RunQuality;
  },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audits')
    .update({
      coverage_fingerprint: fields.coverage_fingerprint ?? null,
      pages_distinct: fields.pages_distinct ?? null,
      register_version: fields.register_version ?? null,
      conversion_signal_health_numerator: fields.conversion_signal_health_numerator ?? null,
      conversion_signal_health_denominator: fields.conversion_signal_health_denominator ?? null,
      run_quality: fields.run_quality ?? null,
    })
    .eq('id', audit_id);

  if (error) throw new Error(`Failed to update audit coverage: ${error.message}`);
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
    technical_details: sanitizeForJsonb(r.technical_details),
  }));

  const { error } = await supabaseAdmin.from('audit_results').insert(rows);
  if (error) throw new Error(`Failed to save validation results: ${error.message}`);
}

// ─── Signal conflicts (Pre-Connection Scan Confidence Tiering PRD §6) ─────────

/**
 * Persists every conflict signalConsistency.ts's partitionSignalConflicts()
 * found on this run — purely for audit/debugging visibility (the report
 * itself reads the equivalent could_not_be_assessed entries already
 * embedded in report_json, not this table). A no-op on an empty array, so
 * callers don't need to special-case "nothing conflicted".
 */
export async function saveSignalConflicts(audit_id: string, conflicts: SignalConflict[]): Promise<void> {
  if (conflicts.length === 0) return;

  const rows = conflicts.map((c) => ({
    audit_id,
    assertion_id: c.assertion_id,
    entity: c.entity,
    source_a: c.source_a,
    reading_a: c.reading_a,
    source_b: c.source_b,
    reading_b: c.reading_b,
    affected_rule_ids: sanitizeForJsonb(c.affected_rule_ids),
  }));

  const { error } = await supabaseAdmin.from('signal_conflicts').insert(rows);
  if (error) throw new Error(`Failed to save signal conflicts: ${error.message}`);
}

// ─── Audit reports ────────────────────────────────────────────────────────────

export async function saveReport(audit_id: string, report: ReportJSON): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audit_reports')
    .upsert({ audit_id, report_json: sanitizeForJsonb(report) });

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

export async function linkAuditToClient(auditId: string, clientId: string, userId: string): Promise<AuditRow> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .update({ client_id: clientId })
    .eq('id', auditId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to link audit to client: ${error.message}`);
  return data as AuditRow;
}

// ─── Audit list (with report scores joined) ───────────────────────────────────

export interface AuditListItem {
  id: string;
  website_url: string;
  created_at: string;
  status: AuditStatus;
  signal_health: number | null;
  attribution_risk: string | null;
  client_id: string | null;
}

export async function listAudits(user_id: string): Promise<AuditListItem[]> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select(`
      id,
      website_url,
      created_at,
      status,
      client_id,
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
      client_id: (row['client_id'] as string | null) ?? null,
    };
  });
}

// ─── Previous audit score (for before/after comparison) ───────────────────────
// Returns the most recent *other* completed audit for the same user + website URL.

export async function getPreviousAuditScore(
  currentAuditId: string,
  websiteUrl: string,
  userId: string,
): Promise<{
  audit_id: string;
  score: number;
  created_at: string;
  /** Report Correctness Programme PRD Part D3 — null for a run predating these columns, or a v1-legacy audit. */
  denominator: number | null;
  register_version: string | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select('id, created_at, conversion_signal_health_denominator, register_version, audit_reports(report_json)')
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
    denominator: (row['conversion_signal_health_denominator'] as number | null) ?? null,
    register_version: (row['register_version'] as string | null) ?? null,
  };
}
