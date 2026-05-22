// DQM Orchestrator — runs all DQM checks for a single org

import { probeGTGPath, saveGTGCheck } from './gtgProbe';
import { pollDMADiagnostics, upsertDMAPollState } from './dmaPolling';
import logger from '@/utils/logger';

export async function runDQMForOrg(orgId: string): Promise<void> {
  logger.info({ orgId }, 'DQM: starting checks');

  const [gtgResult, dmaResult] = await Promise.allSettled([
    probeGTGPath(orgId).then(async (r) => {
      if (r.gtagUrl) await saveGTGCheck(orgId, r.gtagUrl, r);
      return r;
    }),
    pollDMADiagnostics(orgId).then(async (r) => {
      await upsertDMAPollState(orgId, r);
      return r;
    }),
  ]);

  if (gtgResult.status === 'rejected') logger.error({ err: gtgResult.reason, orgId }, 'DQM: GTG probe failed');
  if (dmaResult.status === 'rejected') logger.error({ err: dmaResult.reason, orgId }, 'DQM: DMA poll failed');

  logger.info({ orgId }, 'DQM: checks complete');
}

export async function runDQMForAllActiveOrgs(): Promise<void> {
  const { supabaseAdmin } = await import('@/services/database/supabase');

  // Orgs that have enricher_runs OR gtm_container_connections in the last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [enricherOrgs, gtmOrgs] = await Promise.all([
    supabaseAdmin.from('enricher_runs').select('org_id').gte('created_at', since),
    supabaseAdmin.from('gtm_container_connections').select('organization_id'),
  ]);

  const orgIds = new Set<string>();
  for (const r of enricherOrgs.data ?? []) orgIds.add((r as { org_id: string }).org_id);
  for (const r of gtmOrgs.data ?? []) orgIds.add((r as { organization_id: string }).organization_id);

  logger.info({ count: orgIds.size }, 'DQM: running for active orgs');

  for (const orgId of orgIds) {
    try {
      await runDQMForOrg(orgId);
    } catch (err) {
      logger.error({ err, orgId }, 'DQM: orchestrator error for org');
    }
  }
}
