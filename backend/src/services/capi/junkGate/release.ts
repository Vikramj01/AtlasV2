/**
 * Releasing, rejecting and timing out holds (GA4 Admin / L11 / Junk Gate PRD §C.6, C2).
 *
 * A terminal transition is claimed FIRST and atomically (`transitionHold` only moves a row that is
 * still `held`), so a reviewer's click racing the timeout sweep can never double-deliver or
 * double-drop. Everything after the claim is per-target and best-effort: one destination failing
 * does not stop the others, and the payload is nulled for every target whatever happened.
 *
 * Release re-enters the pipeline at dedup with the ORIGINAL event (same `event_id`, `event_time`,
 * captured consent) and its hold-time identifiers, so dedup still applies and a released event is
 * indistinguishable to the platform from one that was never held.
 */
import type { AtlasEvent, CAPIProviderConfig } from '@/types/capi';
import { decryptJson } from '../credentials';
import { releasePreparedEvent } from '../pipeline';
import { getProvider } from '@/services/database/capiQueries';
import {
  transitionHold, listHoldTargets, finishHoldTarget, markCapiEventStatus, getHold, getHoldById,
  type HoldRow, type HoldTargetRow,
} from '@/services/database/junkGateQueries';
import type { HeldPayload } from './hold';
import logger from '@/utils/logger';

export type ReleaseKind = 'released' | 'auto_released';
export type RejectKind = 'rejected' | 'auto_dropped';

export interface HoldActionResult {
  outcome: 'done' | 'not_held' | 'not_found';
  status?: HoldRow['status'];
  delivered?: number;
  failed?: number;
}

async function deliverTarget(target: HoldTargetRow): Promise<'delivered' | 'failed'> {
  try {
    if (!target.payload_encrypted) throw new Error('held payload missing');
    const payload = decryptJson<HeldPayload>(target.payload_encrypted);
    const config: CAPIProviderConfig | null = await getProvider(target.provider_config_id, target.organization_id);
    if (!config) throw new Error('provider config no longer exists');
    const result = await releasePreparedEvent(payload.event as AtlasEvent, payload.identifiers, config);
    const ok = result.status === 'delivered' || result.status === 'dedup_skipped';
    await finishHoldTarget(target.id, ok ? 'delivered' : 'failed', { status: result.status, error_code: result.error_code ?? null });
    if (target.capi_event_id) await markCapiEventStatus(target.capi_event_id, 'junk_released').catch(() => undefined);
    return ok ? 'delivered' : 'failed';
  } catch (err) {
    // No payload content, only the failure reason.
    logger.warn({ hold_id: target.hold_id, provider: target.provider, err: err instanceof Error ? err.message : String(err) }, 'Junk hold release: target delivery failed');
    await finishHoldTarget(target.id, 'failed', { error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    return 'failed';
  }
}

export async function releaseHold(
  holdId: string, organizationId: string | null, decidedBy: string | null, kind: ReleaseKind = 'released',
): Promise<HoldActionResult> {
  const row = await transitionHold(holdId, kind, decidedBy, organizationId ?? undefined);
  if (!row) return { outcome: (await (organizationId ? getHold(organizationId, holdId) : getHoldById(holdId))) ? 'not_held' : 'not_found' };

  let delivered = 0;
  let failed = 0;
  for (const target of await listHoldTargets(holdId)) {
    if (target.status !== 'pending') continue;
    if ((await deliverTarget(target)) === 'delivered') delivered++; else failed++;
  }
  logger.info({ hold_id: holdId, kind, delivered, failed }, 'Junk hold released');
  return { outcome: 'done', status: kind, delivered, failed };
}

export async function rejectHold(
  holdId: string, organizationId: string | null, decidedBy: string | null, kind: RejectKind = 'rejected',
): Promise<HoldActionResult> {
  const row = await transitionHold(holdId, kind, decidedBy, organizationId ?? undefined);
  if (!row) return { outcome: (await (organizationId ? getHold(organizationId, holdId) : getHoldById(holdId))) ? 'not_held' : 'not_found' };

  for (const target of await listHoldTargets(holdId)) {
    if (target.status !== 'pending') continue;
    await finishHoldTarget(target.id, 'dropped').catch(() => undefined);
    if (target.capi_event_id) await markCapiEventStatus(target.capi_event_id, 'junk_rejected').catch(() => undefined);
  }
  logger.info({ hold_id: holdId, kind }, 'Junk hold rejected');
  return { outcome: 'done', status: kind };
}
