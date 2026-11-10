// Runs the Google tag gateway checks for an org (or a single client, on demand):
// probe every registered endpoint, store the checks and each endpoint's
// verification flags, then roll each client's results into its gtg_status.
// docs/prd/google-tag-gateway.md §6.3. Shared by the 15-minute DQM loop and the
// operator's "Verify now" route so the two can never disagree about what counts.

import { probeGtgEndpoints, saveGtgChecks, summariseByClient, type GtgFetch, type GtgProbeResult, type GtgEndpointRow } from './gtgProbe';
import {
  applyProbeStatus,
  listEndpointsForClient,
  listEndpointsForOrg,
  recordEndpointVerification,
} from '@/services/database/gtgQueries';
import type { GtgStatus, ProbeSummary } from '@/services/gtg/gtgStatus';
import logger from '@/utils/logger';

export interface GtgCheckRun {
  results: GtgProbeResult[];
  byClient: Map<string, ProbeSummary>;
  /** Clients whose combined status changed in this run. */
  statusChanges: Array<{ clientId: string; status: GtgStatus }>;
}

export async function runGtgChecks(
  orgId: string,
  degradedThresholdMs: number,
  opts: { clientId?: string; fetchImpl?: GtgFetch } = {},
): Promise<GtgCheckRun> {
  const endpoints: GtgEndpointRow[] = opts.clientId
    ? (await listEndpointsForClient(opts.clientId)).map((e) => ({
        id: e.id, org_id: e.org_id, client_id: e.client_id, hostname: e.hostname,
        reserved_path: e.reserved_path, tag_or_container: e.tag_or_container,
      }))
    : await listEndpointsForOrg(orgId);

  if (endpoints.length === 0) return { results: [], byClient: new Map(), statusChanges: [] };

  const results = await probeGtgEndpoints(endpoints, degradedThresholdMs, opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {});
  await saveGtgChecks(orgId, results);
  await recordEndpointVerification(results);

  const byClient = summariseByClient(results);
  const statusChanges: GtgCheckRun['statusChanges'] = [];
  for (const [clientId, summary] of byClient) {
    try {
      const changed = await applyProbeStatus(clientId, summary);
      if (changed) statusChanges.push({ clientId, status: changed });
    } catch (err) {
      // One client's failed write must not stop the others, or the alert.
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId, clientId }, 'DQM: failed to apply GTG probe status');
    }
  }
  return { results, byClient, statusChanges };
}
