/**
 * rule_confirmations queries (Pre-Connection Scan Confidence Tiering PRD
 * §15 — measured accuracy). See the migration
 * (20260913001_rule_confirmations.sql) for the full data-model rationale.
 */
import { supabaseAdmin } from './supabase';
import type { ReportJSON, RuleConfirmation, RuleConfirmationOutcome, RuleConfirmationSource, ValidationResult } from '@/types/audit';

export interface SaveRuleConfirmationInput {
  audit_id: string;
  rule_id: string;
  outcome: RuleConfirmationOutcome;
  source: RuleConfirmationSource;
  note?: string | null;
  /** See the migration's note on why this stays unused today — accepted here only for forward compatibility. */
  finding_id?: string | null;
}

function toRuleConfirmation(row: Record<string, unknown>): RuleConfirmation {
  return {
    id: row['id'] as string,
    audit_id: row['audit_id'] as string,
    rule_id: row['rule_id'] as string,
    finding_id: (row['finding_id'] as string | null) ?? null,
    outcome: row['outcome'] as RuleConfirmationOutcome,
    source: row['source'] as RuleConfirmationSource,
    note: (row['note'] as string | null) ?? null,
    created_at: row['created_at'] as string,
  };
}

export async function saveRuleConfirmation(input: SaveRuleConfirmationInput): Promise<RuleConfirmation> {
  const { data, error } = await supabaseAdmin
    .from('rule_confirmations')
    .insert({
      audit_id: input.audit_id,
      rule_id: input.rule_id,
      outcome: input.outcome,
      source: input.source,
      note: input.note ?? null,
      finding_id: input.finding_id ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to save rule confirmation: ${error?.message ?? 'no row returned'}`);
  return toRuleConfirmation(data as Record<string, unknown>);
}

/** A no-op on an empty array, so callers (the rescan comparator) don't need to special-case "nothing to write". */
export async function saveRuleConfirmations(inputs: SaveRuleConfirmationInput[]): Promise<void> {
  if (inputs.length === 0) return;

  const rows = inputs.map((input) => ({
    audit_id: input.audit_id,
    rule_id: input.rule_id,
    outcome: input.outcome,
    source: input.source,
    note: input.note ?? null,
    finding_id: input.finding_id ?? null,
  }));

  const { error } = await supabaseAdmin.from('rule_confirmations').insert(rows);
  if (error) throw new Error(`Failed to save rule confirmations: ${error.message}`);
}

export async function getRuleConfirmationsForAudit(auditId: string): Promise<RuleConfirmation[]> {
  const { data, error } = await supabaseAdmin
    .from('rule_confirmations')
    .select()
    .eq('audit_id', auditId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(toRuleConfirmation);
}

/**
 * The immediately-previous *v2* audit's full per-rule results for the same
 * user + website — the rescan comparator's input (ruleConfirmationRescan.ts).
 * Deliberately does not gate on the previous run's score being non-null
 * (unlike getPreviousAuditScore) — a per-rule verdict is still meaningful
 * evidence even when Sprint 5's coverage gate withheld the aggregate score.
 */
export async function getPreviousAuditResults(
  currentAuditId: string,
  websiteUrl: string,
  userId: string,
): Promise<{ audit_id: string; created_at: string; results: ValidationResult[] } | null> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select('id, created_at, rule_set_version, audit_reports(report_json)')
    .eq('user_id', userId)
    .eq('website_url', websiteUrl)
    .eq('status', 'completed')
    .eq('rule_set_version', 'v2')
    .neq('id', currentAuditId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const reportRows = row['audit_reports'] as Array<{ report_json: ReportJSON }> | null;
  const results = reportRows?.[0]?.report_json?.technical_appendix?.validation_results;
  if (!results) return null;

  return {
    audit_id: row['id'] as string,
    created_at: row['created_at'] as string,
    results,
  };
}

export interface RuleConfirmationStats {
  rule_id: string;
  confirmed: number;
  refuted: number;
  unknown: number;
}

/**
 * PRD §15's "internal" use — a per-rule confirmed/refuted count, for a
 * future admin tool to identify a rule whose absence claims are refuted
 * repeatedly and needs its gated direction tightened or its detector
 * fixed. Not surfaced anywhere client-facing, and computes no accuracy
 * percentage or publication-readiness judgment — raw counts only.
 */
export async function getRuleConfirmationStats(ruleId?: string): Promise<RuleConfirmationStats[]> {
  let query = supabaseAdmin.from('rule_confirmations').select('rule_id, outcome');
  if (ruleId) query = query.eq('rule_id', ruleId);

  const { data, error } = await query;
  if (error || !data) return [];

  const byRule = new Map<string, RuleConfirmationStats>();
  for (const row of data as { rule_id: string; outcome: RuleConfirmationOutcome }[]) {
    let stats = byRule.get(row.rule_id);
    if (!stats) {
      stats = { rule_id: row.rule_id, confirmed: 0, refuted: 0, unknown: 0 };
      byRule.set(row.rule_id, stats);
    }
    if (row.outcome === 'CONFIRMED') stats.confirmed += 1;
    else if (row.outcome === 'REFUTED') stats.refuted += 1;
    else stats.unknown += 1;
  }

  return [...byRule.values()];
}
