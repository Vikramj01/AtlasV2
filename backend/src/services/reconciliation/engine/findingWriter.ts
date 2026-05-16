import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';
import type { FindingCode, FindingDimension, FindingSeverity } from '../codes/findingCodes';

export interface FindingInput {
  runId: string;
  organizationId: string;
  clientId: string;
  briefId?: string | null;
  objectiveId?: string | null;
  platform: string;
  dimension: FindingDimension;
  severity: FindingSeverity;
  findingCode: FindingCode;
  expected?: Record<string, unknown> | null;
  observed?: Record<string, unknown> | null;
  narrative: string;
  remediationHint?: string | null;
}

export async function writeFinding(input: FindingInput): Promise<void> {
  const { error } = await supabaseAdmin.from('reconciliation_findings').insert({
    run_id: input.runId,
    organization_id: input.organizationId,
    client_id: input.clientId,
    brief_id: input.briefId ?? null,
    objective_id: input.objectiveId ?? null,
    platform: input.platform,
    dimension: input.dimension,
    severity: input.severity,
    finding_code: input.findingCode,
    expected: input.expected ?? null,
    observed: input.observed ?? null,
    narrative: input.narrative,
    remediation_hint: input.remediationHint ?? null,
  });

  if (error) {
    logger.warn({ runId: input.runId, code: input.findingCode, err: error.message }, 'Failed to write finding');
  }
}

export async function finaliseRun(runId: string, status: 'succeeded' | 'partial' | 'failed', errorSummary?: string): Promise<void> {
  const { count } = await supabaseAdmin
    .from('reconciliation_findings')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId);

  const { error } = await supabaseAdmin
    .from('reconciliation_runs')
    .update({
      finished_at: new Date().toISOString(),
      status,
      total_findings: count ?? 0,
      error_summary: errorSummary ?? null,
    })
    .eq('id', runId);

  if (error) {
    logger.error({ runId, err: error.message }, 'Failed to finalise reconciliation run');
  }
}
