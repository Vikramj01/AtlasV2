/**
 * Hold expiry (PRD §C.6, C2): applies the client's `timeout_action` to a hold nobody reviewed.
 * `release` (the default) fails open — an unreviewed conversion is sent rather than lost.
 * The queue job carries only the hold id; the action is re-read from the client's config now,
 * so a config change between hold and expiry is honoured.
 */
import { releaseHold, rejectHold, type HoldActionResult } from './release';
import { getHoldById, getJunkGateConfigRow, listExpiredHoldIds } from '@/services/database/junkGateQueries';
import { resolveGateConfig } from './config';
import logger from '@/utils/logger';

export async function processHoldTimeout(holdId: string, now: Date = new Date()): Promise<HoldActionResult | { outcome: 'not_due' }> {
  const hold = await getHoldById(holdId);
  if (!hold) return { outcome: 'not_found' };
  if (hold.status !== 'held') return { outcome: 'not_held' };
  if (hold.expires_at && new Date(hold.expires_at).getTime() > now.getTime()) return { outcome: 'not_due' };

  const config = resolveGateConfig(hold.client_id ? await getJunkGateConfigRow(hold.client_id) : null);
  return config.timeout_action === 'drop'
    ? rejectHold(holdId, null, null, 'auto_dropped')
    : releaseHold(holdId, null, null, 'auto_released');
}

/** Safety net for holds whose delayed job was lost or whose expiry was shortened after scheduling. */
export async function sweepExpiredHolds(now: Date = new Date()): Promise<number> {
  const ids = await listExpiredHoldIds(now.toISOString());
  let handled = 0;
  for (const id of ids) {
    try {
      const r = await processHoldTimeout(id, now);
      if (r.outcome === 'done') handled++;
    } catch (err) {
      logger.error({ hold_id: id, err: err instanceof Error ? err.message : String(err) }, 'Junk hold sweep: timeout failed');
    }
  }
  return handled;
}
