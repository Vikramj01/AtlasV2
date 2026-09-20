import { supabaseAdmin as supabase } from './supabase';
import type {
  OutcomeSourceConfig,
  CreateOutcomeSourceConfigInput,
  UpdateOutcomeSourceConfigInput,
  OutcomeStageMapping,
  StageMappingInput,
  NewOutcomeEventInput,
  OutcomeSyncStatus,
  EarlierDeliveredOutcome,
  OutcomeDerivedValueSnapshot,
  NewDerivedValueSnapshotInput,
  OutcomeEventForDerivedCalc,
  OutcomeEvent,
  OutcomeDeliveryStatus,
  OutcomeDailyCount,
} from '@/types/outcomes';

export async function listOutcomeSourceConfigsForOrg(orgId: string): Promise<OutcomeSourceConfig[]> {
  const { data, error } = await supabase
    .from('outcome_source_configs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`listOutcomeSourceConfigsForOrg: ${error.message}`);
  return (data ?? []) as unknown as OutcomeSourceConfig[];
}

export async function getOutcomeSourceConfigById(id: string, orgId: string): Promise<OutcomeSourceConfig | null> {
  const { data, error } = await supabase
    .from('outcome_source_configs')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) throw new Error(`getOutcomeSourceConfigById: ${error.message}`);
  return data as unknown as OutcomeSourceConfig | null;
}

export async function createOutcomeSourceConfig(
  orgId: string,
  input: CreateOutcomeSourceConfigInput,
): Promise<OutcomeSourceConfig> {
  const { data, error } = await supabase
    .from('outcome_source_configs')
    .insert({
      organization_id: orgId,
      client_id: input.client_id,
      connection_id: input.connection_id,
      source_type: input.source_type,
      pipeline_id: input.pipeline_id ?? null,
      tracked_object: input.tracked_object ?? 'deal',
      identity_property_map: input.identity_property_map ?? {},
      value_mode: input.value_mode ?? 'DECLARED',
      default_currency: input.default_currency ?? 'USD',
      backfill_days: input.backfill_days ?? 30,
    })
    .select('*')
    .single();

  if (error) throw new Error(`createOutcomeSourceConfig: ${error.message}`);
  return data as unknown as OutcomeSourceConfig;
}

export async function updateOutcomeSourceConfig(
  id: string,
  orgId: string,
  patch: UpdateOutcomeSourceConfigInput,
): Promise<OutcomeSourceConfig> {
  const { data, error } = await supabase
    .from('outcome_source_configs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*')
    .single();

  if (error) throw new Error(`updateOutcomeSourceConfig: ${error.message}`);
  return data as unknown as OutcomeSourceConfig;
}

export async function deleteOutcomeSourceConfig(id: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('outcome_source_configs')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) throw new Error(`deleteOutcomeSourceConfig: ${error.message}`);
}

// No orgId filter — for worker/internal callers (syncOrchestrator.ts) that
// only have a config_id off a Bull job payload, mirroring
// connectionQueries.ts's getConnectionByIdInternal.
export async function getOutcomeSourceConfigByIdInternal(id: string): Promise<OutcomeSourceConfig | null> {
  const { data, error } = await supabase
    .from('outcome_source_configs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`getOutcomeSourceConfigByIdInternal: ${error.message}`);
  return data as unknown as OutcomeSourceConfig | null;
}

export interface OutcomeSyncStateUpdate {
  last_synced_at?: string;
  last_sync_status: OutcomeSyncStatus;
  last_sync_error: string | null;
}

// Sprint 8 (§10) — "Sync failed on consecutive runs" needs a streak counter
// outcome_source_configs didn't have before (only ever stored the LAST
// run's status). Read-increment-write, same non-atomic-but-tolerated
// pattern as healthQueries.ts's incrementAlertOk() — a rare race between
// two overlapping runs for the same config is not worth an RPC here.
async function nextConsecutiveFailures(id: string, status: OutcomeSyncStatus): Promise<number> {
  if (status !== 'failed') return 0; // 'ok' or 'partial' — the sync recovered, reset the streak

  const { data } = await supabase
    .from('outcome_source_configs')
    .select('consecutive_failures')
    .eq('id', id)
    .single();

  return ((data as { consecutive_failures: number } | null)?.consecutive_failures ?? 0) + 1;
}

export async function updateOutcomeSyncState(id: string, patch: OutcomeSyncStateUpdate): Promise<void> {
  const consecutive_failures = await nextConsecutiveFailures(id, patch.last_sync_status);

  const { error } = await supabase
    .from('outcome_source_configs')
    .update({ ...patch, consecutive_failures, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(`updateOutcomeSyncState: ${error.message}`);
}

// ── Stage mappings (the ladder itself, §5.3) ────────────────────────────────────

export async function listOutcomeStageMappings(configId: string): Promise<OutcomeStageMapping[]> {
  const { data, error } = await supabase
    .from('outcome_stage_mappings')
    .select('*')
    .eq('config_id', configId)
    .order('stage_order');

  if (error) throw new Error(`listOutcomeStageMappings: ${error.message}`);
  return (data ?? []) as unknown as OutcomeStageMapping[];
}

// Replaces the whole ladder in one call (PRD §11's PUT /configs/:id/stage-mappings
// — "Replace the ladder"). Upserts by (config_id, crm_stage_id) rather than a
// delete-then-reinsert so an edited-but-kept stage keeps its row id — once
// Sprint 4/5 start writing outcome_events.mapping_id against these rows, a
// delete+reinsert would orphan those references (ON DELETE SET NULL) on
// every ladder edit; upserting avoids that from day one.
export async function replaceOutcomeStageMappings(
  configId: string,
  orgId: string,
  mappings: StageMappingInput[],
): Promise<OutcomeStageMapping[]> {
  const incomingStageIds = mappings.map((m) => m.crm_stage_id);

  if (mappings.length > 0) {
    const { error: upsertErr } = await supabase
      .from('outcome_stage_mappings')
      .upsert(
        mappings.map((m) => ({
          organization_id: orgId,
          config_id: configId,
          crm_stage_id: m.crm_stage_id,
          crm_stage_label: m.crm_stage_label ?? '',
          stage_order: m.stage_order,
          atlas_event_name: m.atlas_event_name,
          is_terminal_won: m.is_terminal_won ?? false,
          is_terminal_lost: m.is_terminal_lost ?? false,
          declared_value: m.declared_value ?? null,
          currency: m.currency ?? null,
          google_conversion_action_id: m.google_conversion_action_id ?? null,
          meta_event_name: m.meta_event_name ?? null,
          linkedin_conversion_id: m.linkedin_conversion_id ?? null,
          enabled: m.enabled ?? true,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'config_id,crm_stage_id' },
      );

    if (upsertErr) throw new Error(`replaceOutcomeStageMappings (upsert): ${upsertErr.message}`);
  }

  // Prune stages the operator removed from the ladder.
  let deleteQuery = supabase
    .from('outcome_stage_mappings')
    .delete()
    .eq('config_id', configId);
  deleteQuery = incomingStageIds.length > 0
    ? deleteQuery.not('crm_stage_id', 'in', `(${incomingStageIds.map((id) => `"${id}"`).join(',')})`)
    : deleteQuery;
  const { error: deleteErr } = await deleteQuery;
  if (deleteErr) throw new Error(`replaceOutcomeStageMappings (prune): ${deleteErr.message}`);

  return listOutcomeStageMappings(configId);
}

// Real query, always zero until Sprint 4/5's orchestrator/delivery exist —
// per Implementation Rule 12, this stays wired to the actual table rather
// than a fabricated placeholder count.
export async function countRecentOutcomesByMapping(configId: string): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('outcome_events')
    .select('mapping_id')
    .eq('config_id', configId)
    .eq('delivery_status', 'delivered')
    .gte('created_at', since);

  if (error) throw new Error(`countRecentOutcomesByMapping: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { mapping_id: string | null }[]) {
    if (!row.mapping_id) continue;
    counts[row.mapping_id] = (counts[row.mapping_id] ?? 0) + 1;
  }
  return counts;
}

// ── Outcome events (§5.4, written by syncOrchestrator.ts) ───────────────────────

// ignoreDuplicates -> Postgres INSERT ... ON CONFLICT DO NOTHING: an
// overlapping sync window re-observing an already-written (config_id,
// source_record_id, source_stage_id) is a genuine no-op (§9.2), never an
// update — re-running a sync must not silently overwrite a row
// outcomeDelivery.ts (Sprint 5) may already be mid-delivery on. RETURNING
// (via .select()) only ever contains the rows Postgres actually inserted,
// so the returned count IS the real "how many new outcomes" figure, not an
// approximation.
export async function upsertOutcomeEvents(
  orgId: string,
  rows: NewOutcomeEventInput[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const { data, error } = await supabase
    .from('outcome_events')
    .upsert(
      rows.map((r) => ({ ...r, organization_id: orgId })),
      { onConflict: 'config_id,source_record_id,source_stage_id', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw new Error(`upsertOutcomeEvents: ${error.message}`);
  return (data ?? []).length;
}

// Pre-delivery idempotency guard (§9.2). Must run BEFORE outcomeDelivery.ts
// is ever invoked for a record — the ignoreDuplicates upsert above only
// stops a DUPLICATE DB ROW, it does nothing to stop a second real API call
// to Google/Meta/LinkedIn for a record an earlier, overlapping sync run
// already delivered. Returns the set of "source_record_id::source_stage_id"
// keys already present for this config, so the orchestrator can skip
// delivery entirely for anything already in it.
export async function findExistingOutcomeKeys(
  configId: string,
  sourceRecordIds: string[],
): Promise<Set<string>> {
  if (sourceRecordIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('outcome_events')
    .select('source_record_id, source_stage_id')
    .eq('config_id', configId)
    .in('source_record_id', sourceRecordIds);

  if (error) throw new Error(`findExistingOutcomeKeys: ${error.message}`);

  return new Set(
    ((data ?? []) as { source_record_id: string; source_stage_id: string }[])
      .map((r) => `${r.source_record_id}::${r.source_stage_id}`),
  );
}

// Attribution write-back (Sprint 9, D3, §6.4). Sources
// atlas_conversions_delivered from Atlas's own already-persisted delivery
// history rather than reading the CRM record back (no read-modify-write
// race with the portal, and no new CrmProvider method needed against its
// frozen §4.2 interface) — distinct rows only, most-recent-first is not
// meaningful here since the caller folds this into a Set anyway.
export async function listDeliveredEventNamesForRecord(
  configId: string,
  sourceRecordId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('outcome_events')
    .select('atlas_event_name')
    .eq('config_id', configId)
    .eq('source_record_id', sourceRecordId)
    .in('delivery_status', ['delivered', 'partial']);

  if (error) throw new Error(`listDeliveredEventNamesForRecord: ${error.message}`);
  return Array.from(new Set(((data ?? []) as { atlas_event_name: string }[]).map((r) => r.atlas_event_name)));
}

// Lost-deal handling (Sprint 6, §7.4). Called once, only when the current
// record's stage is is_terminal_lost — outcomeDelivery.ts's handleLostDeal()
// reads mapping_id + event_id + delivery_detail off these rows to decide
// which earlier stages actually delivered a Google conversion worth
// retracting. Includes the current stage's own row (if it already exists,
// which it won't yet on first insert) — the caller filters by mapping, not
// by excluding a specific stage_id, so this stays a plain unfiltered read.
export async function listDeliveredOutcomesForRecord(
  configId: string,
  sourceRecordId: string,
): Promise<EarlierDeliveredOutcome[]> {
  const { data, error } = await supabase
    .from('outcome_events')
    .select('mapping_id, event_id, delivery_detail')
    .eq('config_id', configId)
    .eq('source_record_id', sourceRecordId);

  if (error) throw new Error(`listDeliveredOutcomesForRecord: ${error.message}`);
  return (data ?? []) as EarlierDeliveredOutcome[];
}

// ── Derived value calculator (Sprint 7, §7.3) ───────────────────────────────────

// Every outcome_events row within the trailing window, for
// derivedValueCalculator.ts's pure computeStageSnapshots() to fold over.
// Identity/PII columns are deliberately not selected — this is a value/rate
// computation, not a delivery.
export async function listOutcomeEventsForDerivedCalc(
  configId: string,
  sinceISO: string,
): Promise<OutcomeEventForDerivedCalc[]> {
  const { data, error } = await supabase
    .from('outcome_events')
    .select('source_record_id, source_stage_id, mapping_id, conversion_value, currency, stage_changed_at')
    .eq('config_id', configId)
    .gte('stage_changed_at', sinceISO);

  if (error) throw new Error(`listOutcomeEventsForDerivedCalc: ${error.message}`);
  return (data ?? []) as OutcomeEventForDerivedCalc[];
}

// Upserts on (config_id, crm_stage_id, window_end) — a re-run within the
// same day (manual trigger after the weekly cron already ran) replaces that
// day's snapshot rather than duplicating it; a genuinely new week's
// window_end always gets its own row, so history is preserved.
export async function upsertDerivedValueSnapshots(
  orgId: string,
  rows: NewDerivedValueSnapshotInput[],
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from('outcome_derived_value_snapshots')
    .upsert(
      rows.map((r) => ({ ...r, organization_id: orgId })),
      { onConflict: 'config_id,crm_stage_id,window_end' },
    );

  if (error) throw new Error(`upsertDerivedValueSnapshots: ${error.message}`);
}

// Latest snapshot per crm_stage_id for a config — read by
// syncOrchestrator.ts (feeds valueLadder.ts) and GET
// /configs/:id/derived-values. supabase-js has no DISTINCT ON, so this
// fetches recent rows ordered by window_end and keeps the first (most
// recent) one seen per stage; 200 is generously above any realistic
// (stage count × weeks retained) product.
export async function getLatestDerivedValueSnapshots(configId: string): Promise<OutcomeDerivedValueSnapshot[]> {
  const { data, error } = await supabase
    .from('outcome_derived_value_snapshots')
    .select('*')
    .eq('config_id', configId)
    .order('window_end', { ascending: false })
    .limit(200);

  if (error) throw new Error(`getLatestDerivedValueSnapshots: ${error.message}`);

  const latestByStage = new Map<string, OutcomeDerivedValueSnapshot>();
  for (const row of (data ?? []) as OutcomeDerivedValueSnapshot[]) {
    if (!latestByStage.has(row.crm_stage_id)) latestByStage.set(row.crm_stage_id, row);
  }
  return Array.from(latestByStage.values());
}

// Internal, no org filter — for the weekly fan-out job (worker.ts), which
// only needs config ids to enqueue, mirroring
// getOutcomeSourceConfigByIdInternal's worker-caller convention.
export async function listDerivedModeConfigIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('outcome_source_configs')
    .select('id')
    .eq('value_mode', 'DERIVED');

  if (error) throw new Error(`listDerivedModeConfigIds: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

// ── Outcomes surface (Sprint 8, §11 — GET /configs/:id/outcomes) ────────────────

export interface ListOutcomeEventsParams {
  limit: number;
  offset: number;
  deliveryStatus?: OutcomeDeliveryStatus;
}

// Simple offset/limit pagination — outcome_events volume is per-config, not
// the org-wide firehose the Signal Tracking Dashboard's cursor-based
// listSignalEvents() has to handle, so the simpler shape is proportionate.
export async function listOutcomeEvents(
  configId: string,
  params: ListOutcomeEventsParams,
): Promise<{ rows: OutcomeEvent[]; total: number }> {
  let query = supabase
    .from('outcome_events')
    .select('*', { count: 'exact' })
    .eq('config_id', configId)
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (params.deliveryStatus) {
    query = query.eq('delivery_status', params.deliveryStatus);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`listOutcomeEvents: ${error.message}`);
  return { rows: (data ?? []) as OutcomeEvent[], total: count ?? 0 };
}

// GET /configs/:id/outcomes/daily — real day-grouped counts for
// OutcomesTab's chart (Implementation Rule 12: only a chart backed by a
// real time-series query is allowed). Grouped in JS, same "fetch the
// window, reduce client-side" approach as getLatestDerivedValueSnapshots()
// above — supabase-js has no native GROUP BY without a dedicated RPC
// function.
export async function getDailyOutcomeCounts(configId: string, days: number): Promise<OutcomeDailyCount[]> {
  const sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('outcome_events')
    .select('created_at, delivery_status')
    .eq('config_id', configId)
    .gte('created_at', sinceISO);

  if (error) throw new Error(`getDailyOutcomeCounts: ${error.message}`);

  const byDay = new Map<string, OutcomeDailyCount>();
  for (const row of (data ?? []) as { created_at: string; delivery_status: OutcomeDeliveryStatus }[]) {
    const date = row.created_at.slice(0, 10);
    const entry = byDay.get(date) ?? { date, total: 0, delivered: 0 };
    entry.total += 1;
    if (row.delivery_status === 'delivered' || row.delivery_status === 'partial') entry.delivered += 1;
    byDay.set(date, entry);
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}
