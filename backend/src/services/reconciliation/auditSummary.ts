/**
 * Resolves `AuditData.reconciliation_summary` for a client-linked audit (GA4
 * Admin / L11 / Junk Gate PRD §B.3). "Resolve outside, read inside" (Key
 * Technical Decision §16): the L11 rules are pure and read only this.
 *
 * Returns undefined — never an empty summary — when the client has no
 * completed reconciliation run, so the L11 rules are `skipped` rather than
 * reporting a clean result about data that does not exist.
 *
 * Every read beyond the run + its findings (topology, client-scoped tracking
 * changes) is best-effort: a failure there drops that context, never the run's
 * own findings.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { getCurrentTopologyRows } from '@/services/database/googleTagTopologyQueries';
import { computeTopologyVerdict } from '@/services/google/googleTagTopology';
import type { ReconciliationSummary, ReconciliationSummaryFinding } from '@/types/audit';
import logger from '@/utils/logger';

export async function resolveReconciliationSummary(clientId: string): Promise<ReconciliationSummary | undefined> {
  const { data: run, error } = await supabaseAdmin
    .from('reconciliation_runs')
    .select('id, finished_at')
    .eq('client_id', clientId)
    .in('status', ['succeeded', 'partial'])
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !run) return undefined;

  const { id: runId, finished_at } = run as { id: string; finished_at: string };

  const { data: findings, error: fErr } = await supabaseAdmin
    .from('reconciliation_findings')
    .select('platform, dimension, severity, finding_code, resolved_at, narrative')
    .eq('run_id', runId)
    .is('resolved_at', null);
  if (fErr) {
    logger.warn({ clientId, runId, err: fErr.message }, 'L11: reading reconciliation findings failed — treating as no data');
    return undefined;
  }

  const summary: ReconciliationSummary = {
    run_id: runId,
    run_completed_at: finished_at,
    findings: (findings ?? []) as ReconciliationSummaryFinding[],
  };

  try {
    const { verdict, strength } = computeTopologyVerdict(await getCurrentTopologyRows(clientId));
    summary.google_tag_topology = { verdict, strength };
  } catch (err) {
    logger.warn({ clientId, err: err instanceof Error ? err.message : String(err) }, 'L11: topology read failed — omitted');
  }

  try {
    const { data: changes } = await supabaseAdmin
      .from('platform_discontinuities')
      .select('platform, title, effective_date')
      .eq('kind', 'client_tracking_change')
      .eq('client_id', clientId);
    summary.tracking_changes = (changes ?? []) as NonNullable<ReconciliationSummary['tracking_changes']>;
  } catch (err) {
    logger.warn({ clientId, err: err instanceof Error ? err.message : String(err) }, 'L11: tracking changes read failed — omitted');
  }

  return summary;
}

/**
 * Sets the two L11 inputs on a v2 AuditData before runRegister(): `client_linked`
 * (this audit has a client) and, for a linked client with a completed run,
 * `reconciliation_summary`. Non-fatal by contract — a failed lookup leaves the
 * summary undefined, so L11 is skipped rather than the audit failing. A
 * bare-URL or public no-login scan (no client) stays `client_linked: false`.
 */
export async function attachReconciliationInputs(
  auditData: { client_linked?: boolean; reconciliation_summary?: ReconciliationSummary },
  clientId: string | null | undefined,
  resolve: (clientId: string) => Promise<ReconciliationSummary | undefined> = resolveReconciliationSummary,
): Promise<void> {
  auditData.client_linked = !!clientId;
  if (!clientId) return;
  try {
    auditData.reconciliation_summary = await resolve(clientId);
  } catch (err) {
    logger.warn({ clientId, err: err instanceof Error ? err.message : String(err) }, 'Failed to resolve reconciliation summary');
  }
}
