/**
 * Input tiers & delivery gate — docs/prd/universal-outcome-ingestion.md
 * §6.2/§6.3.
 *
 * outcome_events.identity_method already computes what §6.2 calls a tier;
 * this module is what's new — naming the tier and deciding when it's bad
 * enough to act on.
 *
 *   Tier 1 — click_id                    → full delivery, highest match rate
 *   Tier 2 — hashed_email/hashed_phone    → Enhanced Conversions for Leads,
 *                                           materially lower match rate
 *   Tier 3 — unresolved                   → persisted, counted, never delivered
 *
 * §6.2 also names "click ID or atlas_event_id resolved" as Tier 1. This
 * module does NOT treat a bare atlas_event_id as Tier 1 for a webhook
 * record — that would require joining it to a real capi_events row to
 * inherit that row's own (possibly stronger) method, exactly the
 * inheritance identityResolver.ts's resolveIdentity() already supports via
 * its `originalEvent` parameter but which syncOrchestrator.ts has never
 * actually wired up (it always passes null). Building that join for the
 * webhook path in Phase 3 would be inventing behavior neither pipeline has
 * today; contract.ts's resolveContractIdentity() therefore degrades a
 * bare atlas_event_id (no click id, no email, no phone) to unresolved,
 * matching the pull path's real behavior rather than the PRD's
 * aspirational one. Flagged here rather than silently deviating.
 *
 * Delivery gate (§6.3, per this PRD's own Phase 3 implementation-notes
 * decision): "block the client-facing consequence, not the operator's
 * view" — but unlike run_quality's per-run export gate, a source's tier
 * composition only firms up over many records, not one. So this is an
 * ongoing auto-disable, not a one-time creation-time block: a brand-new
 * webhook source has zero history and nothing to gate on, so
 * delivery_enabled can be turned on immediately; this module's
 * evaluateDeliveryGate() is instead checked inline after each webhook
 * ingest (services/outcomes/webhookIngest.ts) and flips delivery_enabled
 * back to false, with a reason, the moment the rolling tier-3 rate
 * crosses threshold — never silently, always visible on the config itself.
 */
import type { OutcomeIdentityMethod } from '@/types/outcomes';

export type InputTier = 1 | 2 | 3;

export const TIER_BY_IDENTITY_METHOD: Record<OutcomeIdentityMethod, InputTier> = {
  click_id: 1,
  hashed_email: 2,
  hashed_phone: 2,
  unresolved: 3,
};

export interface TierStats {
  total: number;
  tier1: number;
  tier2: number;
  tier3: number;
  /** Percent (0-100). Null when total is 0 — nothing to compute a rate from. */
  tier3_rate_percent: number | null;
}

export function computeTierStats(methods: OutcomeIdentityMethod[]): TierStats {
  const total = methods.length;
  let tier1 = 0;
  let tier2 = 0;
  let tier3 = 0;
  for (const method of methods) {
    const tier = TIER_BY_IDENTITY_METHOD[method];
    if (tier === 1) tier1 += 1;
    else if (tier === 2) tier2 += 1;
    else tier3 += 1;
  }
  return { total, tier1, tier2, tier3, tier3_rate_percent: total > 0 ? (tier3 / total) * 100 : null };
}

// Matches dqmAlertEvaluator.ts's existing UNRESOLVED_IDENTITY_HIGH_THRESHOLD
// (30%, org-wide, pull-sync-scoped) for the same underlying concept — a
// deliberately shared number, not a second independently-tuned one, so
// "too many unresolved outcomes" means the same thing everywhere in this
// codebase's dashboards and alerts.
export const TIER3_RATE_THRESHOLD_PERCENT = 30;

// A brand-new source has no history to judge fairly — never gate on a
// handful of records. Below this sample size the gate never fires,
// regardless of rate.
export const MIN_SAMPLE_FOR_GATE = 10;

export interface DeliveryGateDecision {
  shouldDisable: boolean;
  /** Null when shouldDisable is false. */
  reason: string | null;
}

export function evaluateDeliveryGate(stats: TierStats): DeliveryGateDecision {
  if (stats.total < MIN_SAMPLE_FOR_GATE) return { shouldDisable: false, reason: null };
  if (stats.tier3_rate_percent !== null && stats.tier3_rate_percent > TIER3_RATE_THRESHOLD_PERCENT) {
    return {
      shouldDisable: true,
      reason: `${stats.tier3_rate_percent.toFixed(1)}% of the last ${stats.total} records could not be matched to an identity (click ID or hashed email/phone) — delivery was automatically disabled to avoid pushing unverified outcomes into live bidding. Fix identity capture on the sending side, then re-enable delivery.`,
    };
  }
  return { shouldDisable: false, reason: null };
}
