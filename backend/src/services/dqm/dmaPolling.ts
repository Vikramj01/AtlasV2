// DMA Diagnostics Polling — derives match rate and success stats from enricher_runs
// For v1, data comes from our own enricher_runs table rather than a live DMA diagnostics endpoint.
// The DMA diagnostics API endpoint is polled in a future sprint when OAuth token scope is extended.

import { supabaseAdmin } from '@/services/database/supabase';
import logger from '@/utils/logger';

export interface DMADiagnosticsResult {
  uploadSuccessRate: number;  // 0–100
  avgMatchRate: number | null;
  totalMembers30d: number;
  destinationCount: number;
  errorCategories: Record<string, number>;
}

export async function pollDMADiagnostics(orgId: string): Promise<DMADiagnosticsResult> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('enricher_runs')
    .select('status, matched_count, record_count, dma_response, destinations')
    .eq('org_id', orgId)
    .gte('created_at', since);

  if (error) throw error;

  type RunRow = {
    status: string;
    matched_count: number | null;
    record_count: number;
    dma_response: unknown;
    destinations: unknown[];
  };
  const rows = (data ?? []) as RunRow[];

  if (rows.length === 0) {
    return { uploadSuccessRate: 0, avgMatchRate: null, totalMembers30d: 0, destinationCount: 0, errorCategories: {} };
  }

  const completed = rows.filter(r => r.status === 'completed');
  const uploadSuccessRate = Math.round((completed.length / rows.length) * 100);

  const totalMembers30d = rows.reduce((s, r) => s + r.record_count, 0);
  const totalMatched = completed.reduce((s, r) => s + (r.matched_count ?? 0), 0);
  const totalCompletedMembers = completed.reduce((s, r) => s + r.record_count, 0);
  const avgMatchRate = totalCompletedMembers > 0
    ? Math.round((totalMatched / totalCompletedMembers) * 100 * 100) / 100
    : null;

  // Count unique destination types across all runs
  const destSet = new Set<string>();
  for (const r of rows) {
    if (Array.isArray(r.destinations)) {
      for (const d of r.destinations as Array<{ type?: string }>) {
        if (d.type) destSet.add(d.type);
      }
    }
  }

  const errorCategories: Record<string, number> = {};
  for (const r of rows.filter(r => r.status === 'failed')) {
    const cat = 'delivery_failure';
    errorCategories[cat] = (errorCategories[cat] ?? 0) + 1;
  }

  return { uploadSuccessRate, avgMatchRate, totalMembers30d, destinationCount: destSet.size, errorCategories };
}

export async function upsertDMAPollState(orgId: string, result: DMADiagnosticsResult): Promise<void> {
  const { error } = await supabaseAdmin
    .from('dqm_dma_poll_state')
    .upsert({
      org_id: orgId,
      last_polled_at: new Date().toISOString(),
      last_successful_at: new Date().toISOString(),
      upload_success_rate: result.uploadSuccessRate,
      avg_match_rate: result.avgMatchRate,
      total_members_30d: result.totalMembers30d,
      destination_count: result.destinationCount,
      error_categories: result.errorCategories,
      backoff_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' });

  if (error) logger.error({ error, orgId }, 'DQM: failed to upsert DMA poll state');
}
