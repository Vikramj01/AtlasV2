/**
 * crmSyncOrchestrator — the sync engine. docs/prd/crm-outcome-integration.md
 * §4.3's data flow, Sprints 4-7.
 *
 * `runSync(configId)` does one incremental pull: fetch records whose stage
 * changed since the last successful sync (with a 60-minute overlap so a
 * record whose write lands right at the boundary isn't missed — §9.4),
 * resolve each to a stage/event via objectMapper.ts, resolve identity via
 * identityResolver.ts, resolve a value via valueLadder.ts, attempt delivery
 * via outcomeDelivery.ts, and persist an idempotent crm_outcome_events row
 * per (config, record, stage) with the real post-delivery status — never a
 * fabricated identifier, never re-delivering (not just never re-inserting)
 * a record an earlier overlapping run already processed (§9.2).
 *
 * Idempotency has two layers, both required: findExistingOutcomeKeys()
 * (crmQueries.ts) is checked BEFORE delivery is ever attempted for a batch
 * — a DB-level ignoreDuplicates upsert alone would stop a duplicate ROW,
 * but says nothing about a duplicate live call to Google/Meta/LinkedIn,
 * which is the failure that actually matters. The upsert's
 * ignoreDuplicates stays on as a safety net for a race between two
 * concurrent runs, not as the primary guard.
 *
 * Lost-deal handling (Sprint 6, §7.4): a closed-lost stage's own outcome
 * (above) delivers like any other stage; when its mapping is
 * is_terminal_lost, this file ALSO reads back every earlier
 * crm_outcome_events row for the same record (listDeliveredOutcomesForRecord)
 * and hands them to outcomeDelivery.ts's handleLostDeal(), which retracts
 * each earlier stage's already-delivered Google conversion and dispatches
 * one Meta atlas_deal_lost signal. This naturally runs exactly once per
 * record, gated by the same findExistingOutcomeKeys() pre-check that gates
 * everything else — the lost stage's own row can only be inserted once.
 *
 * DERIVED mode (Sprint 7, §7.3): this file no longer hardcodes `null` for
 * resolveValue()'s fourth argument — it fetches the latest
 * crm_derived_value_snapshots row per stage once per run
 * (getLatestDerivedValueSnapshots) and passes it through. valueLadder.ts's
 * own withheld→DECLARED fallback (already built in Sprint 3) handles
 * everything from there; this file only supplies real data instead of null.
 *
 * Attribution write-back (Sprint 9, D3, §6.4): after a delivered/partial
 * outcome, if the config has write_back_enabled, this file calls
 * outcomeDelivery.ts's writeBackAttribution() with the same provider/tokens
 * already resolved once for this run (not re-resolved per record). Never
 * gates or delays the crm_outcome_events write below it — a write-back
 * failure is caught and logged inside writeBackAttribution() itself.
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
import {
  getCrmSyncConfigByIdInternal,
  listCrmStageMappings,
  upsertCrmOutcomeEvents,
  updateCrmSyncState,
  findExistingOutcomeKeys,
  listDeliveredOutcomesForRecord,
  getLatestDerivedValueSnapshots,
} from '@/services/database/crmQueries';
import { getProvider } from './providerRegistry';
import { resolveTokens } from '@/services/connections/tokenManager';
import { resolveStageMapping } from './objectMapper';
import { resolveIdentity, resolveIdentityPropertyMap } from './identityResolver';
import { resolveValue } from './valueLadder';
import { deliverOutcome, handleLostDeal, writeBackAttribution } from './outcomeDelivery';
import type { ObservedCrmAmount, DerivedValueInput } from './valueLadder';
import type { CrmRecord, CrmProvider, DecryptedTokens } from './providers/types';
import type { CrmStageMapping, NewCrmOutcomeEventInput } from '@/types/crm';
import logger from '@/utils/logger';

// §9.4 — deliberate overlap so a record whose write lands right at the
// previous run's `until` boundary isn't missed on the next poll. Safe
// because re-observing it is a no-op (§9.2's unique constraint).
const OVERLAP_MS = 60 * 60 * 1000;
// §9.4 default record cap per run.
const DEFAULT_RECORD_CAP = 5000;
// Batch size for the existing-outcome pre-check + crm_outcome_events
// upserts — not a PRD-specified figure, just keeps a single run from
// building one giant IN(...) query or insert payload.
const BATCH_SIZE = 100;
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

function outcomeKey(crmRecordId: string, crmStageId: string): string {
  return `${crmRecordId}::${crmStageId}`;
}

function extractObservedAmount(properties: Record<string, string | null | undefined>): ObservedCrmAmount {
  const raw = properties[OBSERVED_AMOUNT_PROPERTY];
  if (raw == null || raw === '') return { amount: null, currency: null };
  const parsed = Number(raw);
  return { amount: Number.isFinite(parsed) ? parsed : null, currency: null };
}

interface Candidate {
  record: CrmRecord;
  mapping: CrmStageMapping;
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

  // Sprint 7 (§7.3) — fetched once per run, not per record, since it's
  // config-scoped: derivedValueCalculator.ts's weekly job already computed
  // whatever's current. Empty in DECLARED mode (valueLadder.ts's resolveValue()
  // never reads a derived input there anyway), so no wasted query.
  const derivedValuesByStage = new Map<string, DerivedValueInput>();
  if (config.value_mode === 'DERIVED') {
    const snapshots = await getLatestDerivedValueSnapshots(config.id);
    for (const s of snapshots) {
      derivedValuesByStage.set(s.crm_stage_id, { value: s.derived_value, currency: s.currency, confidence: s.confidence });
    }
  }

  const until = new Date();
  const since = config.last_synced_at
    ? new Date(new Date(config.last_synced_at).getTime() - OVERLAP_MS)
    : new Date(until.getTime() - config.backfill_days * 24 * 60 * 60 * 1000);

  let tokens: DecryptedTokens;
  let provider: CrmProvider;
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
  let candidateBatch: Candidate[] = [];

  // Resolves identity/value/delivery for a batch of candidates that have
  // already passed the existing-outcome pre-check, then upserts them.
  async function processBatch(batch: Candidate[]): Promise<void> {
    if (batch.length === 0) return;

    const existingKeys = await findExistingOutcomeKeys(config!.id, batch.map((c) => c.record.id));
    const rows: NewCrmOutcomeEventInput[] = [];

    for (const { record, mapping } of batch) {
      if (existingKeys.has(outcomeKey(record.id, mapping.crm_stage_id))) continue; // §9.2 — already processed by an earlier overlapping run

      const identity = resolveIdentity(record.properties, config!.identity_property_map, null);
      const observedAmount = mapping.is_terminal_won ? extractObservedAmount(record.properties) : null;
      const derivedInput = derivedValuesByStage.get(mapping.crm_stage_id) ?? null;
      const resolvedValue = resolveValue(mapping, config!, observedAmount, derivedInput);
      const eventId = computeEventId(config!.id, record.id, mapping.crm_stage_id);
      const stageChangedAt = record.stage_changed_at ?? until.toISOString();

      // §6.3 point 5 — never fabricate an identifier. An unresolved record
      // never reaches outcomeDelivery.ts at all.
      let deliveryStatus: NewCrmOutcomeEventInput['delivery_status'] = 'skipped_unresolved';
      let deliveryDetail: Record<string, unknown> = {};
      let deliveredAt: string | null = null;

      if (identity.method !== 'unresolved') {
        const delivery = await deliverOutcome(mapping, {
          organization_id: config!.organization_id,
          event_id: eventId,
          stage_changed_at: stageChangedAt,
          conversion_value: resolvedValue.value,
          currency: resolvedValue.currency,
          identity,
        });
        deliveryStatus = delivery.status;
        deliveryDetail = delivery.detail;
        deliveredAt = delivery.delivered_at;
      }

      // §7.4 — a closed-lost stage's own outcome (above) delivers like any
      // other stage; retracting/logging its EARLIER stages' now-wrong values
      // is a separate concern, recorded alongside rather than folded into
      // delivery_status (which stays governed only by this stage's own
      // deliverOutcome() result). Runs regardless of whether THIS record's
      // identity resolved, since a Google retraction matches by the earlier
      // stage's own orderId, not current identity.
      if (mapping.is_terminal_lost) {
        const earlierOutcomes = await listDeliveredOutcomesForRecord(config!.id, record.id);
        const lostDeal = await handleLostDeal(
          { organization_id: config!.organization_id, identity },
          earlierOutcomes,
          stageMappings,
        );
        deliveryDetail = { ...deliveryDetail, lost_deal: lostDeal };
      }

      // Sprint 9 (D3, §6.4) — opt-in, off by default. Never gates or delays
      // the crm_outcome_events write below; failures are caught and logged
      // inside writeBackAttribution() itself, never here.
      if (config!.write_back_enabled && (deliveryStatus === 'delivered' || deliveryStatus === 'partial')) {
        await writeBackAttribution(provider, tokens, {
          config_id: config!.id,
          crm_record_id: record.id,
          tracked_object: config!.tracked_object,
          atlas_event_name: mapping.atlas_event_name,
          delivery_detail: deliveryDetail,
          delivered_at: deliveredAt ?? new Date().toISOString(),
        });
      }

      rows.push({
        client_id: config!.client_id,
        config_id: config!.id,
        mapping_id: mapping.id,
        crm_record_id: record.id,
        crm_object: record.object,
        crm_stage_id: mapping.crm_stage_id,
        stage_changed_at: stageChangedAt,
        atlas_event_name: mapping.atlas_event_name,
        event_id: eventId,
        identity_method: identity.method,
        identity_key_present: identity.keys_present,
        conversion_value: resolvedValue.value,
        currency: resolvedValue.currency,
        value_source: resolvedValue.value_source,
        derived_confidence: resolvedValue.derived_confidence,
        delivery_status: deliveryStatus,
        delivery_detail: deliveryDetail,
        delivered_at: deliveredAt,
      });
    }

    outcomesWritten += await upsertCrmOutcomeEvents(config!.organization_id, rows);
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

      candidateBatch.push({ record, mapping });
      if (candidateBatch.length >= BATCH_SIZE) {
        await processBatch(candidateBatch);
        candidateBatch = [];
      }
    }
    await processBatch(candidateBatch);
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
