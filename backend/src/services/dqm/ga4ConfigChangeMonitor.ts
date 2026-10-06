/**
 * GA4 config-change monitoring (GA4 Admin / L11 / Junk Gate PRD §A.5).
 *
 * Stateless: the `ga4_config_snapshots` change log IS the state. A property
 * counts as changed when its newest snapshot in the last 24h differs, by
 * `diffGa4Snapshots`, from the snapshot before it (a property's first
 * snapshot is a baseline, not a change). The org gets ONE rolled-up alert
 * regardless of how many properties changed (the Google Tag Topology / sGTM
 * precedent — health_alerts has no property dimension); per-property detail
 * lives in the snapshot table. Once nothing changed in the window the alert
 * resolves through the usual two-ok path.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { diffGa4Snapshots, type Ga4ChangeType } from '@/services/reconciliation/sync/ga4ConfigDrift';
import type { Ga4ConfigSnapshot } from '@/services/reconciliation/sync/ga4ConfigSync';
import type { Ga4ConfigChangeAlertInput } from './dqmAlertEvaluator';

export const GA4_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface SnapRow { property_id: string; snapshot: Ga4ConfigSnapshot; captured_at: string }

export async function computeGa4ConfigChangeSignals(
  orgId: string,
  existingAlertActive: boolean,
  now: Date = new Date(),
): Promise<Ga4ConfigChangeAlertInput> {
  const since = new Date(now.getTime() - GA4_CHANGE_WINDOW_MS).toISOString();
  const { data } = await supabaseAdmin
    .from('ga4_config_snapshots')
    .select('property_id, snapshot, captured_at')
    .eq('organization_id', orgId)
    .gte('captured_at', since)
    .order('captured_at', { ascending: false });

  const newestByProperty = new Map<string, SnapRow>();
  for (const r of (data ?? []) as SnapRow[]) {
    if (!newestByProperty.has(r.property_id)) newestByProperty.set(r.property_id, r);
  }

  let changedPropertyCount = 0;
  const changeTypes = new Set<Ga4ChangeType>();
  for (const [propertyId, latest] of newestByProperty) {
    const { data: prior } = await supabaseAdmin
      .from('ga4_config_snapshots')
      .select('property_id, snapshot, captured_at')
      .eq('organization_id', orgId)
      .eq('property_id', propertyId)
      .lt('captured_at', latest.captured_at)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prior) continue; // first snapshot = baseline
    const changes = diffGa4Snapshots((prior as SnapRow).snapshot, latest.snapshot);
    if (changes.length > 0) {
      changedPropertyCount++;
      for (const c of changes) changeTypes.add(c.type);
    }
  }
  return { changedPropertyCount, changeTypes: [...changeTypes], existingAlertActive };
}
