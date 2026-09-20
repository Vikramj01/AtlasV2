/**
 * Salesforce REST/SOQL client — implements OutcomeSource (was CrmProvider,
 * renamed Phase 2, docs/prd/universal-outcome-ingestion.md §5.2; CRM
 * Outcome Integration Sprint 10, D1 — "Salesforce as Sprint 10", parity
 * with HubSpot on Sprints 1-8/9).
 *
 * Auth: Bearer access_token against `tokens.instance_url` (Salesforce's
 * per-org API base — see salesforceOAuth.ts's module header for why this
 * is structurally different from HubSpot's fixed api.hubapi.com). Like
 * hubspotClient.ts, this client does not refresh itself on a 401 — that's
 * a caller-level concern (crmSyncOrchestrator.ts), matching how
 * googleAdsSync.ts et al. already work.
 *
 * Two structural gaps from HubSpot's object model, both flagged in-file
 * rather than silently papered over:
 *
 * 1. listPipelines() — Salesforce has no single "list pipelines" endpoint
 *    the way HubSpot's GET /crm/v3/pipelines/deals is. An org's Opportunity
 *    stages are one global picklist (OpportunityStage, org-wide, though a
 *    real org can layer multiple named Sales Processes with different
 *    stage subsets on top of it — that finer-grained API is NOT built
 *    here). This client models the org's stage set as ONE synthetic
 *    pipeline ({id: 'default', label: 'Sales Process', stages: [...]}),
 *    exactly the same shape objectMapper.ts/StageLadderEditor.tsx already
 *    consume provider-agnostically. IsWon/IsClosed are read directly from
 *    OpportunityStage (more reliable than HubSpot's probability-inferred
 *    won/lost) and translated into the shared metadata.probability field
 *    so buildDefaultStageMappings()'s existing won/lost inference (which
 *    only understands probability, not a separate IsWon flag) still
 *    derives the correct result without changing that frozen shared type.
 *
 * 2. Stage/identity field names on Contact — Salesforce Opportunities have
 *    a real stage field (StageName); Contacts structurally do not (only
 *    Leads and Opportunities are staged in Salesforce's own model, and
 *    Lead is out of OutcomeObjectType's v1 scope). A contact-tracked Salesforce
 *    ladder therefore needs an Atlas-namespaced custom field the operator
 *    creates (Atlas_Stage__c) — mirrors this PRD's own established pattern
 *    of Atlas-namespaced custom fields for exactly this kind of gap
 *    (atlas_gclid__c etc., identityResolver.ts's
 *    SALESFORCE_DEFAULT_IDENTITY_PROPERTY_MAP). v1's ladder is deal-centric
 *    (tracked_object defaults to 'deal') per the same reasoning
 *    hubspotClient.ts already documents for its own contact gap.
 *
 * This sandbox's egress proxy blocks login.salesforce.com and
 * developer.salesforce.com (same class of restriction as api.hubapi.com,
 * Key Technical Decision §14/§24) — built from Salesforce's REST/SOQL API,
 * long-stable and well-documented (unlike Google's Data Manager API), but
 * unverified live here. Re-verify before this reaches a real client,
 * especially the OpportunityStage.MasterLabel-vs-Opportunity.StageName
 * assumption below.
 */

import type {
  OutcomeSource,
  OutcomeSourceType,
  OutcomeObjectType,
  DecryptedTokens,
  CrmAccountInfo,
  CrmPipeline,
  CrmProperty,
  CrmRecord,
} from './types';
import logger from '@/utils/logger';

// Best-effort, unverified live (see module header) — a recent, stable
// Salesforce REST API version. Scoped locally since only this one file
// calls it, unlike Google Ads' shared adsApiVersion.ts constant (Key
// Technical Decision §23), which seven call sites needed.
const SALESFORCE_API_VERSION = 'v61.0';

// The property that carries a record's stage, per object type. Contact has
// no standard equivalent to Opportunity.StageName — see module header
// point 2. This is a DEFAULT only; crm_sync_configs doesn't expose a way
// to override the stage-property name itself (identity_property_map only
// covers identity fields, not the stage field — same limitation HubSpot's
// STAGE_PROPERTY_BY_OBJECT has).
const STAGE_PROPERTY_BY_OBJECT: Record<OutcomeObjectType, string> = {
  deal: 'StageName',
  contact: 'Atlas_Stage__c',
};

function objectApiName(object: OutcomeObjectType): 'Opportunity' | 'Contact' {
  return object === 'deal' ? 'Opportunity' : 'Contact';
}

function requireInstanceUrl(tokens: DecryptedTokens): string {
  if (!tokens.instance_url) {
    throw new Error('Salesforce connection is missing instance_url — reconnect via OAuth (salesforceOAuth.ts always sets this on exchange/refresh).');
  }
  return tokens.instance_url.replace(/\/$/, '');
}

async function sfFetch(
  path: string,
  tokens: DecryptedTokens,
  init: RequestInit = {},
): Promise<Response> {
  const base = requireInstanceUrl(tokens);
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    'Content-Type': 'application/json',
    ...init.headers,
  };

  const response = await fetch(url, { ...init, headers });

  // Single retry on 429, honouring Retry-After — mirrors hubspotClient.ts's
  // own single-retry shape, per §9.4's explicit "must handle 429 with
  // exponential backoff" requirement for both providers. A 403 with
  // REQUEST_LIMIT_EXCEEDED (Salesforce's org-wide DAILY API call cap) is
  // deliberately NOT retried here — a burst retry can't fix an exhausted
  // daily allotment, so it's left to surface as a normal thrown error for
  // the caller (crmSyncOrchestrator.ts) to log and fail the run, same as
  // any other non-2xx.
  if (response.status === 429) {
    const retryAfterS = parseInt(response.headers.get('Retry-After') ?? '2', 10);
    logger.warn({ path, retryAfterS }, 'Salesforce API rate limited — retrying once');
    await new Promise((resolve) => setTimeout(resolve, retryAfterS * 1000));
    return fetch(url, { ...init, headers });
  }

  return response;
}

async function soqlQuery<T = Record<string, unknown>>(
  soql: string,
  tokens: DecryptedTokens,
): Promise<T[]> {
  const results: T[] = [];
  let path: string | null = `/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

  while (path) {
    const response: Response = await sfFetch(path, tokens);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Salesforce SOQL query failed (${response.status}): ${body}`);
    }
    const page = await response.json() as { records: T[]; done: boolean; nextRecordsUrl?: string };
    results.push(...page.records);
    path = page.done ? null : (page.nextRecordsUrl ?? null);
  }

  return results;
}

// Salesforce's query API returns native JSON types (numbers, booleans) for
// typed fields, unlike HubSpot's search API which returns every property
// value as a string uniformly. CrmRecord.properties is
// Record<string, string | null> (the shared, provider-agnostic shape
// identityResolver.ts/crmSyncOrchestrator.ts both read) — this normalizes
// every requested field to that shape regardless of its native SOQL type,
// so downstream code needs no provider-specific branching.
function normalizeRow(row: Record<string, unknown>, propertyNames: string[]): Record<string, string | null> {
  const properties: Record<string, string | null> = {};
  for (const name of propertyNames) {
    const value = row[name];
    properties[name] = value == null ? null : String(value);
  }
  return properties;
}

interface OpportunityStageRow {
  MasterLabel: string;
  SortOrder: number;
  IsClosed: boolean;
  IsWon: boolean;
  DefaultProbability: number | null;
}

interface DescribeField {
  name: string;
  label: string;
  type: string;
}

// `satisfies` rather than `: OutcomeSource` — see hubspotClient.ts's
// identical comment on why.
export const salesforceClient = {
  name: 'salesforce' as OutcomeSourceType,
  transport: 'pull',

  async testConnection(tokens: DecryptedTokens): Promise<CrmAccountInfo> {
    const rows = await soqlQuery<{ Id: string; Name: string }>('SELECT Id, Name FROM Organization LIMIT 1', tokens);
    const org = rows[0];
    if (!org) throw new Error('Salesforce testConnection: could not read the org record — check API access on this connected app.');
    return { account_id: org.Id, account_label: org.Name };
  },

  async listPipelines(tokens: DecryptedTokens): Promise<CrmPipeline[]> {
    const stages = await soqlQuery<OpportunityStageRow>(
      'SELECT MasterLabel, SortOrder, IsClosed, IsWon, DefaultProbability FROM OpportunityStage ORDER BY SortOrder',
      tokens,
    );

    return [{
      id: 'default',
      label: 'Sales Process',
      stages: stages.map((s) => {
        // Salesforce gives IsWon directly (more reliable than HubSpot's
        // probability-only inference) — normalized into a probability value
        // that still drives objectMapper.ts's existing shared
        // probability >= 1 / <= 0 inference correctly, without changing
        // CrmPipelineStage's frozen metadata shape.
        const probability = s.IsWon ? 1
          : (s.IsClosed ? 0 : (s.DefaultProbability != null ? s.DefaultProbability / 100 : null));
        return {
          id: s.MasterLabel, // the literal value stored in Opportunity.StageName — see module header
          label: s.MasterLabel,
          display_order: s.SortOrder,
          metadata: { is_closed: s.IsClosed, probability },
        };
      }),
    }];
  },

  async listProperties(tokens: DecryptedTokens, object: OutcomeObjectType): Promise<CrmProperty[]> {
    const response = await sfFetch(`/services/data/${SALESFORCE_API_VERSION}/sobjects/${objectApiName(object)}/describe`, tokens);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Salesforce listProperties failed (${response.status}): ${body}`);
    }
    const body = await response.json() as { fields: DescribeField[] };
    return body.fields.map((f) => ({ name: f.name, label: f.label, type: f.type }));
  },

  async *fetchChangedRecords(
    tokens: DecryptedTokens,
    object: OutcomeObjectType,
    since: Date,
    until: Date,
    propertyNames: string[],
  ): AsyncIterable<CrmRecord> {
    const stageProperty = STAGE_PROPERTY_BY_OBJECT[object];
    const fields = Array.from(new Set(['Id', 'LastModifiedDate', stageProperty, ...propertyNames]));
    const soql =
      `SELECT ${fields.join(', ')} FROM ${objectApiName(object)} ` +
      `WHERE LastModifiedDate >= ${since.toISOString()} AND LastModifiedDate < ${until.toISOString()} ` +
      `ORDER BY LastModifiedDate ASC`;

    let path: string | null = `/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

    while (path) {
      const response: Response = await sfFetch(path, tokens);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Salesforce fetchChangedRecords failed (${response.status}): ${body}`);
      }
      const page = await response.json() as {
        records: Record<string, unknown>[];
        done: boolean;
        nextRecordsUrl?: string;
      };

      for (const row of page.records) {
        const properties = normalizeRow(row, fields);
        yield {
          id: String(row.Id),
          object,
          stage_id: properties[stageProperty] ?? null,
          stage_changed_at: properties.LastModifiedDate ?? null,
          properties,
        };
      }

      path = page.done ? null : (page.nextRecordsUrl ?? null);
    }
  },

  // No writeAttribution() yet — Sprint 9's D3 write-back is optional per
  // the OutcomeSource interface (§4.2) and this Sprint's exit criterion is
  // scoped to "parity with HubSpot on Sprints 1-8" (§13's Sprint 10 row),
  // which predates Sprint 9. outcomeDelivery.ts's writeBackAttribution()
  // already no-ops cleanly for any provider lacking this method, so a
  // Salesforce config with write_back_enabled: true simply never writes
  // back rather than erroring — never fabricated, never silently assumed.
} satisfies OutcomeSource;
