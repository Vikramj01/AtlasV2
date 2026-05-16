import { supabaseAdmin } from '@/services/database/supabase';
import { runConfigDiff } from './engine/configDiff';
import { runAlignmentDiff } from './engine/alignmentDiff';
import { runDeliveryDiff } from './engine/deliveryDiff';
import { runVolumeDiff } from './engine/volumeDiff';
import { finaliseRun } from './engine/findingWriter';
import logger from '@/utils/logger';

export interface ReconciliationJobData {
  runId: string;
  organizationId: string;
  clientId: string;
  briefId?: string | null;
  runType: 'scheduled' | 'manual' | 'post_brief_lock';
}

export async function createRun(
  organizationId: string,
  clientId: string,
  runType: 'scheduled' | 'manual' | 'post_brief_lock',
  briefId?: string | null,
): Promise<string> {
  // Determine which platforms have active connections for this client
  const { data: connections } = await supabaseAdmin
    .from('platform_connections')
    .select('platform')
    .eq('client_id', clientId)
    .eq('status', 'active');

  const platforms = [...new Set((connections ?? []).map((c) => c.platform as string))];

  const { data, error } = await supabaseAdmin
    .from('reconciliation_runs')
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      brief_id: briefId ?? null,
      run_type: runType,
      platforms_run: platforms,
      status: 'running',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create reconciliation run: ${error?.message}`);
  }

  return (data as { id: string }).id;
}

export async function executeRun(job: ReconciliationJobData): Promise<void> {
  const { runId, organizationId, clientId, briefId } = job;

  logger.info({ runId, clientId, runType: job.runType }, 'Reconciliation run started');

  const errors: string[] = [];

  try {
    if (briefId) {
      // Config diff: compare brief recommendations vs platform conversion action setup
      await runConfigDiff(runId, clientId, briefId, organizationId).catch((err: Error) => {
        errors.push(`config: ${err.message}`);
        logger.error({ runId, err: err.message }, 'Config diff failed');
      });

      // Alignment diff: compare brief primary/suppression tiers vs live campaign goals
      await runAlignmentDiff(runId, clientId, briefId, organizationId).catch((err: Error) => {
        errors.push(`alignment: ${err.message}`);
        logger.error({ runId, err: err.message }, 'Alignment diff failed');
      });
    }

    // Delivery + volume diffs run on all run types (skip gracefully when no stats data exists)
    await runDeliveryDiff(runId, clientId, briefId ?? null, organizationId).catch((err: Error) => {
      errors.push(`delivery: ${err.message}`);
      logger.error({ runId, err: err.message }, 'Delivery diff failed');
    });

    await runVolumeDiff(runId, clientId, briefId ?? null, organizationId).catch((err: Error) => {
      errors.push(`volume: ${err.message}`);
      logger.error({ runId, err: err.message }, 'Volume diff failed');
    });

    const status = errors.length === 0 ? 'succeeded' : 'partial';
    await finaliseRun(runId, status, errors.length > 0 ? errors.join('; ') : undefined);

    logger.info({ runId, status }, 'Reconciliation run finished');
  } catch (err) {
    await finaliseRun(runId, 'failed', (err as Error).message).catch(() => null);
    throw err;
  }
}
