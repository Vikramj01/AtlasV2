/**
 * OutcomeSource (was CrmProvider — renamed docs/prd/universal-outcome-ingestion.md
 * §5.2, Phase 2) — the abstraction both HubSpot (Sprint 1) and Salesforce
 * (Sprint 10) implement, so syncOrchestrator.ts (Sprint 4) is
 * source-agnostic. Originally mirrored docs/prd/crm-outcome-integration.md
 * §4.2 exactly; Phase 2 widens it deliberately:
 *   - testConnection/listPipelines/listProperties are now optional — a
 *     push source (Phase 3's webhook) has no pipelines to list and no
 *     properties to enumerate; only a polled source needs them.
 *   - fetchChangedRecords stays required and keeps its exact signature and
 *     CrmRecord-shaped yield — see the docstring on fetchChangedRecords
 *     below for why this deliberately did NOT change to yield OutcomeRecord
 *     as docs/prd/universal-outcome-ingestion.md §5.2's literal text
 *     suggests (see that PRD's §12 implementation notes for the full
 *     reasoning: it would have silently changed syncOrchestrator.ts's
 *     records_processed counter for a no-stage record, a behavior an
 *     existing test locks in).
 *   - transport (new) — the push/pull discriminator §5.2 asks for, so the
 *     orchestrator knows whether a source should ever be actively polled at
 *     all. Both current sources are 'pull'; Phase 3's webhook is the first
 *     'push' source and is never scheduled onto outcomeSyncQueue.
 */

import type { OutcomeSourceType, OutcomeObjectType } from '@/types/outcomes';
import type { OAuthTokens } from '@/types/connections';

export type { OutcomeSourceType, OutcomeObjectType };

// Decrypted platform_connections.oauth_tokens envelope. HubSpot models this
// as a real OAuth token (access + refresh); a future private-key-auth
// provider (e.g. Klaviyo's pattern) would still satisfy this shape by
// putting the key in access_token with no refresh_token, same as this
// codebase already does for Klaviyo's connectionQueries usage.
export type DecryptedTokens = OAuthTokens;

export interface CrmAccountInfo {
  account_id: string;    // portal ID / org ID, as the provider identifies it
  account_label: string; // display name or domain, for the connect UI
}

export interface CrmPipelineStage {
  id: string;
  label: string;
  display_order: number;
  // Best-effort — HubSpot's Pipelines API documents isClosed/probability on
  // deal stage metadata (probability 1.0 = closed-won, 0.0 = closed-lost),
  // not independently re-verified against a live export in this sandbox.
  // objectMapper.ts uses this only to pre-fill a default ladder's
  // is_terminal_won/is_terminal_lost — the operator reviews and can correct
  // it before saving, so a wrong guess here is a UI default, not a silent
  // delivery-affecting error.
  metadata?: {
    is_closed: boolean;
    probability: number | null;
  };
}

export interface CrmPipeline {
  id: string;
  label: string;
  stages: CrmPipelineStage[];
}

export interface CrmProperty {
  name: string;
  label: string;
  type: string;
}

export interface CrmRecord {
  id: string;
  object: OutcomeObjectType;
  stage_id: string | null;
  stage_changed_at: string | null; // ISO timestamp
  properties: Record<string, string | null>;
}

export interface OutcomeSource {
  readonly name: OutcomeSourceType;

  /**
   * 'pull' — polled on a schedule via syncOrchestrator.ts's runSync()
   * (HubSpot, Salesforce). 'push' — records arrive via an inbound call
   * (Phase 3's webhook); runSync() short-circuits rather than polling one.
   */
  readonly transport: 'pull' | 'push';

  /** Verify credentials and return the account identity for display. Optional — a push source has nothing to test a connection against ahead of time. */
  testConnection?(tokens: DecryptedTokens): Promise<CrmAccountInfo>;

  /** List pipelines and their stages, for the mapping UI. Optional — a push source has no pipeline concept. */
  listPipelines?(tokens: DecryptedTokens): Promise<CrmPipeline[]>;

  /** List custom properties on a given object, for readiness checking (§6.2). Optional — a push source has nothing to enumerate. */
  listProperties?(tokens: DecryptedTokens, object: OutcomeObjectType): Promise<CrmProperty[]>;

  /**
   * Fetch records whose stage changed within [since, until].
   * MUST paginate internally and MUST be driven by a modified-since
   * filter, never a full table scan. Required — a 'pull' source is
   * meaningless without it; a 'push' source (Phase 3) implements it as an
   * empty generator, since syncOrchestrator.ts's transport guard means it's
   * never actually called for one.
   */
  fetchChangedRecords(
    tokens: DecryptedTokens,
    object: OutcomeObjectType,
    since: Date,
    until: Date,
    propertyNames: string[],
  ): AsyncIterable<CrmRecord>;

  /** Optional attribution write-back (D3). Namespaced properties only. */
  writeAttribution?(
    tokens: DecryptedTokens,
    object: OutcomeObjectType,
    recordId: string,
    properties: Record<string, string>,
  ): Promise<void>;
}
