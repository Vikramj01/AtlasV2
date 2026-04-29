/**
 * Crawl job processor.
 * Queue instance is defined in jobQueue.ts — this file registers the processor.
 * Import this file as a side-effect in worker.ts to activate the processor.
 */
import { crawlQueue } from '@/services/queue/jobQueue';
import { supabaseAdmin } from '@/services/database/supabase';
import { scanPageBatch } from './signalDetector';
import { writeSignalsToLibrary } from './signalWriter';
import { chunkArray } from './crawlHelpers';
import { logUsage } from '@/services/usage/usageLogger';
import type { CrawlJobData } from '@/types/crawl';
import logger from '@/utils/logger';

// Pages per Browserbase session — balance between session length and cost.
// 12 pages ≈ 8–12 minutes of session time, well within the per-session limit.
const PAGES_PER_SESSION = 12;

crawlQueue.process(async (job) => {
  const { org_id, crawl_run_id, pages, tier } = job.data as CrawlJobData;

  logger.info({ org_id, crawl_run_id, pageCount: pages.length, tier }, 'Crawl job started');

  // Mark run as started
  await supabaseAdmin
    .from('crawl_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', crawl_run_id);

  await job.progress(5);

  const batches = chunkArray(pages, PAGES_PER_SESSION);
  let totalBrowserMinutes = 0;
  let completedPages = 0;
  let failedPages = 0;
  let firstSessionId: string | null = null;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      const batchResult = await scanPageBatch(batch, org_id, crawl_run_id);
      totalBrowserMinutes += batchResult.browser_minutes_used;

      // Capture the session ID from the first batch for the run record
      if (i === 0) {
        firstSessionId = batchResult.browserbase_session_id;
        await supabaseAdmin
          .from('crawl_runs')
          .update({ browserbase_session_id: firstSessionId })
          .eq('id', crawl_run_id);
      }

      for (const pageResult of batchResult.page_results) {
        if (pageResult.error) {
          failedPages++;
          await supabaseAdmin
            .from('crawl_pages')
            .update({
              status:          'failed',
              error_message:   pageResult.error,
              scan_duration_ms: pageResult.scan_duration_ms,
              scanned_at:      new Date().toISOString(),
            })
            .eq('id', pageResult.crawl_page_id);
        } else {
          completedPages++;
          await writeSignalsToLibrary({
            org_id,
            crawl_run_id,
            crawl_page_id:   pageResult.crawl_page_id,
            scope_id:        pageResult.scope_id,
            signals:         pageResult.signals,
            http_status:     pageResult.http_status,
            scan_duration_ms: pageResult.scan_duration_ms,
          });
        }
      }

      // Fire-and-forget usage event for this batch
      logUsage({
        org_id,
        event_type:      'page_scan',
        browser_minutes: batchResult.browser_minutes_used,
        pages_scanned:   batch.length,
        job_id:          job.id?.toString(),
        scan_run_id:     crawl_run_id,
        metadata:        { browserbase_session_id: batchResult.browserbase_session_id },
      });

      const progress = Math.round(5 + ((i + 1) / batches.length) * 90);
      await job.progress(progress);
    } catch (batchError) {
      failedPages += batch.length;
      logger.error(
        { org_id, crawl_run_id, batch: i + 1, err: batchError instanceof Error ? batchError.message : String(batchError) },
        'Crawl batch failed',
      );

      // Mark all pages in the failed batch
      for (const page of batch) {
        await supabaseAdmin
          .from('crawl_pages')
          .update({
            status:        'failed',
            error_message: 'Batch processing failed',
            scanned_at:    new Date().toISOString(),
          })
          .eq('id', page.crawl_page_id);
      }
    }
  }

  const status = failedPages === 0
    ? 'completed'
    : completedPages === 0
      ? 'failed'
      : 'partial';

  await supabaseAdmin
    .from('crawl_runs')
    .update({
      status,
      pages_completed:      completedPages,
      pages_failed:         failedPages,
      browser_minutes_used: totalBrowserMinutes,
      completed_at:         new Date().toISOString(),
    })
    .eq('id', crawl_run_id);

  await job.progress(100);

  logger.info({ org_id, crawl_run_id, status, completedPages, failedPages }, 'Crawl job complete');
  return { status, completedPages, failedPages };
});

logger.info('Crawl queue worker registered');
