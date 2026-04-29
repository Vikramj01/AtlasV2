import { supabaseAdmin } from '@/services/database/supabase';
import type { WriteSignalsArgs } from '@/types/crawl';
import logger from '@/utils/logger';

/**
 * Writes scan results for one page to crawl_pages, detected_signals,
 * and updates org_page_scope.last_crawled_at.
 *
 * crawl_page_id: the auto-generated crawl_pages.id (set by the route/trigger)
 * scope_id:      the org_page_scope.id (for updating last_crawled_at)
 */
export async function writeSignalsToLibrary(args: WriteSignalsArgs): Promise<void> {
  const { org_id, crawl_run_id, crawl_page_id, scope_id, signals, http_status, scan_duration_ms } = args;

  const healthy  = signals.filter(s => s.health_status === 'healthy').length;
  const degraded = signals.filter(s =>
    s.health_status === 'degraded' || s.health_status === 'misconfigured',
  ).length;
  const missing  = signals.filter(s => s.health_status === 'missing').length;

  // Update crawl_pages record to completed
  const { error: pageError } = await supabaseAdmin
    .from('crawl_pages')
    .update({
      status:           'completed',
      http_status,
      scan_duration_ms,
      signals_found:    signals.length,
      signals_healthy:  healthy,
      signals_degraded: degraded,
      signals_missing:  missing,
      scanned_at:       new Date().toISOString(),
    })
    .eq('id', crawl_page_id);

  if (pageError) {
    logger.warn({ crawl_page_id, err: pageError.message }, 'Failed to update crawl_pages');
  }

  // Insert detected signals
  if (signals.length > 0) {
    const signalRows = signals.map(signal => ({
      crawl_page_id,
      crawl_run_id,
      org_id,
      signal_type:       signal.signal_type,
      signal_name:       signal.signal_name,
      signal_id:         signal.signal_id,
      health_status:     signal.health_status,
      health_score:      signal.health_score,
      detected_at:       signal.detected_at,
      firing_triggers:   signal.firing_triggers,
      parameters:        signal.parameters,
      issues:            signal.issues,
      first_seen_run_id: crawl_run_id,
      is_regression:     false,
    }));

    const { error: signalError } = await supabaseAdmin
      .from('detected_signals')
      .insert(signalRows);

    if (signalError) {
      logger.warn(
        { crawl_page_id, count: signals.length, err: signalError.message },
        'Failed to insert detected_signals',
      );
    }
  }

  // Update last_crawled_at on org_page_scope
  const { error: scopeError } = await supabaseAdmin
    .from('org_page_scope')
    .update({ last_crawled_at: new Date().toISOString() })
    .eq('id', scope_id);

  if (scopeError) {
    logger.warn({ scope_id, err: scopeError.message }, 'Failed to update org_page_scope.last_crawled_at');
  }
}
