/**
 * IHC Findings Writer
 *
 * Upserts rows in audit_findings based on rule results from a tag_configuration
 * or implementation_drift rules run.
 *
 * Upsert logic:
 *   - Match on (organization_id, property_id, rule_id)
 *   - If existing row is 'open': update last_seen_at + evidence
 *   - If existing row is 'resolved': re-open and reset resolved_at
 *   - If no existing row: insert with status 'open'
 *   - If rule passed and row exists as 'open': mark resolved
 */

import { supabaseAdmin } from '@/services/database/supabase';
import type { ValidationLayer, Severity } from '@/types/audit';
import logger from '@/utils/logger';

export interface FindingInput {
  organization_id: string;
  client_id?: string;
  property_id: string;
  rule_id: string;
  validation_layer: ValidationLayer;
  severity: Severity;
  evidence: Record<string, unknown>;
}

export async function upsertFindings(
  passing: string[],    // rule_ids that passed
  failing: FindingInput[],
): Promise<void> {
  if (failing.length === 0 && passing.length === 0) return;

  const now = new Date().toISOString();

  // ── Write / update open findings ─────────────────────────────────────────

  for (const finding of failing) {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('audit_findings')
      .select('id, status, first_detected_at')
      .eq('organization_id', finding.organization_id)
      .eq('property_id', finding.property_id)
      .eq('rule_id', finding.rule_id)
      .maybeSingle();

    if (fetchErr) {
      logger.error({ err: fetchErr.message, ruleId: finding.rule_id }, 'findingsWriter: fetch error');
      continue;
    }

    if (existing) {
      await supabaseAdmin
        .from('audit_findings')
        .update({
          status: 'open',
          severity: finding.severity,
          evidence: finding.evidence,
          last_seen_at: now,
          resolved_at: null,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      const { error: insertErr } = await supabaseAdmin.from('audit_findings').insert({
        organization_id: finding.organization_id,
        client_id: finding.client_id ?? null,
        property_id: finding.property_id,
        rule_id: finding.rule_id,
        validation_layer: finding.validation_layer,
        severity: finding.severity,
        status: 'open',
        evidence: finding.evidence,
        first_detected_at: now,
        last_seen_at: now,
      });

      if (insertErr) {
        logger.error({ err: insertErr.message, ruleId: finding.rule_id }, 'findingsWriter: insert error');
      }
    }
  }

  // ── Resolve findings that now pass ───────────────────────────────────────

  for (const ruleId of passing) {
    await supabaseAdmin
      .from('audit_findings')
      .update({ status: 'resolved', resolved_at: now, updated_at: now })
      .eq('rule_id', ruleId)
      .eq('status', 'open');
  }
}

/**
 * Upserts drift-layer findings with 2-run suppression.
 *
 * On first failure: inserts with status='suppressed', consecutive_fail_count=1.
 * On second consecutive failure: upgrades to status='open'.
 * On pass after open: resolves. On pass while suppressed: resets count.
 */
export async function upsertDriftFindings(
  passing: string[],
  failing: FindingInput[],
): Promise<void> {
  if (failing.length === 0 && passing.length === 0) return;

  const now = new Date().toISOString();

  // ── Handle failing rules ───────────────────────────────────────────────────

  for (const finding of failing) {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('audit_findings')
      .select('id, status, consecutive_fail_count')
      .eq('organization_id', finding.organization_id)
      .eq('property_id', finding.property_id)
      .eq('rule_id', finding.rule_id)
      .maybeSingle();

    if (fetchErr) {
      logger.error({ err: fetchErr.message, ruleId: finding.rule_id }, 'upsertDriftFindings: fetch error');
      continue;
    }

    if (existing) {
      const prevCount = (existing.consecutive_fail_count as number) ?? 0;
      const newCount = prevCount + 1;
      const newStatus = newCount >= 2 ? 'open' : 'suppressed';

      await supabaseAdmin
        .from('audit_findings')
        .update({
          status: newStatus,
          severity: finding.severity,
          evidence: finding.evidence,
          last_seen_at: now,
          resolved_at: null,
          consecutive_fail_count: newCount,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      const { error: insertErr } = await supabaseAdmin.from('audit_findings').insert({
        organization_id: finding.organization_id,
        client_id: finding.client_id ?? null,
        property_id: finding.property_id,
        rule_id: finding.rule_id,
        validation_layer: finding.validation_layer,
        severity: finding.severity,
        status: 'suppressed',   // first failure: hold until 2nd consecutive run
        evidence: finding.evidence,
        first_detected_at: now,
        last_seen_at: now,
        consecutive_fail_count: 1,
      });

      if (insertErr) {
        logger.error({ err: insertErr.message, ruleId: finding.rule_id }, 'upsertDriftFindings: insert error');
      }
    }
  }

  // ── Handle passing rules ───────────────────────────────────────────────────

  for (const ruleId of passing) {
    // Resolve open findings
    await supabaseAdmin
      .from('audit_findings')
      .update({ status: 'resolved', resolved_at: now, consecutive_fail_count: 0, updated_at: now })
      .eq('rule_id', ruleId)
      .eq('status', 'open');

    // Reset suppressed findings (transient flap)
    await supabaseAdmin
      .from('audit_findings')
      .update({ status: 'resolved', resolved_at: now, consecutive_fail_count: 0, updated_at: now })
      .eq('rule_id', ruleId)
      .eq('status', 'suppressed');
  }
}
