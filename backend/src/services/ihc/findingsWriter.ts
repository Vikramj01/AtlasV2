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
