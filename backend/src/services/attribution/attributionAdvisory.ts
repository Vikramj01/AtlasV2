/**
 * Attribution Chain Check PRD §8.1 — advisory (never blocking) surfacing of
 * a prior chain-check result at the point a client's outcome source config
 * has sync/delivery enabled (docs/prd/universal-outcome-ingestion.md §6.3).
 *
 * "Build the link, keep it advisory in v1" (§8.1): the pre-connection scan
 * and the connected source may be months apart, and the client may have
 * fixed things in between, so this never hard-blocks on a stale scan — it
 * only informs whoever is enabling sync that an earlier scan found (or
 * didn't find) a break, letting them decide whether to re-run the check
 * first.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import type { AttributionChainResult } from './chainModel';
import logger from '@/utils/logger';

export interface AttributionChainAdvisory {
  run_id: string;
  url: string;
  scanned_at: string | null;
  chain: AttributionChainResult;
}

interface SignalValidatorRunRow {
  id: string;
  url: string;
  completed_at: string | null;
  verdict: { attribution_chain?: AttributionChainResult } | null;
}

/**
 * The most recent completed Campaign Signal Validator run for this client
 * whose verdict carries a lead-gen attribution_chain result — null when
 * none exists (never scanned, or every past scan was ecommerce/saas, or
 * the lookup itself failed). Never throws: a failure here must never block
 * the sync-enable flow it only advises.
 */
export async function getLatestAttributionChainForClient(clientId: string): Promise<AttributionChainAdvisory | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('signal_validator_runs')
      .select('id, url, completed_at, verdict')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .not('verdict', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(20);

    if (error || !data) return null;

    for (const row of data as SignalValidatorRunRow[]) {
      if (row.verdict?.attribution_chain) {
        return { run_id: row.id, url: row.url, scanned_at: row.completed_at, chain: row.verdict.attribution_chain };
      }
    }
    return null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), clientId },
      '[attribution] Failed to look up a prior chain result — advisory omitted, sync-enable flow unaffected',
    );
    return null;
  }
}
