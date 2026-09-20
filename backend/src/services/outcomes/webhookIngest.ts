/**
 * Webhook ingestion pipeline — docs/prd/universal-outcome-ingestion.md §6.
 *
 * Shared by the real endpoint (POST /api/outcomes/webhook/:configId —
 * persists, delivers, checks the gate) and its dry-run twin (POST
 * .../validate — computes everything, writes and delivers nothing). One
 * function, one `dryRun` flag, so the two can never silently diverge in
 * what they consider valid (§6.1's own acceptance criterion: "the
 * validation endpoint returns the full would-be outcome").
 *
 * Reuses every existing downstream piece untouched: objectMapper.ts's
 * resolveStageMapping(), valueLadder.ts's resolveValue(),
 * outcomeDelivery.ts's deliverOutcome(), and eventId.ts's computeEventId()
 * (same idempotency formula, same meaning, regardless of transport — kept
 * in its own dependency-free module rather than imported from
 * syncOrchestrator.ts so a test of this file never has to load that
 * module's much heavier transitive dependency tree). The only genuinely new
 * step is contract.ts's resolveContractIdentity() — reading identity
 * directly off the already-typed OutcomeRecord instead of raw CRM
 * properties.
 *
 * `record.source_object` (free-form per the contract, §5.1) is
 * deliberately NOT written to outcome_events.source_object — that column's
 * DB CHECK only allows 'contact'/'deal' (unchanged since Phase 1), so a
 * webhook sender declaring something like 'spreadsheet_row' would violate
 * it. The persisted row always uses the config's own tracked_object
 * instead, exactly like the pull-sync path already does implicitly via the
 * provider's own object type.
 */
import { validateOutcomeRecord, resolveContractIdentity, type OutcomeValidationError } from './contract';
import { resolveStageMapping } from './objectMapper';
import { resolveValue } from './valueLadder';
import { deliverOutcome } from './outcomeDelivery';
import { computeEventId } from './eventId';
import { computeTierStats, evaluateDeliveryGate, TIER_BY_IDENTITY_METHOD, type InputTier } from './deliveryGate';
import {
  listOutcomeStageMappings,
  findExistingOutcomeKeys,
  upsertOutcomeEvents,
  getRecentIdentityMethodsForConfig,
  updateOutcomeSourceConfig,
  getLatestDerivedValueSnapshots,
} from '@/services/database/outcomeQueries';
import type { OutcomeSourceConfig, NewOutcomeEventInput, OutcomeDeliveryStatus, OutcomeIdentityMethod } from '@/types/outcomes';
import logger from '@/utils/logger';

export interface WebhookIngestResult {
  status: 'accepted' | 'rejected' | 'skipped_unmapped' | 'skipped_duplicate';
  errors?: OutcomeValidationError[];
  event_id?: string;
  identity_method?: OutcomeIdentityMethod;
  tier?: InputTier;
  conversion_value?: number | null;
  currency?: string | null;
  /** Present on the real endpoint only. */
  delivery_status?: OutcomeDeliveryStatus;
  /** Present on the dry-run endpoint only — whether delivery would have been attempted. */
  would_deliver?: boolean;
}

export async function runWebhookIngest(
  config: OutcomeSourceConfig,
  payload: unknown,
  opts: { dryRun: boolean },
): Promise<WebhookIngestResult> {
  const validation = validateOutcomeRecord(payload);
  if (!validation.valid) {
    return { status: 'rejected', errors: validation.errors };
  }
  const record = validation.record!;

  const stageMappings = await listOutcomeStageMappings(config.id);
  const mapping = resolveStageMapping(stageMappings, record.source_stage_id);
  if (!mapping) {
    return { status: 'skipped_unmapped' };
  }

  const identity = resolveContractIdentity(record.identity);
  const tier = TIER_BY_IDENTITY_METHOD[identity.method];
  const eventId = computeEventId(config.id, record.source_record_id, record.source_stage_id);

  // §9.2's idempotency — same mechanism the pull path already relies on,
  // checked before any delivery attempt (never after) for the same reason
  // syncOrchestrator.ts checks it first: a DB-level upsert alone stops a
  // duplicate ROW, not a duplicate live call to Google/Meta/LinkedIn.
  if (!opts.dryRun) {
    const existingKeys = await findExistingOutcomeKeys(config.id, [record.source_record_id]);
    if (existingKeys.has(`${record.source_record_id}::${mapping.crm_stage_id}`)) {
      return { status: 'skipped_duplicate', event_id: eventId };
    }
  }

  const derivedSnapshot = config.value_mode === 'DERIVED'
    ? (await getLatestDerivedValueSnapshots(config.id)).find((s) => s.crm_stage_id === mapping.crm_stage_id) ?? null
    : null;
  const observedAmount = mapping.is_terminal_won
    ? { amount: record.value ?? null, currency: record.currency ?? null }
    : { amount: null, currency: null };
  const resolvedValue = resolveValue(
    mapping,
    config,
    observedAmount,
    derivedSnapshot ? { value: derivedSnapshot.derived_value, currency: derivedSnapshot.currency, confidence: derivedSnapshot.confidence } : null,
  );

  let deliveryStatus: OutcomeDeliveryStatus = 'skipped_unresolved';
  let deliveryDetail: Record<string, unknown> = {};
  let deliveredAt: string | null = null;
  let wouldDeliver = false;

  if (identity.method !== 'unresolved') {
    if (!config.delivery_enabled) {
      deliveryStatus = 'skipped_delivery_disabled';
    } else {
      wouldDeliver = true;
      if (!opts.dryRun) {
        const delivery = await deliverOutcome(mapping, {
          organization_id: config.organization_id,
          event_id: eventId,
          stage_changed_at: record.stage_changed_at,
          conversion_value: resolvedValue.value,
          currency: resolvedValue.currency,
          identity,
        });
        deliveryStatus = delivery.status;
        deliveryDetail = delivery.detail;
        deliveredAt = delivery.delivered_at;
      }
    }
  }

  if (opts.dryRun) {
    return {
      status: 'accepted',
      event_id: eventId,
      identity_method: identity.method,
      tier,
      conversion_value: resolvedValue.value,
      currency: resolvedValue.currency,
      would_deliver: wouldDeliver,
    };
  }

  const row: NewOutcomeEventInput = {
    client_id: config.client_id,
    config_id: config.id,
    mapping_id: mapping.id,
    source_record_id: record.source_record_id,
    source_object: config.tracked_object,
    source_stage_id: mapping.crm_stage_id,
    stage_changed_at: record.stage_changed_at,
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
  };
  await upsertOutcomeEvents(config.organization_id, [row]);

  // §6.3's delivery gate — checked inline right after persisting, since a
  // push source's tier composition only changes when a new record actually
  // arrives (there's no polling cadence to hang a periodic check off of).
  if (config.delivery_enabled) {
    const recentMethods = await getRecentIdentityMethodsForConfig(config.id);
    const stats = computeTierStats(recentMethods);
    const gate = evaluateDeliveryGate(stats);
    if (gate.shouldDisable) {
      await updateOutcomeSourceConfig(config.id, config.organization_id, {
        delivery_enabled: false,
        delivery_disabled_reason: gate.reason,
      });
      logger.warn({ configId: config.id, stats }, 'Outcome webhook: delivery auto-disabled by the tier-3 gate');
    }
  }

  return {
    status: 'accepted',
    event_id: eventId,
    identity_method: identity.method,
    tier,
    conversion_value: resolvedValue.value,
    currency: resolvedValue.currency,
    delivery_status: deliveryStatus,
  };
}
