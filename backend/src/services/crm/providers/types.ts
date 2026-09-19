/**
 * CrmProvider — the abstraction both HubSpot (Sprint 1) and Salesforce
 * (Sprint 10) implement, so crmSyncOrchestrator.ts (Sprint 4) is
 * provider-agnostic. Mirrors docs/prd/crm-outcome-integration.md §4.2
 * exactly — do not add parameters to these signatures without updating
 * the PRD, since both providers and the orchestrator depend on this shape.
 */

import type { CrmProviderName, CrmObjectType } from '@/types/crm';
import type { OAuthTokens } from '@/types/connections';

export type { CrmProviderName, CrmObjectType };

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
  object: CrmObjectType;
  stage_id: string | null;
  stage_changed_at: string | null; // ISO timestamp
  properties: Record<string, string | null>;
}

export interface CrmProvider {
  readonly name: CrmProviderName;

  /** Verify credentials and return the account identity for display. */
  testConnection(tokens: DecryptedTokens): Promise<CrmAccountInfo>;

  /** List pipelines and their stages, for the mapping UI. */
  listPipelines(tokens: DecryptedTokens): Promise<CrmPipeline[]>;

  /** List custom properties on a given object, for readiness checking (§6.2). */
  listProperties(tokens: DecryptedTokens, object: CrmObjectType): Promise<CrmProperty[]>;

  /**
   * Fetch records whose stage changed within [since, until].
   * MUST paginate internally and MUST be driven by a modified-since
   * filter, never a full table scan.
   */
  fetchChangedRecords(
    tokens: DecryptedTokens,
    object: CrmObjectType,
    since: Date,
    until: Date,
    propertyNames: string[],
  ): AsyncIterable<CrmRecord>;

  /** Optional attribution write-back (D3). Namespaced properties only. */
  writeAttribution?(
    tokens: DecryptedTokens,
    object: CrmObjectType,
    recordId: string,
    properties: Record<string, string>,
  ): Promise<void>;
}
