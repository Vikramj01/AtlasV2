/**
 * crmSyncOrchestrator — the sync engine. docs/prd/crm-outcome-integration.md
 * §4.3's data flow, Sprint 4.
 *
 * `runSync(configId)` does one incremental pull: fetch records whose stage
 * changed since the last successful sync (with a 60-minute overlap so a
 * record whose write lands right at the boundary isn't missed — §9.4),
 * resolve each to a stage/event via objectMapper.ts, resolve identity via
 * identityResolver.ts, resolve a value via valueLadder.ts, and persist an
 * idempotent crm_outcome_events row per (config, record, stage) — never a
 * fabricated identifier, never overwriting a row already written by an
 * earlier overlapping run (§9.2).
 *
 * Deliberately NOT done here (Sprint 5's job, per the PRD's own split):
 *   - Actual delivery to Google/Meta/LinkedIn (outcomeDelivery.ts)
 *   - Per-destination ingest-window skipping — a single outcome row has no
 *     single destination (a stage can map to Google AND Meta AND LinkedIn
 *     conversion IDs simultaneously), so "skipped_window" is a delivery-time,
 *     per-destination concern, not a sync-time one
 *   - atlas_event_id -> capi_events consent/identity inheritance (§6.3 point
 *     2, §8) — that join happens where it's actually consumed (delivery),
 *     not here; identity resolution in this file only ever exercises steps
 *     1/3/4/5 of §6.3 (click_id / hashed_email / hashed_phone / unresolved)
 *
 * Known structural limitation, not a bug: fetchChangedRecords (§4.2)
 * reports each record's CURRENT stage at fetch time, not a change history.
 * A record that moves through more than one mapped stage between two sync
 * runs only has whatever stage it's sitting in AT POLL TIME recorded — an
 * intermediate stage the deal passed through faster than the sync interval
 * is never observed, never fabricated as a synthetic row. This follows
 * directly from the CrmProvider interface's shape (frozen since Sprint 1 —
 * "do not add parameters"), not a gap this sprint chose to leave.
 */

import { createHash } from 'crypto';
import { getCrmSyncConfigByIdInternal, listCrmStageMappings, upsertCrmOutcomeEvents, updateCrmSyncState } from '@/services/database/crmQueries';
import { getProvider } from './providerRegistry';
import { resolveTokens } from '@/services/connections/tokenManager';
import { resolveStageMapping } from './objectMapper';
import { resolveIdentity, resolveIdentityPropertyMap } from './identityResolver';
import { resolveValue } from './valueLadder';
import type { ObservedCrmAmount } from './valueLadder';
import type { CrmRecord } from './providers/types';
import type { NewCrmOutcomeEventInput } from '@/types/crm';
import logger from '@/utils/logger';

// §9.4 — deliberate overlap so a record whose write lands right at the
// previous run's `until` boundary isn't missed on the next poll. Safe
// because re-observing it is a no-op (§9.2's unique constraint).
const OVERLAP_MS = 60 * 60 * 1000;
// §9.4 default record cap per run.
const DEFAULT_RECORD_CAP = 5000;
// Batch size for crm_outcome_events upserts — not a PRD-specified figure,
// just keeps a single run from building one giant insert payload.
const UPSERT_BATCH_SIZE = 100;
// HubSpot's standard built-in deal amount property. Deliberately not also
// requesting a per-deal currency property (e.g. `deal_currency_code`) —
// that property only exists on portals with multi-currency enabled, and
// HubSpot's Search API is not confirmed here to tolerate an unknown
// property name gracefully (unlike CRM v3's general read endpoints, which
// do). Every CRM_AMOUNT observation currently falls back to the config's
// default_currency until this is verified live.
const OBSERVED_AMOUNT_PROPERTY = 'amount';

export type SyncRunStatus = 'ok' | 'partial' | 'failed' | 'disabled' | 'not_found';

export interface SyncRunResult {
  status: SyncRunStatus;
  records_processed: number;
  outcomes_written: number;
  outcomes_skipped_unmapped: number;
  cap_hit: boolean;
  sync_interval_minutes: number | null;
  error?: string;
}

function computeEventId(configId: string, crmRecordId: string, crmStageId: string): string {
  return createHash('sha256').update(`${configId}:${crmRecordId}:${crmStageId}`).digest('hex').slice(0, 32);
}

function extractObservedAmount(properties: Record<string, string | null | undefined>): ObservedCrmAmount {
  const raw = properties[OBSERVED_AMOUNT_PROPERTY];
  if (raw == null || raw === '') return { amount: null, currency: null };
  const parsed = Number(raw);
  return { amount: Number.isFinite(parsed) ? parsed : null, currency: null };
}

export async function runSync(configId: string, opts?: { recordCap?: number }): Promise<SyncRunResult> {
  const recordCap = opts?.recordCap ?? DEFAULT_RECORD_CAP;

  const config = await getCrmSyncConfigByIdInternal(configId);
  if (!config) {
    return { status: 'not_found', records_processed: 0, outcomes_written: 0, outcomes_skipped_unmapped: 0, cap_hit: false, sync_interval_minutes: null };
  }
  if (!config.sync_enabled) {
    return { status: 'disabled', records_processed: 0, outcomes_written: 0, outcomes_skipped_unmapped: 0, cap_hit: false, sync_interval_minutes: config.sync_interval_minutes };
  }

  const stageMappings = await listCrmStageMappings(config.id);
  const until = new Date();
  const since = config.last_synced_at
    ? new Date(new Date(config.last_synced_at).getTime() - OVERLAP_MS)
    : new Date(until.getTime() - config.backfill_days * 24 * 60 * 60 * 1000);

  let tokens;
  let provider;
  try {
    provider = getProvider(config.provider);
    tokens = await resolveTokens(config.connection_id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCrmSyncState(config.id, { last_sync_status: 'failed', last_sync_error: message });
    logger.error({ configId, err: message }, 'CRM sync: failed to resolve provider or connection tokens');
    return { status: 'failed', records_processed: 0, outcomes_written: 0, outcomes_skipped_unmapped: 0, cap_hit: false, sync_interval_minutes: config.sync_interval_minutes, error: message };
  }

  const propertyMap = resolveIdentityPropertyMap(config.identity_property_map);
  const propertyNames = Array.from(new Set([...Object.values(propertyMap), OBSERVED_AMOUNT_PROPERTY]));

  let recordsProcessed = 0;
  let outcomesWritten = 0;
  let outcomesSkippedUnmapped = 0;
  let capHit = false;
  let lastStageChangedAt: string | null = null;
  let pendingRows: NewCrmOutcomeEventInput[] = [];

  async function flush(): Promise<void> {
    if (pendingRows.length === 0) return;
    outcomesWritten += await upsertCrmOutcomeEvents(config!.organization_id, pendingRows);
    pendingRows = [];
  }

  try {
    for await (const record of provider.fetchChangedRecords(tokens, config.tracked_object, since, until, propertyNames) as AsyncIterable<CrmRecord>) {
      if (recordsProcessed >= recordCap) {
        capHit = true;
        break;
      }
      recordsProcessed += 1;
      lastStageChangedAt = record.stage_changed_at ?? lastStageChangedAt;

      if (!record.stage_id) continue;
      const mapping = resolveStageMapping(stageMappings, record.stage_id);
      if (!mapping) {
        outcomesSkippedUnmapped += 1;
        continue;
      }

      // §6.3 steps 1/3/4/5 only — the atlas_event_id -> capi_events
      // preference (step 2) is Sprint 5's job, per this file's header.
      const identity = resolveIdentity(record.properties, config.identity_property_map, null);
      const observedAmount = mapping.is_terminal_won ? extractObservedAmount(record.properties) : null;
      const resolvedValue = resolveValue(mapping, config, observedAmount, null);

      pendingRows.push({
        client_id: config.client_id,
        config_id: config.id,
        mapping_id: mapping.id,
        crm_record_id: record.id,
        crm_object: record.object,
        crm_stage_id: record.stage_id,
        stage_changed_at: record.stage_changed_at ?? until.toISOString(),
        atlas_event_name: mapping.atlas_event_name,
        event_id: computeEventId(config.id, record.id, record.stage_id),
        identity_method: identity.method,
        identity_key_present: identity.keys_present,
        conversion_value: resolvedValue.value,
        currency: resolvedValue.currency,
        value_source: resolvedValue.value_source,
        derived_confidence: resolvedValue.derived_confidence,
        // §6.3 point 5 — never fabricate an identifier; an unresolved
        // record is persisted and counted, not silently dropped.
        delivery_status: identity.method === 'unresolved' ? 'skipped_unresolved' : 'pending',
      });

      if (pendingRows.length >= UPSERT_BATCH_SIZE) await flush();
    }
    await flush();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCrmSyncState(config.id, { last_sync_status: 'failed', last_sync_error: message });
    logger.error({ configId, err: message, recordsProcessed }, 'CRM sync: run failed mid-fetch');
    return {
      status: 'failed',
      records_processed: recordsProcessed,
      outcomes_written: outcomesWritten,
      outcomes_skipped_unmapped: outcomesSkippedUnmapped,
      cap_hit: capHit,
      sync_interval_minutes: config.sync_interval_minutes,
      error: message,
    };
  }

  // §9.4 — cap hit: never advance last_synced_at past the last record this
  // run actually processed, so the continuation run picks up where this
  // one stopped rather than skipping the untouched remainder.
  const nextSyncedAt = capHit && lastStageChangedAt ? lastStageChangedAt : until.toISOString();
  await updateCrmSyncState(config.id, {
    last_synced_at: nextSyncedAt,
    last_sync_status: capHit ? 'partial' : 'ok',
    last_sync_error: null,
  });

  logger.info(
    { configId, recordsProcessed, outcomesWritten, outcomesSkippedUnmapped, capHit },
    'CRM sync run complete',
  );

  return {
    status: capHit ? 'partial' : 'ok',
    records_processed: recordsProcessed,
    outcomes_written: outcomesWritten,
    outcomes_skipped_unmapped: outcomesSkippedUnmapped,
    cap_hit: capHit,
    sync_interval_minutes: config.sync_interval_minutes,
  };
}
