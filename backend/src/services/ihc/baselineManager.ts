/**
 * IHC Baseline Manager
 *
 * Manages the designated baseline crawl run per org and reconstructs
 * AuditData.crawlSignals from stored detected_signals rows.
 *
 * Baseline rules:
 * - At most one active baseline per org (enforced by this service; see promoteToBaseline).
 * - First completed crawl is auto-promoted when no baseline exists (autoPromoteIfNone).
 * - Manual promotion: promoteToBaseline(orgId, crawlRunId).
 */
import { supabaseAdmin } from '@/services/database/supabase';
import type { CrawlSignalSnapshot } from '@/types/audit';
import logger from '@/utils/logger';

// ── public types ──────────────────────────────────────────────────────────────

export interface BaselineInfo {
  crawl_run_id: string;
  set_at: string;           // crawl_runs.completed_at
  pages_completed: number;
  signals_total: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Load detected_signals joined with crawl_pages for a given crawl run
 * and return them as CrawlSignalSnapshot[].
 */
export async function reconstructCrawlSignals(
  crawlRunId: string,
): Promise<CrawlSignalSnapshot[]> {
  // detected_signals doesn't store page_url directly, so join via crawl_pages
  const { data, error } = await supabaseAdmin
    .from('detected_signals')
    .select(`
      signal_type,
      signal_name,
      signal_id,
      health_status,
      parameters,
      crawl_pages ( url )
    `)
    .eq('crawl_run_id', crawlRunId);

  if (error) {
    logger.error({ err: error.message, crawlRunId }, 'baselineManager: failed to load signals');
    return [];
  }

  return (data ?? []).map((row) => ({
    page_url: (row.crawl_pages as unknown as { url: string } | null)?.url ?? '',
    signal_type: row.signal_type as string,
    signal_name: row.signal_name as string | null,
    signal_id: row.signal_id as string | null,
    health_status: row.health_status as CrawlSignalSnapshot['health_status'],
    parameters: (row.parameters as Record<string, unknown> | null) ?? null,
  }));
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Returns the active baseline info for an org, or null if none is set.
 */
export async function getBaselineForOrg(orgId: string): Promise<BaselineInfo | null> {
  const { data, error } = await supabaseAdmin
    .from('crawl_runs')
    .select('id, completed_at, pages_completed')
    .eq('org_id', orgId)
    .eq('is_baseline', true)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error({ err: error.message, orgId }, 'baselineManager: getBaselineForOrg error');
    return null;
  }
  if (!data) return null;

  // Count signals for this run
  const { count } = await supabaseAdmin
    .from('detected_signals')
    .select('id', { count: 'exact', head: true })
    .eq('crawl_run_id', data.id);

  return {
    crawl_run_id: data.id as string,
    set_at: (data.completed_at ?? '') as string,
    pages_completed: (data.pages_completed as number) ?? 0,
    signals_total: count ?? 0,
  };
}

/**
 * Promotes crawlRunId to be the active baseline for its org.
 * Clears is_baseline on any previous baseline row for the same org.
 */
export async function promoteToBaseline(
  orgId: string,
  crawlRunId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Verify the run belongs to this org and is completed
  const { data: run, error: runErr } = await supabaseAdmin
    .from('crawl_runs')
    .select('id, org_id, status')
    .eq('id', crawlRunId)
    .eq('org_id', orgId)
    .single();

  if (runErr || !run) {
    return { ok: false, error: 'Crawl run not found or does not belong to this organisation' };
  }

  if (run.status !== 'completed' && run.status !== 'partial') {
    return { ok: false, error: `Crawl run status is "${run.status}"; only completed runs can be baselines` };
  }

  // Clear existing baselines for this org
  const { error: clearErr } = await supabaseAdmin
    .from('crawl_runs')
    .update({ is_baseline: false })
    .eq('org_id', orgId)
    .eq('is_baseline', true);

  if (clearErr) {
    logger.error({ err: clearErr.message, orgId }, 'baselineManager: failed to clear old baseline');
    return { ok: false, error: 'Failed to clear previous baseline' };
  }

  // Set the new baseline
  const { error: setErr } = await supabaseAdmin
    .from('crawl_runs')
    .update({ is_baseline: true })
    .eq('id', crawlRunId);

  if (setErr) {
    logger.error({ err: setErr.message, crawlRunId }, 'baselineManager: failed to set baseline');
    return { ok: false, error: 'Failed to set baseline' };
  }

  logger.info({ orgId, crawlRunId }, 'Baseline promoted');
  return { ok: true };
}

/**
 * If no baseline exists for this org, auto-promote the given crawl run.
 * Called after the first successful crawl to satisfy:
 * "First successful CSE crawl after IHC is enabled automatically becomes the baseline."
 */
export async function autoPromoteIfNone(orgId: string, crawlRunId: string): Promise<void> {
  const existing = await getBaselineForOrg(orgId);
  if (existing) return; // already have a baseline

  const result = await promoteToBaseline(orgId, crawlRunId);
  if (!result.ok) {
    logger.warn({ orgId, crawlRunId, error: result.error }, 'autoPromoteIfNone: promotion failed');
  } else {
    logger.info({ orgId, crawlRunId }, 'IHC: first baseline auto-promoted');
  }
}
